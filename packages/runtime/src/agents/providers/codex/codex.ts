import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { codexMcpServers } from '../../configuration/mcp-settings.js'
import { isImageAttachment, serviceTierValue } from '@dovo/protocol'
import { supportsCodexDaybreak } from '../../configuration/codex-modes.js'
import { codexModels } from '../../catalogs/codex.js'
import { codexQuestions, codexAsyncQuestions } from './codex-questions.js'
import { formQuestions } from '../shared/form-questions.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { releaseIdleProvider } from '../../execution/warm-processes.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { Schema } from 'effect'
import type { AgentAdapter, AgentInput } from '../../execution/types.js'
import { executableAvailable, processEnvironment } from '../../../process.js'
import { JsonLineReader, JsonLineWriter } from './codex-transport.js'
const turnInput = (input: Pick<AgentInput, 'prompt' | 'attachments'>) => [
  {
    type: 'text',
    text: input.prompt,
    text_elements: [],
  },
  ...(input.attachments ?? []).filter(isImageAttachment).map((file) => ({
    type: 'localImage',
    path: file.path,
  })),
]
const object = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
)
type CodexConnection = {
  child: ChildProcess
  rpc: ReturnType<typeof createMessageConnection>
  sessionId: string
  endpoint: string
  launchConfig: string
  cwd: string
  initialized: unknown
  stderr: string
}
export function createCodexAdapter(): AgentAdapter {
  const idle = new Map<string, CodexConnection>()
  const close = async (connection: CodexConnection) => {
    connection.rpc.dispose()
    await stopOwnedChild(connection.child)
  }
  return {
    models: codexModels,
    probe: async (agent) => ({
      provider: 'codex',
      available: await executableAvailable(agent.endpoint || 'codex'),
      detail: 'Codex app-server executable; authentication uses the host’s Codex login.',
    }),
    async run(run) {
      run.signal.throwIfAborted()
      const endpoint = run.agent.endpoint || 'codex'
      const mcpServers =
        run.tools !== 'none' && run.agent.resources?.mcpServers.length
          ? codexMcpServers(run.agent.resources.mcpServers)
          : undefined
      // Resuming a loaded Codex thread retains its MCP connections. Restart on binding
      // changes so follow-up turns cannot keep the previous Dovo parent attempt.
      const launchConfig = JSON.stringify([run.agent.args, run.agent.env, mcpServers])
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      const reusable =
        previous &&
        previous.sessionId === run.sessionId &&
        previous.endpoint === endpoint &&
        previous.launchConfig === launchConfig &&
        previous.cwd === run.cwd &&
        previous.child.exitCode === null &&
        !run.signal.aborted
          ? previous
          : undefined
      if (previous && !reusable) await close(previous)
      const child =
        reusable?.child ??
        spawn(endpoint, ['app-server', '--listen', 'stdio://', ...(run.agent.args ?? [])], {
          windowsHide: true,
          cwd: run.cwd,
          detached: process.platform !== 'win32',
          env: processEnvironment(run.agent.env),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      if (!child.stdout || !child.stdin || !child.stderr)
        throw new Error('Codex stdio pipes are unavailable')
      if (!reusable) child.on('error', (error) => console.error('Codex process failed:', error))
      const rpc =
        reusable?.rpc ??
        createMessageConnection(new JsonLineReader(child.stdout), new JsonLineWriter(child.stdin))
      const transport: CodexConnection = reusable ?? {
        child,
        rpc,
        sessionId: '',
        endpoint,
        launchConfig,
        cwd: run.cwd,
        initialized: undefined,
        stderr: '',
      }
      if (!reusable)
        child.stderr.on('data', (data: Buffer) => {
          transport.stderr = (transport.stderr + String(data)).slice(-4000)
        })
      if (!reusable)
        child.on('exit', () => {
          for (const [taskId, connection] of idle) if (connection === transport) idle.delete(taskId)
          rpc.dispose()
        })
      const questionItems = new Set<string>()
      let threadId = run.sessionId
      let turnFinished = false
      let submitted = false
      let awaitingTurn = false
      let activeTurnId: string | undefined
      const pendingNotifications: { method: string; params: unknown }[] = []
      let pendingBytes = 0
      let admitTurn: () => void = () => {}
      const admission = new Promise<void>((resolve) => {
        admitTurn = resolve
      })
      let compacted = false
      let compactStarted = false
      let resolveTurn: () => void = () => {},
        rejectTurn: (error: Error) => void = () => {}
      const completed = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve
        rejectTurn = reject
      })
      // Attach a rejection handler immediately; the turn may fail during initialization.
      void completed.catch(() => {})
      const onExit = (code: number | null) => {
        // Report why Codex stopped before disposal rejects its pending requests generically.
        rejectTurn(new Error(`Codex exited (${code}). ${transport.stderr.trim()}`.trim()))
        rpc.dispose()
      }
      child.on('error', rejectTurn)
      child.on('exit', onExit)
      // A request races the process: if Codex dies, the turn fails with its exit reason. Its
      // pipes close just before the exit event, so briefly prefer that explanation over the
      // connection's generic "pending response rejected".
      const request = (method: string, params?: object) =>
        Promise.race([
          rpc.sendRequest(method, params),
          completed.then(() => {
            throw new Error('Codex finished before answering')
          }),
        ]).catch(async (error: unknown) => {
          throw await Promise.race([
            completed.then(
              () => error,
              (reason: unknown) => reason,
            ),
            new Promise((resolve) => setTimeout(() => resolve(error), 1000)),
          ])
        })
      const requests = rpc.onRequest(async (method, params: unknown, token) => {
        if (!run.compact) {
          const scope = decodeResult(object, params).data
          const root =
            !threadId || typeof scope?.threadId !== 'string' || scope.threadId === threadId
          const execution = method.startsWith('item/')
          if (root && execution && awaitingTurn) await Promise.race([admission, completed])
          if (
            turnFinished ||
            run.signal.aborted ||
            (root && execution && !submitted) ||
            (root &&
              activeTurnId &&
              typeof scope?.turnId === 'string' &&
              scope.turnId !== activeTurnId)
          )
            throw new Error('This Codex request belongs to a retired turn')
        }
        run.onEvent?.(method, params)
        if (
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
        ) {
          const allowed =
            run.agent.permission !== 'read-only' &&
            (await run.approve(
              method.includes('command') ? 'Run command' : 'Apply file changes',
              JSON.stringify(params, null, 2),
            ))
          return {
            decision: allowed ? 'accept' : 'decline',
          }
        }
        if (method === 'item/permissions/requestApproval')
          return {
            permissions: {},
            scope: 'turn',
          }
        if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
          const controller = new AbortController()
          const cancellation = token.onCancellationRequested(() => controller.abort())
          if (token.isCancellationRequested) controller.abort()
          try {
            if (method === 'item/tool/requestUserInput')
              return await codexQuestions(params, run, controller.signal)
            const form = decodeResult(
              mutableStruct({
                mode: Schema.Literal('form'),
                message: Schema.String,
                requestedSchema: Schema.Unknown,
              }),
              params,
            )
            if (!form.success) {
              run.onActivity('This Codex MCP input request is not a supported form')
              return {
                action: 'cancel',
                content: null,
                _meta: null,
              }
            }
            const content = await formQuestions(
              form.data.message,
              form.data.requestedSchema,
              run,
              controller.signal,
            )
            return {
              action: content ? 'accept' : 'decline',
              content,
              _meta: null,
            }
          } finally {
            cancellation.dispose()
          }
        }
        throw new Error(`Unsupported Codex request: ${method}`)
      })
      const consumeNotification = (method: string, params: unknown) => {
        const execution = method.startsWith('turn/') || method.startsWith('item/')
        if (!run.compact && execution) {
          if (!submitted || turnFinished) return
          if (awaitingTurn) {
            pendingBytes += JSON.stringify(params)?.length ?? 0
            if (pendingNotifications.length >= 256 || pendingBytes > 1024 * 1024) {
              rejectTurn(
                new Error('Codex did not identify its turn before sending excessive events'),
              )
              return
            }
            pendingNotifications.push({ method, params })
            return
          }
        }
        const value = decodeResult(object, params)
        if (!value.success) return
        const nestedTurn = decodeResult(object, value.data.turn).data
        const nativeTurn =
          typeof value.data.turnId === 'string'
            ? value.data.turnId
            : typeof nestedTurn?.id === 'string'
              ? nestedTurn.id
              : undefined
        const root =
          !threadId || typeof value.data.threadId !== 'string' || value.data.threadId === threadId
        if (!run.compact && root && activeTurnId && nativeTurn && nativeTurn !== activeTurnId)
          return
        run.onEvent?.(method, params)
        // Child notifications feed the Agents panel, never the parent transcript or completion.
        if (threadId && typeof value.data.threadId === 'string' && value.data.threadId !== threadId)
          return
        if (method === 'turn/started' || method === 'turn/completed' || method === 'item/started')
          run.onPromptAccepted?.()
        if (method === 'item/agentMessage/delta' && typeof value.data.delta === 'string')
          run.onText(value.data.delta)
        if (method === 'item/completed') {
          const item = decodeResult(object, value.data.item)
          if (item.success && item.data.type === 'agentMessage') run.onTextBoundary?.()
        }
        if ((method === 'item/started' || method === 'item/completed') && run.onQuestions) {
          const form = codexAsyncQuestions(value.data.item)
          if (form && !questionItems.has(form.id)) {
            questionItems.add(form.id)
            run.onQuestions(form.prompt)
          }
        }
        if (method === 'item/started') {
          const item = decodeResult(object, value.data.item)
          if (item.success && typeof item.data.type === 'string') run.onActivity(item.data.type)
        }
        if (run.compact && method === 'item/completed') {
          const item = decodeResult(object, value.data.item)
          if (item.success && item.data.type === 'contextCompaction') {
            compacted = true
            if (compactStarted) resolveTurn()
          }
        }
        if (method === 'turn/completed') {
          turnFinished = true
          run.onSteer?.(undefined)
          const turn = decodeResult(
            mutableStruct({
              status: Schema.String,
              error: Schema.optional(
                Schema.NullOr(
                  mutableStruct({
                    message: Schema.String,
                  }),
                ),
              ),
            }),
            value.data.turn,
          )
          // An unreadable completion must still settle the turn, or the task runs until its limit.
          if (!turn.success) rejectTurn(new Error('Codex sent an unreadable turn/completed event'))
          else if (turn.data.status === 'completed') {
            if (!run.compact || (compacted && compactStarted)) resolveTurn()
          } else rejectTurn(new Error(turn.data.error?.message ?? `Turn ${turn.data.status}`))
        }
      }
      const notifications = rpc.onNotification(consumeNotification)
      const abort = () => {
        void stopOwnedChild(child)
        rejectTurn(new Error('Task cancelled'))
      }
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      const timeout = setTimeout(() => {
        void stopOwnedChild(child)
        rejectTurn(new Error('Codex initialization timed out'))
      }, 30000)
      if (!reusable) rpc.listen()
      let succeeded = false
      let initialized: unknown = reusable?.initialized
      try {
        if (run.signal.aborted) throw new Error('Task cancelled')
        if (!reusable)
          initialized = await request('initialize', {
            clientInfo: {
              name: 'dovo_studio',
              title: 'Dovo Studio',
              version: '0.1.0',
            },
            // Structured request_user_input is part of the experimental app-server surface.
            capabilities: {
              experimentalApi: true,
            },
          })
        if (!reusable) await rpc.sendNotification('initialized', {})
        try {
          run.onEvent?.('account/read', await request('account/read', { refreshToken: false }))
        } catch {
          // Account metadata is optional on older app servers.
        }
        try {
          run.onEvent?.('account/rateLimits/read', await request('account/rateLimits/read', {}))
        } catch {
          // Older app servers may not expose account limits.
        }
        const program = run.tools === 'none' ? undefined : run.agent.cyberAccessProgram
        if (program && !supportsCodexDaybreak(initialized))
          throw new Error(
            'Daybreak mode requires Codex 0.155.1 or newer. Update the harness or choose Automatic.',
          )
        const tier = serviceTierValue(run.agent.serviceTier)
        const config = {
          ...(run.linkedDirectories?.some((item) => item.access === 'edit')
            ? {
                'sandbox_workspace_write.writable_roots': [
                  run.cwd,
                  ...run.linkedDirectories
                    .filter((item) => item.access === 'edit')
                    .map((item) => item.path),
                ],
              }
            : {}),
          ...(['priority', 'fast'].includes(tier)
            ? {
                'features.fast_mode': true,
              }
            : {}),
          ...(run.tools === 'none'
            ? {
                'features.shell_tool': false,
                web_search: 'disabled',
              }
            : mcpServers
              ? {
                  mcp_servers: mcpServers,
                }
              : {}),
        }
        const response = await request(run.sessionId ? 'thread/resume' : 'thread/start', {
          ...(run.sessionId
            ? {
                threadId: run.sessionId,
              }
            : {}),
          cwd: run.cwd,
          ...(run.agent.model
            ? {
                model: run.agent.model,
              }
            : {}),
          serviceTier: tier,
          ...(Object.keys(config).length
            ? {
                config,
              }
            : {}),
          ...(run.ephemeral || run.tools === 'none'
            ? {
                ephemeral: true,
              }
            : {}),
          developerInstructions: run.agent.instructions,
          approvalPolicy: ['read-only', 'full-access'].includes(run.agent.permission)
            ? 'never'
            : 'on-request',
          approvalsReviewer: run.agent.permission === 'auto' ? 'auto_review' : 'user',
          sandbox:
            run.agent.permission === 'full-access'
              ? 'danger-full-access'
              : ['workspace-write', 'auto'].includes(run.agent.permission)
                ? 'workspace-write'
                : 'read-only',
        })
        if (
          run.agent.permission === 'auto' &&
          !decodeResult(
            mutableStruct({
              approvalsReviewer: Schema.Literal('auto_review', 'guardian_subagent'),
            }),
            response,
          ).success
        )
          throw new Error(
            'This Codex harness did not enable automatic approval review. Update the harness or choose another access mode.',
          )
        if (
          run.agent.permission === 'full-access' &&
          !decodeResult(
            mutableStruct({
              approvalPolicy: Schema.Literal('never'),
              sandbox: mutableStruct({
                type: Schema.Literal('dangerFullAccess'),
              }),
            }),
            response,
          ).success
        )
          throw new Error(
            'This Codex harness did not grant full access. Check its policy or choose another access mode.',
          )
        const thread = decode(
          mutableStruct({
            thread: mutableStruct({
              id: Schema.String,
              daybreakEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
            }),
          }),
          response,
        ).thread
        threadId = thread.id
        run.onSession(thread.id)
        if (
          run.tools !== 'none' &&
          (program || (supportsCodexDaybreak(initialized) && thread.daybreakEnabled === true))
        )
          await request('thread/metadata/update', {
            threadId: thread.id,
            daybreakEnabled: !!program && program !== 'standard',
          })
        clearTimeout(timeout)
        if (run.compact) {
          await request('thread/compact/start', { threadId: thread.id })
          compactStarted = true
          run.onPromptAccepted?.()
          if (compacted) resolveTurn()
          let confirmationTimeout: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              completed,
              new Promise<never>((_, reject) => {
                confirmationTimeout = setTimeout(
                  () => reject(new Error('Codex did not confirm compaction')),
                  60000,
                )
              }),
            ])
          } finally {
            clearTimeout(confirmationTimeout)
          }
          succeeded = true
          return
        }
        submitted = true
        awaitingTurn = true
        const started = await request('turn/start', {
          threadId: thread.id,
          ...(run.agent.reasoning
            ? {
                effort: run.agent.reasoning,
              }
            : {}),
          serviceTier: tier,
          ...(program
            ? {
                cyberAccessProgram: program,
              }
            : {}),
          input: turnInput(run),
        })
        run.onPromptAccepted?.()
        const turn = decodeResult(
          mutableStruct({
            turn: mutableStruct({
              id: Schema.String,
              status: Schema.String,
            }),
          }),
          started,
        )
        activeTurnId = turn.success ? turn.data.turn.id : undefined
        awaitingTurn = false
        admitTurn()
        // Admit requests received before the start acknowledgement before replaying terminal events.
        // Cancelled questions still return their protocol-level empty answer below.
        await Promise.resolve()
        for (const event of pendingNotifications.splice(0))
          consumeNotification(event.method, event.params)
        pendingBytes = 0
        if (!turnFinished && turn.success && turn.data.turn.status === 'inProgress') {
          const expectedTurnId = turn.data.turn.id
          run.onSteer?.(async (input) => {
            run.signal.throwIfAborted()
            await rpc.sendRequest('turn/steer', {
              threadId: thread.id,
              expectedTurnId,
              clientUserMessageId: input.id,
              input: turnInput(input),
            })
          })
        }
        await completed
        succeeded = true
      } finally {
        run.onSteer?.(undefined)
        clearTimeout(timeout)
        run.signal.removeEventListener('abort', abort)
        requests.dispose()
        notifications.dispose()
        child.off('error', rejectTurn)
        child.off('exit', onExit)
        if (succeeded && run.taskId && run.tools !== 'none' && threadId && !run.signal.aborted) {
          transport.sessionId = threadId
          transport.initialized = initialized
          idle.set(run.taskId, transport)
          // Keep active threads warm; shed only idle processes when the server is under pressure.
          if (releaseIdleProvider()) {
            const oldest = idle.keys().next().value
            if (oldest) {
              const stale = idle.get(oldest)
              idle.delete(oldest)
              if (stale)
                await close(stale).catch((error) =>
                  console.error('Could not release idle Codex process:', error),
                )
            }
          }
        } else await close(transport)
      }
    },
    dispose: async () => {
      const connections = [...idle.values()]
      idle.clear()
      await Promise.all(connections.map(close))
    },
  }
}
export const codexAdapter = createCodexAdapter()
