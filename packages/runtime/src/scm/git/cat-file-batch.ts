import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { HttpError } from '../../errors.js'
import { processEnvironment } from '../../process.js'

/** One operation owns the process and its immutable, bounded text cache. */
export class GitBlobReader {
  private child?: ChildProcessWithoutNullStreams
  private output?: AsyncIterator<Buffer>
  private ended?: Promise<void>
  private buffered: Buffer = Buffer.alloc(0)
  private failure?: Error
  private timer?: NodeJS.Timeout
  private readonly texts = new Map<string, string>()
  private cachedBytes = 0
  private readonly abort = () => {
    this.failure = new Error('Git blob read aborted', { cause: this.signal?.reason })
    this.child?.kill('SIGKILL')
  }

  constructor(
    private readonly executable: string,
    private readonly cwd: string,
    private readonly signal?: AbortSignal,
    private readonly onStart?: () => void,
  ) {}

  async text(hash: string, size: number): Promise<string> {
    this.signal?.throwIfAborted()
    const cached = this.texts.get(hash)
    if (cached !== undefined) return cached
    if (
      !/^[a-f0-9]{40,64}$/i.test(hash) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 256 * 1024
    )
      throw new Error('Invalid bounded Git blob request')
    this.start()
    const child = this.child!
    child.stdin.write(`${hash}\n`)
    const header = await this.header()
    const [actualHash, type, length] = header.split(' ')
    if (actualHash !== hash || type !== 'blob' || Number(length) !== size)
      throw new Error(`Unexpected Git blob header: ${header}`)
    const content = await this.bytes(size)
    if ((await this.bytes(1))[0] !== 10) throw new Error('Invalid Git blob delimiter')
    const text = content.toString('utf8')
    // Binary bodies are only classified by these callers; never retain their full contents.
    const value = text.includes('\0') || text.includes('\ufffd') ? '\0' : text
    const bytes = Buffer.byteLength(value)
    if (this.texts.size < 400 && this.cachedBytes + bytes <= 1024 * 1024) {
      this.cachedBytes += bytes
      this.texts.set(hash, value)
    }
    return value
  }

  private start() {
    if (this.child) return
    this.onStart?.()
    const child = spawn(this.executable, ['cat-file', '--batch'], {
      windowsHide: true,
      cwd: this.cwd,
      env: processEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.output = child.stdout[Symbol.asyncIterator]()
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(0, 4000)
    })
    child.stdin.on('error', (error: Error) => {
      this.failure ??= error
    })
    this.ended = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        this.failure ??= error
      })
      child.once('close', (code) => {
        if (code !== 0) this.failure ??= new Error(stderr || `Git blob reader exited (${code})`)
        resolve()
      })
    })
    this.timer = setTimeout(() => {
      this.failure = new HttpError(504, 'Git blob reads timed out.')
      child.kill('SIGKILL')
    }, 120000)
    this.signal?.addEventListener('abort', this.abort, { once: true })
    if (this.signal?.aborted) this.abort()
  }

  private async more() {
    if (this.failure) throw this.failure
    const chunk = await this.output!.next()
    if (chunk.done) {
      await this.ended
      throw this.failure ?? new Error('Git blob reader closed before returning the blob')
    }
    if (this.failure) throw this.failure
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk.value]) : chunk.value
  }

  private async header() {
    let end = this.buffered.indexOf(10)
    while (end < 0) {
      if (this.buffered.length > 256) throw new Error('Invalid Git blob header')
      await this.more()
      end = this.buffered.indexOf(10)
    }
    if (end > 256) throw new Error('Invalid Git blob header')
    const header = this.buffered.subarray(0, end).toString('ascii')
    this.buffered = this.buffered.subarray(end + 1)
    return header
  }

  private async bytes(size: number) {
    while (this.buffered.length < size) await this.more()
    const result = this.buffered.subarray(0, size)
    this.buffered = this.buffered.subarray(size)
    return result
  }

  async close() {
    clearTimeout(this.timer)
    this.signal?.removeEventListener('abort', this.abort)
    if (this.child) {
      this.child.stdin.end()
      this.child.kill('SIGKILL')
      await this.ended
    }
    this.buffered = Buffer.alloc(0)
    this.texts.clear()
  }
}
