import { useWorkspace } from './provider'
import { runtimeComputerName } from '@dovo/protocol'
import { isActiveRuntime } from '../runtime/ownership'

/** All saved computers, including cached workspaces while a host is offline. */
export function useRuntimeSources() {
  const { runtimes, activeRuntimeId, connection, connected } = useWorkspace()
  return runtimes.map((entry) => ({
    ...entry,
    name: runtimeComputerName(entry),
    scope: JSON.stringify([entry.profile.id, entry.profile.connection]),
    connected: isActiveRuntime(entry.profile, activeRuntimeId, connection)
      ? connected
      : entry.connected,
  }))
}
