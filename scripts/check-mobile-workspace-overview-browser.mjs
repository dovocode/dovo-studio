import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workspace = root + 'apps/mobile/src/workspace/'
const controls = `
import {forwardRef,useImperativeHandle} from 'react';
export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
export const Image=()=>null;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Pressable=({children,onPress,onLongPress,accessibilityLabel,accessibilityState,testID})=><button data-testid={testID} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress} onContextMenu={event=>{event.preventDefault();onLongPress?.()}}>{children}</button>;
export const FlatList=forwardRef(({data,renderItem,keyExtractor,ListEmptyComponent},ref)=>{useImperativeHandle(ref,()=>({scrollToOffset(){}}));return <main>{data.length?data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>):ListEmptyComponent}</main>});
export const Alert={alert:(title,message)=>window.alerts.push({title,message})};
export const Icon=({name})=><i data-icon={name}/>;
export const ScreenHeader=({title,buttons})=><header><h1>{title}</h1>{buttons.map(button=><button key={button.label} onClick={button.onPress}>{button.label}</button>)}</header>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Switch=({accessibilityLabel,value,onValueChange})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} onChange={event=>onValueChange(event.target.checked)}/>;
export const Sheet=({title,children,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close sheet</button></section>;
export const useTheme=()=>({styles:{},colors:{}});
`
const stubs = [
  { path: 'react-native', contents: controls },
  { path: 'react-native-gesture-handler', contents: controls },
  { path: 'expo-crypto', contents: 'let id=0;export const randomUUID=()=>`page-${++id}`;' },
  {
    path: 'expo-router',
    contents:
      'export const router={push:href=>window.routes.push(href),navigate:href=>window.routes.push(href)};',
  },
  {
    path: '@react-native-async-storage/async-storage',
    contents: 'export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};',
  },
  {
    path: '../runtime/connection/provider',
    importer: workspace,
    contents: `import {useSyncExternalStore} from 'react';export function useRuntime(){useSyncExternalStore(window.subscribe,()=>window.version);return window.runtime}`,
  },
  {
    path: '../runtime/preferences/app-preferences',
    importer: workspace,
    contents: `import {useSyncExternalStore} from 'react';export function useMobilePreferences(){useSyncExternalStore(window.subscribe,()=>window.version);return window.preferences};export const updateMobilePreferences=changes=>{Object.assign(window.preferences,changes);window.publish()};export const setMobileThreadSectionCollapsed=(id,closed)=>{window.preferences.collapsedThreadSections=closed?[...window.preferences.collapsedThreadSections,id]:window.preferences.collapsedThreadSections.filter(value=>value!==id);window.publish()};`,
  },
  {
    path: '../runtime/state/app-active',
    importer: workspace,
    contents: 'export const useForegroundInterval=()=>{};',
  },
  {
    path: '../shell/navigation',
    importer: workspace,
    contents: 'export const useNavigation=()=>window.navigation;',
  },
  {
    path: '../shell/more-actions',
    importer: workspace,
    contents: 'export const useMoreActions=()=>[];',
  },
  {
    path: './workspace-starter',
    importer: workspace,
    contents: 'export const WorkspaceStarter=()=> <p>Workspace starter</p>;',
  },
  {
    path: '../tasks/list/task-list-row',
    importer: workspace,
    contents:
      'export const TaskListRow=({row,thread,commands,showTypeIndicator,density})=><button data-children={thread?.children.map(child=>child.title).join(",")} data-testid={`Workspace thread ${row.task.title}`} data-type-indicator={showTypeIndicator} data-density={density} onClick={()=>commands.open(row.key)}>{row.task.title}</button>;',
  },
  {
    path: '../tasks/list/task-swipe-actions',
    importer: workspace,
    contents:
      'export const TaskSwipeActions=({children,enabled,primary})=><div>{children}<button disabled={!enabled} onClick={primary.run}>{primary.label} swipe</button></div>;',
  },
  {
    path: '../tasks/detail/use-task-lifecycle',
    importer: workspace,
    contents:
      'export const useTaskLifecycle=()=>({enabled:true,busy:false});export const chooseSnoozeDuration=(_title,choose)=>choose(new Date(Date.now()+3600000).toISOString());',
  },
]
for (const path of [
  '../ui/content/text',
  '../ui/controls/icon',
  '../ui/controls/field',
  '../ui/controls/choice',
  '../ui/controls/action',
  '../ui/controls/switch',
  '../ui/layout/sheet',
  '../ui/layout/screen-header',
  '../ui/theme',
])
  stubs.push({ path, importer: workspace, contents: controls })

