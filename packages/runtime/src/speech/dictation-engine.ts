import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { dictationModel, type DictationStatus, type DictationLanguage } from '@dovo/protocol'

export const maxDictationSamples = 16000 * 300
async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
export function validateDictationPcm(pcm: unknown): asserts pcm is ArrayBuffer {
  if (
    !(pcm instanceof ArrayBuffer) ||
    !pcm.byteLength ||
    pcm.byteLength % 2 ||
    pcm.byteLength > maxDictationSamples * 2
  )
    throw new Error('Invalid dictation audio. Expected up to 5 minutes of 16 kHz mono PCM.')
}
export type DictationSession = {
  feed: (pcm: ArrayBuffer) => Promise<void>
  finish: () => Promise<string>
  done: Promise<void>
}

/** One streaming process per recording; audio stays in memory and the model is released afterward. */
export class DictationEngine {
  private downloaded = 0
  private downloading = false
  private verified = false
  readonly modelPath: string
  constructor(
    readonly binary: string,
    readonly directory: string,
  ) {
    this.modelPath = join(directory, dictationModel.filename)
  }
  async status(): Promise<DictationStatus> {
    const model = await exists(this.modelPath)
    return {
      engine: await exists(this.binary),
      model: model && (await stat(this.modelPath)).size === dictationModel.bytes,
      downloading: this.downloading,
      downloaded: this.downloaded,
    }
  }
  async install(signal: AbortSignal) {
    if (this.downloading) throw new Error('A dictation model download is already running.')
    if (!(await exists(this.binary)))
      throw new Error(
        'The local dictation engine is missing. Development builds need pnpm prepare:dictation.',
      )
    this.downloading = true
    this.downloaded = 0
    const partial = `${this.modelPath}.part`
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const response = await fetch(dictationModel.url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
      })
      if (!response.ok || !response.body)
        throw new Error(`Model download failed (${response.status}).`)
      const file = await open(partial, 'w', 0o600)
      const hash = createHash('sha256')
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted()
          this.downloaded += chunk.byteLength
          if (this.downloaded > dictationModel.bytes)
            throw new Error('The model download exceeded its expected size.')
          hash.update(chunk)
          await file.writeFile(chunk)
        }
      } finally {
        await file.close()
      }
      if (this.downloaded !== dictationModel.bytes || hash.digest('hex') !== dictationModel.sha256)
        throw new Error('The downloaded model failed its integrity check. Please retry.')
      signal.throwIfAborted()
      await rename(partial, this.modelPath)
      this.verified = true
    } finally {
      this.downloading = false
      await rm(partial, { force: true })
    }
  }
  async start(
    language: DictationLanguage,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<DictationSession> {
    const status = await this.status()
    if (!status.engine || !status.model)
      throw new Error(
        'Download the dictation model in Settings → General → Speech before recording.',
      )
    if (!this.verified) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.modelPath, { signal })) hash.update(chunk)
      if (hash.digest('hex') !== dictationModel.sha256)
        throw new Error(
          'The dictation model is damaged. Download it again in Settings → General → Speech.',
        )
      this.verified = true
    }
    signal.throwIfAborted()
    const child = spawn(
      this.binary,
      [this.modelPath, language, String(Math.min(4, availableParallelism()))],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let text = '',
      diagnostics = '',
      pending = Buffer.alloc(0),
      total = 0
    let started = false,
      finishing = false
    let failure: Error | undefined
    const fail = (error: Error) => {
      failure ??= error
      child.kill('SIGKILL')
    }
    const abort = () => fail(new Error('Dictation was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    let readyResolve: () => void, readyReject: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    const startupTimer = setTimeout(
      () => fail(new Error('The speech model took too long to load.')),
      120_000,
    )
    let finishTimer: ReturnType<typeof setTimeout> | undefined
    const limitTimer = setTimeout(
      () => fail(new Error('Dictation exceeded its recording time limit.')),
      420_000,
    )
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString('utf8')).slice(-4000)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 4) {
        const length = pending.readUInt32LE(0)
        if (length > 100_000)
          return fail(new Error('The dictation transcript was unexpectedly large.'))
        if (pending.length < 4 + length) return
        const value = pending.subarray(4, 4 + length).toString('utf8')
        pending = pending.subarray(4 + length)
        if (!started) {
          if (length) return fail(new Error('Invalid dictation engine response.'))
          started = true
          clearTimeout(startupTimer)
          readyResolve()
        } else {
          text = value
          try {
            onText(text)
          } catch (cause) {
            return fail(cause instanceof Error ? cause : new Error(String(cause)))
          }
        }
      }
    })
    child.stdin.on('error', fail)
    child.stdout.on('error', fail)
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', (error) => {
        failure ??= error
      })
      child.on('close', (code) => {
        signal.removeEventListener('abort', abort)
        clearTimeout(startupTimer)
        clearTimeout(finishTimer)
        clearTimeout(limitTimer)
        if (!failure && (code !== 0 || !started || !finishing || pending.length))
          failure = new Error(
            `Local dictation failed${diagnostics ? ': ' + diagnostics.trim() : '.'}`,
          )
        if (failure) {
          readyReject(failure)
          reject(failure)
        } else resolve()
      })
    })
    // Feed/finish and the IPC owner observe failures; attach now while waiting for readiness.
    void done.catch(() => undefined)
    await ready
    signal.throwIfAborted()
    return {
      done,
      feed: async (pcm) => {
        validateDictationPcm(pcm)
        if (failure) throw failure
        if (finishing) throw new Error('Dictation is already finishing.')
        total += pcm.byteLength
        if (total > maxDictationSamples * 2) {
          const error = new Error('Dictation is limited to five minutes.')
          fail(error)
          throw error
        }
        await new Promise<void>((resolve, reject) => {
          child.stdin.write(Buffer.from(pcm), (error) => (error ? reject(error) : resolve()))
        })
      },
      finish: async () => {
        if (failure) throw failure
        if (finishing) throw new Error('Dictation is already finishing.')
        if (total < 320) {
          fail(new Error('No speech was recorded.'))
          await done
        }
        finishing = true
        finishTimer = setTimeout(
          () => fail(new Error('Dictation took too long to finish.')),
          120_000,
        )
        child.stdin.end()
        await done
        return text.trim()
      },
    }
  }
  async transcribe(pcm: ArrayBuffer, signal: AbortSignal, language: DictationLanguage = 'auto') {
    validateDictationPcm(pcm)
    const session = await this.start(language, signal, () => {})
    await session.feed(pcm)
    return session.finish()
  }
}
