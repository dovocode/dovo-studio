import { createAcpV2Adapter } from './acp-v2.js'
import { grokSteering } from './grok-steering.js'
import { acpV2Enabled } from './acp-v2-connection.js'
import type { AcpClient } from './acp-client.js'
import { checkedPolicyRun } from '../shared/permission-policy.js'
import { acpModelOption, acpReasoningOption, legacyAcpModels } from './acp-models.js'
import {
  acpV1ModeOption,
  acpV1OptionOffers,
  applyAcpV1Option,
  setAcpV1Mode,
} from './acp-v1-config.js'
import {
  acpPermissionDisposition,
  acpPermissionModeOption,
  acpPermissionProvider,
  kiroAutopilot,
} from './acp-permissions.js'
import { mutableStruct, nativeAgentWorking, type Subagent } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { acpMcpHttp } from './acp-mcp.js'
import { acpMcpServers, mcpHeaders } from '../../configuration/mcp-settings.js'
import { isImageAttachment } from '@dovo/protocol'
import { acpModels } from '../../catalogs/acp.js'
import { formQuestions } from '../shared/form-questions.js'
import { Schema } from 'effect'
import {
  methods,
  type NewSessionResponse,
  type ResumeSessionResponse,
  type LoadSessionResponse,
  type PromptRequest,
  type SubagentUpdate,
  type McpServer,
  type SessionConfigOption,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk/unstable'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { executableAvailable } from '../../../process.js'
import {
  acpControl,
  initializeAcp,
  legacyAcpLaunch,
  openAcpConnection,
  type AcpInitialization,
} from './acp-connection.js'
import { acpClientTools } from './acp-client-tools.js'
import { updateSubagents } from '../../execution/subagents.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { watchAntigravityOutcome } from './antigravity-outcome.js'
import { readAntigravityTranscript } from './antigravity-transcript.js'
import { antigravityProfile } from './antigravity-profile.js'
import { antigravityPluginSkills } from './antigravity-skills.js'
import { providerFailureKind } from '../../execution/provider-failure.js'
type AcpConnection = ReturnType<typeof openAcpConnection>
type AcpSession = NewSessionResponse | ResumeSessionResponse | LoadSessionResponse
type WarmAcp = {
  connection: AcpConnection
  client: AcpClient
  initialization: AcpInitialization
  session: AcpSession
  sessionId: string
  launchKey: string
  cwd: string
  compactAvailable: boolean
  native: {
    agents: Subagent[]
    children: Map<string, SubagentUpdate>
    tools: Awaited<ReturnType<typeof acpClientTools>>
    toolRun: AgentRun
    lifetime: AbortController
    owner: AgentRun
    prompting: boolean
    model: string
    reasoning?: string
    configOptions?: SessionConfigOption[]
  }
}
export function createAcpAdapter(): AgentAdapter {
  const v2 = createAcpV2Adapter()
  const idle = new IdleProviders<WarmAcp>(
    (value) => close(value),
    (value) => value.native.agents.some(nativeAgentWorking),
  )
  const close = async (value: WarmAcp) => {
    value.native.lifetime.abort()
    await value.connection.close()
    await value.native.tools.close()
    value.native.owner.onSubagentEvent?.('dovo/session/closed', {}, value.sessionId)
  }
  return {
    releaseTask: async (taskId) => {
      await idle.release(taskId)
      await v2.releaseTask(taskId)
    },
    models: acpModels,
    async nativeSkills(agent, _cwd, signal, managed) {
      const launch = managed ?? {
        ...legacyAcpLaunch(agent.endpoint, agent.args),
        env: agent.env ?? {},
      }
      if (acpPermissionProvider(launch, agent) !== 'antigravity') return []
      const profile = antigravityProfile(launch)
      return profile ? antigravityPluginSkills(profile, signal) : []
    },
    async readNativeThread(agent, id, sessionId, _cwd, sandbox, managed) {
      if (sandbox) return
      const launch = managed ?? {
        ...legacyAcpLaunch(agent.endpoint, agent.args),
        env: agent.env ?? {},
      }
      if (acpPermissionProvider(launch, agent) === 'antigravity')
        return readAntigravityTranscript(launch, id, sessionId)
    },
    probe: async (agent, launch) => ({
      provider: 'acp',
      available:
        !!(launch?.command || agent.endpoint) &&
        (await executableAvailable(launch?.command || agent.endpoint, launch?.env ?? agent.env)),
      detail:
        launch?.command || agent.endpoint
          ? 'ACP executable configured.'
          : 'Set an ACP executable and arguments.',
    }),
    async run(run) {
      run = checkedPolicyRun(run, 'acp')
      run.signal.throwIfAborted()
      if (!run.acpLaunch && !run.agent.endpoint)
        throw new Error('Configure an ACP executable and arguments first')
      const launch = {
        ...(run.acpLaunch ?? {
          ...legacyAcpLaunch(run.agent.endpoint, run.agent.args ?? []),
          env: run.agent.env ?? {},
        }),
        ...(run.sandbox ? { sandbox: run.sandbox } : {}),
      }
      const permissionProvider = acpPermissionProvider(launch, run.agent)
      if (
        permissionProvider === 'kiro' &&
        (run.agent.permission === 'auto' || run.agent.permission === 'workspace-write')
      )
        run = { ...run, agent: { ...run.agent, permission: 'ask' } }
      const { model, reasoning, ...agentSettings } = run.agent
      const antigravity = permissionProvider === 'antigravity' ? run.agent : undefined
      const launchKey = JSON.stringify([launch, antigravity ? agentSettings : run.agent, run.tools])
      const sameSelection = (value: WarmAcp) =>
        value.native.model === model && value.native.reasoning === reasoning
      const canReuse = (value: WarmAcp | undefined) => {
        if (
          !value ||
          value.launchKey !== launchKey ||
          value.sessionId !== run.sessionId ||
          value.cwd !== run.cwd ||
          value.connection.signal.aborted
        )
          return false
        if (sameSelection(value)) return true
        const option = antigravity && acpModelOption(value.native.configOptions)
        return (
          !!option &&
          !!model &&
          (model !== value.native.model || !!reasoning) &&
          acpV1OptionOffers(option, model) &&
          !value.native.agents.some(nativeAgentWorking)
        )
      }
      const held = run.taskId ? idle.get(run.taskId) : undefined
      const knownV1 = canReuse(held)
      if (acpV2Enabled(launch) && !knownV1) {
        if (held?.native.agents.some(nativeAgentWorking))
          throw new Error('Stop native ACP agents before changing protocol versions')
        if (run.taskId) await idle.release(run.taskId)
        if (await v2.run(run, launch)) return
      } else if (run.taskId) await v2.beforeV1(run.taskId)
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      const reusable = canReuse(previous) ? previous : undefined
      if (previous && !reusable) {
        if (previous.native.agents.some(nativeAgentWorking)) {
          if (run.taskId) idle.set(run.taskId, previous)
          throw new Error('Stop native ACP agents before changing their session configuration')
        }
        await close(previous)
      }
      let cancelling = false
      let loading = false
      let sessionId: string | undefined = reusable?.sessionId
      let compactAvailable = reusable?.compactAvailable ?? false
      let updatedConfig: SessionConfigOption[] | undefined
      let checkOutcome: ReturnType<typeof watchAntigravityOutcome>
      let failPrompt: ((error: Error) => void) | undefined
      let failedBeforeReceipt = false
      let sawUsage = false
      let diagnosticTail = ''
      const children = reusable?.native.children ?? new Map<string, SubagentUpdate>()
      const lifetime = reusable?.native.lifetime ?? new AbortController()
      const native = reusable?.native
      let nativeAgents = native?.agents ?? []
      let nativeState: WarmAcp['native'] | undefined = native
      const ownsChild = (id: string) =>
        (nativeState?.agents ?? nativeAgents).some(
          (agent) => agent.id === id && nativeAgentWorking(agent),
        )
      const requestRun = (id: string): AgentRun | undefined => {
        if (id === sessionId) return prompting ? run : undefined
        const interactions = run.nativeAgentInteractions
        if (!ownsChild(id) || !interactions) return
        return {
          ...run,
          approve: (title, detail, kind, options) =>
            interactions.approve(title, detail, lifetime.signal, kind, options),
          ask: interactions.ask,
        }
      }
      const toolRun: AgentRun = native?.toolRun ?? { ...run, signal: lifetime.signal }
      Object.assign(toolRun, {
        ...run,
        signal: lifetime.signal,
        approve: (
          title: string,
          detail: string,
          kind?: 'web' | 'command',
          options?: { session?: boolean; always?: boolean },
        ) =>
          prompting
            ? run.approve(title, detail, kind, options)
            : (run.nativeAgentInteractions?.approve(
                title,
                detail,
                lifetime.signal,
                kind,
                options,
              ) ?? Promise.resolve('deny' as const)),
      })
      const tools =
        native?.tools ??
        (await acpClientTools(
          toolRun,
          () => sessionId,
          (id) => (id === sessionId && (nativeState?.prompting ?? prompting)) || ownsChild(id),
        ))
      let prompting = false
      const permissionTools = new Map<string, ToolCallUpdate>()
      const toolKey = (session: string, tool: string) => JSON.stringify([session, tool])
      const handlers: AcpClient = {
        ...tools.client,
        createElicitation: async (params) => {
          const owner =
            'sessionId' in params && typeof params.sessionId === 'string'
              ? requestRun(params.sessionId)
              : prompting
                ? run
                : undefined
          if (lifetime.signal.aborted || !owner) return { action: 'cancel' }
          run.onEvent?.('elicitation/create', params)
          const form = decodeResult(
            mutableStruct({
              mode: Schema.Literal('form'),
              message: Schema.String,
              requestedSchema: Schema.Unknown,
            }),
            params,
          )
          if (!form.success) {
            run.onActivity('This ACP input request is not a supported form')
            return {
              action: 'cancel',
            }
          }
          const content = await formQuestions(
            form.data.message,
            form.data.requestedSchema,
            owner,
            lifetime.signal,
          )
          return content
            ? {
                action: 'accept',
                content,
              }
            : {
                action: 'decline',
              }
        },
        requestPermission: async (params) => {
          const owner = requestRun(params.sessionId)
          if (cancelling || lifetime.signal.aborted || !owner)
            return { outcome: { outcome: 'cancelled' } }
          if (prompting) run.onPromptAccepted?.()
          run.onEvent?.('permission', params)
          const toolCall = {
            ...permissionTools.get(toolKey(params.sessionId, params.toolCall.toolCallId)),
            ...params.toolCall,
          }
          const disposition = await acpPermissionDisposition(
            owner,
            ['read', 'search', 'think'].includes(toolCall.kind ?? '')
              ? 'read'
              : toolCall.kind === 'edit'
                ? 'edit'
                : 'other',
            permissionProvider,
            toolCall,
          )
          const allow =
            disposition === 'allow' ||
            (disposition === 'ask' &&
              (await owner.approve(
                toolCall.title ?? 'ACP tool request',
                JSON.stringify(toolCall, null, 2),
                toolCall.kind === 'fetch' ? 'web' : undefined,
              )) !== 'deny')
          if (cancelling || run.signal.aborted) return { outcome: { outcome: 'cancelled' } }
          const option = params.options.find(
            (option) => option.kind === (allow ? 'allow_once' : 'reject_once'),
          )
          return {
            outcome: option
              ? {
                  outcome: 'selected',
                  optionId: option.optionId,
                }
              : {
                  outcome: 'cancelled',
                },
          }
        },
        sessionUpdate: (params) => {
          const { update } = params
          if (
            (params.sessionId === sessionId || ownsChild(params.sessionId)) &&
            (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update')
          ) {
            const key = toolKey(params.sessionId, update.toolCallId)
            if (update.status === 'completed' || update.status === 'failed')
              permissionTools.delete(key)
            else permissionTools.set(key, { ...permissionTools.get(key), ...update })
          }
          // Cold load can replay child identities before session setup returns. Only
          // child announcements from the requested parent may establish ownership.
          const parentId = sessionId ?? (loading ? run.sessionId : undefined)
          const child =
            params.update.sessionUpdate === 'subagent_update' &&
            (params.sessionId === parentId || children.has(params.sessionId))
              ? params.update
              : undefined
          if (child) children.set(child.sessionId, { ...children.get(child.sessionId), ...child })
          if (child || params.sessionId === sessionId || children.has(params.sessionId)) {
            nativeAgents = updateSubagents(
              nativeAgents,
              'acp',
              params,
              new Date().toISOString(),
              params.update.sessionUpdate,
              parentId,
            )
            if (nativeState) nativeState.agents = nativeAgents
            run.onSubagentEvent?.(params.update.sessionUpdate, params, parentId)
          }

          if (
            params.sessionId === (sessionId ?? run.sessionId) &&
            params.update.sessionUpdate === 'available_commands_update'
          )
            compactAvailable = params.update.availableCommands.some(
              (command) => command.name === 'compact',
            )
          if (
            params.sessionId === (sessionId ?? run.sessionId) &&
            params.update.sessionUpdate === 'config_option_update'
          ) {
            updatedConfig = params.update.configOptions
            if (nativeState) nativeState.configOptions = updatedConfig
          }
          if (loading || !prompting) return
          if (params.sessionId !== sessionId) return
          if (
            prompting &&
            [
              'agent_message_chunk',
              'agent_thought_chunk',
              'tool_call',
              'tool_call_update',
            ].includes(params.update.sessionUpdate)
          )
            run.onPromptAccepted?.()
          if (params.update.sessionUpdate === 'tool_call') run.onTextBoundary?.()
          run.onEvent?.(params.update.sessionUpdate, params)
          if (checkOutcome && failPrompt) {
            if (update.sessionUpdate === 'usage_update') sawUsage = true
            if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
              diagnosticTail = (diagnosticTail + update.content.text.slice(-512)).slice(-512)
            if (sawUsage && /\b(?:auth_not_found|UNAUTHENTICATED)\b/i.test(diagnosticTail)) {
              // Usage and output can arrive in either order. Only a current terminal error in
              // the provider log can end a prompt that never returned its ACP receipt.
              const failure = checkOutcome()
              if (failure && providerFailureKind(failure) === 'authentication') {
                failedBeforeReceipt = true
                failPrompt(failure)
                failPrompt = undefined
              }
            }
          }
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
            run.onText(update.content.text)
          if (update.sessionUpdate === 'tool_call') run.onActivity(update.title)
        },
      }
      nativeState = reusable?.native ?? {
        agents: nativeAgents,
        children,
        tools,
        toolRun,
        lifetime,
        owner: run,
        prompting: false,
        model,
        reasoning,
      }
      nativeState.owner = run
      const state = nativeState
      const client = reusable?.client ?? handlers
      if (reusable) Object.assign(client, handlers)
      const connection = reusable?.connection ?? openAcpConnection(launch, client, run.cwd)
      run.onOwnedProcess?.(connection.child)
      tools.rebindProcesses()
      if (!reusable)
        void connection.exited
          .catch(async () => {
            lifetime.abort()
            await connection.close()
            await tools.close()
            if (sessionId) state.owner.onSubagentEvent?.('dovo/session/closed', {}, sessionId)
            for (const [taskId, value] of idle)
              if (value.connection === connection) idle.delete(taskId)
          })
          .catch((error) => console.error('Could not drain exited ACP process:', error))
      const { rpc, exited } = connection
      let succeeded = false
      let canCloseSession =
        reusable?.initialization.agentCapabilities?.sessionCapabilities?.close ?? false
      let canDeleteSession =
        reusable?.initialization.agentCapabilities?.sessionCapabilities?.delete ?? false
      let cleanupError: unknown
      const abort = () => {
        cancelling = true
        if (sessionId) {
          setTimeout(() => {
            void connection.close()
          }, 1500).unref()
          void rpc.notify(methods.agent.session.cancel, { sessionId }).catch(() => {})
        } else void connection.close()
      }
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      try {
        if (!reusable) run.onStartup?.('initializing')
        const initialization =
          reusable?.initialization ??
          (await initializeAcp(connection, {
            ...tools.capabilities,
            session: { configOptions: { boolean: {} } },
            elicitation: { form: {} },
            subagents: {},
          }))
        canCloseSession = !!initialization.agentCapabilities?.sessionCapabilities?.close
        canDeleteSession = !!initialization.agentCapabilities?.sessionCapabilities?.delete
        if (
          run.sessionId &&
          !reusable &&
          !initialization.agentCapabilities?.sessionCapabilities?.resume &&
          !initialization.agentCapabilities?.loadSession
        )
          throw new Error('This ACP agent cannot resume sessions. Start a new session explicitly.')
        const configuredServers = run.agent.resources?.mcpServers ?? []
        const mcpServers: McpServer[] = reusable ? [] : acpMcpServers(configuredServers)
        if (!reusable && initialization.agentCapabilities?.mcpCapabilities?.acp) {
          for (const server of configuredServers.filter(
            (server) => server.enabled && server.transport === 'http' && server.acpTransport,
          )) {
            const headers = mcpHeaders(server)
            const registration = connection.mcp.registerServer(rpc, {
              name: server.name,
              handler: (context) => acpMcpHttp(server.url, headers, context),
            })
            const index = mcpServers.findIndex((entry) => entry.name === server.name)
            mcpServers[index] = registration.declaration
          }
        }
        if (
          mcpServers.some((server) => 'type' in server && server.type === 'http') &&
          !initialization.agentCapabilities?.mcpCapabilities?.http
        )
          throw new Error('This ACP harness does not support HTTP MCP servers')
        loading = !!run.sessionId && !reusable
        let session = reusable?.session
        if (!session) {
          run.onStartup?.(run.sessionId ? 'resuming-session' : 'opening-session')
          try {
            session = await acpControl(
              connection,
              run.sessionId
                ? initialization.agentCapabilities?.sessionCapabilities?.resume
                  ? rpc.request(methods.agent.session.resume, {
                      sessionId: run.sessionId,
                      cwd: run.cwd,
                      mcpServers,
                    })
                  : rpc.request(methods.agent.session.load, {
                      sessionId: run.sessionId,
                      cwd: run.cwd,
                      mcpServers,
                    })
                : rpc.request(methods.agent.session.new, {
                    cwd: run.cwd,
                    mcpServers,
                  }),
              'session setup',
            )
          } catch (error) {
            if (error instanceof Error && /auth[_ ]required/i.test(error.message))
              throw new Error(
                'This ACP agent needs authentication. Open its Agent settings to sign in.',
                { cause: error },
              )
            throw error
          }
        }
        if (!session) throw new Error('ACP session setup returned no session')
        loading = false
        const id =
          run.sessionId ??
          decode(
            mutableStruct({
              sessionId: Schema.String,
            }),
            session,
          ).sessionId
        if (!id) throw new Error('ACP agent did not return a session id')
        sessionId = id
        run.onSession(id)
        run.onNativeSession?.(
          {
            ...(antigravity && !launch.sandbox
              ? { readThread: (childId: string) => readAntigravityTranscript(launch, childId, id) }
              : {}),
            stop: async (childId) => {
              const selected = state.agents.filter(
                (agent) => nativeAgentWorking(agent) && (!childId || agent.id === childId),
              )
              if (selected.some((agent) => !children.get(agent.id)?.capabilities?.cancel)) {
                if (childId || state.prompting)
                  throw new Error(
                    'This ACP agent does not advertise cancellation for this child; stop the thread instead',
                  )
                await close({
                  connection,
                  client,
                  initialization,
                  session,
                  sessionId: id,
                  launchKey,
                  cwd: run.cwd,
                  compactAvailable,
                  native: state,
                })
                if (run.taskId) idle.delete(run.taskId)
                return
              }
              for (const agent of selected)
                await rpc.notify(methods.agent.session.cancel, { sessionId: agent.id })
            },
          },
          id,
        )
        if (!reusable || !sameSelection(reusable)) {
          const restrictive = run.agent.permission === 'read-only' || run.tools === 'none'
          let configOptions = updatedConfig ?? state.configOptions ?? session.configOptions
          if (!antigravity && (restrictive || run.agent.acpMode)) {
            configOptions =
              (await setAcpV1Mode(
                connection,
                id,
                { ...session, configOptions },
                run.agent.acpMode,
                restrictive,
              )) ??
              updatedConfig ??
              configOptions
          }
          if (run.agent.model) {
            const model = acpModelOption(configOptions)
            if (!model) {
              const legacy = legacyAcpModels(session)
              if (!legacy?.availableModels.some((model) => model.modelId === run.agent.model))
                throw new Error('ACP agent does not advertise the selected model')
              if (legacy.currentModelId !== run.agent.model) {
                updatedConfig = undefined
                await acpControl(
                  connection,
                  rpc.request('session/set_model', { sessionId: id, modelId: run.agent.model }),
                  'model selection',
                )
                configOptions = updatedConfig ?? configOptions
              }
            } else if (configOptions) {
              configOptions = await applyAcpV1Option(
                connection,
                id,
                configOptions,
                model,
                run.agent.model,
                'model selection',
              )
            }
          }
          if (run.agent.reasoning) {
            const option = acpReasoningOption(configOptions)
            if (!option || !configOptions)
              throw new Error('This ACP model does not advertise reasoning configuration')
            configOptions = await applyAcpV1Option(
              connection,
              id,
              configOptions,
              option,
              run.agent.reasoning,
              'reasoning selection',
            )
          }
          for (const [configId, value] of Object.entries(run.agent.acpConfig ?? {})) {
            const option = configOptions?.find((item) => item.id === configId)
            if (!configOptions || !option)
              throw new Error(`ACP configuration ${configId} is unavailable`)
            if (
              (antigravity && acpPermissionModeOption(option, configId)) ||
              (permissionProvider === 'kiro' && configId === 'autopilot') ||
              (run.agent.model && acpModelOption(configOptions)?.id === configId) ||
              (run.agent.reasoning && acpReasoningOption(configOptions)?.id === configId)
            )
              continue
            if (restrictive && option.category === 'mode')
              throw new Error('ACP mode configuration cannot override read-only execution')
            if (run.agent.acpMode && acpV1ModeOption(configOptions)?.id === configId) continue
            configOptions = await applyAcpV1Option(connection, id, configOptions, option, value)
          }
          if (antigravity) {
            const storedMode =
              acpV1ModeOption(configOptions) ??
              configOptions?.find(
                (option) => option.type === 'select' && acpPermissionModeOption(option, option.id),
              )
            configOptions =
              (await setAcpV1Mode(
                connection,
                id,
                { ...session, configOptions },
                run.agent.acpMode ??
                  (storedMode ? run.agent.acpConfig?.[storedMode.id] : undefined),
                restrictive,
                antigravity,
              )) ??
              updatedConfig ??
              configOptions
          }
          if (permissionProvider === 'kiro') {
            const autopilot = configOptions?.find((option) => option.id === 'autopilot')
            if (!configOptions || !autopilot)
              throw new Error('Kiro does not advertise its Autopilot setting')
            const value = kiroAutopilot(run.agent)
            await applyAcpV1Option(
              connection,
              id,
              configOptions,
              autopilot,
              autopilot.type === 'boolean' ? String(value === 'on') : value,
            )
          }
          state.configOptions = configOptions ?? undefined
          state.model = model
          state.reasoning = reasoning
        }
        if (run.signal.aborted) throw new Error('Task cancelled')
        if (run.compact && !compactAvailable)
          throw new Error('This ACP agent does not advertise a compact command')
        const supportsImages =
          launch.authentication === 'grok' ||
          !!initialization.agentCapabilities?.promptCapabilities?.image
        if (run.attachments?.some(isImageAttachment) && !supportsImages && run.tools === 'none')
          throw new Error('This ACP agent does not accept image input for tool-free reviews.')
        if (run.attachments?.some(isImageAttachment) && !supportsImages)
          run.onActivity(
            'This ACP agent does not accept image input; images are available as attached files only.',
          )
        prompting = true
        state.prompting = true
        if (launch.authentication === 'grok')
          run.onSteer?.(
            grokSteering(
              run,
              id,
              () => prompting && !connection.signal.aborted,
              (params) =>
                acpControl(connection, rpc.request('_x.ai/interject', params), 'Grok interjection'),
            ),
          )
        const prompt: PromptRequest = {
          sessionId: id,
          prompt: [
            ...(supportsImages
              ? (run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                  type: 'image' as const,
                  data: file.data,
                  mimeType: file.mime,
                }))
              : []),
            {
              type: 'text',
              text: run.compact
                ? '/compact'
                : [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
            },
          ],
        }
        if (antigravity) checkOutcome = watchAntigravityOutcome(launch, id)
        const nativeFailure = checkOutcome
          ? [
              new Promise<never>((_, reject) => {
                failPrompt = reject
              }),
            ]
          : []
        run.onStartup?.('sending-prompt')
        const result = await Promise.race([
          rpc.request(methods.agent.session.prompt, prompt),
          exited,
          ...nativeFailure,
        ])
        run.onTextBoundary?.()
        if (result.stopReason !== 'cancelled') {
          const failure = checkOutcome?.()
          if (failure) throw failure
        }
        if (result.stopReason !== 'cancelled') run.onPromptAccepted?.()
        if (result.stopReason !== 'end_turn' && !(cancelling && result.stopReason === 'cancelled'))
          throw new Error(`ACP stopped: ${result.stopReason}`)
        if (run.compact && !cancelling)
          run.onEvent?.('dovo/compaction/completed', { sessionId: id })
        run.onNativeTurnEnd?.()
        succeeded = true
        if (run.taskId && run.tools !== 'none' && !run.signal.aborted) {
          idle.set(run.taskId, {
            connection,
            client,
            initialization,
            session,
            sessionId: id,
            launchKey,
            cwd: run.cwd,
            compactAvailable,
            native: state,
          })
          await idle.prune(releaseIdleProvider())
        }
      } finally {
        prompting = false
        failPrompt = undefined
        checkOutcome = undefined
        state.prompting = false
        run.onSteer?.(undefined)
        if (sessionId) await tools.stopSession(sessionId)
        run.signal.removeEventListener('abort', abort)
        if (
          (!succeeded || !run.taskId || run.tools === 'none' || run.signal.aborted) &&
          sessionId &&
          !run.signal.aborted &&
          !failedBeforeReceipt &&
          !connection.signal.aborted &&
          canCloseSession
        ) {
          try {
            await acpControl(
              connection,
              rpc.request(methods.agent.session.close, { sessionId }),
              'session close',
            )
          } catch (error) {
            run.onActivity(
              `ACP session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        if (
          run.ephemeral &&
          !run.sessionId &&
          sessionId &&
          canDeleteSession &&
          !connection.signal.aborted
        ) {
          try {
            await acpControl(
              connection,
              rpc.request(methods.agent.session.delete, { sessionId }),
              'session deletion',
            )
          } catch (error) {
            cleanupError = error
            console.error('Could not delete ephemeral ACP session:', error)
          }
        }
        if (!succeeded || !run.taskId || run.tools === 'none' || run.signal.aborted) {
          lifetime.abort()
          await connection.close()
          await tools.close()
          if (sessionId) run.onSubagentEvent?.('dovo/session/closed', {}, sessionId)
        }
      }
      if (cleanupError) throw cleanupError
    },
    dispose: async () => {
      await v2.dispose()
      const connections = [...idle.values()]
      idle.clear()
      await Promise.all(connections.map(close))
    },
  }
}
export const acpAdapter = createAcpAdapter()
