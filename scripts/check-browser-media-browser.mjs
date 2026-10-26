import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/desktop',
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {BrowserMediaControls} from '${root}packages/studio-shell/src/browser-media-controls';
    import {decode,browserCommandSchema} from '@dovo/protocol';
    window.commands=[];window.requests=[];window.captures=[];window.failure='';
    window.bridge=async command=>{
      decode(browserCommandSchema,command);window.commands.push(command);
      if(window.failure===command.action)throw Error('Fixture request failed');
      if(command.action==='media'){
        const request=window.requests.find(r=>r.id===command.requestId);
        if(command.decision==='allow' && request.kind==='display')window.captures.push({id:'22222222-2222-4222-8222-222222222222',key:request.key,sourceKey:command.source,profileId:request.profileId,origin:request.origin,audio:command.audio,state:'active'});
        window.requests=window.requests.filter(r=>r.id!==command.requestId);
      }
      if(command.action==='stop-capture')window.captures=window.captures.map(c=>c.id===command.captureId?{...c,state:'stopping'}:c);
      return {url:'',back:false,forward:false,mediaRequests:structuredClone(window.requests),captures:structuredClone(window.captures)};
    };
    window.requestCapture=async(kind='display')=>{
      window.requests=[{id:crypto.randomUUID(),kind,key:'call-tab',profileId:'work',origin:'https://meet.example',video:kind==='display',audio:true,expiresAt:Date.now()+60000,sources:kind==='display'?[{key:'source-tab',title:'Development page',url:'http://localhost:3000',requester:false}]:undefined}];await window.pollMedia();
    };
    createRoot(document.getElementById('app')).render(<BrowserMediaControls/>);
  `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: 'export const useStudioHost=()=>({browser:window.bridge});',
    },
    {
      path: '@dovo/client-runtime',
      contents: `import {Effect} from 'effect';export function startPolling(work,options){window.pollMedia=()=>Effect.runPromise(work).catch(options.onError);void window.pollMedia();return {stop:async()=>{}}}`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
    export {Button} from '${root}packages/studio-ui/src/components/ui/button';
    export {Checkbox} from '${root}packages/studio-ui/src/components/ui/checkbox';
    export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}packages/studio-ui/src/components/ui/dialog';
  `,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/media-fixture')
  for (const name of readdirSync(root + 'apps/desktop/dist/assets').filter((name) =>
    name.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + name, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => typeof window.pollMedia === 'function')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => window.requestCapture())
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.equal(
    await dialog.getByRole('button', { name: 'Share tab', exact: true }).isEnabled(),
    false,
  )
  assert.equal(await dialog.getByRole('checkbox', { name: 'Share tab audio' }).isChecked(), false)
  await dialog.getByRole('radio').check()
  await dialog.getByRole('checkbox', { name: 'Share tab audio' }).check()
  mkdirSync(root + 'work/browser-media', { recursive: true })
  await page.screenshot({ path: root + 'work/browser-media/consent-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: root + 'work/browser-media/consent-narrow.png' })
  await page.evaluate(() => {
    window.failure = 'media'
  })
  await dialog.getByRole('button', { name: 'Share tab', exact: true }).click()
  await dialog.getByRole('alert').getByText('Fixture request failed').waitFor()
  assert.equal(
    await dialog.getByRole('radio').isChecked(),
    true,
    'A failed request preserves selection',
  )
  await page.evaluate(() => {
    window.failure = ''
  })
  await dialog.getByRole('button', { name: 'Share tab', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('complementary', { name: 'Browser tab sharing' }).waitFor()
  assert.match(await page.getByRole('status').textContent(), /tab audio included/)
  const approved = await page.evaluate(() =>
    window.commands.filter((c) => c.action === 'media').at(-1),
  )
  assert.equal(approved.source, 'source-tab')
  assert.equal(approved.audio, true)
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await page.getByText(/Stopping tab sharing/).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).isEnabled(),
    false,
  )
  assert.equal(
    await page.getByRole('complementary', { name: 'Browser tab sharing' }).count(),
    1,
    'Stop does not hide a still-live capture',
  )
  await page.evaluate(async () => {
    window.captures = window.captures.map((capture) => ({
      ...capture,
      unresponsive: true,
      sourceTitle: 'Development server',
      sourceUrl: 'http://localhost:3000',
    }))
    await window.pollMedia()
  })
  await page.getByText('Development server', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: root + 'work/browser-media/stopping-narrow.png' })
  await page
    .getByRole('alert')
    .getByText(/Sharing is still active/)
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).isEnabled(),
    true,
  )
  const stopCount = await page.evaluate(
    () => window.commands.filter((command) => command.action === 'stop-capture').length,
  )
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.commands.filter((command) => command.action === 'stop-capture').length,
    ),
    stopCount + 1,
  )
  assert.equal(await page.getByRole('complementary', { name: 'Browser tab sharing' }).count(), 1)
  await page.evaluate(async () => {
    window.captures = []
    await window.pollMedia()
  })
  await page
    .getByRole('complementary', { name: 'Browser tab sharing' })
    .waitFor({ state: 'hidden' })
  await page.evaluate(() => window.requestCapture('user-media'))
  await dialog.getByRole('heading', { name: 'Allow microphone?' }).waitFor()
  assert.equal(await dialog.getByRole('radio').count(), 0)
  assert.equal(await dialog.getByRole('checkbox').count(), 0)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.commands.filter((c) => c.action === 'media').at(-1)))
      .decision,
    'deny',
  )
  await page.evaluate(() => window.requestCapture())
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('radio').isChecked(), false, 'Never reuse the prior grant')
  await page.evaluate(async () => {
    window.requests = []
    await window.pollMedia()
  })
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log(
    'Browser media UI passed: explicit tab/audio consent, preserved failed selection, microphone request, cancellation, expiry and confirmed-stop indicator.',
  )
} finally {
  await browser.close()
}
