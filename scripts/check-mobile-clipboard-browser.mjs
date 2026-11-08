import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const stubs = [
  {
    path: 'react-native',
    contents: `export const Alert={alert:(...args)=>window.alerts.push(args)};export const Keyboard={dismiss(){}};export const Linking={openSettings(){}};export const Platform={OS:'ios'};`,
  },
  {
    path: 'expo-image-picker',
    contents: `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;`,
  },
  {
    path: 'expo-document-picker',
    contents: `export const getDocumentAsync=async()=>({canceled:true});`,
  },
  {
    path: 'expo-clipboard',
    contents: `export const getImageAsync=()=>new Promise((resolve,reject)=>{window.clipboard={resolve,reject}});`,
  },
  { path: 'expo-crypto', contents: `let id=0;export const randomUUID=()=>String(++id);` },
  {
    path: 'expo-file-system',
    contents: `const files=new Map();export const Paths={cache:'cache'};export class File{constructor(parent,name){this.uri=name?'file://'+name:parent}get exists(){return files.has(this.uri)}get size(){return files.get(this.uri)?.length??0}write(data){window.writes.push(this.uri);files.set(this.uri,data)}base64(){return Promise.resolve(files.get(this.uri))}delete(){files.delete(this.uri)}}`,
  },
  {
    path: './image-editor',
    importer: mobile,
    contents: `export const useImageEditor=()=>({edit:async asset=>asset,editor:null});`,
  },
  {
    path: './optimize-attachment-image',
    importer: mobile,
    contents: `export const optimizeAttachmentImage=async asset=>asset;`,
  },
  {
    path: '../../runtime/connection/provider',
    importer: mobile,
    contents: `export const useRuntime=()=>window.runtime;`,
  },
  {
    path: '../../runtime/state/application-state',
    importer: mobile,
    contents: `export {useState as useApplicationState} from 'react';`,
  },
  {
    path: '@dovo/client-runtime',
    contents: `import {Effect} from 'effect';export const runClientEffect=effect=>Effect.runPromise(effect);`,
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {useAttachmentPicker} from './src/tasks/composer/attachment-picker';
window.uploads=[];window.commits=[];window.edits=[];window.alerts=[];window.writes=[];window.reviews=[];window.guard='draft-a';window.clipboard=null;
const reviewAttachments=profile=>window.reviews.push(profile.id);
function App(){const[owner,setOwner]=useState({task:'task-a',runtime:'runtime-a',edit:null});window.owner=owner;window.changeOwner=patch=>setOwner(value=>({...value,...patch}));
 const profile={id:owner.runtime,connection:{address:'http://lan',token:owner.runtime}};
 window.runtime={connected:true,profile,snapshot:{workspace:{tasks:[{id:owner.task,draftAttachments:[]}]}},reviewAttachments,
 readRuntimeEffect:(_profile,path,input)=>Effect.sync(()=>{if(path.endsWith('draft-guard'))return {guard:window.guard};window.commits.push(input);if(input.guard!==window.guard)throw Error('stale draft');return {nextGuard:window.guard}}),
 requestAttachmentEffect:(_profile,input)=>Effect.sync(()=>{window.uploads.push(input);return {attachment:{id:input.id,name:input.name,mime:'image/png',size:1}}}),refreshRuntimeEffect:()=>Effect.void,finishAttachmentEffect:()=>Effect.void,callEffect:()=>Effect.void};
 const editing=owner.edit?{messageId:owner.edit,files:[],uploaded:file=>{window.edits.push(file);return true}}:undefined;
 const picker=useAttachmentPicker(owner.task,editing);window.picker=picker;
 return <><button onClick={picker.pasteImage}>Paste</button><button disabled={picker.busy}>Send</button><output aria-label="busy">{String(picker.busy)}</output><output aria-label="error">{picker.error}</output></>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: mobile + 'node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [mobile + 'node_modules'],
  },
  stubs,
)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const reset = async () => {
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Paste' }).waitFor()
  }
  const begin = async () => {
    await page.getByRole('button', { name: 'Paste' }).click()
    await page.waitForFunction(() => !!window.clipboard)
    assert.equal(await page.getByRole('button', { name: 'Send' }).isDisabled(), true)
    assert.equal(await page.getByLabel('busy').textContent(), 'true')
  }
  const done = async () => page.waitForFunction(() => !window.picker.busy)
  const image = { data: 'data:image/png;base64,YQ==', size: { width: 1, height: 1 } }

  await reset()
  await begin()
  await page.evaluate((image) => window.clipboard.resolve(image), image)
  await done()
  assert.deepEqual(
    await page.evaluate(() => [window.uploads.length, window.commits.length, window.writes.length]),
    [1, 1, 1],
  )
  assert.equal(await page.getByRole('button', { name: 'Send' }).isEnabled(), true)

  for (const [initial, patch] of [
    [{}, { task: 'task-b' }],
    [{}, { runtime: 'runtime-b' }],
    [{}, { edit: 'edit-b' }],
    [{ edit: 'edit-a' }, { edit: 'edit-b' }],
    [{ edit: 'edit-a' }, { edit: null }],
  ]) {
    await reset()
    await page.evaluate((initial) => window.changeOwner(initial), initial)
    await page.waitForFunction(
      (initial) => Object.entries(initial).every(([key, value]) => window.owner[key] === value),
      initial,
    )
    await begin()
    await page.evaluate((patch) => window.changeOwner(patch), patch)
    await page.waitForFunction(
      (patch) => Object.entries(patch).every(([key, value]) => window.owner[key] === value),
      patch,
    )
    await page.evaluate((image) => window.clipboard.resolve(image), image)
    await done()
    assert.deepEqual(
      await page.evaluate(() => [
        window.uploads.length,
        window.commits.length,
        window.edits.length,
        window.writes.length,
      ]),
      [0, 0, 0, 0],
    )
  }
  for (const failure of ['empty', 'rejected']) {
    await reset()
    await begin()
    await page.evaluate(
      (failure) =>
        failure === 'empty'
          ? window.clipboard.resolve(null)
          : window.clipboard.reject(Error('Clipboard denied')),
      failure,
    )
    await done()
    assert.match(
      await page.getByLabel('error').textContent(),
      failure === 'empty' ? /No image/ : /Clipboard denied/,
    )
    assert.equal(await page.getByRole('button', { name: 'Send' }).isEnabled(), true)
    assert.deepEqual(
      await page.evaluate(() => [window.uploads.length, window.commits.length]),
      [0, 0],
    )
  }
  await reset()
  await begin()
  await page.evaluate((image) => {
    window.guard = 'draft-b'
    window.clipboard.resolve(image)
  }, image)
  await done()
  assert.equal(await page.evaluate(() => window.commits[0].guard), 'draft-a')
  assert.equal(await page.evaluate(() => window.reviews.includes('runtime-a')), true)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile clipboard picker: busy, success, owner changes, failure recovery and stale draft guard passed.',
  )
} finally {
  await browser.close()
}
