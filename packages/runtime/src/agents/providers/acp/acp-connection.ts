import { withAcpV2, v2AuthMethods } from './acp-v2-services.js'
import type { AcpClient } from './acp-client.js'
import {
  client as acpClient,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  McpOverAcpProvider,
} from '@agentclientprotocol/sdk/unstable'
import type {
  InitializeResponse,
  ClientCapabilities,
  ListSessionsRequest,
} from '@agentclientprotocol/sdk/unstable'
import { openAcpTransport } from './acp-transport.js'
export { ACP_MAX_MESSAGE_BYTES } from './acp-transport.js'
import type { AcpLaunch } from '../../execution/types.js'

export type AcpInitialization = InitializeResponse

const required = <T>(handler: T | undefined, method: string): T => {
  if (handler === undefined) throw RequestError.methodNotFound(method)
  return handler
}

export function legacyAcpLaunch(endpoint: string, args: string[] = []): AcpLaunch {
  return { command: endpoint, args, env: {} }
}

export function openAcpConnection(
  launch: AcpLaunch,
  client: AcpClient,
  cwd?: string,
  signal?: AbortSignal,
  onStderr?: (text: string) => void,
) {
  const mcp = new McpOverAcpProvider()
  const app = acpClient({ name: 'dovo-studio' })
    .onRequest(methods.client.mcp.message, mcp.handleRequest)
    .onRequest(methods.client.session.requestPermission, ({ params }) =>
      client.requestPermission(params),
    )
    .onNotification(methods.client.session.update, ({ params }) => client.sessionUpdate(params))
    .onRequest(methods.client.fs.readTextFile, ({ params }) =>
      required(client.readTextFile?.bind(client), methods.client.fs.readTextFile)(params),
    )
    .onRequest(methods.client.fs.writeTextFile, ({ params }) =>
      required(client.writeTextFile?.bind(client), methods.client.fs.writeTextFile)(params),
    )
    .onRequest(methods.client.terminal.create, ({ params }) =>
      required(client.createTerminal?.bind(client), methods.client.terminal.create)(params),
    )
    .onRequest(methods.client.terminal.output, ({ params }) =>
      required(client.terminalOutput?.bind(client), methods.client.terminal.output)(params),
    )
    .onRequest(methods.client.terminal.waitForExit, ({ params }) =>
      required(
        client.waitForTerminalExit?.bind(client),
        methods.client.terminal.waitForExit,
      )(params),
    )
    .onRequest(methods.client.terminal.kill, ({ params }) =>
      required(client.killTerminal?.bind(client), methods.client.terminal.kill)(params),
    )
    .onRequest(methods.client.terminal.release, ({ params }) =>
      required(client.releaseTerminal?.bind(client), methods.client.terminal.release)(params),
    )
    .onRequest(methods.client.elicitation.create, ({ params }) =>
      required(client.createElicitation?.bind(client), methods.client.elicitation.create)(params),
    )
  const transport = openAcpTransport(launch, (stream) => app.connect(stream), cwd, signal, onStderr)
  return {
    ...transport,
    rpc: transport.active.agent,
    signal: transport.active.signal,
    closed: transport.active.closed,
    mcp,
  }
}

export async function initializeAcp(
  connection: ReturnType<typeof openAcpConnection>,
  capabilities: ClientCapabilities = {},
): Promise<AcpInitialization> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      connection.rpc.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: capabilities,
        clientInfo: { name: 'dovo-studio', version: '0.1.0' },
      }),
      connection.exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('ACP initialization timed out')), 30000)
      }),
    ])
    if (result.protocolVersion !== PROTOCOL_VERSION)
      throw new Error(`ACP protocol version ${result.protocolVersion} is unsupported`)
    if (connection.authentication === 'grok') {
      const methodsAvailable = new Set(result.authMethods?.map((method) => method.id))
      const methodId =
        connection.apiKey && methodsAvailable.has('xai.api_key')
          ? 'xai.api_key'
          : methodsAvailable.has('cached_token')
            ? 'cached_token'
            : undefined
      if (!methodId)
        throw new Error('Run grok login on this runtime, or set XAI_API_KEY on the agent')
      await acpControl(
        connection,
        connection.rpc.request(methods.agent.authenticate, { methodId, _meta: { headless: true } }),
        'Grok authentication',
      )
    }
    return result
  } finally {
    clearTimeout(timeout)
  }
}

