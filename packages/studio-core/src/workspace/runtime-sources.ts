import { useWorkspace } from './provider'
import { runtimeComputerName } from '@dovo/protocol'

/** All saved computers, including cached workspaces while a host is offline. */
export function useRuntimeSources() {
  const { runtimes, activeRuntimeId, connected } = useWorkspace()
  return runtimes.map((entry) => ({
    ...entry,
    name: runtimeComputerName(entry),
    scope: JSON.stringify([entry.profile.id, entry.profile.connection]),
    connected: entry.profile.id === activeRuntimeId ? connected : entry.connected,
  }))
}
