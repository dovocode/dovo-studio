import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import type { ProjectTransferManifest } from '@dovo/protocol'
import { gitRemoteIdentity, PROJECT_TRANSFER_MAX_FILES } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { runClientEffect } from '@dovo/client-runtime'
import { worktreeChoicesEffect } from '../git/worktrees.js'
import { HttpError } from '../../errors.js'
import { exec, processEnvironment } from '../../process.js'
import { safeFile } from './paths.js'

const generated = new Set([
  '.git',
  'node_modules',
  '.next',
  '.cache',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.expo',
  '.gradle',
  'Pods',
  'dist-electron',
  '.output',
  'storybook-static',
])
const privateFile = (path: string) =>
  /(?:^|\/)(?:\.env(?:\..*)?|\.envrc|\.dev\.vars|.*\.(?:pem|key|p12|pfx))$/.test(path)
const hasControls = (value: string) =>
  Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  )
export function projectTransferRemote(value: string) {
  if (!gitRemoteIdentity(value) || hasControls(value) || /\s/.test(value)) return undefined
  if (!value.includes('://')) return /^[a-zA-Z0-9_.-]+@[^/]+:.+/.test(value) ? value : undefined
  const url = new URL(value)
  if (url.password || (['http:', 'https:'].includes(url.protocol) && url.username)) return undefined
  return value
}
export function transferPath(path: string) {
  // Portable names only: prevent Windows drive/ADS paths, aliases and Git metadata writes.
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    /[<>"|?*:]/.test(path) ||
    hasControls(path) ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /^\.git$/i.test(part) ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new HttpError(400, `This file name cannot be copied between computers: ${path}`)
  return path
}
export async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function transferGit(s: Services, cwd: string, args: string[], signal?: AbortSignal) {
  return (
    await exec(s.commands.get().git, args, {
      cwd,
      signal,
      env: processEnvironment(),
      timeout: 600000,
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout
}
/** Main checkout metadata travels separately from the selected feature checkout. */
export async function transferProject(s: Services, repositoryId: string, signal?: AbortSignal) {
  const repo = s.store.get().repositories.find((repo) => repo.id === repositoryId && !repo.kind)
  if (!repo) throw new HttpError(404, 'Choose a Git project to copy')
  const baseHead = (
    await transferGit(s, repo.path, ['rev-parse', '--verify', 'HEAD'], signal)
  ).trim()
  const baseBranch =
    (await transferGit(s, repo.path, ['branch', '--show-current'], signal)).trim() || undefined
  const rootCommit = (
    await transferGit(s, repo.path, ['rev-list', '--max-parents=0', 'HEAD'], signal)
  )
    .trim()
    .split('\n')[0]!
  const identity = await s.git.repositoryIdentity(repo.path, true)
  return { baseHead, baseBranch, rootCommit, identity }
}
async function regular(root: string, path: string) {
  transferPath(path)
  const full = join(root, path)
  try {
    const info = await lstat(full)
    if (!info.isFile()) return undefined
    await safeFile(root, path)
    return { path, bytes: info.size, mode: info.mode }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
export async function inspectTransfer(
  s: Services,
  repositoryId: string,
  signal?: AbortSignal,
  worktreePath?: string,
) {
  const repo = s.store.get().repositories.find((repo) => repo.id === repositoryId)
  if (!repo || repo.kind === 'scratch') throw new HttpError(404, 'Choose a project to copy')
  if (worktreePath) {
    const choices = await runClientEffect(worktreeChoicesEffect(s, repositoryId))
    if (!choices.worktrees.some((entry) => entry.path === worktreePath))
      throw new HttpError(409, 'Choose an existing worktree belonging to this project')
  }
  const root = await realpath(worktreePath ?? repo.path)
  const files: { path: string; bytes: number; mode: number }[] = [],
    ignoredFiles: { path: string; bytes: number; mode: number }[] = []
  let skippedLinks = 0
  let ignoredFilesTruncated = false
  const git = !repo.kind || (await s.git.isRepository(root))
  const add = async (path: string, ignored = false) => {
    signal?.throwIfAborted()
    if (ignored && ignoredFiles.length >= 10000) {
      ignoredFilesTruncated = true
      return
    }
    const info = await regular(root, path)
    if (info) (ignored ? ignoredFiles : files).push(info)
    else {
      const info = await lstat(join(root, path)).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      if (info?.isSymbolicLink()) skippedLinks++
      else if (info?.isDirectory() && git)
        throw new HttpError(409, `Submodules must be copied separately: ${path}`)
    }
    if (files.length > PROJECT_TRANSFER_MAX_FILES)
      throw new HttpError(
        413,
        `This workspace exceeds the ${PROJECT_TRANSFER_MAX_FILES.toLocaleString()} file copy limit.`,
      )
  }
  if (git) {
    const tracked = new Set(
      (await transferGit(s, root, ['ls-files', '-z', '--cached'], signal))
        .split('\0')
        .filter(Boolean),
    )
    const untracked = (
      await transferGit(s, root, ['ls-files', '-z', '--others', '--exclude-standard'], signal)
    )
      .split('\0')
      .filter(Boolean)
      .filter((path) => !path.split('/').some((part) => generated.has(part)))
    for (const path of new Set([...tracked, ...untracked]))
      await add(path, !tracked.has(path) && privateFile(path))
    const ignored = (
      await transferGit(
        s,
        root,
        ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
        signal,
      )
    )
      .split('\0')
      .filter(Boolean)
    const visitIgnored = async (path: string) => {
      signal?.throwIfAborted()
      if (path.split('/').some((part) => generated.has(part))) return
      if (ignoredFiles.length >= 10000) {
        ignoredFilesTruncated = true
        return
      }
      const entry = await lstat(join(root, path))
      if (entry.isDirectory()) {
        for (const name of await readdir(join(root, path))) {
          await visitIgnored(`${path}/${name}`)
          if (ignoredFilesTruncated) break
        }
      } else await add(path, true)
    }
    for (const path of ignored) {
      await visitIgnored(path.replace(/\/$/, ''))
      if (ignoredFilesTruncated) break
    }
  } else {
    const walk = async (directory: string) => {
      for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
        signal?.throwIfAborted()
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (!generated.has(entry.name)) await walk(path)
        } else if (entry.isSymbolicLink()) skippedLinks++
        else if (entry.isFile()) await add(path, privateFile(path))
      }
    }
    await walk('')
  }
  return { repo, root, git, files, ignoredFiles, ignoredFilesTruncated, skippedLinks }
}

export async function prepareTransfer(
  s: Services,
  repositoryId: string,
  ignored: string[],
  folder: string,
  signal: AbortSignal,
  worktreePath?: string,
) {
  const source = await inspectTransfer(s, repositoryId, signal, worktreePath)
  const project = worktreePath ? await transferProject(s, repositoryId, signal) : undefined
  const selected = new Set(ignored)
  if (ignored.some((path) => !source.ignoredFiles.some((file) => file.path === path)))
    throw new HttpError(409, 'The ignored files changed. Review the files and try again.')
  const entries: ProjectTransferManifest['entries'] = []
  const stage = async (
    path: string,
    file: string,
    kind: 'file' | 'bundle' | 'index',
    mode: number,
  ) => {
    signal.throwIfAborted()
    entries.push({
      path,
      kind,
      bytes: (await stat(file)).size,
      sha256: await hashFile(file),
      mode: mode & 0o777,
    })
  }
  let git: ProjectTransferManifest['git']
  if (source.git) {
    const head = (
      await transferGit(s, source.root, ['rev-parse', '--verify', 'HEAD'], signal).catch(() => '')
    ).trim()
    if (head) {
      const branch =
        (await transferGit(s, source.root, ['branch', '--show-current'], signal)).trim() ||
        undefined
      const remote = (
        await transferGit(s, source.root, ['remote', 'get-url', 'origin'], signal).catch(() => '')
      ).trim()
      // Never export embedded tokens, local filesystem remotes or executable transports.
      const safeRemote = projectTransferRemote(remote)
      git = { head, branch, remote: safeRemote }
      const bundle = join(folder, String(entries.length))
      await transferGit(
        s,
        source.root,
        [
          'bundle',
          'create',
          bundle,
          'HEAD',
          '--branches',
          '--tags',
          ...(project ? [project.baseHead] : []),
        ],
        signal,
      )
      await stage('repository.bundle', bundle, 'bundle', 0o600)
      const patch = await transferGit(
        s,
        source.root,
        ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--'],
        signal,
      )
      if (patch) {
        const file = join(folder, String(entries.length))
        await writeFile(file, patch, { mode: 0o600 })
        await stage('index.patch', file, 'index', 0o600)
      }
    } else throw new HttpError(409, 'Make an initial Git commit before copying this project.')
  }
  for (const file of [
    ...source.files,
    ...source.ignoredFiles.filter((file) => selected.has(file.path)),
  ]) {
    signal.throwIfAborted()
    const original = await safeFile(source.root, file.path)
    const before = await lstat(original)
    // O_NOFOLLOW protects the final component; safeFile validates the parent chain.
    const handle = await open(original, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.ino !== before.ino)
        throw new HttpError(409, 'Workspace changed while preparing the copy. Try again.')
      const target = join(folder, String(entries.length))
      await pipeline(
        handle.createReadStream({ autoClose: false }),
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
        { signal },
      )
      const after = await lstat(original)
      if (
        !after.isFile() ||
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size ||
        before.ino !== after.ino
      )
        throw new HttpError(409, 'Workspace changed while preparing the copy. Try again.')
      await chmod(target, 0o600)
      await stage(file.path, target, 'file', before.mode)
    } finally {
      await handle.close()
    }
  }
  if (git && (await transferGit(s, source.root, ['rev-parse', 'HEAD'], signal)).trim() !== git.head)
    throw new HttpError(409, 'The Git branch changed during preparation. Try again.')
  return { name: source.repo.name, entries, git, project, skippedLinks: source.skippedLinks }
}

export async function installTransfer(
  s: Services,
  manifest: ProjectTransferManifest,
  folder: string,
  signal: AbortSignal,
) {
  const workspace = join(folder, 'workspace')
  await mkdir(workspace)
  const bundle = manifest.entries.findIndex((entry) => entry.kind === 'bundle')
  if (manifest.git) {
    if (bundle < 0) throw new HttpError(400, 'Missing Git history')
    await transferGit(s, workspace, ['init'], signal)
    await transferGit(
      s,
      workspace,
      [
        'fetch',
        '--update-head-ok',
        '--no-recurse-submodules',
        '--',
        join(folder, String(bundle)),
        'HEAD',
        '+refs/heads/*:refs/heads/*',
        '+refs/tags/*:refs/tags/*',
      ],
      signal,
    )
    if (manifest.git.branch) {
      await transferGit(s, workspace, ['check-ref-format', '--branch', manifest.git.branch], signal)
      await transferGit(
        s,
        workspace,
        ['symbolic-ref', 'HEAD', `refs/heads/${manifest.git.branch}`],
        signal,
      )
    } else
      await transferGit(
        s,
        workspace,
        ['update-ref', '--no-deref', 'HEAD', manifest.git.head],
        signal,
      )
    await transferGit(s, workspace, ['reset', '--mixed', manifest.git.head], signal)
    const remote = manifest.git.remote
    if (remote && projectTransferRemote(remote))
      await s.git.withSharedConfig(workspace, () =>
        transferGit(s, workspace, ['remote', 'add', 'origin', remote], signal),
      )
  }
  await restoreTransfer(s, manifest, folder, workspace, signal)
  return workspace
}

/** Restore into an empty, owned checkout. No checkout can introduce symlink ancestors. */
export async function restoreTransfer(
  s: Services,
  manifest: ProjectTransferManifest,
  folder: string,
  workspace: string,
  signal: AbortSignal,
) {
  const patch = manifest.entries.findIndex((entry) => entry.kind === 'index')
  if (manifest.git && patch >= 0)
    await transferGit(
      s,
      workspace,
      ['apply', '--cached', '--binary', '--', join(folder, String(patch))],
      signal,
    )
  for (const [index, entry] of manifest.entries.entries()) {
    signal.throwIfAborted()
    if (entry.kind !== 'file') continue
    transferPath(entry.path)
    const target = join(workspace, entry.path)
    // All ancestors are new directories in an owned staging folder. No archive or Git
    // checkout creates symlinks, hooks or .git writes from workspace file names.
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(folder, String(index)), target)
    await chmod(target, entry.mode)
  }
}
