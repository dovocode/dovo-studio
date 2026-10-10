import { constants } from 'node:fs'
import { copyFile, glob, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { HttpError } from '../../errors.js'
import { safeFile } from '../repositories/paths.js'

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Resolve includes before creating the checkout so invalid entries leave no partial worktree. */
export async function includedWorktreeFiles(root: string): Promise<string[]> {
  let contents: string
  try {
    contents = await readFile(await safeFile(root, '.worktreeinclude'), 'utf8')
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const files = new Set<string>()
  async function visit(path: string) {
    if (path.split(/[\\/]/).includes('.git')) return
    const entry = await lstat(join(root, path))
    // Do not follow directory links (including dependency links) or copy external references.
    if (entry.isSymbolicLink()) return
    const source = await safeFile(root, path)
    if (entry.isFile()) files.add(path)
    else if (entry.isDirectory())
      for (const child of await readdir(source)) await visit(join(path, child))
  }
  for (const line of contents.split(/\r?\n/)) {
    const pattern = line.trim()
    if (!pattern || pattern.startsWith('#')) continue
    if (
      isAbsolute(pattern) ||
      /^[A-Za-z]:/.test(pattern) ||
      pattern.includes('\0') ||
      pattern.split(/[\\/]/).some((part) => part === '..' || part === '.git')
    )
      throw new HttpError(400, `Invalid .worktreeinclude entry: ${pattern}`)
    for await (const path of glob(pattern, {
      cwd: root,
      exclude: (path) => path.split(/[\\/]/).includes('.git'),
    }))
      await visit(path)
  }
  return [...files]
}

export async function copyWorktreeFiles(root: string, directory: string, files: string[]) {
  for (const path of files) {
    const target = join(directory, path)
    // Preserve tracked files, other branch content and existing symlinks.
    try {
      await lstat(target)
      continue
    } catch (error) {
      if (!missing(error)) throw error
    }
    const destination = await safeFile(directory, path)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(await safeFile(root, path), destination, constants.COPYFILE_EXCL)
  }
}
