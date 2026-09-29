import { rankPaths } from '@dovo/protocol'
import type { GitService } from '../git/git.js'

const TTL = 30_000
const MAX_FILES = 200_000

/** Tracked and untracked (not ignored) files of a checkout, cached briefly per folder, for
 * @-mention suggestions in the composer. */
export class ProjectFiles {
  private cache = new Map<string, { files: Promise<string[]>; expires: number }>()
  constructor(private git: GitService) {}
  private list(cwd: string) {
    const now = Date.now()
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key)
    const cached = this.cache.get(cwd)
    if (cached) return cached.files
    const files = this.git
      .command(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .then((output) => [...new Set(output.split('\0').filter(Boolean))].slice(0, MAX_FILES))
    this.cache.set(cwd, { files, expires: now + TTL })
    files.catch(() => {
      if (this.cache.get(cwd)?.files === files) this.cache.delete(cwd)
    })
    return files
  }
  async search(cwd: string, query: string, limit = 8) {
    return rankPaths(await this.list(cwd), query, limit)
  }
  async all(cwd: string) {
    return this.list(cwd)
  }
}
