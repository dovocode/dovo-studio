import type { RuntimeOverview, Task } from '@dovo/protocol'
import type { Runtime } from './context'

// Only presentation inputs used by the widget and Live Activities. Streamed text, token counts
// and updatedAt do not change these surfaces. Weak keys never extend a task's lifetime.
const taskKeys = new WeakMap<Task, string>()
function taskKey(task: Task) {
  let key = taskKeys.get(task)
  if (key === undefined) {
    const turn = task.turns?.at(-1)
    key = JSON.stringify([
      task.id,
      task.title,
      task.status,
      task.archived,
      task.archivedAt,
      task.example,
      task.pinned,
      task.createdAt,
      task.repositoryId,
      task.activity,
      task.error,
      task.queue?.length ?? 0,
      task.runPhase,
      task.preparation,
      task.delegation?.parentTaskId,
      turn?.id,
      turn?.startedAt,
      task.threadWatches?.map((watch) => [
        watch.runtimeId,
        watch.threadId,
        watch.status,
        watch.offline,
        watch.paused,
        watch.snapshot?.phase,
        watch.snapshot?.humanInputs?.length,
        watch.snapshot?.questions?.length,
      ]),
    ])
    taskKeys.set(task, key)
  }
  return key
}
function sameInputs(a: readonly { taskId: string }[], b: readonly { taskId: string }[]) {
  return (
    a === b || (a.length === b.length && a.every((item, index) => item.taskId === b[index]?.taskId))
  )
}
function sameOverview(a: RuntimeOverview, b: RuntimeOverview) {
  if (a === b) return true
  if (a.profile !== b.profile || a.connected !== b.connected) return false
  const before = a.snapshot,
    after = b.snapshot
  if (before === after) return true
  if (!before || !after) return false
  if (
    before.runtimeHost !== after.runtimeHost ||
    before.internet?.origin !== after.internet?.origin ||
    before.workspace.repositories !== after.workspace.repositories ||
    !sameInputs(before.questions, after.questions) ||
    !sameInputs(before.approvals, after.approvals)
  )
    return false
  const tasks = before.workspace.tasks,
    next = after.workspace.tasks
  return (
    tasks === next ||
    (tasks.length === next.length &&
      tasks.every((task, index) => {
        const other = next[index]
        return other !== undefined && (task === other || taskKey(task) === taskKey(other))
      }))
  )
}
export const selectTaskSurfaces = (runtime: Runtime) => ({
  overviews: runtime.overviews,
  ready: runtime.ready,
  readRuntimeEffect: runtime.readRuntimeEffect,
})
export function sameTaskSurfaces(
  a: ReturnType<typeof selectTaskSurfaces>,
  b: ReturnType<typeof selectTaskSurfaces>,
) {
  return (
    a.ready === b.ready &&
    a.readRuntimeEffect === b.readRuntimeEffect &&
    (a.overviews === b.overviews ||
      (a.overviews.length === b.overviews.length &&
        a.overviews.every(
          (entry, index) =>
            b.overviews[index] !== undefined && sameOverview(entry, b.overviews[index]!),
        )))
  )
}
