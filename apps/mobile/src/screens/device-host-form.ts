import {
  decode,
  deviceHostSchema,
  deviceHostSettingsResultSchema,
  type DeviceHostSettings,
  normalizeRuntimeAddress,
  type DeviceHost,
  type PublicDeviceHost,
  type RuntimeProfile,
} from '@dovo/protocol'
import type { DeviceHostDraft } from './device-host-editor'

export function deviceHostDraft(host: PublicDeviceHost): DeviceHostDraft {
  return {
    ...host,
    sshPort: String(host.sshPort),
    identityFile: host.identityFile ?? '',
    pairedProfileId: '',
  }
}

export function deviceHostInput(
  draft: DeviceHostDraft,
  profiles: RuntimeProfile[],
  saved?: PublicDeviceHost,
): DeviceHost {
  if (!/^\d+$/.test(draft.sshPort.trim()))
    throw new Error('SSH port must be a whole number from 1 to 65535.')
  const destination = profiles.find((profile) => profile.id === draft.pairedProfileId)
  const runtimeAddress = normalizeRuntimeAddress(draft.runtimeAddress)
  if (
    !destination &&
    (!saved?.hasToken ||
      runtimeAddress !== saved.runtimeAddress ||
      draft.sshHost.trim() !== saved.sshHost ||
      draft.sshUser.trim() !== saved.sshUser ||
      Number(draft.sshPort) !== saved.sshPort)
  )
    throw new Error(
      'Choose a saved paired destination computer. Changing the SSH host, user, port or runtime address requires its pairing.',
    )
  return decode(deviceHostSchema, {
    id: draft.id,
    name: draft.name.trim(),
    sshHost: draft.sshHost.trim(),
    sshUser: draft.sshUser.trim(),
    sshPort: Number(draft.sshPort),
    identityFile: draft.identityFile.trim() || undefined,
    runtimeAddress,
    agentAccess: draft.agentAccess,
    ...(destination ? { token: destination.connection.token } : {}),
  })
}

/** Do not surface credentials echoed by a transport or destination error. */
export function deviceHostMessage(message: string, profiles: RuntimeProfile[]): string {
  return profiles.reduce((safe, profile) => {
    const token = profile.connection.token
    return token
      ? safe.split(token).join('[redacted]').split(encodeURIComponent(token)).join('[redacted]')
      : safe
  }, message)
}

/** Keep the server revision and hub configuration with every host-list mutation. */
export function deviceHostSettingsInput(
  settings: typeof deviceHostSettingsResultSchema.Type,
): DeviceHostSettings {
  return { ...settings, hosts: settings.hosts.map(({ hasToken: _hasToken, ...host }) => host) }
}
