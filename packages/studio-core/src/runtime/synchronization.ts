import { z } from 'zod'
import {
  patchSchema,
  workspaceSchema,
  type RuntimeConnection,
  type Workspace,
  type WorkspacePatch,
} from '@dovo/protocol'
import { runtimeRequest } from './client'
type Checkpoint = { generation: number; version: number; idle: boolean }
type Send = (connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>
export const workspaceOutboxSchema = z.object({
  version: z.literal(1),
  workspace: workspaceSchema,
  patches: z.array(patchSchema).min(1),
})
export type WorkspaceOutbox = z.infer<typeof workspaceOutboxSchema>
type Persist = (connection: RuntimeConnection, value: WorkspaceOutbox | null) => Promise<void>
const sendPatch: Send = (connection, patch) =>
  runtimeRequest(
    connection,
    connection.address,
    '/api/workspace',
    patch,
    z.object({ revision: z.number() }),
    'PATCH',
  )
export class WorkspaceSynchronization {
  private connection: RuntimeConnection | null = null
  private generation = 0
  private version = 0
  private pending: WorkspacePatch[] = []
  private draining: Promise<void> | null = null
  private conflicted = false
  private workspace: Workspace | null = null
  private durable = Promise.resolve()
  private saves = Promise.resolve()
  constructor(
    private onError: (message: string | null) => void,
    private send: Send = sendPatch,
    private persist?: Persist,
  ) {}
  bind(connection: RuntimeConnection | null, restored: WorkspaceOutbox | null = null) {
    this.generation++
    this.connection = connection
    this.pending = restored ? [...restored.patches] : []
    this.workspace = restored?.workspace ?? null
    this.durable = Promise.resolve()
    this.draining = null
    this.conflicted = this.pending.length > 0
    if (this.conflicted)
      this.onError(
        'Saved edits are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.',
      )
  }
  private save(connection: RuntimeConnection, patches: WorkspacePatch[]) {
    if (!this.persist) return Promise.resolve()
    if (patches.length && !this.workspace)
      throw new Error('Cannot save pending changes without their workspace.')
    const value: WorkspaceOutbox | null =
      patches.length && this.workspace
        ? { version: 1, workspace: this.workspace, patches: [...patches] }
        : null
    const persist = this.persist
    const result = this.saves.then(() => persist(connection, value))
    this.saves = result.catch(() => undefined)
    this.durable = result
    return result
  }
  enqueue(patches: WorkspacePatch[], workspace?: Workspace) {
    if (!patches.length) return
    this.version++
    if (workspace) this.workspace = workspace
    if (this.connection) {
      this.pending.push(...patches)
      const generation = this.generation
      void this.save(this.connection, this.pending).catch((error) => {
        if (generation === this.generation) {
          this.conflicted = true
          this.onError(
            `Could not save pending changes. Keep this window open. ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      })
    }
  }
  checkpoint(): Checkpoint {
    return {
      generation: this.generation,
      version: this.version,
      idle: !this.pending.length && !this.draining && !this.conflicted,
    }
  }
  isCurrent(checkpoint: Checkpoint) {
    return checkpoint.generation === this.generation
  }
  accepts(checkpoint: Checkpoint) {
    return (
      this.isCurrent(checkpoint) &&
      checkpoint.version === this.version &&
      checkpoint.idle &&
      this.checkpoint().idle
    )
  }
  clearNetworkError() {
    if (!this.conflicted) this.onError(null)
  }
  isSending() {
    return this.draining !== null
  }
  hasPending() {
    return this.pending.length > 0
  }
  async retry(): Promise<void> {
    if (this.draining) return this.draining
    this.version++
    this.conflicted = false
    const generation = this.generation
    try {
      if (this.connection) await this.save(this.connection, this.pending)
      if (generation !== this.generation)
        throw new Error('Runtime connection changed while saving pending edits.')
      await this.flush()
    } catch (error) {
      if (generation === this.generation) {
        this.conflicted = true
        this.onError(error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }
  async discard(checkpoint: Checkpoint) {
    if (
      !this.connection ||
      this.isSending() ||
      !this.isCurrent(checkpoint) ||
      this.version !== checkpoint.version
    )
      throw new Error('Changes are still in progress. Wait before reloading.')
    await this.save(this.connection, [])
    if (!this.isCurrent(checkpoint) || this.version !== checkpoint.version || this.isSending())
      throw new Error(
        'The workspace changed while clearing saved edits. Review the current changes.',
      )
    this.pending = []
    this.workspace = null
    this.conflicted = false
    this.version++
  }
  async flush(): Promise<void> {
    if (this.draining) return this.draining
    const target = this.connection
    if (!target) return
    if (this.conflicted)
      throw new Error(
        'Changes are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.',
      )
    const generation = this.generation,
      pending = this.pending
    const work = (async () => {
      try {
        while (pending.length && generation === this.generation) {
          await this.durable
          if (generation !== this.generation) return
          await this.send(target, pending[0])
          if (generation !== this.generation) return
          // Keep an acknowledged patch until the new durable queue has committed. Retrying
          // an uncertain acknowledgement is safe because workspace patches are idempotent.
          await this.save(target, pending.slice(1))
          pending.shift()
        }
        if (generation === this.generation) this.onError(null)
      } catch (error) {
        if (generation === this.generation) {
          this.conflicted = true
          this.onError(error instanceof Error ? error.message : String(error))
        }
        throw error
      }
    })()
    this.draining = work
    try {
      await work
    } finally {
      if (this.draining === work) this.draining = null
    }
  }
}
