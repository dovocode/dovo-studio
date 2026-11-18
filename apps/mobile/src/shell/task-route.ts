/** Task identity includes its owning computer; task IDs can collide across runtimes. */
export function taskHref(
  runtimeId: string,
  taskId: string,
  questionId?: string,
  parent?: { runtimeId: string; runtimeIdentity?: string; taskId: string; title: string },
  runtimeIdentity?: string,
  nativeAgentKey?: string,
  approvalId?: string,
) {
  return {
    pathname: '/(tasks)/thread/[runtimeId]/[taskId]' as const,
    params: {
      runtimeId,
      taskId,
      ...(nativeAgentKey ? { nativeAgentKey } : {}),
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...(questionId ? { questionId } : {}),
      ...(approvalId ? { approvalId } : {}),
      ...(parent
        ? {
            parentRuntimeId: parent.runtimeId,
            parentTaskId: parent.taskId,
            parentTitle: parent.title,
            ...(parent.runtimeIdentity ? { parentRuntimeIdentity: parent.runtimeIdentity } : {}),
          }
        : {}),
    },
  }
}
