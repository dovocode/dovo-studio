import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { decodeResult } from '@dovo/protocol'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'

const recordSchema = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
type RecordValue = Schema.Schema.Type<typeof recordSchema>

/** Pi speaks newline-delimited JSON rather than JSON-RPC. */
export class PiRpc {
  readonly child: ChildProcessWithoutNullStreams
  private pending = new Map<
    string,
    { resolve: (value: RecordValue) => void; reject: (error: Error) => void }
  >()
  private listeners = new Set<(event: RecordValue) => void>()
  private failureListeners = new Set<(error: Error) => void>()
  private decoder = new StringDecoder('utf8')
  private buffer = ''
  private stderr = ''
  private failed?: Error
  private closing?: Promise<void>

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(command, [...args, '--mode', 'rpc'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(this.decoder.write(chunk)))
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000)
    })
    this.child.on('error', (error) => this.fail(error))
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('exit', (code) =>
      this.fail(new Error(`Pi exited (${code}). ${this.stderr.trim()}`.trim())),
    )
  }

  private fail(error: Error) {
    if (this.failed) return
    this.failed = error
    for (const item of this.pending.values()) item.reject(error)
    this.pending.clear()
    for (const listener of this.failureListeners) listener(error)
  }

  private consume(text: string) {
    this.buffer += text
    if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024)
      return this.fail(new Error('Pi RPC record exceeds 32 MiB'))
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        this.fail(new Error('Pi sent invalid RPC JSON'))
        return
      }
      const row = decodeResult(recordSchema, value).data
      if (!row) {
        this.fail(new Error('Pi sent an invalid RPC record'))
        return
      }
      if (row.type === 'response' && typeof row.id === 'string') {
        const request = this.pending.get(row.id)
        if (!request) continue
        this.pending.delete(row.id)
        if (row.success === true) request.resolve(row)
        else
          request.reject(
            new Error(typeof row.error === 'string' ? row.error : 'Pi RPC command failed'),
          )
      } else for (const listener of this.listeners) listener(row)
    }
  }

  onEvent(listener: (event: RecordValue) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onFailure(listener: (error: Error) => void) {
    if (this.failed) listener(this.failed)
    else this.failureListeners.add(listener)
    return () => this.failureListeners.delete(listener)
  }

  request(command: RecordValue, signal: AbortSignal, timeout = 30000): Promise<RecordValue> {
    if (this.failed) return Promise.reject(this.failed)
    if (signal.aborted) return Promise.reject(signal.reason)
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
      }
      const abort = () => {
        finish()
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        finish()
        reject(new Error('Pi RPC command timed out'))
      }, timeout)
      this.pending.set(id, {
        resolve: (value) => {
          finish()
          resolve(value)
        },
        reject: (error) => {
          finish()
          reject(error)
        },
      })
      signal.addEventListener('abort', abort, { once: true })
      this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }

  close() {
    return (this.closing ??= (async () => {
      this.fail(new Error('Pi RPC connection closed'))
      await stopOwnedChild(this.child)
    })())
  }
}
