import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { checkMobileTaskSearch } from './browser/mobile-task-search.mjs'

// Real screen, rows, lifecycle actions, runtime provider/selectors and list view state.
// Native controls/storage/network are browser adapters; row-menu leaves count renders.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const catalog = JSON.parse(
  readFileSync(root + 'packages/studio-core/src/interface-catalog.json', 'utf8'),
)
const controls = `
import {createContext,useContext,forwardRef,useImperativeHandle,useLayoutEffect,useRef} from 'react';
const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
const nativeStyle=style=>{const result={...flat(style)};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(key in result){for(const axis of axes)result[axis]=result[key];delete result[key]}};if(typeof result.lineHeight==='number')result.lineHeight+='px';return result};
export const View=({children,accessibilityLabel,style,testID,ref,onLayout})=>{const node=useRef(null);useImperativeHandle(ref,()=>({nativeElement:node.current,measureLayout:(parent,done)=>{const bounds=node.current.getBoundingClientRect(),origin=parent.nativeElement.getBoundingClientRect();done(bounds.x-origin.x,bounds.y-origin.y,bounds.width,bounds.height)}}));useLayoutEffect(()=>{if(!onLayout)return;const measure=()=>onLayout({nativeEvent:{layout:{height:node.current.getBoundingClientRect().height}}});measure();const observer=new ResizeObserver(measure);observer.observe(node.current);return ()=>observer.disconnect()},[onLayout]);return <div ref={node} data-testid={testID} aria-label={accessibilityLabel} style={window.rowLayout?{boxSizing:'border-box',display:'flex',flexDirection:'column',position:'relative',flexShrink:0,...nativeStyle(style)}:{opacity:flat(style).opacity,display:flat(style).display}}>{children}</div>};
export const Text=({children,accessibilityRole,numberOfLines,style})=>{const value=flat(style),scale=window.rowFontScale??1;return <span role={accessibilityRole} style={window.rowLayout?{display:'block',minWidth:0,...nativeStyle({...value,fontSize:(value.fontSize??13)*scale,...(value.lineHeight?{lineHeight:value.lineHeight*scale}:{})}),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}:value}>{children}</span>};
export const Image=({source})=><span data-project-image={source?.uri}/>;
export const useWindowDimensions=()=>({width:390,height:844,fontScale:window.rowFontScale??1,scale:3});
export const ScrollView=View;
export const Pressable=({children,onPress,onLongPress,disabled,accessibilityLabel,accessibilityState,testID,style})=><button style={window.rowLayout?{display:'flex',position:'relative',boxSizing:'border-box',background:'transparent',padding:0,border:0,textAlign:'left',...nativeStyle(typeof style==='function'?style({pressed:false}):style)}:{opacity:(typeof style==='function'?style({pressed:false}):style)?.opacity}} data-testid={testID} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={event=>{event.stopPropagation();onPress?.(event)}} onContextMenu={event=>{event.preventDefault();onLongPress?.()}}>{typeof children==='function'?children({pressed:false}):children}</button>;
export const FlatList=forwardRef(function FlatList({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,ListFooterComponent,ListFooterComponentStyle,testID,contentContainerStyle,onScroll,onScrollBeginDrag,onScrollEndDrag,onScrollToTop},ref){
  window.listScrollHandlers={onScroll,onScrollBeginDrag,onScrollEndDrag,onScrollToTop};
  useImperativeHandle(ref,()=>({scrollToOffset:()=>{}}),[]);
  return <div data-testid={testID} style={window.rowLayout?{boxSizing:'border-box',display:'flex',flexDirection:'column',...nativeStyle(contentContainerStyle)}:undefined}>{ListHeaderComponent}{data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>)}{data.length?null:ListEmptyComponent}<div data-list-footer style={{display:'flex',flexDirection:'column',...nativeStyle(ListFooterComponentStyle)}}>{ListFooterComponent}</div></div>
});
export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};
export const Platform={OS:'ios'};
export const AccessibilityInfo={announceForAccessibility:message=>window.announcements?.push(message)};
export const Alert={alert:(title,message,buttons)=>{window.alerts.push({title,message});buttons?.find(button=>button.style!=='cancel')?.onPress?.()}};
export const Icon=({name})=><i data-icon={name}/>;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}>{label}</button>;
export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;
export const SettingsAction=Action;
export const SettingsSearchField=({label,value,onChangeText,inputRef,onFocus,onBlur})=><input ref={inputRef} aria-label={label} value={value} onFocus={onFocus} onBlur={onBlur} onChange={event=>onChangeText(event.target.value)}/>;
const SheetNavigation=window.fixtureSheetNavigation??=createContext(callback=>callback());
export const useSheetNavigation=()=>useContext(SheetNavigation);
export const Sheet=forwardRef(function Sheet({title,children,onClose},ref){const parent=useSheetNavigation();const dismiss=after=>{onClose();after?.()};useImperativeHandle(ref,()=>({dismiss}));return <div role="dialog" aria-label={title}><SheetNavigation.Provider value={callback=>dismiss(()=>parent(callback))}>{children}</SheetNavigation.Provider><button onClick={onClose}>Close details</button></div>});
export const ScreenHeader=({title,titleContent,buttons})=><header>{titleContent??<h1>{title}</h1>}{buttons?.map(button=><button key={button.label} aria-pressed={button.selected} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;
export const SettingsChoice=({label,value,items,onChange})=><label>{label}<select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const useTheme=()=>window.rowTheme??{styles:{},colors:{}};
`
const preferenceModule = `export * from '${mobile}runtime/preferences/app-preferences.ts';`
const stubs = [
  {
    path: '../bots/bot-create',
    importer: mobile + 'screens/',
    contents:
      'export const CreateBot=({onClose,onCreated})=><section role="dialog" aria-label="Create Bot"><button onClick={onClose}>Cancel Bot creation</button><button onClick={()=>onCreated("created-bot","r")}>Complete Bot creation</button></section>;',
  },
  {
    path: 'expo-crypto',
    contents: `let id=0;export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++id).padStart(12,'0');`,
  },
  {
    path: './shared-state-storage',
    importer: mobile + 'runtime/connection/provider.tsx',
    contents: `export {mobileSharedStateStorage,mobileThreadStateStorage} from '${root}scripts/browser/mobile-state-storage.mjs';`,
  },
  {
    path: '@react-native-async-storage/async-storage',
    contents: `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};`,
  },
  { path: 'react-native-gesture-handler', contents: controls },
  { path: 'react-native', contents: controls },
  {
    path: 'lucide-react-native',
    contents: `const Icon=({color,accessibilityLabel,size=12,style})=><svg width={size} height={size} aria-label={accessibilityLabel} style={{color,flexShrink:0,transform:style?.transform?.map(value=>'translateY('+value.translateY+'px)').join(' ')}}/>;export {Icon as Pause,Icon as GitMerge,Icon as GitPullRequest,Icon as GitPullRequestClosed,Icon as GitPullRequestDraft,Icon as Archive,Icon as CircleCheck,Icon as CircleDashed,Icon as CircleStop,Icon as CircleX,Icon as AlarmClock,Icon as CloudOff,Icon as FilePenLine,Icon as GitBranch,Icon as GitFork,Icon as MessageCircleQuestion,Icon as MessageCircle,Icon as MessageCircleDashed,Icon as Pin,Icon as Save,Icon as SquareTerminal,Icon as Network};`,
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
    path: '../../ui/content/runtime-icon',
    importer: mobile + 'tasks/list/device-label.tsx',
    contents: `export const RuntimeIcon=({size,color})=><svg data-runtime-icon width={size} height={size} style={{color,flexShrink:0}}/>;`,
  },
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
    path: './task-row-menu',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `
export const TaskRowMenu=({testID,task,actions,onDetails,contentOffsetY=0})=>{window.rowRenders[task.id]=(window.rowRenders[task.id]??0)+1;if(window.rowLayout)return <div data-testid={testID} style={{width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center'}}><span data-menu-glyph style={{lineHeight:'20px',transform:'translateY('+contentOffsetY+'px)'}}>•••</span></div>;return <div data-testid={testID}><button onClick={onDetails}>Details {task.id}</button><button disabled={!actions.enabled||actions.busy} onClick={actions.togglePinned}>{task.pinned?'Unpin':'Pin'} {task.id}</button></div>};`,
  },
  {
    path: './task-swipe-actions',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const TaskSwipeActions=({children})=>children;`,
  },
]
for (const [path, importer] of [
  ['../ui/content/text', 'screens/tasks.tsx'],
  ['../ui/content/text', 'bots/'],
  ['../ui/controls/icon', 'bots/'],
  ['../ui/theme', 'bots/'],
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
  ['../../ui/controls/icon', 'tasks/list/'],
  ['../../ui/theme', 'tasks/list/'],
  ['../../ui/content/text', 'tasks/detail/lifecycle-actions.tsx'],
  ['../../ui/controls/action', 'tasks/detail/lifecycle-actions.tsx'],
  ['../../ui/theme', 'tasks/detail/lifecycle-actions.tsx'],
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

// The Unified overview uses the same real rows and RuntimeProvider as the classic list.
stubs.push({
  path: '../shell/navigation',
  importer: mobile + 'workspace/',
  contents: 'export const useNavigation=()=>window.navigation;',
})
const workspaceControls =
  controls +
  `export const SearchField=SettingsSearchField;export const Choice=SettingsChoice;export const Glass=View;`
for (const path of [
  '../ui/content/text',
  '../ui/controls/icon',
  '../ui/controls/field',
  '../ui/controls/choice',
  '../ui/controls/action',
  '../ui/layout/sheet',
  '../ui/layout/screen-header',
  '../ui/theme',
])
  stubs.push({ path, importer: mobile + 'workspace/', contents: workspaceControls })
for (const [path, contents] of [
  ['../shell/more-actions', 'export const useMoreActions=()=>[];'],
  ['./workspace-starter', 'export const WorkspaceStarter=()=>null;'],
  ['./standalone-row', 'export const StandaloneRow=()=>null;'],
  ['./resource-actions', 'export const ResourceActions=()=>null;'],
])
  stubs.push({ path, importer: mobile + 'workspace/', contents })
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';
import {Effect} from 'effect';
import {LifecycleActions} from './apps/mobile/src/tasks/detail/lifecycle-actions';
import {dispatchKeyboardSearch} from './apps/mobile/src/shell/keyboard-search';window.focusTaskSearch=dispatchKeyboardSearch;
import {TaskPanesContext} from './apps/mobile/src/shell/task-panes';
import {runtimeProfile,runtimeSnapshotPath} from '@dovo/protocol';
import {studioThemes} from './packages/studio-core/src/themes.ts';
import {InterfaceLanguageProvider} from './packages/studio-core/src/interface-language.tsx';
import {accessibleThemeColors} from './packages/studio-core/src/accessibility.ts';
window.titlePalettes=Object.entries(studioThemes).flatMap(([name,theme])=>['light','dark'].map(mode=>({name:name+'/'+mode,...accessibleThemeColors(theme[mode],mode,false)})));
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {RuntimeProvider,RuntimeContext,useRuntime} from './apps/mobile/src/runtime/connection/provider.tsx';
import {TaskListViewProvider,useTaskListView} from './apps/mobile/src/tasks/list/task-list-view.tsx';
import {updateMobilePreferences,readMobilePreferences,preferencesReady} from '${mobile}runtime/preferences/app-preferences.ts';window.setListPreferences=updateMobilePreferences;Object.defineProperty(window,'listPreferences',{get:readMobilePreferences});window.preferencesReady=preferencesReady;
import TasksScreen from './apps/mobile/src/screens/tasks.tsx';
import {useMessageReveal} from './apps/mobile/src/tasks/conversation/message-reveal';
import {WorkspaceOverview} from './apps/mobile/src/workspace/workspace-overview';
import {WorkspaceViewProvider} from './apps/mobile/src/workspace/workspace-view';
import {BrowserWorkspaceProvider} from './apps/mobile/src/browser/browser-workspace';
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
  if(path==='/api/tasks/search'){if(window.searchFailure)return Response.json({error:'History unavailable'},{status:503});if(body.query==='old history')await new Promise(resolve=>window.finishOldSearch=resolve);return Response.json({taskIds:body.query==='history needle'?(window.historyMatches??['task-98']):body.query==='old history'?['task-97']:[],hits:window.historyHits??[]})};
  if(path==='/api/mutations/status')return Response.json({version:1});
  if(path==='/api/workspace'&&options?.method==='PATCH')return Response.json({revision:window.snapshot.revision+1,runtimeInstanceId:'fixture'});
  if(path==='/api/runtime')return Response.json(window.snapshot,{headers:{ETag:'fixture-'+window.snapshot.revision}});
  return Response.json({ok:true});
};
window.publish=changes=>flushSync(()=>{
  window.snapshot={...window.snapshot,revision:window.snapshot.revision+1,workspace:{...window.snapshot.workspace,tasks:window.snapshot.workspace.tasks.map(task=>changes[task.id]?{...task,...changes[task.id]}:task)}};
  window.pushSnapshot(window.snapshot);
});
function Probe(){window.runtime=useRuntime();window.messageReveal=useMessageReveal();return null}
function PaneProbe({children}){const runtime=useRuntime();const {setView}=useTaskListView();window.resetThreadList=()=>setView({project:'',search:'',filter:'active',source:'all',sort:'newest'});const[sources,setSources]=useState(null);window.setListSources=value=>flushSync(()=>setSources(value));const[showDevice,setShowDevice]=useState(false);window.showDevices=value=>flushSync(()=>setShowDevice(value));const [panes,setPanes]=useState({expanded:false,detailWidth:390});window.setPanes=value=>flushSync(()=>setPanes(value));return <RuntimeContext.Provider value={sources?{...runtime,activeId:'shared-peer',overviews:sources,profiles:sources.map(source=>source.profile),selectRuntimeEffect:id=>window.holdSelection?Effect.promise(()=>new Promise(resolve=>window.releaseSelection=resolve)):runtime.selectRuntimeEffect(id)}:showDevice?{...runtime,profiles:[...runtime.profiles,{...runtime.profiles[0],id:'other-device'}]}:runtime}><TaskPanesContext.Provider value={panes}>{children}</TaskPanesContext.Provider></RuntimeContext.Provider>}
function Screen(){const[lifecycle,setLifecycle]=useState(null);window.showBotLifecycle=setLifecycle;const[overview,setOverview]=useState(false);window.showOverview=()=>setOverview(true);window.showThreads=()=>setOverview(false);return lifecycle?<LifecycleActions task={lifecycle}/>:overview?<WorkspaceViewProvider><BrowserWorkspaceProvider><WorkspaceOverview unified/></BrowserWorkspaceProvider></WorkspaceViewProvider>:<TasksScreen/>}
function Language({children}){const[language,setLanguage]=useState('en-US');window.setInterfaceLanguage=setLanguage;return <InterfaceLanguageProvider language={language}>{children}</InterfaceLanguageProvider>}
createRoot(document.getElementById('app')).render(<Language><ApplicationStateProvider><RuntimeProvider><Probe/><TaskListViewProvider><PaneProbe><Screen/></PaneProbe></TaskListViewProvider></RuntimeProvider></ApplicationStateProvider></Language>);
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
  if (!process.env.DOVO_MOBILE_DENSITY_LAYOUT) await checkMobileTaskSearch(browser)
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
  await page.evaluate(() =>
    localStorage.setItem(
      'dovo.mobile-preferences.v1',
      JSON.stringify({
        taskSort: 'newest',
        taskGrouping: 'none',
        workingSection: false,
        collapsedThreadSections: ['working', 'snoozed'],
        computerRefresh: 'manual',
        threadSectionOrder: ['active', 'working', 'waiting', 'snoozed', 'settled'],
      }),
    ),
  )
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
          warning: '#e6b450',
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
            'task-1': { title: 'General ' + scale, repositoryId: 'scratch', agentId: 'agent' },
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
              (index === 4 || index === 3
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
            // Rows above can finish measuring between protocol calls. Compare both
            // centres in one browser task instead of using the earlier row position.
            const alignment = await row
              .getByText('Settled ' + scale, { exact: true })
              .evaluate((element) => {
                const title = element.getBoundingClientRect()
                const row = element.closest('[data-testid="Task task-2"]').getBoundingClientRect()
                return {
                  height: row.height,
                  offset: title.y + title.height / 2 - row.y - row.height / 2,
                }
              })
            assert.ok(alignment.height >= 44)
            assert.ok(Math.abs(alignment.offset) < 1, JSON.stringify({ width, scale, alignment }))
            continue
          }
          if (id === 'task-3') {
            assert.equal(await row.getByLabel('Draft', { exact: true }).count(), 1)
            assert.ok(
              (await row.getByLabel('Draft', { exact: true }).boundingBox()).x >
                (await row.getByText('Project', { exact: true }).boundingBox()).x,
            )
            assert.equal(
              await row
                .locator('xpath=../..')
                .getByTestId('Draft highlight')
                .evaluate((el) => getComputedStyle(el).opacity),
              '0.06',
            )
          }
          if (id === 'task-1') {
            const execution = await row.getByTestId('thread-execution').boundingBox()
            assert.ok(
              Math.abs(title.y + title.height / 2 - execution.y - execution.height / 2) < 1,
              'Projectless execution metadata shares the title line',
            )
          }
          const project = await row
            .getByText(id === 'task-1' ? 'No Project' : 'Project', { exact: true })
            .boundingBox()
          const projectIcon = await row.getByTestId('Thread project icon').boundingBox()
          assert.ok(
            Math.abs(projectIcon.y + projectIcon.height / 2 - project.y - project.height / 2) < 1,
            'Project icons stay inline with their names at every text size',
          )
          assert.ok(projectIcon.x + projectIcon.width <= project.x)
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
        const statusBounds = await parentRow.getByTestId('Thread status').boundingBox()
        const menuGlyph = await page
          .getByTestId('Task parent actions')
          .locator('[data-menu-glyph]')
          .boundingBox()
        assert.ok(
          Math.abs(statusBounds.y + statusBounds.height / 2 - menuGlyph.y - menuGlyph.height / 2) <
            1,
          'Menu glyph aligns with status/time',
        )
        assert.equal(await parentRow.locator('[data-harness]').count(), 1)
        assert.equal(
          await parentRow
            .locator('[data-harness]')
            .evaluate((icon) => icon.parentElement.textContent.includes('main')),
          true,
          'Provider belongs beside branch and PRs in the footer',
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
          'Subthread icon aligns with footer indicators',
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
        assert.ok(
          provider.y >= project.y + project.height,
          'Comfortable execution indicators follow the project and title',
        )
        assert.equal(touch.width, 44)
        assert.equal(touch.height, 44)
        assert.ok(touch.x + touch.width <= menu.x)
        assert.ok(icon.x + icon.width <= provider.x, 'Subthreads precede execution indicators')
        const statusBounds = await row.getByTestId('Thread status').boundingBox()
        const menuGlyph = await page
          .getByTestId('Task parent actions')
          .locator('[data-menu-glyph]')
          .boundingBox()
        assert.ok(
          Math.abs(statusBounds.y + statusBounds.height / 2 - menuGlyph.y - menuGlyph.height / 2) <
            1,
          'Comfortable menu aligns at larger text sizes',
        )
      }
    }
    await page.evaluate(() => {
      window.showDevices(true)
      window.publish({
        parent: {
          linkedPullRequests: [
            {
              number: 42,
              url: 'https://github.com/o/r/pull/42',
              repositoryUrl: 'https://github.com/o/r',
              title: 'PR',
            },
          ],
          pullStatus: {
            number: 42,
            url: 'https://github.com/o/r/pull/42',
            state: 'open',
            draft: false,
            checkedAt: new Date().toISOString(),
          },
        },
      })
    })
    for (const repositoryId of ['repo', 'scratch']) {
      for (const showDevice of [false, true]) {
        await page.evaluate(
          ({ repositoryId, showDevice }) => {
            window.showDevices(showDevice)
            window.publish({ parent: { repositoryId } })
          },
          { repositoryId, showDevice },
        )
        for (const density of ['compact', 'comfortable']) {
          for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 })
            await page.evaluate((density) => {
              window.rowFontScale = 1
              window.setListPreferences({ threadDensity: density })
            }, density)
            const row = page.getByRole('button', {
              name: /^(Project|No Project), Has several subagents/,
            })
            const toggle = page.getByRole('button', {
              name: /^Subthreads for Has several subagents/,
            })
            const indicator = await row.locator('[data-harness]').boundingBox()
            const anchor = await row.getByTestId('Subthread anchor').boundingBox()
            const pull = await row.getByText('#42', { exact: true }).boundingBox()
            await page.waitForFunction(
              ({ selector, anchor }) => {
                const glyph = document
                  .querySelector(selector)
                  .querySelector('svg')
                  .getBoundingClientRect()
                return (
                  Math.abs(glyph.y + glyph.height / 2 - anchor.y - anchor.height / 2) < 1 &&
                  Math.abs(glyph.x + glyph.width / 2 - anchor.x - anchor.width / 2) < 1
                )
              },
              { selector: 'button[aria-label^="Subthreads for Has several subagents"]', anchor },
            )
            const icon = await toggle.locator('svg').boundingBox()
            assert.ok(
              pull.x + pull.width <= icon.x,
              JSON.stringify({
                message: 'PRs precede subthreads',
                repositoryId,
                showDevice,
                density,
                width,
                pull,
                icon,
                indicator,
              }),
            )
            assert.ok(
              Math.abs(pull.y + pull.height / 2 - icon.y - icon.height / 2) < 1,
              'PRs and subthreads share a line',
            )
            assert.ok(icon.x + icon.width <= indicator.x, 'Subthreads precede harness')
            const runtimeIcon = row.locator('[data-runtime-icon]')
            assert.equal(await runtimeIcon.count(), Number(showDevice))
            if (await runtimeIcon.count()) {
              const runtime = await runtimeIcon.boundingBox()
              assert.ok(icon.x + icon.width <= runtime.x, 'Subthreads precede runtime')
              assert.ok(runtime.x + runtime.width <= indicator.x, 'Runtime precedes harness')
            }
            const touch = await toggle.boundingBox()
            const menu = await page.getByTestId(/Task .*parent.* actions/).boundingBox()
            assert.equal(touch.width, 44)
            assert.equal(touch.height, 44)
            assert.ok(
              touch.x + touch.width <= menu.x || touch.y >= menu.y + menu.height,
              'Independent controls do not overlap',
            )
            const status = await row.getByTestId('Thread status').boundingBox()
            const menuGlyph = await page
              .getByTestId(/Task .*parent.* actions/)
              .locator('[data-menu-glyph]')
              .boundingBox()
            assert.ok(
              Math.abs(status.y + status.height / 2 - menuGlyph.y - menuGlyph.height / 2) < 1,
              'Menu aligns with status/time',
            )
          }
        }
      }
    }
    await page.evaluate(() => {
      window.showDevices(false)
      window.setListPreferences({ threadDensity: 'comfortable' })
      window.publish({ parent: { repositoryId: 'repo', agentId: '' } })
    })
    const noAgentRow = page.getByTestId('Task parent')
    const noAgentToggle = page.getByRole('button', {
      name: /^Subthreads for Has several subagents/,
    })
    const noAgentAnchor = await noAgentRow.getByTestId('Subthread anchor').boundingBox()
    await page.waitForFunction((anchor) => {
      const glyph = document
        .querySelector('button[aria-label^="Subthreads for Has several subagents"] svg')
        .getBoundingClientRect()
      return Math.abs(glyph.x + glyph.width / 2 - anchor.x - anchor.width / 2) < 1
    }, noAgentAnchor)
    const noAgentTouch = await noAgentToggle.boundingBox()
    const noAgentMenu = await page.getByTestId('Task parent actions').boundingBox()
    assert.ok(
      noAgentTouch.x + noAgentTouch.width <= noAgentMenu.x ||
        noAgentTouch.y >= noAgentMenu.y + noAgentMenu.height,
      'Disclosure remains clear of menu without a harness/runtime icon',
    )
    await page.evaluate(() => window.publish({ parent: { agentId: 'agent' } }))
    await page.screenshot({ path: '/tmp/dovo-compact-uniform-rows.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      window.rowFontScale = 1
      window.setListPreferences({ threadDensity: 'compact' })
    })
    await page.screenshot({ path: '/tmp/dovo-mobile-thread-overview-compact.png' })
    await page.evaluate(() => window.setListPreferences({ threadDensity: 'comfortable' }))
    await page.screenshot({ path: '/tmp/dovo-mobile-thread-overview-comfortable.png' })
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
    'Compact follows desktop project/status, title and checkout hierarchy',
  )
  assert.equal(
    await densityTitle.evaluate((el) => el.parentElement.children.length),
    1,
    'Compact gives the title its own line',
  )
  const historyInput = page.getByRole('textbox', { name: 'Search threads', exact: true })
  assert.equal(await historyInput.isVisible(), true, 'Search stays visible in the header')
  assert.equal(
    await historyInput.evaluate((node) => node === document.activeElement),
    false,
    'Search does not take focus on open',
  )
  const scrollSearch = async (from, to) => {
    await page.evaluate(
      ({ from, to }) => {
        const event = (y) => ({ nativeEvent: { contentOffset: { y } } })
        window.listScrollHandlers.onScrollBeginDrag(event(from))
        window.listScrollHandlers.onScroll(event(to))
        window.listScrollHandlers.onScrollEndDrag?.()
      },
      { from, to },
    )
  }
  await scrollSearch(0, 40)
  assert.equal(await historyInput.isVisible(), true)
  await scrollSearch(40, 20)
  await historyInput.waitFor({ state: 'visible' })
  assert.equal(
    await historyInput.evaluate((node) => !!node.closest('header')),
    true,
    'Search replaces the header title',
  )
  assert.equal(
    await page.locator('header').getByRole('heading', { name: 'Threads', exact: true }).count(),
    0,
  )
  await scrollSearch(20, 40)
  assert.equal(await historyInput.isVisible(), true, 'Scrolling down keeps header search visible')
  await page.evaluate(() => window.focusTaskSearch())
  await historyInput.waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Search threads',
  )
  await historyInput.fill('active query')
  await scrollSearch(0, 40)
  assert.equal(await historyInput.isVisible(), true, 'Keep a focused query visible')
  await historyInput.blur()
  assert.equal(await historyInput.isVisible(), true, 'Keep a nonempty query visible')
  await scrollSearch(40, 20)

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
  await page.evaluate(() => {
    window.historyMatches = ['task-98', 'task-99']
    window.publish({ 'task-99': { lastPromptAt: '2026-10-27T23:20:00Z' } })
  })
  await page.getByTestId('Task task-99').waitFor()
  assert.equal(await historyInput.inputValue(), 'history needle')
  await page.evaluate(() => {
    window.historyMatches = ['task-99']
    window.publish({ 'task-98': { updatedAt: '2026-10-27T23:21:00Z' } })
  })
  await page.getByTestId('Task task-98').waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.historyMatches = []
    window.publish({ 'task-99': { historyRevision: 1 } })
  })
  await page.getByTestId('Task task-99').waitFor({ state: 'detached' })
  assert.equal(await historyInput.inputValue(), 'history needle')
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
  assert.equal(await page.getByRole('textbox', { name: 'Search threads' }).count(), 1)
  assert.equal(await filters.getAttribute('aria-pressed'), 'false')
  await filters.click()
  const filterSheet = page.getByRole('dialog', { name: 'Filter threads', exact: true })
  assert.equal(await filterSheet.getByRole('textbox', { name: 'Search threads' }).count(), 0)
  await page.getByRole('textbox', { name: 'Search threads' }).fill('Task 99')
  await page.getByTestId('Task task-0').waitFor({ state: 'detached' })
  await filterSheet.getByRole('button', { name: 'Close details' }).click()
  assert.equal(await filters.getAttribute('aria-pressed'), 'true')
  await page.getByTestId('Task task-99').waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Search threads' }).count(), 1)
  await filters.click()
  assert.equal(await page.getByRole('textbox', { name: 'Search threads' }).inputValue(), 'Task 99')
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
    'rgb(0, 238, 136)',
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
  const search = page.getByRole('textbox', { name: 'Search threads', exact: true })
  await search.fill('Child task')
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-label="Subthreads for Parent task"]')
        ?.getAttribute('aria-expanded') === 'false',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).count(),
    0,
  )
  assert.equal(await subthreads.isDisabled(), false)
  await subthreads.click()
  await page.getByRole('button', { name: 'Open child thread Child task', exact: true }).waitFor()
  assert.equal(await subthreads.getAttribute('aria-expanded'), 'true')
  await search.fill('')
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  // Filtering uses a deferred query; wait for that render before checking the restored collapse.
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-label="Subthreads for Parent task"]')
        ?.getAttribute('aria-expanded') === 'false',
  )
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
  await page.getByTestId('Task parent').getByLabel('Needs input', { exact: true }).waitFor()
  await page.evaluate(() => window.publish({ parent: { threadWatches: [] } }))
  await page.getByTestId('Task parent').getByLabel('Working', { exact: true }).waitFor()
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
  await page.getByTestId('Task parent').getByLabel('Finished', { exact: true }).waitFor()
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
  await page.evaluate(() => window.publish({ 'task-4': { pinned: false } }))
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
  assert.equal(await settled.getByText('Settled', { exact: true }).count(), 0)
  assert.equal(await settled.getByLabel('Settled', { exact: true }).count(), 1)
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
  assert.ok((await general.textContent()).includes('No Project'))
  assert.ok(!/stale-branch|Project checkout/.test(await general.textContent()))
  assert.ok(!/Local checkout|Worktree/.test(await general.getAttribute('aria-label')))
  await page.getByRole('button', { name: 'Details task-5', exact: true }).click()
  const generalDetails = page.getByRole('dialog', { name: 'Task details' })
  await generalDetails.waitFor()
  assert.ok((await generalDetails.textContent()).includes('No Project'))
  assert.ok(!/stale-branch|Project checkout/.test(await generalDetails.textContent()))
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
  await page.getByRole('textbox', { name: 'Search threads', exact: true }).fill('Task 11')
  await page.waitForFunction(() => !window.settledPath().includes('settled='))
  await page.getByTestId('Task task-11').waitFor()
  assert.equal(await page.getByRole('button', { name: /Show all \d+ settled threads/ }).count(), 0)
  await page.getByRole('textbox', { name: 'Search threads', exact: true }).fill('')
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
  await page.evaluate(() => {
    window.setListPreferences({
      taskGrouping: 'none',
      workingSection: true,
      collapsedThreadSections: ['working'],
    })
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      terminals: [{ id: 'terminal', taskId: 'running', title: 'Shell', exited: false }],
      workspace: {
        ...window.snapshot.workspace,
        tasks: window.snapshot.workspace.tasks
          .filter((task) => task.id === 'running')
          .map((task) => ({
            ...task,
            status: 'review',
            subagents: [
              {
                id: 'shell',
                provider: 'claude',
                name: 'Dev server',
                kind: 'background',
                sessionLive: true,
                status: 'working',
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          })),
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  await page.getByTestId('Task running').waitFor()
  assert.equal(
    await page
      .getByTestId('Task running')
      .getByLabel('2 active terminals', { exact: true })
      .count(),
    1,
  )
  await page.evaluate(() => {
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      workspace: {
        ...window.snapshot.workspace,
        tasks: window.snapshot.workspace.tasks.map((task) => ({
          ...task,
          status: 'running',
          turns: [
            {
              id: 'active-turn',
              assistantId: 'reply',
              agentId: 'agent',
              provider: 'codex',
              model: 'fixture',
              status: 'running',
              startedAt: new Date(Date.now() - 65000).toISOString(),
            },
          ],
        })),
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  await page.getByTestId('Task running').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: /^Working,/ }).click()
  await page.getByTestId('Task running').waitFor()
  const groupedStatus = page.getByTestId('Task running').getByTestId('Thread status')
  assert.ok(
    !/Working/.test(await groupedStatus.innerText()),
    'Grouped status keeps only the indicator and elapsed time',
  )
  assert.match(await groupedStatus.getAttribute('aria-label'), /^Working/)
  assert.ok(
    (await groupedStatus.innerText()).trim().length > 0,
    'Working elapsed time remains visible',
  )
  await page.evaluate(() => {
    const task = window.snapshot.workspace.tasks[0]
    window.setListPreferences({
      threadSectionOrder: ['working', 'active', 'waiting', 'snoozed', 'settled'],
      collapsedThreadSections: ['working'],
    })
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      workspace: {
        ...window.snapshot.workspace,
        tasks: [
          task,
          { ...task, id: 'pinned-working', title: 'Pinned working', pinned: true },
          {
            ...task,
            id: 'waiting',
            title: 'Waiting task',
            status: 'review',
            subagents: [],
            waitingForFeedback: true,
            turns: [
              {
                ...task.turns[0],
                status: 'completed',
                finishedAt: new Date(Date.now() - 600000).toISOString(),
              },
            ],
          },
        ],
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  const workingHeader = page.getByRole('button', { name: /^Working,/ })
  const openHeader = page.getByRole('button', { name: /^Pinned, \d+ tasks$/ })
  const waitingHeader = page.getByRole('button', { name: /^Waiting,/ })
  await waitingHeader.waitFor()
  await page.evaluate(() => window.setInterfaceLanguage('nl-NL'))
  await page.getByRole('button', { name: new RegExp('^' + catalog.nl.Working + ',') }).waitFor()
  await page.getByRole('button', { name: new RegExp('^' + catalog.nl.Pinned + ',') }).waitFor()
  await page.getByText('Pinned working', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.snapshot.workspace.tasks.find((task) => task.id === 'pinned-working').title,
    ),
    'Pinned working',
    'Translated sections keep the task title unchanged',
  )
  await page.evaluate(() => window.setInterfaceLanguage('en-US'))
  await waitingHeader.waitFor()
  assert.equal(
    await workingHeader.evaluate(
      (element, open) =>
        !!(element.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_PRECEDING),
      await openHeader.elementHandle(),
    ),
    true,
  )
  assert.equal(
    await openHeader.evaluate(
      (element, waiting) =>
        !!(element.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING),
      await waitingHeader.elementHandle(),
    ),
    true,
  )
  assert.doesNotMatch(
    await page.getByTestId('Task pinned-working').getByTestId('Thread status').innerText(),
    /Working/,
  )
  const waitingStatus = page.getByTestId('Task waiting').getByTestId('Thread status')
  assert.doesNotMatch(await waitingStatus.innerText(), /Waiting/)
  assert.match(await waitingStatus.innerText(), /\d+m/)
  await page.evaluate(() => window.setListPreferences({ taskGrouping: 'project' }))
  assert.doesNotMatch(
    await page.getByTestId('Task pinned-working').getByTestId('Thread status').innerText(),
    /Working/,
  )
  await page.evaluate(() =>
    window.setListPreferences({
      taskGrouping: 'status',
      workingSection: true,
      collapsedThreadSections: [],
    }),
  )
  await page.reload()
  const mount = async () => {
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate(() => window.preferencesReady)
    await page.getByRole('button', { name: /^Working,/ }).waitFor()
  }
  await mount()
  const working = page.getByRole('button', { name: /^Working,/ })
  await working.click()
  assert.equal(await working.getAttribute('aria-expanded'), 'false')
  await page.evaluate(() => window.setListPreferences({ taskGrouping: 'project' }))
  const project = page.getByRole('button', { name: /^Project, \d+ tasks$/ })
  await project.click()
  assert.equal(await project.getAttribute('aria-expanded'), 'false')
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1'))
    return (
      saved.collapsedThreadSections.includes('working') &&
      saved.collapsedThreadSections.some((key) => key.startsWith('project:'))
    )
  })
  await page.reload()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await project.waitFor()
  assert.equal(
    await project.getAttribute('aria-expanded'),
    'false',
    'Project collapse survives a full restart using the real preference module',
  )
  await page.evaluate(() => window.setListPreferences({ taskGrouping: 'status' }))
  await working.waitFor()
  assert.equal(
    await working.getAttribute('aria-expanded'),
    'false',
    'Working collapse survives a full restart',
  )
  await working.click()
  await page.waitForFunction(
    () =>
      !JSON.parse(
        localStorage.getItem('dovo.mobile-preferences.v1'),
      ).collapsedThreadSections.includes('working'),
  )
  await page.reload()
  await mount()
  assert.equal(
    await working.getAttribute('aria-expanded'),
    'true',
    'Explicit expansion survives the next restart',
  )
  await page.evaluate(() => window.setListPreferences({ taskGrouping: 'project' }))
  assert.equal(
    await project.getAttribute('aria-expanded'),
    'false',
    'Another section toggle preserves the project choice',
  )
  await page.evaluate(() => {
    const base = window.snapshot.workspace.tasks[0]
    window.setListPreferences({ collapsedThreadSections: ['waiting', 'snoozed', 'settled'] })
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      workspace: {
        ...window.snapshot.workspace,
        tasks: [
          { ...base, id: 'ordinary', title: 'Ordinary', pinned: false },
          ...['running', 'waiting', 'snoozed', 'settled'].map((state) => ({
            ...base,
            id: 'pin-' + state,
            title: 'Pinned ' + state,
            pinned: true,
            status: state === 'running' ? 'running' : 'done',
            turns: [],
            subagents: [],
            waitingForFeedback: state === 'waiting',
            archived: state === 'settled',
            snoozedUntil: state === 'snoozed' ? new Date(Date.now() + 3600000).toISOString() : null,
          })),
        ],
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  for (const grouping of ['status', 'project', 'none']) {
    await page.evaluate((taskGrouping) => window.setListPreferences({ taskGrouping }), grouping)
    await page.getByTestId('Task pin-settled').waitFor()
    assert.equal(await page.getByTestId('Task ordinary').count(), 1)
    for (const state of ['running', 'waiting', 'snoozed', 'settled']) {
      const row = page.getByTestId('Task pin-' + state)
      assert.equal(await row.count(), 1)
      assert.equal(
        await row.evaluate(
          (element, ordinary) =>
            !!(element.compareDocumentPosition(ordinary) & Node.DOCUMENT_POSITION_FOLLOWING),
          await page.getByTestId('Task ordinary').elementHandle(),
        ),
        true,
      )
    }
  }
  await page.evaluate(() => {
    const base = window.snapshot.workspace.tasks[0]
    const finishedAt = new Date(Date.now() - 300000).toISOString()
    window.setListPreferences({ workingSection: false, collapsedThreadSections: [] })
    window.snapshot = {
      ...window.snapshot,
      revision: window.snapshot.revision + 1,
      workspace: {
        ...window.snapshot.workspace,
        tasks: ['done', 'failed', 'cancelled', 'draft', 'running'].map((status) => ({
          ...base,
          id: 'status-' + status,
          title: 'Status ' + status,
          status,
          pinned: true,
          subagents: [],
          lastViewedTurnId: 'status-turn',
          turns:
            status === 'draft'
              ? []
              : [
                  {
                    id: 'status-turn',
                    assistantId: 'status-reply',
                    agentId: 'agent',
                    model: 'fixture',
                    provider: 'codex',
                    status: status === 'running' ? 'running' : 'completed',
                    startedAt: new Date(Date.now() - 600000).toISOString(),
                    ...(status === 'running' ? {} : { finishedAt }),
                  },
                ],
        })),
      },
    }
    window.pushSnapshot(window.snapshot)
  })
  for (const [status, state] of [
    ['done', 'Finished'],
    ['failed', 'Failed'],
    ['cancelled', 'Stopped'],
    ['draft', 'Draft'],
    ['running', 'Working'],
  ]) {
    const indicator = page.getByTestId('Task status-' + status).getByTestId('Thread status')
    await indicator.waitFor()
    assert.match(await indicator.getAttribute('aria-label'), new RegExp('^' + state))
    assert.equal(await indicator.locator('svg').count(), 1)
    if (status === 'draft') assert.equal(await indicator.innerText(), '')
    else assert.match(await indicator.innerText(), /^\d+[mhd]$/)
  }
  assert.deepEqual(errors, [])

  if (!process.env.DOVO_MOBILE_DENSITY_LAYOUT) {
    await page.evaluate(() => {
      const base = {
        repositoryId: 'repo',
        agentId: 'agent',
        draft: '',
        files: [],
        example: false,
        messages: [],
        status: 'done',
        createdAt: new Date().toISOString(),
      }
      window.snapshot = {
        ...window.snapshot,
        revision: window.snapshot.revision + 1,
        workspace: {
          ...window.snapshot.workspace,
          tasks: [
            { ...base, id: 'streaming-hidden', title: 'Hidden stream', status: 'running' },
            ...Array.from({ length: 100 }, (_, i) => ({
              ...base,
              id: 'overview-' + i,
              title: 'Overview ' + i,
            })),
          ],
        },
      }
      window.setListPreferences({ collapsedThreadSections: ['working'] })
      window.pushSnapshot(window.snapshot)
      window.showDevices(false)
      window.showOverview()
    })
    await page.getByTestId('Workspace thread Overview 50').waitFor()
    await page.evaluate(() => {
      window.rowRenders = {}
    })
    for (let frame = 0; frame < 30; frame++) {
      await page.evaluate(
        (frame) =>
          window.publish({
            'streaming-hidden': {
              messages: [{ id: 'stream', role: 'assistant', text: 'Chunk ' + frame }],
            },
          }),
        frame,
      )
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    }
    assert.deepEqual(
      await page.evaluate(() => window.rowRenders),
      {},
      'Unified streaming must not render unchanged rows',
    )
    await page.evaluate(() => window.publish({ 'overview-50': { title: 'Renamed overview' } }))
    await page.getByTestId('Workspace thread Renamed overview').waitFor()
    assert.deepEqual(await page.evaluate(() => window.rowRenders), { 'overview-50': 1 })
    await page.getByTestId('Workspace thread Renamed overview').click()
    assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'overview-50')
    await page.evaluate(() =>
      window.publish({
        'overview-50': {
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
    await page
      .getByTestId('Workspace thread Renamed overview')
      .getByLabel('Needs input', { exact: true })
      .waitFor()
    console.log(
      'Mobile Unified overview: 100 unchanged rows, 30 hidden streaming updates, zero row renders; one rename renders one row and keeps navigation current.',
    )
  }
  if (!process.env.DOVO_MOBILE_DENSITY_LAYOUT) {
    await page.evaluate(() => {
      const owner = structuredClone(window.runtime.overviews[0])
      owner.connected = false
      owner.error = null
      owner.profile.connection.runtimeId = 'original-owner'
      owner.snapshot.runtimeId = 'original-owner'
      owner.snapshot.workspace.tasks = [
        {
          ...owner.snapshot.workspace.tasks[0],
          id: 'startup-real',
          title: 'Startup real thread',
          status: 'review',
          agentId: 'agent',
          repositoryId: 'repo',
          pinned: false,
          archived: false,
          archivedAt: undefined,
          threadWatches: [],
          subagents: [],
        },
      ]
      owner.snapshot.workspace.repositories[0].iconOverride = 'data:image/png;base64,cmVhbA=='
      const peer = structuredClone(owner)
      peer.profile = {
        ...peer.profile,
        id: 'shared-peer',
        connection: {
          ...peer.profile.connection,
          address: 'http://peer.lan',
          runtimeId: 'shared-peer',
        },
      }
      peer.connected = true
      peer.snapshot.runtimeId = 'shared-peer'
      peer.snapshot.workspace.tasks = [
        {
          ...owner.snapshot.workspace.tasks[0],
          id: 'startup-copy',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          replica: {
            ownerRuntimeId: 'original-owner',
            threadId: 'startup-real',
            ownerName: 'Owner',
            projectName: 'Project',
          },
        },
      ]
      window.startupSources = { owner, peer }
      window.resetThreadList()
      window.setListPreferences({
        computerRefresh: 'reduced',
        collapsedThreadSections: [],
        taskGrouping: 'none',
      })
      window.setListSources([peer, owner])
    })
    const ownerId = await page.evaluate(() => window.startupSources.owner.profile.id)
    const copyId = `Task ${JSON.stringify(['shared-peer', 'startup-copy'])}`
    for (const overview of [false, true]) {
      await page.evaluate(
        (overview) => (overview ? window.showOverview() : window.showThreads()),
        overview,
      )
      const real = overview
        ? page.getByTestId('Workspace thread Startup real thread')
        : page.getByTestId(`Task ${JSON.stringify([ownerId, 'startup-real'])}`)
      await real.waitFor()
      assert.equal(
        await real.locator('[data-project-image="data:image/png;base64,cmVhbA=="]').count(),
        1,
      )
      assert.equal(await real.locator('[data-harness="codex"]').count(), 1)
      assert.equal(await real.getByTestId('Draft highlight').count(), 0)
      assert.equal(await page.getByTestId(copyId).count(), 0)
      // Opening a cached owner thread must not wait for a selected-computer write.
      await page.evaluate(() => {
        window.holdSelection = true
        window.navigations = []
      })
      const navigation = await real.evaluate((element) => {
        const started = performance.now()
        element.click()
        return { route: window.navigations.at(-1), elapsed: performance.now() - started }
      })
      assert.deepEqual(
        navigation.route,
        ['tasks', 'startup-real', ownerId],
        'Cached thread navigation must complete while secure selection storage is blocked',
      )
      console.log(
        `${overview ? 'Workspace' : 'Threads'} cached thread tap: ${navigation.elapsed.toFixed(1)} ms with selection storage blocked.`,
      )
      await page.evaluate(() => {
        window.holdSelection = false
        window.releaseSelection?.()
      })
      const node = await real.elementHandle()
      await page.evaluate(() => {
        const { peer, owner } = window.startupSources
        window.setListSources([peer, { ...owner, connected: true }])
      })
      assert.equal(
        await node.evaluate((element) => element.isConnected),
        true,
        'Live owner must keep the cached real row mounted',
      )
      await page.evaluate(() => {
        const { peer, owner } = window.startupSources
        window.setListSources([peer, { ...owner, snapshot: null }])
      })
      await real.waitFor({ state: 'detached' })
      await page
        .getByText(overview ? 'Loading threads…' : 'Waiting for your computers', { exact: true })
        .waitFor()
      assert.equal(await page.getByTestId('Draft highlight').count(), 0)
      await page.evaluate(() => {
        const { peer, owner } = window.startupSources
        window.setListSources([peer, { ...owner, snapshot: null, error: 'Connection timed out' }])
      })
      // A failed owner request never turns a stored mirror into a real thread.
      assert.equal(await real.count(), 0)
      assert.equal(await page.getByTestId(copyId).count(), 0)
      assert.equal(await page.getByTestId('Draft highlight').count(), 0)
      await page.evaluate(() => {
        const { peer, owner } = window.startupSources
        window.setListSources([peer, owner])
      })
    }
    await page.evaluate(() => {
      const { owner, peer } = window.startupSources
      window.showThreads()
      window.setListSources([
        { ...peer, connected: false },
        { ...owner, connected: true },
      ])
      window.resetThreadList()
      window.searchFailure = false
      window.historyMatches = ['startup-real']
      window.historyHits = [
        {
          taskId: 'startup-real',
          messageId: 'saved-message',
          role: 'assistant',
          snippet: 'History needle in saved history',
        },
      ]
      window.holdSelection = true
      window.navigations = []
    })
    await scrollSearch(40, 20)
    await page.getByRole('textbox', { name: 'Search threads', exact: true }).fill('history needle')
    const message = page.getByRole('button', {
      name: 'Open assistant message in Startup real thread on Owner',
      exact: true,
    })
    await message.waitFor()
    const destination = await message.evaluate((element) => {
      element.click()
      return window.navigations.at(-1)
    })
    assert.deepEqual(destination, ['tasks', 'startup-real', ownerId])
    assert.equal(
      await page.evaluate(() => {
        const owner = window.startupSources.owner.profile
        return (
          window.messageReveal?.messageId === 'saved-message' &&
          window.messageReveal.scope ===
            JSON.stringify([owner.connection.address, owner.connection.token, 'startup-real'])
        )
      }),
      true,
      'Search reveal must keep the exact owner connection while selection storage is blocked',
    )
    await page.evaluate(() => {
      window.holdSelection = false
      window.releaseSelection?.()
    })
    console.log(
      'Mobile startup rows: Tasks and Workspace use the real cached project/harness icons and status, retain the row at live arrival, show connection state for missing owners and never substitute shared copies after failure.',
    )
  }
  console.log(
    'Mobile task-list status and project sections persist collapse and expansion through full reloads using real preferences and a storage adapter.',
  )
  await page.evaluate(() => {
    const owner = structuredClone(window.startupSources.owner)
    owner.connected = true
    owner.snapshot.botsSupported = true
    owner.snapshot.workspace.tasks = [
      {
        ...owner.snapshot.workspace.tasks[0],
        id: 'lasting-bot',
        title: 'Lasting release Bot',
        status: 'done',
        archived: false,
        archivedAt: undefined,
        bot: {
          role: 'Release lead',
          responsibilities: 'Check releases',
          state: 'paused',
          revision: '11111111-1111-4111-8111-111111111111',
          createdAt: '2026-11-12T00:00:00Z',
          updatedAt: '2026-11-12T00:00:00Z',
        },
      },
    ]
    owner.snapshot.workspace.tasks.push({
      ...owner.snapshot.workspace.tasks[0],
      id: 'ordinary-neighbor',
      title: 'Ordinary neighbor',
      bot: undefined,
    })
    window.setListSources([owner])
    window.resetThreadList()
    window.setListPreferences({ collapsedThreadSections: [] })
    window.showThreads()
  })
  await page.getByTestId('Task ordinary-neighbor').waitFor()
  assert.equal(await page.getByTestId('Task lasting-bot').count(), 0)
  const botTile = page.getByRole('button', { name: /^Open Bot Lasting release Bot on / })
  await botTile.waitFor()
  const overviewLink = page.getByRole('button', { name: 'Bots', exact: true })
  assert.equal(await overviewLink.count(), 0)
  for (const [botsInThreads, botsOverviewEnabled] of [
    [false, true],
    [true, true],
    [false, false],
    [true, false],
  ]) {
    await page.evaluate(
      ([botsInThreads, botsOverviewEnabled]) =>
        window.setListPreferences({ botsInThreads, botsOverviewEnabled }),
      [botsInThreads, botsOverviewEnabled],
    )
    await page.waitForFunction(
      ({ botsInThreads, botsOverviewEnabled }) =>
        !!document.querySelector('[aria-label^="Open Bot Lasting release Bot on "]') ===
          botsInThreads &&
        [...document.querySelectorAll('button')].some((button) => button.textContent === 'Bots') ===
          botsOverviewEnabled,
      { botsInThreads, botsOverviewEnabled },
    )
    assert.equal(await page.getByTestId('Task ordinary-neighbor').isVisible(), true)
  }
  await botTile.click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'lasting-bot')
  const newBot = page.getByRole('button', { name: 'New Bot', exact: true })
  await newBot.waitFor()
  assert.equal(await newBot.isEnabled(), true)
  assert.equal(await newBot.evaluate((node) => node.parentElement.lastElementChild === node), true)
  for (const layout of ['grid-2', 'grid-3', 'grid-4', 'rows', 'horizontal']) {
    await page.evaluate((botLayout) => window.setListPreferences({ botLayout }), layout)
    await page.getByTestId(`Bot layout ${layout}`).waitFor()
    assert.equal(await botTile.isVisible(), true)
    assert.equal(await newBot.isEnabled(), true)
  }
  await page.evaluate(() => {
    window.rowLayout = true
    window.setListPreferences({ botLayout: 'grid-4' })
    const owner = structuredClone(window.startupSources.owner)
    owner.connected = true
    owner.snapshot.botsSupported = true
    const bot = { ...owner.snapshot.workspace.tasks[0], bot: { role: 'Helper', state: 'active' } }
    owner.snapshot.workspace.tasks = [0, 1, 2].map((index) => ({
      ...bot,
      id: `four-column-${index}`,
      title: `Column ${index}`,
    }))
    window.setListSources([owner])
  })
  const fourColumnTiles = page.getByTestId('Bot layout grid-4').getByRole('button')
  await fourColumnTiles.first().waitFor()
  assert.equal(await fourColumnTiles.count(), 4)
  const positions = await fourColumnTiles.evaluateAll((nodes) =>
    nodes.map((node) => ({
      top: node.getBoundingClientRect().top,
      left: node.getBoundingClientRect().left,
    })),
  )
  assert.ok(
    positions.every(({ top }) => Math.abs(top - positions[0].top) < 1),
    JSON.stringify(positions),
  )
  assert.ok(positions.every(({ left }, index) => index === 0 || left > positions[index - 1].left))
  await newBot.click()
  await page.getByRole('dialog', { name: 'Create Bot' }).waitFor()
  await page.getByRole('button', { name: 'Cancel Bot creation' }).click()
  await page.getByRole('dialog', { name: 'Create Bot' }).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    const owner = structuredClone(window.startupSources.owner)
    owner.connected = true
    owner.snapshot.botsSupported = true
    owner.snapshot.workspace.tasks = []
    window.setListSources([owner])
  })
  await botTile.waitFor({ state: 'detached' })
  await newBot.waitFor()
  await newBot.click()
  await page.getByRole('dialog', { name: 'Create Bot' }).waitFor()
  await page.getByRole('button', { name: 'Cancel Bot creation' }).click()
  await page.evaluate(() => {
    const owner = structuredClone(window.startupSources.owner)
    owner.connected = false
    owner.snapshot.botsSupported = true
    window.setListSources([owner])
  })
  await page.waitForFunction(() => document.querySelector('[aria-label="New Bot"]')?.disabled)
  // Restore the Bot used by the mixed-list engine checks below.
  await page.evaluate(() => {
    const owner = structuredClone(window.startupSources.owner)
    owner.connected = true
    owner.snapshot.workspace.tasks = [
      {
        ...owner.snapshot.workspace.tasks[0],
        id: 'lasting-bot',
        title: 'Lasting release Bot',
        status: 'done',
        bot: {
          role: 'Release lead',
          responsibilities: 'Check releases',
          state: 'paused',
          revision: '11111111-1111-4111-8111-111111111111',
          createdAt: '2026-11-12T00:00:00Z',
          updatedAt: '2026-11-12T00:00:00Z',
        },
      },
    ]
    window.setListSources([owner])
    window.showOverview()
  })
  const botRow = page.getByTestId('Workspace thread Lasting release Bot')
  await botRow.waitFor()
  assert.equal(await botRow.count(), 1)
  assert.equal(await botRow.locator('[data-icon="bot"]').count(), 1)
  assert.match(await botRow.getAttribute('aria-label'), /^Bot, .*Paused/)
  assert.doesNotMatch(await botRow.getAttribute('aria-label'), /Project|checkout|Worktree/)
  assert.equal(await botRow.getByTestId('Bot identity').count(), 1)
  await botRow.click()
  assert.equal(await page.evaluate(() => window.navigations.at(-1)[1]), 'lasting-bot')
  await page.evaluate(() =>
    window.showBotLifecycle(
      window.startupSources.owner.snapshot.workspace.tasks.find((task) => task.bot) ?? {
        ...window.startupSources.owner.snapshot.workspace.tasks[0],
        bot: { role: 'Assistant', state: 'active' },
      },
    ),
  )
  await page.getByRole('button', { name: 'Pin Bot', exact: true }).waitFor()
  for (const name of [
    'Settle task',
    'Reopen task',
    'Snooze',
    'Archive thread',
    'Restore thread',
    'Delete thread…',
  ])
    assert.equal(
      await page.getByRole('button', { name, exact: true }).count(),
      0,
      `Hide ${name} for Bots`,
    )
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
