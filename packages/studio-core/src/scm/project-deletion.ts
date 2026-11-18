import { nativeAgentWorking, type RuntimeSnapshot, type Workspace } from '@dovo/protocol'

const reasons = {
  delegation: 'Resolve the delegated thread link between projects before deleting this project.',
  restore: 'Finish the pending undo or redo in a linked thread before deleting this project.',
  active: 'Stop active turns and agents before deleting this project.',
  decision: 'Finish pending questions or approvals before deleting this project.',
  terminal: 'Close active terminals before deleting this project.',
  watch: 'Stop linked active threads before deleting this project.',
  automation: 'Finish or cancel active automations before deleting this project.',
}

type DeletionBlocker = { name?: string; reasons: string[] } & (
  | { kind: 'thread'; id: string }
  | { kind: 'run'; id: string; automationId: string }
)

export function projectDeletionPreview(
  repositoryId: string,
  workspace: Pick<Workspace, 'tasks' | 'automations'> | undefined,
  activity: Pick<RuntimeSnapshot, 'questions' | 'approvals' | 'terminals' | 'runs'> | null,
) {
  const tasks = workspace?.tasks ?? []
  const automations = workspace?.automations ?? []
  const projectTaskIds = new Set(
    tasks.filter((task) => task.repositoryId === repositoryId).map((task) => task.id),
  )
  const affectedFlowIds = new Set(
    automations
      .filter((flow) =>
        flow.nodes.some(
          (node) =>
            node.data.repositoryId === repositoryId ||
            node.data.linkedCheckouts?.some((link) => link.repositoryId === repositoryId),
        ),
      )
      .map((flow) => flow.id),
  )
  const decisions = new Set(
    [...(activity?.questions ?? []), ...(activity?.approvals ?? [])].map((item) => item.taskId),
  )
  const terminals = new Set(
    activity?.terminals.filter((terminal) => !terminal.exited).map((terminal) => terminal.taskId),
  )
  const guardedIds = new Set(projectTaskIds)
  const blockers: DeletionBlocker[] = []
  for (const task of tasks) {
    const onProject = projectTaskIds.has(task.id)
    const parentId = task.delegation?.parentTaskId
    const taskReasons: string[] = []
    if (parentId && onProject !== projectTaskIds.has(parentId)) taskReasons.push(reasons.delegation)
    if (
      !onProject &&
      task.turns?.some(
        (turn) =>
          turn.checkpoint?.restorePending &&
          turn.checkpoint.linked?.some((link) => link.repositoryId === repositoryId),
      )
    )
      taskReasons.push(reasons.restore)
    if (
      onProject ||
      [...(task.linkedCheckouts ?? []), ...(task.pendingLinkedCheckouts ?? [])].some(
        (link) => link.repositoryId === repositoryId,
      )
    ) {
      guardedIds.add(task.id)
      if (task.status === 'running' || task.subagents?.some(nativeAgentWorking))
        taskReasons.push(reasons.active)
      if (decisions.has(task.id)) taskReasons.push(reasons.decision)
      if (terminals.has(task.id)) taskReasons.push(reasons.terminal)
      if (task.threadWatches?.some((watch) => watch.status === 'watching'))
        taskReasons.push(reasons.watch)
    }
    if (taskReasons.length)
      blockers.push({ kind: 'thread', id: task.id, name: task.title, reasons: taskReasons })
  }
  for (const run of activity?.runs ?? []) {
    if (
      (run.status === 'running' || run.status === 'waiting') &&
      (affectedFlowIds.has(run.automationId) || run.taskIds.some((id) => guardedIds.has(id)))
    )
      blockers.push({
        kind: 'run',
        id: run.id,
        automationId: run.automationId,
        name: automations.find((flow) => flow.id === run.automationId)?.name,
        reasons: [reasons.automation],
      })
  }
  return {
    blockers,
    projectThreads: projectTaskIds.size,
    affectedAutomations: affectedFlowIds.size,
  }
}
