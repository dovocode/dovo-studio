import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Workspace, WorkspacePatch } from '@dovo/protocol'
export function workspacePatches(before: Workspace, after: Workspace): WorkspacePatch[] {
  const patches: WorkspacePatch[] = []
  for (const collection of ['agents', 'repositories', 'tasks', 'automations'] as const) {
    if (before[collection] === after[collection]) continue
    const previousById = new Map(before[collection].map((entity) => [entity.id, entity]))
    for (const entity of after[collection]) {
      const previous = previousById.get(entity.id)
      if (previous === entity) continue
      if (!previous) {
        patches.push({
          collection,
          id: entity.id,
          create: entity,
          changes: {},
        })
        continue
      }
      const record = decode(
          Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
          entity,
        ),
        old = decode(Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)), previous)
      const changes: WorkspacePatch['changes'] = {}
      for (const key of new Set([...Object.keys(record), ...Object.keys(old)]))
        if (record[key] !== old[key] && JSON.stringify(record[key]) !== JSON.stringify(old[key]))
          changes[key] = {
            before: old[key] ?? null,
            after: record[key] ?? null,
          }
      if (Object.keys(changes).length)
        patches.push({
          collection,
          id: entity.id,
          changes,
        })
    }
  }
  return patches
}
