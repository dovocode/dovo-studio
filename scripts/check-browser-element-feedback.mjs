import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, bundleBrowser } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const protocol = root + '/packages/protocol/src/runtime/previews/browser-element.ts'
const compiled = await build({
  stdin: { contents: `export * from ${JSON.stringify(protocol)}`, resolveDir: root },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
})
const { readBrowserElementSnapshot, inspectBrowserElement } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
)
const browser = await chromium.launch()
try {
  const target = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  })
  await target.setContent(
    '<title>Local app</title><style>body{margin:0;height:2000px}button{position:absolute;left:200px;top:150px;width:160px;height:80px}input{position:absolute;left:200px;top:300px;width:160px;height:50px}</style><button id="save" onclick="window.clicks=(window.clicks||0)+1">Save settings</button><input type="password" value="must-not-be-copied" aria-label="Password">',
  )
  const snapshot = await target.evaluate(readBrowserElementSnapshot)
  const point = { snapshot, x: 280 / 800, y: 190 / 600 }
  const element = await target.evaluate(inspectBrowserElement, point)
  assert.equal(element.selector, '#save')
  assert.equal(element.text, 'Save settings')
  assert.equal(
    await target.evaluate(() => window.clicks || 0),
    0,
    'inspection must not click controls',
  )
  const password = await target.evaluate(inspectBrowserElement, {
    snapshot,
    x: 280 / 800,
    y: 325 / 600,
  })
  assert.equal(password.text, '')
  await target.evaluate(() => scrollTo(0, 100))
  await assert.rejects(target.evaluate(inspectBrowserElement, point), /page moved or changed/)
  await target.evaluate(() => scrollTo(0, 0))

  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root + '/packages/studio-ui',
        loader: 'tsx',
        contents: `
import {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserElementFeedback} from '${root}/packages/extension-tasks/src/browser/browser-element-feedback.tsx';
window.workspace={tasks:[{id:'task',draft:'Existing draft'}]}; window.uploads=[];
function App(){const[owner,setOwner]=useState('a');window.changeOwner=()=>setOwner('b');return <BrowserElementFeedback key={owner} taskId="task" enabled capture={()=>window.capture()} inspect={point=>window.inspect(point)}/>};
createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
    },
    [
      {
        path: '@dovo/studio-core',
        contents: `export const updateTask=(w,id,f)=>({...w,tasks:w.tasks.map(t=>t.id===id?f(t):t)});export const useWorkspace=()=>({setWorkspace:f=>{window.workspace=f(window.workspace)}});`,
      },
      {
        path: './screenshot-attachment',
        importer: root + '/packages/extension-tasks/src/browser',
        contents: `export const useScreenshotAttachment=()=>({busy:false,attach:async(image,signal)=>{signal?.throwIfAborted();if(window.holdUpload){window.uploadWaiting=true;await new Promise((resolve,reject)=>{window.releaseUpload=resolve;signal?.addEventListener('abort',()=>reject(Error('Attachment cancelled')),{once:true})});signal?.throwIfAborted()}if(window.uploadFails)throw Error('Upload unavailable');window.uploads.push(image)}});`,
      },
      {
        path: '@dovo/studio-ui',
        contents: `export * from '${root}/packages/studio-ui/src/components/ui/button.tsx';export * from '${root}/packages/studio-ui/src/components/ui/dialog.tsx';export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;`,
      },
    ],
  )
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.exposeFunction('capture', async () => ({
    snapshot: await target.evaluate(readBrowserElementSnapshot),
    image:
      'data:image/png;base64,' + (await target.screenshot({ scale: 'css' })).toString('base64'),
  }))
  await page.exposeFunction('inspect', (value) => target.evaluate(inspectBrowserElement, value))
  await page.setContent(
    '<style>[role=dialog]{position:fixed;inset:20px;background:white;overflow:auto;padding:16px;z-index:2}img{max-width:100%}button{cursor:pointer}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const select = async () => {
    await page.getByRole('button', { name: 'Point at an element', exact: true }).click()
    const surface = page.getByRole('button', { name: /^Page snapshot:/ })
    await surface.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('img')?.complete)
    const bounds = await surface.boundingBox()
    await surface.click({ position: { x: bounds.width * point.x, y: bounds.height * point.y } })
    await page.getByText('#save', { exact: true }).waitFor()
  }
  await select()
  await page.getByRole('textbox', { name: 'Requested change' }).fill('Make this button clearer')
  await page.getByRole('checkbox', { name: 'Attach a cropped screenshot' }).check()
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const first = await page.evaluate(() => ({
    draft: window.workspace.tasks[0].draft,
    uploads: window.uploads,
  }))
  assert.match(first.draft, /^Existing draft/)
  assert.match(first.draft, /Make this button clearer/)
  assert.match(first.draft, /untrusted website content/)
  assert.match(first.draft, /#save/)
  assert.equal(first.uploads.length, 1)
  const cropped = await page.evaluate(async (src) => {
    const image = new Image()
    image.src = src
    await image.decode()
    return [image.naturalWidth, image.naturalHeight]
  }, first.uploads[0])
  assert.deepEqual(cropped, [184, 104], 'crop uses CSS viewport coordinates even on a 2x display')
  await page.evaluate(() => {
    window.uploadFails = true
  })
  await select()
  await page.getByRole('checkbox', { name: 'Attach a cropped screenshot' }).check()
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: 'image could not be attached' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.workspace.tasks[0].draft)).split('Selected browser element')
      .length - 1,
    2,
    'failed optional upload must retain exactly one new text request',
  )
  await page.evaluate(() => {
    window.uploadFails = false
    window.holdUpload = true
  })
  await select()
  await page.getByRole('checkbox', { name: 'Attach a cropped screenshot' }).check()
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.waitForFunction(() => window.uploadWaiting)
  await page.getByRole('button', { name: 'Skip image', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: 'Image not attached' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.workspace.tasks[0].draft)).split('Selected browser element')
      .length - 1,
    3,
  )
  assert.equal(await page.evaluate(() => window.uploads.length), 1)
  await page.evaluate(() => {
    window.holdUpload = false
  })
  const beforeCancel = await page.evaluate(() => window.workspace.tasks[0].draft)
  await select()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].draft), beforeCancel)
  await select()
  await target.evaluate(() => scrollTo(0, 50))
  const surface = page.getByRole('button', { name: /^Page snapshot:/ })
  await surface.press('Enter')
  await page.getByRole('alert').filter({ hasText: 'page moved or changed' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Add to draft', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.changeOwner())
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log(
    'Browser element feedback passed: DOM metadata, no clicks/password values, stale capture rejection, draft append, crop, upload failure, cancel and owner change.',
  )
} finally {
  await browser.close()
}
