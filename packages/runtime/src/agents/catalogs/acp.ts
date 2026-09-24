import { homedir } from 'node:os'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { AcpLaunch } from '../types.js'
import {
  acpControl,
  initializeAcp,
  legacyAcpLaunch,
  openAcpConnection,
} from '../providers/acp-connection.js'

function options(config: SessionConfigOption[] | null | undefined, category: string) {
  const entry = config?.find((item) => item.category === category && item.type === 'select')
  return entry?.type === 'select'
    ? entry.options
        .flatMap((item) => ('options' in item ? item.options : [item]))
        .map((item) => ({ id: item.value, name: item.name }))
    : []
}

export async function acpModels(agent: AgentDiscovery, launch?: AcpLaunch): Promise<ModelCatalog> {
  if (!launch?.command && !agent.endpoint)
    throw new Error('Set an ACP executable to discover its models')
  const command = launch ?? legacyAcpLaunch(agent.endpoint, agent.args ?? [])
  let commands: Array<{ name: string; description: string; inputHint?: string }> = []
  let updatedConfig: SessionConfigOption[] | undefined
  const connection = openAcpConnection(command, {
    requestPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: ({ update }) => {
      if (update.sessionUpdate === 'available_commands_update')
        commands = update.availableCommands.map((item) => ({
          name: item.name,
          description: item.description,
          inputHint: item.input?.hint,
        }))
      if (update.sessionUpdate === 'config_option_update') updatedConfig = update.configOptions
    },
  })
  let closeSessionId: string | undefined
  let canClose = false
  let succeeded = false
  try {
    const initialization = await initializeAcp(connection, {
      session: { configOptions: { boolean: {} } },
    })
    canClose = !!initialization.agentCapabilities?.sessionCapabilities?.close
    const session = await acpControl(
      connection,
      connection.rpc.newSession({ cwd: homedir(), mcpServers: [] }),
      'model discovery',
    )
    closeSessionId = session.sessionId
    let config = session.configOptions
    if (agent.acpMode) {
      if (!session.modes?.availableModes.some((mode) => mode.id === agent.acpMode))
        throw new Error('This ACP agent does not advertise the selected mode')
      await acpControl(
        connection,
        connection.rpc.setSessionMode({
          sessionId: session.sessionId,
          modeId: agent.acpMode,
        }),
        'mode selection',
      )
      config = updatedConfig ?? config
    }
    const models = options(config, 'model')
    const modelOption = config?.find((item) => item.category === 'model' && item.type === 'select')
    if (agent.model && modelOption) {
      config = (
        await acpControl(
          connection,
          connection.rpc.setSessionConfigOption({
            sessionId: session.sessionId,
            configId: modelOption.id,
            value: agent.model,
          }),
          'model discovery',
        )
      ).configOptions
    }
    for (const [configId, value] of Object.entries(agent.acpConfig ?? {})) {
      const option = config?.find((item) => item.id === configId)
      if (!option) throw new Error(`ACP configuration ${configId} is unavailable`)
      if (option.type === 'boolean') {
        if (value !== 'true' && value !== 'false')
          throw new Error(`ACP configuration ${configId} must be true or false`)
        config = (
          await acpControl(
            connection,
            connection.rpc.setSessionConfigOption({
              sessionId: session.sessionId,
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
        config = (
          await acpControl(
            connection,
            connection.rpc.setSessionConfigOption({
              sessionId: session.sessionId,
              configId,
              value,
            }),
            'configuration',
          )
        ).configOptions
      }
    }
    const catalog: ModelCatalog = {
      models,
      reasoning: options(config, 'thought_level'),
      acp: {
        modes:
          session.modes?.availableModes.map((mode) => ({ id: mode.id, name: mode.name })) ?? [],
        configOptions: (config ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category ?? undefined,
          currentValue: String(item.currentValue),
          options:
            item.type === 'boolean'
              ? [
                  { id: 'true', name: 'On' },
                  { id: 'false', name: 'Off' },
                ]
              : item.options
                  .flatMap((choice) => ('options' in choice ? choice.options : [choice]))
                  .map((choice) => ({ id: choice.value, name: choice.name })),
        })),
        commands,
      },
    }
    succeeded = true
    return catalog
  } finally {
    try {
      if (succeeded && canClose && closeSessionId && !connection.rpc.signal.aborted)
        await acpControl(
          connection,
          connection.rpc.closeSession({ sessionId: closeSessionId }),
          'session close',
        )
    } finally {
      await connection.close()
    }
  }
}
