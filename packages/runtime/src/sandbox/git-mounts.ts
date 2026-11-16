import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { exec, processEnvironment } from '../process.js'
import { hardenedGitEnvironment, type PinnedGitLayout } from '../scm/git/hardened-git.js'

type Mount = { path: string; readOnly: boolean }

/** A Git layout check failed. The sandbox must not start, and must not mount anything new. */
export class GitLayoutError extends Error {}

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`)
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

async function entry(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (missing(error)) return undefined
    throw error
  })
}
/** The path that a Git pointer file (`.git`, `commondir`, `gitdir`) names, as a real path. */
async function pointer(file: string, base: string, prefix = '') {
  const text = (await readFile(file, 'utf8')).replace(/\r?\n$/, '')
  if (!text.startsWith(prefix)) return undefined
  const target = resolve(base, text.slice(prefix.length))
  return realpath(target).catch(() => target)
}

/**
 * Check that a checkout's Git files still describe the recorded layout, using only file system
 * reads (no Git process). Rejects symbolic links for every path that Dovo mounts, and every
 * file that could point Git somewhere else: a `.git` between the folder and its top level, a
 * changed `.git` file, `commondir` and `gitdir` files, and a `commondir` file in the common
 * folder.
 */
export async function verifyGitLayout(
  root: string,
  layout: PinnedGitLayout,
  /** The first check, before Dovo records the layout. */
  recording = false,
) {
  const fail: (detail: string) => never = (detail) => {
    throw new GitLayoutError(
      recording
        ? `Dovo cannot start a sandbox for ${root}: ${detail}. Git on this computer could run code from these Git files. Check the .git folder, then send the message again.`
        : `The Git folder of ${root} changed since its sandbox started: ${detail}. Dovo stopped this sandbox so that Git on this computer does not run code from changed Git files. Restore the Git folder, or start a new thread.`,
    )
  }
  const { worktree, gitDir, commonDir } = layout
  const real = await realpath(root).catch(() => fail(`${root} is missing`))
  if (!within(real, worktree)) fail(`${root} is no longer inside ${worktree}`)
  for (let folder = real; folder !== worktree; folder = dirname(folder))
    if (await entry(join(folder, '.git'))) fail(`${join(folder, '.git')} appeared`)
  const dotGit = join(worktree, '.git')
  const own = await entry(dotGit)
  if (!own) fail(`${dotGit} is missing`)
  if (own.isSymbolicLink()) fail(`${dotGit} is a symbolic link`)
  for (const folder of [gitDir, commonDir]) {
    const info = await entry(folder)
    if (!info?.isDirectory() || info.isSymbolicLink()) fail(`${folder} is not a folder`)
    // A Git folder inside the checkout is one the agent could have written, unless it is the
    // checkout's own .git folder.
    if (within(folder, worktree) && folder !== dotGit) fail(`${folder} is inside the checkout`)
  }
  if (gitDir === dotGit) {
    if (!own.isDirectory()) fail(`${dotGit} is no longer a folder`)
  } else {
    if (!own.isFile()) fail(`${dotGit} is no longer a file`)
    if ((await pointer(dotGit, worktree, 'gitdir: ')) !== gitDir)
      fail(`${dotGit} points to another Git folder`)
  }
  const commondir = join(gitDir, 'commondir')
  if (commonDir === gitDir) {
    if (await entry(commondir)) fail(`${commondir} appeared`)
  } else {
    // A linked worktree: <common>/worktrees/<name>, with pointers both ways.
    if (dirname(gitDir) !== join(commonDir, 'worktrees'))
      fail(`${gitDir} is not a worktree of ${commonDir}`)
    for (const file of [commondir, join(gitDir, 'gitdir')]) {
      const info = await entry(file)
      if (!info?.isFile()) fail(`${file} is not a file`)
    }
    if ((await pointer(commondir, gitDir)) !== commonDir) fail(`${commondir} changed`)
    const back = await pointer(join(gitDir, 'gitdir'), gitDir)
    if (back !== (await realpath(dotGit).catch(() => dotGit)))
      fail(`${join(gitDir, 'gitdir')} points to another checkout`)
    if (await entry(join(commonDir, 'commondir'))) fail(`${join(commonDir, 'commondir')} appeared`)
  }
  for (const file of [join(commonDir, 'config'), join(gitDir, 'config.worktree')]) {
    const info = await entry(file)
    if (info && (!info.isFile() || info.isSymbolicLink())) fail(`${file} is not a file`)
  }
  const hooks = await entry(join(commonDir, 'hooks'))
  if (hooks && (!hooks.isDirectory() || hooks.isSymbolicLink()))
    fail(`${join(commonDir, 'hooks')} is not a folder`)
}

/**
 * Where Git keeps a checkout's data, from `git rev-parse`, checked with `verifyGitLayout`.
 * Returns undefined outside a repository. Run it only before any agent code ran in the folder:
 * the result is recorded and every later check compares with it.
 */
export async function resolveGitLayout(root: string): Promise<PinnedGitLayout | undefined> {
  let stdout: string
  try {
    ;({ stdout } = await exec(
      'git',
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'],
      { cwd: root, timeout: 10000, env: processEnvironment() },
    ))
  } catch {
    return undefined
  }
  const [worktree, gitDir, commonDir] = stdout.trim().split('\n')
  if (!worktree || !gitDir || !commonDir || ![worktree, gitDir, commonDir].every(isAbsolute))
    return undefined
  const layout = {
    worktree: await realpath(worktree),
    gitDir: await realpath(gitDir),
    commonDir: await realpath(commonDir),
  }
  await verifyGitLayout(root, layout, true)
  return layout
}

/** Whether Git reads `config.worktree`. Reads only the recorded config file. */
async function worktreeConfig(layout: PinnedGitLayout) {
  // `git config --get` exits with 1 when the key is not set.
  return exec(
    'git',
    [
      'config',
      '--file',
      join(layout.commonDir, 'config'),
      '--type=bool',
      '--get',
      'extensions.worktreeConfig',
    ],
    {
      cwd: layout.commonDir,
      timeout: 10000,
      env: hardenedGitEnvironment(layout, processEnvironment()),
    },
  ).then(
    ({ stdout }) => stdout.trim() === 'true',
    () => false,
  )
}

/** Git reports real paths. Map a path under a checkout's real path back to the path that the
 * container mounts, so a checkout reached through a symbolic link is still covered. */
async function viewOf(root: string) {
  const real = await realpath(root).catch(() => root)
  return (path: string) => (within(path, real) ? root + path.slice(real.length) : path)
}

/**
 * Mounts that protect the host from Git files planted in the sandbox, for recorded and verified
 * layouts. Git on the host runs hooks from the hooks folder, or from `core.hooksPath` in the
 * config, and follows `.git`, `commondir` and `gitdir` files to find them. Inside the container:
 *
 * - The hooks folder, config and `config.worktree` are read-only.
 * - A `.git` folder is mounted on itself, so it cannot be renamed or replaced by a link. A
 *   linked worktree's `.git` file, and its `commondir` and `gitdir` files, are read-only.
 *
 * Returns the writable mount for the checkout's recorded common folder when it is outside the
 * checkout (a linked worktree), the `.git` folder mounts, and read-only mounts that must come
 * after every writable mount. Creates a missing hooks folder, and an empty `config.worktree`
 * when Git reads one, so the bind mounts have a source. Never changes an existing file.
 */
export async function gitMounts(
  cwd: string,
  editable: readonly string[],
  layouts: ReadonlyMap<string, PinnedGitLayout | undefined>,
): Promise<{ common?: Mount; protect: Mount[] }> {
  const checkouts = await Promise.all(
    [cwd, ...editable].map(async (root) => {
      const layout = layouts.get(root)
      if (!layout) return undefined
      const view = await viewOf(root)
      return {
        layout,
        worktree: view(layout.worktree),
        gitDir: view(layout.gitDir),
        commonDir: view(layout.commonDir),
        worktreeConfig: await worktreeConfig(layout),
      }
    }),
  )
  const main = checkouts[0]
  const common =
    main && !within(main.commonDir, cwd) ? { path: main.commonDir, readOnly: false } : undefined
  const writable = [cwd, ...(common ? [common.path] : []), ...editable]
  const covered = (path: string) => writable.some((root) => within(path, root))
  const folders = new Set<string>()
  const readOnly = new Set<string>()
  for (const checkout of checkouts) {
    if (!checkout) continue
    const dotGit = join(checkout.worktree, '.git')
    if (covered(dotGit)) {
      if (checkout.gitDir === dotGit) folders.add(dotGit)
      else readOnly.add(dotGit)
    }
    // The other worktrees of the repository keep their Git folders here. Read-only, so the
    // agent cannot plant a commondir, config.worktree or index for them. Created when missing,
    // so worktrees added later on the host are covered too.
    const worktrees = join(checkout.commonDir, 'worktrees')
    if (covered(worktrees)) {
      await mkdir(worktrees).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      readOnly.add(worktrees)
    }
    if (checkout.gitDir !== checkout.commonDir) {
      // The thread's own Git folder: writable on top of the read-only worktrees folder, and
      // mounted on itself so that it cannot be renamed or replaced by a link.
      if (covered(checkout.gitDir)) folders.add(checkout.gitDir)
      for (const file of ['commondir', 'gitdir'].map((name) => join(checkout.gitDir, name)))
        if (covered(file)) readOnly.add(file)
    }
    const hooks = join(checkout.commonDir, 'hooks')
    if (covered(hooks)) {
      await mkdir(hooks).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      // The folder may have appeared between the layout check and mkdir.
      await verifyGitLayout(checkout.worktree, checkout.layout)
      readOnly.add(hooks)
    }
    const config = join(checkout.commonDir, 'config')
    if (covered(config) && (await entry(config))) readOnly.add(config)
    if (!checkout.worktreeConfig) continue
    // The thread's own config.worktree, and the main checkout's one in the common folder.
    for (const worktree of new Set([
      join(checkout.gitDir, 'config.worktree'),
      join(checkout.commonDir, 'config.worktree'),
    ])) {
      if (!covered(worktree)) continue
      // Git creates this file on the first `git config --worktree` write. An empty file reads
      // the same as a missing one; the `wx` flag never touches an existing file or link.
      await writeFile(worktree, '', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      readOnly.add(worktree)
    }
  }
  // A parent mount comes before the mounts inside it.
  const depth = (mount: Mount) => mount.path.split('/').length
  return {
    ...(common ? { common } : {}),
    protect: [
      ...[...folders].map((path) => ({ path, readOnly: false })),
      ...[...readOnly].map((path) => ({ path, readOnly: true })),
    ].sort((a, b) => depth(a) - depth(b)),
  }
}
