/// <reference lib="es2024" />
import { it, expect, afterEach, vi } from 'vite-plus/test'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DictationEngine, validateDictationPcm, maxDictationSamples } from './dictation-engine.js'

const fixtureModel = vi.hoisted(
  () => `
  const locale = process.argv[2];
  const frame = (text) => {
    const value = Buffer.from(text); const header = Buffer.alloc(4); header.writeUInt32LE(value.length);
    process.stdout.write(header); process.stdout.write(value);
  };
  // Split the ready header across writes to exercise the incremental pipe parser.
  process.stdout.write(Buffer.alloc(1));
  setTimeout(() => process.stdout.write(Buffer.alloc(3)), 10);
  process.stdin.on('data', () => {
    if (locale === 'en-GB') { process.stderr.write('Fixture decoder failed'); process.exit(1); }
    if (locale === 'pl-PL') { const invalid = Buffer.alloc(4); invalid.writeUInt32LE(100001); process.stdout.write(invalid); return; }
    frame('Hallo wereld 🌍');
  });
  process.stdin.on('end', () => frame('Hallo wereld 🌍.'));
`,
)
vi.mock('@dovo/protocol', async (original) => {
  const protocol = await original<typeof import('@dovo/protocol')>()
  const { createHash } = await import('node:crypto')
  return {
    ...protocol,
    dictationModel: {
      ...protocol.dictationModel,
      bytes: Buffer.byteLength(fixtureModel),
      sha256: createHash('sha256').update(fixtureModel).digest('hex'),
    },
  }
})

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

it('rejects malformed and oversized PCM at the native boundary', () => {
  expect(() => validateDictationPcm(new ArrayBuffer(0))).toThrow('Invalid')
  expect(() => validateDictationPcm(new ArrayBuffer(321))).toThrow('Invalid')
  expect(() => validateDictationPcm(new ArrayBuffer(maxDictationSamples * 2 + 2))).toThrow(
    'Invalid',
  )
  expect(() => validateDictationPcm('not audio')).toThrow('Invalid')
  expect(() => validateDictationPcm(new ArrayBuffer(640))).not.toThrow()
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

async function pipeFixture() {
  const original = await fixture()
  const engine = new DictationEngine(process.execPath, original.directory)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(fixtureModel)),
  )
  await engine.install(new AbortController().signal)
  return engine
}

it('parses framed UTF-8 previews before finalization and retains the final result', async () => {
  const engine = await pipeFixture()
  const preview = Promise.withResolvers<string>()
  const session = await engine.start('nl-NL', new AbortController().signal, (text) =>
    preview.resolve(text),
  )
  await session.feed(new ArrayBuffer(640))
  expect(await preview.promise).toBe('Hallo wereld 🌍')
  expect(await session.finish()).toBe('Hallo wereld 🌍.')
  await expect(session.feed(new ArrayBuffer(640))).rejects.toThrow('already finishing')
})

it('terminates an active helper on cancellation and reports process failures', async () => {
  const engine = await pipeFixture()
  const controller = new AbortController()
  const session = await engine.start('nl-NL', controller.signal, () => {})
  controller.abort()
  await expect(session.done).rejects.toThrow('cancelled')
  await expect(session.finish()).rejects.toThrow('cancelled')
  const failed = await engine.start('en-GB', new AbortController().signal, () => {})
  await failed.feed(new ArrayBuffer(640))
  await expect(failed.done).rejects.toThrow('Fixture decoder failed')
})

it('terminates a helper that emits an oversized transcript frame', async () => {
  const engine = await pipeFixture()
  const session = await engine.start('pl-PL', new AbortController().signal, () => {})
  await session.feed(new ArrayBuffer(640))
  await expect(session.done).rejects.toThrow('unexpectedly large')
})
