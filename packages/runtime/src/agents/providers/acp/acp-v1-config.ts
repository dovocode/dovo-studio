import {
  methods,
  type NewSessionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk/unstable'
import { acpControl, type openAcpConnection } from './acp-connection.js'
import type { PermissionPolicy } from '@dovo/protocol'
import {
  acpPermissionModeOption,
  acpReadOnlyMode,
  antigravityPermissionMode,
} from './acp-permissions.js'

type Connection = ReturnType<typeof openAcpConnection>

export function acpV1ModeOption(options: readonly SessionConfigOption[] | null | undefined) {
  return options?.find((option) => option.category === 'mode' && option.type === 'select')
}

export function acpV1OptionOffers(option: SessionConfigOption, value: string) {
  return option.type === 'boolean'
    ? value === 'true' || value === 'false'
    : option.options
        .flatMap((item) => ('options' in item ? item.options : [item]))
        .some((item) => item.value === value)
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
  if (!acpV1OptionOffers(option, value))
    throw new Error(
      option.type === 'boolean'
        ? `ACP configuration ${option.id} must be true or false`
        : `ACP configuration ${option.id} does not offer ${value}`,
    )
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
  antigravity?: PermissionPolicy,
) {
  const option =
    acpV1ModeOption(session.configOptions) ??
    (antigravity
      ? session.configOptions?.find(
          (item) => item.type === 'select' && acpPermissionModeOption(item, item.id),
        )
      : undefined)
  const choices =
    option?.type === 'select'
      ? option.options
          .flatMap((item) => ('options' in item ? item.options : [item]))
          .map(({ value }) => value)
      : session.modes?.availableModes.map(({ id }) => id)
  const selected = antigravity
    ? antigravityPermissionMode(choices ?? [], mode, antigravity, restrictive)
    : restrictive
      ? acpReadOnlyMode(choices ?? [])
      : choices?.find((id) => id === mode)
  if (!selected)
    throw new Error(
      restrictive
        ? 'This ACP agent does not advertise a read-only mode'
        : antigravity
          ? 'Antigravity does not advertise a mode that can apply this thread’s permissions'
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
