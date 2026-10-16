import { randomUUID } from 'node:crypto'
import type { StudioUICommand, studioUIPollSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Services } from '../services.js'

type Poll = typeof studioUIPollSchema.Type
type Job = { id: string; command: StudioUICommand }
type Pending = {
  job: Job
  authorize: () => void
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
type Session = {
  deviceId: string
  label: string
  seen: number
  pending?: Pending
  deliver?: (job: Job | null) => void
}
const instances = new WeakMap<Services, StudioSessions>()
export function studioSessions(s: Services) {
  let instance = instances.get(s)
  if (!instance)
    instances.set(s, (instance = new StudioSessions(() => s.preferences.get().enableStudioUI)))
  return instance
}
/** Commands target an explicitly selected paired client, never an arbitrary JavaScript evaluator. */
export class StudioSessions {
  private sessions = new Map<string, Session>()
  constructor(private enabled: () => boolean) {}
  list() {
    for (const [id, session] of this.sessions)
      if (Date.now() - session.seen > 45000) {
        session.deliver?.(null)
        session.pending?.reject(new HttpError(410, 'Studio session disconnected'))
        clearTimeout(session.pending?.timer)
        this.sessions.delete(id)
      }
    return [...this.sessions].map(([id, session]) => ({
      id,
      label: session.label,
      lastSeen: new Date(session.seen).toISOString(),
    }))
  }
  async poll(deviceId: string, input: Poll, authorize: () => void) {
    authorize()
    if (!this.enabled()) throw new HttpError(403, 'Studio Tools: UI interaction is disabled')
    this.list()
    let session = this.sessions.get(input.sessionId)
    if (!session) {
      if (this.sessions.size >= 32) throw new HttpError(429, 'Too many Studio sessions')
      session = { deviceId, label: input.label, seen: Date.now() }
      this.sessions.set(input.sessionId, session)
    }
    if (session.deviceId !== deviceId)
      throw new HttpError(403, 'This Studio session belongs to another device')
    session.seen = Date.now()
    session.label = input.label
    if (input.result && session.pending?.job.id === input.result.id) {
      const pending = session.pending
      session.pending = undefined
      clearTimeout(pending.timer)
      try {
        pending.authorize()
        pending.resolve(input.result.value)
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (session.deliver) throw new HttpError(409, 'Studio session already has a pending poll')
    const current = session
    const job = await new Promise<Job | null>((resolve) => {
      const finish = (job: Job | null) => {
        clearTimeout(timer)
        current.deliver = undefined
        resolve(job)
      }
      const timer = setTimeout(() => finish(null), 15000)
      timer.unref()
      current.deliver = finish
      if (current.pending) {
        try {
          current.pending.authorize()
          finish(current.pending.job)
        } catch (error) {
          clearTimeout(current.pending.timer)
          current.pending.reject(error instanceof Error ? error : new Error(String(error)))
          current.pending = undefined
          finish(null)
        }
      }
    })
    authorize()
    if (!this.enabled()) throw new HttpError(403, 'Studio Tools: UI interaction is disabled')
    return { job }
  }
  command(id: string, command: StudioUICommand, authorize: () => void): Promise<unknown> {
    authorize()
    if (!this.enabled()) throw new HttpError(403, 'Studio Tools: UI interaction is disabled')
    this.list()
    const session = this.sessions.get(id)
    if (!session)
      throw new HttpError(
        404,
        'Studio session unavailable. Open Studio on this runtime and list sessions again.',
      )
    if (session.pending) throw new HttpError(409, 'Studio session is busy')
    return new Promise((resolve, reject) => {
      const job = { id: randomUUID(), command }
      const timer = setTimeout(() => {
        session.pending = undefined
        reject(
          new HttpError(
            504,
            'Studio command timed out. Its outcome may be unknown; inspect before repeating.',
          ),
        )
      }, 20000)
      timer.unref()
      session.pending = { job, authorize, resolve, reject, timer }
      session.deliver?.(job)
    })
  }
}
