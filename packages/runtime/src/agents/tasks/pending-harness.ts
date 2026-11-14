import { createHash } from 'node:crypto'
import {
  decode,
  resolveTaskAgent,
  taskHarnessSchema,
  botPaused,
  type pendingHarnessSchema,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { validateDefaultHarness } from '../../storage/runtime-defaults.js'
import { continueHarness } from './thread-handoff.js'

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
const current = (s: Services, id: string) => {
  const agent = resolveTaskAgent(s.store.taskSummary(id), s.store.get().agents)
  if (!agent) throw new HttpError(409, 'Choose a harness for this Bot.')
  return hash(decode(taskHarnessSchema, agent))
}

export function savePendingHarness(s: Services, input: typeof pendingHarnessSchema.Type) {
  const fingerprint = hash(input)
  const key = `pending-harness:${input.requestId}`
  return s.store.transaction(() => {
    const receipt = s.db.prepare('SELECT value FROM documents WHERE id=?').pluck().get(key)
    if (receipt !== undefined) {
      if (receipt !== fingerprint)
        throw new HttpError(409, 'This request ID belongs to another model change.')
      return { ok: true as const }
    }
    const task = s.store.taskSummary(input.id)
    if (!task.bot || task.replica || task.archivedAt || task.machineHandoff)
      throw new HttpError(409, 'This Bot is unavailable for a model change.')
    if (
      task.bot.revision !== input.expectedBotRevision ||
      task.pendingHarness?.id !== input.expectedPendingId
    )
      throw new HttpError(
        409,
        'The Bot or its pending selection changed. Review the current settings.',
      )
    if (input.harness) validateDefaultHarness(input.harness)
    const selection = input.harness
      ? {
          id: input.requestId,
          harness: input.harness,
          botRevision: task.bot.revision,
          from: current(s, task.id),
          createdAt: new Date().toISOString(),
        }
      : undefined
    s.store.updateTask(task.id, (value) => ({ ...value, pendingHarness: selection }))
    s.db.prepare('INSERT INTO documents VALUES (?,?)').run(key, fingerprint)
    return { ok: true as const }
  })
}

/** Runs before admitting new input, including after restart. A failed handover keeps the choice. */
export async function applyPendingHarness(s: Services, id: string) {
  const task = s.store.taskSummary(id)
  const pending = task.pendingHarness
  if (!pending || task.activeRunId || botPaused(task)) return
  if (task.harnessHandoff?.id === pending.id) {
    s.store.updateTask(id, (value) =>
      value.pendingHarness?.id === pending.id ? { ...value, pendingHarness: undefined } : value,
    )
    return
  }
  const guard = () => {
    const latest = s.store.taskSummary(id)
    if (
      latest.pendingHarness?.id !== pending.id ||
      latest.bot?.revision !== pending.botRevision ||
      current(s, id) !== pending.from
    )
      throw new HttpError(409, 'The pending model change is stale. Cancel it and choose again.')
  }
  guard()
  await continueHarness(
    s,
    { id, requestId: pending.id, harness: pending.harness, stop: false },
    guard,
    true,
  )
  s.store.updateTask(id, (value) =>
    value.pendingHarness?.id === pending.id ? { ...value, pendingHarness: undefined } : value,
  )
}
