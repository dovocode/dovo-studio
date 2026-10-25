import {
  decode,
  deleteProjectSchema,
  SCRATCH_PROJECT_ID,
  sharedProjectKey,
  taskFamilyIds,
  type Automation,
} from '@dovo/protocol'
import { Effect } from 'effect'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { routeProgram, serviceResult } from '../../http/support/effect.js'
import { taskLifecycle } from '../../http/endpoints/agents-routes.js'

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

export function deleteProjectEffect(s: Services, value: unknown) {
  return routeProgram(
    Effect.gen(function* () {
      const { repositoryId } = decode(deleteProjectSchema, value)
      const workspace = s.store.get()
      const repository = workspace.repositories.find((entry) => entry.id === repositoryId)
      if (!repository) throw new HttpError(404, 'Project not found')
      if (repositoryId === SCRATCH_PROJECT_ID || repository.kind === 'scratch')
        throw new HttpError(409, 'General cannot be deleted')

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
        if (flowIds.size)
          s.store.update((current) => ({
            ...current,
            automations: current.automations.map((flow) =>
              flowIds.has(flow.id) ? { ...flow, enabled: false } : flow,
            ),
          }))

        yield* serviceResult(s.artifactFeeds.stopTasks([...deletedTaskIds]))
        yield* serviceResult(s.sharedThreads.stopTasks([...deletedTaskIds]))
        try {
          const reservedTasks = taskReservation
          for (const task of roots) yield* taskLifecycle(s, task.id, 'delete', false, reservedTasks)

          const remainingProjectTasks = s.store
            .get()
            .tasks.filter((task) => task.repositoryId === repositoryId)
          if (remainingProjectTasks.length)
            throw new HttpError(
              409,
              'Project threads changed during deletion. Refresh and try again.',
            )

          // Tasks linked to the deleted project remain intact, with only the dangling checkout
          // reference removed. Repository and worktree paths are never passed to a remover here.
          const sharedKey = sharedProjectKey(repository)
          const settings = s.defaults.get()
          if (
            sharedKey &&
            !s.store
              .get()
              .repositories.some(
                (entry) => entry.id !== repositoryId && sharedProjectKey(entry) === sharedKey,
              )
          ) {
            const scoped = settings.scopedSettings
            if (scoped?.shared.some((entry) => entry.key === sharedKey))
              s.defaults.save(
                {
                  ...settings,
                  scopedSettings: {
                    ...scoped,
                    shared: scoped.shared.filter((entry) => entry.key !== sharedKey),
                  },
                },
                false,
              )
          }

          const deleted = new Set(deletedTaskIds)
          s.store.transaction(() => {
            for (const id of deleted) s.db.prepare('DELETE FROM activity WHERE scope=?').run(id)
            s.threadWatch.forgetTasks([...deleted])
            s.store.update((current) => ({
              ...current,
              repositories: current.repositories.filter((entry) => entry.id !== repositoryId),
              tasks: current.tasks.map((task) => {
                if (deleted.has(task.id)) return task
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
                (limit) => !limit.sourceTaskId || !deleted.has(limit.sourceTaskId),
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
          yield* serviceResult(s.attachments.prune())
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
