import { routeProgram, serviceResult } from '../support/effect.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../../services.js'
import { HttpError, runtimeOperation } from '../../errors.js'
import { body } from '../support/body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
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
        if (path === '/api/terminals/ensure')
          return yield* runtimeOperation(() =>
            s.terminals.ensure(
              taskId,
              () => s.checkouts.selectedDirectory(taskId, checkoutId),
              checkoutId,
            ),
          )
        const cwd = yield* runtimeOperation(() => s.checkouts.selectedDirectory(taskId, checkoutId))
        return yield* runtimeOperation(() => s.terminals.create(taskId, cwd, checkoutId))
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
          (yield* runtimeOperation(async () =>
            s.terminals.create(
              taskId,
              await s.checkouts.selectedDirectory(taskId, checkoutId),
              checkoutId,
            ),
          ))
        yield* runtimeOperation(() =>
          s.terminals.input(terminal.id, `${command.replace(/\r?\n/g, '\r')}\r`),
        )
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
