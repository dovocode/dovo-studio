import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { acpMcpServers } from '../mcp-settings.js'
import { isImageAttachment } from '@dovo/protocol'
import { acpModels } from '../catalogs/acp.js'
import { formQuestions } from './form-questions.js'
import { stopChild } from '../stop-child.js'
import { spawn } from 'node:child_process'
import { Schema } from 'effect'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentAdapter } from '../types.js'
import { executableAvailable, processEnvironment } from '../../process.js'
export const acpAdapter: AgentAdapter = {
  models: acpModels,
  probe: async (agent) => ({
    provider: 'acp',
    available: !!agent.endpoint && (await executableAvailable(agent.endpoint)),
    detail: agent.endpoint ? 'ACP executable configured.' : 'Set an ACP executable and arguments.',
  }),
  async run(run) {
    run.signal.throwIfAborted()
    if (!run.agent.endpoint) throw new Error('Configure an ACP executable and arguments first')
    const child = spawn(run.agent.endpoint, run.agent.args ?? [], {
      cwd: run.cwd,
      env: processEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr = (stderr + String(data)).slice(-4000)
    })
    const rpc = new ClientSideConnection(
      () => ({
        createElicitation: async (params) => {
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
          run.onEvent?.('permission', params)
          const allow =
            run.agent.permission !== 'read-only' &&
            (await run.approve(
              params.toolCall.title ?? 'ACP tool request',
              JSON.stringify(params.toolCall, null, 2),
            ))
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
          run.onEvent?.(params.update.sessionUpdate, params)
          const update = params.update
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
            run.onText(update.content.text)
          if (update.sessionUpdate === 'tool_call') run.onActivity(update.title)
        },
      }),
      ndJsonStream(
        new WritableStream<Uint8Array>({
          write: (chunk) =>
            new Promise<void>((resolve, reject) => {
              child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()))
            }),
        }),
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            child.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
            child.stdout.on('end', () => controller.close())
            child.stdout.on('error', (error) => controller.error(error))
          },
        }),
      ),
    )
    const abort = () => stopChild(child)
    run.signal.addEventListener('abort', abort, {
      once: true,
    })
    let rejectExit: (error: Error) => void = () => {}
    const exited = new Promise<never>((_, reject) => {
      rejectExit = reject
    })
    void exited.catch(() => {})
    child.on('error', rejectExit)
    child.on('exit', (code) => rejectExit(new Error(`ACP exited (${code}). ${stderr}`)))
    const timeout = setTimeout(() => rejectExit(new Error('ACP initialization timed out')), 30000)
    try {
      const initialization = await Promise.race([
        rpc.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: false,
              writeTextFile: false,
            },
            terminal: false,
            elicitation: {
              form: {},
            },
          },
          clientInfo: {
            name: 'dovo-studio',
            version: '0.1.0',
          },
        }),
        exited,
      ])
      if (run.sessionId && !initialization.agentCapabilities?.loadSession)
        throw new Error('This ACP agent cannot resume sessions. Start a new session explicitly.')
      const mcpServers = acpMcpServers(run.agent.resources?.mcpServers ?? [])
      if (
        mcpServers.some((server) => 'type' in server && server.type === 'http') &&
        !initialization.agentCapabilities?.mcpCapabilities?.http
      )
        throw new Error('This ACP harness does not support HTTP MCP servers')
      const session = await Promise.race([
        run.sessionId
          ? rpc.loadSession({
              sessionId: run.sessionId,
              cwd: run.cwd,
              mcpServers,
            })
          : rpc.newSession({
              cwd: run.cwd,
              mcpServers,
            }),
        exited,
      ])
      const id =
        run.sessionId ??
        decode(
          mutableStruct({
            sessionId: Schema.String,
          }),
          session,
        ).sessionId
      if (!id) throw new Error('ACP agent did not return a session id')
      run.onSession(id)
      if (run.agent.permission === 'read-only') {
        const mode = session.modes?.availableModes.find((mode) =>
          /^(plan|read[-_ ]?only)$/i.test(mode.id),
        )
        if (!mode) throw new Error('This ACP agent does not advertise a read-only mode')
        await rpc.setSessionMode({
          sessionId: id,
          modeId: mode.id,
        })
      }
      let configOptions = session.configOptions
      if (run.agent.model) {
        const model = session.configOptions?.find((option) => option.category === 'model')
        if (!model) throw new Error('ACP agent does not advertise model configuration')
        const updated = await rpc.setSessionConfigOption({
          sessionId: id,
          configId: model.id,
          value: run.agent.model,
        })
        configOptions = updated.configOptions
      }
      if (run.agent.reasoning) {
        const option = configOptions?.find(
          (o) => o.category === 'thought_level' && o.type === 'select',
        )
        if (!option) throw new Error('This ACP model does not advertise reasoning configuration')
        await rpc.setSessionConfigOption({
          sessionId: id,
          configId: option.id,
          value: run.agent.reasoning,
        })
      }
      clearTimeout(timeout)
      if (run.signal.aborted) throw new Error('Task cancelled')
      if (
        run.attachments?.some(isImageAttachment) &&
        !initialization.agentCapabilities?.promptCapabilities?.image
      )
        run.onActivity(
          'This ACP agent does not accept image input; images are available as attached files only.',
        )
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
      if (result.stopReason !== 'end_turn') throw new Error(`ACP stopped: ${result.stopReason}`)
    } finally {
      clearTimeout(timeout)
      run.signal.removeEventListener('abort', abort)
      stopChild(child)
    }
  },
}
