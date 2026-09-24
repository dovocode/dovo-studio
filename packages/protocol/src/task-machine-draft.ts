import { canChangeTaskCheckout, type Task, type Repository } from './workspace.js'
import { resolveTaskDefaults, type RuntimeDefaults } from './runtime-setup.js'
export function taskMachineDraft(
  task: Task,
  repository: Repository,
  defaults?: RuntimeDefaults,
): Task {
  if (!canChangeTaskCheckout(task) || task.archivedAt)
    throw new Error('Choose the machine before sending the first prompt.')
  if (task.draftAttachments?.length)
    throw new Error(
      'Remove draft attachments before changing machines, then attach them on the destination.',
    )
  if (task.pullRequest || task.workItem)
    throw new Error('Linked issue and PR drafts stay on their original machine.')
  return {
    ...resolveTaskDefaults(defaults, repository),
    id: task.id,
    title: task.title,
    repositoryId: repository.id,
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