export async function acpControl<T>(
  connection: ReturnType<typeof openAcpConnection>,
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      connection.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ACP ${label} timed out`)), 30000)
      }),
    ])
  } catch (error) {
    if (
      error instanceof Error &&
      'data' in error &&
      error.data &&
      typeof error.data === 'object' &&
      'details' in error.data &&
      typeof error.data.details === 'string'
    )
      throw new Error(`ACP ${label}: ${error.message}: ${error.data.details.slice(0, 4000)}`, {
        cause: error,
      })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const noClientServices: AcpClient = {
  requestPermission: () => ({ outcome: { outcome: 'cancelled' } }),
  sessionUpdate: () => {},
}

export async function inspectAcp(launch: AcpLaunch, signal?: AbortSignal) {
  const v2 = await withAcpV2(
    launch,
    async (_connection, initialization) => ({
      agentInfo: initialization.info,
      authMethods: v2AuthMethods(initialization),
      canLogout: !!initialization.authMethods?.length,
    }),
    signal,
  )
  if (v2.handled) return v2.value
  const connection = openAcpConnection(launch, noClientServices, undefined, signal)
  try {
    const initialization = await initializeAcp(connection, { auth: { terminal: true } })
    return {
      agentInfo: initialization.agentInfo,
      authMethods: initialization.authMethods ?? [],
      canLogout: !!initialization.agentCapabilities?.auth?.logout,
    }
  } finally {
    await connection.close()
  }
}

export async function authenticateAcp(
  launch: AcpLaunch,
  methodId: string,
  signal?: AbortSignal,
  onOutput?: (text: string) => void,
) {
  const v2 = await withAcpV2(
    launch,
    async (connection, initialization) => {
      const method = initialization.authMethods?.find((method) => method.methodId === methodId)
      if (!method) throw new Error('ACP authentication method is unavailable')
      if (method.type === 'terminal')
        throw new Error('Terminal authentication must run in an interactive terminal')
      if (method.type !== 'agent') throw new Error('This ACP authentication method is unsupported')
      await connection.control(
        connection.rpc.request('auth/login', { methodId }),
        'authentication',
        5 * 60_000,
      )
    },
    signal,
    onOutput,
  )
  if (v2.handled) return
  const connection = openAcpConnection(launch, noClientServices, undefined, signal, onOutput)
  try {
    const initialization = await initializeAcp(connection, { auth: { terminal: true } })
    const method = initialization.authMethods?.find((entry) => entry.id === methodId)
    if (!method) throw new Error('ACP authentication method is unavailable')
    if ('type' in method && method.type === 'terminal')
      throw new Error('Terminal authentication must run in an interactive terminal')
    await withTimeout(
      Promise.race([
        connection.rpc.request(methods.agent.authenticate, { methodId }),
        connection.exited,
      ]),
    )
  } finally {
    await connection.close()
  }
}

export async function logoutAcp(launch: AcpLaunch, signal?: AbortSignal) {
  const v2 = await withAcpV2(
    launch,
    async (connection, initialization) => {
      if (!initialization.authMethods?.length)
        throw new Error('This ACP agent does not support logout')
      await connection.control(connection.rpc.request('auth/logout', {}), 'logout')
    },
    signal,
  )
  if (v2.handled) return
  const connection = openAcpConnection(launch, noClientServices, undefined, signal)
  try {
    const initialization = await initializeAcp(connection)
    if (!initialization.agentCapabilities?.auth?.logout)
      throw new Error('This ACP agent does not support logout')
    await withTimeout(
      Promise.race([connection.rpc.request(methods.agent.logout, {}), connection.exited]),
    )
  } finally {
    await connection.close()
  }
}

export async function listAcpSessions(
  launch: AcpLaunch,
  input: ListSessionsRequest = {},
  signal?: AbortSignal,
) {
  const v2 = await withAcpV2(
    launch,
    async (connection, initialization) => {
      if (!initialization.capabilities?.session)
        throw new Error('This ACP agent does not support listing sessions')
      return {
        ...(await connection.control(
          connection.rpc.request('session/list', input),
          'session list',
        )),
        canDelete: !!initialization.capabilities.session.delete,
      }
    },
    signal,
  )
  if (v2.handled) return v2.value
  const connection = openAcpConnection(launch, noClientServices, undefined, signal)
  try {
    const initialization = await initializeAcp(connection)
    if (!initialization.agentCapabilities?.sessionCapabilities?.list)
      throw new Error('This ACP agent does not support listing sessions')
    return {
      ...(await acpControl(
        connection,
        connection.rpc.request(methods.agent.session.list, input),
        'session list',
      )),
      canDelete: !!initialization.agentCapabilities.sessionCapabilities.delete,
    }
  } finally {
    await connection.close()
  }
}

export async function deleteAcpSession(launch: AcpLaunch, sessionId: string, signal?: AbortSignal) {
  const v2 = await withAcpV2(
    launch,
    async (connection, initialization) => {
      if (!initialization.capabilities?.session?.delete)
        throw new Error('This ACP agent does not support deleting sessions')
      await connection.control(
        connection.rpc.request('session/delete', { sessionId }),
        'session deletion',
      )
    },
    signal,
  )
  if (v2.handled) return
  const connection = openAcpConnection(launch, noClientServices, undefined, signal)
  try {
    const initialization = await initializeAcp(connection)
    if (!initialization.agentCapabilities?.sessionCapabilities?.delete)
      throw new Error('This ACP agent does not support deleting sessions')
    await acpControl(
      connection,
      connection.rpc.request(methods.agent.session.delete, { sessionId }),
      'session deletion',
    )
  } finally {
    await connection.close()
  }
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ACP authentication timed out')), 5 * 60_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
