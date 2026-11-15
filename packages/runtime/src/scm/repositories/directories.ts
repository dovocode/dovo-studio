import { decode } from '@dovo/protocol'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { directoryRequestSchema, type DirectoryPage } from '@dovo/protocol'
import { repositoryPath } from './paths.js'
import { HttpError, errorMessage } from '../../errors.js'
// Match folder names before pagination so both clients see the same order.
function folderRank(name: string, query: string): number[] | undefined {
  const value = name.normalize('NFC').toLowerCase()
  if (!query) return [0]
  if (value === query) return [0]
  if (value.startsWith(query)) return [1]
  const start = value.indexOf(query)
  if (start >= 0) {
    let at = start
    while (at >= 0) {
      if (at === 0 || /[^\p{L}\p{N}]/u.test(value[at - 1]!)) return [2, at]
      at = value.indexOf(query, at + 1)
    }
    return [3, start]
  }
  let position = 0
  let first = -1
  let last = -1
  for (const character of query) {
    const at = value.indexOf(character, position)
    if (at < 0) return undefined
    if (first < 0) first = at
    last = at
    position = at + character.length
  }
  return [4, last - first, first]
}
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
    const query = input.query.normalize('NFC').toLowerCase()
    const candidates = entries.flatMap((entry) => {
      if (entry.name === '.git' || (!input.hidden && entry.name.startsWith('.'))) return []
      const rank = folderRank(entry.name, query)
      return rank ? [{ entry, rank }] : []
    })
    const folders = []
    for (const { entry, rank } of candidates) {
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
          rank,
          name: entry.name,
          path: join(path, entry.name),
        })
    }
    folders.sort(
      (a, b) =>
        a.rank[0]! - b.rank[0]! ||
        (a.rank[1] ?? 0) - (b.rank[1] ?? 0) ||
        (a.rank[2] ?? 0) - (b.rank[2] ?? 0) ||
        folderNames.compare(a.name, b.name) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
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
      entries: folders
        .slice(input.offset, input.offset + pageSize)
        .map(({ name, path }) => ({ name, path })),
      nextOffset: input.offset + pageSize < folders.length ? input.offset + pageSize : null,
    }
  } catch (error) {
    throw new HttpError(
      400,
      `Cannot browse this folder on the runtime host. Check the path and folder permissions. ${errorMessage(error)}`,
    )
  }
}
