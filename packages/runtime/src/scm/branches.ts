import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode } from '@dovo/protocol'
import { branchesSchema, switchBranchSchema } from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError, runtimeOperation, runtimeProgram } from '../errors.js'
export function listBranchesEffect(s: Pick<Services, 'git'>, cwd: string) {
  return runtimeProgram(
    Effect.gen(function* () {
      const { branch: current } = yield* runtimeOperation(() => s.git.inspect(cwd))
      const refs = yield* runtimeOperation(() =>
        s.git.command(cwd, [
          'for-each-ref',
          '--format=%(refname)%00%(worktreepath)%00%(symref)',
          'refs/heads/',
          'refs/remotes/',
        ]),
      )
      const branches = refs
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const [ref, worktree, symbolic] = line.split('\0')
          return symbolic
            ? []
            : [
                {
                  ref,
                  name: ref.replace(/^refs\/(heads|remotes)\//, ''),
                  remote: ref.startsWith('refs/remotes/'),
                  checkedOut: !!worktree,
                },
              ]
        })
      const head = (yield* runtimeOperation(() =>
        s.git.command(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
      ).pipe(
        Effect.catchAll((error) =>
          branches.length ? Effect.fail(error) : Effect.succeed('unborn'),
        ),
      )).trim()
      return decode(branchesSchema, {
        current,
        revision: `${head}:${current}`,
        branches,
      })
    }),
  )
}
export function listBranches(s: Pick<Services, 'git'>, cwd: string) {
  return runClientEffect(listBranchesEffect(s, cwd))
}
export function switchBranchEffect(
  s: Services,
  cwd: string,
  taskId: string | undefined,
  value: unknown,
) {
  return runtimeProgram(
    Effect.gen(function* () {
      const input = decode(switchBranchSchema, value)
      return yield* s.tasks.withCheckoutMutationEffect(
        cwd,
        runtimeProgram(
          Effect.gen(function* () {
            const before = yield* listBranchesEffect(s, cwd)
            if (before.revision !== input.revision)
              throw new HttpError(409, 'Checkout changed. Refresh branches before switching.')
            if (
              (yield* runtimeOperation(() =>
                s.git.command(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
              )).trim()
            )
              throw new HttpError(409, 'Commit or stash your changes before switching branches.')
            const ownWorktree = taskId && s.store.task(taskId).execution === 'worktree'
            const repos = yield* Effect.forEach(
              s.store.get().repositories,
              (repository) =>
                runtimeOperation(() => s.git.inspect(repository.path)).pipe(
                  Effect.map((checkout) => ({ id: repository.id, path: checkout.path })),
                  Effect.either,
                ),
              { concurrency: 3 },
            )
            const ids = repos.flatMap((result) =>
              result._tag === 'Right' && result.right.path === cwd ? [result.right.id] : [],
            )
            const affected = s.store
              .get()
              .tasks.filter((t) =>
                ownWorktree
                  ? t.id === taskId
                  : t.execution !== 'worktree' && ids.includes(t.repositoryId),
              )
            if (
              affected.some((t) =>
                t.files.some(
                  (file) => file.diskContents !== undefined && file.after !== file.diskContents,
                ),
              )
            )
              throw new HttpError(
                409,
                'Apply or discard saved diff drafts before switching branches.',
              )
            const branch = before.branches.find((b) => b.ref === input.name)
            if (input.action === 'create') {
              yield* runtimeOperation(() =>
                s.git.command(cwd, ['check-ref-format', '--branch', input.name]),
              )
              if (input.name.startsWith('-') || input.name.includes('@{'))
                throw new HttpError(400, 'Invalid branch name')
              yield* runtimeOperation(() => s.git.command(cwd, ['switch', '-c', input.name]))
            } else {
              if (!branch) throw new HttpError(409, 'Branch no longer exists. Refresh branches.')
              if (branch.remote)
                yield* runtimeOperation(() => s.git.command(cwd, ['switch', '--track', branch.ref]))
              else
                yield* runtimeOperation(() =>
                  s.git.command(cwd, ['switch', '--no-guess', branch.name]),
                )
            }
            const after = yield* listBranchesEffect(s, cwd)
            s.store.update((w) => ({
              ...w,
              repositories: w.repositories.map((r) =>
                ids.includes(r.id)
                  ? {
                      ...r,
                      branch: after.current,
                    }
                  : r,
              ),
              tasks: w.tasks.map((t) =>
                (
                  ownWorktree
                    ? t.id === taskId
                    : t.execution !== 'worktree' && ids.includes(t.repositoryId)
                )
                  ? {
                      ...t,
                      files: [],
                      sessionId: undefined,
                      sessionAgentId: undefined,
                      consumedMessageIds: undefined,
                      checkoutBranch: after.current,
                      restartRecovery: undefined,
                      queuePaused: !!t.queue?.length,
                      activity: undefined,
                      error: undefined,
                      status: 'draft',
                    }
                  : t,
              ),
            }))
            s.activity.add('branch', taskId ?? cwd, `Switched to ${after.current}`, {
              cwd,
              before: before.current,
              after: after.current,
            })
            return after
          }),
        ).pipe(Effect.uninterruptible),
      )
    }),
  )
}
export function switchBranch(s: Services, cwd: string, taskId: string | undefined, value: unknown) {
  return runClientEffect(switchBranchEffect(s, cwd, taskId, value))
}