const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {decode,snapshotSchema,runtimeProfile,taskSchema} from '@dovo/protocol';
import {WorkspaceOverview} from './apps/mobile/src/workspace/workspace-overview';
import {WorkspaceViewProvider} from './apps/mobile/src/workspace/workspace-view';
import {BrowserWorkspaceProvider,useBrowserWorkspace} from './apps/mobile/src/browser/browser-workspace';
window.version=0;const listeners=new Set();window.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};window.publish=()=>{window.version++;listeners.forEach(fn=>fn())};
window.preferences={threadDensity:'compact',threadSectionOrder:['pinned','active','working','waiting','snoozed','settled'],collapsedThreadSections:[],unifiedWorkspaceEnabled:true,unifiedWorkspaceActive:true,terminalWorkspaceEnabled:true,browserWorkspaceEnabled:true};
window.routes=[];window.navigations=[];window.alerts=[];window.updates=[];window.navigation={focused:true,navigate:(...args)=>window.navigations.push(args)};
const task=decode(taskSchema,{id:'same',title:'Thread A',repositoryId:'repo',agentId:'',status:'done',createdAt:'2026-11-04T00:00:00Z',messages:[],files:[],draft:'',example:false,pinned:true});
const profile=runtimeProfile({address:'http://mac.lan',token:'device-token-private-at-least-32-characters'},'Mac');
const snapshot=decode(snapshotSchema,{revision:1,owner:false,workspace:{version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'}],agents:[],automations:[],tasks:[task]},questions:[],approvals:[],terminals:[{id:'same',taskId:'studio:terminals',title:'Shell A',exited:false,repositoryId:'repo',pinned:true},{id:'thread-pty',taskId:'same',title:'Thread PTY',exited:false}],runs:[],devices:[],pendingDevices:[]});
window.runtime={profiles:[profile],overviews:[{profile,snapshot,connected:true,lastSeen:null,error:null,pulls:null,pullError:null}],refreshAll:async()=>{},refreshRuntime:async()=>window.publish(),readRuntime:async(_profile,path,input)=>{window.updates.push({owner:_profile.id,path,input});if(path==='/api/terminals/update'){const index=snapshot.terminals.findIndex(item=>item.id===input.id);snapshot.terminals[index]={...snapshot.terminals[index],...(input.pinned!==undefined?{pinned:input.pinned}:{}),...(input.settled!==undefined?{settledAt:input.settled?new Date().toISOString():undefined}:{})};window.runtime.overviews=[{...window.runtime.overviews[0],snapshot:{...snapshot}}];window.publish();return snapshot.terminals[index]}throw Error(path)}};
function App(){const[show,setShow]=useState(true);window.mountOverview=value=>setShow(value);const browser=useBrowserWorkspace();window.setPages=tabs=>browser.change(state=>({...state,tabs,active:tabs[0]?.id??state.active}));window.pages=browser.state.tabs;return show?<WorkspaceOverview unified/>:null};
createRoot(document.getElementById('app')).render(<WorkspaceViewProvider><BrowserWorkspaceProvider><App/></BrowserWorkspaceProvider></WorkspaceViewProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
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
  await page.getByTestId('Workspace thread Thread A').waitFor()
  await page.evaluate(() =>
    window.setPages([
      {
        id: 'same',
        kind: 'local',
        profileId: 'device',
        url: 'http://app.lan',
        title: 'Page A',
        visitedAt: Date.now(),
        pinned: true,
      },
    ]),
  )
  const resourceOrder = await page
    .locator('[data-testid^="Workspace "]')
    .evaluateAll((items) => items.map((item) => item.dataset.testid))
  assert.deepEqual(resourceOrder, [
    'Workspace browser Page A',
    'Workspace thread Thread A',
    'Workspace terminal Shell A',
  ])
  assert.equal(
    await page.getByTestId('Workspace thread Thread A').getAttribute('data-type-indicator'),
    'true',
  )
  assert.equal(
    await page.getByTestId('Workspace thread Thread A').getAttribute('data-density'),
    'compact',
  )
  assert.equal(await page.getByText('Thread PTY', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Workspace starter', { exact: true }).count(), 0)
  await page.getByTestId('Workspace thread Thread A').click()
  assert.equal(await page.evaluate(() => window.navigations[0][1]), 'same')

  await page.getByRole('button', { name: 'Workspace filters', exact: true }).click()
  await page.getByLabel('Show', { exact: true }).selectOption('terminal')
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  assert.equal(await page.getByTestId('Workspace thread Thread A').count(), 0)
  await page.getByTestId('Workspace terminal Shell A').waitFor()
  await page.getByLabel('Search workspace').fill('Shell')
  await page.evaluate(() => window.mountOverview(false))
  await page.locator('h1').waitFor({ state: 'detached' })
  await page.evaluate(() => window.mountOverview(true))
  await page.getByTestId('Workspace terminal Shell A').waitFor()
  assert.equal(await page.getByLabel('Search workspace').inputValue(), 'Shell')
  assert.equal(await page.getByTestId('Workspace thread Thread A').count(), 0)

  await page.getByRole('button', { name: 'Actions for Shell A', exact: true }).click()
  await page.getByRole('button', { name: 'Unpin', exact: true }).click()
  await page.waitForFunction(() => window.updates.some((update) => update.input.pinned === false))
  await page.getByRole('button', { name: 'Settle swipe', exact: true }).click()
  await page.waitForFunction(() => window.updates.some((update) => update.input.settled === true))
  assert.equal(
    await page.evaluate(() =>
      window.updates.every((update) => update.owner === window.runtime.profiles[0].id),
    ),
    true,
  )
  await page.getByRole('button', { name: 'Restore swipe', exact: true }).click()
  await page.waitForFunction(() => window.updates.some((update) => update.input.settled === false))

  await page.getByLabel('Search workspace').fill('Nothing matches')
  await page.getByText('No matching items', { exact: true }).waitFor()
  assert.equal(await page.getByText('Workspace starter', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByTestId('Workspace browser Page A').waitFor()
  await page.getByRole('button', { name: 'Workspace filters', exact: true }).click()
  await page.getByLabel('Computer', { exact: true }).selectOption('device')
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  assert.equal(await page.getByTestId('Workspace terminal Shell A').count(), 0)
  await page.getByTestId('Workspace browser Page A').click({ button: 'right' })
  await page.getByRole('button', { name: 'Settle', exact: true }).click()
  await page.waitForFunction(
    () => !!window.pages.find((page) => page.title === 'Page A')?.settledAt,
  )
  await page.getByRole('button', { name: 'Workspace filters', exact: true }).click()
  await page.getByLabel('Computer', { exact: true }).selectOption('all')
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    const owner = window.runtime.overviews[0]
    const parent = { ...owner.snapshot.workspace.tasks[0], pinned: false }
    const child = {
      ...parent,
      id: 'worker',
      title: 'Delegated worker',
      delegation: { parentTaskId: parent.id, parentRunId: 'run', key: 'worker' },
    }
    const nested = {
      ...parent,
      id: 'nested',
      title: 'Nested worker',
      delegation: { parentTaskId: child.id, parentRunId: 'run', key: 'nested' },
    }
    const remote = {
      ...parent,
      id: 'remote-worker',
      title: 'Remote worker',
      spawnParent: { runtimeId: 'mac-identity', threadId: parent.id },
    }
    const remoteProfile = { ...owner.profile, id: 'remote-profile', name: 'Remote' }
    window.runtime.profiles = [owner.profile, remoteProfile]
    window.runtime.overviews = [
      {
        ...owner,
        snapshot: {
          ...owner.snapshot,
          runtimeId: 'mac-identity',
          workspace: { ...owner.snapshot.workspace, tasks: [parent, child, nested] },
          questions: [{ taskId: 'nested' }],
        },
      },
      {
        ...owner,
        profile: remoteProfile,
        snapshot: {
          ...owner.snapshot,
          runtimeId: 'remote-identity',
          workspace: { ...owner.snapshot.workspace, tasks: [remote] },
          terminals: [],
        },
      },
    ]
    window.publish()
  })
  const parentRow = page.getByTestId('Workspace thread Thread A')
  await parentRow.waitFor()
  await page.getByRole('button', { name: 'Needs input, 1 items', exact: true }).waitFor()
  assert.equal(await parentRow.getAttribute('data-children'), 'Delegated worker,Remote worker')
  for (const title of ['Delegated worker', 'Nested worker', 'Remote worker'])
    assert.equal(
      await page.getByTestId('Workspace thread ' + title).count(),
      0,
      'Child stays under its parent',
    )
  await page.getByLabel('Search workspace').fill('Nested worker')
  await parentRow.waitFor()
  await page.getByLabel('Search workspace').fill('')
  await page.getByRole('button', { name: 'Workspace filters', exact: true }).click()
  await page.getByLabel('Computer', { exact: true }).selectOption('remote-profile')
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await parentRow.waitFor()
  assert.equal(
    await page.getByTestId('Workspace thread Remote worker').count(),
    0,
    'Computer filters keep subagents under the parent',
  )
  assert.equal(await parentRow.getAttribute('data-children'), 'Delegated worker,Remote worker')
  await page.evaluate(() => {
    window.runtime.overviews = window.runtime.overviews.map((owner) => ({
      ...owner,
      snapshot: {
        ...owner.snapshot,
        workspace: {
          ...owner.snapshot.workspace,
          tasks: owner.snapshot.workspace.tasks.map((task) =>
            task.title === 'Thread A' ? { ...task, archivedAt: '2026-11-09T09:00:00Z' } : task,
          ),
        },
      },
    }))
    window.publish()
  })
  await parentRow.waitFor()
  assert.equal(await parentRow.getAttribute('data-children'), 'Delegated worker,Remote worker')
  assert.equal(await page.getByTestId('Workspace thread Remote worker').count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(await page.evaluate(() => window.alerts), [])
  console.log(
    'Mobile mixed overview: thread row integration, pinned page order, scope separation, retained filters, computer scope and lifecycle actions pass.',
  )
} finally {
  await browser.close()
}
