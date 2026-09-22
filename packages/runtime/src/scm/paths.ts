import { realpath, stat, lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, relative, dirname, isAbsolute } from 'node:path'
import { HttpError } from '../errors.js'
export async function repositoryPath(path: string) {
  const full = await realpath(
    path === '~'
      ? homedir()
      : path.startsWith('~/')
        ? resolve(homedir(), path.slice(2))
        : resolve(path),
  )
  if (!(await stat(full)).isDirectory())
    throw new HttpError(400, 'Repository path is not a directory')
  return full
}
export async function safeFile(root: string, path: string) {
  if (!path || isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).includes('.git'))
    throw new HttpError(400, 'Invalid file path')
  const full = resolve(root, path),
    rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new HttpError(400, 'File is outside the repository')
  let ancestor = full
  while (true) {
    try {
      await lstat(ancestor)
      break
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      ancestor = dirname(ancestor)
    }
  }
  // Resolve the nearest existing ancestor, including symlinks. A dangling symlink fails closed.
  const actual = resolve(await realpath(ancestor), relative(ancestor, full))
  const actualRelative = relative(root, actual)
  if (actualRelative.startsWith('..') || isAbsolute(actualRelative))
    throw new HttpError(400, 'Symlink points outside the repository')
  if (actualRelative.split(/[\\/]/).includes('.git')) throw new HttpError(400, 'Invalid file path')
  return full
}
