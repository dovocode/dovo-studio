import {
  runtimeRecoveryScope,
  randomUUID,
  type RuntimeConnection,
  type Workspace,
} from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** A write-ahead record, retired only after the workspace outbox reaches the runtime. */
export function composerRecoveryKey(
  connection: RuntimeConnection | null,
  taskId: string,
  startupRuntimeId?: string | null,
) {
  // A fresh composer can open before discovery learns the runtime's intrinsic ID.
  const owner =
    connection && startupRuntimeId !== undefined
      ? { ...connection, runtimeId: startupRuntimeId ?? undefined }
      : connection
  return `dovo.composer-recovery.v1.${runtimeRecoveryScope(owner)}.${encodeURIComponent(taskId)}`
}
type StartupRecovery = { repositoryId: string; editedAt: number }
function record(key: string): {
  text: string | null
  id: string
  backup?: string
  startup?: StartupRecovery
} | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    !('text' in value) ||
    (value.text !== null && typeof value.text !== 'string') ||
    !('id' in value) ||
    typeof value.id !== 'string'
  )
    throw new Error('Saved composer recovery data is invalid. It was preserved.')
  if ('backup' in value && typeof value.backup !== 'string')
    throw new Error('Saved composer recovery data is invalid. It was preserved.')
  const startup = 'startup' in value ? value.startup : undefined
  return {
    text: value.text,
    id: value.id,
    ...('backup' in value && typeof value.backup === 'string' ? { backup: value.backup } : {}),
    startup:
      startup &&
      typeof startup === 'object' &&
      'repositoryId' in startup &&
      typeof startup.repositoryId === 'string' &&
      'editedAt' in startup &&
      typeof startup.editedAt === 'number' &&
      Number.isFinite(startup.editedAt)
        ? { repositoryId: startup.repositoryId, editedAt: startup.editedAt }
        : undefined,
  }
}

/** An unsaved startup task has no workspace row by which to find its recovery record. */
export function recoverStartupComposer(
  connection: RuntimeConnection | null,
  runtimeId: string | null,
  workspace: Pick<Workspace, 'tasks' | 'repositories'>,
) {
  let latest: (StartupRecovery & { taskId: string }) | undefined
  const prefix = composerRecoveryKey(connection, '', runtimeId)
  const existing = new Set(workspace.tasks.map((task) => task.id))
  const repositories = new Set(workspace.repositories.map((repository) => repository.id))
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    try {
      const taskId = decodeURIComponent(key.slice(prefix.length))
      if (!taskId || existing.has(taskId)) continue
      const item = record(key)
      if (
        item?.text?.trim() &&
        item.startup &&
        repositories.has(item.startup.repositoryId) &&
        (!latest || item.startup.editedAt > latest.editedAt)
      )
        latest = { taskId, ...item.startup }
    } catch {
      // A damaged record stays available for recovery without preventing other drafts from opening.
    }
  }
  return latest
}

export function createComposerRecovery(key: string, startupRepositoryId?: string) {
  const initial = record(key)
  const repositoryId = startupRepositoryId ?? initial?.startup?.repositoryId
  let owned = initial?.id ?? null
  return {
    text: initial?.text ?? null,
    backup: initial?.backup ?? '',
    startup: initial?.startup !== undefined,
    protect(this: void, text: string, expected?: string) {
      // A remounted composer may have edited even the same text. Compare record identity.
      if (expected !== undefined && (record(key)?.id ?? null) !== owned) return false
      const id = randomUUID()
      const startup =
        repositoryId === undefined ? undefined : { repositoryId, editedAt: Date.now() }
      localStorage.setItem(key, JSON.stringify({ text, id, startup }))
      owned = id
      return true
    },
    discardBackup(this: void) {
      const current = record(key)
      if (current?.id === owned && current.text === null)
        localStorage.setItem(key, JSON.stringify({ text: null, id: owned, backup: '' }))
    },
    checkpoint(this: void) {
      return owned
    },
    retire(this: void, checkpoint: string | null) {
      // Keep a small revision marker after sync, so a stale acknowledgement cannot clear
      // identical text written by a newer composer. Synced text is no longer replayed.
      const current = record(key)
      if (checkpoint !== null && current?.id === checkpoint)
        localStorage.setItem(
          key,
          JSON.stringify({
            text: null,
            id: checkpoint,
            backup: current.text ?? current.backup ?? '',
            startup: current.startup,
          }),
        )
    },
  }
}

/** Caret records must include the thread without exposing a credential-bearing scope string. */
export function composerCaretRecoveryKey(scope: string | undefined, taskId: string) {
  return `dovo.composer-caret.v1.${bytesToHex(sha256(utf8ToBytes(JSON.stringify([scope ?? '', taskId]))))}`
}
