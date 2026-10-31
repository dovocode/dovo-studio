import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const temporary = await mkdtemp(join(tmpdir(), 'dovo-pdf-continuity-'))
const output = join(temporary, 'viewer.mjs')
await build({
  entryPoints: ['packages/runtime/src/http/endpoints/pdf-preview.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'error-stub',
      setup(build) {
        build.onResolve({ filter: /errors\.js$/ }, () => ({ path: 'errors', namespace: 'stub' }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export class HttpError extends Error {}',
        }))
      },
    },
  ],
})
const { pdfPreviewHTML } = await import(pathToFileURL(output))
const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))
const desktopFile = join(root, 'packages/extension-tasks/src/chat/thread/task-message-response.tsx')
const mobileFile = join(root, 'apps/mobile/src/ui/content/rich-file.tsx')
const mocks = {
  '@dovo/protocol': `export {parsePdfViewerMessage} from '${root}/packages/protocol/src/conversation/pdf-view-state.ts';export const createRuntimeClient=c=>({url:p=>new URL(p,c.address).href});export const taskFileShareSchema={},taskImageReadSchema={};export const randomUUID=()=>crypto.randomUUID();export const localMarkdownPath=p=>p,markdownFileName=p=>p.split('/').pop(),artifactTemplatePrompt=()=>'',richMarkdown=()=>[],cachedMarkdownParts=()=>()=>[];`,
  '@dovo/studio-core/repository-open': 'export const useRepositoryOpen=()=>()=>{};',
  '@dovo/studio-core':
    'export const useWorkspace=()=>window.runtime;export const useStudioHost=()=>({});',
  '@dovo/studio-ui': `export const MessageResponse=()=>null,FileTypeIcon=()=>null,RepositoryOpenItems=()=>null,DropdownMenu={};export const Button=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;export const Dialog=({children})=><div>{children}</div>,DialogContent=({children})=><div>{children}</div>,DialogTitle=({children})=><h1>{children}</h1>;`,
  './task-visualization': 'export const TaskVisualization=()=>null;',
  '../composer/chat-image-edit-context': 'export const EditChatImage=()=>null;',
  'react-native': `export const Alert={alert:()=>{}},AppState={currentState:'active'};export const View=({children})=><div>{children}</div>,Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;`,
  'react-native-webview': `import {forwardRef,useRef,useEffect,useImperativeHandle} from 'react';export default forwardRef(function WebView(props,ref){const frame=useRef();window.nativeProps=props;useImperativeHandle(ref,()=>({injectJavaScript:script=>frame.current?.contentWindow?.eval(script)}));useEffect(()=>{const receive=event=>{if(event.source===frame.current?.contentWindow&&event.data?.nativeData)props.onMessage?.({nativeEvent:{url:frame.current.src,data:event.data.nativeData}})};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[props]);return <iframe title="Native PDF" ref={frame} src={props.source.uri} style={{width:600,height:400}} onLoad={()=>props.onLoad?.({nativeEvent:{url:frame.current.src}})}/>});`,
  'expo-crypto': 'export const randomUUID=()=>crypto.randomUUID();',
  '../../runtime/connection/provider': 'export const useRuntime=()=>window.runtime;',
  '../theme': 'export const useTheme=()=>({colors:{surface:"white"},styles:{muted:{}}});',
  '../controls/action':
    'export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
  './text': 'export const Text=({children})=><span>{children}</span>;',
  './file-tree': 'export const MobileFileTypeIcon=()=>null;',
  '../layout/sheet': 'export const Sheet=({children})=><div>{children}</div>;',
  './open-link': 'export const openAppLink=async()=>{};',
  'expo-clipboard': 'export const setStringAsync=async()=>{};',
}
const hostBundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TaskFileDialog} from '${desktopFile}';import {RichFile} from '${mobileFile}';let grant=0;window.runtime={connected:true,connection:{address:location.origin,token:'device'},request:async()=>{const url='/'+(window.mode==='mobile'?'host-native':'host-desktop')+(++grant);if(window.defer){window.defer=false;await new Promise(resolve=>window.releaseGrant=resolve)}if(window.fail)throw Error('grant failed');return {url}}};window.runtime.read=window.runtime.request;function App(){const [mode,setMode]=useState('desktop'),[path,setPath]=useState('report'),[task,setTask]=useState('task'),[revision,setRevision]=useState(0);window.mode=mode;window.changeMode=setMode;window.changePath=setPath;window.changeTask=setTask;window.changeConnection=()=>{window.runtime.connection={...window.runtime.connection,token:'other-device'};setRevision(revision+1)};return mode==='desktop'?<TaskFileDialog taskId={task} path={path} onClose={()=>{}}/>:<RichFile taskId={task} path={path} label="PDF" previewOnly/>}createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: join(root, 'apps/desktop/node_modules/react'),
    'react-dom': join(root, 'apps/desktop/node_modules/react-dom'),
  },
  plugins: [
    {
      name: 'pdf-host-mocks',
      setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
        build.onLoad({ filter: /task-message-response\.tsx$/ }, async ({ path }) => ({
          contents: `${await readFile(path, 'utf8')}\nexport { TaskFileDialog };`,
          loader: 'tsx',
          resolveDir: dirname(path),
        }))
      },
    },
  ],
})
function pdf(count) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${count} >>`,
    ...Array.from(
      { length: count },
      () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 900] /Resources << >> >>',
    ),
  ]
  let content = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content))
    content += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(content)
  return Buffer.from(
    `${content}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  )
}
let pages = 2
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.searchParams.has('pdfjs')) {
      const name = url.searchParams.get('pdfjs') === 'worker' ? 'pdf.worker.mjs' : 'pdf.mjs'
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(require.resolve(`pdfjs-dist/build/${name}`)))
    } else if (url.searchParams.has('content')) {
      response.setHeader('Content-Type', 'application/pdf')
      response.end(pdf(pages))
    } else if (url.pathname === '/host') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><div id="app"></div>')
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(
        `<!doctype html>${url.pathname.startsWith('/host-native') ? `<script>window.ReactNativeWebView={postMessage:data=>parent.postMessage({nativeData:data},'*')}</script>` : ''}<style>body{margin:0}canvas{display:block}nav{height:60px}</style>${pdfPreviewHTML('test', url.pathname)}`,
      )
    }
  } catch (error) {
    response.statusCode = 500
    response.end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 700, height: 500 } })
  await page.setContent('<iframe style="width:600px;height:400px"></iframe>')
  await page.evaluate(
    ({ origin, id }) => {
      window.saved = null
      window.expected = id
      const frame = document.querySelector('iframe')
      window.addEventListener('message', (event) => {
        if (
          event.source !== frame.contentWindow ||
          event.origin !== origin ||
          event.data?.channel !== 'dovo-pdf' ||
          event.data.id !== window.expected
        )
          return
        if (event.data.type === 'ready')
          frame.contentWindow.postMessage(
            { channel: 'dovo-pdf', id: window.expected, type: 'restore', state: window.saved },
            origin,
          )
        if (event.data.type === 'state') window.saved = event.data.state
      })
      frame.src = `${origin}/grant-one#dovo-pdf=${id}`
    },
    { origin, id: ids[0] },
  )
  const frame = page.frameLocator('iframe')
  await frame.getByText('Page 1 of 2', { exact: true }).waitFor()
  await frame.getByRole('button', { name: 'Next' }).click()
  await frame.getByText('Page 2 of 2', { exact: true }).waitFor()
  await frame.getByRole('button', { name: 'Zoom in' }).click()
  await page.waitForFunction(() => window.saved?.zoom === 1.25)
  await frame.locator('canvas').evaluate(() => window.scrollTo(0, 200))
  await page.waitForFunction(() => window.saved?.scrollTop === 200)
  await page.evaluate(
    ({ origin, id }) => {
      window.expected = id
      document.querySelector('iframe').src = `${origin}/grant-two#dovo-pdf=${id}`
    },
    { origin, id: ids[1] },
  )
  await frame.getByText('Page 2 of 2', { exact: true }).waitFor()
  await page.waitForFunction(
    () => window.saved?.page === 2 && window.saved.zoom === 1.25 && window.saved.scrollTop === 200,
  )
  await page.evaluate(
    (id) =>
      window.postMessage(
        {
          channel: 'dovo-pdf',
          id,
          type: 'state',
          state: { page: 99, zoom: 1, scrollTop: 0, scrollLeft: 0 },
        },
        '*',
      ),
    ids[1],
  )
  assert.equal((await page.evaluate(() => window.saved)).page, 2)
  pages = 1
  await page.evaluate(
    ({ origin, id }) => {
      window.expected = id
      document.querySelector('iframe').src = `${origin}/grant-three#dovo-pdf=${id}`
    },
    { origin, id: ids[2] },
  )
  await frame.getByText('Page 1 of 1', { exact: true }).waitFor()
  await page.waitForFunction(() => window.saved?.page === 1 && window.saved.zoom === 1.25)
  pages = 2
  await page.evaluate(
    ({ origin, id }) => {
      window.saved = null
      window.expected = id
      document.querySelector('iframe').src = `${origin}/different-file#dovo-pdf=${id}`
    },
    { origin, id: ids[0] },
  )
  await frame.getByText('Page 1 of 2', { exact: true }).waitFor()
  await page.waitForFunction(() => window.saved?.page === 1 && window.saved.zoom === 1)

  const native = await browser.newPage({ viewport: { width: 390, height: 500 } })
  let saved = { page: 2, zoom: 1.25, scrollTop: 100, scrollLeft: 0 }
  let expectedId = ids[0]
  let receivedScroll
  pages = 2
  await native.exposeBinding('nativeMessage', async (_, raw) => {
    const message = JSON.parse(raw)
    if (message.id !== expectedId || message.channel !== 'dovo-pdf') return
    if (message.type === 'ready')
      await native.evaluate(
        ({ state, id }) =>
          window.postMessage(
            {
              channel: 'dovo-pdf',
              id,
              type: 'restore',
              state,
            },
            '*',
          ),
        { state: saved, id: expectedId },
      )
    if (message.type === 'state') {
      saved = message.state
      if (saved.scrollTop === 180) receivedScroll?.()
    }
  })
  await native.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: (message) => window.nativeMessage(message) }
  })
  await native.goto(`${origin}/native-grant#dovo-pdf=${ids[0]}`)
  await native.getByText('Page 2 of 2', { exact: true }).waitFor()
  await native.waitForFunction(() => window.scrollY === 100)
  assert.equal(saved.page, 2)
  assert.equal(saved.zoom, 1.25)
  const scrollCaptured = new Promise((resolve) => {
    receivedScroll = resolve
  })
  await native.evaluate(() => window.scrollTo(0, 180))
  await native.waitForFunction(() => window.scrollY === 180)
  await scrollCaptured
  assert.equal(saved.scrollTop, 180)
  expectedId = ids[1]
  await native.goto(`${origin}/native-recovery#dovo-pdf=${ids[1]}`)
  await native.getByText('Page 2 of 2', { exact: true }).waitFor()
  await native.waitForFunction(() => window.scrollY === 180)
  const direct = await browser.newPage()
  await direct.goto(`${origin}/direct`)
  await direct.getByText('Page 1 of 2', { exact: true }).waitFor()
  await direct.goto(`${origin}/copied-frame#dovo-pdf=${ids[0]}`)
  await direct.getByText('Page 1 of 2', { exact: true }).waitFor()
  await direct.getByRole('button', { name: 'Next' }).click()
  await direct.getByText('Page 2 of 2', { exact: true }).waitFor()
  const delayed = await browser.newPage({ viewport: { width: 700, height: 500 } })
  await delayed.setContent('<iframe style="width:600px;height:400px"></iframe>')
  await delayed.evaluate(() => {
    window.messages = []
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'dovo-pdf') window.messages.push(event.data)
    })
  })
  const loadedContent = delayed.waitForResponse(
    (response) => response.url() === `${origin}/delayed?content=1`,
  )
  await delayed.evaluate(
    ({ origin, id }) => {
      document.querySelector('iframe').src = `${origin}/delayed#dovo-pdf=${id}`
    },
    { origin, id: ids[0] },
  )
  await loadedContent
  await delayed.waitForFunction(() => window.messages.some((message) => message.type === 'ready'))
  const delayedViewer = delayed.frameLocator('iframe')
  await delayedViewer.getByRole('button', { name: 'Next' }).click()
  await delayedViewer.getByRole('button', { name: 'Zoom in' }).click()
  await delayed.setViewportSize({ width: 720, height: 500 })
  await delayed.waitForTimeout(250)
  assert.equal(await delayedViewer.locator('#page').textContent(), 'Loading PDF…')
  assert.equal(
    await delayed.evaluate(
      () => window.messages.filter((message) => message.type === 'state').length,
    ),
    0,
  )
  await delayed.evaluate(
    ({ origin, id }) =>
      document.querySelector('iframe').contentWindow.postMessage(
        {
          channel: 'dovo-pdf',
          id,
          type: 'restore',
          state: { page: 2, zoom: 1.25, scrollTop: 120, scrollLeft: 0 },
        },
        origin,
      ),
    { origin, id: ids[0] },
  )
  await delayedViewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await delayed.waitForFunction(() =>
    window.messages.some(
      (message) =>
        message.type === 'state' &&
        message.state.page === 2 &&
        message.state.zoom === 1.25 &&
        message.state.scrollTop === 120,
    ),
  )
  const hosts = await browser.newPage({ viewport: { width: 800, height: 600 } })
  hosts.setDefaultTimeout(5000)
  await hosts.goto(`${origin}/host`)
  await hosts.addScriptTag({ content: hostBundle.outputFiles[0].text })
  let viewer = hosts.frameLocator('iframe')
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Next' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Zoom in' }).click()
  await hosts.evaluate(() => {
    window.lastPdfState = null
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'dovo-pdf' && event.data.type === 'state')
        window.lastPdfState = event.data.state
      if (event.data?.nativeData) {
        const message = JSON.parse(event.data.nativeData)
        if (message.type === 'state') window.lastPdfState = message.state
      }
    })
  })
  await viewer.locator('canvas').evaluate(() => window.scrollTo(0, 180))
  await hosts.waitForFunction(
    () =>
      window.lastPdfState?.page === 2 &&
      window.lastPdfState.zoom === 1.25 &&
      window.lastPdfState.scrollTop === 180,
  )
  await hosts.evaluate(() => {
    const frame = document.querySelector('iframe')
    const id = new URL(frame.src).hash.slice('#dovo-pdf='.length)
    const data = {
      channel: 'dovo-pdf',
      id,
      type: 'state',
      state: { page: 1, zoom: 1, scrollTop: 0, scrollLeft: 0 },
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'http://attacker.invalid',
        data,
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', { source: window, origin: location.origin, data }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: location.origin,
        data: { ...data, id: 'old-bridge' },
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: location.origin,
        data: { ...data, state: { ...data.state, page: 0 } },
      }),
    )
    window.fail = true
  })
  await hosts.getByRole('button', { name: 'Refresh preview' }).click()
  await hosts.getByText('grant failed').waitFor()
  await hosts.evaluate(() => {
    window.fail = false
  })
  await hosts.getByRole('button', { name: 'Retry preview' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(() => {
    const frame = document.querySelector('iframe')
    return frame?.contentWindow?.scrollY === 180
  })
  await hosts.evaluate(() => window.changePath('other'))
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () => window.lastPdfState?.page === 1 && window.lastPdfState.zoom === 1,
  )
  await hosts.evaluate(() => {
    window.defer = true
  })
  await hosts.getByRole('button', { name: 'Refresh preview' }).click()
  await hosts.waitForFunction(() => typeof window.releaseGrant === 'function')
  await hosts.evaluate(() => window.changePath('newer'))
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  const newGrant = await hosts.locator('iframe').getAttribute('src')
  await hosts.evaluate(() => window.releaseGrant())
  await hosts.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await hosts.locator('iframe').getAttribute('src'), newGrant)

  await hosts.evaluate(() => window.changeMode('mobile'))
  viewer = hosts.frameLocator('iframe')
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Next' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Zoom in' }).click()
  await viewer.locator('canvas').evaluate(() => window.scrollTo(0, 160))
  await hosts.waitForFunction(
    () =>
      window.lastPdfState?.page === 2 &&
      window.lastPdfState.zoom === 1.25 &&
      window.lastPdfState.scrollTop === 160,
  )
  await hosts.evaluate(() => {
    const props = window.nativeProps
    window.oldNativeProps = props
    const id = new URL(props.source.uri).hash.slice('#dovo-pdf='.length)
    props.onMessage({
      nativeEvent: {
        url: 'http://attacker.invalid/',
        data: JSON.stringify({
          channel: 'dovo-pdf',
          id,
          type: 'state',
          state: { page: 1, zoom: 1, scrollTop: 0, scrollLeft: 0 },
        }),
      },
    })
    props.onMessage({
      nativeEvent: {
        url: props.source.uri,
        data: JSON.stringify({
          channel: 'dovo-pdf',
          id,
          type: 'state',
          state: { page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 },
        }),
      },
    })
    props.onMessage({
      nativeEvent: {
        url: props.source.uri,
        data: JSON.stringify({
          channel: 'dovo-pdf',
          id: 'old-bridge',
          type: 'state',
          state: { page: 1, zoom: 1, scrollTop: 0, scrollLeft: 0 },
        }),
      },
    })
    window.lastPdfState = null
    props.onContentProcessDidTerminate()
  })
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () => document.querySelector('iframe')?.contentWindow?.scrollY === 160,
  )
  await hosts.waitForFunction(
    () => window.lastPdfState?.page === 2 && window.lastPdfState.zoom === 1.25,
  )
  await hosts.evaluate(() => {
    const props = window.oldNativeProps
    const id = new URL(props.source.uri).hash.slice('#dovo-pdf='.length)
    props.onMessage({
      nativeEvent: {
        url: props.source.uri,
        data: JSON.stringify({
          channel: 'dovo-pdf',
          id,
          type: 'state',
          state: { page: 1, zoom: 1, scrollTop: 0, scrollLeft: 0 },
        }),
      },
    })
    window.lastPdfState = null
  })
  await hosts.getByRole('button', { name: 'Refresh preview' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () =>
      window.lastPdfState?.page === 2 &&
      window.lastPdfState.zoom === 1.25 &&
      window.lastPdfState.scrollTop === 160,
  )
  await hosts.evaluate(() => window.changePath('third.pdf'))
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () => window.lastPdfState?.page === 1 && window.lastPdfState.zoom === 1,
  )
  await viewer.getByRole('button', { name: 'Next' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(() => window.lastPdfState?.page === 2)
  await hosts.evaluate(() => {
    window.lastPdfState = null
    window.changeTask('another-task')
  })
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () => window.lastPdfState?.page === 1 && window.lastPdfState.zoom === 1,
  )
  await viewer.getByRole('button', { name: 'Next' }).click()
  await viewer.getByText('Page 2 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(() => window.lastPdfState?.page === 2)
  await hosts.evaluate(() => {
    window.lastPdfState = null
    window.changeConnection()
  })
  await viewer.getByText('Page 1 of 2', { exact: true }).waitFor()
  await hosts.waitForFunction(
    () => window.lastPdfState?.page === 1 && window.lastPdfState.zoom === 1,
  )
  console.log('PDF viewer, desktop host refresh/retry, and simulated native host recovery passed')
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
