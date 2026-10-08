import { updatePullStackPrompt } from '@dovo/protocol'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { pullTaskInputSchema, type Task } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, errorMessage, runtimeOperation, runtimeProgram } from '../../errors.js'
import { inspectPullBranch } from './pull-branch.js'
export function createPullTaskEffect(
  s: Services,
  repositoryId: string,
  cwd: string,
  value: unknown,
) {
  return runtimeProgram(
    Effect.gen(function* () {
      const input = decode(pullTaskInputSchema, value)
      if (input.agentId && !s.store.get().agents.some((a) => a.id === input.agentId))
        throw new HttpError(400, 'Choose an existing agent')
      const detail = yield* runtimeOperation(() => s.pulls.detail(cwd, input.number))
      const pull = detail.pull
      if (pull.headSha !== input.headSha)
        throw new HttpError(409, 'This PR changed. Refresh its details before creating a task.')
      if (input.checkoutMode === 'pr-branch' && !pull.headCloneUrl)
        throw new HttpError(
          409,
          'The PR source repository is unavailable. Choose a separate branch or refresh the PR.',
        )
      if (input.stackAction && input.checkoutMode === 'pr-branch')
        throw new HttpError(400, 'Stack updates use a separate branch.')
      if (input.checkoutMode === 'pr-branch')
        yield* runtimeOperation(() =>
          inspectPullBranch(s.git, cwd, { ...pull, headBranch: pull.head }),
        )
      const stack =
        input.stackAction === 'update'
          ? (yield* runtimeOperation(() => s.pullCache.stack(cwd, input.number, true))).stack
          : undefined
      if (input.stackAction && !stack)
        throw new HttpError(409, 'This PR is no longer part of an open stack. Refresh its details.')
      const objective = [stack ? updatePullStackPrompt(stack) : input.objective, pull.url].join(
        '\n\n',
      )
      const task: Task = {
        id: randomUUID(),
        title: stack
          ? `Update stack from PR #${stack.rootNumber}`
          : `PR #${pull.number}: ${pull.title}`,
        repositoryId,
        agentId: input.agentId,
        harness: input.agentId
          ? undefined
          : (input.harness ?? s.store.taskDefaults(repositoryId).harness),
        execution: 'worktree',
        worktreeFromOrigin: false,
        origin: pull.url,
        pullRequest: {
          provider: pull.provider,
          connectionId: pull.connectionId,
          headBranch: pull.head,
          headCloneUrl: pull.headCloneUrl,
          checkoutMode: input.checkoutMode ?? 'new-branch',
          headRef: pull.headRef,
          cloneUrl: pull.cloneUrl,
          number: pull.number,
          url: pull.url,
          repositoryUrl: pull.repositoryUrl,
          headSha: pull.headSha,
          baseSha: pull.baseSha,
        },
        status: 'draft',
        createdAt: new Date().toISOString(),
        // Linking a PR fixes its checkout, while the first submitted input selects the provider.
        messages: input.run
          ? [
              {
                id: randomUUID(),
                role: 'user',
                text: objective,
              },
            ]
          : [],
        draft: input.run ? '' : objective,
        files: [],
        example: false,
      }
      s.store.update((workspace) => ({
        ...workspace,
        tasks: [...workspace.tasks, task],
      }))
      if (input.run) {
        const started = yield* Effect.result(s.tasks.startEffect(task.id))
        if (started._tag === 'Failure') {
          const message = errorMessage(started.failure)
          s.store.updateTask(task.id, (t) => ({
            ...t,
            status: 'failed',
            error: message,
          }))
          return {
            id: task.id,
            error: message,
          }
        }
      }
      return {
        id: task.id,
      }
    }),
  )
}
export function createPullTask(s: Services, repositoryId: string, cwd: string, value: unknown) {
  return runClientEffect(createPullTaskEffect(s, repositoryId, cwd, value))
}
