import { conversationPage, taskBudgetUsage } from '@dovo/protocol'
import type { Workspace, Task } from '@dovo/protocol'
const overviewTasks = new WeakMap<Task, Task>()
const pagedTasks = new WeakMap<Task, Task>()
function pagedTask(task: Task): Task {
  const cached = pagedTasks.get(task)
  if (cached) return cached
  const page = conversationPage(task)
  const visible = new Set(page.turns.map((turn) => turn.id))
  const older = task.turns?.filter((turn) => !visible.has(turn.id)) ?? []
  const budget = taskBudgetUsage({ turns: older })
  const undoable = [...older]
    .reverse()
    .find(
      (turn) =>
        turn.status !== 'running' &&
        turn.checkpoint?.after &&
        !turn.checkpoint.error &&
        !turn.checkpoint.undone &&
        turn.checkpoint.files.length + turn.checkpoint.omitted.length > 0,
    )
  const result = {
    ...task,
    messages: page.messages,
    turns: page.turns,
    historyBefore: page.before,
    historyTotals: older.length
      ? {
          tokens: budget.tokens,
          milliseconds: budget.minutes * 60000,
          hasChanges: older.some(
            (turn) =>
              !!turn.checkpoint &&
              turn.checkpoint.files.length + turn.checkpoint.omitted.length > 0,
          ),
          undoableTurnId: undoable?.id,
        }
      : undefined,
  }
  pagedTasks.set(task, result)
  return result
}
const scopedTasks = new WeakMap<Task, Task>()
function summaryTask(task: Task, overview: boolean): Task {
  const cache = overview ? overviewTasks : scopedTasks
  const cached = cache.get(task)
  if (cached) return cached
  const summary = {
    ...task,
    messages: [],
    sideChats: task.sideChats?.map((chat) => ({ ...chat, messages: [] })),
    files: task.files.map(({ path, viewed }) => ({ path, viewed, before: '', after: '' })),
    ...(overview ? { draftAttachments: undefined } : {}),
    forkedFrom: task.forkedFrom ? { ...task.forkedFrom, snapshot: undefined } : undefined,
    turns: task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
  }
  cache.set(task, summary)
  return summary
}
/** Fleet lists need task identity and state, not every conversation and file snapshot. */
export function overviewWorkspace(workspace: Workspace): Workspace {
  return { ...workspace, tasks: workspace.tasks.map((task) => summaryTask(task, true)) }
}
/** Keep editable drafts and task metadata, but send history only for subscribed threads. */
export function scopedWorkspace(
  workspace: Workspace,
  taskIds: readonly string[],
  paged = false,
): Workspace {
  const details = new Set(taskIds)
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      details.has(task.id) ? (paged ? pagedTask(task) : task) : summaryTask(task, false),
    ),
  }
}
