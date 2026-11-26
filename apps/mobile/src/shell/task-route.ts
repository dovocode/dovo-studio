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

export type OpenThreadInInspector = (href: ReturnType<typeof taskHref>) => boolean

/** The search parameters that `taskHref` writes. Expo Router returns them as strings. */
export type TaskRouteParams = {
  runtimeId?: string
  taskId?: string
  runtimeIdentity?: string
  nativeAgentKey?: string
  questionId?: string
  approvalId?: string
  parentRuntimeId?: string
  parentRuntimeIdentity?: string
  parentTaskId?: string
  parentTitle?: string
}

/** Rebuilds the open thread route, including its request and parent, so a return keeps all of it. */
export function taskRouteHref(
  params: TaskRouteParams & { runtimeId: string; taskId: string },
  fallbackParentTitle: string,
) {
  return taskHref(
    params.runtimeId,
    params.taskId,
    params.questionId,
    params.parentRuntimeId && params.parentTaskId
      ? {
          runtimeId: params.parentRuntimeId,
          runtimeIdentity: params.parentRuntimeIdentity,
          taskId: params.parentTaskId,
          title: params.parentTitle ?? fallbackParentTitle,
        }
      : undefined,
    params.runtimeIdentity,
    params.nativeAgentKey,
    params.approvalId,
  )
}
