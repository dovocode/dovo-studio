import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {ApplicationStateProvider} from '@dovo/studio-core/state';
import {TooltipProvider} from '@dovo/studio-ui';
import {ArtifactCard} from './src/chat/artifacts.tsx';
import {FloatingPreview} from './src/detail/floating-preview.tsx';
import {BrowserPane} from './src/browser/browser-pane.tsx';
function App(){
 const [thread,setThread]=useState('one'),[host,setHost]=useState('first'),[tick,setTick]=useState(0),[browser,setBrowser]=useState(false),[placement,setPlacement]=useState('inline');
 window.changeThread=setThread;window.changeHost=setHost;window.updatePreview=()=>setTick(x=>x+1);window.showBrowser=()=>setBrowser(true);
 window.previewWorkspace={...window.previewWorkspace,activeRuntimeId:host};
 return <TooltipProvider><main className="flex h-screen min-w-0"><div className="min-w-0 flex-1 overflow-auto p-5"><p>Conversation stays here</p><ArtifactCard reference={{id:'counter',taskId:thread,title:'Interactive counter',format:'html',revision:3}}/><div style={{height:1500}}/><ArtifactCard reference={{id:'offscreen',taskId:thread,title:'Offscreen',format:'html',revision:1}}/></div>{browser&&<aside className={placement==='inline'?'shrink-0 border-l':'contents'} style={placement==='inline'?{width:500}:undefined}><FloatingPreview title="Browser" placement={placement} onPlacementChange={setPlacement} inlineClassName="h-full" returnLabel="Dock preview" onClose={()=>setBrowser(false)}><BrowserPane taskId={thread}/></FloatingPreview></aside>}</main></TooltipProvider>
}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);
`,
    resolveDir: root + 'packages/extension-tasks/',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'preview-workspace',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-core$/ }, () => ({
          path: 'core-fixture',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export * from '${root}packages/studio-core/src/index.ts';export const useWorkspace=()=>window.previewWorkspace;export const useStudioHost=()=>({browser:window.browserCommand});export const useRemoteBrowserProfiles=()=>({profiles:[{id:'default',name:'Default'}]});`,
          loader: 'ts',
          resolveDir: root + 'packages/studio-core/',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  const assetDirectory = new URL('../apps/web/dist/client/assets/', import.meta.url)
  const css = (await readdir(assetDirectory)).filter((path) => path.endsWith('.css'))
  for (const file of css)
    await page.addStyleTag({ content: await readFile(new URL(file, assetDirectory), 'utf8') })
  await page.evaluate(() => {
    window.previewReads = []
    window.browserCommands = []
    window.failPreview = false
    const request = async (path, input) => {
      window.previewReads.push({ path, input, host: window.previewWorkspace.activeRuntimeId })
      if (window.failPreview) throw new Error('Preview temporarily unavailable')
      return {
        artifact: {
          ...input,
          title: 'Interactive counter',
          format: 'html',
          content: `<button id="counter">0</button><input id="amount" type="range" min="1" max="10" value="1"><canvas id="drawing" width="240" height="100"></canvas><canvas id="webgl" width="100" height="100"></canvas><script>let n=0;document.querySelector('#counter').onclick=e=>e.target.textContent=String(n+=Number(document.querySelector('#amount').value));const c=document.querySelector('#drawing');const ctx=c.getContext('2d');ctx.fillRect(10,10,80,80);const gl=document.querySelector('#webgl').getContext('webgl',{preserveDrawingBuffer:true});if(gl){gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);document.body.dataset.webglReady='yes'};c.onpointerdown=()=>{document.body.dataset.canvasClicked='yes';ctx.fillStyle='red';ctx.fillRect(10,10,80,80)};fetch('https://preview-leak.invalid').catch(()=>document.body.dataset.networkBlocked='yes');</script>`,
        },
      }
    }
    window.previewWorkspace = {
      request,
      connected: true,
      activeRuntimeId: 'first',
      connection: { address: 'http://runtime.test', token: 'paired' },
      snapshot: { artifactsEnabled: true, workspace: { tasks: [] } },
      runtimes: [],
    }
    window.browserCommand = async (command) => {
      window.browserCommands.push(command)
      return { url: 'http://localhost:3000', title: 'Live app', back: false, forward: false }
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const inline = page.locator('[data-inline-artifact="counter"]')
  const preview = inline.frameLocator('iframe').frameLocator('iframe')
  await preview.locator('#counter').click()
  assert.equal(await preview.locator('#counter').innerText(), '1')
  await preview.locator('#amount').fill('5')
  await preview.locator('#counter').click()
  assert.equal(await preview.locator('#counter').innerText(), '6')
  await preview.locator('#drawing').click()
  await preview.locator('body[data-canvas-clicked="yes"][data-network-blocked="yes"]').waitFor()
  await preview.locator('body[data-webgl-ready="yes"]').waitFor()
  assert.equal(
    (await page.evaluate(() => window.previewReads)).length,
    1,
    'Offscreen artifacts must not load',
  )
  assert.equal((await page.evaluate(() => window.previewReads))[0].input.revision, 3)
  const originalFrame = await inline.locator('iframe').elementHandle()
  const originalWindow = await originalFrame.evaluateHandle((frame) => frame.contentWindow)
  const sameFrame = async () => {
    assert.equal(
      await originalFrame.evaluate(
        (frame, original) => frame.contentWindow === original,
        originalWindow,
      ),
      true,
    )
    assert.equal(await preview.locator('#counter').innerText(), '6')
  }
  await inline.getByRole('button', { name: 'View artifact source', exact: true }).click()
  await inline.locator('pre').waitFor()
  await inline.getByRole('button', { name: 'Show rendered artifact', exact: true }).click()
  await sameFrame()
  await inline.getByRole('button', { name: 'Float preview', exact: true }).click()
  const floating = inline.getByRole('region', { name: 'Interactive counter preview' })
  const drag = async (locator, dx, dy) => {
    const box = await locator.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 })
    await page.mouse.up()
  }
  const before = await floating.boundingBox()
  await drag(inline.getByRole('button', { name: 'Move Interactive counter preview' }), -140, -100)
  const moved = await floating.boundingBox()
  assert.ok(Math.abs(moved.x - (before.x - 140)) < 2 && Math.abs(moved.y - (before.y - 100)) < 2)
  await drag(inline.getByRole('button', { name: 'Resize Interactive counter preview' }), 80, 70)
  const resized = await floating.boundingBox()
  assert.ok(
    Math.abs(resized.width - (before.width + 80)) < 2 &&
      Math.abs(resized.height - (before.height + 70)) < 2,
  )
  await sameFrame()
  await inline.getByRole('button', { name: 'Expand preview', exact: true }).click()
  assert.ok((await floating.boundingBox()).width > 1200)
  await sameFrame()
  await inline.getByRole('button', { name: 'Return to thread', exact: true }).click()
  await sameFrame()
  await page.evaluate(() => window.changeThread('two'))
  await page.waitForFunction(() => window.previewReads.at(-1).input.taskId === 'two')
  await preview.locator('#counter').waitFor()
  assert.equal(await preview.locator('#counter').innerText(), '0')
  await page.evaluate(() => {
    window.failPreview = true
    window.changeHost('second')
  })
  await inline.getByText('Preview temporarily unavailable').waitFor()
  await page.evaluate(() => {
    window.failPreview = false
  })
  await inline.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await preview.locator('#counter').waitFor()
  assert.equal((await page.evaluate(() => window.previewReads)).at(-1).host, 'second')
  await page.evaluate(() => {
    window.previewWorkspace.connected = false
    window.updatePreview()
  })
  await inline.getByText('Reconnect the computer to load this preview.').waitFor()
  await page.evaluate(() => {
    window.previewWorkspace.connected = true
    window.updatePreview()
  })
  await preview.locator('#counter').waitFor()
  await page.evaluate(() => window.showBrowser())
  const live = page.getByRole('region', { name: 'Browser preview', exact: true })
  await live.getByRole('textbox', { name: 'Preview URL' }).fill('http://localhost:3000')
  await live.getByRole('textbox', { name: 'Preview URL' }).press('Enter')
  await page.waitForFunction(() =>
    window.browserCommands.some((command) => command.action === 'show'),
  )
  const browserKey = (await page.evaluate(() => window.browserCommands)).find(
    (command) => command.action === 'show',
  ).key
  await live.getByRole('button', { name: 'Float preview', exact: true }).click()
  await page.waitForFunction(() => {
    const shows = window.browserCommands.filter((command) => command.action === 'show')
    return shows.at(-1)?.bounds.width < 500
  })
  const browserBefore = await live.boundingBox()
  await drag(live.getByRole('button', { name: 'Move Browser preview' }), -100, -80)
  await page.waitForFunction(
    (x) =>
      window.browserCommands.filter((command) => command.action === 'show').at(-1)?.bounds.x < x,
    browserBefore.x,
  )
  assert.ok(
    (await page.evaluate(() => window.browserCommands)).some(
      (command) => command.action === 'hide',
    ),
    'Native browser must not intercept drag gestures',
  )
  await live.getByRole('button', { name: 'Dock preview', exact: true }).click()
  await page.waitForFunction(
    () =>
      window.browserCommands.filter((command) => command.action === 'show').at(-1)?.bounds.width >=
      490,
  )
  assert.ok(
    (await page.evaluate(() => window.browserCommands))
      .filter((command) => command.action === 'show')
      .every((command) => command.key === browserKey),
    'Docking keeps the browser session',
  )
  assert.equal(
    (await page.evaluate(() => window.browserCommands)).filter(
      (command) => command.action === 'reload' || command.action === 'close',
    ).length,
    0,
  )
  await live.getByRole('button', { name: 'Float preview', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 600 })
  await page.waitForFunction(() => {
    const box = document.querySelector('[aria-label="Browser preview"]').getBoundingClientRect()
    return box.x >= 0 && box.y >= 0 && box.right <= 320 && box.bottom <= 600
  })
  await live.getByRole('button', { name: 'Close preview', exact: true }).click()
  await live.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log(
    'Inline previews: controls, canvas interaction, sandbox, pinned revisions, lazy loading, source, float/drag/resize/expand without reload, runtime/thread isolation, retry/offline, and live browser dock/float/session/native bounds verified.',
  )
} finally {
  await browser.close()
}
