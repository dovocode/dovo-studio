import type { GitService } from '../git/git.js'

const LIMIT = 40_000

/** The checkout's uncommitted changes as text for a prompt: stat, new files, then the patch,
 * bounded. Anything git cannot produce (no commits yet, huge output) is left out. */
export async function uncommittedChanges(git: GitService, cwd: string) {
  const run = (args: string[]) => git.command(cwd, args).catch(() => '')
  const [stat, untracked, patch] = await Promise.all([
    run(['diff', 'HEAD', '--stat']),
    run(['ls-files', '--others', '--exclude-standard']),
    run(['diff', 'HEAD']),
  ])
  return [stat.trim(), untracked.trim() ? `New files:\n${untracked.trim()}` : '', patch]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, LIMIT)
}

/** A branch's changes against its base, and its commit subjects, for a pull request. */
export async function branchChanges(git: GitService, cwd: string, base: string, head: string) {
  const run = (args: string[]) => git.command(cwd, args).catch(() => undefined)
  // Prefer the remote-tracking base: the pull request compares against the server's branch.
  let range: string | undefined
  for (const candidate of [`origin/${base}`, base])
    if ((await run(['rev-parse', '--verify', '--quiet', candidate])) !== undefined) {
      range = candidate
      break
    }
  if (!range) return { diff: '', commits: '' }
  const [stat, patch, commits] = await Promise.all([
    run(['diff', '--stat', `${range}...${head}`]),
    run(['diff', `${range}...${head}`]),
    run(['log', '--format=%s', `${range}..${head}`]),
  ])
  return {
    diff: [stat?.trim(), patch].filter(Boolean).join('\n\n').slice(0, LIMIT),
    commits: (commits ?? '').trim().slice(0, 8000),
  }
}
