import { SCRATCH_PROJECT_ID, type Repository } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { mkdir, realpath, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from '../git/git.js'
import { HttpError, errorMessage } from '../../errors.js'

/** A managed, non-Git project with an isolated persistent folder for every thread. */
export class ScratchWorkspaces {
  private pending?: Promise<Repository | undefined>
  constructor(
    readonly root: string,
    private store: WorkspaceStore,
    private git: GitService,
  ) {}
  available() {
    return (this.pending ??= this.inspect().catch((error: unknown) => {
      this.pending = undefined
      console.error('Scratch threads are unavailable:', errorMessage(error))
      return undefined
    }))
  }
  private async inspect(): Promise<Repository | undefined> {
    await mkdir(this.root, { recursive: true })
    const path = await realpath(this.root)
    // A scratch directory nested in a checkout would inherit that checkout's instructions
    // and Git state. Do not offer projectless threads in that configuration.
    if (await this.git.isRepository(path)) return undefined
    return { id: SCRATCH_PROJECT_ID, name: 'No project', path, branch: '', kind: 'scratch' }
  }
  async ensure() {
    const repository = await this.available()
    if (!repository) throw new HttpError(409, 'The scratch folder is inside a Git repository')
    const existing = this.store.get().repositories.find((item) => item.id === SCRATCH_PROJECT_ID)
    if (existing && (existing.kind !== 'scratch' || existing.path !== repository.path))
      throw new HttpError(409, 'The managed scratch workspace has an unexpected location')
    if (!existing)
      this.store.update((workspace) => ({
        ...workspace,
        repositories: [...workspace.repositories, repository],
      }))
    return repository
  }
  async directory(id: string) {
    const repository = await this.ensure()
    const path = join(repository.path, createHash('sha256').update(id).digest('hex'))
    await mkdir(path, { recursive: true })
    if ((await lstat(path)).isSymbolicLink() || dirname(await realpath(path)) !== repository.path)
      throw new HttpError(409, 'The scratch thread folder must stay inside its managed workspace')
    if (await this.git.isRepository(path))
      throw new HttpError(409, 'The scratch thread folder has become a Git repository')
    return path
  }
}
