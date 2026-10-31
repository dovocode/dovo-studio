import { effectivePermissionPolicy } from '@dovo/protocol'
import { checkedPolicyRun } from '../shared/permission-policy.js'
import { mutableStruct, nativeAgentWorking, type Subagent } from '@dovo/protocol'
import { updateSubagents } from '../../execution/subagents.js'
import { decodeResult, decode } from '@dovo/protocol'
import { codexMcpServers } from '../../configuration/mcp-settings.js'
import { isImageAttachment, serviceTierValue } from '@dovo/protocol'
import {
  supportsCodexDaybreak,
  supportsCodexInstantInterrupt,
  supportsCodexNativeAgents,
} from '../../configuration/codex-modes.js'
import { codexAuthenticated, codexModels } from '../../catalogs/codex.js'
import { codexQuestions, codexAsyncQuestions } from './codex-questions.js'
import { formQuestions } from '../shared/form-questions.js'
import { OwnedProcessShutdownError, stopOwnedChild } from '../../execution/stop-owned-child.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { Schema } from 'effect'
import type { AgentAdapter, AgentInput, AgentRun } from '../../execution/types.js'
import { processEnvironment } from '../../../process.js'
import { JsonLineReader, JsonLineWriter } from './codex-transport.js'
import { codexThreadEntries } from '../../execution/native-thread.js'
import { readCodexThread } from './codex-thread.js'
import { nativeWait } from '../shared/native.js'
import { isContextRejection } from '../../execution/handover.js'
import { codexRateLimitUpdates } from './codex-rate-limits.js'
import { CUA_SERVER_NAME } from '../../../computer-use/cua.js'
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
const object = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
type CodexConnection = {
  child: ChildProcess
  rpc: ReturnType<typeof createMessageConnection>
  sessionId: string
  endpoint: string
  launchConfig: string
  cwd: string
  initialized: unknown
  rateLimitUpdates: ReturnType<typeof codexRateLimitUpdates>
  stderr: string
  onSubagentEvent?: AgentRun['onSubagentEvent']
  nativeAgents: Subagent[]
  lifetime: AbortController
  requests?: { dispose: () => void }
  closing?: Promise<void>
  transportError?: Error
  transportTimer?: ReturnType<typeof setTimeout>
  rejectTransport?: (error: Error) => void
  consumeNotification?: (method: string, params: unknown) => void
}
export function createCodexAdapter(): AgentAdapter {
  const idle = new IdleProviders<CodexConnection>(
    (connection) => close(connection),
    (connection) => connection.nativeAgents.some(nativeAgentWorking),
  )
  const close = (connection: CodexConnection): Promise<void> => {
    if (connection.closing) return connection.closing
    const finish = () => {
      connection.onSubagentEvent?.('dovo/session/closed', {}, connection.sessionId)
      connection.onSubagentEvent = undefined
    }
    connection.closing = (async () => {
      clearTimeout(connection.transportTimer)
      connection.lifetime.abort()
      connection.requests?.dispose()
      connection.rpc.dispose()
      try {
        await stopOwnedChild(connection.child)
      } catch (error) {
        if (error instanceof OwnedProcessShutdownError && error.confirmed)
          void error.confirmed
            .then(() => {
              finish()
              connection.closing = Promise.resolve()
            })
            .catch((error: unknown) =>
              console.error('Could not report a confirmed Codex shutdown:', error),
            )
        throw error
      }
      finish()
    })()
    return connection.closing
  }

  return {
    readNativeThread: (agent, id, _sessionId, cwd) => readCodexThread(agent, id, cwd),
    releaseTask: (taskId) => idle.release(taskId),
    models: codexModels,
    probe: async (agent) => ({
      provider: 'codex',
      available: await codexAuthenticated(agent),
      detail: 'Requires an authenticated Codex login or API-key login on this runtime host.',
    }),
    async run(run) {
      run = checkedPolicyRun(run, 'codex')
      const policy = effectivePermissionPolicy(run.agent, { textOnly: run.tools === 'none' })
      run.signal.throwIfAborted()
      const endpoint = run.agent.endpoint || 'codex'
      const mcpServers =
        run.tools !== 'none' && run.agent.resources?.mcpServers.length
          ? codexMcpServers(run.agent.resources.mcpServers)
          : undefined
      // Apply before plugin/skill discovery and again when resuming saved threads.
      // These overrides belong only to this Dovo process, never the user's config.
      const providerConfig = {
        ...(mcpServers?.[CUA_SERVER_NAME]?.enabled
          ? {
              'features.computer_use': false,
              'plugins."computer-use@openai-bundled".enabled': false,
            }
          : {}),
        ...(run.tools === 'none' || run.agent.cloudIntegrations !== undefined
          ? { 'features.apps': run.tools !== 'none' && run.agent.cloudIntegrations === true }
          : {}),
      }
      const providerArgs = Object.entries(providerConfig).flatMap(([key, value]) => [
        '-c',
        `${key}=${value}`,
      ])
      // A loaded Codex thread retains its MCP connections. Dovo supplies a session
      // binding; an external configuration change still requires a fresh process.
      const launchConfig = JSON.stringify([
        run.agent.args,
        run.agent.env,
        mcpServers,
        policy,
        providerConfig,
      ])
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      const reusable =
        previous &&
        previous.sessionId === run.sessionId &&
        previous.endpoint === endpoint &&
        previous.launchConfig === launchConfig &&
        previous.cwd === run.cwd &&
        previous.child.exitCode === null &&
        !previous.transportError &&
        !previous.closing &&
        !run.signal.aborted
          ? previous
          : undefined
      if (previous && !reusable) {
        if (
          !previous.transportError &&
          !previous.closing &&
          previous.nativeAgents.some(nativeAgentWorking)
        ) {
          if (run.taskId) idle.set(run.taskId, previous)
          throw new Error('Stop native Codex agents before changing their session configuration')
        }
        await close(previous)
      }
      const child =
        reusable?.child ??
        spawn(
          endpoint,
          ['app-server', '--listen', 'stdio://', ...(run.agent.args ?? []), ...providerArgs],
          {
            windowsHide: true,
            cwd: run.cwd,
            detached: process.platform !== 'win32',
            env: processEnvironment(run.agent.env),
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
      if (!child.stdout || !child.stdin || !child.stderr)
        throw new Error('Codex stdio pipes are unavailable')
      if (!reusable) child.on('error', (error) => console.error('Codex process failed:', error))
      const rpc =
        reusable?.rpc ??
        createMessageConnection(new JsonLineReader(child.stdout), new JsonLineWriter(child.stdin))
      const transport: CodexConnection = reusable ?? {
        child,
        rpc,
        sessionId: run.sessionId ?? '',
        endpoint,
        launchConfig,
        cwd: run.cwd,
        initialized: undefined,
        rateLimitUpdates: codexRateLimitUpdates(),
        stderr: '',
        nativeAgents: [],
        lifetime: new AbortController(),
      }
      transport.onSubagentEvent = run.onSubagentEvent
      const emitEvent = (method: string, params: unknown) => {
        const update = transport.rateLimitUpdates(method, params)
        if (update !== undefined) run.onEvent?.(method, update)
      }
      if (!reusable)
        rpc.onNotification((method, params) => {
          transport.nativeAgents = updateSubagents(
            transport.nativeAgents,
            'codex',
            params,
            new Date().toISOString(),
            method,
            transport.sessionId || undefined,
          )
          transport.onSubagentEvent?.(method, params, transport.sessionId)
          transport.consumeNotification?.(method, params)
        })
      if (!reusable)
        child.stderr.on('data', (data: Buffer) => {
          transport.stderr = (transport.stderr + String(data)).slice(-4000)
        })
      if (!reusable)
        child.on('exit', () => {
          transport.lifetime.abort()
          if (!transport.closing)
            void close(transport).catch((error) =>
              console.error('Could not drain exited Codex process:', error),
            )
          for (const [taskId, connection] of idle) if (connection === transport) idle.delete(taskId)
          rpc.dispose()
        })
      if (!reusable) {
        const failTransport = (error: Error) => {
          if (transport.closing || transport.transportError) return
          transport.transportError = error
          // stdout may close before Node reports the exit reason. Also let JSON-RPC
          // dispatch buffered cancellation/completion messages before retiring the turn.
          transport.transportTimer = setTimeout(() => {
            if (transport.closing) return
            if (transport.rejectTransport) transport.rejectTransport(error)
            else {
              for (const [taskId, connection] of idle)
                if (connection === transport) idle.delete(taskId)
              void close(transport).catch((error) =>
                console.error('Could not drain disconnected Codex process:', error),
              )
            }
          }, 1000)
        }
        rpc.onClose(() => failTransport(new Error('Codex RPC transport closed')))
        rpc.onError(([error]) =>
          failTransport(
            new Error(`Codex RPC transport failed: ${error.message}`, { cause: error }),
          ),
        )
      }
      const questionItems = new Set<string>()
      let threadId = run.sessionId
      let turnFinished = false
      let promptAccepted = false
      const acceptPrompt = () => {
        promptAccepted = true
        run.onPromptAccepted?.()
      }
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
      transport.rejectTransport = rejectTurn
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
      transport.requests?.dispose()
      const requests = rpc.onRequest(async (method, params: unknown, token) => {
        const scope = decodeResult(object, params).data
        const native =
          typeof scope?.threadId === 'string' &&
          scope.threadId !== threadId &&
          transport.nativeAgents.some(
            (agent) => agent.id === scope.threadId && nativeAgentWorking(agent),
          )
        if (typeof scope?.threadId === 'string' && scope.threadId !== threadId && !native)
          throw new Error('Unknown Codex child request')
        const interactions = run.nativeAgentInteractions
        const requestRun: AgentRun =
          native && interactions
            ? {
                ...run,
                approve: (title, detail, kind, options) =>
                  interactions.approve(title, detail, transport.lifetime.signal, kind, options),
                ask: (prompt, signal, validate) =>
                  interactions.ask(
                    prompt,
                    signal
                      ? AbortSignal.any([signal, transport.lifetime.signal])
                      : transport.lifetime.signal,
                    validate,
                  ),
              }
            : run
        if (!run.compact && !native) {
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
        if (!native) {
          if (method.startsWith('item/')) promptAccepted = true
          run.onEvent?.(method, params)
        }
        if (
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
        ) {
          // A managed HTTP request has no shell command or extra filesystem grant.
          const context = scope?.networkApprovalContext
          const web =
            method.includes('command') &&
            !scope?.command &&
            !scope?.additionalPermissions &&
            !!context &&
            typeof context === 'object' &&
            'protocol' in context &&
            ['http', 'https'].includes(String(context.protocol))
          const allowed =
            requestRun.tools !== 'none' &&
            requestRun.agent.permission !== 'read-only' &&
            requestRun.agent.approvalPolicy !== 'never' &&
            !(
              requestRun.agent.sandboxMode &&
              requestRun.agent.sandboxMode !== 'danger-full-access' &&
              (scope?.additionalPermissions || scope?.grantRoot)
            ) &&
            (await requestRun.approve(
              web
                ? 'Web request'
                : method.includes('command')
                  ? 'Run command'
                  : 'Apply file changes',
              JSON.stringify(params, null, 2),
              web
                ? 'web'
                : method === 'item/commandExecution/requestApproval'
                  ? 'command'
                  : undefined,
            )) !== 'deny'
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
              return await codexQuestions(params, requestRun, controller.signal)
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
              requestRun,
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
      transport.requests = requests
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
        emitEvent(method, params)
        // Child notifications feed the Agents panel, never the parent transcript or completion.
        if (threadId && typeof value.data.threadId === 'string' && value.data.threadId !== threadId)
          return
        if (method === 'turn/started' || method === 'turn/completed' || method === 'item/started')
          acceptPrompt()
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
          run.onNativeTurnEnd?.()
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
      transport.consumeNotification = consumeNotification
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
      let rejectedBeforeAcceptance = false
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
          emitEvent('account/read', await request('account/read', { refreshToken: false }))
        } catch {
          // Account metadata is optional on older app servers.
        }
        try {
          emitEvent('account/rateLimits/read', await request('account/rateLimits/read', {}))
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
          ...providerConfig,
          ...(supportsCodexInstantInterrupt(initialized)
            ? { 'features.instant_interrupt': true }
            : {}),
          ...(supportsCodexNativeAgents(initialized) && run.tools !== 'none'
            ? { 'features.multi_agent': true }
            : {}),
          ...(run.agent.sandboxMode === 'workspace-write' ||
          run.linkedDirectories?.some((item) => item.access === 'edit')
            ? {
                'sandbox_workspace_write.writable_roots': [
                  run.cwd,
                  ...(run.linkedDirectories ?? [])
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
                'features.multi_agent': false,
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
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: policy.automaticReview ? 'auto_review' : 'user',
          sandbox: policy.sandboxMode,
        })
        if (
          policy.automaticReview &&
          !decodeResult(
            mutableStruct({
              approvalsReviewer: Schema.Literals(['auto_review', 'guardian_subagent']),
            }),
            response,
          ).success
        )
          throw new Error(
            'This Codex harness did not enable automatic approval review. Update the harness or choose another access mode.',
          )
        if (
          policy.approvalPolicy === 'never' &&
          policy.sandboxMode === 'danger-full-access' &&
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
        if (run.agent.approvalPolicy || run.agent.sandboxMode) {
          const settings = decodeResult(
            mutableStruct({
              approvalPolicy: Schema.Literals(['untrusted', 'on-failure', 'on-request', 'never']),
              sandbox: mutableStruct({
                type: Schema.Literals(['readOnly', 'workspaceWrite', 'dangerFullAccess']),
                writableRoots: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
              }),
            }),
            response,
          ).data
          const nativeSandbox = {
            'read-only': 'readOnly',
            'workspace-write': 'workspaceWrite',
            'danger-full-access': 'dangerFullAccess',
          }[policy.sandboxMode]
          const allowedRoots = [
            run.cwd,
            ...(run.linkedDirectories ?? [])
              .filter((link) => link.access === 'edit')
              .map((link) => link.path),
          ]
          if (
            !settings ||
            settings.approvalPolicy !== policy.approvalPolicy ||
            settings.sandbox.type !== nativeSandbox ||
            (run.agent.sandboxMode === 'workspace-write' &&
              settings.sandbox.writableRoots?.some((root) => !allowedRoots.includes(root)))
          )
            throw new Error(
              'This Codex harness did not apply the requested approval policy and sandbox. No prompt was submitted.',
            )
        }
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
        transport.sessionId = thread.id
        run.onSession(thread.id)
        run.onNativeSession?.(
          {
            readThread: async (id) =>
              transport.closing
                ? readCodexThread(run.agent, id, run.cwd)
                : codexThreadEntries(
                    await nativeWait(
                      rpc.sendRequest('thread/read', { threadId: id, includeTurns: true }),
                      transport.lifetime.signal,
                      10000,
                    ),
                  ),
            stop: async (id) => {
              if (!id && turnFinished) {
                if (run.taskId) idle.delete(run.taskId)
                await close(transport)
                return
              }
              for (const agent of transport.nativeAgents.filter(
                (agent) => nativeAgentWorking(agent) && (!id || agent.id === id),
              )) {
                const response = decodeResult(
                  object,
                  await rpc.sendRequest('thread/read', { threadId: agent.id, includeTurns: true }),
                ).data
                const turns = response
                  ? decodeResult(
                      Schema.mutable(Schema.Array(object)),
                      decodeResult(object, response.thread).data?.turns,
                    ).data
                  : undefined
                const turn = turns
                  ?.slice()
                  .reverse()
                  .find((turn) => turn.status === 'inProgress' && typeof turn.id === 'string')
                if (!turn) throw new Error('Codex has not reported a cancellable child turn yet')
                await rpc.sendRequest('turn/interrupt', { threadId: agent.id, turnId: turn.id })
              }
            },
          },
          thread.id,
        )
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
          acceptPrompt()
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
          ...(run.outputSchema ? { outputSchema: run.outputSchema } : {}),
          ...(run.agent.approvalPolicy || run.agent.sandboxMode
            ? {
                approvalPolicy: policy.approvalPolicy,
                approvalsReviewer: policy.automaticReview ? 'auto_review' : 'user',
                sandboxPolicy:
                  policy.sandboxMode === 'workspace-write'
                    ? {
                        type: 'workspaceWrite',
                        writableRoots: [
                          run.cwd,
                          ...(run.linkedDirectories ?? [])
                            .filter((link) => link.access === 'edit')
                            .map((link) => link.path),
                        ],
                        networkAccess: false,
                        excludeTmpdirEnvVar: false,
                        excludeSlashTmp: false,
                      }
                    : {
                        type: policy.sandboxMode === 'read-only' ? 'readOnly' : 'dangerFullAccess',
                      },
              }
            : {}),
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
        acceptPrompt()
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
            promptAccepted = true
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
      } catch (error) {
        rejectedBeforeAcceptance =
          !!run.sessionId &&
          submitted &&
          !promptAccepted &&
          !run.compact &&
          isContextRejection(error)
        if (rejectedBeforeAcceptance) {
          // Retire only this input. The loaded session still owns native jobs and
          // must continue consuming their notifications and interaction requests.
          turnFinished = true
          awaitingTurn = false
          rejectTurn(error instanceof Error ? error : new Error(String(error)))
        }
        throw error
      } finally {
        run.onSteer?.(undefined)
        clearTimeout(timeout)
        run.signal.removeEventListener('abort', abort)
        transport.consumeNotification = undefined
        transport.rejectTransport = undefined
        child.off('error', rejectTurn)
        child.off('exit', onExit)
        if (
          (succeeded || rejectedBeforeAcceptance) &&
          run.taskId &&
          run.tools !== 'none' &&
          threadId &&
          !run.signal.aborted &&
          child.exitCode === null &&
          !transport.transportError &&
          !transport.lifetime.signal.aborted
        ) {
          transport.sessionId = threadId
          transport.initialized = initialized
          idle.set(run.taskId, transport)
          await idle.prune(releaseIdleProvider())
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
