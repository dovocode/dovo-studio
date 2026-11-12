import { lstat, readlink, realpath, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { processEnvironment } from '../../process.js'
import type { GitService } from './git.js'

/** Status and even non-forced removal trust index flags. Inspect hidden content without
 * refreshing the index or clearing flags. Any failed or ambiguous read prevents cleanup. */
export async function worktreeChanged(
  git: Pick<GitService, 'command' | 'readCommand'>,
  cwd: string,
): Promise<boolean> {
  const directory = await lstat(cwd).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (!directory) return false
  if (!directory.isDirectory()) throw new Error('Worktree directory cannot be safely inspected')
  const status = await git.command(
    cwd,
    ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'],
    { ...processEnvironment(), GIT_OPTIONAL_LOCKS: '0' },
  )
  if (status.trim()) return true
  const records = await git.readCommand(cwd, ['ls-files', '--stage', '-v', '-z'])
  if (records && !records.endsWith('\0'))
    throw new Error('Cannot inspect truncated tracked file record')
  const entries = records.split('\0').filter(Boolean)
  if (entries.length > 100_000) throw new Error('Tracked files exceed the cleanup inspection limit')
  let inspected = 0
  for (const record of entries) {
    const match = /^(\S) (\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error('Cannot inspect tracked file record')
    const [, tag, mode, id, stage, file] = match
    if (!tag || !mode || !id || !file || stage !== '0')
      throw new Error('Cannot inspect tracked file stage')
    if (!/^(?:S|[a-z])$/.test(tag) && mode !== '160000') continue
    if (++inspected > 10_000) throw new Error('Hidden files exceed the cleanup inspection limit')
    const path = resolve(cwd, file)
    if (file.includes('\uFFFD') || isAbsolute(file) || !path.startsWith(`${resolve(cwd)}${sep}`))
      throw new Error('Cannot safely decode tracked path')
    const info = await lstat(path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    // Missing skip-worktree entries are normal in sparse checkouts. A missing
    // assume-unchanged entry is a hidden deletion; never delete its registration.
    if (!info) {
      if (tag.toUpperCase() !== 'S') return true
      continue
    }
    if (
      (await realpath(dirname(path))) !==
      (await realpath(cwd).then((root) => resolve(root, dirname(file))))
    )
      throw new Error('Tracked path traverses a symbolic link')
    if (mode === '160000') {
      if (!info.isDirectory()) return true
      // An uninitialized submodule is an empty directory. Initialized submodules
      // can hide their own edits even when the parent's gitlink has no flags.
      if (!(await readdir(path)).length) continue
      const top = (await git.readCommand(path, ['rev-parse', '--show-toplevel'])).trim()
      if ((await realpath(top)) !== (await realpath(path)))
        throw new Error('Cannot inspect submodule checkout')
      if (
        (await git.readCommand(path, ['rev-parse', 'HEAD'])).trim() !== id ||
        (await worktreeChanged(git, path))
      )
        return true
      continue
    }
    if (info.size > 64 * 1024 * 1024)
      throw new Error('Hidden file exceeds the cleanup inspection limit')
    let hash: string
    if (info.isSymbolicLink()) {
      if (mode !== '120000') return true
      const target = await readlink(path, { encoding: 'buffer' })
      const text = target.toString('utf8')
      if (!Buffer.from(text).equals(target)) throw new Error('Cannot safely decode tracked link')
      hash = await git.readCommand(cwd, ['hash-object', '--stdin'], { input: text })
    } else if (info.isFile()) {
      if (mode !== '100644' && mode !== '100755' && mode !== '120000') return true
      if (
        mode === '120000' &&
        (
          await git.readCommand(cwd, ['config', '--type=bool', '--default=true', 'core.symlinks'])
        ).trim() !== 'false'
      )
        return true
      // Git applies clean filters and EOL normalization for regular tracked files.
      // A link checked out with core.symlinks=false holds an unfiltered link target.
      hash = await git.readCommand(cwd, [
        'hash-object',
        ...(mode === '120000' ? ['--no-filters'] : []),
        '--',
        file,
      ])
      if (mode !== '120000') {
        const executable =
          (
            await git.readCommand(cwd, ['config', '--type=bool', '--default=true', 'core.fileMode'])
          ).trim() === 'true'
        if (executable && (mode === '100755') !== !!(info.mode & 0o100)) return true
      }
    } else return true
    if (hash.trim() !== id) return true
  }
  return false
}
