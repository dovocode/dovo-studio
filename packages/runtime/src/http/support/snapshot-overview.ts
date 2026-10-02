import type { Workspace, Task } from '@dovo/protocol'
const overviewTasks = new WeakMap<Task, Task>()
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
export function scopedWorkspace(workspace: Workspace, taskIds: readonly string[]): Workspace {
  const details = new Set(taskIds)
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) => (details.has(task.id) ? task : summaryTask(task, false))),
  }
}
