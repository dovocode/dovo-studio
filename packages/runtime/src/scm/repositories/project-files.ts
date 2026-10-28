import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { rankPaths } from '@dovo/protocol'
import type { GitService } from '../git/git.js'

const TTL = 30_000
const MAX_FILES = 200_000
const MAX_PROBE_DIRECTORIES = 1_000
type FileListing = { files: string[]; truncated?: boolean }

/** Tracked and untracked (not ignored) files of a checkout, cached briefly per folder, for
 * @-mention suggestions in the composer. */
export class ProjectFiles {
  private cache = new Map<string, { files: Promise<FileListing>; expires: number }>()
  constructor(private git: GitService) {}
  private async folderFiles(cwd: string) {
    const files: string[] = []
    const pending = ['']
    let truncated = false
    let uncertain = false
    let probeRemaining = MAX_PROBE_DIRECTORIES
    const containsFile = async (root: string): Promise<boolean | undefined> => {
      if (!probeRemaining) return undefined
      const directories = [root]
      let incomplete = false
      while (directories.length) {
        const directory = directories.pop()!
        probeRemaining--
        for (const entry of await readdir(join(cwd, directory), { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue
          if (entry.isFile()) return true
          if (entry.isDirectory()) {
            if (directories.length < probeRemaining) directories.push(`${directory}/${entry.name}`)
            else incomplete = true
          }
        }
      }
      return incomplete ? undefined : false
    }
    while (pending.length) {
      const directory = pending.pop()!
      for (const entry of await readdir(join(cwd, directory), { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (path.split('/').length < 50 && pending.length < MAX_FILES) pending.push(path)
          else if (!truncated) {
            const found = await containsFile(path)
            if (found) truncated = true
            else if (found === undefined) uncertain = true
          }
        } else if (entry.isFile()) {
          if (files.length === MAX_FILES) return { files: files.sort(), truncated: true }
          files.push(path)
        }
      }
    }
    return {
      files: files.sort(),
      ...(truncated ? { truncated: true } : uncertain ? {} : { truncated: false }),
    }
  }
  private list(cwd: string, plain = false, fresh = false) {
    const now = Date.now()
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key)
    const key = `${plain ? 'folder' : 'git'}:${cwd}`
    const cached = this.cache.get(key)
    if (cached && !fresh) return cached.files
    const files = plain
      ? this.folderFiles(cwd)
      : this.git
          .command(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
          .then((output) => {
            const files = [...new Set(output.split('\0').filter(Boolean))]
            return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
          })
    this.cache.set(key, { files, expires: now + TTL })
    files.catch(() => {
      if (this.cache.get(key)?.files === files) this.cache.delete(key)
    })
    return files
  }
  async search(cwd: string, query: string, limit = 8, plain = false) {
    return rankPaths((await this.list(cwd, plain)).files, query, limit)
  }
  async all(cwd: string, plain = false, fresh = false) {
    return this.list(cwd, plain, fresh)
  }
}
