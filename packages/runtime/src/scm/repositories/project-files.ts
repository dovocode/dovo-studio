import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { rankPaths } from '@dovo/protocol'
import type { GitService } from '../git/git.js'

const TTL = 30_000
const MAX_FILES = 200_000

/** Tracked and untracked (not ignored) files of a checkout, cached briefly per folder, for
 * @-mention suggestions in the composer. */
export class ProjectFiles {
  private cache = new Map<string, { files: Promise<string[]>; expires: number }>()
  constructor(private git: GitService) {}
  private async folderFiles(cwd: string) {
    const files: string[] = []
    const pending = ['']
    while (pending.length && files.length < MAX_FILES) {
      const directory = pending.pop()!
      for (const entry of await readdir(join(cwd, directory), { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (path.split('/').length < 50 && pending.length < MAX_FILES) pending.push(path)
        } else if (entry.isFile()) files.push(path)
        if (files.length >= MAX_FILES) break
      }
    }
    return files.sort()
  }
  private list(cwd: string, plain = false) {
    const now = Date.now()
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key)
    const key = `${plain ? 'folder' : 'git'}:${cwd}`
    const cached = this.cache.get(key)
    if (cached) return cached.files
    const files = plain
      ? this.folderFiles(cwd)
      : this.git
          .command(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
          .then((output) => [...new Set(output.split('\0').filter(Boolean))].slice(0, MAX_FILES))
    this.cache.set(key, { files, expires: now + TTL })
    files.catch(() => {
      if (this.cache.get(key)?.files === files) this.cache.delete(key)
    })
    return files
  }
  async search(cwd: string, query: string, limit = 8, plain = false) {
    return rankPaths(await this.list(cwd, plain), query, limit)
  }
  async all(cwd: string, plain = false) {
    return this.list(cwd, plain)
  }
}
