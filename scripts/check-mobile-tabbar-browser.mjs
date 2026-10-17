import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workbench = root + 'apps/mobile/src/shell/workbench.tsx'
const stubs = [
  {
    path: 'react-native',
    contents: `
export const Platform={get OS(){return window.fixture.platform}};
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={style}>{children}</div>;export const Modal=({children})=><div role="dialog">{children}</div>;export const Pressable=({children,onPress,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>;
export const KeyboardAvoidingView=View;export const ActivityIndicator=()=>null;
export const Keyboard={dismiss(){},addListener:(name,callback)=>{window.keyboardListeners[name]=callback;return {remove(){}}}};`,
  },
  {
    path: 'expo-router',
    contents: `
export const router=Object.fromEntries(['push','replace','navigate','dismissTo'].map(method=>[method,(...args)=>window.routes.push({method,args})]));
export const usePathname=()=>window.fixture.path;export const useGlobalSearchParams=()=>({});export const useIsFocused=()=>true;`,
  },
  {
    path: 'expo-router/unstable-native-tabs',
    contents: `
import {Children} from 'react';
function NativeTabs({children,hidden,unstable_nativeProps}){const Scene=window.WorkbenchScene;return <><nav hidden={hidden} data-prominent={unstable_nativeProps?.ios?.prominentScreenKey}>{Children.toArray(children).filter(child=>!child.props.hidden).map(({props})=>{if(props.name==='compose')window.compose=props;if(props.name==='(more)')window.more=props;return <button key={props.name} data-testid={props.testID} data-role={props.role} aria-label={props.accessibilityLabel??props.testID} disabled={props.disabled} onClick={()=>{props.listeners?.tabPress?.({data:{isPrevented:props.unstable_nativeProps?.preventNativeSelection??false}});if(!props.unstable_nativeProps?.preventNativeSelection)window.nativeSelections.push(props.name)}}>{props.testID}</button>})}</nav><Scene tab={window.fixture.path.startsWith('/settings')?'settings':'pulls'}/></>}
NativeTabs.Trigger=Object.assign(()=>null,{Icon:()=>null,Label:()=>null});export {NativeTabs};`,
  },
  {
    path: 'react-native-safe-area-context',
    contents:
      'export const SafeAreaView=({children})=><div>{children}</div>;export const useSafeAreaInsets=()=>({top:0,bottom:0,right:0,left:0});',
  },
  {
    path: 'react-native-screens/experimental',
    contents: 'export const SafeAreaView=({children})=><div>{children}</div>;',
  },
  {
    path: '../runtime/state/application-state',
    importer: workbench,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../runtime/preferences/app-preferences',
    importer: workbench,
    contents: `export const preferencesReady=Promise.resolve();export const readMobilePreferences=()=>({launchTab:'settings',carMode:false});export const useCarMode=()=>window.fixture.car;`,
  },
  {
    path: '../runtime/connection/provider',
    importer: workbench,
    contents: 'export const useRuntime=()=>window.fixture.runtime;',
  },
  {
    path: '../runtime/connection/connection-status',
    importer: workbench,
    contents:
      'export const FloatingPills=({children})=><div>{children}</div>;export const ConnectionPill=()=>null;',
  },
  {
    path: './shortcuts',
    importer: workbench,
    contents: 'export const useShortcuts=()=>({input:null});',
  },
  {
    path: './extensions',
    importer: workbench,
    contents:
      'const Scene=()=> <div>Collection content</div>;export const createMobileExtensions=()=>({host:{dispose(){}},view:async()=>Scene});',
  },
  {
    path: '../tasks/creation/new-task',
    importer: workbench,
    contents: 'export const NewTask=()=>null;',
  },
  {
    path: '../runtime/connection/creation-target',
    importer: workbench,
    contents: 'export const CreationTarget=()=>null;',
  },
  {
    path: '../tasks/list/task-list-view',
    importer: workbench,
    contents: 'export const TaskListViewProvider=({children})=>children;',
  },
  {
    path: '../ui/controls/icon',
    importer: root + 'apps/mobile/src/shell/',
    contents: 'export const Icon=()=>null;',
  },
  {
    path: '../ui/controls/icon-assets',
    importer: workbench,
    contents: 'export const iconAssets={};',
  },
  {
    path: '../ui/controls/icon-button',
    importer: workbench,
    contents:
      'export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress}>{label}</button>;',
  },
  {
    path: '../ui/content/text',
    importer: root + 'apps/mobile/src/shell/',
    contents: 'export const Text=({children})=><span>{children}</span>;',
  },
  {
    path: '../ui/theme',
    importer: root + 'apps/mobile/src/shell/',
    contents: 'export const useTheme=()=>({colors:{},styles:{}});',
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {Workbench,WorkbenchScene} from './apps/mobile/src/shell/workbench.tsx';
window.WorkbenchScene=WorkbenchScene;window.routes=[];window.nativeSelections=[];window.keyboardListeners={};
window.fixture={path:'/pulls',platform:'ios',car:false,runtime:{ready:true,activeId:'a',profiles:[{id:'a'}],overviews:[{profile:{id:'a'},connected:true,snapshot:{artifactsEnabled:true}}]}};
function App(){const [version,setVersion]=useState(0);window.updateFixture=changes=>{window.fixture={...window.fixture,...changes};setVersion(v=>v+1)};return <Workbench key={window.fixture.platform}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  stubs,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Collection content', { exact: true }).waitFor()
  const plus = page.getByRole('button', { name: 'New thread', exact: true })
  assert.equal(await page.locator('nav').getAttribute('data-prominent'), 'compose')
  assert.equal(await plus.getAttribute('data-role'), 'search')
  assert.equal(await page.evaluate(() => window.more.disablePopToTop), true)
  assert.equal(await page.evaluate(() => window.more.disableScrollToTop), true)
  assert.equal(await page.locator('nav button').count(), 4)
  await plus.click()
  assert.deepEqual(await page.evaluate(() => window.routes), [
    { method: 'push', args: ['/new', { withAnchor: true }] },
  ])
  assert.deepEqual(await page.evaluate(() => window.nativeSelections), [])
  assert.equal(await page.evaluate(() => window.fixture.path), '/pulls')
  await page.evaluate(() => window.updateFixture({ path: '/settings' }))
  await plus.click()
  assert.equal(await page.evaluate(() => window.routes.length), 2)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: 'Issues', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.routes.pop()), {
    method: 'navigate',
    args: ['/issues', { withAnchor: true }],
  })
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.nativeSelections), [])
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click()
  await page.evaluate(() => window.updateFixture({ car: true }))
  await page.getByRole('button', { name: 'More', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Issues', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Artifacts', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click()
  await page.evaluate(() => window.updateFixture({ car: false }))
  await page.evaluate(() =>
    window.updateFixture({
      runtime: {
        ...window.fixture.runtime,
        overviews: [{ profile: { id: 'a' }, connected: false }],
      },
    }),
  )
  await page.waitForFunction(() => document.querySelector('[aria-label="New thread"]').disabled)
  await page.evaluate(() => window.compose.listeners.tabPress({ data: { isPrevented: true } }))
  assert.equal(await page.evaluate(() => window.routes.length), 2)
  await page.evaluate(() => window.keyboardListeners.keyboardDidShow())
  await plus.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.keyboardListeners.keyboardDidHide())
  await plus.waitFor({ state: 'visible' })
  await page.evaluate(() =>
    window.updateFixture({
      platform: 'android',
      runtime: {
        ...window.fixture.runtime,
        overviews: [
          { profile: { id: 'a' }, connected: true, snapshot: { artifactsEnabled: true } },
        ],
      },
    }),
  )
  await page.getByText('Collection content', { exact: true }).waitFor()
  assert.equal(await page.locator('nav button').count(), 3, 'Android keeps Tasks, PRs and More')
  assert.equal(await page.locator('nav').getByRole('button', { name: 'New thread' }).count(), 0)
  await plus.click()
  assert.equal(await page.evaluate(() => window.routes.length), 3)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile New thread: trailing native action, preserved tab, offline guard, keyboard hiding and More dropdown and Android floating action pass. Native controls use browser adapters.',
  )
} finally {
  await browser.close()
}
