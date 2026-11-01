import { Schema } from 'effect'
import { mutableStruct, bringBackSideThreadResultSchema, type Task } from '@dovo/protocol'

/** The runtime's link from a full-agent side chat to the thread it was started from. */
export type SideThreadLink = NonNullable<Task['sideThread']>

export const sideThreadResponse = mutableStruct({ id: Schema.String })

/**
 * The runtime's exact, uniquely marked handoff. A repeated request returns the same receipt and
 * text, so a client can append it to its local draft once.
 */
export const sideThreadHandoffResponse = bringBackSideThreadResultSchema
export type SideThreadHandoff = typeof sideThreadHandoffResponse.Type

/** Keeps every local edit and adds the handoff unless this draft already contains it. */
export function appendHandoff(draft: string, text: string) {
  if (!text.trim() || draft.includes(text)) return draft
  return [draft.trimEnd(), text].filter(Boolean).join('\n\n')
}

const receiptsKey = 'dovo.sideChatHandoffReceipts'
const receiptLimit = 200
// Also kept for this session when storage is unavailable.
const sessionReceipts = new Set<string>()

function readReceipts(): string[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(receiptsKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Receipts outlive reloads, so a late or repeated response cannot restore removed text. */
export function handoffApplied(scope: string, receiptId: string) {
  const entry = JSON.stringify([scope, receiptId])
  return sessionReceipts.has(entry) || readReceipts().includes(entry)
}

export function recordHandoff(scope: string, receiptId: string) {
  const entry = JSON.stringify([scope, receiptId])
  sessionReceipts.add(entry)
  const receipts = readReceipts().filter((item) => item !== entry)
  try {
    globalThis.localStorage?.setItem(
      receiptsKey,
      JSON.stringify([...receipts, entry].slice(-receiptLimit)),
    )
  } catch {
    // The exact marked text still prevents a duplicate in the same draft.
  }
}

export function sideThreadOf(task: Pick<Task, 'id' | 'sideThread'>): SideThreadLink | undefined {
  const link = task.sideThread
  return link?.parentTaskId && link.parentTaskId !== task.id ? link : undefined
}

/** Newest first; archived side threads stay with their parent but after open ones. */
export function sideThreadsOf<
  T extends Pick<Task, 'id' | 'createdAt' | 'archivedAt' | 'sideThread'>,
>(tasks: readonly T[], parentId: string): T[] {
  return tasks
    .filter((task) => sideThreadOf(task)?.parentTaskId === parentId)
    .sort(
      (a, b) =>
        Number(!!a.archivedAt) - Number(!!b.archivedAt) || b.createdAt.localeCompare(a.createdAt),
    )
}

/**
 * The child's latest turn, when it completed and answered after the conversation it inherited.
 * Copied parent history alone is never a side chat result.
 */
export function ownCompletedTurn(
  child: Pick<Task, 'status' | 'turns' | 'messages' | 'sideThread'>,
) {
  const turn = child.turns?.at(-1)
  if (!turn || turn.status !== 'completed' || !['review', 'done'].includes(child.status))
    return undefined
  const inherited = child.sideThread?.contextMessageCount ?? 0
  const answer = child.messages.findIndex((message) => message.id === turn.assistantId)
  return answer >= inherited ? turn : undefined
}

/**
 * Why a child's results cannot be brought back yet. The runtime enforces the same rules; this
 * only explains a disabled button before the request.
 */
export function bringBackIssue(
  child: Pick<
    Task,
    'status' | 'queue' | 'turns' | 'messages' | 'sideThread' | 'archived' | 'archivedAt'
  >,
  parent: Pick<Task, 'status' | 'queue' | 'archived' | 'archivedAt'> | undefined,
): string {
  if (!parent) return 'The parent thread is not available on this computer.'
  if (parent.archivedAt) return 'Restore the parent thread first.'
  if (child.archivedAt) return 'Restore this side chat first.'
  if (child.status === 'running' || child.queue?.length) return 'Wait for the side chat to finish.'
  const turn = ownCompletedTurn(child)
  if (!turn) return 'Complete a turn in the side chat before bringing its results back.'
  if (parent.status === 'running' || parent.queue?.length)
    return 'Wait for the parent thread to finish its current and queued turns.'
  return ''
}

/** Where a side chat's files and conversation came from, so a stale view is never a surprise. */
export function sideThreadProvenance(link: Pick<SideThreadLink, 'source' | 'contextMessageCount'>) {
  const files = {
    snapshot: 'Own checkout from a snapshot of the parent, including its uncommitted changes.',
    checkpoint: 'Own checkout from the parent’s latest checkpoint.',
    head: 'Own checkout from the parent’s last commit. The parent was working, so its uncommitted changes are not included.',
    scratch: 'Copied the parent conversation into a separate, empty General directory.',
  }[link.source]
  const count = link.contextMessageCount
  const context = count
    ? `Started with a copy of ${count} parent message${count === 1 ? '' : 's'}; later parent messages are not shared.`
    : 'Started without the parent’s conversation.'
  // Only sources that differ from the usual full snapshot need a note next to each view.
  const note =
    link.source === 'head'
      ? 'Committed files only'
      : link.source === 'scratch'
        ? 'Separate directory'
        : undefined
  return { files, context, note, partial: link.source === 'head' }
}

/**
 * A side chat that was prepared but never started: it holds only its draft, so discarding it
 * loses nothing else. The runtime checks the same before discarding.
 */
export function unusedSideDraft(
  task: Pick<Task, 'id' | 'sideThread' | 'status' | 'turns' | 'queue' | 'messages'>,
) {
  const link = sideThreadOf(task)
  return (
    !!link &&
    task.status === 'draft' &&
    !task.turns?.length &&
    !task.queue?.length &&
    task.messages.length <= link.contextMessageCount
  )
}

const besideKey = 'dovo.sideChatBeside'
const besideLimit = 100
type BesideEntry = { parent: string; identity?: string; child: string }
// Also kept for this session when storage is unavailable.
const sessionBeside = new Map<string, BesideEntry>()

function readBeside(): BesideEntry[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(besideKey) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (item): item is BesideEntry =>
            !!item &&
            typeof item === 'object' &&
            typeof item.parent === 'string' &&
            typeof item.child === 'string' &&
            (item.identity === undefined || typeof item.identity === 'string'),
        )
      : []
  } catch {
    return []
  }
}

function writeBeside(entries: BesideEntry[]) {
  try {
    globalThis.localStorage?.setItem(besideKey, JSON.stringify(entries.slice(-besideLimit)))
  } catch {
    // The session copy still restores the pairing until reload.
  }
}

/**
 * The side chat last shown beside a parent. `parent` identifies the runtime profile and thread;
 * the runtime's own identity, once known, keeps a re-pointed profile from restoring a stranger's
 * thread id.
 */
export function sideChatBeside(parent: string, identity: string | undefined) {
  const entry = sessionBeside.get(parent) ?? readBeside().find((item) => item.parent === parent)
  if (!entry || (entry.identity && identity && entry.identity !== identity)) return undefined
  return entry.child
}

export function recordSideChatBeside(parent: string, identity: string | undefined, child: string) {
  const entry = { parent, child, ...(identity ? { identity } : {}) }
  sessionBeside.set(parent, entry)
  writeBeside([...readBeside().filter((item) => item.parent !== parent), entry])
}

export function forgetSideChatBeside(parent: string) {
  sessionBeside.delete(parent)
  const entries = readBeside()
  if (entries.some((item) => item.parent === parent))
    writeBeside(entries.filter((item) => item.parent !== parent))
}
