import {
  decode,
  decodeResult,
  deleteProjectSchema,
  taskMetadataSchema,
  SCRATCH_PROJECT_ID,
  taskFamilyIds,
  type Automation,
} from '@dovo/protocol'
import { Effect, Struct } from 'effect'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { routeProgram, serviceResult } from '../../http/support/effect.js'
import {
  deleteThreadRecords,
  releaseThreadResources,
  removeDeletedThreadFiles,
  removeThreadSandboxes,
  retireDeletedThreadInputs,
  threadFamily,
} from '../../agents/tasks/thread-deletion.js'
import { listWorktreesEffect } from '../git/worktrees.js'

const projectReferences = (
  task: {
    linkedCheckouts?: readonly { repositoryId: string }[]
    pendingLinkedCheckouts?: readonly { repositoryId: string }[]
  },
  repositoryId: string,
) =>
  [...(task.linkedCheckouts ?? []), ...(task.pendingLinkedCheckouts ?? [])].some(
    (link) => link.repositoryId === repositoryId,
  )

const flowReferences = (flow: Automation, repositoryId: string) =>
  flow.nodes.some(
    (node) =>
      node.data.repositoryId === repositoryId ||
      node.data.linkedCheckouts?.some((link) => link.repositoryId === repositoryId),
  )

const projectOwnership = taskMetadataSchema.mapFields(
  Struct.pick(['repositoryId', 'linkedCheckouts', 'pendingLinkedCheckouts']),
)

