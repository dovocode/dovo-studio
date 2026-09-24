import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { acpMcpServers } from '../mcp-settings.js'
import { isImageAttachment } from '@dovo/protocol'
import { acpModels } from '../catalogs/acp.js'
import { formQuestions } from './form-questions.js'
import { Schema } from 'effect'
import type { AgentAdapter } from '../types.js'
import { executableAvailable } from '../../process.js'
import { acpControl, initializeAcp, legacyAcpLaunch, openAcpConnection } from './acp-connection.js'
import { acpClientTools } from './acp-client-tools.js'
export const acpAdapter: AgentAdapter = {
  models: acpModels,
  probe: async (agent, launch) => ({
    provider: 'acp',
    available:
      !!(launch?.command || agent.endpoint) &&
      (await executableAvailable(launch?.command || agent.endpoint)),
    detail:
      launch?.command || agent.endpoint
        ? 'ACP executable configured.'
        : 'Set an ACP executable and arguments.',
  }),
  async run(run) {
    run.signal.throwIfAborted()
    if (!run.acpLaunch && !run.agent.endpoint)
      throw new Error('Configure an ACP executable and arguments first')
    let cancelling = false
    let loading = !!run.sessionId
    let sessionId: string | undefined
    const tools = await acpClientTools(run, () => sessionId)
    const connection = openAcpConnection(
      run.acpLaunch ?? legacyAcpLaunch(run.agent.endpoint, run.agent.args ?? []),
      {
        ...tools.client,
        createElicitation: async (params) => {
          if (run.signal.aborted || ('sessionId' in params && params.sessionId !== sessionId))
            return { action: 'cancel' }
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
          const content = await formQuestions(form.data.message, form.data.requestedSchema, run)
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
          if (cancelling || run.signal.aborted || params.sessionId !== sessionId)
            return { outcome: { outcome: 'cancelled' } }
          if (prompting) run.onPromptAccepted?.()
          run.onEvent?.('permission', params)
          const allow =
            run.agent.permission !== 'read-only' &&
            run.tools !== 'none' &&
            (await run.approve(
              params.toolCall.title ?? 'ACP tool request',
              JSON.stringify(params.toolCall, null, 2),
            ))
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
          if (loading) return
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
          run.onEvent?.(params.update.sessionUpdate, params)
          const update = params.update
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
            run.onText(update.content.text)
          if (update.sessionUpdate === 'tool_call') run.onActivity(update.title)
        },
      },
      run.cwd,
    )
    const { rpc, exited } = connection
    let prompting = false
    let canCloseSession = false
    const abort = () => {
      cancelling = true
      if (sessionId) {
        setTimeout(() => {
          void connection.close()
        }, 1500).unref()
        void rpc.cancel({ sessionId }).catch(() => {})
      } else void connection.close()
    }
    run.signal.addEventListener('abort', abort, {
      once: true,
    })
    try {
      const initialization = await initializeAcp(connection, {
        ...tools.capabilities,
        session: { configOptions: { boolean: {} } },
        elicitation: {
          form: {},
        },
      })
      canCloseSession = !!initialization.agentCapabilities?.sessionCapabilities?.close
      if (
        run.sessionId &&
        !initialization.agentCapabilities?.sessionCapabilities?.resume &&
        !initialization.agentCapabilities?.loadSession
      )
        throw new Error('This ACP agent cannot resume sessions. Start a new session explicitly.')
      const mcpServers = acpMcpServers(run.agent.resources?.mcpServers ?? [])
      if (
        mcpServers.some((server) => 'type' in server && server.type === 'http') &&
        !initialization.agentCapabilities?.mcpCapabilities?.http
      )
        throw new Error('This ACP harness does not support HTTP MCP servers')
      let session
      try {
        session = await acpControl(
          connection,
          run.sessionId
            ? initialization.agentCapabilities?.sessionCapabilities?.resume
              ? rpc.resumeSession({
                  sessionId: run.sessionId,
                  cwd: run.cwd,
                  mcpServers,
                })
              : rpc.loadSession({
                  sessionId: run.sessionId,
                  cwd: run.cwd,
                  mcpServers,
                })
            : rpc.newSession({
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
      const restrictive = run.agent.permission === 'read-only' || run.tools === 'none'
      if (restrictive || run.agent.acpMode) {
        const mode = restrictive
          ? session.modes?.availableModes.find((item) => /^(plan|read[-_ ]?only)$/i.test(item.id))
          : session.modes?.availableModes.find((item) => item.id === run.agent.acpMode)
        if (!mode)
          throw new Error(
            restrictive
              ? 'This ACP agent does not advertise a read-only mode'
              : 'This ACP agent does not advertise the selected mode',
          )
        await acpControl(
          connection,
          rpc.setSessionMode({
            sessionId: id,
            modeId: mode.id,
          }),
          'mode selection',
        )
      }
      let configOptions = session.configOptions
      if (run.agent.model) {
        const model = session.configOptions?.find((option) => option.category === 'model')
        if (!model) throw new Error('ACP agent does not advertise model configuration')
        const updated = await acpControl(
          connection,
          rpc.setSessionConfigOption({
            sessionId: id,
            configId: model.id,
            value: run.agent.model,
          }),
          'model selection',
        )
        configOptions = updated.configOptions
      }
      if (run.agent.reasoning) {
        const option = configOptions?.find(
          (o) => o.category === 'thought_level' && o.type === 'select',
        )
        if (!option) throw new Error('This ACP model does not advertise reasoning configuration')
        configOptions = (
          await acpControl(
            connection,
            rpc.setSessionConfigOption({
              sessionId: id,
              configId: option.id,
              value: run.agent.reasoning,
            }),
            'reasoning selection',
          )
        ).configOptions
      }
      for (const [configId, value] of Object.entries(run.agent.acpConfig ?? {})) {
        const option = configOptions?.find((item) => item.id === configId)
        if (!option) throw new Error(`ACP configuration ${configId} is unavailable`)
        if (restrictive && option.category === 'mode')
          throw new Error('ACP mode configuration cannot override read-only execution')
        if (option.type === 'boolean') {
          if (value !== 'true' && value !== 'false')
            throw new Error(`ACP configuration ${configId} must be true or false`)
          configOptions = (
            await acpControl(
              connection,
              rpc.setSessionConfigOption({
                sessionId: id,
                configId,
                type: 'boolean',
                value: value === 'true',
              }),
              'configuration',
            )
          ).configOptions
        } else {
          const choices = option.options.flatMap((item) =>
            'options' in item ? item.options : [item],
          )
          if (!choices.some((item) => item.value === value))
            throw new Error(`ACP configuration ${configId} does not offer ${value}`)
          configOptions = (
            await acpControl(
              connection,
              rpc.setSessionConfigOption({ sessionId: id, configId, value }),
              'configuration',
            )
          ).configOptions
        }
      }
      if (run.signal.aborted) throw new Error('Task cancelled')
      if (
        run.attachments?.some(isImageAttachment) &&
        !initialization.agentCapabilities?.promptCapabilities?.image
      )
        run.onActivity(
          'This ACP agent does not accept image input; images are available as attached files only.',
        )
      prompting = true
      const result = await Promise.race([
        rpc.prompt({
          sessionId: id,
          prompt: [
            ...(initialization.agentCapabilities?.promptCapabilities?.image
              ? (run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                  type: 'image' as const,
                  data: file.data,
                  mimeType: file.mime,
                }))
              : []),
            {
              type: 'text',
              text: [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
            },
          ],
        }),
        exited,
      ])
      run.onPromptAccepted?.()
      if (result.stopReason !== 'end_turn' && !(cancelling && result.stopReason === 'cancelled'))
        throw new Error(`ACP stopped: ${result.stopReason}`)
    } finally {
      run.signal.removeEventListener('abort', abort)
      if (canCloseSession && sessionId && !run.signal.aborted && !connection.rpc.signal.aborted) {
        try {
          await acpControl(connection, rpc.closeSession({ sessionId }), 'session close')
        } catch (error) {
          run.onActivity(
            `ACP session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      await tools.close()
      await connection.close()
    }
  },
}
