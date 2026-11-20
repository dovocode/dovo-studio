import {
  methods,
  type NewSessionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk/unstable'
import { acpControl, type openAcpConnection } from './acp-connection.js'

type Connection = ReturnType<typeof openAcpConnection>

export function acpV1ModeOption(options: readonly SessionConfigOption[] | null | undefined) {
  return options?.find((option) => option.category === 'mode' && option.type === 'select')
}

export async function applyAcpV1Option(
  connection: Connection,
  sessionId: string,
  options: SessionConfigOption[],
  option: SessionConfigOption,
  value: string,
  phase = 'configuration',
) {
  if (String(option.currentValue) === value) return options
  if (option.type === 'boolean' && value !== 'true' && value !== 'false')
    throw new Error(`ACP configuration ${option.id} must be true or false`)
  if (
    option.type === 'select' &&
    !option.options
      .flatMap((item) => ('options' in item ? item.options : [item]))
      .some((item) => item.value === value)
  )
    throw new Error(`ACP configuration ${option.id} does not offer ${value}`)
  const { configOptions } = await acpControl(
    connection,
    connection.rpc.request(methods.agent.session.setConfigOption, {
      sessionId,
      configId: option.id,
      ...(option.type === 'boolean'
        ? { type: 'boolean' as const, value: value === 'true' }
        : { value }),
    }),
    phase,
  )
  const applied = configOptions.find((updated) => updated.id === option.id)
  if (!applied || String(applied.currentValue) !== value)
    throw new Error(`ACP did not apply ${option.name}: ${value}`)
  return configOptions
}

export async function setAcpV1Mode(
  connection: Connection,
  sessionId: string,
  session: Pick<NewSessionResponse, 'modes' | 'configOptions'>,
  mode: string | undefined,
  restrictive = false,
) {
  const option = acpV1ModeOption(session.configOptions)
  const choices =
    option?.type === 'select'
      ? option.options
          .flatMap((item) => ('options' in item ? item.options : [item]))
          .map(({ value }) => value)
      : session.modes?.availableModes.map(({ id }) => id)
  const selected = restrictive
    ? choices?.find((id) => /^(plan|read[-_ ]?only)$/i.test(id))
    : choices?.find((id) => id === mode)
  if (!selected)
    throw new Error(
      restrictive
        ? 'This ACP agent does not advertise a read-only mode'
        : 'This ACP agent does not advertise the selected mode',
    )
  if (option && session.configOptions)
    return applyAcpV1Option(
      connection,
      sessionId,
      session.configOptions,
      option,
      selected,
      'mode selection',
    )
  if (session.modes?.currentModeId !== selected)
    await acpControl(
      connection,
      connection.rpc.request(methods.agent.session.setMode, { sessionId, modeId: selected }),
      'mode selection',
    )
  return undefined
}
