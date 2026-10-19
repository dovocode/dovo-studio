import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { prepareDictationEngine } from './packaging/dictation-engine.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dovo-stt-smoke-'))
try {
  const bundle = await prepareDictationEngine(root)
  const output = join(temporary, 'engine.mjs')
  await build({
    entryPoints: [join(root, 'apps/desktop/electron/dictation-engine.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { DictationEngine } = await import(pathToFileURL(output).href)
  const engine = new DictationEngine(
    join(bundle, process.platform === 'win32' ? 'transcribe-cli.exe' : 'transcribe-cli'),
    join(root, 'work/dictation/model'),
  )
  if (!(await engine.status()).model) {
    console.log('Downloading the pinned 159 MB Redux model for native verification…')
    await engine.install(new AbortController().signal)
  }
  const source = resolve(
    bundle,
    '../transcribe.cpp-692350def1edea35a616b652255a8be70a168d37/samples/jfk.wav',
  )
  const wav = await readFile(source)
  // Walk WAV chunks rather than assuming a fixed header in the upstream fixture.
  let pcm
  for (let position = 12; position + 8 <= wav.length;) {
    const size = wav.readUInt32LE(position + 4)
    if (wav.subarray(position, position + 4).toString() === 'data') {
      pcm = Uint8Array.from(wav.subarray(position + 8, position + 8 + size)).buffer
      break
    }
    position += 8 + size + (size % 2)
  }
  assert(pcm, 'sample has PCM data')
  const began = performance.now()
  const text = await engine.transcribe(pcm, new AbortController().signal)
  assert.match(text, /ask not what your country can do for you/i)
  assert.equal(await engine.transcribe(new ArrayBuffer(32000), new AbortController().signal), '')
  console.log(
    `Native Redux transcription passed in ${((performance.now() - began) / 1000).toFixed(2)}s: ${text}`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
