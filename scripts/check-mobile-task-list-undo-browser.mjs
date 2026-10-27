import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Image=()=>null;
export const useWindowDimensions=()=>({width:390,height:844,fontScale:1,scale:1});
export const Pressable=({children,onPress,disabled,accessibilityLabel,testID})=><button data-testid={testID} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const Alert={alert:(title,message)=>window.alerts.push({title,message})};
export const AccessibilityInfo={announceForAccessibility:message=>window.announcements.push(message)};
`
const controls = `
export const useTheme=()=>({colors:{text:'#fff',muted:'#aaa',accent:'#09f',success:'#0f0',warning:'#ff0',error:'#f00',elevated:'#222',border:'#555',surface:'#111'},styles:{muted:{},error:{}}});
export const Icon=()=>null;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
`
const stubs = [
  { path: 'react-native', contents: native },
  { path: 'react-native-gesture-handler', contents: native },
  {
    path: 'lucide-react-native',
    contents: `const Icon=()=>null;export {Icon as Archive,Icon as CircleCheck,Icon as CircleDashed,Icon as CircleStop,Icon as CircleX,Icon as AlarmClock,Icon as CloudOff,Icon as FilePenLine,Icon as GitBranch,Icon as GitFork,Icon as MessageCircleQuestion,Icon as MessageCircle,Icon as Pin,Icon as Network,Icon as Save};`,
  },
  {
    path: './nested-threads',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const NestedThreads=()=>null;`,
  },
  {
    path: '../../agents/harness-icon',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const HarnessIcon=()=>null;`,
  },
  {
    path: '../../agents/use-model-catalog',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const useCachedModelCatalog=()=>({modelName:'',catalog:null});`,
  },
  {
    path: '../creation/harness-choices',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const harnessNames={};`,
  },
  {
    path: '../../ui/controls/icon',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: controls,
  },
  { path: '../../ui/content/text', importer: mobile + 'tasks/list/', contents: controls },
  {
    path: '../../ui/content/pull-request-icon',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const PullRequestIcon=()=>null;`,
  },
  {
    path: './device-label',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const DeviceLabel=()=>null;`,
  },
  {
    path: './task-row-menu',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const TaskRowMenu=({task,actions})=><div><button onClick={actions.toggleSettled}>Menu settle {task.id}</button><button onClick={()=>actions.snooze(window.until)}>Menu snooze {task.id}</button></div>;`,
  },
  {
    path: './task-swipe-actions',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const TaskSwipeActions=({children,enabled,primary,secondary})=><div>{children}<button disabled={!enabled||primary.disabled} onClick={primary.run}>Swipe {primary.label}</button>{secondary&&<button disabled={!enabled} onClick={secondary.run}>Swipe {secondary.label}</button>}</div>;`,
  },
  {
    path: '../detail/use-task-lifecycle',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const chooseSnoozeDuration=(_title,apply)=>apply(1);export const useTaskLifecycle=task=>({busy:false,error:'',enabled:true,onCurrentRuntime:true,toggleSettled:()=>window.legacy('settle',task),snooze:until=>window.legacy('snooze',task,until)});`,
  },
  { path: '../../ui/theme', importer: mobile + 'tasks/list/', contents: controls },
  {
    path: '../../runtime/preferences/app-preferences',
    importer: mobile + 'tasks/list/task-list-row.tsx',
    contents: `export const useCarMode=()=>false;`,
  },
  {
    path: '../../runtime/connection/context',
    importer: mobile + 'tasks/list/task-list-undo.tsx',
    contents: `export const useRuntime=()=>window.fixtureRuntime;`,
  },
]

