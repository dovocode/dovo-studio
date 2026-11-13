import type { AuthMethod as V1AuthMethod } from '@agentclientprotocol/sdk/unstable'
import { homedir } from 'node:os'
import {
  AuthMethod,
  SessionConfigOption,
  type InitializeResponse,
} from '@agentclientprotocol/sdk/experimental/v2'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import type { AcpLaunch } from '../../execution/types.js'
import { openAcpV2Connection, acpV2Enabled, AcpV1Fallback } from './acp-v2-connection.js'
import { configureAcpV2 } from './acp-v2-config.js'

/** The only fallback boundary is initialization, before running the requested operation. */
export async function withAcpV2<T>(
  launch: AcpLaunch,
  operation: (
    connection: ReturnType<typeof openAcpV2Connection>,
    initialization: InitializeResponse,
  ) => Promise<T>,
  signal?: AbortSignal,
  onOutput?: (text: string) => void,
): Promise<{ handled: true; value: T } | { handled: false }> {
  if (!acpV2Enabled(launch)) return { handled: false }
  const connection = openAcpV2Connection(launch, {}, undefined, signal, onOutput)
  try {
    let initialization
    try {
      initialization = await connection.initialize()
    } catch (error) {
      if (error instanceof AcpV1Fallback) return { handled: false }
      throw error
    }
    return { handled: true, value: await operation(connection, initialization) }
  } finally {
    await connection.close()
  }
}

export function v2AuthMethods(initialization: InitializeResponse): V1AuthMethod[] {
  return (initialization.authMethods ?? []).flatMap<V1AuthMethod>((method) => {
    if (AuthMethod.isTerminal(method))
      return [
        {
          id: method.methodId,
          name: method.name,
          description: method.description,
          type: 'terminal' as const,
          args: method.args,
          env: method.env
            ? Object.fromEntries(method.env.map((entry) => [entry.name, entry.value]))
            : undefined,
        },
      ]
    if (AuthMethod.isAgent(method))
      return [{ ...method, id: method.methodId, type: 'agent' as const }]
    return []
  })
}

export async function acpV2Models(launch: AcpLaunch, agent: AgentDiscovery) {
  return withAcpV2(launch, async (connection, initialization): Promise<ModelCatalog> => {
    if (!initialization.capabilities?.session)
      throw new Error('This ACP v2 agent does not support sessions')
    const session = await connection.control(
      connection.rpc.request('session/new', { cwd: homedir() }),
      'model discovery',
    )
    try {
      const options = await configureAcpV2(
        connection,
        session.sessionId,
        session.configOptions,
        agent,
      )
      const choices = (category: string) => {
        const option = options?.find(
          (option) => option.category === category && SessionConfigOption.isSelect(option),
        )
        return option && SessionConfigOption.isSelect(option)
          ? option.options
              .flatMap((item) => ('options' in item ? item.options : [item]))
              .map((item) => ({ id: item.value, name: item.name }))
          : []
      }
      return {
        models: choices('model'),
        reasoning: choices('thought_level'),
        acp: {
          modes: choices('mode'),
          configOptions: (options ?? []).flatMap((option) => {
            if (!SessionConfigOption.isSelect(option) && !SessionConfigOption.isBoolean(option))
              return []
            return [
              {
                id: option.configId,
                name: option.name,
                category: option.category ?? undefined,
                currentValue: String(option.currentValue),
                options: SessionConfigOption.isBoolean(option)
                  ? [
                      { id: 'true', name: 'On' },
                      { id: 'false', name: 'Off' },
                    ]
                  : option.options
                      .flatMap((item) => ('options' in item ? item.options : [item]))
                      .map((item) => ({ id: item.value, name: item.name })),
              },
            ]
          }),
          commands: (session.availableCommands ?? []).map((command) => ({
            name: command.name,
            description: command.description,
          })),
        },
      }
    } finally {
      await connection.control(
        connection.rpc.request('session/close', { sessionId: session.sessionId }),
        'session close',
      )
      if (initialization.capabilities?.session?.delete)
        await connection.control(
          connection.rpc.request('session/delete', { sessionId: session.sessionId }),
          'discovery session deletion',
        )
    }
  })
}
