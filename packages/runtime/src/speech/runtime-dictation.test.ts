import { expect, it, vi } from 'vite-plus/test'
import { RuntimeDictation, decodeDictationAudio } from './runtime-dictation'
import { DictationEngine } from './dictation-engine'
import { startRuntime } from '../index'
import { decode, taskSchema } from '@dovo/protocol'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

it('keeps cancellation scoped to a device and remembers cancel-before-admission', async () => {
  const service = new RuntimeDictation('/unused', new DictationEngine('/missing', '/unused'))
  let admitted: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    admitted = resolve
  })
  const result = service.run(
    'phone',
    'recording',
    new AbortController().signal,
    (signal) =>
      new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        admitted()
      }),
  )
  const failure = result.catch((cause: unknown) => cause)
  await ready
  await service.cancel('other-phone', 'recording')
  await expect(
    service.run('other-phone', 'next', new AbortController().signal, async () => undefined),
  ).rejects.toThrow('busy')
  await service.cancel('phone', 'recording')
  expect(await failure).toEqual(new Error('cancelled'))
  await service.cancel('phone', 'not-started')
  await expect(
    service.run('phone', 'not-started', new AbortController().signal, async () => undefined),
  ).rejects.toThrow('cancelled')
  expect(
    await service.run(
      'other-phone',
      'not-started',
      new AbortController().signal,
      async () => 'allowed',
    ),
  ).toBe('allowed')
  await service.dispose()
})
it('rejects malformed audio and aborts the engine on a failed feed', async () => {
  const engine = new DictationEngine('/missing', '/unused')
  const service = new RuntimeDictation('/unused', engine)
  const start = vi.spyOn(engine, 'start').mockImplementation(async (_, signal) => ({
    feed: async () => {
      throw new Error('Feed failed')
    },
    finish: async () => 'unused',
    done: new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    ),
  }))
  try {
    await expect(
      service.transcribe(
        'phone',
        { id: 'bad', data: 'AAAA=', format: 'pcm', language: 'auto' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('encoding')
    await expect(
      service.transcribe(
        'phone',
        { id: 'odd', data: 'YQ==', format: 'pcm', language: 'auto' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('PCM')
    expect(start).not.toHaveBeenCalled()
    await expect(
      service.transcribe(
        'phone',
        { id: 'feed', data: 'AAA=', format: 'pcm', language: 'auto' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Feed failed')
  } finally {
    await service.dispose()
  }
})
const ffmpegAvailable = !spawnSync(process.env.DOVO_FFMPEG || 'ffmpeg', ['-version']).error
it.skipIf(!ffmpegAvailable)(
  'decodes a real WAV through host FFmpeg and observes cancellation',
  async () => {
    const samples = 1600
    const wav = Buffer.alloc(44 + samples * 2)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24)
    wav.writeUInt32LE(32000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(samples * 2, 40)
    expect((await decodeDictationAudio(wav, AbortSignal.timeout(5000))).byteLength).toBe(
      samples * 2,
    )
    await expect(decodeDictationAudio(wav, AbortSignal.abort())).rejects.toThrow('abort')
  },
)
it('requires device authentication over HTTP, binds audio to an existing task, and blocks revoked devices', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const phoneToken = randomBytes(32).toString('base64url')
  const phone = runtime.services.devices.add('Phone', phoneToken)
  const transcribe = vi
    .spyOn(runtime.services.dictation, 'transcribe')
    .mockResolvedValue({ text: 'Runtime transcript' })
  const input = { id: 'session', taskId: 'task', language: 'auto', format: 'pcm', data: 'AAA=' }
  const call = (path: string, input: unknown, credential = phoneToken) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/dictation/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  try {
    expect((await call('transcribe', input, 'invalid')).status).toBe(401)
    expect((await call('transcribe', input)).status).toBe(404)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [
        decode(taskSchema, {
          id: 'task',
          title: 'Task',
          repositoryId: 'missing',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
        }),
      ],
    }))
    expect(await (await call('transcribe', input)).json()).toEqual({ text: 'Runtime transcript' })
    expect(transcribe).toHaveBeenCalledWith(phone, input, expect.any(AbortSignal))
    expect(JSON.stringify(runtime.services.store.get())).not.toContain('Runtime transcript')
    runtime.services.devices.revoke(phone)
    expect((await call('transcribe', input)).status).toBe(401)
    expect(transcribe).toHaveBeenCalledTimes(1)
  } finally {
    await runtime.close()
    transcribe.mockRestore()
  }
})
