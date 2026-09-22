import { branchesSchema, switchBranchSchema } from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
export async function listBranches(s: Pick<Services, 'git'>, cwd: string) {
  const { branch: current } = await s.git.inspect(cwd)
  const refs = await s.git.command(cwd, [
    'for-each-ref',
    '--format=%(refname)%00%(worktreepath)%00%(symref)',
    'refs/heads/',
    'refs/remotes/',
  ])
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
  const head = (
    await s.git.command(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(async (error) => {
      if (branches.length) throw error
      return 'unborn'
    })
  ).trim()
  return branchesSchema.parse({ current, revision: `${head}:${current}`, branches })
}
export async function switchBranch(
  s: Services,
  cwd: string,
  taskId: string | undefined,
  value: unknown,
) {
  const input = switchBranchSchema.parse(value)
  return s.tasks.withCheckoutMutation(cwd, async () => {
    const before = await listBranches(s, cwd)
    if (before.revision !== input.revision)
      throw new HttpError(409, 'Checkout changed. Refresh branches before switching.')
    if ((await s.git.command(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])).trim())
      throw new HttpError(409, 'Commit or stash your changes before switching branches.')
    const ownWorktree = taskId && s.store.task(taskId).execution === 'worktree'
    const repos = await Promise.allSettled(
      s.store
        .get()
        .repositories.map(async (r) => ({ id: r.id, path: (await s.git.inspect(r.path)).path })),
    )
    const ids = repos.flatMap((r) =>
      r.status === 'fulfilled' && r.value.path === cwd ? [r.value.id] : [],
    )
    const affected = s.store
      .get()
      .tasks.filter((t) =>
        ownWorktree ? t.id === taskId : t.execution !== 'worktree' && ids.includes(t.repositoryId),
      )
    if (
      affected.some((t) =>
        t.files.some((file) => file.diskContents !== undefined && file.after !== file.diskContents),
      )
    )
      throw new HttpError(409, 'Apply or discard saved diff drafts before switching branches.')
    const branch = before.branches.find((b) => b.ref === input.name)
    if (input.action === 'create') {
      await s.git.command(cwd, ['check-ref-format', '--branch', input.name])
      if (input.name.startsWith('-') || input.name.includes('@{'))
        throw new HttpError(400, 'Invalid branch name')
      await s.git.command(cwd, ['switch', '-c', input.name])
    } else {
      if (!branch) throw new HttpError(409, 'Branch no longer exists. Refresh branches.')
      if (branch.remote) await s.git.command(cwd, ['switch', '--track', branch.ref])
      else await s.git.command(cwd, ['switch', '--no-guess', branch.name])
    }
    const after = await listBranches(s, cwd)
    s.store.update((w) => ({
      ...w,
      repositories: w.repositories.map((r) =>
        ids.includes(r.id) ? { ...r, branch: after.current } : r,
      ),
      tasks: w.tasks.map((t) =>
        (ownWorktree ? t.id === taskId : t.execution !== 'worktree' && ids.includes(t.repositoryId))
          ? {
              ...t,
              files: [],
              sessionId: undefined,
              sessionAgentId: undefined,
              consumedMessageIds: undefined,
              checkoutBranch: after.current,
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
  })
}
