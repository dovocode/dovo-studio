import { canChangeTaskCheckout } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { Services } from '../../services.js'
import { randomUUID } from 'node:crypto'

type HandoffServices = Pick<
  Services,
  'store' | 'git' | 'tasks' | 'checkouts' | 'jobs' | 'activity' | 'terminals'
>

/** Stashes all uncommitted work (staged, unstaged and untracked) and pins the stash commit in a
 * private ref, or returns undefined when the checkout is clean. Git can only drop stash entries by
 * position, which can hit another process's entry, so the shared entry stays; the private ref keeps
 * recovery possible after that entry is popped, dropped or expired and garbage-collected. */
async function stashAll(s: HandoffServices, cwd: string, id: string, label: string) {
  if (!(await s.git.command(cwd, ['status', '--porcelain'])).trim()) return undefined
  const attempt = randomUUID()
  const marker = `${label} ${attempt}`
  await s.git.command(cwd, ['stash', 'push', '--include-untracked', '-m', marker])
  const entries = await s.git.command(cwd, ['stash', 'list', '--format=%H %gs'])
  const entry = entries.split('\n').find((line) => line.endsWith(marker))
  if (!entry)
    throw new HttpError(
      409,
      `Could not identify the saved changes. Look for the stash named "${marker}" in the shared stash list or Git reflog before making further changes.`,
    )
  const ref = `refs/dovo/handoff/${id}/${attempt}`
  try {
    await s.git.command(cwd, ['update-ref', ref, entry.split(' ')[0], ''])
  } catch (error) {
    throw new HttpError(
      409,
      `Could not pin the saved changes. Look for the stash named "${marker}" in the shared stash list or Git reflog before making further changes. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return ref
}
class StashRecoveryError extends HttpError {}
/** Restores staged, unstaged and untracked changes from the pinned stash commit. */
async function applyStash(s: HandoffServices, cwd: string, ref: string) {
  try {
    await s.git.command(cwd, ['stash', 'apply', '--index', ref])
  } catch (error) {
    throw new StashRecoveryError(
      409,
      `Uncommitted changes could not be applied. They are safe in Git ref ${ref}; inspect and resolve any partly applied changes in ${cwd} before running "git stash apply --index ${ref}" there. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Moves a started task between the project folder and its own worktree, carrying its
 * uncommitted changes. The agent continues in a new session with the conversation replayed. */
export async function handoffTask(s: HandoffServices, id: string, target: 'worktree' | 'main') {
  const task = s.store.taskSummary(id)
  if (task.importedCodexSession)
    throw new HttpError(
      409,
      'Imported Codex sessions keep their original checkout. Start a new thread to use another checkout.',
    )
  if ((task.execution ?? 'main') === target) return { ok: true }
  if (task.existingWorktreePath)
    throw new HttpError(
      409,
      'This task uses an existing worktree. Choose a different checkout in a new task.',
    )
  if (canChangeTaskCheckout(task))
    throw new HttpError(
      409,
      'This task has not started yet. Choose its working directory in the composer instead.',
    )
  s.tasks.requireIdle(id)
  s.jobs.requireTaskIdle(id)
  if (task.pullRequest || task.workItem)
    throw new HttpError(409, 'Tasks for a pull request or linked work item keep their checkout.')
  if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
    throw new HttpError(409, 'Close this task’s terminals before moving it.')
  const repo = s.store.get().repositories.find((item) => item.id === task.repositoryId)
  if (!repo) throw new HttpError(404, 'Repository not found')
  if (repo.kind) throw new HttpError(400, 'This project does not use Git worktrees')
  const { path: root, branch: projectBranch } = await s.git.inspect(repo.path)
  const label = `dovo: move task ${id} to ${target === 'worktree' ? 'its worktree' : 'the project folder'}`

  if (target === 'worktree') {
    if (projectBranch === 'detached HEAD')
      throw new HttpError(
        409,
        'Check out a branch in the project folder before moving to a worktree.',
      )
    return s.tasks.withCheckoutMutation(root, async () => {
      const stash = await stashAll(s, root, id, label)
      const previous = s.store.taskSummary(id)
      let prepared = false
      try {
        // The worktree starts from the project folder's current branch, so the stash applies cleanly.
        s.store.updateTask(id, (value) => ({
          ...value,
          execution: 'worktree',
          worktreeBaseBranch: projectBranch,
          worktreeFromOrigin: false,
          worktreeSetupComplete: undefined,
        }))
        const cwd = await s.checkouts.directory(id)
        prepared = true
        if (stash) await applyStash(s, cwd, stash)
        finish(
          s,
          id,
          `I moved this task into its own worktree at ${cwd}${stash ? ', with its uncommitted changes' : ''}. Continue there.`,
          stash,
        )
        return { ok: true, cwd }
      } catch (error) {
        const current = s.store.taskSummary(id)
        // Nothing was created: put the task and the changes back where they were.
        if (
          !prepared &&
          (!current.checkoutBranch || current.checkoutBranch === previous.checkoutBranch)
        ) {
          s.store.updateTask(id, (value) => ({
            ...value,
            execution: previous.execution,
            worktreeBaseBranch: previous.worktreeBaseBranch,
            worktreeFromOrigin: previous.worktreeFromOrigin,
            worktreeSetupComplete: previous.worktreeSetupComplete,
          }))
        }
        if (stash && !prepared && !(error instanceof StashRecoveryError))
          await applyStash(s, root, stash)
        throw error
      }
    })
  }

  // Worktree → project folder: the folder switches to the task's branch.
  if ((await s.git.command(root, ['status', '--porcelain'])).trim())
    throw new HttpError(
      409,
      'The project folder has uncommitted changes. Commit or stash them before moving this task there.',
    )
  const cwd = await s.checkouts.directory(id)
  if (
    s.store
      .get()
      .tasks.some(
        (other) => other.id !== id && !other.archivedAt && other.existingWorktreePath === cwd,
      )
  )
    throw new HttpError(409, 'Another task uses this worktree. Move or archive that task first.')
  const { branch } = await s.git.inspect(cwd)
  if (branch === 'detached HEAD')
    throw new HttpError(409, 'The task’s worktree is not on a branch.')
  return s.tasks.withCheckoutMutation(cwd, () =>
    s.tasks.withCheckoutMutation(root, async () => {
      const stash = await stashAll(s, cwd, id, label)
      try {
        await s.git.command(root, ['worktree', 'remove', cwd])
      } catch (error) {
        if (stash) await applyStash(s, cwd, stash)
        throw new HttpError(
          409,
          `Could not remove the task’s worktree. ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      try {
        await s.git.command(root, ['checkout', branch])
      } catch (error) {
        throw new HttpError(
          409,
          `Could not switch the project folder to ${branch}.${stash ? ` The task's uncommitted changes are safe in Git ref ${stash}.` : ''} ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      s.store.updateTask(id, (value) => ({ ...value, execution: 'main', checkoutBranch: branch }))
      if (stash) await applyStash(s, root, stash)
      finish(
        s,
        id,
        `I moved this task back to the project folder ${root} on branch ${branch}${stash ? ', with its uncommitted changes' : ''}. Continue there.`,
        stash,
      )
      return { ok: true, cwd: root }
    }),
  )
}

function finish(s: HandoffServices, id: string, note: string, recoveryRef?: string) {
  if (recoveryRef)
    note += ` Changes are already applied; a recovery copy remains in Git ref ${recoveryRef}. The shared Git stash list also keeps a matching "dovo: move task" entry; do not pop it in another checkout.`
  s.store.updateTaskHistory(id, (value) => ({
    ...value,
    messages: [
      ...value.messages,
      { id: randomUUID(), role: 'user', text: note, createdAt: new Date().toISOString() },
    ],
  }))
  s.activity.add('task', id, note)
}
