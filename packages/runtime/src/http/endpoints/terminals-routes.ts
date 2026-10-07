import { routeProgram, serviceResult } from '../support/effect.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { isDeepStrictEqual } from 'node:util'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { RuntimeServices } from '../../services.js'
import { HttpError, runtimeOperation } from '../../errors.js'
import { body } from '../support/body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
function terminalCheckout(store: WorkspaceStore, taskId: string, checkoutId?: string) {
  const seen = new Set<string>()
  let task = store.task(taskId)
  let selected = checkoutId
  while (true) {
    store.requireTaskWritable(task.id)
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore the thread before opening a terminal')
    if (seen.has(task.id)) throw new HttpError(409, 'Invalid inherited checkout')
    seen.add(task.id)
    if (!task.delegation) break
    selected ??= task.delegation.checkoutId
    task = store.task(task.delegation.parentTaskId)
  }
  const link = selected ? task.linkedCheckouts?.find((entry) => entry.id === selected) : undefined
  if (selected && !link) throw new HttpError(404, 'Linked checkout not found')
  const repo = store
    .get()
    .repositories.find((entry) => entry.id === (link?.repositoryId ?? task.repositoryId))
  if (!repo) throw new HttpError(404, 'Repository not found')
  return {
    taskId: task.id,
    repositoryId: repo.id,
    path: repo.path,
    kind: repo.kind,
    checkout: link ?? {
      execution: task.execution,
      existingWorktreePath: task.existingWorktreePath,
      worktreeBaseBranch: task.worktreeBaseBranch,
      worktreeFromOrigin: task.worktreeFromOrigin,
      setupCommand: task.setupCommand,
    },
  }
}
export function terminalsRoute(request: IncomingMessage, path: string, token: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && (path === '/api/terminals' || path === '/api/terminals/ensure')) {
        const { taskId, checkoutId } = decode(
          mutableStruct({
            taskId: idSchema,
            checkoutId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        const task = yield* runtimeOperation(() => s.store.task(taskId))
        const repo = yield* runtimeOperation(() =>
          s.store.get().repositories.find((r) => r.id === task.repositoryId),
        )
        if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
        const checkout = terminalCheckout(s.store, taskId, checkoutId)
        const authorize = () => {
          s.devices.authenticate(token)
          if (!isDeepStrictEqual(checkout, terminalCheckout(s.store, taskId, checkoutId)))
            throw new HttpError(409, 'The working directory changed. Reopen the terminal.')
        }
        if (path === '/api/terminals/ensure')
          return yield* runtimeOperation(() =>
            s.terminals.ensure(
              taskId,
              () => s.checkouts.selectedDirectory(taskId, checkoutId),
              checkoutId,
              authorize,
            ),
          )
        const cwd = yield* runtimeOperation(() => s.checkouts.selectedDirectory(taskId, checkoutId))
        return yield* runtimeOperation(() => {
          authorize()
          return s.terminals.create(taskId, cwd, checkoutId)
        })
      }
      if (method === 'POST' && path === '/api/terminals/run') {
        // Chat code blocks reuse an open terminal. Agent tools request a fresh one so a
        // foreground program in the user's terminal never receives a shell command as input.
        const { taskId, command, newTerminal, checkoutId } = decode(
          mutableStruct({
            taskId: idSchema,
            checkoutId: Schema.optional(idSchema),
            command: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 20000),
            newTerminal: Schema.optional(Schema.Boolean),
          }),
          yield* serviceResult(body(request)),
        )
        const task = yield* runtimeOperation(() => s.store.task(taskId))
        const repo = yield* runtimeOperation(() =>
          s.store.get().repositories.find((r) => r.id === task.repositoryId),
        )
        if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
        const checkout = terminalCheckout(s.store, taskId, checkoutId)
        const authorize = () => {
          s.devices.authenticate(token)
          if (!isDeepStrictEqual(checkout, terminalCheckout(s.store, taskId, checkoutId)))
            throw new HttpError(409, 'The working directory changed. Reopen the terminal.')
        }
        if (checkoutId) {
          const link = (yield* runtimeOperation(() => s.checkouts.linked.resolve(taskId))).find(
            (item) => item.id === checkoutId,
          )
          if (!link || link.access !== 'edit')
            throw new HttpError(403, 'Choose an editable linked checkout for terminal commands')
        }
        const open = newTerminal
          ? undefined
          : yield* runtimeOperation(() =>
              s.terminals
                .list()
                .find(
                  (terminal) =>
                    terminal.taskId === taskId &&
                    terminal.checkoutId === checkoutId &&
                    !terminal.exited,
                ),
            )
        const terminal =
          open ??
          (yield* runtimeOperation(async () => {
            const cwd = await s.checkouts.selectedDirectory(taskId, checkoutId)
            authorize()
            return s.terminals.create(taskId, cwd, checkoutId)
          }))
        yield* runtimeOperation(() => {
          authorize()
          s.terminals.input(terminal.id, `${command.replace(/\r?\n/g, '\r')}\r`)
        })
        yield* runtimeOperation(() =>
          s.activity.add(
            'terminal',
            terminal.id,
            newTerminal ? 'Command run from agent' : 'Command run from chat',
            {
              taskId,
              characters: command.length,
            },
          ),
        )
        return terminal
      }
      if (method === 'POST' && path === '/api/terminals/close') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        yield* runtimeOperation(() => s.terminals.close(id))
        return { ok: true }
      }
      if (method === 'POST' && path === '/api/terminals/ticket') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        yield* runtimeOperation(() => s.terminals.get(id))
        return { ticket: yield* runtimeOperation(() => s.tickets.issue(token, id)) }
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
