import { createHash, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  decode,
  secureInputPublicKey,
  openSecureInput,
  maxValue,
  minValue,
  mutableStruct,
  type PendingSecureInput,
  type SecureInputRequest,
  type SecureInputReply,
  type SecureInputStatus,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../errors.js'

const payload = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  value: maxValue(minValue(Schema.String, 1), 8192),
})
type Entry = {
  info: PendingSecureInput
  request: SecureInputRequest
  runId: string
  secret: Uint8Array
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
  consume: (value: string, signal: AbortSignal) => Promise<void>
  fingerprint?: string
  deviceId?: string
  reported?: boolean
}
const requestId = (taskId: string, runId: string, key: string) =>
  'secure-input:' +
  createHash('sha256')
    .update(JSON.stringify([taskId, runId, key]))
    .digest('hex')

/** Values exist only during decryption/delivery. No store, terminal, question or provider path. */
export class SecureInputs {
  private entries = new Map<string, Entry>()
  private work = new Set<Promise<void>>()
  private closed = false
  constructor(
    private changed: () => void,
    private result: (taskId: string, runId: string, id: string, status: SecureInputStatus) => void,
  ) {}
  private publish() {
    try {
      this.changed()
    } catch {
      console.error('Secure input state notification could not be recorded.')
    }
  }
  replay(taskId: string, runId: string, request: SecureInputRequest) {
    const id = requestId(taskId, runId, request.key)
    const previous = this.entries.get(id)
    if (!previous) return undefined
    if (!isDeepStrictEqual(previous.request, request))
      throw new HttpError(409, 'This secure input key is already in use. Use a new key.')
    return this.status(taskId, id)
  }
  request(
    taskId: string,
    runId: string,
    request: SecureInputRequest,
    directory: string,
    signal: AbortSignal,
    consume: Entry['consume'],
  ) {
    if (this.closed || signal.aborted) throw new HttpError(409, 'This agent turn has stopped.')
    const id = requestId(taskId, runId, request.key)
    const previous = this.entries.get(id)
    if (previous) {
      if (!isDeepStrictEqual(previous.request, request) || previous.info.directory !== directory)
        throw new HttpError(409, 'This secure input key is already in use. Use a new key.')
      return this.status(taskId, id)
    }
    if (this.entries.size >= 128) {
      const finished = [...this.entries].find(
        ([, entry]) => !['pending', 'running'].includes(entry.info.status),
      )
      if (finished) this.entries.delete(finished[0])
      else throw new HttpError(409, 'Too many pending secure inputs. Cancel an existing request.')
    }
    const secret = randomBytes(32)
    const controller = new AbortController()
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const abort = () => this.finish(entry, 'cancelled', false)
    const entry: Entry = {
      request,
      runId,
      secret,
      controller,
      consume,
      info: {
        id,
        taskId,
        title: request.title,
        prompt: request.prompt,
        destination: request.destination,
        directory,
        publicKey: secureInputPublicKey(secret),
        expiresAt,
        status: 'pending',
      },
      timer: setTimeout(() => this.finish(entry, 'expired'), 10 * 60_000),
      cleanup: () => signal.removeEventListener('abort', abort),
    }
    entry.timer.unref()
    this.entries.set(id, entry)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    this.publish()
    return this.status(taskId, id)
  }
  list() {
    return [...this.entries.values()]
      .filter((entry) => ['pending', 'running'].includes(entry.info.status))
      .map((entry) => entry.info)
  }
  status(taskId: string, id: string) {
    const entry = this.get(id)
    if (entry.info.taskId !== taskId)
      throw new HttpError(403, 'This secure input belongs to another thread.')
    if (!['pending', 'running'].includes(entry.info.status)) this.report(entry)
    return { id, status: entry.info.status }
  }
  cancel(taskId: string, id: string) {
    this.status(taskId, id)
    this.finish(this.get(id), 'cancelled')
    return this.status(taskId, id)
  }
  cancelTask(taskId: string) {
    // Stop must also dismiss requests from an earlier turn without resuming the task.
    for (const entry of this.entries.values())
      if (entry.info.taskId === taskId) this.finish(entry, 'cancelled', false)
  }
  private get(id: string) {
    const entry = this.entries.get(id)
    if (!entry)
      throw new HttpError(409, 'This secure input is no longer available. Request a new one.')
    return entry
  }
  private report(entry: Entry) {
    if (entry.reported) return
    this.result(entry.info.taskId, entry.runId, entry.info.id, entry.info.status)
    entry.reported = true
  }
  private finish(entry: Entry, status: SecureInputStatus, notify = true) {
    if (!['pending', 'running'].includes(entry.info.status)) return
    entry.info = { ...entry.info, status }
    entry.secret.fill(0)
    clearTimeout(entry.timer)
    entry.cleanup()
    entry.controller.abort()
    this.publish()
    // Notification failure must never throw from an abort listener or leak consumer errors.
    if (notify) {
      try {
        this.report(entry)
      } catch {
        console.error('Secure input status delivery was not confirmed. Check this request again.')
      }
    } else entry.reported = true
  }
  async submit(input: SecureInputReply, deviceId: string) {
    const entry = this.get(input.id)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([input.sender, input.box]))
      .digest('hex')
    if (entry.fingerprint) {
      if (entry.fingerprint !== fingerprint || entry.deviceId !== deviceId)
        throw new HttpError(409, 'This secure input has already been submitted.')
      if (!['pending', 'running'].includes(entry.info.status)) this.report(entry)
      return this.status(entry.info.taskId, input.id)
    }
    if (entry.info.status !== 'pending') return this.status(entry.info.taskId, input.id)
    if (Date.now() >= Date.parse(entry.info.expiresAt)) {
      this.finish(entry, 'expired')
      return this.status(entry.info.taskId, input.id)
    }
    let value: string
    try {
      const decrypted = decode(payload, openSecureInput(input, entry.secret))
      if (
        decrypted.id !== input.id ||
        decrypted.taskId !== entry.info.taskId ||
        Buffer.byteLength(decrypted.value, 'utf8') > 8192
      )
        throw new Error('Invalid payload')
      value = decrypted.value
    } catch {
      // Decoder and consumer errors can contain the value. Use a fixed public error.
      throw new HttpError(400, 'Secure input could not be authenticated. Enter it again.')
    }
    entry.fingerprint = fingerprint
    entry.deviceId = deviceId
    entry.secret.fill(0)
    entry.info = { ...entry.info, status: 'running' }
    this.publish()
    const signal = AbortSignal.any([entry.controller.signal, AbortSignal.timeout(60_000)])
    const consuming = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return entry.consume(value, signal)
    })
    this.work.add(consuming)
    try {
      await consuming
      this.finish(entry, 'completed')
    } catch {
      this.finish(entry, 'failed')
    } finally {
      value = ''
      this.work.delete(consuming)
    }
    this.report(entry)
    return this.status(entry.info.taskId, input.id)
  }
  async close() {
    this.closed = true
    for (const entry of this.entries.values()) this.finish(entry, 'cancelled', false)
    await Promise.allSettled([...this.work])
    this.entries.clear()
  }
}
