import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  taskFamilyIds,
  taskFamilyRunToken,
  ValidationError,
  safeValidationMessage,
  type TaskSummary,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { Services } from '../../services.js'

const actionSchema = Schema.Union([
  mutableStruct({
    action: Schema.Literals(['settle', 'snooze']),
    id: Schema.String,
    expectedArchived: Schema.NullOr(Schema.Boolean),
    expectedSnoozedUntil: Schema.NullOr(Schema.String),
    snoozedUntil: Schema.NullOr(Schema.String),
  }),
  mutableStruct({ action: Schema.Literal('undo'), token: Schema.String }),
])

function lifecycle(task: TaskSummary) {
  return {
    id: task.id,
    archived: task.archived,
    archivedAt: task.archivedAt,
    autoSettled: task.autoSettled,
    settledAt: task.settledAt,
    snoozedUntil: task.snoozedUntil,
    quotaContinuation: task.quotaContinuation,
    status: task.status,
    activeRunId: task.activeRunId,
  }
}
type Lifecycle = ReturnType<typeof lifecycle>
type Ticket = {
  owner: string
  root: string
  before: Lifecycle[]
  after: Lifecycle[]
  runToken: string
  expires: number
  invalidated?: boolean
}
const tickets = new WeakMap<Services['store'], Map<string, Ticket>>()
const lifetime = 30_000

function family(tasks: readonly TaskSummary[], root: string) {
  const ids = taskFamilyIds(tasks, root)
  return tasks
    .filter((task) => ids.has(task.id))
    .map(lifecycle)
    .sort((a, b) => a.id.localeCompare(b.id))
}
function rejected(message: string): never {
  throw new HttpError(409, message, { mutationRejected: true })
}

export function taskListAction(s: Services, owner: string, input: unknown) {
  try {
    return applyTaskListAction(s, owner, input)
  } catch (error) {
    if (error instanceof ValidationError)
      throw new HttpError(400, safeValidationMessage(error), { mutationRejected: true })
    if (error instanceof HttpError && [400, 403, 404, 409, 422].includes(error.status))
      throw new HttpError(error.status, error.message, { mutationRejected: true })
    throw error
  }
}

function applyTaskListAction(s: Services, owner: string, input: unknown) {
  const request = decode(actionSchema, input)
  let entries = tickets.get(s.store)
  if (!entries) {
    entries = new Map()
    tickets.set(s.store, entries)
    const active = entries
    s.store.onCommitted((_before, after) => {
      for (const [token, ticket] of active) {
        if (ticket.expires <= Date.now()) active.delete(token)
        else if (
          !ticket.invalidated &&
          (!isDeepStrictEqual(family(after.tasks, ticket.root), ticket.after) ||
            taskFamilyRunToken(after.tasks, ticket.root) !== ticket.runToken)
        )
          ticket.invalidated = true
      }
    })
  }
  const now = Date.now()
  for (const [token, entry] of entries) if (entry.expires <= now) entries.delete(token)

  if (request.action === 'undo') {
    const ticket = entries.get(request.token)
    if (!ticket || ticket.owner !== owner) return rejected('Undo has expired or is unavailable.')
    if (ticket.invalidated)
      return rejected('This thread or a subthread changed; Undo was not applied.')
    s.store.transaction(() => {
      if (
        !isDeepStrictEqual(family(s.store.get().tasks, ticket.root), ticket.after) ||
        taskFamilyRunToken(s.store.get().tasks, ticket.root) !== ticket.runToken
      )
        return rejected('This thread or a subthread changed; Undo was not applied.')
      const previous = new Map(ticket.before.map((state) => [state.id, state]))
      s.store.update(
        (workspace) => ({
          ...workspace,
          tasks: workspace.tasks.map((task) => {
            const state = previous.get(task.id)
            if (!state) return task
            return {
              ...task,
              archived: state.archived,
              archivedAt: state.archivedAt,
              autoSettled: state.autoSettled,
              settledAt: state.settledAt,
              snoozedUntil: state.snoozedUntil,
              quotaContinuation: state.quotaContinuation,
            }
          }),
        }),
        undefined,
        undefined,
        { preserveSettledAt: true },
      )
    })
    entries.delete(request.token)
    return { ok: true }
  }

  if (
    request.action === 'snooze' &&
    (!request.snoozedUntil ||
      !Number.isFinite(Date.parse(request.snoozedUntil)) ||
      Date.parse(request.snoozedUntil) <= now)
  )
    return rejected('Choose a valid snooze duration.')
  if (request.action === 'snooze' && request.snoozedUntil === request.expectedSnoozedUntil)
    return rejected('This thread is already snoozed until that time.')
  const result = s.store.transaction(() => {
    const task = s.store.get().tasks.find((entry) => entry.id === request.id)
    if (
      !task ||
      (task.archived ?? null) !== request.expectedArchived ||
      (task.snoozedUntil ?? null) !== request.expectedSnoozedUntil ||
      task.archived ||
      task.archivedAt
    )
      return rejected('This thread changed; refresh before trying again.')
    const before = family(s.store.get().tasks, request.id)
    s.store.patch({
      collection: 'tasks',
      id: request.id,
      changes:
        request.action === 'settle'
          ? {
              archived: { before: task.archived ?? null, after: true },
              snoozedUntil: { before: task.snoozedUntil ?? null, after: null },
            }
          : { snoozedUntil: { before: task.snoozedUntil ?? null, after: request.snoozedUntil } },
    })
    return {
      before,
      after: family(s.store.get().tasks, request.id),
      runToken: taskFamilyRunToken(s.store.get().tasks, request.id),
    }
  })
  const token = randomUUID()
  entries.set(token, { owner, root: request.id, ...result, expires: now + lifetime })
  return { ok: true, undo: token }
}
