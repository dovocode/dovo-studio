import {
  isActiveRuntime,
  type Automation,
  type JobRun,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeSnapshot,
  type Workspace,
} from '@dovo/studio-core'
import { pendingTaskInput, runLabels, runSteps } from './run-progress'

export type FleetAutomation = {
  key: string
  runtime: RuntimeOverview
  runtimeName: string
  flow: Automation
  runs: JobRun[]
  latest?: JobRun
  status: string
  needsInput: boolean
  projects: string[]
}

/** Keep unsynced edits on the open connection visible while other hosts use saved snapshots.
 * A saved computer whose address or pairing differs from the open one keeps its own snapshot. */
export function liveAutomationRuntimes(
  runtimes: readonly RuntimeOverview[],
  live: {
    activeRuntimeId: string | null
    connection: RuntimeConnection | null
    connected: boolean
    snapshot: RuntimeSnapshot | null
    workspace: Workspace
  },
): RuntimeOverview[] {
  return runtimes.map((entry) =>
    isActiveRuntime(entry.profile, live.activeRuntimeId, live.connection)
      ? {
          ...entry,
          connected: live.connected,
          snapshot: live.snapshot
            ? { ...live.snapshot, workspace: live.workspace }
            : entry.snapshot,
        }
      : entry,
  )
}

export function aggregateAutomations(runtimes: readonly RuntimeOverview[]): FleetAutomation[] {
  const rows = runtimes.flatMap((runtime) => {
    if (!runtime.snapshot) return []
    const { snapshot, profile } = runtime
    const projects = new Map(snapshot.workspace.repositories.map((repo) => [repo.id, repo.name]))
    const runtimeName =
      profile.name !== new URL(profile.connection.address).hostname
        ? profile.name
        : snapshot.runtimeHost || profile.name
    return snapshot.workspace.automations.map((flow) => {
      const runs = snapshot.runs
        .filter((run) => run.automationId === flow.id)
        .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
      const latest =
        runs.find((run) => run.status === 'running' || run.status === 'waiting') ?? runs[0]
      const needsInput =
        !!latest &&
        runSteps(latest, flow).some(
          (step) => step.status === 'running' && !!pendingTaskInput(snapshot, step.taskId),
        )
      return {
        key: JSON.stringify([profile.id, flow.id]),
        runtime,
        runtimeName,
        flow,
        runs,
        latest,
        needsInput,
        status: needsInput
          ? 'Needs input'
          : latest
            ? runLabels[latest.status]
            : flow.enabled
              ? 'Scheduled'
              : 'Ready',
        projects: [
          ...new Set(
            flow.nodes.flatMap((node) => {
              const name =
                node.data.kind === 'task' ? projects.get(node.data.repositoryId) : undefined
              return name ? [name] : []
            }),
          ),
        ],
      }
    })
  })
  const priority = (row: FleetAutomation) =>
    row.needsInput || row.latest?.status === 'waiting'
      ? 0
      : row.latest?.status === 'failed'
        ? 1
        : row.latest?.status === 'running'
          ? 2
          : 3
  return rows.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (b.latest?.updatedAt ?? b.latest?.createdAt ?? '').localeCompare(
        a.latest?.updatedAt ?? a.latest?.createdAt ?? '',
      ) ||
      a.flow.name.localeCompare(b.flow.name) ||
      a.key.localeCompare(b.key),
  )
}
