import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  defaultWorktreeBase,
  SCRATCH_PROJECT_ID,
  type CreateWorkspaceTerminal,
  type TerminalInfo,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { repositoryPath } from '../scm/repositories/paths.js'
import { listBranches } from '../scm/git/branches.js'
import { requireCompleteWorktree, worktreeRecords } from '../scm/git/worktree-records.js'

export type WorkspaceTerminalCheckout = Pick<
  TerminalInfo,
  'repositoryId' | 'execution' | 'checkoutBranch'
> & { directory: string }

/** Standalone checkouts are registered Git worktrees, without a synthetic task or cleanup owner. */
export async function workspaceTerminalCheckout(
  s: Pick<Services, 'git' | 'store' | 'preferences'>,
  input: CreateWorkspaceTerminal,
  authorize: () => void,
): Promise<WorkspaceTerminalCheckout> {
  authorize()
  const selected = input.repositoryId
    ? s.store.get().repositories.find((item) => item.id === input.repositoryId)
    : undefined
  if (input.repositoryId && input.repositoryId !== SCRATCH_PROJECT_ID && !selected)
    throw new HttpError(404, 'Project not found')
  // No Project always uses the owning computer's home, never its managed scratch folder.
  const repository =
    input.repositoryId === SCRATCH_PROJECT_ID || selected?.kind === 'scratch' ? undefined : selected
  const execution = input.execution ?? (input.existingWorktreePath ? 'worktree' : 'main')
  if (
    (execution === 'main' && (input.existingWorktreePath || input.worktreeBaseBranch)) ||
    (input.existingWorktreePath && input.worktreeBaseBranch)
  )
    throw new HttpError(400, 'Choose one terminal checkout')
  if (!repository && execution === 'worktree')
    throw new HttpError(400, 'Choose a Git project for a worktree')
  const directory = await repositoryPath(repository?.path ?? homedir())
  authorize()
  if (!repository || repository.kind) {
    if (execution === 'worktree')
      throw new HttpError(400, 'This project does not use Git worktrees')
    return { directory, execution: 'main', repositoryId: repository?.id }
  }
  const checkout = await s.git.inspect(directory)
  authorize()
  if (execution === 'main')
    return { directory, execution, repositoryId: repository.id, checkoutBranch: checkout.branch }

  if (input.existingWorktreePath) {
    const records = worktreeRecords(
      await s.git.command(directory, ['worktree', 'list', '--porcelain', '-z']),
    )
    authorize()
    // Check Git's registration before resolving any user-supplied filesystem path.
    const record = records.find((item) => item.path === input.existingWorktreePath && !item.main)
    if (!record?.path) throw new HttpError(400, 'Choose an existing worktree of this project')
    requireCompleteWorktree(record)
    const selected = await repositoryPath(record.path)
    authorize()
    return {
      directory: selected,
      execution,
      repositoryId: repository.id,
      checkoutBranch: record.branch?.replace(/^refs\/heads\//, ''),
    }
  }

  const refs = await listBranches(s, directory)
  authorize()
  const selection =
    input.worktreeBaseBranch ??
    defaultWorktreeBase(refs.branches, refs.current, false, refs.originDefault)
  const base = refs.branches.find((item) => item.ref === selection || item.name === selection)?.ref
  if (!base) throw new HttpError(400, 'Choose an existing base branch for the terminal worktree')
  const common = (
    await s.git.command(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  authorize()
  const root = s.preferences.worktreesRoot()
  const name = `terminal-${randomUUID()}`
  const target = join(root, name)
  const branch = `${s.preferences.get().branchPrefix}${name}`
  await mkdir(root, { recursive: true })
  authorize()
  await s.git.addWorktree(directory, target, ['-b', branch, target, base])
  const canonical = await repositoryPath(target)
  // Record already-created work even if access was revoked while Git was running.
  s.store.rememberWorktree(common, canonical)
  authorize()
  return { directory: canonical, execution, repositoryId: repository.id, checkoutBranch: branch }
}
