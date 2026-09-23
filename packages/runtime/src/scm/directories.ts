import { decode } from '@dovo/protocol'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { directoryRequestSchema, type DirectoryPage } from '@dovo/protocol'
import { repositoryPath } from './paths.js'
import { HttpError, errorMessage } from '../errors.js'
const pageSize = 100
const folderNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
export async function listDirectories(value: unknown): Promise<DirectoryPage> {
  const input = decode(directoryRequestSchema, value)
  try {
    const path = await repositoryPath(!input.path || input.path === '~' ? homedir() : input.path)
    const entries = await readdir(path, {
      withFileTypes: true,
    })
    const candidates = entries.filter(
      (entry) =>
        entry.name !== '.git' &&
        (input.hidden || !entry.name.startsWith('.')) &&
        entry.name.toLowerCase().includes(input.query.toLowerCase()),
    )
    const folders = []
    for (const entry of candidates) {
      let directory = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          directory = (await stat(join(path, entry.name))).isDirectory()
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(String(error.code))
            )
          )
            throw error
        }
      }
      if (directory)
        folders.push({
          name: entry.name,
          path: join(path, entry.name),
        })
    }
    folders.sort(
      (a, b) =>
        folderNames.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    const breadcrumbs: NonNullable<DirectoryPage['breadcrumbs']> = []
    let ancestor = path
    while (true) {
      breadcrumbs.unshift({
        name: basename(ancestor) || ancestor,
        path: ancestor,
      })
      const parent = dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }
    return {
      path,
      parent: dirname(path) === path ? null : dirname(path),
      home: homedir(),
      breadcrumbs,
      total: folders.length,
      entries: folders.slice(input.offset, input.offset + pageSize),
      nextOffset: input.offset + pageSize < folders.length ? input.offset + pageSize : null,
    }
  } catch (error) {
    throw new HttpError(
      400,
      `Cannot browse this folder on the runtime host. Check the path and folder permissions. ${errorMessage(error)}`,
    )
  }
}
