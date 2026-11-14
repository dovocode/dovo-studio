import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dovo-call-audio-'))
const wav = join(directory, 'speech-and-silence.wav')
const rate = 16000,
  count = rate * 4,
  bytes = Buffer.alloc(44 + count * 2)
bytes.write('RIFF')
bytes.writeUInt32LE(bytes.length - 8, 4)
bytes.write('WAVEfmt ', 8)
bytes.writeUInt32LE(16, 16)
bytes.writeUInt16LE(1, 20)
bytes.writeUInt16LE(1, 22)
bytes.writeUInt32LE(rate, 24)
bytes.writeUInt32LE(rate * 2, 28)
bytes.writeUInt16LE(2, 32)
bytes.writeUInt16LE(16, 34)
bytes.write('data', 36)
bytes.writeUInt32LE(count * 2, 40)
for (let sample = 0; sample < rate; sample++)
  bytes.writeInt16LE(
    Math.round(Math.sin((sample * 2 * Math.PI * 220) / rate) * 5000),
    44 + sample * 2,
  )
await writeFile(wav, bytes)
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `import{browserBotCallAudio}from'./packages/extension-tasks/src/bots/bot-call-audio';window.errors=[];window.transcribed=[];window.feeds=0;window.finished=0;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await get(options);window.tracks=stream.getTracks();window.captures=(window.captures??0)+1;return stream};const bridge={start:async()=>{window.starts=(window.starts??0)+1},feed:async(_,pcm)=>{window.feeds+=pcm.byteLength},finish:async()=>{window.finished++;if(window.holdTranscript){window.holdTranscript=false;await new Promise(resolve=>window.releaseTranscript=resolve)}return 'Recognized request'},cancel:async()=>{},status:async()=>({engine:true,model:true}),install:async()=>{},subscribe:()=>()=>{}};const audio=browserBotCallAudio(bridge,'auto');window.start=async()=>{window.signal=new AbortController();await audio.listen(window.signal.signal,{preview:()=>{},finish:text=>window.transcribed.push(text),error:e=>window.errors.push(e.message)})};window.overlap=async()=>{window.holdTranscript=true;window.overlapResults=[];window.first=new AbortController();await audio.listen(window.first.signal,{preview:()=>{},released:()=>{window.second=new AbortController();void audio.listen(window.second.signal,{preview:()=>{},finish:text=>window.overlapResults.push('second:'+text),error:e=>window.errors.push(e.message)})},finish:text=>window.overlapResults.push('first:'+text),error:e=>window.errors.push(e.message)})};`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
  },
  [],
)
const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
  ],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => window.start())
  await page.waitForFunction(() => window.transcribed.length === 1)
  assert.deepEqual(await page.evaluate(() => window.transcribed), ['Recognized request'])
  assert.equal(await page.evaluate(() => window.finished), 1)
  assert.ok(await page.evaluate(() => window.feeds > 32000))
  assert.equal(
    await page.evaluate(() => window.tracks.every((track) => track.readyState === 'ended')),
    true,
  )
  await page.evaluate(() => window.start())
  await page.evaluate(() => window.signal.abort())
  await page.waitForFunction(() => window.tracks.every((track) => track.readyState === 'ended'))
  const before = await page.evaluate(() => ({ captures: window.captures, starts: window.starts }))
  await page.evaluate(() => window.overlap())
  await page.waitForFunction(
    (before) => window.captures >= before.captures + 2 && !!window.releaseTranscript,
    before,
  )
  assert.equal(
    await page.evaluate(() => window.starts),
    before.starts + 1,
    'Next microphone records while the previous decoder remains active',
  )
  await page.evaluate(() => window.releaseTranscript())
  await page.waitForFunction(() => window.overlapResults.length === 2)
  assert.deepEqual(await page.evaluate(() => window.overlapResults), [
    'first:Recognized request',
    'second:Recognized request',
  ])
  await page.evaluate(() => {
    window.first.abort()
    window.second.abort()
  })
  assert.deepEqual(await page.evaluate(() => window.errors), [])
  assert.deepEqual(errors, [])
  console.log(
    'Bot call audio: real Chromium microphone capture and AudioWorklet PCM, speech/silence detection, one transcription and microphone release pass. Microphone input is generated; recognition is scripted.',
  )
} finally {
  await browser.close()
  await rm(directory, { recursive: true, force: true })
}
