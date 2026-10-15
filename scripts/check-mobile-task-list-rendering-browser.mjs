import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real screen, rows, lifecycle actions, runtime provider/selectors and list view state.
// Native controls/storage/network are browser adapters; row-menu leaves count renders.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `
import {forwardRef,useImperativeHandle} from 'react';
export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
export const Text=({children,accessibilityRole,style})=><span role={accessibilityRole} style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;
export const Image=()=>null;
export const ScrollView=View;
export const Pressable=({children,onPress,onLongPress,disabled,accessibilityLabel,accessibilityState,testID})=><button data-testid={testID} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} onContextMenu={event=>{event.preventDefault();onLongPress?.()}}>{typeof children==='function'?children({pressed:false}):children}</button>;
export const FlatList=forwardRef(function FlatList({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,testID},ref){
  useImperativeHandle(ref,()=>({scrollToOffset:()=>{}}),[]);
  return <div data-testid={testID}>{ListHeaderComponent}{data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>)}{data.length?null:ListEmptyComponent}</div>
});
export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};
export const Alert={alert:(title,message,buttons)=>{window.alerts.push({title,message});buttons?.find(button=>button.style!=='cancel')?.onPress?.()}};
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}>{label}</button>;
export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;
export const SettingsAction=Action;
export const SettingsSearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close details</button></div>;
export const ScreenHeader=({title})=><h1>{title}</h1>;
export const useTheme=()=>window.rowTheme??{styles:{},colors:{}};
`
const preferenceModule = `
const preferences={computerRefresh:'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[],taskSort:'newest',taskGrouping:'none',threadSectionOrder:['active','working','waiting','snoozed','settled'],workingSection:false,collapsedThreadSections:['working','snoozed'],confirmArchive:false};
export const useMobilePreferences=()=>preferences;export const readMobilePreferences=()=>preferences;export const updateMobilePreferences=()=>{};export const preferencesReady=Promise.resolve();export const useCarMode=()=>false;
`
const stubs = [
  { path: 'react-native', contents: controls },
  {
    path: 'lucide-react-native',
    contents: `const Icon=()=>null;export {Icon as Archive,Icon as CircleCheck,Icon as CircleDashed,Icon as CircleStop,Icon as CircleX,Icon as AlarmClock,Icon as CloudOff,Icon as FilePenLine,Icon as GitBranch,Icon as GitFork,Icon as MessageCircleQuestion,Icon as Pin,Icon as Save};`,
  },
  {
    path: '@dovo/protocol',
    contents: `
export * from '${root}packages/protocol/src/index.ts';
import {decode,snapshotSchema} from '${root}packages/protocol/src/index.ts';
import {setRuntimeSnapshotTag} from '${root}packages/protocol/src/shared/client.ts';
export const startRuntimeSync=(connection,options)=>{
  window.pushSnapshot=value=>{const snapshot=decode(snapshotSchema,value);setRuntimeSnapshotTag(snapshot,'fixture-'+snapshot.revision);options.onSnapshot(snapshot)};
  queueMicrotask(()=>window.pushSnapshot(window.snapshot));
  return {online:()=>true,refresh:()=>{},stop:()=>{}};
};`,
  },
  {
    path: 'expo-network',
    contents: `export const addNetworkStateListener=()=>({remove:()=>{}});export const getNetworkStateAsync=async()=>({isConnected:true});export const NetworkStateType={CELLULAR:'cellular'};`,
  },
  {
    path: 'expo-secure-store',
    contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=async key=>key==='dovo.runtime.registry'?window.saved:null;export const setItemAsync=async(key,value)=>{if(key==='dovo.runtime.registry')window.saved=value};export const deleteItemAsync=async()=>{};`,
  },
  { path: 'expo-router', contents: `export const router={push:()=>{}};` },
  {
    path: './read-cache',
    importer: mobile + 'runtime/connection/provider.tsx',
    contents: `export {browserReadCache as mobileReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
  },
  {
    path: './mutation-storage',
    importer: mobile + 'runtime/connection/provider.tsx',
    contents: `export {browserMutationStorage as mobileMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
  },
  {
    path: '../preferences/app-preferences',
    importer: mobile + 'runtime/connection/provider.tsx',
    contents: preferenceModule,
  },
  {
    path: '../runtime/preferences/app-preferences',
    importer: mobile + 'screens/tasks.tsx',
    contents: preferenceModule,
  },
  {
    path: '../../runtime/preferences/app-preferences',
    importer: mobile + 'tasks/',
    contents: preferenceModule,
  },
  {
    path: '../shell/navigation',
    importer: mobile + 'screens/tasks.tsx',
    contents: `export const useNavigation=()=>window.navigation;`,
  },
  {
    path: '../tasks/list/section-order-sheet',
    importer: mobile + 'screens/tasks.tsx',
    contents: `export const SectionOrderSheet=()=>null;`,
  },
  {
    path: '../runtime/connection/fleet-overview',
    importer: mobile + 'screens/tasks.tsx',
    contents: `export const FleetOverview=()=>null;`,
  },
  {
    path: '../tasks/list/project-thread-filter',
    importer: mobile + 'screens/tasks.tsx',
    contents: `export const ProjectThreadFilter=()=>null;`,
  },
  {
    path: '../tasks/detail/lifecycle-actions',
    importer: mobile + 'screens/tasks.tsx',
    contents: `export const LifecycleActions=()=>null;`,
  },
  { path: './settings-controls', importer: mobile + 'screens/tasks.tsx', contents: controls },
  {
    path: '../../agents/harness-icon',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const HarnessIcon=()=>null;`,
  },
  {
    path: '../../agents/use-model-catalog',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const useCachedModelCatalog=()=>({modelName:'Fixture model',catalog:null});`,
  },
  {
    path: './device-label',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const DeviceLabel=()=>null;`,
  },
  {
    path: './task-row-menu',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `
export const TaskRowMenu=({testID,task,actions,onDetails})=>{window.rowRenders[task.id]=(window.rowRenders[task.id]??0)+1;return <div data-testid={testID}><button onClick={onDetails}>Details {task.id}</button><button disabled={!actions.enabled||actions.busy} onClick={actions.togglePinned}>{task.pinned?'Unpin':'Pin'} {task.id}</button></div>};`,
  },
  {
    path: './task-swipe-actions',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const TaskSwipeActions=({children})=>children;`,
  },
]
for (const [path, importer] of [
  ['../ui/content/text', 'screens/tasks.tsx'],
  ['../ui/layout/sheet', 'screens/tasks.tsx'],
  ['../ui/controls/icon', 'screens/tasks.tsx'],
  ['../ui/controls/icon-button', 'screens/tasks.tsx'],
  ['../ui/layout/screen-header', 'screens/tasks.tsx'],
  ['../ui/theme', 'screens/tasks.tsx'],
  ['../../ui/content/text', 'tasks/list/task-list-row.tsx'],
  ['../../ui/controls/icon', 'tasks/list/task-list-row.tsx'],
  ['../../ui/theme', 'tasks/list/task-list-row.tsx'],
])
  stubs.push({ path, importer: mobile + importer, contents: controls })
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {runtimeProfile} from '@dovo/protocol';
import {studioThemes} from './packages/studio-core/src/themes.ts';
window.titlePalettes=Object.entries(studioThemes).flatMap(([name,theme])=>['light','dark'].map(mode=>({name:name+'/'+mode,...theme[mode]})));
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {RuntimeProvider,useRuntime} from './apps/mobile/src/runtime/connection/provider.tsx';
import {TaskListViewProvider} from './apps/mobile/src/tasks/list/task-list-view.tsx';
import TasksScreen from './apps/mobile/src/screens/tasks.tsx';
const now=Date.now(),iso=age=>new Date(now-age).toISOString();
const profile=runtimeProfile({address:'http://mobile-owner.lan:8787',token:'test-token-private-at-least-32-characters'},'Owner');
window.saved=JSON.stringify({version:1,activeId:profile.id,profiles:[profile]});
const base={repositoryId:'repo',agentId:'agent',draft:'',files:[],example:false,messages:[],status:'done',createdAt:iso(100000)};
const running={...base,id:'running',title:'Running task',status:'running',createdAt:iso(0)};
const child={...base,id:'child',title:'Child task',status:'running',delegation:{parentTaskId:'parent',parentRunId:'run',key:'child'}};
const parent={...base,id:'parent',title:'Parent task',subagents:[{id:'child',taskId:'child',source:'dovo',name:'Child agent',provider:'codex',status:'working',startedAt:iso(0),updatedAt:iso(0)}]};
window.snapshot={revision:1,owner:false,runtimeInstanceId:'fixture',workspace:{version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'}],agents:[{id:'agent',name:'Agent',provider:'codex',model:'fixture',instructions:'',permission:'ask',endpoint:''}],automations:[],tasks:[running,parent,child,...Array.from({length:100},(_,index)=>({...base,id:'task-'+index,title:'Task '+index,createdAt:iso(index*1000+200000)}))]},questions:[],approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],acpInstallations:[]};
window.rowRenders={};window.alerts=[];window.requests=[];window.navigations=[];
window.navigation={focused:true,navigate:(...args)=>window.navigations.push(args),setDetail:()=>{},openWork:()=>{}};
window.fetch=async(url,options)=>{
  const target=new URL(url),path=target.pathname,body=options?.body?JSON.parse(options.body):null;window.requests.push({path,body,origin:target.origin,method:options?.method});
  if(path==='/api/mutations/status')return Response.json({version:1});
  if(path==='/api/workspace'&&options?.method==='PATCH')return Response.json({revision:window.snapshot.revision+1,runtimeInstanceId:'fixture'});
  if(path==='/api/runtime')return Response.json(window.snapshot,{headers:{ETag:'fixture-'+window.snapshot.revision}});
  return Response.json({ok:true});
};
window.publish=changes=>flushSync(()=>{
  window.snapshot={...window.snapshot,revision:window.snapshot.revision+1,workspace:{...window.snapshot.workspace,tasks:window.snapshot.workspace.tasks.map(task=>changes[task.id]?{...task,...changes[task.id]}:task)}};
  window.pushSnapshot(window.snapshot);
});
function Probe(){window.runtime=useRuntime();return null}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><RuntimeProvider><Probe/><TaskListViewProvider><TasksScreen/></TaskListViewProvider></RuntimeProvider></ApplicationStateProvider>);
`,
    },
    conditions: ['development'],
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
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
  },
  stubs,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.route('http://mobile-task-list.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://mobile-task-list.lan/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByTestId('Task task-99').waitFor()
  await page.waitForTimeout(100)
  await page.evaluate(() => {
    window.rowRenders = {}
    for (let frame = 0; frame < 30; frame++)
      window.publish({
        running: { messages: [{ id: 'stream', role: 'assistant', text: 'Chunk ' + frame }] },
      })
  })
  const renders = await page.evaluate(() => window.rowRenders)
  assert.equal(renders.running, 30)
  assert.deepEqual(
    Object.keys(renders),
    ['running'],
    'streaming re-rendered unrelated mobile rows or lifecycle subscribers',
  )
  await page.evaluate(() => window.publish({ 'task-5': { title: 'Renamed task' } }))
  await page.getByRole('button', { name: 'Details task-5', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Task details' })
    .getByText('Renamed task', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await page.getByTestId('Task task-5').click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'task-5')
  await page.getByRole('button', { name: /Open subagent Child agent/ }).click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'child')
  await page.getByTestId('Task task-2').dispatchEvent('contextmenu')
  await page.getByTestId('Task task-3').click()
  await page.getByText('2 selected', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clear task selection', exact: true }).click()
  await page.evaluate(() => window.publish({ 'task-4': { pinned: true } }))
  await page.getByRole('button', { name: 'Unpin task-4', exact: true }).click()
  await page
    .waitForFunction(
      () =>
        window.requests.some(
          (request) => request.path === '/api/workspace' && request.body?.id === 'task-4',
        ),
      undefined,
      { timeout: 5000 },
    )
    .catch(async (error) => {
      console.error(
        await page.evaluate(() => ({
          requests: window.requests,
          alerts: window.alerts,
          errors: [...document.querySelectorAll('[role=alert]')].map(
            (element) => element.textContent,
          ),
        })),
      )
      throw error
    })
  const pin = await page.evaluate(() =>
    window.requests.find(
      (request) => request.path === '/api/workspace' && request.body?.id === 'task-4',
    ),
  )
  assert.equal(pin.origin, 'http://mobile-owner.lan:8787')
  assert.equal(pin.method, 'PATCH')
  assert.deepEqual(pin.body.changes, { pinned: { before: true, after: false } })
  const luminance = (color) => {
    const rgb = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
    return rgb.reduce((sum, value, index) => {
      const channel = value / 255
      return (
        sum +
        [0.2126, 0.7152, 0.0722][index] *
          (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      )
    }, 0)
  }
  let minimumContrast = Infinity
  for (const palette of await page.evaluate(() => window.titlePalettes)) {
    await page.evaluate((palette) => {
      window.rowTheme = { styles: {}, colors: { text: palette.foreground, surface: palette.card } }
      window.publish({ 'task-0': { title: palette.name + ' read', status: 'done' } })
    }, palette)
    const title = page.getByTestId('Task task-0').getByText(palette.name + ' read', { exact: true })
    const style = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), weight: style.fontWeight }
    })
    assert.equal(style.opacity, 0.4, palette.name + ' read title must be dimmed')
    assert.equal(style.weight, '500')
    await page.evaluate(() => window.publish({ 'task-0': { status: 'running' } }))
    const unreadStyle = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), weight: style.fontWeight }
    })
    assert.equal(unreadStyle.opacity, 1, palette.name + ' unread title must stay opaque')
    assert.equal(unreadStyle.weight, style.weight)
    const background = luminance(
      'rgb(' +
        palette.card
          .match(/\w\w/g)
          .map((c) => parseInt(c, 16))
          .join(',') +
        ')',
    )
    const foreground = luminance(unreadStyle.color)
    const contrast =
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    minimumContrast = Math.min(minimumContrast, contrast)
    assert.ok(contrast >= 4.5, `${palette.name} unread title contrast ${contrast}`)
  }
  assert.deepEqual(errors, [])
  console.log(
    `Mobile task titles: read dimming and unread emphasis verified across 28 shipped palette/mode combinations; unread contrast >= ${minimumContrast.toFixed(2)}:1.`,
  )
  // Settled rows keep only the project icon and title, with details on the icon.
  await page.evaluate(() => window.publish({ 'task-1': { archived: true } }))
  const settled = page.getByTestId('Task task-1')
  await settled.waitFor()
  assert.equal(await settled.textContent(), 'Task 1')
  assert.equal(await page.getByTestId('Task task-1 actions').count(), 0)
  assert.equal(
    await settled
      .getByText('Task 1', { exact: true })
      .evaluate((el) => getComputedStyle(el).opacity),
    '0.4',
  )
  await settled.click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'task-1')
  await page.getByRole('button', { name: 'Task details for Task 1', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Task details' })
    .getByText('Task 1', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await page.evaluate(() => window.publish({ 'task-1': { archived: false } }))
  await page.getByTestId('Task task-1 actions').waitFor()
  assert.ok((await page.getByTestId('Task task-1').textContent()).includes('Project'))
  assert.deepEqual(errors, [])
  console.log(
    'Mobile task list: 102 real rows mounted; 30 streaming updates rendered only the running row 30 times. Compact settled rows, reopen transitions, details/navigation, child navigation, selection and owner-bound pin lifecycle verified with the real RuntimeProvider and selectors.',
  )
} finally {
  await browser.close()
}