export function deleteProjectEffect(s: Services, value: unknown) {
  return routeProgram(
    Effect.gen(function* () {
      const { repositoryId } = decode(deleteProjectSchema, value)
      const workspace = s.store.get()
      const repository = workspace.repositories.find((entry) => entry.id === repositoryId)
      if (!repository) throw new HttpError(404, 'Project not found')
      if (repositoryId === SCRATCH_PROJECT_ID || repository.kind === 'scratch')
        throw new HttpError(409, 'General cannot be deleted')
      for (const id of s.store.unreadableTaskIds()) {
        const value = s.db
          .prepare('SELECT value FROM workspace_tasks WHERE task_id = ?')
          .pluck()
          .get(id)
        let metadata: unknown
        if (typeof value === 'string') {
          try {
            metadata = JSON.parse(value)
          } catch {
            /* The row remains unreadable. */
          }
        }
        const ownership = decodeResult(projectOwnership, metadata)
        if (
          !ownership.success ||
          ownership.data.repositoryId === repositoryId ||
          projectReferences(ownership.data, repositoryId)
        )
          throw new HttpError(
            409,
            'Recover the unreadable thread records before deleting this project.',
          )
      }

      for (const task of workspace.tasks) {
        if (task.repositoryId === repositoryId) continue
        if (
          s.store
            .task(task.id)
            .turns?.some(
              (turn) =>
                turn.checkpoint?.restorePending &&
                turn.checkpoint.linked?.some((link) => link.repositoryId === repositoryId),
            )
        )
          throw new HttpError(
            409,
            'Review the saved Undo backup in the linked thread before deleting this project.',
          )
      }

      const projectTasks = workspace.tasks.filter((task) => task.repositoryId === repositoryId)
      const projectTaskIds = new Set(projectTasks.map((task) => task.id))
      const deletedTaskIds = new Set<string>()
      for (const task of projectTasks) {
        const parentId = task.delegation?.parentTaskId
        if (parentId && !projectTaskIds.has(parentId))
          throw new HttpError(
            409,
            'Remove this project’s child thread from its parent before deleting the project.',
          )
        for (const id of taskFamilyIds(workspace.tasks, task.id)) {
          const familyTask = workspace.tasks.find((candidate) => candidate.id === id)
          if (familyTask && familyTask.repositoryId !== repositoryId)
            throw new HttpError(
              409,
              'Move delegated child threads out of this project before deleting it.',
            )
          deletedTaskIds.add(id)
        }
      }
      const linkedTasks = workspace.tasks.filter(
        (task) => !deletedTaskIds.has(task.id) && projectReferences(task, repositoryId),
      )
      const guardedTaskIds = new Set([...deletedTaskIds, ...linkedTasks.map((task) => task.id)])
      for (const id of guardedTaskIds) {
        s.tasks.requireIdle(id)
        s.jobs.requireTaskIdle(id)
        if (
          s.questions.list().some((item) => item.taskId === id) ||
          s.approvals.list().some((item) => item.taskId === id)
        )
          throw new HttpError(
            409,
            'Finish pending questions or approvals before deleting this project.',
          )
        if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
          throw new HttpError(409, 'Close active terminals before deleting this project.')
        if (s.threadWatch.list(id).some((watch) => watch.status === 'watching'))
          throw new HttpError(409, 'Stop linked active threads before deleting this project.')
      }

      const affectedFlows = workspace.automations.filter((flow) =>
        flowReferences(flow, repositoryId),
      )
      for (const flow of affectedFlows) s.jobs.requireIdle(flow.id)

      const roots = projectTasks.filter(
        (task) => !task.delegation || !projectTaskIds.has(task.delegation.parentTaskId),
      )
      const flowIds = new Set(affectedFlows.map((flow) => flow.id))
      const projectReservation = s.store.reserveRepositoryDeletion(repositoryId)
      let taskReservation: symbol | undefined
      let automationReservation: symbol | undefined
      try {
        taskReservation = s.tasks.reserveDeletion([...guardedTaskIds])
        automationReservation = s.jobs.reserveDeletion([...flowIds])
        // Check every thread before any cleanup starts, so a conflict changes nothing.
        const families = roots.map((task) => threadFamily(s, task.id, 'delete', taskReservation))
        const familyIds = new Set(families.flatMap((family) => [...family.ids]))
        const requireFamilies = () => {
          for (const family of families) {
            family.requireUnchanged()
            family.requireIdle()
          }
        }
        requireFamilies()

        yield* serviceResult(s.artifactFeeds.stopTasks([...deletedTaskIds]))
        yield* serviceResult(s.sharedThreads.stopTasks([...deletedTaskIds]))
        try {
          for (const family of families) yield* releaseThreadResources(s, family.ids)
          // Retain older checkout identities before their owning threads disappear.
          yield* listWorktreesEffect(s)
          requireFamilies()
          for (const terminal of s.terminals.list())
            if (familyIds.has(terminal.taskId)) yield* serviceResult(s.terminals.close(terminal.id))

          // Tasks linked to the deleted project remain intact, with only the dangling checkout
          // reference removed. Repository and worktree paths are never passed to a remover here.
          // Removing this checkout must not delete metadata shared with other machines.
          // Explicit settings resets retain their per-category tombstones through sync.
          // Threads, the project and automation changes commit together. A failure keeps all.
          const deleted = s.store.get().tasks.filter((task) => familyIds.has(task.id))
          s.store.transaction(() => {
            deleteThreadRecords(s, familyIds)
            if (s.store.get().tasks.some((task) => task.repositoryId === repositoryId))
              throw new HttpError(
                409,
                'Project threads changed during deletion. Refresh and try again.',
              )
            s.threadWatch.forgetTasks([...familyIds])
            s.store.update((current) => ({
              ...current,
              repositories: current.repositories.filter((entry) => entry.id !== repositoryId),
              tasks: current.tasks.map((task) => {
                const active = task.linkedCheckouts ?? []
                const pending = task.pendingLinkedCheckouts ?? []
                const removedLinkIds = new Set(
                  [...active, ...pending]
                    .filter((link) => link.repositoryId === repositoryId)
                    .map((link) => link.id),
                )
                return {
                  ...task,
                  linkedCheckouts: active.filter((link) => link.repositoryId !== repositoryId),
                  pendingLinkedCheckouts: pending.filter(
                    (link) => link.repositoryId !== repositoryId,
                  ),
                  linkedCheckoutSetup: task.linkedCheckoutSetup?.filter(
                    (entry) => !removedLinkIds.has(entry.id),
                  ),
                }
              }),
              jiraIssueLinks: current.jiraIssueLinks?.filter(
                (link) => link.repositoryId !== repositoryId,
              ),
              planLimits: current.planLimits?.filter(
                (limit) => !limit.sourceTaskId || !familyIds.has(limit.sourceTaskId),
              ),
              automations: current.automations.map((flow) => {
                if (!flowIds.has(flow.id)) return flow
                return {
                  ...flow,
                  enabled: false,
                  nodes: flow.nodes.map((node) => {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        repositoryId:
                          node.data.repositoryId === repositoryId
                            ? SCRATCH_PROJECT_ID
                            : node.data.repositoryId,
                        linkedCheckouts: node.data.linkedCheckouts?.filter(
                          (link) => link.repositoryId !== repositoryId,
                        ),
                      },
                    }
                  }),
                }
              }),
            }))
          })
          retireDeletedThreadInputs(s, familyIds)
          yield* removeThreadSandboxes(s, familyIds)
          yield* removeDeletedThreadFiles(s, deleted)
        } finally {
          s.artifactFeeds.releaseTasks([...deletedTaskIds])
        }
      } finally {
        if (taskReservation) s.tasks.releaseDeletion([...guardedTaskIds], taskReservation)
        if (automationReservation) s.jobs.releaseDeletion([...flowIds], automationReservation)
        s.store.releaseRepositoryDeletion(repositoryId, projectReservation)
      }
      return { ok: true }
    }),
  )
}
