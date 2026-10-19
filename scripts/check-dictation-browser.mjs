import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const built = await build({
  stdin: {
    contents: `
      import {createRoot} from 'react-dom/client';
      import {useState,useRef,useSyncExternalStore} from 'react';
      import {TooltipProvider} from '@dovo/studio-ui';
      import {ComposerDictation} from './src/chat/composer/composer-dictation';
      import {createComposerDraft} from './src/chat/composer/composer-draft';
      window.statusCalls=0;window.cancelled=[];window.installCalls=0;window.audioBytes=0;window.installed=false;window.failInstall=false;window.failTranscribe=false;
      window.dovo={dictation:{
        status:async()=>{window.statusCalls++;return {engine:true,model:window.installed,downloading:false,downloaded:0}},
        install:async()=>{window.installCalls++;if(window.failInstall)throw Error('Download failed');window.installed=true},
        transcribe:(id,pcm)=>{window.audioBytes=pcm.byteLength;return new Promise((resolve,reject)=>{window.complete=()=>window.failTranscribe?reject(Error('Transcription failed')):resolve('Fix de desktop app.');window.resolveLate=resolve})},
        cancel:async(id)=>{window.cancelled.push(id)}
      }};
      function Editor(){const[controller]=useState(()=>createComposerDraft('Existing text.',()=>{}));const input=useRef(null);const[active,setActive]=useState(false);const text=useSyncExternalStore(controller.subscribe,()=>controller.text);window.edit=(value)=>controller.update(value);window.text=()=>controller.text;return <><textarea ref={input} aria-label="Message" value={text} onChange={event=>controller.update(event.target.value)}/><ComposerDictation controller={controller} input={input} disabled={false} onActive={setActive}/><button disabled={active}>Send</button></>}
      function App(){const[key,setKey]=useState(0);window.switchThread=()=>setKey(value=>value+1);return <TooltipProvider><Editor key={key}/></TooltipProvider>};
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const mic = page.getByRole('button', { name: 'Dictate message', exact: true })
  const recording = page.getByRole('button', { name: 'Stop dictation', exact: true })
  await mic.click()
  await page.getByRole('button', { name: 'Download model', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.installCalls),
    0,
    'download requires an explicit click',
  )
  await page.evaluate(() => {
    window.failInstall = true
  })
  await page.getByRole('button', { name: 'Download model', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Download failed' }).waitFor()
  await page.evaluate(() => {
    window.failInstall = false
  })
  await page.getByRole('button', { name: 'Download model', exact: true }).click()
  await mic.waitFor()
  const record = async () => {
    await mic.click()
    await recording.waitFor()
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true)
    // Wait for actual worklet PCM rather than calling a mocked recording implementation.
    await page.waitForTimeout(400)
    await recording.click()
    await page.waitForFunction(() => window.complete && window.audioBytes > 320)
  }
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.focus()
  await page.evaluate(() => {
    const input = document.querySelector('textarea')
    input.setSelectionRange(0, 8)
  })
  await record()
  await page.evaluate(() => window.complete())
  await page.waitForFunction(() => window.text() === 'Fix de desktop app. text.')
  assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false)

  await page.evaluate(() => {
    window.complete = null
  })
  await record()
  await input.fill('Typed while transcribing')
  await page.evaluate(() => window.complete())
  await page.getByRole('textbox', { name: 'Dictation transcript', exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'Typed while transcribing')
  await page.getByRole('button', { name: 'Insert transcript', exact: true }).click()
  assert.equal(await input.inputValue(), 'Typed while transcribing Fix de desktop app.')

  await page.evaluate(() => {
    window.complete = null
    window.failTranscribe = true
  })
  await record()
  await page.evaluate(() => window.complete())
  await page.getByRole('alert').filter({ hasText: 'Transcription failed' }).waitFor()
  assert.equal(await input.inputValue(), 'Typed while transcribing Fix de desktop app.')
  await page.evaluate(() => {
    window.failTranscribe = false
    window.complete = null
  })

  await record()
  await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click()
  await page.evaluate(() => window.resolveLate('MUST NOT APPEAR'))
  assert.equal(await input.inputValue(), 'Typed while transcribing Fix de desktop app.')
  await page.evaluate(() => {
    window.complete = null
  })
  await record()
  await page.evaluate(() => window.switchThread())
  await page.evaluate(() => window.resolveLate('WRONG THREAD'))
  await page.waitForFunction(() => window.text() === 'Existing text.')
  await mic.click()
  await recording.waitFor()
  await page.keyboard.press('Escape')
  await mic.waitFor()
  assert.equal(await page.evaluate(() => window.cancelled.length >= 3), true)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop dictation: opt-in download/retry, real microphone/worklet PCM, selection insertion, draft protection, transcription failure, cancellation and thread switching passed.',
  )
} finally {
  await browser.close()
}
