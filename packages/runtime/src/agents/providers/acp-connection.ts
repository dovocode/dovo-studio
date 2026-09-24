import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Client,
  InitializeResponse,
  ClientCapabilities,
  ListSessionsRequest,
} from '@agentclientprotocol/sdk'
import { processEnvironment } from '../../process.js'
import { stopAcpChild } from './acp-process.js'
import type { AcpLaunch } from '../types.js'

export type AcpInitialization = InitializeResponse

export function legacyAcpLaunch(endpoint: string, args: string[] = []): AcpLaunch {
  return { command: endpoint, args, env: {} }
}

export function openAcpConnection(
  launch: AcpLaunch,
  client: Client,
  cwd?: string,
  signal?: AbortSignal,
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
  child.stderr.resume()
  const rpc = new ClientSideConnection(
    () => client,
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
  let rejectExit: (error: Error) => void = () => {}
  const exited = new Promise<never>((_, reject) => {
    rejectExit = reject
  })
  void exited.catch(() => {})
  child.on('error', rejectExit)
  child.on('exit', (code) =>
    rejectExit(new Error(`ACP ${basename(launch.command)} exited (${code})`)),
  )
  const close = () => {
    signal?.removeEventListener('abort', abort)
    return stopAcpChild(child)
  }
  const abort = () => {
    void close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  return { rpc, exited, close }
}

export async function initializeAcp(
  connection: ReturnType<typeof openAcpConnection>,
  capabilities: ClientCapabilities = {},
): Promise<AcpInitialization> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      connection.rpc.initialize({
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

export async function authenticateAcp(launch: AcpLaunch, methodId: string, signal?: AbortSignal) {
  const connection = openAcpConnection(launch, noClientServices, undefined, signal)
  try {
    const initialization = await initializeAcp(connection, { auth: { terminal: true } })
    const method = initialization.authMethods?.find((entry) => entry.id === methodId)
    if (!method) throw new Error('ACP authentication method is unavailable')
    if ('type' in method && method.type === 'terminal')
      throw new Error('Terminal authentication must run in an interactive terminal')
    await withTimeout(Promise.race([connection.rpc.authenticate({ methodId }), connection.exited]))
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
    await withTimeout(Promise.race([connection.rpc.logout({}), connection.exited]))
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
      ...(await acpControl(connection, connection.rpc.listSessions(input), 'session list')),
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
    await acpControl(connection, connection.rpc.deleteSession({ sessionId }), 'session deletion')
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
