import {
  containerSandboxEnabled,
  effectiveContainerSandbox,
  resolveTaskAgent,
  type ContainerSandbox,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { AgentRegistry } from '../agents/configuration/registry.js'
import type { Sandboxes } from './sandboxes.js'

/** The sandbox a thread uses now: its snapshot, its parent's, or the project default before
 * its first turn. */
export function threadContainerSandbox(
  store: WorkspaceStore,
  taskId: string,
  /** The turn being started, which does not count as earlier work. */
  currentTurnId?: string,
): ContainerSandbox | undefined {
  const task = store.taskSummary(taskId)
  if (task.containerSandbox) return task.containerSandbox
  const parentId = task.delegation?.parentTaskId ?? task.sideThread?.parentTaskId
  const parent = parentId
    ? store.get().tasks.find((item) => item.id === parentId)?.containerSandbox
    : undefined
  return (
    parent ??
    effectiveContainerSandbox(
      undefined,
      store.projectSettings(task.repositoryId).taskDefaults?.containerSandbox,
      (store.task(taskId).turns ?? []).some((turn) => turn.id !== currentTurnId),
    )
  )
}

/** Start the thread's container before a thread terminal opens. The container uses the thread's
 * harness mounts, so the next turn reuses it instead of recreating it. */
export async function prepareThreadTerminal(
  s: { store: WorkspaceStore; agents: AgentRegistry; sandboxes: Sandboxes },
  taskId: string,
  cwd: string,
) {
  const sandbox = threadContainerSandbox(s.store, taskId)
  if (!sandbox || !containerSandboxEnabled(sandbox)) return
  const task = s.store.taskSummary(taskId)
  const selected = resolveTaskAgent(task, s.store.get().agents)
  const configured = selected ? s.agents.configure(selected) : undefined
  const acpLaunch = configured ? s.agents.launch(configured) : undefined
  // A terminal does not need the harness. An unsupported one only skips its mounts.
  const agent =
    configured && s.sandboxes.support(configured, acpLaunch, cwd).supported ? configured : undefined
  await s.sandboxes.ensure({
    taskId,
    sandbox,
    cwd,
    agent,
    acpLaunch: agent ? acpLaunch : undefined,
  })
}
