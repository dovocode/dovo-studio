import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workbench = root + 'apps/mobile/src/shell/workbench.tsx'
// Use Expo Router's real route-tree builder: menu screens must remain reachable
// outside the native tab navigator even though they have no tab trigger.
const mobileRequire = createRequire(root + 'apps/mobile/package.json')
const { getRoutes } = mobileRequire('expo-router/build/getRoutesCore')
const { getValidInitialRouteName } = mobileRequire('expo-router/build/routeNode')
const appRoot = root + 'apps/mobile/src/app/'
const routeContext = () => ({ default: () => null })
routeContext.keys = () =>
  readdirSync(appRoot, { recursive: true })
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => './' + path)
const routeTree = getRoutes(routeContext, { ignoreEntryPoints: true, importMode: 'lazy' })
const tabs = routeTree.children.find((route) => route.route === '(tabs)')
const more = routeTree.children.find((route) => route.route === '(more)')
assert.ok(tabs && more, 'Tabs and menu destinations must be sibling stacks')
assert.ok(tabs.children.some((route) => route.route === '(tasks)'))
for (const name of ['settings', 'issues', 'artifacts'])
  assert.ok(
    more.children.some((route) => route.route === name),
    `${name} remains reachable outside tabs`,
  )

const stubs = [
  {
    path: '../runtime/preferences/storage-notice',
    importer: workbench,
    contents:
      'export const PreferenceStorageNotice=()=>window.fixture.notice?<div role="alert">Saved settings need a retry</div>:null;',
  },
  {
    path: 'react-native',
    contents: `
export const Platform={get OS(){return window.fixture?.platform??'ios'}};
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={style}>{children}</div>;export const Modal=({children})=><div role="dialog">{children}</div>;export const Pressable=({children,onPress,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>;
export const KeyboardAvoidingView=({children,enabled})=><div data-keyboard-avoidance={String(enabled)}>{children}</div>;export const ActivityIndicator=()=>null;
export const AppState={currentState:'active',addEventListener:(name,callback)=>{window.appStateListener=callback;return {remove(){delete window.appStateListener}}}};
window.setAppState=state=>{AppState.currentState=state;window.appStateListener?.(state)};
export const Keyboard={dismiss(){},addListener:(name,callback)=>{window.keyboardListeners[name]=callback;return {remove(){}}}};`,
  },
  {
    path: 'expo-router',
    contents: `
export const router={...Object.fromEntries(['push','replace','navigate','dismissTo','back'].map(method=>[method,(...args)=>window.routes.push({method,args})])),canGoBack:()=>!!window.fixture.canGoBack};
function Stack(){const Scene=window.WorkbenchScene;const Tabs=window.WorkbenchTabs;const Detail=window.WorkbenchDetailRoute;return window.fixture.detail?<Detail tab="tasks" bottomInset={window.fixture.bottomInset}><input aria-label="Retained draft" defaultValue="Keep this text"/></Detail>:window.fixture.sidebar?<Scene tab="tasks" sidebar/>:window.fixture.path.startsWith('/settings')?<Scene tab="settings"/>:<Tabs/>}Stack.Screen=()=>null;export {Stack};
export const usePathname=()=>window.fixture.path;export const useGlobalSearchParams=()=>({});export const useIsFocused=()=>true;`,
  },
  {
    path: 'expo',
    contents: `export const requireOptionalNativeModule=()=>({});export const requireNativeView=()=>({children,...props})=>{window.hardwareCommands=props;return <div>{children}</div>};`,
  },
  {
    path: 'expo-router/unstable-native-tabs',
    contents: `
import {Children} from 'react';
function NativeTabs({children,hidden,unstable_nativeProps}){const Scene=window.WorkbenchScene;return <><nav hidden={hidden} data-prominent={unstable_nativeProps?.ios?.prominentScreenKey}>{Children.toArray(children).filter(child=>!child.props.hidden).map(({props})=>{if(props.name==='compose')window.compose=props;return <button key={props.name} data-testid={props.testID} data-role={props.role} aria-label={props.accessibilityLabel??props.testID} disabled={props.disabled} onClick={()=>{props.listeners?.tabPress?.({data:{isPrevented:props.unstable_nativeProps?.preventNativeSelection??false}});if(!props.unstable_nativeProps?.preventNativeSelection)window.nativeSelections.push(props.name)}}>{props.testID}</button>})}</nav><Scene tab={window.fixture.path.startsWith('/settings')?'settings':'pulls'}/></>}
NativeTabs.Trigger=Object.assign(()=>null,{Icon:()=>null,Label:()=>null});export {NativeTabs};`,
  },
  {
    path: 'react-native-safe-area-context',
    contents:
      'export const SafeAreaView=({children})=><div>{children}</div>;export const useSafeAreaInsets=()=>({top:0,bottom:0,right:0,left:0});',
  },
  {
    path: 'react-native-screens/experimental',
    contents:
      'export const SafeAreaView=({children,edges})=><div data-native-safe-area={JSON.stringify(edges)}>{children}</div>;',
  },
  {
    path: '../runtime/state/application-state',
    importer: workbench,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../runtime/preferences/app-preferences',
    importer: workbench,
    contents: `export const preferencesReady=Promise.resolve();export const readMobilePreferences=()=>{window.launchReads=(window.launchReads??0)+1;return {launchTab:window.fixture.launchTab??'tasks',carMode:window.fixture.car}};export const useCarMode=()=>window.fixture.car;export const useMobilePreferences=()=>({browserWorkspaceEnabled:false});`,
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
    contents: `import {useNavigation} from '${root}apps/mobile/src/shell/navigation.tsx';const Scene=()=>{const navigation=useNavigation();return <div><span>Collection content</span><button onClick={()=>navigation.navigate('tasks','thread','b')}>Open sidebar thread</button></div>};export const createMobileExtensions=()=>({host:{dispose(){}},view:async()=>Scene});`,
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
import {Workbench,WorkbenchScene,WorkbenchTabs,WorkbenchDetailRoute} from './apps/mobile/src/shell/workbench.tsx';
import {unstable_settings} from './apps/mobile/src/app/(tabs)/_layout.tsx';window.tabSettings=unstable_settings;
window.WorkbenchScene=WorkbenchScene;window.WorkbenchTabs=WorkbenchTabs;window.WorkbenchDetailRoute=WorkbenchDetailRoute;window.routes=[];window.nativeSelections=[];window.keyboardListeners={};
window.fixture={path:'/pulls',platform:'ios',car:false,runtime:{ready:true,activeId:'a',profiles:[{id:'a'}],overviews:[{profile:{id:'a'},connected:true,snapshot:{artifactsEnabled:true}}]}};
function App(){const [version,setVersion]=useState(0);window.updateFixture=changes=>{window.fixture={...window.fixture,...changes};setVersion(v=>v+1)};return <Workbench key={window.fixture.platform+':'+(window.fixture.mount??0)}/>}
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
  const settings = await page.evaluate(() => window.tabSettings)
  const configuredContext = (key) => ({
    ...routeContext(key),
    ...(key === './(tabs)/_layout.tsx' ? { unstable_settings: settings } : {}),
  })
  configuredContext.keys = routeContext.keys
  const configuredTree = getRoutes(configuredContext, {
    ignoreEntryPoints: true,
    importMode: 'lazy',
  })
  assert.equal(
    getValidInitialRouteName(configuredTree.children.find((route) => route.route === '(tabs)')),
    '(tasks)',
    'Native tabs must start on the thread list instead of the compose redirect',
  )
  await page.getByText('Collection content', { exact: true }).waitFor()
  const nativeInsets = () =>
    page
      .locator('[data-native-safe-area]')
      .evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.dataset.nativeSafeArea)))
  assert.deepEqual(
    await nativeInsets(),
    [{ top: true, left: true, right: true }, { bottom: true }],
    'Collections consume remaining top and tab-bar insets before fixed controls',
  )
  await page.evaluate(() => window.updateFixture({ notice: true }))
  assert.equal(
    await page
      .getByRole('alert')
      .evaluate(
        (node) => JSON.parse(node.closest('[data-native-safe-area]').dataset.nativeSafeArea).top,
      ),
    true,
    'Storage recovery notices stay below the navigation safe area too',
  )
  await page.evaluate(() => window.updateFixture({ notice: false }))
  const plus = page.getByRole('button', { name: 'New thread', exact: true })
  assert.equal(await page.locator('nav').getAttribute('data-prominent'), 'compose')
  assert.equal(await plus.getAttribute('data-role'), 'search')
  // Expo maps Trigger.role to systemItem. RNScreens now needs its separate native
  // role to create UISearchTab, plus automatic activation for detachment on iOS 27.
  assert.deepEqual(
    await page.evaluate(() => window.compose.unstable_nativeProps.ios),
    { role: 'search', automaticallyActivatesSearch: true },
    'The plus uses the detached native action rather than a regular collection tab',
  )
  assert.equal(await page.locator('nav button').count(), 3)
  assert.equal(await page.locator('nav button[data-testid="Tab More"]').count(), 0)
  await plus.click()
  assert.deepEqual(await page.evaluate(() => window.routes), [
    { method: 'push', args: ['/new', { withAnchor: true }] },
  ])
  assert.deepEqual(await page.evaluate(() => window.nativeSelections), [])
  assert.equal(await page.evaluate(() => window.fixture.path), '/pulls')
  assert.ok(
    (await page.evaluate(() => window.hardwareCommands.enabledCommands)).includes('newThread'),
  )
  await page.evaluate(() =>
    window.hardwareCommands.onCommand({ nativeEvent: { command: 'newThread' } }),
  )
  assert.equal(await page.evaluate(() => window.routes.length), 2)
  await page.evaluate(() => window.routes.pop())
  await page.evaluate(() => window.updateFixture({ path: '/settings' }))
  await page.locator('nav').waitFor({ state: 'detached' })
  assert.equal(await page.locator('nav').count(), 0, 'Settings opens outside the tab bar')
  await page.getByText('Collection content', { exact: true }).waitFor()
  assert.deepEqual(
    await nativeInsets(),
    [{ top: true, left: true, right: true }, { bottom: true }],
    'Menu destinations outside tabs protect the navigation and home edges too',
  )
  await page.evaluate(() => window.updateFixture({ path: '/pulls' }))
  await plus.click()
  assert.equal(await page.evaluate(() => window.routes.length), 2)
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
  assert.ok(
    !(await page.evaluate(() => window.hardwareCommands.enabledCommands)).includes('newThread'),
  )
  await page.evaluate(() =>
    window.keyboardListeners.keyboardDidShow({ endCoordinates: { height: 300, screenY: 500 } }),
  )
  await plus.waitFor({ state: 'hidden' })
  assert.deepEqual(
    await nativeInsets(),
    [{ top: true, left: true, right: true }, { bottom: false }],
    'Keyboard avoidance owns the collection bottom while the keyboard is visible',
  )
  await page.evaluate(() => window.keyboardListeners.keyboardDidHide())
  await plus.waitFor({ state: 'visible' })
  const keyboardEnabled = () =>
    page.locator('[data-keyboard-avoidance]').getAttribute('data-keyboard-avoidance')
  // The empty shortcut input can report screenY=0. RN's padding calculation would
  // otherwise use the whole viewport as keyboard height and hide the navigator.
  await page.evaluate(() =>
    window.keyboardListeners.keyboardWillShow({ endCoordinates: { height: 0, screenY: 0 } }),
  )
  assert.equal(await keyboardEnabled(), 'false')
  await plus.waitFor({ state: 'visible' })
  await page.evaluate(() =>
    window.keyboardListeners.keyboardWillShow({ endCoordinates: { height: 300, screenY: 500 } }),
  )
  await plus.waitFor({ state: 'hidden' })
  assert.equal(await keyboardEnabled(), 'true')
  await page.evaluate(() => window.setAppState('background'))
  await plus.waitFor({ state: 'visible' })
  assert.equal(await keyboardEnabled(), 'false')
  await page.evaluate(() => {
    window.keyboardListeners.keyboardDidShow({ endCoordinates: { height: 300, screenY: 500 } })
    window.setAppState('active')
  })
  assert.equal(await keyboardEnabled(), 'false')
  await page.evaluate(() =>
    window.keyboardListeners.keyboardDidShow({ endCoordinates: { height: 0, screenY: 0 } }),
  )
  assert.equal(await keyboardEnabled(), 'false')
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
  assert.equal(await page.locator('nav button').count(), 2, 'Android keeps Tasks and PRs')
  assert.equal(await page.locator('nav').getByRole('button', { name: 'New thread' }).count(), 0)
  await plus.click()
  assert.equal(await page.evaluate(() => window.routes.length), 3)
  await page.evaluate(() => window.updateFixture({ sidebar: true, path: '/thread/a/old' }))
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector('[data-native-safe-area]').dataset.nativeSafeArea).top ===
      false,
  )
  assert.deepEqual(
    await nativeInsets(),
    [{ top: false, left: true, right: true }, { bottom: false }],
    'The expanded sidebar keeps the top inset already applied by its pane',
  )
  await page.getByRole('button', { name: 'Open sidebar thread', exact: true }).click()
  assert.equal(await page.evaluate(() => window.routes.at(-1).method), 'replace')
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1).args[0].params), {
    runtimeId: 'b',
    taskId: 'thread',
  })
  await page.evaluate(() => window.updateFixture({ path: '/' }))
  await page.getByRole('button', { name: 'Open sidebar thread', exact: true }).click()
  assert.equal(await page.evaluate(() => window.routes.at(-1).method), 'navigate')
  // Ordinary launches stay on the list. Explicit launch preferences and deep links retain routing.
  let mount = 0
  for (const scenario of [
    { path: '/', launchTab: 'tasks', car: false, expected: [] },
    {
      path: '/',
      launchTab: 'pulls',
      car: false,
      expected: [{ method: 'replace', args: ['/pulls'] }],
    },
    {
      path: '/',
      launchTab: 'issues',
      car: false,
      expected: [{ method: 'replace', args: ['/issues'] }],
    },
    {
      path: '/',
      launchTab: 'jobs',
      car: false,
      expected: [{ method: 'replace', args: ['/settings/automations'] }],
    },
    { path: '/', launchTab: 'pulls', car: true, expected: [] },
    { path: '/thread/a/old', launchTab: 'pulls', car: false, expected: [] },
  ]) {
    const reads = await page.evaluate(() => window.launchReads)
    await page.evaluate(
      ({ scenario, mount }) => {
        window.routes = []
        window.updateFixture({ ...scenario, platform: 'ios', sidebar: false, mount })
      },
      { scenario, mount: ++mount },
    )
    await page.waitForFunction((reads) => window.launchReads > reads, reads)
    assert.deepEqual(await page.evaluate(() => window.routes), scenario.expected)
  }
  await page.evaluate(() => window.updateFixture({ detail: true, bottomInset: true }))
  const draft = page.getByRole('textbox', { name: 'Retained draft' })
  await draft.fill('Unsaved draft')
  assert.deepEqual(await nativeInsets(), [{ top: true, left: true, right: true, bottom: true }])
  await page.evaluate(() => window.updateFixture({ bottomInset: false }))
  assert.deepEqual(
    await nativeInsets(),
    [{ top: true, left: true, right: true, bottom: false }],
    'Composer and preview routes own their bottom inset, including when the header hides',
  )
  assert.equal(await draft.inputValue(), 'Unsaved draft', 'Inset changes preserve the editor')
  await page.evaluate(() => {
    window.keyboardListeners.keyboardWillShow({ endCoordinates: { height: 300, screenY: 500 } })
    window.setAppState('inactive')
    window.setAppState('background')
  })
  await page.waitForFunction(
    () => document.querySelector('[data-keyboard-avoidance]').dataset.keyboardAvoidance === 'false',
  )
  await page.evaluate(() => {
    window.setAppState('active')
    window.keyboardListeners.keyboardWillShow({ endCoordinates: { height: 0, screenY: 0 } })
  })
  assert.equal(await keyboardEnabled(), 'false')
  assert.equal(
    await draft.inputValue(),
    'Unsaved draft',
    'Sleep and wake must keep the open composer mounted',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile New thread: trailing native action, preserved tab, offline guard, keyboard hiding, no More tab and Android floating action pass. Native controls use browser adapters.',
  )
} finally {
  await browser.close()
}
