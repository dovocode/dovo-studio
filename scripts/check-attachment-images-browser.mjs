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
import {createRoot} from 'react-dom/client';import {useAttachments} from './src/chat/composer/use-attachments';import {optimizeAttachmentImage} from './src/chat/composer/attachment-images';
window.optimize=optimizeAttachmentImage;window.uploads=[];window.connected=true;window.request=async(path,input)=>{window.uploads.push({path,input});return {revision:1,attachment:{id:input.id,name:input.name,mime:input.name.endsWith('.webp')?'image/webp':'application/octet-stream',size:atob(input.data).length}}};
function App(){const attachments=useAttachments({id:'task',draftAttachments:[]});window.upload=attachments.upload;return <><textarea aria-label="Message" defaultValue="Keep draft"/><div role="alert">{attachments.error}</div><div role="status">{attachments.busy?'Working':'Ready'}</div></>};createRoot(document.getElementById('app')).render(<App/>);`,
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
      path: './image-editor',
      importer: resolveDir,
      contents: `export const useImageEditor=()=>({edit:async file=>file,editor:null});`,
    },
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export const useWorkspace=()=>({request:window.request,connected:true,snapshot:undefined});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.upload)
  const results = await page.evaluate(async () => {
    const source = document.createElement('canvas')
    source.width = 4096
    source.height = 2048
    const context = source.getContext('2d')
    context.fillStyle = '#ef4444'
    context.fillRect(0, 0, source.width / 2, source.height)
    const png = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
    // Valid image with trailing bytes models an oversized camera/pasted image.
    const large = new File([png, new Uint8Array(6 * 1024 * 1024)], 'transparent.png', {
      type: 'image/png',
    })
    const optimized = await window.optimize(large)
    const bitmap = await createImageBitmap(optimized)
    const sample = document.createElement('canvas')
    sample.width = bitmap.width
    sample.height = bitmap.height
    const sampleContext = sample.getContext('2d')
    sampleContext.drawImage(bitmap, 0, 0)
    const result = {
      sourceBytes: large.size,
      size: optimized.size,
      name: optimized.name,
      type: optimized.type,
      width: bitmap.width,
      height: bitmap.height,
      alpha: sampleContext.getImageData(bitmap.width - 1, 0, 1, 1).data[3],
    }
    bitmap.close()
    source.width = 32
    source.height = 16
    const small = new File(
      [await new Promise((resolve) => source.toBlob(resolve, 'image/png'))],
      'small.png',
      { type: 'image/png' },
    )
    result.smallUnchanged = (await window.optimize(small)) === small
    const gif = new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
    result.gifUnchanged = (await window.optimize(gif)) === gif
    const webpBytes = new Uint8Array(21)
    webpBytes.set(new TextEncoder().encode('RIFF'), 0)
    webpBytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
    webpBytes[20] = 2
    const animation = new File([webpBytes], 'animation.webp', { type: 'image/webp' })
    result.webpUnchanged = (await window.optimize(animation)) === animation
    const apngBytes = new Uint8Array(20)
    apngBytes.set(new TextEncoder().encode('acTL'), 12)
    const apng = new File([apngBytes], 'animation.png', { type: 'image/png' })
    result.apngUnchanged = (await window.optimize(apng)) === apng
    await window.upload([
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'too-large.pdf'),
      large,
      new File([new Uint8Array(5 * 1024 * 1024)], 'boundary.txt'),
    ])
    return result
  })
  assert.ok(results.sourceBytes > 5 * 1024 * 1024)
  assert.ok(results.size <= 3_750_000)
  assert.equal(results.name, 'transparent.webp')
  assert.equal(results.type, 'image/webp')
  assert.equal(results.width, 2048)
  assert.equal(results.height, 1024)
  assert.equal(results.alpha, 0)
  assert.equal(results.smallUnchanged, true)
  assert.equal(results.gifUnchanged, true)
  assert.equal(results.webpUnchanged, true)
  assert.equal(results.apngUnchanged, true)
  await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
  await page
    .getByRole('alert')
    .filter({ hasText: 'too-large.pdf: must be 5 MB or smaller' })
    .waitFor()
  assert.deepEqual(await page.evaluate(() => window.uploads.map((x) => x.input.name)), [
    'transparent.webp',
    'boundary.txt',
  ])
  assert.equal(await page.getByLabel('Message').inputValue(), 'Keep draft')
  await page.evaluate(async () => {
    await window.upload([
      new File(['not an image'], 'broken.png', { type: 'image/png' }),
      new File(['valid'], 'valid.txt'),
    ])
  })
  await page.getByRole('alert').filter({ hasText: 'Could not decode this image' }).waitFor()
  assert.equal(await page.evaluate(() => window.uploads.at(-1).input.name), 'valid.txt')
  assert.deepEqual(errors, [])
  console.log(
    'Attachment image browser checks passed: oversized image optimization, proportional resize, transparency, small-file and animation preservation, mixed batches, 5 MB boundary and decode errors.',
  )
} finally {
  await browser.close()
}
