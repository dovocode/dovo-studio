import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mobile = root + '/apps/mobile'
const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const useTheme=()=>({styles:{},colors:{}});`
const result = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {FileDropTarget} from './src/tasks/composer/file-drop-target';import {useAttachmentPicker} from './src/tasks/composer/attachment-picker';import {useState} from 'react';window.uploads=[];window.released=[];window.optimized=[];window.deleted=[];window.imageRefsReleased=0;window.contextsReleased=0;window.alerts=[];window.count=0;function App(){const picker=useAttachmentPicker('task');const [enabled,setEnabled]=useState(true);window.enableDrop=setEnabled;window.uploadAssets=picker.upload;return <FileDropTarget enabled={enabled&&!picker.busy} upload={picker.upload}><textarea aria-label="Message" defaultValue="Keep my draft"/><div role="alert">{picker.error}</div></FileDropTarget>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: mobile + '/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [mobile + '/node_modules', root + '/node_modules'],
  },
  [
    {
      path: './image-editor',
      importer: mobile,
      contents: `export const useImageEditor=()=>({edit:async asset=>asset,editor:null});`,
    },
    {
      path: 'expo',
      contents: `import {useEffect} from 'react';export const requireOptionalNativeModule=()=>({releaseFiles:async uris=>window.released.push(uris)});export const requireNativeView=()=>({children,...props})=>{window.dropProps=props;return <div>{children}</div>};`,
    },
    {
      path: 'react-native',
      contents:
        controls +
        `export const Alert={alert:(...args)=>window.alerts.push(args)};export const Linking={openSettings:async()=>{}};export const Keyboard={dismiss(){}};export const Platform={OS:'ios'};`,
    },
    { path: '../../ui/theme', importer: mobile, contents: controls },
    { path: '../../ui/content/text', importer: mobile, contents: controls },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: `import {Effect} from 'effect';const review=()=>{window.reviews=(window.reviews||0)+1};export const useRuntime=()=>({connected:true,profile:{id:'host',connection:{address:'host',token:'token'}},snapshot:{workspace:{tasks:[{id:'task',draftAttachments:Array.from({length:window.count},()=>({id:'old'}))}]}},reviewAttachments:review,readRuntimeEffect:(_profile,path,input)=>Effect.try({try:()=>{window.serverGuard??='guard-0';if(path.endsWith('draft-guard')){window.guardReads=(window.guardReads||0)+1;return {guard:window.serverGuard}}window.commits=(window.commits||[]).concat(input);if(window.failCommit)throw Error('commit response lost');if(input.guard!==window.serverGuard)throw Error('draft changed');const nextGuard='guard-'+window.commits.length;window.serverGuard=nextGuard;if(window.changeAfterCommit){window.changeAfterCommit=false;window.serverGuard='new-draft'}return {attachment:{id:input.id,name:'file',mime:'text/plain',size:10},revision:1,nextGuard}},catch:error=>error}),refreshRuntimeEffect:()=>Effect.void,finishAttachmentEffect:()=>Effect.sync(()=>{window.finished=(window.finished||0)+1}),requestAttachmentEffect:(_profile,input)=>Effect.sync(()=>{window.uploads.push({path:'/api/attachments/recoverable-upload',input});return {attachment:{id:input.id,name:input.name,mime:'text/plain',size:10},revision:1}})});`,
    },
    {
      path: '../../ui/controls/use-action',
      importer: mobile,
      contents: `import {useState} from 'react';import {runClientEffect} from '@dovo/client-runtime';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const run=async work=>{setBusy(true);setError('');try{await runClientEffect(work())}catch(error){setError(error.message)}finally{setBusy(false)}};return {busy,error,run,act:work=>{void run(work)}}}`,
    },
    {
      path: 'expo-file-system',
      contents: `export const Paths={cache:'file:///cache'};export class File{constructor(uri){this.uri=uri;this.size=uri.includes('large-image')?8*1024*1024:uri.includes('large')?5*1024*1024+1:uri.includes('boundary')?5*1024*1024:10}async bytes(){return new Uint8Array(20)}async base64(){return btoa(this.uri)}delete(){window.deleted.push(this.uri)}}`,
    },
    {
      path: 'expo-clipboard',
      contents: `export const getImageAsync=async()=>{throw new Error('Unexpected clipboard read in file drop fixture')};`,
    },
    { path: 'expo-crypto', contents: `export const randomUUID=()=>crypto.randomUUID();` },
    {
      path: 'expo-image-picker',
      contents: `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true,assets:[]});export const launchImageLibraryAsync=launchCameraAsync;`,
    },
    {
      path: 'expo-document-picker',
      contents: `export const getDocumentAsync=async()=>({canceled:true,assets:[]});`,
    },
    {
      path: 'expo-image-manipulator',
      contents: `export const SaveFormat={JPEG:'jpeg',WEBP:'webp'};export const ImageManipulator={manipulate(uri){let size=uri.includes('large-image')||uri.includes('heic')?{width:4096,height:2048}:{width:100,height:50};const context={reset(){return context},resize(next){size=next;return context},async renderAsync(){return {...size,release(){window.imageRefsReleased++},async saveAsync(options){const result={uri:'file:///cache/optimized-'+window.optimized.length,...size,...options};window.optimized.push(result);return result}}},release(){window.contextsReleased++}};return context}};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://file-drop.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://file-drop.test/')
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.waitForFunction(() => window.dropProps)
  await page.evaluate(() => window.dropProps.onDropActive({ nativeEvent: { active: true } }))
  await page.getByText('Drop files to attach', { exact: true }).waitFor()
  const drop = async (files) =>
    page.evaluate((files) => window.dropProps.onFilesDropped({ nativeEvent: { files } }), files)
  await drop([
    { uri: 'file:///cache/dovo-file-drops/a', name: 'notes.txt' },
    { uri: 'file:///cache/dovo-file-drops/b', name: 'shot.png', mimeType: 'image/png' },
  ])
  await page.waitForFunction(() => window.released.length === 1)
  assert.deepEqual(await page.evaluate(() => window.uploads.map((call) => call.input.name)), [
    'notes.txt',
    'shot.png',
  ])
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Keep my draft')
  assert.equal(
    (await page.evaluate(() => window.uploads[0])).path,
    '/api/attachments/recoverable-upload',
  )
  assert.equal((await page.evaluate(() => window.uploads[0])).input.detached, true)
  assert.equal(await page.evaluate(() => window.commits.length), 2)
  assert.deepEqual(await page.evaluate(() => window.alerts), [])
  await drop([
    { uri: 'file:///cache/dovo-file-drops/large', name: 'large.pdf' },
    { uri: 'file:///cache/dovo-file-drops/large-image', name: 'large.png', mimeType: 'image/png' },
    { uri: 'file:///cache/dovo-file-drops/heic', name: 'photo.HEIC', mimeType: 'image/heic' },
    { uri: 'file:///cache/dovo-file-drops/boundary', name: 'boundary.txt' },
  ])
  await page.waitForFunction(() => window.released.length === 2)
  await page.getByRole('alert').filter({ hasText: 'larger than 5 MB' }).waitFor()
  assert.equal(await page.evaluate(() => window.uploads.length), 5)
  assert.deepEqual(
    await page.evaluate(() => window.uploads.slice(2).map((call) => call.input.name)),
    ['large.webp', 'photo.jpg', 'boundary.txt'],
  )
  assert.deepEqual(
    await page.evaluate(() =>
      window.optimized.map((image) => [image.width, image.height, image.format]),
    ),
    [
      [2048, 1024, 'webp'],
      [2048, 1024, 'jpeg'],
    ],
  )
  assert.equal(await page.evaluate(() => window.deleted.length), 2)
  assert.equal(await page.evaluate(() => window.contextsReleased), 3)
  assert.equal(await page.evaluate(() => window.imageRefsReleased), 5)
  await page.evaluate(() => {
    window.count = 5
    window.enableDrop(false)
  })
  await drop([{ uri: 'file:///cache/dovo-file-drops/c', name: 'blocked.txt' }])
  await page.waitForFunction(() => window.released.length === 3)
  assert.equal(await page.evaluate(() => window.uploads.length), 5)
  await page.evaluate(() => window.enableDrop(true))
  await drop([{ uri: 'file:///cache/dovo-file-drops/d', name: 'sixth.txt' }])
  await page.waitForFunction(() => window.released.length === 4)
  await page.getByRole('alert').filter({ hasText: 'up to 5 files' }).waitFor()
  assert.equal(await page.evaluate(() => window.uploads.length), 5)
  await page.evaluate(() => {
    window.count = 0
    window.failCommit = true
    window.enableDrop(false)
    window.enableDrop(true)
  })
  await page.evaluate(() =>
    window.uploadAssets([
      { uri: 'file:///lost', name: 'lost.txt' },
      { uri: 'file:///after-lost', name: 'after-lost.txt' },
    ]),
  )
  assert.equal(await page.evaluate(() => window.uploads.length), 6)
  assert.equal(await page.evaluate(() => window.commits.length), 6)
  assert.equal(await page.evaluate(() => window.finished), 5)
  assert.ok(await page.evaluate(() => window.reviews > 0))
  assert.equal(await page.evaluate(() => window.alerts.at(-1)[0]), 'Attachments saved for review')
  const beforeBatch = await page.evaluate(() => ({
    uploads: window.uploads.length,
    commits: window.commits.length,
    reads: window.guardReads,
    finished: window.finished,
  }))
  await page.evaluate(() => {
    window.failCommit = false
    window.changeAfterCommit = true
  })
  await page.evaluate(() =>
    window.uploadAssets([
      { uri: 'file:///batch-one', name: 'one.txt' },
      { uri: 'file:///batch-two', name: 'two.txt' },
      { uri: 'file:///batch-three', name: 'three.txt' },
    ]),
  )
  assert.equal(await page.evaluate(() => window.guardReads), beforeBatch.reads + 1)
  assert.deepEqual(
    await page.evaluate(
      (start) => window.uploads.slice(start).map((item) => item.input.name),
      beforeBatch.uploads,
    ),
    ['one.txt', 'two.txt'],
  )
  assert.equal(await page.evaluate(() => window.commits.length), beforeBatch.commits + 2)
  assert.equal(await page.evaluate(() => window.finished), beforeBatch.finished + 1)
  await page.getByRole('alert').filter({ hasText: 'three.txt: not uploaded' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile native-drop boundary: ordered uploads, draft preservation, size/count limits, disabled composer and temporary-file cleanup passed',
  )
} finally {
  await browser.close()
}
