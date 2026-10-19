import { it, expect, afterEach, vi } from 'vite-plus/test'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DictationEngine, dictationWav, maxDictationSamples } from './dictation-engine.js'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-dictation-test-'))
  directories.push(directory)
  const binary = join(directory, 'engine')
  await writeFile(binary, '')
  return new DictationEngine(binary, directory)
}

it('encodes bounded little-endian mono PCM without changing the samples', () => {
  const pcm = new ArrayBuffer(640),
    view = new DataView(pcm)
  view.setInt16(0, -32768, true)
  view.setInt16(2, 32767, true)
  const wav = dictationWav(pcm)
  expect(wav.subarray(0, 4).toString()).toBe('RIFF')
  expect(wav.readUInt32LE(4)).toBe(676)
  expect(wav.readUInt16LE(22)).toBe(1)
  expect(wav.readUInt32LE(24)).toBe(16000)
  expect(wav.readUInt16LE(34)).toBe(16)
  expect(wav.subarray(44)).toEqual(Buffer.from(pcm))
  expect(() => dictationWav(new ArrayBuffer(0))).toThrow('between')
  expect(() => dictationWav(new ArrayBuffer(321))).toThrow('between')
  expect(() => dictationWav(new ArrayBuffer(maxDictationSamples * 2 + 2))).toThrow('between')
})

it('does not record or spawn until the engine and model are installed', async () => {
  const engine = await fixture()
  expect(await engine.status()).toEqual({
    engine: true,
    model: false,
    downloading: false,
    downloaded: 0,
  })
  await expect(
    engine.transcribe(new ArrayBuffer(640), new AbortController().signal),
  ).rejects.toThrow('Download')
  await rm(engine.binary)
  await expect(engine.install(new AbortController().signal)).rejects.toThrow('engine is missing')
})

it('rejects an incomplete or altered model and removes the partial download', async () => {
  const engine = await fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  )
  await expect(engine.install(new AbortController().signal)).rejects.toThrow('integrity')
  expect((await engine.status()).model).toBe(false)
  expect((await engine.status()).downloading).toBe(false)
  expect(await readdir(engine.directory)).toEqual(['engine'])
})

it('reports HTTP failures without leaving an installation locked', async () => {
  const engine = await fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  )
  await expect(engine.install(new AbortController().signal)).rejects.toThrow('503')
  expect((await engine.status()).downloading).toBe(false)
})

it('cancels a download and permits a fresh attempt', async () => {
  const engine = await fixture()
  const controller = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      controller.abort()
      return new Response(new Uint8Array([1, 2]))
    }),
  )
  await expect(engine.install(controller.signal)).rejects.toThrow(/abort/i)
  expect(await readdir(engine.directory)).toEqual(['engine'])
  expect((await engine.status()).downloading).toBe(false)
})
