import type { Activity } from '../storage/activity.js'
import { randomUUID } from 'node:crypto'
import type { Approval } from '@dovo/protocol'
import { HttpError } from '../errors.js'
export class Approvals {
  constructor(private activity?: Pick<Activity, 'add'>) {}
  private requests = new Map<string, { info: Approval; resolve: (allow: boolean) => void }>()
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  request(taskId: string, title: string, detail: string, signal: AbortSignal) {
    if (signal.aborted) return Promise.resolve(false)
    const id = randomUUID()
    this.activity?.add('approval', taskId, title, { id, detail, status: 'requested' })
    return new Promise<boolean>((resolve) => {
      const finish = (allow: boolean) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.requests.delete(id)
        this.activity?.add('approval', taskId, title, { id, allow, status: 'resolved' })
        resolve(allow)
      }
      const abort = () => finish(false),
        timer = setTimeout(abort, 10 * 60 * 1000)
      this.requests.set(id, {
        info: { id, taskId, title, detail, createdAt: new Date().toISOString() },
        resolve: finish,
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  respond(id: string, allow: boolean) {
    const request = this.requests.get(id)
    if (!request) throw new HttpError(404, 'Approval expired')
    request.resolve(allow)
  }
  dispose() {
    for (const request of this.requests.values()) request.resolve(false)
  }
}
