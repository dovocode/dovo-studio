import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  taskFamilyRunToken,
  ValidationError,
  safeValidationMessage,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { Services } from '../../services.js'
import { taskListFamily, taskListUndoMatches } from '../../storage/task-list-undo.js'

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
  if (request.action === 'undo') {
    s.store.transaction(() => {
      const ticket = s.taskListUndo.read(request.token)
      if (!ticket || ticket.owner !== owner) return rejected('Undo has expired or is unavailable.')
      if (ticket.invalidated || !taskListUndoMatches(s.store.get().tasks, ticket))
        return rejected('This thread or a subthread changed; Undo was not applied.')
      s.taskListUndo.remove(request.token)
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
    return { ok: true }
  }

  if (
    request.action === 'snooze' &&
    (!request.snoozedUntil ||
      !Number.isFinite(Date.parse(request.snoozedUntil)) ||
      Date.parse(request.snoozedUntil) <= Date.now())
  )
    return rejected('Choose a valid snooze duration.')
  if (request.action === 'snooze' && request.snoozedUntil === request.expectedSnoozedUntil)
    return rejected('This thread is already snoozed until that time.')
  return s.store.transaction(() => {
    const task = s.store.get().tasks.find((entry) => entry.id === request.id)
    if (
      !task ||
      (task.archived ?? null) !== request.expectedArchived ||
      (task.snoozedUntil ?? null) !== request.expectedSnoozedUntil ||
      task.archived ||
      task.archivedAt
    )
      return rejected('This thread changed; refresh before trying again.')
    const before = taskListFamily(s.store.get().tasks, request.id)
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
    const undo = s.taskListUndo.create({
      owner,
      root: request.id,
      before,
      after: taskListFamily(s.store.get().tasks, request.id),
      runToken: taskFamilyRunToken(s.store.get().tasks, request.id),
    })
    return { ok: true, undo }
  })
}
