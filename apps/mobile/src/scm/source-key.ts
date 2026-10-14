import type { JiraSource } from '@dovo/protocol'

/** Labels are presentation; every other field identifies the configured destination. */
export function jiraDestination(source: JiraSource | undefined) {
  if (!source) return undefined
  const { name: _name, ...destination } = source
  return Object.entries(destination).sort(([a], [b]) => a.localeCompare(b))
}
