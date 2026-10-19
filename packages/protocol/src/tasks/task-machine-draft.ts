import {
  canChangeTaskCheckout,
  resolveTaskAgent,
  type Task,
  type Repository,
  type Agent,
} from '../workspace.js'
import { changeAgentProvider } from './agent-configuration.js'
import { permissionPolicyWithinCeiling, permissionPolicyIssue } from '../auth/permission-policy.js'
import { supportsAccess } from '../auth/access.js'
import { resolveTaskDefaults, type RuntimeDefaults } from '../runtime/connection/runtime-setup.js'
export function taskMachineDraft(
  task: Task,
  repository: Repository,
  defaults?: RuntimeDefaults,
  agents: readonly Agent[] = [],
): Task {
  if (!canChangeTaskCheckout(task) || task.archivedAt)
    throw new Error('Choose the machine before sending the first prompt.')
  if (task.draftAttachments?.length)
    throw new Error(
      'Remove draft attachments before changing machines, then attach them on the destination.',
    )
  if (task.pullRequest || task.workItem)
    throw new Error('Linked issue and PR drafts stay on their original machine.')
  const target = resolveTaskDefaults(defaults, repository)
  const source = resolveTaskAgent(task, agents)
  const policy = source && changeAgentProvider(source, target.harness.provider)
  if (
    source &&
    policy &&
    (!permissionPolicyWithinCeiling(source, policy) ||
      permissionPolicyIssue(policy) ||
      !supportsAccess(policy.provider, policy.permission))
  )
    throw new Error(
      'The destination provider cannot preserve these permissions. Choose a compatible provider before moving the draft.',
    )
  return {
    ...target,
    harness: policy
      ? {
          ...target.harness,
          permission: policy.permission,
          approvalPolicy: policy.approvalPolicy,
          sandboxMode: policy.sandboxMode,
        }
      : target.harness,
    id: task.id,
    title: task.title,
    repositoryId: repository.id,
    autoProject: repository.kind === 'scratch' ? task.autoProject : undefined,
    autoProjectExecution:
      repository.kind === 'scratch' && task.autoProject ? task.autoProjectExecution : undefined,
    modelSelection:
      task.modelSelection ??
      (task.autoProject ? 'inherit' : resolveTaskDefaults(defaults, repository).modelSelection),
    modelSelectionDifficulty: task.modelSelectionDifficulty,
    harnessCustomized: task.modelSelection ? task.harnessCustomized : undefined,
    agentId: '',
    status: 'draft',
    createdAt: task.createdAt,
    messages: [],
    files: [],
    draft: task.draft,
    example: false,
    origin: `machine-draft:${task.id}`,
    pinned: task.pinned,
  }
}
