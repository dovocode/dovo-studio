import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { availableParallelism } from 'node:os'
import { dictationModel, type DictationStatus } from '@dovo/protocol'

export const maxDictationSamples = 16000 * 300
const execute = promisify(execFile)
async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export function dictationWav(input: ArrayBuffer) {
  if (
    !(input instanceof ArrayBuffer) ||
    input.byteLength < 320 ||
    input.byteLength % 2 ||
    input.byteLength > maxDictationSamples * 2
  )
    throw new Error(
      'Dictation must contain between 10 milliseconds and 5 minutes of 16 kHz mono PCM audio.',
    )
  const wav = Buffer.alloc(44 + input.byteLength)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + input.byteLength, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(input.byteLength, 40)
  Buffer.from(input).copy(wav, 44)
  return wav
}

/** One process per utterance: no resident model, no server and no audio retained. */
export class DictationEngine {
  private downloaded = 0
  private downloading = false
  private verified = false
  readonly modelPath: string
  constructor(
    readonly binary: string,
    readonly directory: string,
  ) {
    this.modelPath = join(directory, 'parakeet-redux-q8.gguf')
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
    const partial = join(this.directory, 'parakeet-redux-q8.gguf.part')
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
  async transcribe(pcm: ArrayBuffer, signal: AbortSignal) {
    const wav = dictationWav(pcm)
    const status = await this.status()
    if (!status.engine || !status.model)
      throw new Error('Download the dictation model before recording.')
    // Muted microphones can supply all-zero PCM; never turn that into invented words.
    if (!new Uint8Array(pcm).some((byte) => byte !== 0)) return ''
    if (!this.verified) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.modelPath, { signal })) hash.update(chunk)
      if (hash.digest('hex') !== dictationModel.sha256)
        throw new Error('The dictation model is damaged. Download it again.')
      this.verified = true
    }
    signal.throwIfAborted()
    const temporary = await mkdtemp(join(this.directory, 'audio-'))
    try {
      const audio = join(temporary, 'recording.wav'),
        output = join(temporary, 'transcript.txt')
      await writeFile(audio, wav, { mode: 0o600 })
      await execute(
        this.binary,
        [
          '-m',
          this.modelPath,
          '--threads',
          String(Math.min(4, availableParallelism())),
          '--timestamps',
          'none',
          '-q',
          '-o',
          output,
          audio,
        ],
        {
          signal,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          killSignal: 'SIGKILL',
        },
      )
      signal.throwIfAborted()
      if ((await stat(output)).size > 100_000)
        throw new Error('The dictation transcript was unexpectedly large.')
      return (await readFile(output, 'utf8')).trim()
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}
