import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const resolveDir = root + 'packages/extension-tasks'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir,
      loader: 'tsx',
      contents: `
import {useScreenshotAttachment} from './src/browser/screenshot-attachment';import {createRoot} from 'react-dom/client';import {useState} from 'react';import {useAttachments} from './src/chat/composer/use-attachments';
window.calls=[];window.rows=[];window.stored={};window.failed=false;window.revision=1;
window.request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/read')return window.stored[input.id];if(window.failed)throw Error('Upload rejected');const attachment={id:input.id,name:input.name,mime:'image/png',size:atob(input.data).length};window.stored[input.id]={attachment,data:input.data};window.rows=input.replaceId?window.rows.map(f=>f.id===input.replaceId?attachment:f):[...window.rows,attachment];return {attachment,revision:++window.revision}};
function App(){const [snapshot,setSnapshot]=useState({revision:1,workspace:{tasks:[{id:'task',draftAttachments:[]}]}});window.snapshot=snapshot;window.publish=()=>setSnapshot({revision:window.revision,workspace:{tasks:[{id:'task',draftAttachments:window.rows}]}});const a=useAttachments(snapshot.workspace.tasks[0]);const screenshots=useScreenshotAttachment("task");window.capture=screenshots.attach;window.captureBusy=screenshots.busy;window.upload=a.upload;window.edit=a.edit;window.files=a.files;window.working=a.busy;return <>{a.editor}{screenshots.editor}<textarea aria-label="Message" defaultValue="Keep draft"/><div role="alert">{a.error}</div>{a.files.map(f=><button key={f.id} disabled={a.busy} onClick={()=>void a.edit(f.id)}>{f.name}</button>)}</>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
    alias: { '@dovo/protocol': root + 'packages/protocol/src/index.ts' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {imageEditorDocument,parseImageEditorResult} from '${root}packages/client-runtime/src/images/image-editor';export const useWorkspace=()=>({request:window.request,connected:true,snapshot:window.snapshot});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Dialog=({open,children})=>open?<section role="dialog">{children}</section>:null;export const DialogContent=({children})=><div style={{height:700}}>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>iframe{width:100%;height:700px;border:0}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.upload)
  await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 240
    c.getContext('2d').fillRect(0, 0, 400, 240)
    window.source = c.toDataURL()
    window.file = new File(
      [Uint8Array.from(atob(window.source.split(',')[1]), (c) => c.charCodeAt(0))],
      'picture.png',
      { type: 'image/png' },
    )
    window.operation = window.upload([window.file])
  })
  const editor = page.frameLocator('iframe[title="Image editor"]')
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.working && window.files.length === 1)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.path === '/api/attachments/upload').length,
    ),
    1,
  )
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Keep draft')
  await page.evaluate(() => window.publish())
  const originalId = await page.evaluate(() => window.files[0].id)
  await page.evaluate(() => {
    window.operation = window.edit(window.files[0].id)
  })
  await editor.getByRole('button', { name: 'Crop', exact: true }).click()
  const canvas = editor.locator('canvas')
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.75, {
    steps: 8,
  })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.waitForFunction(
    () => !window.working && window.calls.some((c) => c.path === '/api/attachments/replace'),
  )
  assert.equal(await page.evaluate(() => window.files.length), 1)
  assert.notEqual(await page.evaluate(() => window.files[0].id), originalId)
  assert.equal(
    await page.evaluate(
      () => window.calls.find((c) => c.path === '/api/attachments/replace').input.replaceId,
    ),
    originalId,
  )
  const dimensions = await page.evaluate(async () => {
    const call = window.calls.find((c) => c.path === '/api/attachments/replace')
    const image = await createImageBitmap(
      await (await fetch('data:image/png;base64,' + call.input.data)).blob(),
    )
    return [image.width, image.height]
  })
  assert.deepEqual(dimensions, [200, 120])
  await page.evaluate(() => window.publish())
  const editedId = await page.evaluate(() => window.files[0].id)
  // Cancel leaves the existing draft in place without a replacement request.
  const before = await page.evaluate(
    () => window.calls.filter((c) => c.path === '/api/attachments/replace').length,
  )
  await page.evaluate(() => {
    window.operation = window.edit(window.files[0].id)
  })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.working)
  assert.equal(await page.evaluate(() => window.files[0].id), editedId)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.path === '/api/attachments/replace').length,
    ),
    before,
  )
  // Failed replacement preserves the successful prior version.
  await page.evaluate(() => {
    window.failed = true
    window.operation = window.edit(window.files[0].id)
  })
  await editor.getByRole('button', { name: 'Pen', exact: true }).click()
  const b = await canvas.boundingBox()
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Upload rejected' }).waitFor()
  await page.waitForFunction(() => !window.working)
  assert.equal(await page.evaluate(() => window.files[0].id), editedId)
  assert.equal(await page.evaluate(() => window.files.length), 1)
  await page.evaluate(() => {
    window.failed = false
    window.operation = window.capture(window.source)
  })
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.captureBusy && window.rows.length === 2)
  assert.match(await page.evaluate(() => window.rows[1].name), /^screenshot-/)
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Keep draft')
  await page.evaluate(() => {
    window.operation = window.capture(window.source)
  })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.captureBusy)
  assert.equal(await page.evaluate(() => window.rows.length), 2)
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.capture('https://external.test/image.png')
        return false
      } catch {
        return true
      }
    }),
    true,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Image attachments: real desktop editor uploads, cropped replacement before snapshot acknowledgement, cancel, failed replacement, screenshot edit/attach/cancel, input validation and draft preservation passed.',
  )
} finally {
  await browser.close()
}
