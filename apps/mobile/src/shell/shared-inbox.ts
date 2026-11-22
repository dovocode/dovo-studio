import type { SharePayload } from 'expo-sharing'
import { sharedMessage } from './shared-message'

export const SHARED_DRAFT_BUDGET = 50 * 1024 * 1024
export type SharedFile = { id: string; uri: string; name: string; mimeType?: string }
export type SharedHandoff = {
  id: string
  payloads: (SharePayload & { name?: string })[]
  error?: string
}
export type SharedDraft = {
  id: string
  text: string
  title: string
  repositoryId: string
  agentId: string
  source: 'share'
  files: SharedFile[]
  shareError?: string
  shareRetryable?: boolean
}

export class InvalidSharedHandoff extends Error {}

/** Persist the draft before acknowledging native ownership. A replay uses its original handoff ID. */
export async function ingestSharedHandoffs<
  T extends {
    id: string
    source?: 'share'
    shareError?: string
    shareRetryable?: boolean
  },
>(
  saved: T[],
  handoffs: SharedHandoff[],
  ports: {
    ownFiles: (handoff: SharedHandoff) => Promise<SharedFile[]>
    save: (items: (T | SharedDraft)[]) => Promise<void>
    acknowledge: (id: string) => Promise<void>
  },
): Promise<(T | SharedDraft)[]> {
  let updated: (T | SharedDraft)[] = saved
  for (const handoff of handoffs) {
    let entry = updated.find((entry) => entry.id === handoff.id)
    if (
      !entry ||
      (entry.source === 'share' &&
        entry.shareError &&
        entry.shareRetryable !== false &&
        !handoff.error)
    ) {
      if (!handoff.payloads.length && !handoff.error) {
        await ports.acknowledge(handoff.id)
        continue
      }
      let text = ''
      let files: SharedFile[] = []
      let shareError = handoff.error
      let shareRetryable = false
      if (!shareError) {
        try {
          text = sharedMessage(handoff.payloads)
          try {
            files = await ports.ownFiles(handoff)
          } catch (error) {
            shareRetryable = !(error instanceof InvalidSharedHandoff)
            throw error
          }
        } catch (error) {
          shareError = error instanceof Error ? error.message : String(error)
        }
      }
      const next: SharedDraft = {
        id: handoff.id,
        text,
        title: 'Shared content',
        repositoryId: '',
        agentId: '',
        source: 'share',
        ...entry,
        files,
        shareError: shareError?.slice(0, 2000),
        shareRetryable: shareError ? shareRetryable : undefined,
      }
      updated = entry
        ? updated.map((item) => (item.id === handoff.id ? next : item))
        : [...updated, next]
      entry = next
      await ports.save(updated)
    }
    // Rejected items remain native-owned until the user explicitly discards the error draft.
    if (!entry.shareError) await ports.acknowledge(handoff.id)
  }
  return updated
}

/** A failed native acknowledgment keeps the draft and its owned files available for retry. */
export async function removeInboxEntry<T extends { id: string; source?: 'share' }>(
  saved: T[],
  id: string,
  ports: {
    acknowledge: (id: string) => Promise<void>
    save: (items: T[]) => Promise<void>
    release: (id: string) => void
  },
): Promise<T[]> {
  const entry = saved.find((item) => item.id === id)
  if (entry?.source === 'share') await ports.acknowledge(id)
  const next = saved.filter((item) => item.id !== id)
  await ports.save(next)
  if (entry?.source === 'share') ports.release(id)
  return next
}

export const SHORTCUT_INBOX_STORAGE = 'dovo.shortcut.inbox'

/** Keep the original bytes and files if a damaged entry cannot be decoded. */
export async function restoreShortcutInbox<T extends { id: string }>(ports: {
  read: (key: string) => Promise<string | null>
  write: (key: string, value: string) => Promise<void>
  decode: (entry: unknown) => T | undefined
  cleanup: (ids: string[]) => void
}): Promise<T[]> {
  const value = await ports.read(SHORTCUT_INBOX_STORAGE)
  let parsed: unknown
  try {
    parsed = JSON.parse(value ?? '[]')
  } catch {
    parsed = undefined
  }
  const entries = Array.isArray(parsed) ? parsed : []
  const items = entries.flatMap((entry) => {
    const decoded = ports.decode(entry)
    return decoded ? [decoded] : []
  })
  const recoveryKey = `${SHORTCUT_INBOX_STORAGE}.recovery`
  const recovery = await ports.read(recoveryKey)
  if (!Array.isArray(parsed) || items.length !== entries.length) {
    // Write the recovery archive first. If that fails, neither the inbox nor its files change.
    let key = recoveryKey
    let saved = recovery
    for (let revision = 1; saved !== null && saved !== value; revision++) {
      key = `${recoveryKey}.${revision}`
      saved = await ports.read(key)
    }
    if (saved === null) await ports.write(key, value ?? '')
    await ports.write(SHORTCUT_INBOX_STORAGE, JSON.stringify(items))
  }
  // A recovery archive may reference any owned file, including those with an undecodable ID.
  if (recovery === null && Array.isArray(parsed) && items.length === entries.length)
    ports.cleanup(items.map((item) => item.id))
  return items
}
