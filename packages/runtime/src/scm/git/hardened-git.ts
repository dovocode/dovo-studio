import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The Git layout of a checkout that a sandbox can write, recorded before any agent code ran in
 * it. Dovo's own Git calls in that checkout use these paths instead of discovering them again
 * from files the agent can change. All paths are real paths. */
export type PinnedGitLayout = {
  /** The checkout's top-level folder. */
  worktree: string
  gitDir: string
  commonDir: string
  /** Set for a checkout that only shares its common Git folder with a sandboxed checkout: the
   * main checkout or another linked worktree of the same repository. The sandbox cannot write
   * its files, hooks or config, so its hooks still run. */
  keepHooks?: true
}

/** Configuration that stops Git from running programs that a sandboxed agent can plant: hooks,
 * the file system monitor, and Git processes that read a nested repository's own config
 * (submodule status, recursive fetch and push). Values travel as `GIT_CONFIG_*`, which every
 * Git subcommand reads and which overrides repository config. */
export const hardenedGitConfig: ReadonlyArray<readonly [string, string]> = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', '/dev/null'],
  ['diff.ignoreSubmodules', 'all'],
  ['status.submoduleSummary', 'false'],
  ['submodule.recurse', 'false'],
  ['fetch.recurseSubmodules', 'false'],
  ['push.recurseSubmodules', 'no'],
]

/** Environment for a Git call in a sandboxed checkout. `GIT_COMMON_DIR` is required: with only
 * `GIT_DIR`, Git still follows a `commondir` file inside it. */
export function hardenedGitEnvironment(
  layout: PinnedGitLayout,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...env,
    GIT_DIR: layout.gitDir,
    GIT_COMMON_DIR: layout.commonDir,
    GIT_WORK_TREE: layout.worktree,
  }
  const existing = Number(env.GIT_CONFIG_COUNT ?? 0)
  let count = Number.isSafeInteger(existing) && existing > 0 ? existing : 0
  for (const [key, value] of hardenedGitConfig) {
    if (key === 'core.hooksPath' && layout.keepHooks) continue
    result[`GIT_CONFIG_KEY_${count}`] = key
    result[`GIT_CONFIG_VALUE_${count}`] = value
    count++
  }
  result.GIT_CONFIG_COUNT = String(count)
  return result
}

/**
 * The recorded Git folders must still be the same real folders, and `commondir` must still
 * name the recorded common folder. A link anywhere in their path means that the agent replaced
 * a folder, for example `.git`, and Git would follow it. Git's ref store reads `commondir`
 * even when `GIT_COMMON_DIR` is set, so a planted one would send refs elsewhere. The container
 * mounts the folders on themselves; this check also covers a container from an older version.
 * `/dev/null` marks a folder that was not a repository.
 */
export async function assertPinnedGitFolders(layout: PinnedGitLayout) {
  if (layout.gitDir === '/dev/null') return
  const changed = (folder: string): never => {
    throw new Error(
      `The Git folder ${folder} of ${layout.worktree} changed since its sandbox started. Dovo does not run Git in this checkout until the folder is restored.`,
    )
  }
  for (const folder of new Set([layout.gitDir, layout.commonDir])) {
    const same = await realpath(folder).then(
      async (real) => real === folder && (await stat(folder)).isDirectory(),
      () => false,
    )
    if (!same) changed(folder)
  }
  const named = await readFile(join(layout.gitDir, 'commondir'), 'utf8').then(
    (text) => realpath(resolve(layout.gitDir, text.replace(/\r?\n$/, ''))).catch(() => ''),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return layout.gitDir
      throw error
    },
  )
  if (named !== layout.commonDir) changed(layout.gitDir)
}

/** Global options that come before the subcommand in Dovo's Git calls. */
const globalWithValue = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace'])

/** Index of the Git subcommand, after global options such as `-c key=value`. */
export function gitSubcommandIndex(args: readonly string[]) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (globalWithValue.has(arg)) {
      index++
      continue
    }
    if (!arg.startsWith('-')) return index
  }
  return -1
}

/** Commands that compare the working tree with the index or a tree. Without
 * `--ignore-submodules=all` they start `git status` inside every changed nested repository,
 * and that process reads the nested repository's config (fsmonitor, filter drivers). The
 * `diff.ignoreSubmodules` setting does not cover the plumbing commands or an explicit option. */
const worktreeDiffs = new Set(['status', 'diff', 'diff-files', 'diff-index'])

/** Rewrites status and diff arguments for a sandboxed checkout. Other commands are unchanged. */
export function hardenedGitArguments(args: readonly string[]): string[] {
  const at = gitSubcommandIndex(args)
  if (at < 0 || !worktreeDiffs.has(args[at]!)) return [...args]
  const separator = args.indexOf('--', at)
  const end = separator < 0 ? args.length : separator
  const options = args
    .slice(at + 1, end)
    .filter((arg) => arg !== '--ignore-submodules' && !arg.startsWith('--ignore-submodules='))
  return [...args.slice(0, at + 1), '--ignore-submodules=all', ...options, ...args.slice(end)]
}

/** Parses `git ls-files --stage -z` output and returns the paths of gitlink (submodule) entries. */
export function gitlinkPaths(stage: string) {
  const paths: string[] = []
  for (const record of stage.split('\0')) {
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    if (record.startsWith('160000 ')) paths.push(record.slice(tab + 1))
  }
  return paths
}

/**
 * Rewrites a `git add` call so that it never touches a gitlink. `git add` checks every gitlink
 * by reading the nested repository, which can run that repository's fsmonitor or clean filter.
 * The pathspecs move to a private NUL-separated file, so any number of exclusions fits. Returns
 * undefined when the call is not `add` or the index has no gitlinks.
 */
export async function gitAddWithoutGitlinks(args: readonly string[], gitlinks: readonly string[]) {
  const at = gitSubcommandIndex(args)
  if (at < 0 || args[at] !== 'add' || !gitlinks.length) return undefined
  const separator = args.indexOf('--', at)
  if (separator < 0)
    throw new Error('Dovo passes pathspecs to git add after --, so gitlinks can be excluded')
  const globals = args.slice(0, at)
  const literal = globals.includes('--literal-pathspecs')
  const pathspecs = args.slice(separator + 1).map((spec) => (literal ? `:(literal)${spec}` : spec))
  const exclusions = gitlinks.map((path) => `:(exclude,literal)${path}`)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-pathspec-'))
  const file = join(directory, 'pathspec')
  await writeFile(file, [...pathspecs, ...exclusions].join('\0'), { mode: 0o600 })
  return {
    args: [
      ...globals.filter((arg) => arg !== '--literal-pathspecs'),
      ...args.slice(at, separator),
      `--pathspec-from-file=${file}`,
      '--pathspec-file-nul',
    ],
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}
