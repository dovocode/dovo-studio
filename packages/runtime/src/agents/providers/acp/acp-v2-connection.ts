import {
  client,
  RequestError,
  AuthMethod,
  type ClientRequestHandlersByMethod,
  type UpdateSessionNotification,
  type AnyMessage,
  type InitializeResponse,
} from '@agentclientprotocol/sdk/experimental/v2'
import type { AcpLaunch } from '../../execution/types.js'
import { openAcpTransport } from './acp-transport.js'

export class AcpV1Fallback extends Error {
  constructor() {
    super('ACP agent selected protocol v1')
  }
}

/** Draft v2 is opt-in per launcher. An explicit zero overrides the host default. */
export function acpV2Enabled(launch: AcpLaunch) {
  return (launch.env.DOVO_ACP_V2 ?? process.env.DOVO_ACP_V2) === '1'
}

export function openAcpV2Connection(
  launch: AcpLaunch,
  handlers: {
    permission?: ClientRequestHandlersByMethod['session/request_permission']
    elicitation?: ClientRequestHandlersByMethod['elicitation/create']
    update?: (notification: UpdateSessionNotification) => void
  } = {},
  cwd?: string,
  signal?: AbortSignal,
  onStderr?: (text: string) => void,
) {
  let selectedV1 = false
  const app = client({ name: 'dovo-studio' })
    .onRequest(
      'session/request_permission',
      (ctx) => handlers.permission?.(ctx) ?? { outcome: { outcome: 'cancelled' } },
    )
    .onRequest('elicitation/create', (ctx) => handlers.elicitation?.(ctx) ?? { action: 'cancel' })
    .onNotification('session/update', ({ params }) => handlers.update?.(params))
  const transport = openAcpTransport(
    launch,
    (stream) =>
      app.connect({
        ...stream,
        readable: stream.readable.pipeThrough(
          new TransformStream<AnyMessage, AnyMessage>({
            transform(message, controller) {
              if (
                'result' in message &&
                message.result &&
                typeof message.result === 'object' &&
                'protocolVersion' in message.result &&
                message.result.protocolVersion === 1
              )
                selectedV1 = true
              controller.enqueue(message)
            },
          }),
        ),
      }),
    cwd,
    signal,
    onStderr,
  )
  const rpc = transport.active.agent
  const control = async <T>(operation: Promise<T>, label: string, milliseconds = 30_000) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        transport.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`ACP v2 ${label} timed out`)), milliseconds)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const initialize = async () => {
    let result: InitializeResponse
    try {
      result = await control(
        rpc.request('initialize', {
          protocolVersion: 2,
          info: { name: 'dovo-studio', version: '0.1.0' },
          capabilities: { auth: { terminal: {} }, elicitation: { form: {} } },
        }),
        'initialization',
      )
      if (result.protocolVersion === 1) throw new AcpV1Fallback()
      if (result.protocolVersion !== 2)
        throw new Error(`ACP protocol version ${result.protocolVersion} is unsupported`)
    } catch (error) {
      // Only an explicit v1 selection or supported-version error permits fallback.
      // Authentication, malformed responses and lost connections must remain errors.
      if (
        selectedV1 ||
        (error instanceof RequestError &&
          error.code === -32022 &&
          error.data &&
          typeof error.data === 'object' &&
          'supported' in error.data &&
          Array.isArray(error.data.supported) &&
          error.data.supported.includes(1))
      )
        throw new AcpV1Fallback()
      throw error
    }
    if (launch.authentication === 'grok') {
      const available = (result.authMethods ?? []).filter(AuthMethod.isAgent)
      const method =
        available.find(
          (method) => method.methodId === (transport.apiKey ? 'xai.api_key' : 'cached_token'),
        ) ?? available.find((method) => method.methodId === 'cached_token')
      if (!method)
        throw new Error('Run grok login on this runtime, or set XAI_API_KEY on the agent')
      await control(
        rpc.request('auth/login', { methodId: method.methodId, _meta: { headless: true } }),
        'Grok authentication',
      )
    }

    return result
  }
  return { ...transport, rpc, control, initialize, signal: transport.active.signal }
}