const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {runtimeProfile,decode,snapshotSchema} from '@dovo/protocol';
import {taskListProjection} from './apps/mobile/src/tasks/list/task-list-projection.ts';
import {TaskListRow} from './apps/mobile/src/tasks/list/task-list-row.tsx';
import {TaskListUndoProvider} from './apps/mobile/src/tasks/list/task-list-undo.tsx';
const profile=runtimeProfile({address:'http://owner.lan:8787',token:'owner-private-token-at-least-32-characters'},'Owner');
const other=runtimeProfile({address:'http://other.lan:8787',token:'other-private-token-at-least-32-characters'},'Other');
const task={id:'thread',title:'Fixture thread',repositoryId:'repo',agentId:'',status:'done',createdAt:'2026-09-23T00:00:00Z',messages:[],files:[],draft:'',example:false,snoozedUntil:'2026-09-24T00:00:00Z'};
const makeSnapshot=supported=>decode(snapshotSchema,{revision:1,owner:false,...(supported?{taskListUndoSupported:true}:{}),workspace:{version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'}],agents:[],automations:[],tasks:[task]},questions:[],approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],acpInstallations:[]});
window.requests=[];window.alerts=[];window.announcements=[];window.legacyCalls=[];window.until='2026-12-01T00:00:00Z';
window.legacy=(action,record,until)=>window.legacyCalls.push({action,id:record.id,until});
function App(){
  const [snapshot,setSnapshot]=useState(()=>makeSnapshot(true));
  const [visible,setVisible]=useState(true);
  window.reset=supported=>{window.requests=[];window.alerts=[];window.announcements=[];window.legacyCalls=[];window.failUndo=false;setSnapshot(makeSnapshot(supported));setVisible(true)};
  window.fixtureRuntime={activeId:other.id,readRuntime:async(owner,path,input)=>{
    window.requests.push({owner:owner.id,path,input});
    if(input.action==='undo'){
      if(window.failUndo)throw new Error('This thread or a subthread changed; Undo was not applied.');
      setVisible(true);return {ok:true};
    }
    setVisible(false);return {ok:true,undo:'ticket'};
  },refreshRuntime:async()=>{}};
  const overview={profile,snapshot,connected:true,lastSeen:null,error:null,pulls:null,pullError:null};
  const row=[...taskListProjection([overview],Date.now()).values()][0];
  const commands={open:()=>{},details:()=>{},select:()=>{}};
  return <TaskListUndoProvider>{visible&&<TaskListRow row={row.row} owner={row.owner} density="compact" now={Date.now()} testID="Thread row" disabled={false} commands={commands}/>}</TaskListUndoProvider>;
}
window.ownerId=profile.id;window.otherId=other.id;
createRoot(document.getElementById('app')).render(<App/>);
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
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.clock.install()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Swipe Settle' }).click()
  const undo = page.getByRole('button', { name: 'Undo settle' })
  await undo.waitFor()
  assert.equal(await page.getByTestId('Thread row').count(), 0, 'Notice survives the row unmount')
  await undo.click()
  await page.getByTestId('Thread row').waitFor()
  const requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((entry) => entry.input.action),
    ['settle', 'undo'],
  )
  const ownerId = await page.evaluate(() => window.ownerId)
  assert.notEqual(ownerId, await page.evaluate(() => window.otherId))
  assert.ok(requests.every((entry) => entry.owner === ownerId))
  assert.ok(requests.every((entry) => entry.path === '/api/tasks/list-action'))
  assert.equal(requests[0].input.expectedSnoozedUntil, '2026-09-24T00:00:00Z')
  assert.deepEqual(await page.evaluate(() => window.announcements), [
    'Fixture thread settled. Undo available.',
  ])

  await page.getByRole('button', { name: 'Swipe Snooze' }).click()
  await page.getByRole('button', { name: 'Undo snooze' }).waitFor()
  assert.equal((await page.evaluate(() => window.requests.at(-1))).input.action, 'snooze')
  await page.getByRole('button', { name: 'Undo snooze' }).click()
  await page.getByTestId('Thread row').waitFor()

  await page.getByRole('button', { name: 'Menu snooze thread' }).click()
  await page.getByRole('button', { name: 'Undo snooze' }).waitFor()
  await page.clock.fastForward(15_001)
  assert.equal(await page.getByRole('button', { name: 'Undo snooze' }).count(), 0)
  await page.evaluate(() => window.reset(true))
  await page.getByTestId('Thread row').waitFor()

  await page.getByRole('button', { name: 'Menu settle thread' }).click()
  await page.getByRole('button', { name: 'Undo settle' }).waitFor()
  await page.evaluate(() => {
    window.failUndo = true
  })
  await page.getByRole('button', { name: 'Undo settle' }).click()
  await page.waitForFunction(() => window.alerts.length > 0)
  assert.match((await page.evaluate(() => window.alerts.at(-1))).message, /changed/)
  assert.equal(await page.getByRole('button', { name: 'Undo settle' }).count(), 0)

  await page.evaluate(() => window.reset(false))
  await page.getByRole('button', { name: 'Menu settle thread' }).click()
  await page.getByRole('button', { name: 'Menu snooze thread' }).click()
  await page.getByRole('button', { name: 'Swipe Settle' }).click()
  await page.getByRole('button', { name: 'Swipe Snooze' }).click()
  const legacyCalls = await page.evaluate(() => window.legacyCalls)
  assert.deepEqual(legacyCalls.slice(0, 3), [
    { action: 'settle', id: 'thread', until: undefined },
    { action: 'snooze', id: 'thread', until: '2026-12-01T00:00:00Z' },
    { action: 'settle', id: 'thread', until: undefined },
  ])
  assert.equal(legacyCalls[3].action, 'snooze')
  assert.equal(legacyCalls[3].id, 'thread')
  const remaining = Date.parse(legacyCalls[3].until) - (await page.evaluate(() => Date.now()))
  assert.ok(remaining > 3_590_000 && remaining <= 3_600_000)
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  assert.equal(await page.getByTestId('Task list undo').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile task-list Undo: swipe/menu actions, row unmount, owner, conflict and legacy fallback verified.',
  )
} finally {
  await browser.close()
}
