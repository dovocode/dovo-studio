import { decodeResult } from '../../shared/schema.js'
import { workspaceSchema, type Workspace } from '../../workspace.js'
import type { WorkspacePatch } from './runtime.js'
/** Three-way reconciliation keeps server changes when the same leaf was edited twice. */
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

export function sameWorkspaceEditValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => sameWorkspaceEditValue(value, b[index]))
    )
  if (!object(a) || !object(b)) return false
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameWorkspaceEditValue(a[key], b[key]))
  )
}

export function reconcileWorkspaceEdit(
  before: unknown,
  local: unknown,
  host: unknown,
): {
  value: unknown
  conflicted: boolean
} {
  if (sameWorkspaceEditValue(local, host) || sameWorkspaceEditValue(local, before))
    return { value: host, conflicted: false }
  if (sameWorkspaceEditValue(host, before)) return { value: local, conflicted: false }
  if (
    object(local) &&
    object(host) &&
    (object(before) || before === null || before === undefined)
  ) {
    const base = object(before) ? before : {}
    const entries: Array<[string, unknown]> = []
    let conflicted = false
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(host),
    ])) {
      const merged = reconcileWorkspaceEdit(
        Object.hasOwn(base, key) ? base[key] : undefined,
        Object.hasOwn(local, key) ? local[key] : undefined,
        Object.hasOwn(host, key) ? host[key] : undefined,
      )
      conflicted ||= merged.conflicted
      if (merged.value !== undefined) entries.push([key, merged.value])
    }
    return { value: Object.fromEntries(entries), conflicted }
  }
  // Arrays have ordering and collection-specific invariants. Competing replacements
  // remain authoritative on the host rather than guessing at those semantics.
  return { value: host, conflicted: true }
}

/** Sending clears a draft outside workspace PATCH; the next draft is independent. */
export function workspaceDraftConsumed(host: unknown, before: unknown): boolean {
  if (!object(host) || host.draft !== '' || typeof before !== 'string' || !before.trim())
    return false
  const historyText = object(host.history) ? host.history.latestUserText : undefined
  const lastQueued = Array.isArray(host.queue) ? host.queue.at(-1) : undefined
  const queuedText = object(lastQueued) ? lastQueued.text : undefined
  const lastUser = Array.isArray(host.messages)
    ? [...host.messages]
        .reverse()
        .find((message: unknown) => object(message) && message.role === 'user')
    : undefined
  const messageText = object(lastUser) ? lastUser.text : undefined
  return [historyText, queuedText, messageText].some(
    (text) => typeof text === 'string' && text.trim() === before.trim(),
  )
}

/** Rebase presentation over the latest host without mutating its snapshot or journal. */
export function projectWorkspaceEdits(
  host: Workspace,
  patches: readonly WorkspacePatch[],
): Workspace {
  let workspace = host
  for (const patch of patches) {
    const collection = workspace[patch.collection]
    const entity = collection.find((item) => item.id === patch.id)
    if (patch.create !== undefined && entity) continue
    if (!entity && patch.create === undefined) continue
    const source = entity ?? patch.create
    if (!object(source)) continue
    const record = { ...source }
    let changed = !entity
    for (const [key, change] of Object.entries(patch.changes)) {
      const hostValue = Object.hasOwn(record, key) ? record[key] : undefined
      const merged =
        key === 'draft' && workspaceDraftConsumed(record, change.before)
          ? { value: change.after, conflicted: false }
          : reconcileWorkspaceEdit(change.before ?? null, change.after ?? null, hostValue ?? null)
      if (sameWorkspaceEditValue(hostValue ?? null, merged.value ?? null)) continue
      if (merged.value === null || merged.value === undefined) delete record[key]
      else
        Object.defineProperty(record, key, {
          value: merged.value,
          enumerable: true,
          configurable: true,
          writable: true,
        })
      changed = true
    }
    if (!changed) continue
    const parsed = decodeResult(workspaceSchema.fields[patch.collection].schema.value, record)
    // An invalid overlay must not hide authoritative state. The runtime still
    // settles the original intent and retains any rejected edit for recovery.
    if (!parsed.success) continue
    workspace = {
      ...workspace,
      [patch.collection]: entity
        ? collection.map((item) => (item.id === patch.id ? parsed.data : item))
        : [...collection, parsed.data],
    }
  }
  return workspace
}
