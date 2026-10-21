import {
  resolveThreadRuntime,
  type NestedThread,
  type RuntimeOverview,
  type RuntimeProfile,
} from '../../../packages/protocol/src'

export function openNestedThread(
  child: NestedThread,
  parent: NestedThread,
  profiles: RuntimeProfile[],
  overviews: RuntimeOverview[],
): void {
  const resolveRuntime = (node: NestedThread) =>
    resolveThreadRuntime(node, profiles, overviews)?.id ?? node.runtimeId
  if (!resolveRuntime(child) || !resolveRuntime(parent)) return
  throw new Error('Child-thread navigation is unavailable in the local web catalog fixture.')
}
