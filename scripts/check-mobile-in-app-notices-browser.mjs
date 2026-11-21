import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
// Real notification component, request model, bridge and durable composer draft hook.
// Native navigation and controls are adapters. Actual Expo stack behaviour needs a device.
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {RegistryProvider} from '@effect/atom-react';
import {InAppInputNotifications} from './src/notifications/in-app-input';
import {deliverInAppNotification} from './src/notifications/in-app-delivery';
import {registerAccessibleNotificationInput} from './src/notifications/visibility';
import {useDraft} from './src/tasks/draft/use-draft';
import {RuntimeContext} from '@fixture/runtime';
import {RouteContext} from 'expo-router';
window.routes=[];window.deliver=deliverInAppNotification;
window.showApproval=registerAccessibleNotificationInput;
const nativeSetTimeout=window.setTimeout;const nativeClearTimeout=window.clearTimeout;
const timers=new Map();let timerId=1000000;
window.setTimeout=(fn,ms,...args)=>ms===8000?(timers.set(++timerId,fn),timerId):nativeSetTimeout(fn,ms,...args);
window.clearTimeout=id=>timers.delete(id)||nativeClearTimeout(id);
window.expire=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn()};
function Composer({id}){const draft=useDraft(id);return <input aria-label="Composer" disabled={!draft.ready} value={draft.text} onChange={e=>draft.update(e.target.value,'keyboard')}/>}
function App(){
const [entries,setEntries]=useState([]);window.updateEntries=setEntries;
const [route,setRoute]=useState({runtimeId:'one',taskId:'source',runtimeIdentity:'identity-one',nativeAgentKey:'native-agent',parentRuntimeId:'one',parentTaskId:'parent',parentTitle:'Parent'});window.go=params=>setRoute(params);
const [ready,setReady]=useState(true);window.setReady=setReady;
return <RegistryProvider><RuntimeContext.Provider value={{overviews:entries,ready,activeId:route.runtimeId}}><RouteContext.Provider value={route}>
{route.taskId&&<Composer key={route.runtimeId+':'+route.taskId} id={route.taskId}/>}
<InAppInputNotifications/>
</RouteContext.Provider></RuntimeContext.Provider></RegistryProvider>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { react: mobile + 'node_modules/react' },
    nodePaths: [mobile + 'node_modules', root + 'node_modules'],
  },
  [
    {
      path: 'react-native',
      contents: `
const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)}}};window.setAppState=state=>{AppState.currentState=state;for(const fn of listeners)fn(state)};
const css=s=>{const v=Array.isArray(s)?Object.assign({},...s.map(css)):s??{};return {...v,paddingTop:v.paddingVertical??v.padding,paddingBottom:v.paddingVertical??v.padding,paddingLeft:v.paddingHorizontal??v.padding,paddingRight:v.paddingHorizontal??v.padding}};
export const View=({children,style,accessibilityLiveRegion})=><div aria-live={accessibilityLiveRegion} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',...css(style)}}>{children}</div>;
export const Pressable=({children,onPress,style,accessibilityLabel,accessibilityRole})=><button role={accessibilityRole} aria-label={accessibilityLabel} onClick={onPress} style={{display:'flex',flexDirection:'column',border:0,font:'inherit',textAlign:'start',background:'transparent',...css(style)}}>{children}</button>;
export const Text=({children,style})=><span style={css(style)}>{children}</span>;
export const StyleSheet={flatten:css};export const Platform={OS:'ios'};export const useWindowDimensions=()=>({fontScale:1});
`,
    },
    {
      path: 'expo-router',
      contents: `import{createContext,useContext}from'react';export const RouteContext=createContext({});export const useGlobalSearchParams=()=>useContext(RouteContext);export const usePathname=()=>useContext(RouteContext).taskId?'/thread/x/y':'/settings';export const useRootNavigationState=()=>({key:'root'});export const router={push:href=>{window.routes.push({kind:'push',href});window.go(href.params)},dismissTo:href=>{window.routes.push({kind:'dismissTo',href});window.go(href.params)}};`,
    },
    {
      path: 'react-native-safe-area-context',
      contents: 'export const useSafeAreaInsets=()=>({top:20,left:0,right:0,bottom:0});',
    },
    {
      path: '@fixture/runtime',
      contents: `import{createContext,useContext}from'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);`,
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'src/notifications/',
      contents: `export {useRuntime} from '@fixture/runtime';`,
    },
    {
      path: '../../runtime/connection/provider',
      importer: mobile + 'src/tasks/draft/',
      contents: `export {useRuntime} from '@fixture/runtime';`,
    },
    {
      path: '../runtime/preferences/app-preferences',
      importer: mobile + 'src/notifications/',
      contents: `import{useSyncExternalStore}from'react';window.preferences={inAppNotifications:true};const listeners=new Set();export const readMobilePreferences=()=>window.preferences;export const useMobilePreferences=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},readMobilePreferences);window.enableNotices=value=>{window.preferences={inAppNotifications:value};for(const fn of listeners)fn()};`,
    },
    {
      path: '../../runtime/preferences/app-preferences',
      importer: mobile + 'src/ui/content/',
      contents: 'export const carZoom=1.5;export const useCarMode=()=>false;',
    },
    {
      path: '../ui/theme',
      importer: mobile + 'src/notifications/',
      contents: `export const useTheme=()=>({colors:{text:'#eee',muted:'#bbb',border:'#555',accent:'#80baff',elevated:'#222'},highContrast:true});`,
    },
    {
      path: '../theme',
      importer: mobile + 'src/ui/content/',
      contents: `export const useTheme=()=>({colors:{text:'#eee'}});`,
    },
    {
      path: '@react-native-async-storage/async-storage',
      contents: `const saved=new Map();export default{getItem:async key=>saved.get(key)??null,setItem:async(key,value)=>{saved.set(key,value)},removeItem:async key=>{saved.delete(key)}};`,
    },
  ],
)
const thread = (id, title = id) => ({ id, title, status: 'running' })
const entry = (id) => ({
  profile: {
    id,
    name: `Computer ${id}`,
    connection: { address: `http://${id}.lan`, token: 'fixture' },
  },
  connected: true,
  snapshot: {
    workspace: {
      tasks: [
        thread('source', 'Source thread'),
        thread('other', 'Review thread'),
        thread('third', 'Third thread'),
      ],
      automations: [],
    },
    approvals: [],
    questions: [],
    secureInputs: [],
    runs: [],
  },
})
const entries = [entry('one'), entry('two')]
const approval = (id, taskId = 'other') => ({
  id,
  taskId,
  title: 'Private command',
  detail: 'Do not show in banner',
  createdAt: '',
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;background:#111;color:#eee}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('textbox', { name: 'Composer' }).waitFor()
  await page.evaluate((value) => window.updateEntries(value), entries)
  const composer = page.getByRole('textbox', { name: 'Composer' })
  await composer.fill('Keep this source draft')
  entries[1].snapshot.approvals = [approval('first')]
  await page.evaluate((value) => window.updateEntries(value), entries)
  const open = page.getByRole('button', { name: 'Open Review thread', exact: true })
  await open.waitFor()
  assert.equal(
    await composer.evaluate((el) => document.activeElement === el),
    true,
    'banner must not steal focus',
  )
  assert.equal(await composer.inputValue(), 'Keep this source draft')
  assert.equal(await page.getByText('Private command').count(), 0)
  assert.equal(await page.getByText('Do not show in banner').count(), 0)
  await page.getByText('Computer two', { exact: true }).waitFor()
  const box = await open.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390)
  // Native push and the overview update identify one request.
  assert.equal(
    await page.evaluate(() =>
      window.deliver(
        {
          kind: 'input',
          runtimeId: 'two',
          taskId: 'other',
          inputId: 'first',
          inputType: 'approval',
        },
        true,
      ),
    ),
    true,
  )
  await open.click()
  await page.getByRole('button', { name: 'Return to Source thread', exact: true }).waitFor()
  assert.equal(await composer.inputValue(), '')
  await composer.fill('Keep review draft')
  await page.evaluate(() => window.enableNotices(false))
  await page.getByRole('button', { name: 'Return to Source thread', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('input')?.value === 'Keep this source draft',
  )
  const sourceRoute = await page.evaluate(() => window.routes.at(-1))
  assert.equal(sourceRoute.kind, 'dismissTo')
  assert.deepEqual(sourceRoute.href.params, {
    runtimeId: 'one',
    taskId: 'source',
    runtimeIdentity: 'identity-one',
    nativeAgentKey: 'native-agent',
    parentRuntimeId: 'one',
    parentTaskId: 'parent',
    parentTitle: 'Parent',
  })
  assert.equal(await open.count(), 0, 'push duplicate must not remain queued')
  await page.evaluate(() => window.enableNotices(true))
  // A visible approval card suppresses only that approval on its own computer.
  await page.evaluate(() => {
    window.hideApproval = window.showApproval({
      runtimeId: 'one',
      taskId: 'source',
      inputId: 'active',
      inputType: 'approval',
    })
  })
  entries[0].snapshot.approvals = [approval('active', 'source')]
  entries[1].snapshot.approvals.push(approval('other-computer', 'source'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await page.getByRole('button', { name: 'Open Source thread', exact: true }).waitFor()
  entries[1].snapshot.approvals = entries[1].snapshot.approvals.filter(
    (a) => a.id !== 'other-computer',
  )
  await page.evaluate((value) => window.updateEntries(value), entries)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Open Source thread"]'))
  await page.evaluate(() => window.hideApproval())
  // Keep later requests when the first expires. Dismiss only the selected request.
  entries[1].snapshot.approvals.push(approval('expire'), approval('queued', 'third'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await open.waitFor()
  await page.evaluate(() => window.expire())
  await page.getByRole('button', { name: 'Open Third thread', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  assert.equal(await open.count(), 0)
  // An unconfirmed push can be displayed before its snapshot.
  await page.evaluate(() =>
    window.deliver(
      {
        kind: 'input',
        runtimeId: 'two',
        taskId: 'third',
        inputId: 'future',
        inputType: 'question',
      },
      true,
    ),
  )
  await page.getByRole('button', { name: 'Open Third thread', exact: true }).waitFor()
  await page.evaluate(() => window.expire())
  // Settings off leaves native delivery available.
  await page.evaluate(() => window.enableNotices(false))
  assert.equal(
    await page.evaluate(() =>
      window.deliver(
        {
          kind: 'input',
          runtimeId: 'two',
          taskId: 'other',
          inputId: 'disabled',
          inputType: 'question',
        },
        true,
      ),
    ),
    false,
  )
  entries[1].snapshot.approvals.push(approval('disabled'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await page.evaluate(() => window.enableNotices(true))
  await composer.fill('Keep this source draft') // wait for the next browser action after baseline
  assert.equal(await open.count(), 0)
  // Background snapshots do not replay on resume, nor do disconnected requests.
  await page.evaluate(() => window.setAppState('background'))
  entries[1].snapshot.approvals.push(approval('background'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await page.evaluate(() => window.setAppState('active'))
  await composer.focus()
  assert.equal(await open.count(), 0)
  entries[1].connected = false
  await page.evaluate((value) => window.updateEntries(value), entries)
  entries[1].snapshot.approvals.push(approval('reconnected'))
  entries[1].connected = true
  await page.evaluate((value) => window.updateEntries(value), entries)
  await composer.focus()
  assert.equal(await open.count(), 0)
  // A worker can first appear in the same snapshot as its human request.
  entries[1].snapshot.workspace.tasks.push(thread('new-worker', 'New worker'))
  entries[1].snapshot.approvals.push(approval('new-worker-request', 'new-worker'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await page.getByRole('button', { name: 'Open New worker', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  // Child pushes and overview requests share the owning conversation and receipt.
  entries[1].snapshot.workspace.tasks.push({
    ...thread('child', 'Child worker'),
    delegation: { parentTaskId: 'other', parentRunId: 'run', key: 'child' },
  })
  entries[1].snapshot.approvals.push(approval('child-review', 'child'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await open.waitFor()
  assert.equal(
    await page.evaluate(() =>
      window.deliver(
        {
          kind: 'input',
          runtimeId: 'two',
          taskId: 'child',
          inputId: 'child-review',
          inputType: 'approval',
        },
        true,
      ),
    ),
    true,
  )
  await page.getByRole('button', { name: 'Dismiss' }).click()
  assert.equal(await open.count(), 0, 'child push must not duplicate the parent notice')
  // Opening from a list has no invented return target.
  await page.evaluate(() => window.go({}))
  entries[1].snapshot.approvals.push(approval('from-list'))
  await page.evaluate((value) => window.updateEntries(value), entries)
  await open.waitFor()
  await open.click()
  await page.waitForFunction(() => window.routes.at(-1)?.href.params.taskId === 'other')
  await page.waitForFunction(() => document.querySelector('input')?.value === 'Keep review draft')
  assert.equal(
    await page.getByRole('button', { name: 'Return to Source thread', exact: true }).count(),
    0,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile input notices pass: foreground, privacy, push deduplication, resolution, queue, settings, resume, return route and real composer draft recovery.',
  )
} finally {
  await browser.close()
}
