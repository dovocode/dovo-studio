import {
  resolveTaskAgent,
  samePermissionPolicy,
  narrowerPermissionLimits,
  inheritedPermissionPolicy,
  permissionPolicyIssue,
  permissionPolicyWithinCeiling,
  resolveProviderAccess,
  type WorkspaceSummary,
  type TaskSummary,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'

/** Resolve ancestors first and persist the whole family in the enclosing workspace transaction. */
export function propagateDelegatedPermissions(before: WorkspaceSummary, next: WorkspaceSummary) {
  const previous = new Map(before.tasks.map((task) => [task.id, task]))
  const tasks = new Map(next.tasks.map((task) => [task.id, task]))
  const resolved = new Set<string>()
  const resolving = new Set<string>()
  const visit = (task: TaskSummary): TaskSummary => {
    if (resolved.has(task.id)) return tasks.get(task.id) ?? task
    if (resolving.has(task.id)) throw new HttpError(400, 'Child task ancestry contains a cycle')
    resolving.add(task.id)
    const delegation = task.delegation
    const candidate = delegation && tasks.get(delegation.parentTaskId)
    if (delegation && candidate) {
      const parent = visit(candidate)
      const parentAgent = resolveTaskAgent(parent, next.agents)
      const childAgent = resolveTaskAgent(task, next.agents)
      const old = previous.get(task.id)
      const oldParent = previous.get(old?.delegation?.parentTaskId ?? parent.id)
      const oldParentAgent = oldParent && resolveTaskAgent(oldParent, before.agents)
      const oldChildAgent = old && resolveTaskAgent(old, before.agents)
      const checkout = parent.linkedCheckouts?.find((link) => link.id === delegation.checkoutId)
      const oldCheckout = oldParent?.linkedCheckouts?.find(
        (link) => link.id === delegation.checkoutId,
      )
      const parentChanged =
        !samePermissionPolicy(parentAgent, oldParentAgent) ||
        checkout?.access !== oldCheckout?.access ||
        old?.delegation?.parentTaskId !== delegation.parentTaskId ||
        old?.delegation?.checkoutId !== delegation.checkoutId
      const childChanged = !samePermissionPolicy(childAgent, oldChildAgent)
      const legacyOverCeiling =
        !delegation.permissionLimits &&
        parentAgent &&
        childAgent &&
        !permissionPolicyWithinCeiling(parentAgent, childAgent, checkout?.access === 'read-only')
      // Unconfigured historical children remain maintainable. Execution separately requires an agent.
      if (
        parentAgent &&
        childAgent &&
        old?.delegation &&
        (parentChanged || childChanged || legacyOverCeiling)
      ) {
        if (delegation.checkoutId && !checkout)
          throw new HttpError(403, 'Child checkout no longer exists')
        const limits = childChanged
          ? narrowerPermissionLimits(parentAgent, childAgent)
          : (delegation.permissionLimits ??
            (oldParentAgent && oldChildAgent
              ? narrowerPermissionLimits(oldParentAgent, oldChildAgent)
              : {}))
        if (
          childChanged &&
          !permissionPolicyWithinCeiling(parentAgent, childAgent, checkout?.access === 'read-only')
        )
          throw new HttpError(
            403,
            'Child permissions cannot exceed their parent or checkout access',
          )
        const inherited = inheritedPermissionPolicy(
          parentAgent,
          childAgent,
          limits,
          checkout?.access === 'read-only',
        )
        const policy = {
          ...inherited,
          permission: resolveProviderAccess(childAgent.provider, inherited.permission),
        }
        const issue = permissionPolicyIssue(policy)
        if (
          issue ||
          !permissionPolicyWithinCeiling(parentAgent, policy, checkout?.access === 'read-only')
        ) {
          // Unsupported historical configurations must remain readable. Admission still
          // rejects their authority; an intentional policy change cannot silently widen it.
          if (!parentChanged && !childChanged) {
            resolving.delete(task.id)
            resolved.add(task.id)
            return task
          }
          throw new HttpError(403, issue ?? 'This child harness cannot enforce the parent access')
        }
        task = {
          ...task,
          delegation: { ...delegation, permissionLimits: limits },
          agentOverrides: {
            ...task.agentOverrides,
            permission: policy.permission,
            approvalPolicy: policy.approvalPolicy ?? null,
            sandboxMode: policy.sandboxMode ?? null,
          },
        }
        tasks.set(task.id, task)
      }
    }
    resolving.delete(task.id)
    resolved.add(task.id)
    return task
  }
  return next.tasks.map(visit)
}
