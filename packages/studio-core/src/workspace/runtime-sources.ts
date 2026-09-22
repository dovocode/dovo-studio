import { useWorkspace } from './provider'

/** All saved computers, including cached workspaces while a host is offline. */
export function useRuntimeSources() {
  const { runtimes, activeRuntimeId, connected } = useWorkspace()
  return runtimes.map((entry) => ({
    ...entry,
    name:
      entry.profile.name === new URL(entry.profile.connection.address).hostname
        ? (entry.snapshot?.runtimeHost ?? entry.profile.name)
        : entry.profile.name,
    scope: JSON.stringify([entry.profile.id, entry.profile.connection]),
    connected: entry.profile.id === activeRuntimeId ? connected : entry.connected,
  }))
}
