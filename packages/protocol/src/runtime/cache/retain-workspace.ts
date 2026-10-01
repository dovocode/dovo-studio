import type { Workspace } from '../../workspace.js'

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/** Snapshot fields are decoded JSON, with no cycles or mutable native objects. */
function sameData(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true
  if (Array.isArray(previous) && Array.isArray(next))
    return (
      previous.length === next.length &&
      previous.every((value, index) => sameData(value, next[index]))
    )
  if (!record(previous) || !record(next)) return false
  const keys = Object.keys(previous)
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.hasOwn(next, key) && sameData(previous[key], next[key]))
  )
}

function retainCollection<T extends { id: string }>(previous: T[], next: T[]): T[] {
  if (previous === next) return previous
  const byId = new Map(previous.map((item) => [item.id, item]))
  const retained = next.map((item) => {
    const old = byId.get(item.id)
    return old && sameData(old, item) ? old : item
  })
  return previous.length === retained.length &&
    retained.every((item, index) => item === previous[index])
    ? previous
    : retained
}

/** Preserve unrelated entities across a fresh snapshot, without mutating either input. */
export function retainWorkspace(previous: Workspace, next: Workspace): Workspace {
  if (previous === next) return previous
  const result: Workspace = {
    ...next,
    agents: retainCollection(previous.agents, next.agents),
    repositories: retainCollection(previous.repositories, next.repositories),
    tasks: retainCollection(previous.tasks, next.tasks),
    automations: retainCollection(previous.automations, next.automations),
    planLimits: sameData(previous.planLimits, next.planLimits)
      ? previous.planLimits
      : next.planLimits,
    jiraSources: sameData(previous.jiraSources, next.jiraSources)
      ? previous.jiraSources
      : next.jiraSources,
    jiraIssueLinks: sameData(previous.jiraIssueLinks, next.jiraIssueLinks)
      ? previous.jiraIssueLinks
      : next.jiraIssueLinks,
  }
  return Object.keys(result).every((key) =>
    Object.is(result[key as keyof Workspace], previous[key as keyof Workspace]),
  )
    ? previous
    : result
}
