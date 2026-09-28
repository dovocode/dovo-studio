import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createPatch } from 'diff'
import { HttpError } from '../../errors.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { safeFile } from './paths.js'

type Name = 'AGENTS.md' | 'CLAUDE.md'
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

export class ProjectInstructions {
  constructor(private store: WorkspaceStore) {}
  private async file(repositoryId: string, name: Name) {
    const repository = this.store.get().repositories.find((item) => item.id === repositoryId)
    if (!repository) throw new HttpError(404, 'Project not found')
    const path = await safeFile(repository.path, name)
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new HttpError(400, 'Instruction file is a symlink')
    } catch (error) {
      if (error instanceof HttpError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return path
  }
  async read(repositoryId: string, name: Name) {
    const path = await this.file(repositoryId, name)
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (text.length > 200_000)
      throw new HttpError(413, 'Instruction file is too large to edit here')
    return { text, version: digest(text) }
  }
  async preview(repositoryId: string, name: Name, text: string, version: string) {
    if (text.length > 200_000) throw new HttpError(413, 'Instruction text is too large')
    const current = await this.read(repositoryId, name)
    if (current.version !== version)
      throw new HttpError(409, 'Instructions changed on disk. Reload before saving.')
    return { diff: createPatch(name, current.text, text), changed: current.text !== text }
  }
  async save(repositoryId: string, name: Name, text: string, version: string) {
    const preview = await this.preview(repositoryId, name, text, version)
    if (!preview.changed) return { version }
    const path = await this.file(repositoryId, name)
    const temp = join(dirname(path), `.dovo-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, text, { flag: 'wx', mode: 0o644 })
      // Recheck immediately before replacement; another editor may have changed the file.
      if ((await this.read(repositoryId, name)).version !== version)
        throw new HttpError(409, 'Instructions changed on disk. Reload before saving.')
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
    return { version: digest(text) }
  }
}
