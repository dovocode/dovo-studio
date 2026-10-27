import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real screen, rows, lifecycle actions, runtime provider/selectors and list view state.
// Native controls/storage/network are browser adapters; row-menu leaves count renders.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `
import {createContext,useContext,forwardRef,useImperativeHandle} from 'react';
const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
const nativeStyle=style=>{const result={...flat(style)};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(key in result){for(const axis of axes)result[axis]=result[key];delete result[key]}};if(typeof result.lineHeight==='number')result.lineHeight+='px';return result};
export const View=({children,accessibilityLabel,style})=><div aria-label={accessibilityLabel} style={window.rowLayout?{display:'flex',flexDirection:'column',position:'relative',flexShrink:0,...nativeStyle(style)}:{opacity:flat(style).opacity}}>{children}</div>;
export const Text=({children,accessibilityRole,numberOfLines,style})=>{const value=flat(style),scale=window.rowFontScale??1;return <span role={accessibilityRole} style={window.rowLayout?{display:'block',minWidth:0,...nativeStyle({...value,fontSize:(value.fontSize??13)*scale,...(value.lineHeight?{lineHeight:value.lineHeight*scale}:{})}),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}:value}>{children}</span>};
export const Image=()=>null;
export const useWindowDimensions=()=>({width:390,height:844,fontScale:window.rowFontScale??1,scale:3});
export const ScrollView=View;
export const Pressable=({children,onPress,onLongPress,disabled,accessibilityLabel,accessibilityState,testID,style})=><button style={window.rowLayout?{display:'flex',position:'relative',boxSizing:'border-box',background:'transparent',padding:0,border:0,textAlign:'left',...nativeStyle(typeof style==='function'?style({pressed:false}):style)}:{opacity:(typeof style==='function'?style({pressed:false}):style)?.opacity}} data-testid={testID} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={event=>{event.stopPropagation();onPress?.(event)}} onContextMenu={event=>{event.preventDefault();onLongPress?.()}}>{typeof children==='function'?children({pressed:false}):children}</button>;
export const FlatList=forwardRef(function FlatList({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,ListFooterComponent,ListFooterComponentStyle,testID,contentContainerStyle},ref){
  useImperativeHandle(ref,()=>({scrollToOffset:()=>{}}),[]);
  return <div data-testid={testID} style={window.rowLayout?{boxSizing:'border-box',display:'flex',flexDirection:'column',...nativeStyle(contentContainerStyle)}:undefined}>{ListHeaderComponent}{data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>)}{data.length?null:ListEmptyComponent}<div data-list-footer style={{display:'flex',flexDirection:'column',...nativeStyle(ListFooterComponentStyle)}}>{ListFooterComponent}</div></div>
});
export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};
export const Platform={OS:'ios'};
export const AccessibilityInfo={announceForAccessibility:message=>window.announcements?.push(message)};
export const Alert={alert:(title,message,buttons)=>{window.alerts.push({title,message});buttons?.find(button=>button.style!=='cancel')?.onPress?.()}};
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}>{label}</button>;
export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;
export const SettingsAction=Action;
export const SettingsSearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;
const SheetNavigation=window.fixtureSheetNavigation??=createContext(callback=>callback());
export const useSheetNavigation=()=>useContext(SheetNavigation);
export const Sheet=forwardRef(function Sheet({title,children,onClose},ref){const parent=useSheetNavigation();const dismiss=after=>{onClose();after?.()};useImperativeHandle(ref,()=>({dismiss}));return <div role="dialog" aria-label={title}><SheetNavigation.Provider value={callback=>dismiss(()=>parent(callback))}>{children}</SheetNavigation.Provider><button onClick={onClose}>Close details</button></div>});
export const ScreenHeader=({title,buttons})=><header><h1>{title}</h1>{buttons?.map(button=><button key={button.label} aria-pressed={button.selected} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;
export const SettingsChoice=({label,value,items,onChange})=><label>{label}<select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const useTheme=()=>window.rowTheme??{styles:{},colors:{}};
`
const preferenceModule = `
import {useSyncExternalStore} from 'react';
const preferences={threadDensity:'compact',computerRefresh:'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[],taskSort:'newest',taskGrouping:'none',threadSectionOrder:['active','working','waiting','snoozed','settled'],workingSection:false,collapsedThreadSections:['working','snoozed'],confirmArchive:false};
window.listPreferences??=preferences;window.preferenceListeners??=new Set();window.setListPreferences=changes=>{window.listPreferences={...window.listPreferences,...changes};window.preferenceListeners.forEach(notify=>notify())};
export const useMobilePreferences=()=>useSyncExternalStore(notify=>{window.preferenceListeners.add(notify);return()=>window.preferenceListeners.delete(notify)},()=>window.listPreferences);export const readMobilePreferences=()=>window.listPreferences;export const updateMobilePreferences=changes=>{window.listPreferences={...window.listPreferences,...changes};window.preferenceListeners.forEach(notify=>notify())};export const preferencesReady=Promise.resolve();export const useCarMode=()=>false;
`
const stubs = [
  { path: 'react-native-gesture-handler', contents: controls },
  { path: 'react-native', contents: controls },
  {
    path: 'lucide-react-native',
    contents: `const Icon=({color,accessibilityLabel,size=12})=><svg width={size} height={size} aria-label={accessibilityLabel} style={{color,flexShrink:0}}/>;export {Icon as GitMerge,Icon as GitPullRequest,Icon as GitPullRequestClosed,Icon as GitPullRequestDraft,Icon as Archive,Icon as CircleCheck,Icon as CircleDashed,Icon as CircleStop,Icon as CircleX,Icon as AlarmClock,Icon as CloudOff,Icon as FilePenLine,Icon as GitBranch,Icon as GitFork,Icon as MessageCircleQuestion,Icon as MessageCircle,Icon as Pin,Icon as Save,Icon as Network};`,
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
  { path: 'expo-router', contents: `export const router={push:href=>window.routes.push(href)};` },
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
    contents: `export const SectionOrderSheet=({onClose})=><div role="dialog" aria-label="Organize sections"><button onClick={onClose}>Close section order</button></div>;`,
  },
  {
    path: '../../shell/navigation',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: `export const useNavigation=()=>window.navigation;`,
  },
  {
    path: '../../ui/content/runtime-icon',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: `export const RuntimeIcon=()=>null;`,
  },
  {
    path: '../../ui/content/format-date',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: `export const formatDateTime=value=>value;`,
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
    contents: `export const HarnessIcon=({provider,size})=><span data-harness={provider} aria-hidden style={{display:'block',width:size,height:size,flexShrink:0}}/>;`,
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
export const TaskRowMenu=({testID,task,actions,onDetails})=>{window.rowRenders[task.id]=(window.rowRenders[task.id]??0)+1;if(window.rowLayout)return <div data-testid={testID} style={{width:44,height:44}}/>;return <div data-testid={testID}><button onClick={onDetails}>Details {task.id}</button><button disabled={!actions.enabled||actions.busy} onClick={actions.togglePinned}>{task.pinned?'Unpin':'Pin'} {task.id}</button></div>};`,
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
  ['../../ui/theme', 'runtime/connection/fleet-overview.tsx'],
  ['../../ui/theme', 'runtime/connection/connection-progress.tsx'],
  ['../../ui/content/text', 'runtime/connection/connection-progress.tsx'],
  ['../../ui/content/text', 'runtime/connection/fleet-overview.tsx'],
  ['../../ui/controls/icon', 'runtime/connection/fleet-overview.tsx'],
  ['../../ui/controls/action', 'runtime/connection/fleet-overview.tsx'],
  ['../../ui/layout/sheet', 'runtime/connection/fleet-overview.tsx'],
  ['../../ui/content/text', 'tasks/list/'],
  ['../../ui/controls/icon', 'tasks/list/task-list-row.tsx'],
  ['../../ui/theme', 'tasks/list/'],
  ['../theme', 'ui/content/pull-request-icon.tsx'],
  ['../theme', 'ui/content/empty-state.tsx'],
  ['./text', 'ui/content/empty-state.tsx'],
  ['../controls/icon', 'ui/content/empty-state.tsx'],
])
  stubs.push({ path, importer: mobile + importer, contents: controls })
stubs.push({
  path: './peer-native',
  importer: mobile + 'runtime/connection/peer-transport.ts',
  contents:
    'export const openPeerTunnel=async()=>{throw Error("LAN task list tests must not open a native peer")};',
})
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';
import {TaskPanesContext} from './apps/mobile/src/shell/task-panes';
import {runtimeProfile,runtimeSnapshotPath} from '@dovo/protocol';
import {studioThemes} from './packages/studio-core/src/themes.ts';
import {accessibleThemeColors} from './packages/studio-core/src/accessibility.ts';
window.titlePalettes=Object.entries(studioThemes).flatMap(([name,theme])=>['light','dark'].map(mode=>({name:name+'/'+mode,...accessibleThemeColors(theme[mode],mode,false)})));
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {RuntimeProvider,useRuntime} from './apps/mobile/src/runtime/connection/provider.tsx';
import {TaskListViewProvider} from './apps/mobile/src/tasks/list/task-list-view.tsx';
import TasksScreen from './apps/mobile/src/screens/tasks.tsx';
const now=Date.now(),iso=age=>new Date(now-age).toISOString();
const profile=runtimeProfile({address:'http://mobile-owner.lan:8787',token:'test-token-private-at-least-32-characters'},'Owner');
window.settledPath=()=>runtimeSnapshotPath(profile.connection);window.saved=JSON.stringify({version:1,activeId:profile.id,profiles:[profile]});
const base={repositoryId:'repo',agentId:'agent',draft:'',files:[],example:false,messages:[],status:'done',createdAt:iso(100000)};
const running={...base,id:'running',title:'Running task',status:'running',createdAt:iso(0)};
const child={...base,id:'child',title:'Child task',status:'running',delegation:{parentTaskId:'parent',parentRunId:'run',key:'child'}};
const parent={...base,id:'parent',title:'Parent task',subagents:[{id:'child',taskId:'child',source:'dovo',name:'Child agent',provider:'codex',status:'working',startedAt:iso(0),updatedAt:iso(0)}]};
window.snapshot={revision:1,owner:false,runtimeInstanceId:'fixture',workspace:{version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:'stale-branch'}],agents:[{id:'agent',name:'Agent',provider:'codex',model:'fixture',instructions:'',permission:'ask',endpoint:''}],automations:[],tasks:[running,parent,child,...Array.from({length:100},(_,index)=>({...base,id:'task-'+index,title:'Task '+index,createdAt:iso(index*1000+200000)}))]},questions:[],approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],acpInstallations:[]};
window.rowRenders={};window.alerts=[];window.requests=[];window.navigations=[];window.routes=[];
window.navigation={focused:true,navigate:(...args)=>window.navigations.push(args),setDetail:()=>{},openWork:()=>{}};
window.fetch=async(url,options)=>{
  const target=new URL(url),path=target.pathname,body=options?.body?JSON.parse(options.body):null;window.requests.push({path,body,origin:target.origin,method:options?.method});
  if(path==='/api/tasks/search'){if(window.searchFailure)return Response.json({error:'History unavailable'},{status:503});if(body.query==='old history')await new Promise(resolve=>window.finishOldSearch=resolve);return Response.json({taskIds:body.query==='history needle'?['task-98']:body.query==='old history'?['task-97']:[],hits:[]})};
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
function PaneProbe({children}){const [panes,setPanes]=useState({expanded:false,detailWidth:390});window.setPanes=value=>flushSync(()=>setPanes(value));return <TaskPanesContext.Provider value={panes}>{children}</TaskPanesContext.Provider>}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><RuntimeProvider><Probe/><TaskListViewProvider><PaneProbe><TasksScreen/></PaneProbe></TaskListViewProvider></RuntimeProvider></ApplicationStateProvider>);
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
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.route('http://mobile-task-list.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://mobile-task-list.lan/')
  if (process.env.DOVO_MOBILE_DENSITY_LAYOUT) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      window.rowLayout = true
      window.rowTheme = {
        styles: { muted: { color: '#aaa' } },
        colors: {
          text: '#eee',
          surface: '#191919',
          muted: '#aaa',
          accent: '#69f',
          success: '#4b8',
        },
      }
    })
    await page.addStyleTag({
      content:
        'body{margin:0;background:#111;font-family:system-ui}button{font:inherit}h1{color:#eee}#app{padding:8px}',
    })
  }
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByTestId('Task task-99').waitFor()
  const header = page.locator('header')
  for (const label of ['Projects', 'Quick task', 'Issues', 'Settings'])
    assert.equal(await header.getByRole('button', { name: label, exact: true }).count(), 1)
  assert.equal(await header.getByRole('button', { name: 'More', exact: true }).count(), 0)
  await header.getByRole('button', { name: 'Issues', exact: true }).click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[0]), 'issues')
  if (process.env.DOVO_MOBILE_DENSITY_LAYOUT) {
    const ids = ['running', 'parent', 'task-0', 'task-1', 'task-2', 'task-3']
    for (const width of [320, 390, 430, 544, 768, 1024, 1366]) {
      await page.setViewportSize({ width, height: 844 })
      const list = await page.getByTestId('Task list').boundingBox()
      assert.ok(list.width <= 1024 && list.width <= width, JSON.stringify({ width, list }))
      assert.ok(Math.abs(list.x - (width - list.width) / 2) < 1, JSON.stringify({ width, list }))

      for (const scale of [1, 1.5, 2]) {
        await page.evaluate((scale) => {
          window.rowFontScale = scale
          window.publish({
            running: { title: 'Short ' + scale },
            parent: { title: 'Has several subagents ' + scale },
            'task-0': {
              title: 'Long project and checkout ' + scale,
              checkoutBranch: 'feature/a-very-long-branch-name-that-must-not-wrap',
              pinned: true,
              execution: 'worktree',
              linkedPullRequests: [
                {
                  number: 12345,
                  url: 'https://github.com/team/project/pull/12345',
                  repositoryUrl: 'https://github.com/team/project',
                  title: 'Linked PR',
                },
              ],
            },
            'task-1': { title: 'General ' + scale, repositoryId: 'scratch', agentId: '' },
            'task-2': { title: 'Settled ' + scale, archived: true },
            'task-3': { title: 'Draft ' + scale, status: 'draft' },
          })
        }, scale)
        await page
          .getByTestId('Task task-1')
          .getByText('General ' + scale, { exact: true })
          .waitFor()
        const sizes = await Promise.all(
          ids.map((id) => page.getByTestId('Task ' + id).boundingBox()),
        )
        assert.ok(
          sizes.every(
            (size, index) =>
              size &&
              (index === 4
                ? size.height < sizes[0].height
                : Math.abs(size.height - sizes[0].height) < 0.5),
          ),
          JSON.stringify({ width, scale, sizes }),
        )
        assert.ok(sizes[0].height >= 44)
        for (const id of ids) {
          const row = page.getByTestId('Task ' + id)
          const title = await row
            .getByText(
              id === 'task-0'
                ? 'Long project and checkout ' + scale
                : id === 'task-1'
                  ? 'General ' + scale
                  : id === 'task-2'
                    ? 'Settled ' + scale
                    : id === 'task-3'
                      ? 'Draft ' + scale
                      : id === 'parent'
                        ? 'Has several subagents ' + scale
                        : 'Short ' + scale,
              { exact: true },
            )
            .boundingBox()
          if (id === 'task-2') {
            assert.ok(sizes[4].height >= 44)
            assert.ok(Math.abs(title.y + title.height / 2 - sizes[4].y - sizes[4].height / 2) < 1)
            continue
          }
          const project = await row
            .getByText(id === 'task-1' ? 'General' : 'Project', { exact: true })
            .boundingBox()
          assert.ok(
            project.y + project.height <= title.y,
            JSON.stringify({ id, width, scale, project, title }),
          )
        }
        const toggle = await page
          .getByRole('button', {
            name: 'Subthreads for Has several subagents ' + scale,
            exact: true,
          })
          .boundingBox()
        const menu = await page.getByTestId('Task parent actions').boundingBox()
        const parentRow = page.getByTestId('Task parent')
        assert.equal(await parentRow.locator('[data-harness]').count(), 1)
        assert.equal(
          await parentRow
            .locator('[data-harness]')
            .evaluate((icon) => icon.parentElement.textContent.includes('Project')),
          true,
          'Provider belongs beside project and status in the header',
        )
        const provider = await parentRow.locator('[data-harness]').boundingBox()
        const glyph = await page
          .getByRole('button', {
            name: 'Subthreads for Has several subagents ' + scale,
            exact: true,
          })
          .locator('svg')
          .boundingBox()
        assert.ok(
          Math.abs(provider.y + provider.height / 2 - glyph.y - glyph.height / 2) < 1,
          'Subthread icon aligns with header indicators',
        )
        assert.ok(toggle && menu && toggle.width === 44 && toggle.height === 44)
        assert.ok(toggle.x + toggle.width <= menu.x, 'Subthread and menu touch targets overlap')
        assert.ok(
          toggle.y >= sizes[1].y && toggle.y + toggle.height <= sizes[1].y + sizes[1].height,
        )
        for (const id of ids) {
          const bounds = await page
            .getByTestId('Task ' + id)
            .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
          assert.ok(
            bounds.scroll <= bounds.client + 1,
            JSON.stringify({ id, width, scale, bounds }),
          )
        }
      }
    }
    await page.evaluate(() => {
      window.rowFontScale = 1
      window.setListPreferences({ threadDensity: 'comfortable' })
    })
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      for (const scale of [1, 1.5, 2]) {
        await page.evaluate((scale) => {
          window.rowFontScale = scale
          window.publish({ parent: { title: 'Has several subagents ' + scale } })
        }, scale)
        await page
          .getByTestId('Task parent')
          .getByText('Has several subagents ' + scale, { exact: true })
          .waitFor()
        const row = page.getByTestId('Task parent')
        const provider = await row.locator('[data-harness]').boundingBox()
        const project = await row.getByText('Project', { exact: true }).boundingBox()
        const toggle = page.getByRole('button', { name: /^Subthreads for Has several subagents/ })
        const icon = await toggle.locator('svg').boundingBox()
        const menu = await page.getByTestId('Task parent actions').boundingBox()
        const touch = await toggle.boundingBox()
        assert.ok(Math.abs(provider.y + provider.height / 2 - icon.y - icon.height / 2) < 1)
        assert.ok(provider.y >= project.y - 1 && provider.y <= project.y + project.height)
        assert.equal(touch.width, 44)
        assert.equal(touch.height, 44)
        assert.ok(touch.x + touch.width <= menu.x)
        assert.ok(provider.x + provider.width <= touch.x)
      }
    }
    await page.screenshot({ path: '/tmp/dovo-compact-uniform-rows.png' })
    assert.deepEqual(errors, [])
    console.log(
      'Single-line settled rows and uniform open rows verified across phone and iPad widths and 1/1.5/2x text sizes.',
    )
    await browser.close()
    process.exit(0)
  }
  assert.equal(
    await page.locator('header').getByRole('button', { name: 'New thread', exact: true }).count(),
    0,
  )
  // Density changes update memoized rows in place and preserve their context.
  const densityTitle = page.getByTestId('Task task-0').getByText('Task 0', { exact: true })
  for (const [density, size, contextSize] of [
    ['comfortable', '16px', '12px'],
    ['compact', '15px', '11px'],
  ]) {
    await page.evaluate((density) => window.setListPreferences({ threadDensity: density }), density)
    await page.waitForFunction(
      ({ size }) =>
        [...document.querySelectorAll('[data-testid="Task task-0"] span')].some(
          (el) => el.textContent === 'Task 0' && getComputedStyle(el).fontSize === size,
        ),
      { size },
    )
    assert.equal(await densityTitle.evaluate((el) => getComputedStyle(el).fontSize), size)
    assert.equal(
      await page
        .getByTestId('Task task-0')
        .getByText('Project', { exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize),
      contextSize,
    )
    assert.equal(
      await page.getByTestId('Task task-0').getByText('main', { exact: true }).count(),
      1,
    )
  }
  assert.equal(
    await densityTitle.evaluate((el) => el.parentElement.parentElement.children.length),
    3,
    'Compact preserves project/status, title and checkout context',
  )
  assert.equal(
    await densityTitle.evaluate((el) => el.parentElement.children.length),
    1,
    'Compact title has its own row',
  )
  const historyInput = page.getByRole('textbox', { name: 'Search tasks', exact: true })
  await historyInput.fill('old history')
  await page.waitForFunction(() => !!window.finishOldSearch)
  await page.getByText('Searching conversation history…', { exact: true }).waitFor()
  await historyInput.fill('history needle')
  await page.getByTestId('Task task-98').waitFor()
  await page
    .getByText('Searching conversation history…', { exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('Task task-97').count(), 0)
  await page.evaluate(() => window.finishOldSearch())
  await page.waitForFunction(
    () => window.requests.filter((r) => r.path === '/api/tasks/search').length >= 2,
  )
  assert.equal(
    await page.getByTestId('Task task-98').count(),
    1,
    'A stale search must not replace current history results',
  )
  await page.evaluate(() => (window.searchFailure = true))
  await historyInput.fill('Task 99')
  await page.getByTestId('Task task-99').waitFor()
  await page.getByRole('alert').filter({ hasText: 'History unavailable' }).waitFor()
  assert.equal(
    await page.getByTestId('Task task-99').count(),
    1,
    'Local matches survive a history search error',
  )
  await page.evaluate(() => (window.searchFailure = false))
  await historyInput.fill('')
  await page.getByTestId('Task task-0').waitFor()
  const filters = page.getByRole('button', { name: 'Filters', exact: true })
  assert.equal(await page.getByRole('textbox', { name: 'Search tasks' }).count(), 1)
  assert.equal(await filters.getAttribute('aria-pressed'), 'false')
  await filters.click()
  const filterSheet = page.getByRole('dialog', { name: 'Filter threads', exact: true })
  assert.equal(await filterSheet.getByRole('textbox', { name: 'Search tasks' }).count(), 0)
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('Task 99')
  await page.getByTestId('Task task-0').waitFor({ state: 'detached' })
  await filterSheet.getByRole('button', { name: 'Close details' }).click()
  assert.equal(await filters.getAttribute('aria-pressed'), 'true')
  await page.getByTestId('Task task-99').waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Search tasks' }).count(), 1)
  await filters.click()
  assert.equal(await page.getByRole('textbox', { name: 'Search tasks' }).inputValue(), 'Task 99')
  await filterSheet.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByTestId('Task task-0').waitFor()
  assert.equal(await filters.getAttribute('aria-pressed'), 'false')
  await filterSheet.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('title')
  assert.equal(await page.evaluate(() => window.listPreferences.taskSort), 'title')
  await filterSheet.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('newest')
  await filterSheet.getByRole('combobox', { name: 'Group by', exact: true }).selectOption('project')
  assert.equal(await page.evaluate(() => window.listPreferences.taskGrouping), 'project')
  await filterSheet.getByRole('combobox', { name: 'Group by', exact: true }).selectOption('none')
  await filterSheet.getByRole('button', { name: 'Organize sections', exact: true }).click()
  await page.getByRole('dialog', { name: 'Organize sections', exact: true }).waitFor()
  assert.equal(await filterSheet.count(), 0)
  await page.getByRole('button', { name: 'Close section order', exact: true }).click()
  await filters.click()
  await filterSheet.getByRole('button', { name: 'Device overview', exact: true }).click()
  await page.getByRole('button', { name: /^Owner, Online,/ }).click()
  await page.getByRole('button', { name: 'View tasks on this device', exact: true }).click()
  assert.equal(await filters.getAttribute('aria-pressed'), 'true')
  await filterSheet.getByRole('button', { name: 'Clear filters', exact: true }).click()
  assert.equal(await filters.getAttribute('aria-pressed'), 'false')
  await filterSheet.getByRole('button', { name: 'Device overview', exact: true }).click()
  await page.getByRole('button', { name: /^Owner, Online,/ }).click()
  await page.getByRole('button', { name: 'Manage computers', exact: true }).click()
  assert.equal(await filterSheet.count(), 0, 'Navigation must dismiss both nested sheets')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[0]), 'settings')
  await page.waitForTimeout(100)
  await page.evaluate(() => {
    window.rowTheme = { styles: {}, colors: { success: '#00ee88', muted: '#777777' } }
    window.publish({
      'task-7': {
        linkedPullRequests: [7, 8].map((number) => ({
          number,
          url: 'https://github.com/o/r/pull/' + number,
          repositoryUrl: 'https://github.com/o/r',
          title: 'PR ' + number,
        })),
        pullStatus: {
          number: 7,
          url: 'https://github.com/o/r/pull/7',
          state: 'open',
          draft: false,
          checkedAt: new Date().toISOString(),
        },
      },
    })
  })
  const pullBadge = page.getByTestId('Task task-7')
  await pullBadge.getByText('2 PRs', { exact: true }).waitFor()
  assert.equal(await pullBadge.getByText('+1', { exact: true }).count(), 0)
  assert.equal(
    await pullBadge
      .getByText('2 PRs', { exact: true })
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(119, 119, 119)',
  )
  assert.equal(
    await pullBadge
      .locator('svg[aria-label="open pull request"]')
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(0, 238, 136)',
    'The PR state icon keeps its semantic color',
  )
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
  const beforeSubagents = await page.evaluate(() => window.navigations.length)
  const subthreads = page.getByRole('button', { name: 'Subthreads for Parent task', exact: true })
  assert.equal(await subthreads.getAttribute('aria-expanded'), 'false')
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search tasks', exact: true })
  await search.fill('Child task')
  await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).waitFor()
  assert.equal(await subthreads.getAttribute('aria-expanded'), 'true')
  assert.equal(await subthreads.isDisabled(), true)
  await search.fill('')
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  assert.equal(await subthreads.getAttribute('aria-expanded'), 'false')
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).count(),
    0,
  )
  await subthreads.click()
  await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.navigations.length),
    beforeSubagents,
    'Opening a nested child must not open the parent conversation',
  )
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1).params), {
    runtimeId: 'http://mobile-owner.lan:8787',
    taskId: 'child',
    parentRuntimeId: 'http://mobile-owner.lan:8787',
    parentTaskId: 'parent',
    parentTitle: 'Parent task',
  })
  // Remote attention changes the parent status even when its local row is unchanged.
  await page.evaluate(() =>
    window.publish({
      parent: {
        threadWatches: [
          {
            runtimeId: 'remote',
            threadId: 'remote-child',
            computerName: 'Server',
            relation: 'spawned',
            status: 'watching',
            offline: false,
            snapshot: {
              title: 'Remote child',
              phase: 'needs-input',
              revision: 'one',
              attention: ['question'],
              watches: { pipelines: 0, pullRequests: 0, failures: 0 },
            },
          },
        ],
      },
    }),
  )
  await page.getByTestId('Task parent').getByText('Needs input', { exact: true }).waitFor()
  await page.evaluate(() => window.publish({ parent: { threadWatches: [] } }))
  await page.getByTestId('Task parent').getByText('Working', { exact: true }).waitFor()
  await page.evaluate(() => {
    const parent = window.snapshot.workspace.tasks.find((task) => task.id === 'parent')
    window.publish({
      parent: {
        subagents: parent.subagents.map((agent) => ({
          ...agent,
          status: 'completed',
          finishedAt: new Date().toISOString(),
        })),
      },
      child: { status: 'done' },
    })
  })
  await page.getByTestId('Task parent').getByText('Finished', { exact: true }).waitFor()
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
  await page.evaluate(() => window.setListPreferences({ threadDensity: 'comfortable' }))
  let minimumContrast = Infinity
  for (const palette of await page.evaluate(() => window.titlePalettes)) {
    await page.evaluate((palette) => {
      window.rowTheme = {
        styles: {},
        colors: {
          text: palette.foreground,
          muted: palette['muted-foreground'],
          surface: palette.background,
        },
      }
      window.publish({ 'task-0': { title: palette.name + ' read', status: 'done' } })
    }, palette)
    const title = page.getByTestId('Task task-0').getByText(palette.name + ' read', { exact: true })
    const style = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), weight: style.fontWeight }
    })
    assert.equal(style.opacity, 1, palette.name + ' read title must retain contrast')
    assert.equal(style.weight, '500')
    const metadataOpacity = () =>
      title.evaluate((element) =>
        [
          element.parentElement.previousElementSibling,
          element.parentElement.nextElementSibling,
        ].map((row) => Number(getComputedStyle(row).opacity)),
      )
    assert.deepEqual(
      await metadataOpacity(),
      [1, 1],
      palette.name + ' read metadata must retain contrast',
    )
    await page.evaluate(() => window.publish({ 'task-0': { status: 'running' } }))
    const unreadStyle = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), weight: style.fontWeight }
    })
    assert.equal(unreadStyle.opacity, 1, palette.name + ' unread title must stay opaque')
    assert.equal(unreadStyle.weight, '600', palette.name + ' unread title must use stronger weight')
    assert.deepEqual(
      await metadataOpacity(),
      [1, 1],
      palette.name + ' unread metadata must stay opaque',
    )
    const background = luminance(
      'rgb(' +
        palette.background
          .match(/\w\w/g)
          .map((c) => parseInt(c, 16))
          .join(',') +
        ')',
    )
    assert.notEqual(style.color, unreadStyle.color, palette.name + ' read titles must look quieter')
    const foreground = luminance(unreadStyle.color)
    const readForeground = luminance(style.color)
    const contrast = Math.min(
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
      (Math.max(background, readForeground) + 0.05) / (Math.min(background, readForeground) + 0.05),
    )
    minimumContrast = Math.min(minimumContrast, contrast)
    assert.ok(contrast >= 4.5, `${palette.name} unread title contrast ${contrast}`)
  }
  assert.equal(await page.getByTestId('Task task-0').locator('[data-harness]').count(), 1)
  assert.equal(await page.getByTestId('Task task-0').getByText('Codex', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    `Mobile task titles: quieter read text and stronger unread weight verified across 28 shipped palette/mode combinations; read/unread contrast >= ${minimumContrast.toFixed(2)}:1.`,
  )
  // Settled rows keep one line, with project details on the icon and in accessibility text.
  await page.evaluate(() => window.publish({ 'task-1': { archived: true } }))
  const settled = page.getByTestId('Task task-1')
  await settled.waitFor()
  assert.equal(await settled.getByText('Project', { exact: true }).count(), 0)
  assert.match(await settled.getAttribute('aria-label'), /Project/)
  assert.equal(await settled.getByText('Settled', { exact: true }).count(), 1)
  assert.equal(await settled.getByText('Task 1', { exact: true }).count(), 1)
  assert.equal(await page.getByTestId('Task task-1 actions').count(), 0)
  assert.equal(
    await settled
      .getByText('Task 1', { exact: true })
      .evaluate((el) => getComputedStyle(el).opacity),
    '1',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Task details for Task 1', exact: true })
      .evaluate((el) => getComputedStyle(el).opacity),
    '1',
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
  await page.evaluate(() =>
    window.publish({
      'task-5': { repositoryId: 'scratch', execution: 'worktree', checkoutBranch: 'stale-branch' },
    }),
  )
  const general = page.getByTestId('Task task-5')
  assert.ok((await general.textContent()).includes('General'))
  assert.ok(!/stale-branch|Project checkout|No project/.test(await general.textContent()))
  assert.ok(!/Local checkout|Worktree/.test(await general.getAttribute('aria-label')))
  await page.getByRole('button', { name: 'Details task-5', exact: true }).click()
  const generalDetails = page.getByRole('dialog', { name: 'Task details' })
  await generalDetails.waitFor()
  assert.ok((await generalDetails.textContent()).includes('General'))
  assert.ok(!/stale-branch|Project checkout|No project/.test(await generalDetails.textContent()))
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await page.evaluate(() =>
    window.publish(
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['task-' + i, { archived: true }])),
    ),
  )
  await page.evaluate(() =>
    window.publish({
      'task-5': {
        archived: false,
        linkedCheckouts: [
          { id: 'link', repositoryId: 'repo', execution: 'main', access: 'read-only' },
        ],
      },
    }),
  )
  assert.ok((await general.textContent()).includes('Project'))
  assert.ok(!/Local checkout|Worktree|stale-branch/.test(await general.getAttribute('aria-label')))
  await page.evaluate(() => window.publish({ 'task-5': { archived: true } }))
  const allHistory = page.getByRole('button', { name: 'Show all 12 settled threads', exact: true })
  await allHistory.waitFor()
  assert.equal(
    await page.getByRole('button', { name: /^Task details for /, exact: true }).count(),
    5,
  )
  await allHistory.click()
  await page.getByTestId('Task task-11').waitFor()
  await page.getByRole('button', { name: 'Show fewer settled threads', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: /^Task details for /, exact: true }).count(),
    5,
  )
  for (const sort of ['newest', 'oldest', 'title', 'project']) {
    await page.evaluate((taskSort) => window.setListPreferences({ taskSort }), sort)
    await page.waitForFunction(() => !window.settledPath().includes('settled='))
  }
  for (const sort of ['activity', 'priority']) {
    await page.evaluate((taskSort) => window.setListPreferences({ taskSort }), sort)
    await page.waitForFunction(() => window.settledPath().includes('settled=25'))
  }
  await page.evaluate(() => {
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      olderSettled: { limit: 25, omitted: 13 },
    }
    window.pushSnapshot(window.snapshot)
  })
  await page.getByRole('button', { name: 'Show more settled threads', exact: true }).click()
  await page.getByRole('button', { name: 'Load more settled threads', exact: true }).click()
  await page.waitForFunction(() => window.settledPath().includes('settled=50'))
  await page.evaluate(() => {
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      olderSettled: { limit: 50, omitted: 0 },
    }
    window.pushSnapshot(window.snapshot)
  })
  await page.getByRole('button', { name: 'Show fewer settled threads', exact: true }).click()
  await page.waitForFunction(() => window.settledPath().includes('settled=25'))
  await filters.click()
  await page.getByRole('textbox', { name: 'Search tasks', exact: true }).fill('Task 11')
  await page.waitForFunction(() => !window.settledPath().includes('settled='))
  await page.getByTestId('Task task-11').waitFor()
  assert.equal(await page.getByRole('button', { name: /Show all \d+ settled threads/ }).count(), 0)
  await page.getByRole('textbox', { name: 'Search tasks', exact: true }).fill('')
  await allHistory.waitFor()
  await filterSheet.getByRole('button', { name: 'Close details' }).click()
  await page.evaluate(() =>
    window.setPanes({
      expanded: true,
      detailWidth: 640,
      selected: { runtimeId: window.runtime.activeId, taskId: 'running' },
    }),
  )
  assert.equal(await page.getByTestId('Task running').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByTestId('Task parent').getAttribute('aria-pressed'), 'false')
  await page.evaluate(() =>
    window.setPanes({
      expanded: true,
      detailWidth: 640,
      selected: { runtimeId: window.runtime.activeId, taskId: 'task-0' },
    }),
  )
  const selectedReadTitle = page
    .getByTestId('Task task-0')
    .getByText(
      await page.evaluate(
        () => window.snapshot.workspace.tasks.find((task) => task.id === 'task-0').title,
      ),
      { exact: true },
    )
  assert.equal(
    await selectedReadTitle.evaluate((element) => {
      const expected = document.createElement('span')
      expected.style.color = window.rowTheme.colors.text
      return getComputedStyle(element).color === expected.style.color
    }),
    true,
    'Current read titles have full foreground emphasis',
  )
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), '/new')
  await page.evaluate(() =>
    window.setPanes({
      expanded: true,
      detailWidth: 640,
      selected: { runtimeId: 'another-computer', taskId: 'running' },
    }),
  )
  assert.equal(await page.getByTestId('Task running').getAttribute('aria-pressed'), 'false')
  assert.deepEqual(errors, [])
  await page.evaluate(() => {
    window.rowLayout = true
    window.setListPreferences({
      taskGrouping: 'none',
      workingSection: true,
      collapsedThreadSections: ['settled'],
    })
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      olderSettled: undefined,
      workspace: {
        ...window.snapshot.workspace,
        tasks: window.snapshot.workspace.tasks
          .filter((task) => ['running', 'task-0'].includes(task.id))
          .map((task) => (task.id === 'task-0' ? { ...task, archived: true } : task)),
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  const footer = page.getByLabel('Collapsed thread categories', { exact: true })
  await footer.waitFor()
  await page.getByTestId('Task list').evaluate((element) => (element.style.minHeight = '650px'))
  const collapsedBox = await footer.boundingBox()
  const listBox = await page.getByTestId('Task list').boundingBox()
  assert.ok(listBox.height >= 650)
  assert.ok(
    Math.abs(collapsedBox.y + collapsedBox.height - listBox.y - listBox.height) < 50,
    'Collapsed mobile categories sit at the bottom of available list space',
  )
  await footer.getByRole('button', { name: /^Settled,/ }).click()
  await page.getByTestId('Task task-0').waitFor()
  assert.equal(await page.getByLabel('Collapsed thread categories', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /^Settled,/ }).click()
  await footer.waitFor()
  assert.equal(await page.getByTestId('Task task-0').count(), 0)
  console.log(
    'Mobile task list: 102 real rows mounted; 30 streaming updates rendered only the running row 30 times. Compact settled rows, reopen transitions, details/navigation, child navigation, selection and owner-bound pin lifecycle verified with the real RuntimeProvider and selectors.',
  )
} finally {
  await browser.close()
}

// Include geometric regression coverage in the normal CI suite as well as direct layout runs.
if (!process.env.DOVO_MOBILE_DENSITY_LAYOUT) {
  const layout = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, DOVO_MOBILE_DENSITY_LAYOUT: '1' },
  })
  assert.equal(layout.status, 0, 'Mobile density layout regression failed')
}
