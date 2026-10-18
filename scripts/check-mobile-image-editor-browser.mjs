import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const mobile = root + 'apps/mobile'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useAttachmentPicker} from './src/tasks/composer/attachment-picker';
window.data={};window.deleted=[];window.calls=[];window.rows=[];window.stored={};window.fail=false;
window.request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/read')return window.stored[input.id];if(window.fail)throw Error('Mobile upload rejected');const attachment={id:input.id,name:input.name,mime:input.name.endsWith('.png')?'image/png':'application/octet-stream',size:atob(input.data).length};window.stored[input.id]={attachment,data:input.data};window.rows=input.replaceId?window.rows.map(f=>f.id===input.replaceId?attachment:f):[...window.rows,attachment];return {attachment,revision:1}};
function App(){const picker=useAttachmentPicker('task');window.upload=picker.upload;window.edit=picker.edit;window.busy=picker.busy;return <>{picker.editor}<div role="alert">{picker.error}</div><textarea aria-label="Message" defaultValue="Keep mobile draft"/></>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
  },
  [
    {
      path: './optimize-attachment-image',
      importer: mobile,
      contents: `export const optimizeAttachmentImage=async asset=>asset;`,
    },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,snapshot:{workspace:{tasks:[{id:'task',draftAttachments:window.rows}]}},callEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error})});`,
    },
    {
      path: '../../ui/controls/use-action',
      importer: mobile,
      contents: `import {useState} from 'react';import {runClientEffect} from '@dovo/client-runtime';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const run=async work=>{setBusy(true);setError('');try{await runClientEffect(work())}catch(error){setError(error.message)}finally{setBusy(false)}};return {busy,error,run,act:work=>{void run(work)}}}`,
    },
    {
      path: '../../ui/layout/safe-modal',
      importer: mobile,
      contents: `export const SafeModal=({children})=><section>{children}</section>;`,
    },
    {
      path: 'react-native-webview',
      contents: `import {useEffect,useRef} from 'react';export default function WebView({source,onMessage}){const ref=useRef(null);useEffect(()=>{const receive=event=>{if(event.source===ref.current?.contentWindow)onMessage({nativeEvent:{data:JSON.stringify(event.data)}})};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[onMessage]);return <iframe ref={ref} title="Native image editor" sandbox="allow-scripts" style={{width:'100%',height:700,border:0}} srcDoc={source.html}/>}`,
    },
    {
      path: 'expo-file-system',
      contents: `export const Paths={cache:'cache'};export class File{constructor(...parts){this.uri=parts.join('/')}get exists(){return this.uri in window.data}get size(){return atob(window.data[this.uri]??'').length}async bytes(){return Uint8Array.from(atob(window.data[this.uri]),c=>c.charCodeAt(0))}async base64(){return window.data[this.uri]}async write(data){await Promise.resolve();window.data[this.uri]=data}delete(){delete window.data[this.uri];window.deleted.push(this.uri)}}`,
    },
    {
      path: 'expo-crypto',
      contents: `let sequence=0;export const randomUUID=()=> '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');`,
    },
    {
      path: 'react-native',
      contents: `export const Alert={alert(){}};export const Keyboard={dismiss(){}};export const Linking={openSettings:async()=>{}};export const Platform={OS:'ios'};`,
    },
    {
      path: 'expo-image-picker',
      contents: `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;`,
    },
    {
      path: 'expo-document-picker',
      contents: `export const getDocumentAsync=async()=>({canceled:true});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.upload)
  await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 240
    c.getContext('2d').fillRect(0, 0, 400, 240)
    window.data['photo.png'] = c.toDataURL().split(',')[1]
    window.asset = { uri: 'photo.png', name: 'photo.png', mimeType: 'image/png' }
    window.operation = window.upload([window.asset])
  })
  const editor = page.frameLocator('iframe')
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.busy && window.rows.length === 1)
  const originalId = await page.evaluate(() => window.rows[0].id)
  await page.evaluate(() => {
    window.operation = window.edit(window.rows[0].id)
  })
  await editor.getByRole('button', { name: 'Crop', exact: true }).click()
  const box = await editor.locator('canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 10 })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.waitForFunction(
    () => !window.busy && window.calls.some((c) => c.path === '/api/attachments/replace'),
  )
  assert.equal(await page.evaluate(() => window.rows.length), 1)
  assert.notEqual(await page.evaluate(() => window.rows[0].id), originalId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Keep mobile draft',
  )
  const editedId = await page.evaluate(() => window.rows[0].id)
  await page.evaluate(() => {
    window.operation = window.edit(window.rows[0].id)
  })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  assert.equal(await page.evaluate(() => window.rows[0].id), editedId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(() => {
    window.fail = true
    window.operation = window.edit(window.rows[0].id)
  })
  await editor.getByRole('button', { name: 'Pen', exact: true }).click()
  const b = await editor.locator('canvas').boundingBox()
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  await page.getByRole('alert').filter({ hasText: 'Mobile upload rejected' }).waitFor()
  await page.waitForFunction(() => !window.busy)
  assert.equal(await page.evaluate(() => window.rows[0].id), editedId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  assert.deepEqual(errors, [])
  console.log(
    'Mobile image editor: real picker/WebView bridge, initial upload, cropped replacement, asynchronous file writes, cancel/failure preservation and cache cleanup passed.',
  )
} finally {
  await browser.close()
}
