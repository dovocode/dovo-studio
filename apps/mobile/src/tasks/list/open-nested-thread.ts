import {
  resolveThreadRuntime,
  type NestedThread,
  type RuntimeOverview,
  type RuntimeProfile,
} from '@dovo/protocol'
import { router } from 'expo-router'
import { taskHref } from '../../shell/task-route'

export function openNestedThread(
  child: NestedThread,
  parent: NestedThread,
  profiles: RuntimeProfile[],
  overviews: RuntimeOverview[],
) {
  const resolveRuntime = (node: NestedThread) =>
    resolveThreadRuntime(node, profiles, overviews)?.id ?? node.runtimeId
  const runtimeId = resolveRuntime(child)
  const parentRuntimeId = resolveRuntime(parent)
  if (!runtimeId || !parentRuntimeId) return
  router.push(
    taskHref(
      runtimeId,
      child.threadId,
      undefined,
      child.nativeAgentKey
        ? undefined
        : {
            runtimeId: parentRuntimeId,
            runtimeIdentity: parent.runtimeIdentity,
            taskId: parent.threadId,
            title: parent.title,
          },
      child.runtimeIdentity,
      child.nativeAgentKey,
    ),
  )
}
