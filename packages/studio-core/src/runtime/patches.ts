import { z } from 'zod'
import type { Workspace, WorkspacePatch } from '@dovo/protocol'
export function workspacePatches(before: Workspace, after: Workspace): WorkspacePatch[] {
  const patches: WorkspacePatch[] = []
  for (const collection of ['agents', 'repositories', 'tasks', 'automations'] as const)
    for (const entity of after[collection]) {
      const previous = before[collection].find((item) => item.id === entity.id)
      if (!previous) {
        patches.push({ collection, id: entity.id, create: entity, changes: {} })
        continue
      }
      const record = z.record(z.string(), z.unknown()).parse(entity),
        old = z.record(z.string(), z.unknown()).parse(previous)
      const changes: WorkspacePatch['changes'] = {}
      for (const key of new Set([...Object.keys(record), ...Object.keys(old)]))
        if (JSON.stringify(record[key]) !== JSON.stringify(old[key]))
          changes[key] = { before: old[key] ?? null, after: record[key] ?? null }
      if (Object.keys(changes).length) patches.push({ collection, id: entity.id, changes })
    }
  return patches
}
