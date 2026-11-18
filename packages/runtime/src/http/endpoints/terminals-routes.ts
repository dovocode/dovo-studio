import { prepareThreadTerminal } from '../../sandbox/thread-terminal.js'
import { checkCodeAccess } from '../../agent-tools/code-access.js'
import { effectivePermissionPolicy } from '@dovo/protocol'
import { isAbsolute, relative } from 'node:path'
import { stat } from 'node:fs/promises'
import { repositoryPath, safeFile } from '../../scm/repositories/paths.js'
import { verifiedGitUpdates } from '../../scm/tasks/external-git-updates.js'
import { isRunToken } from '../../auth/run-credentials.js'
import { authenticateRuntimeOperation } from '../../auth/run-authorization.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { mutableStruct, threadServerRequestSchema, stopThreadServerSchema } from '@dovo/protocol'
import {
  STUDIO_TERMINAL_SCOPE,
  SCRATCH_PROJECT_ID,
  updateTerminalSchema,
  createWorkspaceTerminalSchema,
  terminalShellsResponseSchema,
  terminalTitleSchema,
  type TerminalInfo,
} from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { isDeepStrictEqual } from 'node:util'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError, errorMessage, runtimeOperation } from '../../errors.js'
import { body } from '../support/body.js'
import { quoteTerminalPaths } from '../../terminal/file-paths.js'
import { resolveTerminalShell, terminalShells } from '../../terminal/shell.js'
import { workspaceTerminalCheckout } from '../../terminal/workspace-checkout.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
const waitTime = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20000 })))
function terminalSummary(
  request: IncomingMessage,
  read: (
    signal: AbortSignal,
  ) => ReturnType<import('../../terminal/terminals.js').Terminals['checkSummary']>,
) {
  const controller = new AbortController()
  const abort = () => controller.abort(new HttpError(409, 'Terminal summary request cancelled'))
  if (request.socket.destroyed) abort()
  request.socket.once('close', abort)
  return read(controller.signal).finally(() => request.socket.off('close', abort))
}
function terminalCheckout(store: WorkspaceStore, taskId: string, checkoutId?: string) {
  const seen = new Set<string>()
  let task = store.taskSummary(taskId)
  let selected = checkoutId
  while (true) {
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore the thread before opening a terminal')
    if (seen.has(task.id)) throw new HttpError(409, 'Invalid inherited checkout')
    seen.add(task.id)
    if (!task.delegation) break
    selected ??= task.delegation.checkoutId
    task = store.taskSummary(task.delegation.parentTaskId)
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
      if (method === 'POST' && path === '/api/terminals/shells') {
        s.devices.authenticate(token)
        const shells = yield* runtimeOperation(() => terminalShells(s.commands.get()))
        s.devices.authenticate(token)
        return decode(terminalShellsResponseSchema, { shells })
      }
      if (method === 'POST' && path === '/api/terminals/update') {
        const input = decode(updateTerminalSchema, yield* serviceResult(body(request)))
        return yield* runtimeOperation(() => {
          authenticateRuntimeOperation(s, token)
          return s.terminals.update(input)
        })
      }
      if (method === 'POST' && path === '/api/terminals/workspace') {
        s.devices.authenticate(token)
        const input = decode(createWorkspaceTerminalSchema, yield* serviceResult(body(request)))
        const { repositoryId, command, sourceTerminalId } = input
        if (sourceTerminalId) {
          if (
            repositoryId ||
            input.shellId ||
            input.execution ||
            input.existingWorktreePath ||
            input.worktreeBaseBranch
          )
            throw new HttpError(400, 'A split inherits its source terminal settings')
          return yield* runtimeOperation(() => {
            s.devices.authenticate(token)
            const source = s.terminals.get(sourceTerminalId)
            if (source.info.taskId !== STUDIO_TERMINAL_SCOPE)
              throw new HttpError(400, 'Choose a standalone source terminal')
            const session = s.terminals.createCommand(
              STUDIO_TERMINAL_SCOPE,
              source.directory,
              source.launch,
              `Terminal ${s.terminals.list().length + 1}`,
              undefined,
              source.info.repositoryId,
              {
                directory: source.directory,
                shellId: source.info.shellId,
                execution: source.info.execution,
                checkoutBranch: source.info.checkoutBranch,
                rememberSession: Boolean(source.recovery),
              },
            )
            if (command) s.terminals.input(session.id, `${command.replace(/\r?\n/g, '\r')}\r`)
            return session
          })
        }
        const repository = repositoryId
          ? s.store.get().repositories.find((item) => item.id === repositoryId)
          : undefined
        if (repositoryId && repositoryId !== SCRATCH_PROJECT_ID && !repository)
          throw new HttpError(404, 'Project not found')
        const authorize = () => {
          s.devices.authenticate(token)
          if (
            repository &&
            !isDeepStrictEqual(
              repository,
              s.store.get().repositories.find((item) => item.id === repositoryId),
            )
          )
            throw new HttpError(409, 'The project changed. Reopen the terminal.')
        }
        authorize()
        const shell = yield* runtimeOperation(() =>
          resolveTerminalShell(s.commands.get(), input.shellId),
        )
        authorize()
        s.terminals.checkCapacity()
        const checkout = yield* runtimeOperation(() =>
          workspaceTerminalCheckout(s, input, authorize),
        )
        return yield* runtimeOperation(() => {
          authorize()
          let session: TerminalInfo
          try {
            session = s.terminals.createCommand(
              STUDIO_TERMINAL_SCOPE,
              checkout.directory,
              shell,
              `Terminal ${s.terminals.list().length + 1}`,
              undefined,
              checkout.repositoryId,
              { ...checkout, shellId: shell.id, rememberSession: input.rememberSession },
            )
          } catch (error) {
            if (checkout.execution !== 'worktree' || input.existingWorktreePath) throw error
            const message = `${errorMessage(error)}\nWorktree kept at ${checkout.directory}`
            if (error instanceof HttpError) throw new HttpError(error.status, message, error)
            throw new Error(message, { cause: error })
          }
          if (command) s.terminals.input(session.id, `${command.replace(/\r?\n/g, '\r')}\r`)
          return session
        })
      }
      if (
        method === 'POST' &&
        (path === '/api/terminals/servers' || path === '/api/terminals/servers/stop')
      ) {
        const input = yield* serviceResult(body(request))
        const { taskId } = decode(threadServerRequestSchema, input)
        const authorize = () => {
          authenticateRuntimeOperation(s, token)
          const task = s.store.taskSummary(taskId)
          if (task.archived || task.archivedAt)
            throw new HttpError(409, 'Restore the thread before managing its servers')
        }
        authorize()
        if (path.endsWith('/stop')) {
          const stop = decode(stopThreadServerSchema, input)
          return yield* runtimeOperation(() => s.threadServers.stop(stop, authorize))
        }
        return yield* runtimeOperation(() => s.threadServers.list(taskId))
      }
      if (method === 'POST' && (path === '/api/terminals' || path === '/api/terminals/ensure')) {
        const { taskId, checkoutId } = decode(
          mutableStruct({
            taskId: idSchema,
            checkoutId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        const task = yield* runtimeOperation(() => s.store.taskSummary(taskId))
        const repo = yield* runtimeOperation(() =>
          s.store.get().repositories.find((r) => r.id === task.repositoryId),
        )
        if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
        const checkout = terminalCheckout(s.store, taskId, checkoutId)
        const authorize = () => {
          authenticateRuntimeOperation(s, token)
          if (!isDeepStrictEqual(checkout, terminalCheckout(s.store, taskId, checkoutId)))
            throw new HttpError(409, 'The working directory changed. Reopen the terminal.')
        }
        if (path === '/api/terminals/ensure')
          return yield* runtimeOperation(() =>
            s.terminals.ensure(
              taskId,
              async () => {
                const cwd = await s.checkouts.selectedDirectory(taskId, checkoutId)
                await prepareThreadTerminal(s, taskId, cwd)
                return cwd
              },
              checkoutId,
              authorize,
            ),
          )
        const cwd = yield* runtimeOperation(() => s.checkouts.selectedDirectory(taskId, checkoutId))
        yield* runtimeOperation(() => prepareThreadTerminal(s, taskId, cwd))
        return yield* runtimeOperation(() => {
          authorize()
          return s.terminals.create(taskId, cwd, checkoutId)
        })
      }
      if (method === 'POST' && path === '/api/terminals/summary') {
        const { id, waitMs } = decode(
          mutableStruct({ id: idSchema, waitMs: waitTime }),
          yield* serviceResult(body(request)),
        )
        return yield* runtimeOperation(async () => {
          authenticateRuntimeOperation(s, token)
          const result = await terminalSummary(request, (signal) =>
            s.terminals.checkSummary(id, waitMs ?? 0, signal),
          )
          authenticateRuntimeOperation(s, token)
          return result
        })
      }
      if (method === 'POST' && path === '/api/terminals/run') {
        // Chat code blocks reuse an open terminal. Agent tools request a fresh one so a
        // foreground program in the user's terminal never receives a shell command as input.
        const { taskId, command, newTerminal, checkoutId, title, codeMode, check, waitMs } = decode(
          mutableStruct({
            taskId: idSchema,
            checkoutId: Schema.optional(idSchema),
            command: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
            newTerminal: Schema.optional(Schema.Boolean),
            codeMode: Schema.optional(Schema.Boolean),
            title: Schema.optional(terminalTitleSchema),
            check: Schema.optional(Schema.Boolean),
            waitMs: waitTime,
          }),
          yield* serviceResult(body(request)),
        )
        if ((check && !newTerminal) || (waitMs !== undefined && !check))
          throw new HttpError(400, 'A command check uses a new terminal')
        const task = yield* runtimeOperation(() => s.store.taskSummary(taskId))
        const repo = yield* runtimeOperation(() =>
          s.store.get().repositories.find((r) => r.id === task.repositoryId),
        )
        if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
        const checkout = terminalCheckout(s.store, taskId, checkoutId)
        const grant = codeMode ? s.runCredentials.authenticate(token) : undefined
        const authorize = () => {
          authenticateRuntimeOperation(s, token)
          if (grant) {
            if (request.socket.destroyed) throw new HttpError(409, 'Code mode call cancelled')
            const captured = checkCodeAccess(s.store, grant)
            if (
              checkoutId &&
              !captured.linked.some(
                (link) =>
                  link.id === checkoutId &&
                  link.access === 'edit' &&
                  link.repositoryId === checkout.repositoryId,
              )
            )
              throw new HttpError(403, 'Linked checkout is outside this run snapshot')
          }
          if (!isDeepStrictEqual(checkout, terminalCheckout(s.store, taskId, checkoutId)))
            throw new HttpError(409, 'The working directory changed. Reopen the terminal.')
        }
        if (grant) {
          authorize()
          if (effectivePermissionPolicy(grant.permissions).approvalPolicy !== 'never') {
            const decision = yield* runtimeOperation(async () => {
              const controller = new AbortController()
              const abort = () => controller.abort()
              request.socket.once('close', abort)
              try {
                const signal = AbortSignal.any([grant.signal, controller.signal])
                signal.throwIfAborted()
                const result = await s.approvals.request(
                  taskId,
                  'Code mode terminal command',
                  JSON.stringify({ command, checkoutId }),
                  signal,
                )
                signal.throwIfAborted()
                return result
              } finally {
                request.socket.off('close', abort)
              }
            })
            if (decision === 'deny') throw new HttpError(403, 'Terminal command declined')
          }
          authorize()
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
        let terminal =
          open ??
          (yield* runtimeOperation(async () => {
            const cwd = await s.checkouts.selectedDirectory(taskId, checkoutId)
            if (grant) {
              const captured = checkCodeAccess(s.store, grant)
              const expected = checkoutId
                ? captured.linked.find((link) => link.id === checkoutId)?.path
                : captured.cwd
              if (cwd !== expected)
                throw new HttpError(409, 'Code mode working directory changed. Start a new turn.')
            }
            await prepareThreadTerminal(s, taskId, cwd)
            authorize()
            return check
              ? s.terminals.createCheck(taskId, cwd, command, title, checkoutId)
              : s.terminals.create(taskId, cwd, checkoutId)
          }))
        if (title !== undefined && !check)
          terminal = yield* runtimeOperation(() => {
            authorize()
            return s.terminals.update({ id: terminal.id, title })
          })
        if (!check)
          yield* runtimeOperation(() => {
            authorize()
            s.terminals.input(terminal.id, `${command.replace(/\r?\n/g, '\r')}\r`)
          })
        if (newTerminal) {
          const current = s.store.task(taskId)
          const turn = [...(current.turns ?? [])]
            .reverse()
            .find((entry) => entry.status === 'running')
          const message = turn
            ? [...current.messages]
                .reverse()
                .find(
                  (entry) =>
                    entry.role === 'assistant' &&
                    (entry.id === turn.assistantId || entry.turnId === turn.id),
                )
            : undefined
          const record = (
            status: 'running' | 'completed' | 'failed',
            output: string,
            exitCode?: number,
          ) =>
            s.activity.add('tool', taskId, 'Terminal command', {
              turnId: turn?.id ?? '',
              ...(message ? { messageId: message.id, textOffset: message.text.length } : {}),
              toolId: `terminal:${terminal.id}`,
              status,
              exitCode,
              terminalCommand: true,
              presentation: {
                kind: 'command',
                title: command,
                input: command,
                output,
              },
            })
          yield* runtimeOperation(() => {
            record(check ? 'running' : 'completed', 'Started in terminal.')
            if (check) {
              const owner = isRunToken(token) ? s.runCredentials.authenticate(token) : undefined
              const cwd = s.terminals.get(terminal.id).directory
              s.terminals.onCheckExit(terminal.id, (exitCode, tail) => {
                record(exitCode === 0 ? 'completed' : 'failed', tail, exitCode)
                if (
                  exitCode !== 0 ||
                  !owner ||
                  owner.readOnly ||
                  owner.signal.aborted ||
                  owner.taskId !== taskId ||
                  !owner.pullRequestWatching ||
                  !s.preferences.get().enablePullRequestBabysitting
                )
                  return
                void verifiedGitUpdates(s.git, owner.runId, cwd, {
                  id: terminal.id,
                  name: 'terminal_run',
                  kind: 'command',
                  status: 'completed',
                  input: command,
                  output: tail,
                })
                  .then((receipts) => {
                    if (owner.signal.aborted || !s.preferences.get().enablePullRequestBabysitting)
                      return
                    s.store.saveExternalGitReceipts(
                      taskId,
                      receipts.filter(
                        (receipt) =>
                          !owner.codeDirectories?.linked.some(
                            (link) => link.access === 'read-only' && link.path === receipt.cwd,
                          ),
                      ),
                    )
                  })
                  .catch((error: unknown) => {
                    if (owner.signal.aborted) return
                    s.activity.add(
                      'task',
                      taskId,
                      `Could not verify terminal Git update: ${errorMessage(error)}`,
                    )
                  })
              })
            }
          })
        }
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
        if (isRunToken(token)) s.runCredentials.addTerminal(token, terminal.id)
        if (check)
          return yield* runtimeOperation(async () => {
            const result = await terminalSummary(request, (signal) =>
              s.terminals.checkSummary(terminal.id, waitMs ?? 10000, signal),
            )
            authenticateRuntimeOperation(s, token)
            return result
          })
        return terminal
      }
      if (method === 'POST' && path === '/api/terminals/quote-paths') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            paths: Schema.Array(maxValue(minValue(Schema.String, 1), 32768)).pipe(
              Schema.check(Schema.isMinLength(1)),
              Schema.check(Schema.isMaxLength(100)),
            ),
          }),
          yield* serviceResult(body(request)),
        )
        const session = s.terminals.get(input.id)
        if (session.info.exited) throw new HttpError(409, 'The terminal has exited.')
        return { text: quoteTerminalPaths(input.paths, session.command) }
      }
      if (method === 'POST' && path === '/api/terminals/file') {
        const input = decode(
          mutableStruct({ id: idSchema, path: maxValue(minValue(Schema.String, 1), 4000) }),
          yield* serviceResult(body(request)),
        )
        const session = s.terminals.get(input.id)
        terminalCheckout(s.store, session.info.taskId, session.info.checkoutId)
        const root = yield* serviceResult(
          repositoryPath(
            yield* serviceResult(
              s.checkouts.selectedDirectory(session.info.taskId, session.info.checkoutId),
            ),
          ),
        )
        const original = yield* serviceResult(repositoryPath(session.directory))
        if (root !== original)
          throw new HttpError(409, 'The working directory changed. Reopen the terminal.')
        const path = isAbsolute(input.path) ? relative(root, input.path) : input.path
        const filename = yield* serviceResult(safeFile(root, path))
        const details = yield* serviceResult(stat(filename))
        if (!details.isFile()) throw new HttpError(400, 'Choose a regular file')
        return {
          taskId: session.info.taskId,
          checkoutId: session.info.checkoutId,
          path: relative(root, filename).replaceAll('\\', '/'),
        }
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
