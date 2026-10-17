import { isDeepStrictEqual } from 'node:util'
import { runClientEffect } from '@dovo/client-runtime'
import { linkedProjectsRequestSchema, decode } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { worktreeChoicesEffect } from '../git/worktrees.js'

/** Agent requests are scoped by run authorization before reaching this handler. */
export async function linkedProjectsTool(s: Services, value: unknown) {
  if (!s.preferences.get().enableLinkedProjectsTool)
    throw new HttpError(403, 'The linked projects tool is disabled on this computer')
  const { taskId, command } = decode(linkedProjectsRequestSchema, value)
  const task = s.store.taskSummary(taskId)
  if (command.action === 'projects')
    return {
      projects: s.store
        .get()
        .repositories.filter((repo) => repo.kind !== 'scratch')
        .map(({ id, name, kind }) => ({ id, name, supportsWorktrees: !kind })),
    }
  if (command.action === 'worktrees')
    return runClientEffect(worktreeChoicesEffect(s, command.repositoryId))
  if (command.action === 'list')
    return {
      active: task.linkedCheckouts ?? [],
      pending: task.pendingLinkedCheckouts,
      activation: task.pendingLinkedCheckouts ? 'next-turn' : undefined,
    }
  if (task.delegation)
    throw new HttpError(403, 'Child agents inherit their parent’s linked projects')
  if (task.archived || task.archivedAt)
    throw new HttpError(409, 'Restore this thread before adding linked projects')
  const effective = task.pendingLinkedCheckouts ?? task.linkedCheckouts ?? []
  const existing = effective.find((link) => link.id === command.checkout.id)
  if (existing && !isDeepStrictEqual(existing, command.checkout))
    throw new HttpError(409, 'This checkout ID already exists. Use a new stable ID for a new link.')
  if (existing && !task.pendingLinkedCheckouts)
    return { active: effective, activation: 'active', note: 'This checkout is already linked.' }
  const links = s.checkouts.linked.validate(existing ? effective : [...effective, command.checkout])
  s.tasks.requireCheckoutReferencesAvailable({ ...task, pendingLinkedCheckouts: links })
  if (!existing)
    s.store.updateTask(taskId, (current) => ({ ...current, pendingLinkedCheckouts: links }))
  return {
    pending: links,
    activation: 'next-turn',
    note: 'Configured for the next fresh turn. Current agent folders, permissions and checkpoints are unchanged. Send a follow-up message to use the linked projects.',
  }
}
