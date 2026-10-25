import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = `${root}/apps/mobile`
const controls = `
export const StyleSheet={hairlineWidth:1};
export const Alert={alert:(title,details)=>{window.alerts=(window.alerts??[]).concat({title,details})}};
export const View=({children})=><div>{children}</div>;
export const ScrollView=View;
export const Glass=View;
export const Icon=()=>null;
export const Image=()=>null;
export const Text=({children})=><span>{children}</span>;
export const useTheme=()=>({mode:window.previewTheme??'dark',colors:{},styles:{}});
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const IconButton=Action;
export const Field=({label,value,onChangeText,inputRef,onFocus,onBlur})=><input ref={inputRef} aria-label={label} value={value} onFocus={onFocus} onBlur={onBlur} onChange={event=>onChangeText(event.target.value)}/>;
export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
`
const stubs = [
  {
    path: './screenshot-attachment',
    importer: mobile,
    contents:
      'export const useScreenshotAttachment=()=>({editor:null,error:"",busy:false,attach:async image=>{window.screenshots=(window.screenshots??[]).concat(image)}});',
  },
  { path: 'react-native-view-shot', contents: 'export const captureRef=async()=>"c2NyZWVu";' },
  {
    path: 'react-native',
    contents: `${controls}
const listeners=new Set();
export const AppState={currentState:'active',addEventListener:(_,notify)=>{listeners.add(notify);return {remove:()=>listeners.delete(notify)}}};
window.appStateListeners=listeners;
window.setAppState=state=>{AppState.currentState=state;for(const notify of listeners)notify(state)};
const keyboardListeners=new Map();
export const Keyboard={isVisible:()=>window.keyboardVisible??false,addListener:(event,notify)=>{if(!keyboardListeners.has(event))keyboardListeners.set(event,new Set());keyboardListeners.get(event).add(notify);return {remove:()=>keyboardListeners.get(event).delete(notify)}}};
window.keyboardListeners=keyboardListeners;
window.setKeyboard=(visible,phase='Will')=>{window.keyboardVisible=visible;for(const notify of keyboardListeners.get('keyboard'+phase+(visible?'Show':'Hide'))??[])notify()};
export const Platform={OS:'ios'};`,
  },
  {
    path: 'react-native-screens/experimental',
    contents: `export const SafeAreaView=({edges,children})=><div data-safe-bottom={String(!!edges.bottom)}>{children}</div>;`,
  },
  {
    path: 'react-native-webview',
    contents: `
import {forwardRef,useEffect,useImperativeHandle,useState} from 'react';
let next=0;
export const WebView=forwardRef((props,ref)=>{
  const [id]=useState(()=>++next);
  window.webViews.set(id,props);
  useImperativeHandle(ref,()=>({
    injectJavaScript:code=>window.commands.push({id,code}),
    reload:()=>window.reloads.push(id),goBack:()=>{},goForward:()=>{}
  }),[]);
  useEffect(()=>{
    window.mounts.push(id);
    if(props.source.html)props.onMessage({nativeEvent:{data:JSON.stringify({channel:'dovo-browser',type:'ready'})}});
    return ()=>{window.webViews.delete(id);window.unmounts.push(id)};
  },[]);
  return <div data-webview={id} data-uri={props.source.uri??'remote'}>WebView</div>;
});`,
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
    path: '../../shell/navigation',
    importer: mobile,
    contents: `export const useNavigation=()=>({focused:window.focused});`,
  },
  ...[
    '../../ui/content/text',
    '../../ui/layout/glass',
    '../../ui/controls/icon',
    '../../ui/controls/action',
    '../../ui/controls/icon-button',
    '../../ui/controls/field',
    '../../ui/controls/choice',
    '../../ui/theme',
  ].map((path) => ({ path, importer: mobile, contents: controls })),
  {
    path: '../../ui/content/open-link',
    importer: mobile,
    contents: `export const openAppLink=async(url,external)=>{window.openedLinks=(window.openedLinks??[]).concat({url,external})};export const useOpenAppLink=()=>openAppLink;`,
  },
  {
    path: '../../screens/device-host-form',
    importer: mobile,
    contents: `export const deviceHostMessage=message=>message;`,
  },
  {
    path: './physical-controls',
    importer: `${mobile}/src/tasks/preview/`,
    contents: `export const PhysicalControls=()=>null;`,
  },
  {
    path: './device-actions',
    importer: `${mobile}/src/tasks/preview/`,
    contents: `export const DeviceActions=()=>null;`,
  },
  { path: 'expo-router', contents: `export const router={push:()=>{}};` },
  {
    path: '@dovo/protocol/browser-viewer',
    contents: `export const remoteBrowserHtml='<html>Native viewer boundary</html>';`,
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Effect} from 'effect';
import {RemoteBrowser} from './src/tasks/preview/remote-browser';
import {BrowserPane,DevicesPane} from './src/tasks/preview/browser-pane';
window.webViews=new Map();window.commands=[];window.mounts=[];window.unmounts=[];window.reloads=[];window.requests=[];window.pending=[];
window.runtime={
  connection:{address:'http://runtime.lan:4310',token:'device-token'},
  profile:{id:'runtime',connection:{address:'http://runtime.lan:4310',token:'device-token'}},
  profiles:[],snapshot:{workspace:{tasks:[]}},connected:true,
  read:async()=>{window.deviceReads=(window.deviceReads??0)+1;return {enabled:false}},
  readEffect:(path,input)=>Effect.tryPromise({try:async()=>{
    const ticket='ticket-'+(window.requests.length+1);
    window.requests.push({path,input,ticket});
    if(window.hold)await new Promise(resolve=>window.pending.push(resolve));
    return {ticket};
  },catch:error=>error}),
};
function App(){
  const [scene,setScene]=useState({surface:'remote',taskId:'task',focused:true,expanded:false});
  window.focused=scene.focused;
  window.setScene=changes=>flushSync(()=>setScene(previous=>({...previous,...changes})));
  return scene.surface==='browser'?<BrowserPane key={scene.taskId} taskId={scene.taskId} expanded={scene.expanded} onExpand={expanded=>window.setScene({expanded})}/>
    :scene.surface==='devices'?<DevicesPane key={scene.taskId} taskId={scene.taskId} expanded={scene.expanded} onExpand={expanded=>window.setScene({expanded})}/>
    :<RemoteBrowser key={scene.surface+scene.taskId} taskId={scene.taskId} deviceId={scene.surface==='device'?'physical-android:phone':undefined}/>;
}
const ui=createRoot(document.getElementById('app'));
window.unmount=()=>flushSync(()=>ui.unmount());
window.bridge=(type,data={})=>[...window.webViews.values()][0].onMessage({nativeEvent:{data:JSON.stringify({channel:'dovo-browser',type,...data})}});
flushSync(()=>ui.render(<App/>));`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    alias: {
      react: `${mobile}/node_modules/react`,
      'react-dom': `${mobile}/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
      '@dovo/client-runtime': `${root}/packages/client-runtime/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  stubs,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.deepEqual(errors, [])
  const tickets = async (count) =>
    page.waitForFunction((count) => window.requests.length === count, count)
  const connects = () =>
    page.evaluate(() => window.commands.filter(({ code }) => code.includes('"type":"connect"')))
  await tickets(1)
  await page.waitForFunction(() => window.commands.some(({ code }) => code.includes('ticket-1')))
  await page.waitForFunction(() =>
    window.commands.some(({ code }) => code.includes('"type":"appearance","theme":"dark"')),
  )
  await page.evaluate(() => {
    window.previewTheme = 'light'
    window.setScene({})
  })
  await page.waitForFunction(() =>
    window.commands.some(({ code }) => code.includes('"type":"appearance","theme":"light"')),
  )
  assert.equal(
    await page.evaluate(() => window.requests.length),
    1,
    'Changing appearance preserves the stream',
  )
  await page.evaluate(() => {
    window.bridge('connection', { online: true })
    window.bridge('state', {
      url: 'http://remote.lan/page',
      title: 'Remote page',
      back: true,
      forward: false,
      loading: false,
      editable: false,
    })
  })
  const remoteAddress = page.getByLabel('Preview URL')
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="Preview URL"]').value === 'http://remote.lan/page',
  )
  await remoteAddress.fill('http://remote.lan/next')
  await page.getByRole('button', { name: 'Go to address', exact: true }).click()
  await page.waitForFunction(() =>
    window.commands.some(({ code }) =>
      code.includes('"type":"navigate","url":"http://remote.lan/next"'),
    ),
  )
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.getByLabel('Browser options').selectOption('external')
  assert.deepEqual(
    await page.evaluate(() => window.openedLinks.at(-1)),
    {
      url: 'http://remote.lan/page',
      external: true,
    },
    'Host pages can open directly in the device browser',
  )
  await page.getByLabel('Browser options').selectOption('tablet')
  await page.waitForFunction(() =>
    window.commands.some(({ code }) => code.includes('"preset":"tablet"')),
  )
  await page.getByLabel('Browser options').selectOption('diagnostics')
  await page.evaluate(() => window.bridge('performance', { details: 'Network round trip: 40 ms' }))
  assert.equal(await page.evaluate(() => window.alerts.at(-1).details), 'Network round trip: 40 ms')
  // Host navigation must not overwrite an address being edited.
  await remoteAddress.focus()
  await remoteAddress.fill('http://remote.lan/draft')
  await page.evaluate(() =>
    window.bridge('state', {
      url: 'http://remote.lan/current',
      title: 'Current',
      back: true,
      forward: false,
      loading: false,
      editable: false,
    }),
  )
  assert.equal(await remoteAddress.inputValue(), 'http://remote.lan/draft')
  await page.evaluate(() => window.bridge('connection', { online: false }))
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await page.waitForFunction(() =>
    window.commands.some(({ code }) => code.includes('"type":"reconnect"')),
  )
  const original = await page.locator('[data-webview]').getAttribute('data-webview')
  await page.evaluate(() => window.setScene({ focused: false }))
  assert.equal(await page.evaluate(() => window.commands.at(-1).code.includes('pagehide')), true)
  await page.evaluate(() => window.bridge('reconnect'))
  assert.equal(await page.evaluate(() => window.requests.length), 1)
  await page.evaluate(() => window.setScene({ focused: true }))
  await tickets(2)
  assert.equal(
    await page.evaluate(() => window.requests.at(-1).input.url),
    'http://remote.lan/current',
  )
  assert.equal(await page.locator('[data-webview]').getAttribute('data-webview'), original)

  // Native permission prompts retain the live canvas; true backgrounding pauses it.
  await page.evaluate(() => window.setAppState('inactive'))
  assert.equal(await page.evaluate(() => window.requests.length), 2)
  await page.evaluate(() => window.setAppState('background'))
  await page.evaluate(() => {
    window.setScene({ focused: false })
    window.setAppState('active')
    window.bridge('reconnect')
  })
  assert.equal(await page.evaluate(() => window.requests.length), 2)
  await page.evaluate(() => window.setScene({ focused: true }))
  await tickets(3)

  // A late ticket from a hidden screen must not reconnect or clear a newer request.
  await page.evaluate(() => {
    window.hold = true
    window.bridge('reconnect')
  })
  await page.waitForFunction(() => window.pending.length === 1)
  await page.evaluate(() => {
    window.setScene({ focused: false })
    window.setScene({ focused: true })
  })
  await page.waitForFunction(() => window.pending.length === 2)
  await page.evaluate(() => window.pending[0]())
  await page.evaluate(() => window.bridge('reconnect'))
  assert.equal(await page.evaluate(() => window.requests.length), 5)
  assert.equal(
    (await connects()).some(({ code }) => code.includes('ticket-4')),
    false,
  )
  await page.evaluate(() => {
    window.hold = false
    window.pending[1]()
  })
  await page.waitForFunction(() => window.commands.some(({ code }) => code.includes('ticket-5')))
  assert.equal(
    (await connects()).some(({ code }) => code.includes('ticket-4')),
    false,
  )
  assert.equal((await connects()).at(-1).code.includes('ws://runtime.lan:4310/ws/browser'), true)

  await page.evaluate(() => window.setScene({ surface: 'device' }))
  await tickets(6)
  await page.waitForFunction(() => window.commands.some(({ code }) => code.includes('ticket-6')))
  assert.equal((await connects()).at(-1).code.includes('/ws/simulator'), true)
  await page.evaluate(() => window.setScene({ focused: false }))
  await page.evaluate(() => [...window.webViews.values()][0].onRenderProcessGone())
  await page.waitForFunction(() => window.mounts.length === 3)
  assert.equal(await page.evaluate(() => window.requests.length), 6)
  await page.evaluate(() => window.setScene({ focused: true }))
  await tickets(7)

  await page.evaluate(() => window.setScene({ surface: 'browser' }))
  // Verify the native inset boundary without pretending Chromium implements UIKit safe areas.
  assert.equal(await page.locator('[data-safe-bottom]').getAttribute('data-safe-bottom'), 'true')
  const previewMounts = await page.evaluate(() => window.mounts.length)
  await page.evaluate(() => window.setKeyboard(true))
  await page.locator('[data-safe-bottom="false"]').waitFor()
  await page.evaluate(() => window.setKeyboard(false))
  await page.locator('[data-safe-bottom="true"]').waitFor()
  assert.equal(
    await page.evaluate(() => window.mounts.length),
    previewMounts,
    'Keyboard transitions preserve the browser session',
  )
  // Mount during keyboard dismissal: the earlier WillHide belongs to the old pane.
  await page.evaluate(() => {
    window.keyboardVisible = true
    window.setScene({ taskId: 'keyboard-transition' })
  })
  await page.locator('[data-safe-bottom="false"]').waitFor()
  await page.evaluate(() => window.setKeyboard(false, 'Did'))
  await page.locator('[data-safe-bottom="true"]').waitFor()
  const expandedMounts = await page.evaluate(() => window.mounts.length)
  await page.evaluate(() => window.setScene({ expanded: true }))
  await page.getByRole('button', { name: 'Show browser controls', exact: true }).waitFor()
  assert.equal(await page.locator('[data-safe-bottom]').getAttribute('data-safe-bottom'), 'true')
  assert.equal(
    await page.evaluate(() => window.mounts.length),
    expandedMounts,
    'Keyboard and expansion preserve the browser session',
  )
  await page.getByRole('button', { name: 'Show browser controls', exact: true }).click()
  assert.equal(await page.getByLabel('Browser mode').count(), 0, 'No separate mode toolbar')
  await page.getByLabel('Browser options').selectOption('mode')
  const input = page.getByLabel('Preview URL')
  await input.fill('http://preview.lan/initial')
  await page.getByRole('button', { name: 'Go to address', exact: true }).click()
  await page.locator('[data-uri="http://preview.lan/initial"]').waitFor()
  assert.equal(
    await input.evaluate(
      (node) =>
        !!(
          document.querySelector('[data-webview]').compareDocumentPosition(node) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
    true,
    'Direct preview address controls follow the page',
  )
  const navigate = () =>
    page.evaluate(() =>
      [...window.webViews.values()][0].onNavigationStateChange({
        url: 'http://preview.lan/current',
        canGoBack: true,
        canGoForward: false,
      }),
    )
  await navigate()
  await page.getByRole('button', { name: 'Open in default browser', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.openedLinks.at(-1)),
    {
      url: 'http://preview.lan/current',
      external: true,
    },
    'Direct pages open the current location externally without a link chooser',
  )
  await input.focus()
  await input.fill('http://preview.lan/unsent-draft')
  await navigate()
  assert.equal(
    await input.inputValue(),
    'http://preview.lan/unsent-draft',
    'Navigation metadata preserves an active address draft',
  )
  await page.getByLabel('Browser options').selectOption('phone')
  // WebViews can report a blank document while tearing down a terminated renderer.
  await page.evaluate(() =>
    [...window.webViews.values()][0].onNavigationStateChange({
      url: 'about:blank',
      canGoBack: false,
      canGoForward: false,
    }),
  )
  for (const callback of ['onContentProcessDidTerminate', 'onRenderProcessGone']) {
    const previous = await page.locator('[data-webview]').getAttribute('data-webview')
    await page.evaluate((callback) => [...window.webViews.values()][0][callback](), callback)
    await page.waitForFunction(
      (previous) => document.querySelector('[data-webview]').dataset.webview !== previous,
      previous,
    )
    assert.equal(
      await page.locator('[data-webview]').getAttribute('data-uri'),
      'http://preview.lan/current',
    )
    assert.equal(await input.inputValue(), 'http://preview.lan/unsent-draft')
  }
  await page.evaluate(() => window.setScene({ focused: false }))
  assert.equal(await page.locator('[data-webview]').count(), 0)
  await page.evaluate(() => window.setScene({ focused: true }))
  await page.locator('[data-uri="http://preview.lan/current"]').waitFor()
  assert.equal(await input.inputValue(), 'http://preview.lan/unsent-draft')
  assert.equal(
    await page
      .getByLabel('Browser options')
      .getByRole('option', { name: 'Viewport · Phone · 390 × 844 ✓' })
      .count(),
    1,
  )
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true)
  await page.evaluate(() => window.setAppState('inactive'))
  assert.equal(await page.locator('[data-webview]').count(), 1)
  await page.evaluate(() => window.setAppState('background'))
  await page.locator('[data-webview]').waitFor({ state: 'detached' })
  await page.evaluate(() => window.setAppState('active'))
  await page.locator('[data-uri="http://preview.lan/current"]').waitFor()

  // A hidden Device Hub pane does not issue discovery requests on mount.
  await page.evaluate(() => window.setScene({ surface: 'devices', focused: false }))
  assert.equal(await page.evaluate(() => window.deviceReads ?? 0), 0)
  await page.evaluate(() => window.setScene({ focused: true }))
  await page.waitForFunction(() => window.deviceReads === 1)
  await page.evaluate(() => window.unmount())
  assert.equal(await page.evaluate(() => window.appStateListeners.size), 0)
  assert.equal(
    await page.evaluate(() =>
      [...window.keyboardListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0),
    ),
    0,
  )
  assert.equal(await page.evaluate(() => window.webViews.size), 0)

  // Fifty saved scopes: reopening one promotes it, and adding another evicts the oldest.
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const open = async (id) => {
    await page.evaluate((id) => window.setScene({ surface: 'browser', taskId: String(id) }), id)
    await page.getByLabel('Browser options').selectOption('mode')
  }
  for (let id = 0; id < 50; id++) {
    await open(id)
    await input.fill(`http://preview.lan/thread-${id}`)
    await page.getByRole('button', { name: 'Go to address', exact: true }).click()
    await page.locator(`[data-uri="http://preview.lan/thread-${id}"]`).waitFor()
  }
  await open(0)
  assert.equal(await input.inputValue(), 'http://preview.lan/thread-0')
  await open(50)
  await input.fill('http://preview.lan/thread-50')
  await page.getByRole('button', { name: 'Go to address', exact: true }).click()
  await page.locator('[data-uri="http://preview.lan/thread-50"]').waitFor()
  await open(0)
  assert.equal(await input.inputValue(), 'http://preview.lan/thread-0')
  await open(1)
  assert.equal(await input.inputValue(), 'http://localhost:3000')
  assert.equal(await page.locator('[data-webview]').count(), 0)
  await page.evaluate(() => window.unmount())
  assert.deepEqual(errors, [])
  console.log(
    'Mobile previews: focus/background pause, stale tickets, device streams, renderer recovery, retained URLs/drafts/controls, bounded address retention and cleanup passed.',
  )
} finally {
  await browser.close()
}
