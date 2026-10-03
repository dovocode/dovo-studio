import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import {
  client as acpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'
import type {
  Client,
  InitializeResponse,
  ClientCapabilities,
  ListSessionsRequest,
} from '@agentclientprotocol/sdk'
import { processEnvironment } from '../../../process.js'
import { stopAcpChild } from './acp-process.js'
import type { AcpLaunch } from '../../execution/types.js'

export type AcpInitialization = InitializeResponse

// Keep the SDK’s 32 MiB default explicit; large image prompts remain supported.
export const ACP_MAX_MESSAGE_BYTES = 32 * 1024 * 1024

const required = <T>(handler: T | undefined, method: string): T => {
  if (handler === undefined) throw RequestError.methodNotFound(method)
  return handler
}

export function legacyAcpLaunch(endpoint: string, args: string[] = []): AcpLaunch {
  return { command: endpoint, args, env: {} }
}

export function openAcpConnection(
  launch: AcpLaunch,
  client: Client,
  cwd?: string,
  signal?: AbortSignal,
  onStderr?: (text: string) => void,
) {
  signal?.throwIfAborted()
  const env = { ...processEnvironment(), ...launch.env }
  delete env.DOVO_OWNER_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(launch.command, launch.args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (onStderr) {
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', onStderr)
  } else child.stderr.resume()
  const app = acpClient({ name: 'dovo-studio' })
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
  let inputClosed = false
  const active = app.connect(
    ndJsonStream(
      new WritableStream<Uint8Array>({
        write: (chunk) =>
          new Promise<void>((resolve, reject) => {
            child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()))
          }),
      }),
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          child.stdout.on('data', (chunk: Buffer) => {
            if (!inputClosed) controller.enqueue(new Uint8Array(chunk))
          })
          child.stdout.on('end', () => {
            if (!inputClosed) controller.close()
            inputClosed = true
          })
          child.stdout.on('error', (error) => {
            if (!inputClosed) controller.error(error)
            inputClosed = true
          })
        },
        cancel: () => {
          inputClosed = true
          child.stdout.destroy()
        },
      }),
      { maxMessageBytes: ACP_MAX_MESSAGE_BYTES },
    ),
  )
  const rpc = active.agent
  let rejectExit: (error: Error) => void = () => {}
  const exited = new Promise<never>((_, reject) => {
    rejectExit = reject
  })
  void exited.catch(() => {})
  void active.closed.then(() => {
    rejectExit(
      active.signal.reason instanceof Error
        ? active.signal.reason
        : new Error('ACP connection closed'),
    )
    void close()
  })
  child.on('error', rejectExit)
  // An agent that exits closes stdin; an unobserved pipe 'error' would crash the runtime.
  child.stdin.on('error', (error) => rejectExit(error))
  child.on('exit', (code) =>
    rejectExit(new Error(`ACP ${basename(launch.command)} exited (${code})`)),
  )
  const close = () => {
    signal?.removeEventListener('abort', abort)
    active.close()
    return stopAcpChild(child)
  }
  const abort = () => {
    void close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  return { rpc, signal: active.signal, closed: active.closed, exited, close }
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

const noClientServices: Client = {
  requestPermission: () => ({ outcome: { outcome: 'cancelled' } }),
  sessionUpdate: () => {},
}

export async function inspectAcp(launch: AcpLaunch, signal?: AbortSignal) {
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
