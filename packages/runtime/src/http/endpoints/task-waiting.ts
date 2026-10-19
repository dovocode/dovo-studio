import { HttpError } from '../../errors.js'
import { permissionPolicyReadOnly } from '@dovo/protocol'
import { resolveTaskAgent, type taskWaitingRequestSchema, type TaskWaiting } from '@dovo/protocol'
import type { Services } from '../../services.js'

export async function taskWaiting(
  s: Services,
  input: typeof taskWaitingRequestSchema.Type,
): Promise<TaskWaiting> {
  const task = s.store.taskSummary(input.taskId)
  const { unlink } = input
  if (unlink) {
    if (unlink.kind === 'thread') {
      if (!unlink.runtimeId) throw new HttpError(400, 'A computer ID is required')
      s.threadWatch.stop(input.taskId, unlink.runtimeId, unlink.target)
    } else if (unlink.kind === 'pull')
      await s.pullRequestWatch.manage({
        taskId: input.taskId,
        action: 'stop',
        repositoryId: unlink.repositoryId,
        url: unlink.target,
      })
    else
      await s.pipelineWatch.manage({
        taskId: input.taskId,
        action: 'stop',
        repositoryId: unlink.repositoryId,
        runIds: [unlink.target],
      })
  }
  const pulls = await s.pullRequestWatch.manage({ taskId: input.taskId, action: 'status' })
  const pipelines = await s.pipelineWatch.manage({ taskId: input.taskId, action: 'status' })
  const settings = s.preferences.get()
  const readOnly = permissionPolicyReadOnly(resolveTaskAgent(task, s.store.get().agents))
  const pausedReason = (enabled: boolean) =>
    !enabled
      ? 'Monitoring paused: watcher disabled in runtime settings'
      : readOnly
        ? 'Monitoring paused: this thread is read-only'
        : undefined
  const project = (id: string) =>
    s.store.get().repositories.find((entry) => entry.id === id)?.name ?? 'Unavailable project'
  return {
    related: [
      ...new Map(
        [
          ...pulls.watches.map((watch) => ({
            label: `PR #${watch.number}`,
            project: project(watch.repositoryId),
            url: watch.url,
          })),
          ...pipelines.watches.map((watch) => ({
            label: `Pipeline run ${watch.runId}`,
            project: project(watch.repositoryId),
            url: watch.url,
          })),
          ...(task.pullRequest
            ? [
                {
                  label: `PR #${task.pullRequest.number}`,
                  project: project(task.repositoryId),
                  url: task.pullRequest.url,
                },
              ]
            : []),
          ...(task.linkedPullRequests ?? []).map((pull) => ({
            label: `PR #${pull.number}`,
            project: project(task.repositoryId),
            url: pull.url,
          })),
          ...(task.workItem
            ? [
                {
                  label:
                    task.workItem.kind === 'pipeline'
                      ? `Pipeline run ${task.workItem.id}`
                      : task.workItem.title,
                  project: project(task.repositoryId),
                  url: task.workItem.url,
                },
              ]
            : []),
        ].map((item) => [item.url, item]),
      ).values(),
    ],
    dependencies: [
      ...s.threadWatch
        .list(task.id)
        .filter((watch) => watch.status === 'watching')
        .map((watch) => ({
          kind: 'thread' as const,
          repositoryId: task.repositoryId,
          runtimeId: watch.runtimeId,
          runtimeIdentity: watch.snapshot?.runtimeId,
          target: watch.threadId,
          label: watch.snapshot?.title ?? 'Connected thread',
          project: watch.computerName,
          url: '',
          status: watch.offline
            ? 'Offline · last known state retained'
            : (watch.snapshot?.phase ?? 'Connecting'),
          checkedAt: watch.checkedAt ?? task.createdAt,
          lastSuccessAt: watch.lastSuccessAt,
          pausedReason: pausedReason(settings.enableStudioThreads),
        })),
      ...pulls.watches
        .filter((watch) => watch.status === 'watching')
        .map((watch) => ({
          kind: 'pull' as const,
          repositoryId: watch.repositoryId,
          target: watch.url,
          label: `PR #${watch.number}`,
          project: project(watch.repositoryId),
          url: watch.url,
          status: 'Waiting for PR feedback',
          pausedReason: pausedReason(settings.enablePullRequestWatching),
          checkedAt: watch.checkedAt,
          error: watch.error,
        })),
      ...pipelines.watches
        .filter((watch) => watch.status === 'watching')
        .map((watch) => ({
          kind: 'pipeline' as const,
          repositoryId: watch.repositoryId,
          target: watch.runId,
          label: `Pipeline run ${watch.runId}`,
          project: project(watch.repositoryId),
          url: watch.url,
          status: watch.runStatus,
          lastSuccessAt: watch.lastSuccessAt,
          pausedReason: pausedReason(settings.enablePipelineWatching),
          checkedAt: watch.checkedAt,
          error: watch.error,
        })),
    ],
  }
}
