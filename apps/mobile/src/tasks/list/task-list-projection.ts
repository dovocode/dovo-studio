import {
  aggregateRuntimeTasks,
  taskBackgroundTerminalCount,
  taskDisplayProject,
  projectDisplayName,
  buildThreadTree,
  type NestedThread,
  indexTaskSubagents,
  projectSubagentList,
  type RuntimeOverview,
  type RuntimeProfile,
  type RuntimeSnapshot,
  type RuntimeTask,
  type SubagentListItem,
  type Repository,
  type Agent,
} from '@dovo/protocol'

/** Only owner facts used by a row; task history and other snapshot data stay out of its props. */
export type TaskListOwner = {
  activeTerminals: number
  profile: RuntimeProfile
  runtimeIcon: RuntimeSnapshot['runtimeIcon']
  taskListUndoSupported: boolean
  repository: Repository | undefined
  displayProject?: Repository
  agents: readonly Agent[]
  acpInstallations: RuntimeSnapshot['acpInstallations']
}
export type TaskListRowData = {
  row: RuntimeTask
  owner: TaskListOwner
  subagents: readonly SubagentListItem[]
}
const noAgents: readonly Agent[] = []
const noInstallations: RuntimeSnapshot['acpInstallations'] = []
const noSubagents: readonly SubagentListItem[] = []

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
  const terminalCounts = new Map(
    overviews.map((source) => {
      const counts = new Map<string, number>()
      for (const terminal of source.snapshot?.terminals ?? [])
        if (!terminal.exited) counts.set(terminal.taskId, (counts.get(terminal.taskId) ?? 0) + 1)
      return [source.profile.id, counts] as const
    }),
  )
  const rows = new Map<string, TaskListRowData>()
  for (const next of aggregateRuntimeTasks(overviews, now, true)) {
    const source = sources.get(next.runtimeId)
    if (!source) throw new Error('Task owner is missing from the list projection')
    const repository = source.snapshot?.workspace.repositories.find(
      (repository) => repository.id === next.task.repositoryId,
    )
    const displayProject = taskDisplayProject(
      next.task,
      source.snapshot?.workspace.repositories ?? [],
    )
    next.projectName = projectDisplayName(displayProject)
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
      activeTerminals:
        (terminalCounts.get(next.runtimeId)?.get(next.task.id) ?? 0) +
        taskBackgroundTerminalCount(next.task),
      profile: source.profile,
      runtimeIcon: source.snapshot?.runtimeIcon,
      taskListUndoSupported: source.snapshot?.taskListUndoSupported === true,
      repository,
      displayProject,
      agents: source.snapshot?.workspace.agents ?? noAgents,
      acpInstallations: installations.get(source.profile.id) ?? noInstallations,
    }
    const owner =
      prior &&
      prior.owner.activeTerminals === nextOwner.activeTerminals &&
      prior.owner.profile === nextOwner.profile &&
      prior.owner.runtimeIcon === nextOwner.runtimeIcon &&
      prior.owner.taskListUndoSupported === nextOwner.taskListUndoSupported &&
      prior.owner.repository === nextOwner.repository &&
      prior.owner.displayProject === nextOwner.displayProject &&
      prior.owner.agents === nextOwner.agents &&
      prior.owner.acpInstallations === nextOwner.acpInstallations
        ? prior.owner
        : nextOwner
    const nextChildren = (children.get(next.runtimeId)?.(next.task, true) ?? noSubagents).filter(
      (agent) => agent.source !== 'dovo',
    )
    const subagents = projectSubagentList(nextChildren, prior?.subagents ?? noSubagents)
    rows.set(
      row.key,
      prior && prior.row === row && prior.owner === owner && prior.subagents === subagents
        ? prior
        : { row, owner, subagents },
    )
  }
  return rows
}

/** Both clients use explicit delegation/watch ownership, including General and offline children. */
export function mobileThreadTree(
  rows: ReadonlyMap<string, TaskListRowData>,
  overviews: readonly RuntimeOverview[],
  previous?: ReadonlyMap<string, NestedThread>,
  include?: (row: RuntimeTask) => boolean,
  includeSnapshot?: (thread: NestedThread) => boolean,
) {
  const sources = new Map(overviews.map((source) => [source.profile.id, source]))
  return buildThreadTree(
    [...rows.values()].map(({ row }) => ({
      ...row,
      source: {
        runtimeId: row.runtimeId,
        name: row.runtimeName,
        online: row.online,
        snapshot: sources.get(row.runtimeId)?.snapshot ?? null,
      },
    })),
    previous,
    include,
    {
      includeSnapshot,
      runtimeIds: new Map(
        overviews.flatMap((source) => {
          const identity = source.snapshot?.runtimeId ?? source.profile.connection.runtimeId
          return identity ? [[identity, source.profile.id] as const] : []
        }),
      ),
    },
  )
}
