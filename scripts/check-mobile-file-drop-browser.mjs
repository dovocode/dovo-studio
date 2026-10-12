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
      contents: `import {createRoot} from 'react-dom/client';import {FileDropTarget} from './src/tasks/composer/file-drop-target';import {useAttachmentPicker} from './src/tasks/composer/attachment-picker';import {useState} from 'react';window.uploads=[];window.released=[];window.alerts=[];window.count=0;function App(){const picker=useAttachmentPicker('task');const [enabled,setEnabled]=useState(true);window.enableDrop=setEnabled;window.uploadAssets=picker.upload;return <FileDropTarget enabled={enabled&&!picker.busy} upload={picker.upload}><textarea aria-label="Message" defaultValue="Keep my draft"/><div role="alert">{picker.error}</div></FileDropTarget>};createRoot(document.getElementById('app')).render(<App/>);`,
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
      contents: `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,snapshot:{workspace:{tasks:[{id:'task',draftAttachments:Array.from({length:window.count},()=>({id:'old'}))}]}},callEffect:(path,input)=>Effect.sync(()=>{window.uploads.push({path,input})})});`,
    },
    {
      path: '../../ui/controls/use-action',
      importer: mobile,
      contents: `import {useState} from 'react';import {runClientEffect} from '@dovo/client-runtime';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const run=async work=>{setBusy(true);setError('');try{await runClientEffect(work())}catch(error){setError(error.message)}finally{setBusy(false)}};return {busy,error,run,act:work=>{void run(work)}}}`,
    },
    {
      path: 'expo-file-system',
      contents: `export class File{constructor(uri){this.uri=uri;this.size=uri.includes('large')?5*1024*1024:10}async base64(){return btoa(this.uri)}delete(){}}`,
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
      contents: `export const SaveFormat={JPEG:'jpeg'};export const ImageManipulator={manipulate(){throw new Error('No HEIC in this fixture')}};`,
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
  assert.equal((await page.evaluate(() => window.uploads[0])).path, '/api/attachments/upload')
  await drop([{ uri: 'file:///cache/dovo-file-drops/large', name: 'large.pdf' }])
  await page.waitForFunction(() => window.released.length === 2)
  await page.getByRole('alert').filter({ hasText: 'larger than 4 MB' }).waitFor()
  assert.equal(await page.evaluate(() => window.uploads.length), 2)
  await page.evaluate(() => {
    window.count = 5
    window.enableDrop(false)
  })
  await drop([{ uri: 'file:///cache/dovo-file-drops/c', name: 'blocked.txt' }])
  await page.waitForFunction(() => window.released.length === 3)
  assert.equal(await page.evaluate(() => window.uploads.length), 2)
  await page.evaluate(() => window.enableDrop(true))
  await drop([{ uri: 'file:///cache/dovo-file-drops/d', name: 'sixth.txt' }])
  await page.waitForFunction(() => window.released.length === 4)
  await page.getByRole('alert').filter({ hasText: 'up to 5 files' }).waitFor()
  assert.equal(await page.evaluate(() => window.uploads.length), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile native-drop boundary: ordered uploads, draft preservation, size/count limits, disabled composer and temporary-file cleanup passed',
  )
} finally {
  await browser.close()
}
