import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  decode,
  decodeResult,
  workspaceRouteRequestSchema,
  workspaceRouteSchema,
} from '@dovo/protocol'

export type WorkspaceRoute = typeof workspaceRouteSchema.Type
export function openWorkspaceRouterWorker() {
  const compiled = new URL('./workspace-router-worker.js', import.meta.url)
  const entry = existsSync(compiled)
    ? compiled
    : new URL('./workspace-router-worker.ts', import.meta.url)
  return new Worker(entry, {
    execArgv: entry.pathname.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [],
    workerData: {
      directory: fileURLToPath(new URL('../../../dist/models/workspace-router/', import.meta.url)),
    },
  })
}

/** One lazy CPU model per owning runtime. No provider, credentials, tools or inference downloads. */
export class WorkspaceRouter {
  private worker?: Worker
  private sequence = 0
  private stopped = false
  private closing = new Set<Promise<number>>()
  private idle?: ReturnType<typeof setTimeout>
  private pending = new Map<
    number,
    {
      resolve: (result: WorkspaceRoute) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(private openWorker = openWorkspaceRouterWorker) {}

  route(text: string): Promise<WorkspaceRoute> {
    const input = decode(workspaceRouteRequestSchema, { text }).text
    if (this.stopped) return Promise.resolve(this.fallback('Local router is shutting down.'))
    // Reject rather than truncate input into a different decision. This is a resource limit,
    // not a URL/command heuristic; all supported inputs are classified by Julia itself.
    if (input.length > 2000)
      return Promise.resolve(this.fallback('Input exceeds the local router limit.'))
    if (this.pending.size >= 4) return Promise.resolve(this.fallback('Local router is busy.'))
    clearTimeout(this.idle)
    try {
      if (!this.worker) {
        const worker = this.openWorker()
        this.worker = worker
        worker.on('message', (value: unknown) => {
          if (
            this.worker !== worker ||
            !value ||
            typeof value !== 'object' ||
            !('id' in value) ||
            typeof value.id !== 'number'
          )
            return
          const pending = this.pending.get(value.id)
          if (!pending) return
          const result = decodeResult(workspaceRouteSchema, {
            mode: 'mode' in value ? value.mode : undefined,
            reason: 'reason' in value ? value.reason : undefined,
          })
          if (!result.success) {
            this.fail(worker, 'Local model could not classify this input.')
            return
          }
          clearTimeout(pending.timer)
          this.pending.delete(value.id)
          pending.resolve(result.data)
          if (!this.pending.size) {
            this.idle = setTimeout(() => this.release(worker), 60_000)
            this.idle.unref()
          }
        })
        worker.once('error', (error) => {
          console.error('Local workspace router failed', error)
          this.fail(worker, 'Local model is unavailable.')
        })
        worker.once('exit', () => this.fail(worker, 'Local model stopped.'))
        worker.unref()
      }
      const worker = this.worker
      const id = ++this.sequence
      return new Promise<WorkspaceRoute>((resolve) => {
        const timer = setTimeout(() => this.fail(worker, 'Local routing timed out.'), 25_000)
        this.pending.set(id, { resolve, timer })
        try {
          worker.postMessage({ id, text: input })
        } catch (error) {
          console.error('Could not send input to local workspace router', error)
          this.fail(worker, 'Local model is unavailable.')
        }
      })
    } catch (error) {
      console.error('Could not start local workspace router', error)
      return Promise.resolve(this.fallback('Local model is unavailable.'))
    }
  }
  private fallback(message: string): WorkspaceRoute {
    return {
      mode: 'thread',
      reason: `${message} Thread is selected for review; you can override it.`,
    }
  }
  private fail(worker: Worker, message: string) {
    if (this.worker !== worker) return
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve(this.fallback(message))
    }
    this.pending.clear()
    this.release(worker)
  }
  private release(worker: Worker) {
    if (this.worker !== worker) return
    this.worker = undefined
    clearTimeout(this.idle)
    const closing = worker.terminate()
    this.closing.add(closing)
    void closing.then(
      () => this.closing.delete(closing),
      (error: unknown) => {
        this.closing.delete(closing)
        console.error('Could not stop local workspace router', error)
      },
    )
  }
  async dispose() {
    this.stopped = true
    if (this.worker) this.fail(this.worker, 'Local router is shutting down.')
    await Promise.allSettled(this.closing)
  }
}
