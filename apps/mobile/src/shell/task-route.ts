/** Task identity includes its owning computer; task IDs can collide across runtimes. */
export function taskHref(
  runtimeId: string,
  taskId: string,
  questionId?: string,
  parent?: { runtimeId: string; taskId: string; title: string },
) {
  return {
    pathname: '/(tasks)/thread/[runtimeId]/[taskId]' as const,
    params: {
      runtimeId,
      taskId,
      ...(questionId ? { questionId } : {}),
      ...(parent
        ? {
            parentRuntimeId: parent.runtimeId,
            parentTaskId: parent.taskId,
            parentTitle: parent.title,
          }
        : {}),
    },
  }
}
