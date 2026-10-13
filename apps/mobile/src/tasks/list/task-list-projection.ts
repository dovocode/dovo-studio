import {
  aggregateRuntimeTasks,
  indexTaskSubagents,
  type RuntimeOverview,
  type RuntimeProfile,
  type RuntimeSnapshot,
  type RuntimeTask,
  type Subagent,
  type Repository,
  type Agent,
} from '@dovo/protocol'

/** Only owner facts used by a row; task history and other snapshot data stay out of its props. */
export type TaskListOwner = {
  profile: RuntimeProfile
  runtimeIcon: RuntimeSnapshot['runtimeIcon']
  repository: Repository | undefined
  agents: readonly Agent[]
  acpInstallations: RuntimeSnapshot['acpInstallations']
}
export type TaskListRowData = {
  row: RuntimeTask
  owner: TaskListOwner
  subagents: readonly Subagent[]
}
const noAgents: readonly Agent[] = []
const noInstallations: RuntimeSnapshot['acpInstallations'] = []
const noSubagents: readonly Subagent[] = []

/** Retain unchanged row facts, dropping removed rows on every projection. */
export function taskListProjection(
  overviews: readonly RuntimeOverview[],
  now: number,
  previous: ReadonlyMap<string, TaskListRowData> = new Map(),
) {
  const sources = new Map(overviews.map((overview) => [overview.profile.id, overview]))
  const children = new Map(
    overviews.map((overview) => [
      overview.profile.id,
      indexTaskSubagents(overview.snapshot?.workspace.tasks ?? []),
    ]),
  )
  const priorInstallations = new Map(
    [...previous.values()].map((data) => [data.row.runtimeId, data.owner.acpInstallations]),
  )
  const installations = new Map(
    overviews.map((source) => {
      const next = source.snapshot?.acpInstallations ?? noInstallations
      const prior = priorInstallations.get(source.profile.id)
      return [
        source.profile.id,
        prior && JSON.stringify(prior) === JSON.stringify(next) ? prior : next,
      ] as const
    }),
  )
  const rows = new Map<string, TaskListRowData>()
  for (const next of aggregateRuntimeTasks(overviews, now, true)) {
    const source = sources.get(next.runtimeId)
    if (!source) throw new Error('Task owner is missing from the list projection')
    const prior = previous.get(next.key)
    const row =
      prior &&
      prior.row.task === next.task &&
      prior.row.runtimeId === next.runtimeId &&
      prior.row.runtimeName === next.runtimeName &&
      prior.row.projectName === next.projectName &&
      prior.row.needsInput === next.needsInput &&
      prior.row.online === next.online &&
      prior.row.reachability === next.reachability
        ? prior.row
        : next
    const nextOwner: TaskListOwner = {
      profile: source.profile,
      runtimeIcon: source.snapshot?.runtimeIcon,
      repository: source.snapshot?.workspace.repositories.find(
        (repository) => repository.id === next.task.repositoryId,
      ),
      agents: source.snapshot?.workspace.agents ?? noAgents,
      acpInstallations: installations.get(source.profile.id) ?? noInstallations,
    }
    const owner =
      prior &&
      prior.owner.profile === nextOwner.profile &&
      prior.owner.runtimeIcon === nextOwner.runtimeIcon &&
      prior.owner.repository === nextOwner.repository &&
      prior.owner.agents === nextOwner.agents &&
      prior.owner.acpInstallations === nextOwner.acpInstallations
        ? prior.owner
        : nextOwner
    const nextChildren = children.get(next.runtimeId)?.(next.task, true) ?? noSubagents
    const subagents =
      prior &&
      prior.subagents.length === nextChildren.length &&
      prior.subagents.every((agent, index) => agent === nextChildren[index])
        ? prior.subagents
        : nextChildren.length
          ? nextChildren
          : noSubagents
    rows.set(
      row.key,
      prior && prior.row === row && prior.owner === owner && prior.subagents === subagents
        ? prior
        : { row, owner, subagents },
    )
  }
  return rows
}
