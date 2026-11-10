import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DictationEngine, maxDictationSamples } from './dictation-engine.js'
import { HttpError } from '../errors.js'
import type { DictationLanguage } from '@dovo/protocol'

export function runtimeDictationBinary() {
  const name = process.platform === 'win32' ? 'dovo-dictation.exe' : 'dovo-dictation'
  const packaged = join(dirname(process.execPath), 'dictation', name)
  return (
    process.env.DOVO_DICTATION_BINARY ||
    (existsSync(packaged)
      ? packaged
      : resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../../..',
          'work/dictation',
          `${process.platform}-${process.arch}`,
          'bundle',
          name,
        ))
  )
}

/** Decode native recordings with the existing host FFmpeg integration. Audio never enters logs. */
export async function decodeDictationAudio(
  data: Buffer,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.DOVO_FFMPEG || 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-protocol_whitelist',
        'pipe',
        '-i',
        'pipe:0',
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        '16000',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    const chunks: Buffer[] = []
    let size = 0,
      failure: Error | undefined
    const stop = () => {
      failure = new Error('Dictation was cancelled.')
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.on('error', () => {
      failure = new Error(
        'Install FFmpeg on this computer to transcribe phone recordings, or set DOVO_FFMPEG.',
      )
      child.kill('SIGKILL')
    })
    child.stdin.on('error', () => {}) // Exit and close below report decoder failures.
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxDictationSamples * 2) {
        failure = new Error('Recording exceeds five minutes.')
        child.kill('SIGKILL')
      } else chunks.push(chunk)
    })
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop)
      if (failure) reject(failure)
      else if (code !== 0 || !size || size % 2)
        reject(new Error('The recording could not be decoded. Record again.'))
      else resolve(Uint8Array.from(Buffer.concat(chunks)).buffer)
    })
    child.stdin.end(data)
  })
}

export class RuntimeDictation {
  readonly engine: DictationEngine
  private cancelled = new Map<string, number>()
  private active?: {
    owner: string
    id: string
    controller: AbortController
    done: Promise<unknown>
  }
  constructor(
    directory: string,
    engine = new DictationEngine(runtimeDictationBinary(), join(directory, 'dictation')),
  ) {
    this.engine = engine
  }
  async run<T>(
    owner: string,
    id: string,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([owner, id])
    const now = Date.now()
    for (const [key, until] of this.cancelled) if (until < now) this.cancelled.delete(key)
    if (this.cancelled.has(key))
      throw new HttpError(409, 'Speech operation was cancelled. Start a new recording.')
    if (this.active)
      throw new HttpError(
        409,
        'This computer is busy with another speech operation. Try again after it finishes.',
      )
    const controller = new AbortController()
    const entry = { owner, id, controller, done: Promise.resolve<unknown>(undefined) }
    this.active = entry
    try {
      const combined = AbortSignal.any([signal, controller.signal])
      combined.throwIfAborted()
      const done = work(combined)
      entry.done = done
      return await done
    } finally {
      if (this.active === entry) this.active = undefined
    }
  }
  async transcribe(
    owner: string,
    input: { id: string; data: string; format: 'pcm' | 'encoded'; language: DictationLanguage },
    signal: AbortSignal,
  ) {
    return this.run(owner, input.id, signal, async (operation) => {
      const data = Buffer.from(input.data, 'base64')
      if (data.toString('base64') !== input.data) throw new HttpError(400, 'Invalid audio encoding')
      if (data.length > maxDictationSamples * 2) throw new HttpError(413, 'Recording is too large')
      const pcm =
        input.format === 'pcm'
          ? Uint8Array.from(data).buffer
          : await decodeDictationAudio(data, operation)
      if (!pcm.byteLength || pcm.byteLength % 2) throw new HttpError(400, 'Invalid PCM recording')
      const controller = new AbortController()
      const session = await this.engine.start(
        input.language,
        AbortSignal.any([operation, controller.signal]),
        () => {},
      )
      try {
        for (let at = 0; at < pcm.byteLength; at += 64 * 1024)
          await session.feed(pcm.slice(at, at + 64 * 1024))
        return { text: await session.finish() }
      } finally {
        controller.abort()
        await session.done
      }
    })
  }
  async cancel(owner: string, id: string) {
    this.cancelled.set(JSON.stringify([owner, id]), Date.now() + 300000)
    if (this.cancelled.size > 256) this.cancelled.delete(this.cancelled.keys().next().value!)
    const entry = this.active
    if (!entry || entry.owner !== owner || entry.id !== id) return
    entry.controller.abort()
    await entry.done.catch(() => {})
  }
  async dispose() {
    this.active?.controller.abort()
    await this.active?.done.catch(() => {})
  }
}
