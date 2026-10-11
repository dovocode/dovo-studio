import { Schema } from 'effect'
import { decode, workspaceSchema, type Workspace, type WorkspacePatch } from '@dovo/protocol'

export type WorkspaceConflict = {
  patchId: string
  collection: WorkspacePatch['collection']
  id: string
  name: string
  field: string | null
  before: unknown
  local: unknown
  host: unknown
}
export type WorkspaceEntityRestore = {
  collection: WorkspacePatch['collection']
  id: string
  entity: Workspace[WorkspacePatch['collection']][number] | null
}
const record = (value: unknown) => ({
  ...decode(Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)), value),
})

/** Patch values are JSON data; object property order is not a competing edit. */
export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((value, i) => sameWorkspaceValue(value, right[i]))
    )
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  const a = record(left),
    b = record(right)
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && sameWorkspaceValue(a[key], b[key]))
  )
}

/** Compare queued field chains against the host, showing each conflicting field once. */
export function workspaceConflicts(host: Workspace, patches: WorkspacePatch[], ids: string[]) {
  const conflicts = new Map<string, WorkspaceConflict>()
  const entities = new Map<string, Record<string, unknown> | null>()
  for (const [index, patch] of patches.entries()) {
    const key = JSON.stringify([patch.collection, patch.id])
    if (!entities.has(key)) {
      const entity = host[patch.collection].find((item) => item.id === patch.id)
      entities.set(key, entity ? record(entity) : null)
    }
    const current = entities.get(key) ?? null
    const name = current?.name ?? current?.title ?? patch.id
    const base = {
      patchId: ids[index],
      collection: patch.collection,
      id: patch.id,
      name: typeof name === 'string' ? name : patch.id,
    }
    if (patch.create !== undefined) {
      if (current && !sameWorkspaceValue(current, patch.create))
        conflicts.set(key, {
          ...base,
          field: null,
          before: null,
          local: patch.create,
          host: current,
        })
      entities.set(key, record(patch.create))
      continue
    }
    if (!current) {
      if (!conflicts.has(key))
        conflicts.set(key, { ...base, field: null, before: null, local: patch.changes, host: null })
      continue
    }
    for (const [field, change] of Object.entries(patch.changes)) {
      const fieldKey = JSON.stringify([patch.collection, patch.id, field])
      const existing = conflicts.get(fieldKey)
      const value = current[field] ?? null
      if (existing) existing.local = change.after
      else if (
        !sameWorkspaceValue(value, change.before ?? null) &&
        !sameWorkspaceValue(value, change.after ?? null)
      )
        conflicts.set(fieldKey, {
          ...base,
          field,
          before: change.before,
          local: change.after,
          host: value,
        })
      current[field] = change.after
    }
  }
  // A missing or colliding entity is resolved as a unit; don't offer field overwrites on it.
  return [...conflicts.values()].filter(
    (conflict) =>
      conflict.field === null || !conflicts.has(JSON.stringify([conflict.collection, conflict.id])),
  )
}

/** Restore one authoritative entity, then project all remaining journal entries for it. */
export function restoreWorkspaceEntity(
  workspace: Workspace,
  restore: WorkspaceEntityRestore,
  patches: WorkspacePatch[],
): Workspace {
  let entity = restore.entity === null ? null : record(restore.entity)
  for (const patch of patches) {
    if (patch.collection !== restore.collection || patch.id !== restore.id) continue
    if (!entity && patch.create !== undefined) entity = record(patch.create)
    if (!entity)
      throw new Error(
        'The item was removed while resolving saved edits. Review the current changes.',
      )
    for (const [field, change] of Object.entries(patch.changes)) {
      if (change.after === null) delete entity[field]
      else entity[field] = change.after
    }
  }
  const collection = workspace[restore.collection]
  const restored = entity
    ? collection.some((item) => item.id === restore.id)
      ? collection.map((item) => (item.id === restore.id ? entity : item))
      : [...collection, entity]
    : collection.filter((item) => item.id !== restore.id)
  return decode(workspaceSchema, { ...workspace, [restore.collection]: restored })
}
