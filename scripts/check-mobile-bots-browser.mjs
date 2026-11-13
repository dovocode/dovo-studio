import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
import {useImperativeHandle} from 'react';
export const Keyboard={dismiss(){}};export const Alert={alert(){}};export const Platform={OS:'web'};export const StyleSheet={flatten:style=>style};export const useWindowDimensions=()=>({fontScale:1,width:390,height:844});
export const FlatList=({data,renderItem,keyExtractor,ListEmptyComponent})=><main>{data.length?data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>):ListEmptyComponent}</main>;
export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const TextInput=({ref,accessibilityLabel,accessibilityHint,value,onChangeText,editable,multiline,testID})=>{useImperativeHandle(ref,()=>({focus(){}}));const props={'aria-label':accessibilityLabel,'aria-description':accessibilityHint,'data-testid':testID,value,disabled:editable===false,onChange:event=>onChangeText?.(event.target.value)};return multiline?<textarea {...props}/>:<input {...props}/>};
export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const Image=()=>null;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState,useSyncExternalStore} from 'react';
import {BotEditor} from './apps/mobile/src/bots/bot-editor';
import {BotAvatarEditor} from './apps/mobile/src/bots/bot-avatar-editor';
import {BotMemory} from './apps/mobile/src/bots/bot-memory';
import {BotSettings} from './apps/mobile/src/bots/bot-settings';
import {BotWorkSummary} from './apps/mobile/src/bots/bot-work-summary';
import BotsScreen from './apps/mobile/src/bots/bots-screen';
import {Effect} from 'effect';
import {RuntimeRequestError,snapshotSchema,decode,taskSchema,botCreateSchema,botUpdateSchema,botLifecycleSchema,memoryWriteSchema} from '@dovo/protocol';
window.makeListSnapshot=(bot,normal)=>decode(snapshotSchema,{revision:1,owner:false,botsSupported:true,workspace:{version:1,runtimeAddress:'',repositories:[],agents:[],tasks:[bot,normal],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
const stamp='2026-11-12T00:00:00Z';const rev='11111111-1111-4111-8111-111111111111';
window.version=0;const listeners=new Set();window.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};window.publish=()=>{window.version++;listeners.forEach(fn=>fn())};
window.requests=[];window.notes=[];window.failCreate=false;window.failMemory=false;
window.botTask=decode(taskSchema,{id:'bot-a',title:'Review assistant',repositoryId:'project',agentId:'',status:'draft',createdAt:stamp,messages:[],files:[],draft:'',example:false,bot:{role:'Reviewer',responsibilities:'Review changes',state:'active',revision:rev,createdAt:stamp,updatedAt:stamp}});
window.runtime={profile:{id:'paired-owner',connection:{address:'http://owner.lan',token:'paired-device-token'}},connected:true,snapshot:{botsSupported:true,botResourcesSupported:true,workspace:{agents:[],repositories:[{id:'project',name:'Project',path:'/project',branch:'main'},{id:'dovo:scratch',name:'No Project',kind:'scratch',path:'/scratch',branch:'main'}],tasks:[],automations:[]}},refresh:async()=>{},callEffect:(path,input,schema)=>Effect.try({try:()=>{
window.requests.push({owner:window.runtime.profile.id,path,input});let result;
if(path==='/api/bots/create'){decode(botCreateSchema,input);if(window.failCreate)throw Error('Temporary runtime outage');result={id:input.createTask.id,bot:{...window.botTask.bot,role:input.role,responsibilities:input.responsibilities},revision:1,runtimeInstanceId:'runtime-a'}}
else if(path==='/api/workspace'){if(window.rejectRename)result={revision:2,runtimeInstanceId:'runtime-a',outcome:'rejected'};else{window.botTask={...window.botTask,title:input.changes.title.after};result={revision:2,runtimeInstanceId:'runtime-a',outcome:'applied'}}}
else if(path==='/api/bots/update'){decode(botUpdateSchema,input);if(window.failBotUpdate)throw Error('Bot save failed after rename');if(window.strictCas && input.expectedRevision!==window.botTask.bot.revision)throw new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'Bot settings changed. Reopen after resolving your draft.'});window.botTask={...window.botTask,bot:{...window.botTask.bot,role:input.role,responsibilities:input.responsibilities,resources:input.resources}};result={id:'bot-a',bot:window.botTask.bot,revision:2,runtimeInstanceId:'runtime-a'}}
else if(path==='/api/bots/lifecycle'){decode(botLifecycleSchema,input);if(window.lifecycleNoopExternal)window.botTask={...window.botTask,bot:{...window.botTask.bot,role:'External role',revision:'33333333-3333-4333-8333-333333333333'}};window.botTask={...window.botTask,bot:{...window.botTask.bot,state:input.action==='pause'?'paused':'active'}};window.publish();result={id:'bot-a',bot:window.botTask.bot,revision:2,runtimeInstanceId:'runtime-a'}}
else if(path==='/api/memory/list')result={entries:window.notes,total:window.notes.length};
else if(path==='/api/memory/write'){decode(memoryWriteSchema,input);if(window.failMemory)throw Error('Memory changed. Refresh before saving.');const note={...input,revision:rev,createdAt:stamp,updatedAt:stamp};window.notes=[...window.notes.filter(note=>note.key!==input.key),note];result={memory:note}}
else if(path==='/api/memory/delete'){window.notes=[];result={ok:true}}
else throw Error(path);
return decode(schema,result)},catch:error=>error})};

import {RegistryProvider} from '@effect/atom-react';
const initial={name:'Release assistant',role:'Release lead',responsibilities:'Check release readiness'};
window.saved=[];window.rejectSave=false;
function App(){useSyncExternalStore(window.subscribe,()=>window.version);const [mode,setMode]=useState('editor');window.showMode=value=>{setMode(value);setShow(true)};const [show,setShow]=useState(true);const [owner,setOwner]=useState('owner-a');const [offline,setOffline]=useState(false);window.disableFields=()=>setOffline(true);window.openEditor=next=>{setOwner(next);setOffline(false);setShow(true)};return !show?null:mode==='work'?<BotWorkSummary task={window.botTask} onRoutines={()=>window.workTarget='routines'} onWorkers={()=>window.workTarget='workers'}/>:mode==='avatar'?<BotAvatarEditor task={window.botTask} onSaved={()=>{}} onClose={()=>setShow(false)}/>:mode==='list'?<BotsScreen/>:mode==='memory'?<BotMemory taskId='bot-a' onClose={()=>setShow(false)}/>:mode==='settings'?<BotSettings task={window.botTask} onClose={()=>setShow(false)}/>:show?<BotEditor draftKey={owner} initial={initial} unavailable={offline?'Computer is offline':undefined} onClose={()=>setShow(false)} onSave={async value=>{if(window.rejectSave)throw Error('Runtime unavailable');window.saved.push({owner,value})}}/>:null}
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
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
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
      '@effect/atom-react': root + 'apps/mobile/node_modules/@effect/atom-react/dist/index.js',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: native },
    {
      path: '../ui/controls/choice',
      importer: mobile + 'bots/',
      contents:
        'export const Choice=({label,value,items,disabled,onChange})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;',
    },
    {
      path: 'expo-image-picker',
      contents: 'export const launchImageLibraryAsync=async()=>({canceled:true});',
    },
    {
      path: '../resources/catalog-picker',
      importer: mobile + 'bots/',
      contents: 'export const CatalogPicker=()=>null;',
    },
    {
      path: '../resources/editor',
      importer: mobile + 'bots/',
      contents: `export const ResourceEditor=()=>null;`,
    },
    {
      path: '../shell/navigation',
      importer: mobile + 'bots/',
      contents: 'export const useNavigation=()=>({navigate:(...args)=>window.navigation=args});',
    },
    {
      path: '../shell/more-actions',
      importer: mobile + 'bots/',
      contents: 'export const useMoreActions=()=>[];',
    },
    {
      path: '../workspace/workspace-modes',
      importer: mobile + 'bots/',
      contents: 'export const WorkspaceModes=()=>null;',
    },
    {
      path: '../ui/controls/icon',
      importer: mobile + 'bots/',
      contents: 'export const Icon=()=>null;',
    },
    {
      path: '../tasks/list/task-list-row',
      importer: mobile + 'bots/',
      contents:
        'export const TaskListRow=({row,commands})=><button data-testid={`Bot thread ${row.task.title}`} onClick={()=>commands.open(row.key)}>{row.task.title}</button>;',
    },
    {
      path: '../ui/layout/screen-header',
      importer: mobile + 'bots/',
      contents:
        'export const ScreenHeader=({title,buttons})=><header><h1>{title}</h1>{buttons.map(button=><button key={button.label} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;',
    },

    {
      path: 'expo-crypto',
      contents:
        'let next=0;export const randomUUID=()=>`00000000-0000-4000-8000-${String(++next).padStart(12,"0")}`;',
    },
    { path: 'expo-router', contents: 'export const router={navigate:href=>window.route=href};' },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'bots/',
      contents:
        "import {useSyncExternalStore} from 'react';export const RuntimeScope=({children})=>children;export const useRuntime=()=>{useSyncExternalStore(window.subscribe,()=>window.version);return window.runtime};",
    },
    {
      path: '../tasks/detail/harness-settings',
      importer: mobile + 'bots/',
      contents:
        'export const HarnessSettings=({task,onClose})=><div role="dialog" aria-label="Harness settings">{task.id}<button onClick={onClose}>Close harness</button></div>;',
    },
    {
      path: '../ui/layout/sheet',
      importer: mobile + 'bots/',
      contents:
        'export const useSheetNavigation=()=>callback=>callback();export const Sheet=({title,children,footer,onClose})=><section role="dialog" aria-label={title}>{children}{footer}<button onClick={onClose}>Close sheet</button></section>;',
    },
    {
      path: './icon-button',
      importer: mobile + 'ui/controls/',
      contents: 'export const IconButton=()=>null;',
    },
    {
      path: '../theme',
      importer: mobile + 'ui/',
      contents: 'export const useTheme=()=>({styles:{},colors:{}});',
    },
    {
      path: '../ui/theme',
      importer: mobile + 'bots/',
      contents: 'export const useTheme=()=>({styles:{},colors:{}});',
    },
    { path: './icon', importer: mobile + 'ui/controls/', contents: 'export const Icon=()=>null;' },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByLabel('Bot name', { exact: true }).fill('Operations assistant')
  await page
    .getByLabel('Responsibilities', { exact: true })
    .fill('Keep explicit user preferences\nPreserve HTTP on LAN')
  assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'Release lead')
  assert.equal(
    await page.getByLabel('Responsibilities', { exact: true }).inputValue(),
    'Keep explicit user preferences\nPreserve HTTP on LAN',
  )
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'Operations assistant',
  )
  await page.evaluate(() => window.disableFields())
  for (const label of ['Bot name', 'Role', 'Responsibilities'])
    assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true)
  assert.equal(
    await page.getByLabel('Responsibilities', { exact: true }).inputValue(),
    'Keep explicit user preferences\nPreserve HTTP on LAN',
  )
  assert.equal(await page.getByRole('button', { name: 'Save Bot', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => window.openEditor('owner-b'))
  assert.equal(await page.getByLabel('Bot name', { exact: true }).inputValue(), 'Release assistant')
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => window.openEditor('owner-a'))
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'Operations assistant',
  )
  await page.evaluate(() => {
    window.rejectSave = true
  })
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page.getByText('Runtime unavailable', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Responsibilities', { exact: true }).inputValue(),
    'Keep explicit user preferences\nPreserve HTTP on LAN',
  )
  await page.evaluate(() => {
    window.rejectSave = false
  })
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.saved.length), 1)
  assert.equal(await page.evaluate(() => window.saved[0].owner), 'owner-a')
  await page.evaluate(() => {
    window.runtime.snapshot.botsSupported = true
    window.runtime.snapshot.workspace.repositories = [
      {
        id: 'project',
        name: 'Project',
        path: '/project',
        branch: 'main',
        resources: {
          mcpServers: [],
          skills: [
            {
              name: 'shared-review',
              description: 'Shared review',
              content: 'Shared',
              enabled: true,
            },
          ],
        },
      },
    ]
    window.runtime.snapshot.defaults = {
      scopedSettings: {
        shared: [],
        environment: {
          resources: {
            mcpServers: [],
            skills: [
              {
                name: 'shared-review',
                description: 'Shared review',
                content: 'Shared',
                enabled: true,
              },
            ],
          },
        },
      },
    }
    window.showMode('settings')
  })
  await page.evaluate(() => {
    window.runtime.snapshot.workspace.automations = [
      {
        id: 'release-check',
        name: 'Release check',
        enabled: true,
        nodes: [
          {
            id: 'trigger',
            data: {
              kind: 'trigger',
              trigger: 'schedule',
              schedule: '0 9 * * 1-5',
              timezone: 'Europe/Amsterdam',
            },
          },
          { id: 'job', data: { kind: 'task', botId: 'bot-a', label: 'Check release' } },
          { id: 'review', data: { kind: 'review', label: 'Approve publication' } },
        ],
      },
    ]
    window.runtime.snapshot.runs = [
      {
        id: 'release-review',
        automationId: 'release-check',
        status: 'waiting',
        createdAt: '2026-11-13T09:00:00Z',
        completedNodes: [],
        taskIds: [],
      },
      {
        id: 'unrelated-run',
        automationId: 'other-flow',
        status: 'failed',
        createdAt: '2026-11-13T10:00:00Z',
        completedNodes: [],
        taskIds: [],
      },
    ]
    window.publish()
  })
  await page.evaluate(() => window.showMode('work'))
  await page.getByRole('button', { name: 'Routines · 1 · 1 need review', exact: true }).click()
  assert.equal(await page.evaluate(() => window.workTarget), 'routines')
  await page.getByRole('button', { name: 'Workers · 0 active', exact: true }).click()
  assert.equal(await page.evaluate(() => window.workTarget), 'workers')
  await page.evaluate(() => window.showMode('settings'))
  await page.getByRole('button', { name: 'Bot routines', exact: true }).click()
  await page.getByText('Weekdays at 09:00 · Europe/Amsterdam', { exact: true }).waitFor()
  await page.getByText('Check release · This Bot', { exact: true }).waitFor()
  await page.getByText('Approve publication · Human review', { exact: true }).waitFor()
  await page.getByRole('button', { name: /^Needs review ·/ }).click()
  assert.deepEqual(await page.evaluate(() => window.route), {
    pathname: '/settings/automations/[runtimeId]/[automationId]',
    params: { runtimeId: 'paired-owner', automationId: 'release-check', runId: 'release-review' },
  })
  await page.getByRole('button', { name: 'Release check', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.route), {
    pathname: '/settings/automations/[runtimeId]/[automationId]',
    params: { runtimeId: 'paired-owner', automationId: 'release-check' },
  })
  await page
    .getByRole('dialog', { name: 'Bot routines', exact: true })
    .getByRole('button', { name: 'Close sheet', exact: true })
    .click()
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).waitFor()
  await page.getByLabel('Role', { exact: true }).fill('Senior reviewer')
  await page.getByRole('button', { name: 'Bot skills', exact: true }).click()
  await page
    .getByRole('button', { name: 'Disable inherited skill shared-review', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Restore inherited skill shared-review', exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((item) => item.path === '/api/bots/update').length,
    ),
    0,
  )
  await page
    .getByRole('dialog', { name: 'Bot skills', exact: true })
    .getByRole('button', { name: 'Close sheet', exact: true })
    .click()
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    window.botTask = {
      ...window.botTask,
      bot: { ...window.botTask.bot, revision: '22222222-2222-4222-8222-222222222222' },
    }
    window.showMode('settings')
  })
  assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'Senior reviewer')
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.botTask.bot.role), 'Senior reviewer')
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.requests.filter((item) => item.path === '/api/bots/update').at(-1).input.resources
          .disabledSkills,
    ),
    ['shared-review'],
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.requests.filter((item) => item.path === '/api/bots/update').at(-1).input
          .expectedRevision,
    ),
    '11111111-1111-4111-8111-111111111111',
  )
  await page.evaluate(() => {
    window.rejectRename = true
    window.showMode('settings')
  })
  await page.getByLabel('Bot name', { exact: true }).fill('Human renamed Bot')
  await page.getByLabel('Role', { exact: true }).fill('Temporary role')
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page
    .getByText('Bot name changed. Your draft is kept. Refresh before saving again.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.getByLabel('Bot name', { exact: true }).inputValue(), 'Human renamed Bot')
  await page.evaluate(() => {
    window.rejectRename = false
    window.failBotUpdate = true
  })
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page.getByText('Bot save failed after rename', { exact: true }).waitFor()
  const renamesBeforeRetry = await page.evaluate(
    () => window.requests.filter((item) => item.path === '/api/workspace').length,
  )
  await page.evaluate(() => {
    window.failBotUpdate = false
  })
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((item) => item.path === '/api/workspace').length,
    ),
    renamesBeforeRetry,
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.requests.filter((item) => item.path === '/api/workspace').at(-1).input.changes.title
          .before,
    ),
    'Review assistant',
  )
  await page.evaluate(() => {
    window.strictCas = true
    window.showMode('settings')
  })
  await page.getByLabel('Role', { exact: true }).fill('Retained conflicting role')
  await page.evaluate(() => {
    window.lifecycleNoopExternal = true
  })
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Save Bot', exact: true }).click()
  await page
    .getByText('Bot settings changed. Reopen after resolving your draft.', { exact: true })
    .waitFor()
  assert.equal(
    await page.getByLabel('Role', { exact: true }).inputValue(),
    'Retained conflicting role',
  )
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => window.showMode('memory'))
  await page.getByRole('button', { name: 'Add memory note', exact: true }).click()
  await page.getByLabel('Note name', { exact: true }).fill('Release policy')
  await page.getByLabel('Note content', { exact: true }).fill('Preserve HTTP for LAN connections')
  await page.evaluate(() => {
    window.failMemory = true
  })
  await page.getByRole('button', { name: 'Save memory note', exact: true }).click()
  await page.getByText('Memory changed. Refresh before saving.', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Note content', { exact: true }).inputValue(),
    'Preserve HTTP for LAN connections',
  )
  await page.evaluate(() => {
    window.failMemory = false
  })
  await page.getByRole('button', { name: 'Save memory note', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Release policy', exact: true }).waitFor()
  const writes = await page.evaluate(() =>
    window.requests.filter((request) => request.path === '/api/memory/write'),
  )
  assert.equal(writes.at(-1).input.scope, 'bot')
  assert.equal(writes.at(-1).input.botId, 'bot-a')
  assert.equal(writes.at(-1).owner, 'paired-owner')
  await page.getByRole('button', { name: 'Edit Release policy', exact: true }).click()
  await page.getByRole('button', { name: 'Delete memory note', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete note', exact: true }).click()
  await page.getByText('No memory notes yet.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    window.runtime.profile.name = 'Source runtime'
    const normal = {
      ...window.botTask,
      id: 'ordinary-chat',
      title: 'Ordinary chat',
      bot: undefined,
    }
    window.runtime.snapshot = window.makeListSnapshot(window.botTask, normal)
    window.runtime.overviews = [
      {
        profile: window.runtime.profile,
        snapshot: window.runtime.snapshot,
        connected: true,
        lastSeen: null,
        error: null,
        pulls: null,
        pullError: null,
      },
    ]
    window.runtime.refreshAll = async () => {}
    window.showMode('list')
  })
  await page.getByTestId('Bot thread Human renamed Bot').waitFor()
  assert.equal(await page.getByTestId('Bot thread Human renamed Bot').count(), 1)
  assert.equal(await page.getByText('Ordinary chat', { exact: true }).count(), 0)
  await page.getByLabel('Search Bots', { exact: true }).fill('External role')
  await page.getByTestId('Bot thread Human renamed Bot').waitFor()
  await page.getByLabel('Search Bots', { exact: true }).fill('Unknown assistant')
  await page.getByText('No matching Bots.', { exact: true }).waitFor()
  await page.getByLabel('Search Bots', { exact: true }).fill('')
  await page.getByTestId('Bot thread Human renamed Bot').click()
  assert.deepEqual(await page.evaluate(() => window.navigation), ['tasks', 'bot-a', 'paired-owner'])
  // Exercise the actual avatar editor; only the native choice control is replaced.
  await page.evaluate(() => {
    window.runtime.snapshot.botAvatarsSupported = true
    window.runtime.snapshot.botAvatarHarnessSelectionSupported = true
    window.runtime.call = async (path, input) => {
      window.avatarCalls ??= []
      window.avatarCalls.push({ path, input })
      if (window.avatarCalls.length === 1) throw Error('Avatar response lost')
      return {
        avatar: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
      }
    }
    window.showMode('avatar')
  })
  await page.getByLabel('Avatar generation harness', { exact: true }).selectOption('harness:claude')
  await page.getByRole('button', { name: 'Generate avatar', exact: true }).click()
  await page.getByText('Avatar response lost', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Avatar generation harness', { exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Retry generation', exact: true }).click()
  await page.getByRole('button', { name: 'Use avatar', exact: true }).waitFor()
  const calls = await page.evaluate(() => window.avatarCalls)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[0].input.harnessId, 'harness:claude')
  assert.equal(
    await page.getByLabel('Avatar generation harness', { exact: true }).isDisabled(),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Bots: real settings/memory/list components, owner scope, pause/resume, private notes, conflict drafts and old runtime gates pass.',
  )
} finally {
  await browser.close()
}

// Bot creation: the real create sheet, Sheet, fields, actions and theme, with several computers.
// The native shim models RN column layout and Dynamic Type scaling. It does not establish
// UIKit sheet presentation, keyboard animation or a live device-to-runtime connection.
const styledNative = `
import {useImperativeHandle,useRef,useSyncExternalStore} from 'react';
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s||{};
const css=s=>{const v={...flat(s)};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(v[key]!==undefined)for(const axis of axes)v[axis]??=v[key];delete v[key]}return Object.fromEntries(Object.entries(v).filter(([,value])=>value!=null))};
const base={display:'flex',flexDirection:'column',alignItems:'stretch',flexShrink:0,minHeight:0,minWidth:0,position:'relative',boxSizing:'border-box'};
const scale=()=>window.fontScale;
export const StyleSheet={create:s=>s,flatten:flat,hairlineWidth:1};
export const Platform={OS:'android'};export const Alert={alert(){}};
const keyboard=new Map();
export const Keyboard={dismiss(){},addListener:(event,callback)=>{const set=keyboard.get(event)??new Set();set.add(callback);keyboard.set(event,set);return {remove:()=>set.delete(callback)}}};
export const useWindowDimensions=()=>{useSyncExternalStore(window.subscribe,()=>window.version);return {width:innerWidth,height:innerHeight,fontScale:scale()}};
export const View=({children,style,testID,accessibilityLabel,accessibilityRole,role})=><div data-testid={testID} role={role??accessibilityRole} aria-label={accessibilityLabel} style={{...base,...css(style)}}>{children}</div>;
export const KeyboardAvoidingView=View;
export const ScrollView=({children,style,contentContainerStyle})=><div data-scroll style={{...base,overflowY:'auto',overflowX:'hidden',flexGrow:1,flexShrink:1,...css(style)}}><div style={{...base,...css(contentContainerStyle)}}>{children}</div></div>;
export const Text=({children,style,accessibilityRole})=>{const v=css(style);return <span role={accessibilityRole==='header'?'heading':accessibilityRole} style={{display:'block',overflowWrap:'anywhere',fontFamily:'system-ui',...v,fontSize:(v.fontSize??14)*scale(),lineHeight:v.lineHeight?v.lineHeight*scale()+'px':undefined}}>{children}</span>};
export const TextInput=({ref,style,multiline,accessibilityLabel,accessibilityHint,value,onChangeText,editable,testID})=>{const input=useRef();useImperativeHandle(ref,()=>({focus:()=>input.current?.focus()}));const v=css(style);const Component=multiline?'textarea':'input';return <Component ref={input} data-testid={testID} aria-label={accessibilityLabel} aria-description={accessibilityHint} value={value} disabled={editable===false} onChange={event=>onChangeText?.(event.target.value)} style={{boxSizing:'border-box',borderStyle:'solid',outline:0,resize:'none',fontFamily:'system-ui',...v,fontSize:(v.fontSize??14)*scale()}}/>};
export const Pressable=({children,style,onPress,testID,accessibilityLabel,accessibilityRole,accessibilityState,disabled})=><button data-testid={testID} aria-label={accessibilityLabel} role={accessibilityRole} aria-checked={accessibilityRole==='radio'?!!accessibilityState?.checked:undefined} aria-expanded={accessibilityState?.expanded} disabled={disabled} onClick={onPress} style={{...base,border:0,margin:0,padding:0,background:'transparent',font:'inherit',color:'inherit',textAlign:'left',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Image=()=>null;
export const FlatList=({data,renderItem,keyExtractor,ListEmptyComponent})=><main>{data.length?data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>):ListEmptyComponent}</main>;
`
const preferences =
  "export const carZoom=1.4;export const useCarMode=()=>false;export const useMobilePreferences=()=>({threadDensity:'comfortable'});"
const createBuilt = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState,useSyncExternalStore} from 'react';
import {RegistryProvider} from '@effect/atom-react';
import {Effect} from 'effect';
import {decode,botCreateSchema,snapshotSchema,RuntimeRequestError} from '@dovo/protocol';
import {createMobileTheme,MobileThemeContext} from './src/ui/theme';
import BotsScreen from './src/bots/bots-screen';
window.version=0;const listeners=new Set();window.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};window.publish=()=>{window.version++;listeners.forEach(fn=>fn())};
const scratch={id:'dovo:scratch',name:'No Project',kind:'scratch',path:'/scratch',branch:'main'};
const snapshot=(botsSupported,defaults)=>decode(snapshotSchema,{revision:1,owner:false,...(botsSupported?{botsSupported}:{}),defaults,workspace:{version:1,runtimeAddress:'',repositories:[scratch],agents:[],tasks:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
const host=(id,name,overrides={})=>({profile:{id,name,nameIsCustom:true,connection:{address:'http://'+id+'.lan:51464',token:'token-'+id+'-0123456789abcdef',runtimeId:'machine-'+id}},connected:true,lastSeen:null,error:null,pulls:null,pullError:null,snapshot:snapshot(true),...overrides});
window.hosts=[
  host('studio','Mac Studio'),
  host('laptop','Travel laptop with a long computer name'),
  host('old','Build server',{snapshot:snapshot(false)}),
  host('away','Home NAS',{connected:false}),
];
window.hosts[0].snapshot=snapshot(true,{scopedSettings:{shared:[],environment:{taskDefaults:{modelSelection:'smart'}}}});
window.setHost=(id,update)=>{window.hosts=window.hosts.map(entry=>entry.profile.id===id?update(entry):entry);window.publish()};
window.activeId='studio';window.requests=[];window.callMode='ok';window.held=[];
window.call=(profile,path,input)=>{
  window.requests.push({runtimeId:profile.id,token:profile.connection.token,path,input:structuredClone(input)});
  if(path!=='/api/bots/create')return Promise.reject(Error(path));
  decode(botCreateSchema,input);
  const result={id:input.createTask.id,bot:{role:input.role,responsibilities:input.responsibilities,state:'active',revision:'11111111-1111-4111-8111-111111111111',createdAt:input.createTask.createdAt,updatedAt:input.createTask.createdAt},revision:2,runtimeInstanceId:'instance-'+profile.id};
  if(window.callMode==='fail')return Promise.reject(Error('Temporary runtime outage'));
  if(window.callMode==='reject')return Promise.reject(new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'This Bot request conflicts with an earlier one.'}));
  if(window.callMode==='hold')return new Promise((resolve,reject)=>window.held.push(reply=>reply==='reject'?reject(new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'This Bot request conflicts with an earlier one.'})):reply==='fail'?reject(Error('Temporary runtime outage')):resolve(result)));
  return Promise.resolve(result);
};
function App(){useSyncExternalStore(window.subscribe,()=>window.version);const [shown,setShown]=useState(true);window.showScreen=setShown;return <MobileThemeContext.Provider value={createMobileTheme('dovo',window.mode)}><div style={{position:'fixed',inset:0,display:'flex',flexDirection:'column'}}>{shown&&<BotsScreen/>}</div></MobileThemeContext.Provider>}
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      'react-dom': root + 'apps/mobile/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
      '@effect/atom-react': root + 'apps/mobile/node_modules/@effect/atom-react/dist/index.js',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        // Metro picks the @3x icon variant; the repository stores only that file.
        name: 'icon-scale',
        setup(builder) {
          builder.onResolve({ filter: /assets\/icons\/[^/]+\.png$/ }, ({ path }) => ({
            path:
              root +
              'apps/mobile/assets/icons/' +
              path.split('/').at(-1).replace('.png', '@3x.png'),
          }))
        },
      },
    ],
  },
  [
    { path: 'react-native', contents: styledNative },
    {
      path: 'expo-crypto',
      contents:
        'let next=0;export const randomUUID=()=>`10000000-0000-4000-8000-${String(++next).padStart(12,"0")}`;',
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'bots/',
      contents: `
import {createContext,useContext,useSyncExternalStore} from 'react';import {Effect} from 'effect';
const Scoped=createContext(null);
const root=()=>({overviews:window.hosts,activeId:window.activeId,profile:null,snapshot:null,connected:false,refreshAll:async()=>{}});
export const useRuntime=()=>{useSyncExternalStore(window.subscribe,()=>window.version);return useContext(Scoped)??root()};
export function RuntimeScope({runtimeId,children}){useSyncExternalStore(window.subscribe,()=>window.version);const entry=window.hosts.find(item=>item.profile.id===runtimeId);if(!entry)return null;
  const value={...root(),activeId:runtimeId,profile:entry.profile,connection:entry.profile.connection,snapshot:entry.snapshot,connected:entry.connected,
    callEffect:(path,input)=>Effect.tryPromise({try:()=>window.call(entry.profile,path,input),catch:error=>error}),refresh:async()=>{}};
  return <Scoped.Provider key={entry.profile.connection.token} value={value}>{children}</Scoped.Provider>}`,
    },
    {
      path: './bot-settings',
      importer: mobile + 'bots/',
      contents: 'export const BotSettings=()=>null;',
    },
    {
      path: '../shell/navigation',
      importer: mobile + 'bots/',
      contents:
        'export const useNavigation=()=>({navigate:(...args)=>{window.navigations=[...(window.navigations??[]),args]}});',
    },
    {
      path: '../shell/more-actions',
      importer: mobile + 'bots/',
      contents: 'export const useMoreActions=()=>[];',
    },
    {
      path: '../workspace/workspace-modes',
      importer: mobile + 'bots/',
      contents: 'export const WorkspaceModes=()=>null;',
    },
    {
      path: '../tasks/list/task-list-row',
      importer: mobile + 'bots/',
      contents: 'export const TaskListRow=()=>null;',
    },
    {
      path: '../ui/layout/screen-header',
      importer: mobile + 'bots/',
      contents:
        'export const ScreenHeader=({title,buttons})=><header><h1>{title}</h1>{buttons.map(button=><button key={button.label} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;',
    },
    {
      path: '../runtime/preferences/app-preferences',
      importer: mobile + 'bots/',
      contents: preferences,
    },
    {
      path: '../../runtime/preferences/app-preferences',
      importer: mobile + 'ui/',
      contents: preferences,
    },
    {
      path: './safe-modal',
      importer: mobile + 'ui/layout/',
      contents: `import {useTheme} from '${mobile}ui/theme';export const SafeModal=({visible,children})=>{const {colors}=useTheme();return visible?<div data-modal style={{position:'fixed',inset:0,display:'flex',flexDirection:'column',background:colors.background,color:colors.text}}>{children}</div>:null};`,
    },
    {
      path: '../controls/native-icon',
      importer: mobile + 'ui/layout/',
      contents: 'export const NativeIcon=()=>null;export const NativeMenuButton=()=>null;',
    },
    {
      path: '@expo/ui/swift-ui',
      contents:
        'const Wrap=({children})=>children;export const BottomSheet=Wrap,Button=Wrap,Group=Wrap,Host=Wrap,NavigationStack=Wrap,RNHostView=Wrap;export const Toolbar=Object.assign(Wrap,{Content:Wrap});',
    },
    {
      path: '@expo/ui/swift-ui/modifiers',
      contents: [
        'accessibilityLabel',
        'disabled',
        'interactiveDismissDisabled',
        'labelStyle',
        'navigationTitle',
        'navigationBarTitleDisplayMode',
        'presentationDetents',
        'presentationDragIndicator',
      ]
        .map((name) => `export const ${name}=()=>null;`)
        .join(''),
    },
    ...[
      ['../controls/icon-button', mobile + 'ui/layout/'],
      ['./icon-button', mobile + 'ui/controls/'],
    ].map(([path, importer]) => ({
      path,
      importer,
      contents:
        "export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress} style={{width:44,height:44,flexShrink:0,border:0,borderRadius:22,background:'transparent',color:'inherit',fontSize:22}}>×</button>;",
    })),
    ...[
      ['../ui/controls/icon', mobile + 'bots/'],
      ['./icon', mobile + 'ui/controls/'],
    ].map(([path, importer]) => ({
      path,
      importer,
      contents: `import {iconAssets} from '${mobile}ui/controls/icon-assets';export const Icon=({name,size=20,color})=><span aria-hidden data-icon={name} style={{display:'block',width:size,height:size,flexShrink:0,backgroundColor:color||'currentColor',maskImage:'url('+iconAssets[name]+')',maskSize:'contain',maskRepeat:'no-repeat',WebkitMaskImage:'url('+iconAssets[name]+')',WebkitMaskSize:'contain'}}/>;`,
    })),
  ],
)
const createBrowser = await chromium.launch()
try {
  const open = async ({ mode = 'light', fontScale = 1 } = {}) => {
    const page = await createBrowser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html><body style="margin:0"><div id="app"></div></body></html>')
    await page.evaluate(({ mode, fontScale }) => Object.assign(window, { mode, fontScale }), {
      mode,
      fontScale,
    })
    await page.addScriptTag({ content: createBuilt.outputFiles[0].text })
    return { page, errors }
  }
  const creates = (page) =>
    page.evaluate(() => window.requests.filter((item) => item.path === '/api/bots/create'))
  const fields = (page) =>
    Promise.all(
      ['Bot name', 'Role', 'Responsibilities'].map((label) =>
        page.getByLabel(label, { exact: true }).inputValue(),
      ),
    )
  const noOverflow = async (page, label) => {
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('[data-modal] *')]
        .filter((node) => node.getBoundingClientRect().right > innerWidth + 0.5)
        .map((node) => node.outerHTML.slice(0, 120)),
    )
    assert.deepEqual(overflow, [], `${label}: no horizontal overflow`)
  }
  const targetSizes = async (page) => {
    for (const button of await page.locator('[data-modal] button:visible').all()) {
      const box = await button.boundingBox()
      assert.ok(
        box.height >= 44,
        `Pressable target is at least 44pt: ${await button.getAttribute('aria-label')}`,
      )
    }
  }

  const { page, errors } = await open()
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  const runsOn = page.getByTestId('Runs on')
  // The picker stays visible with one ready computer, and the active computer is the default.
  assert.match(
    await runsOn.getAttribute('aria-label'),
    /^Runs on Mac Studio, Online\. Change computer$/,
  )
  await page.getByRole('heading', { name: 'Create your Bot', exact: true }).waitFor()
  await noOverflow(page, 'empty form')
  await targetSizes(page)
  await page.screenshot({ path: '/tmp/dovo-bot-create-mobile-empty.png' })
  // A starter fills only empty fields. It never replaces typed text.
  await page.getByLabel('Bot name', { exact: true }).fill('My release helper')
  await page.getByRole('button', { name: 'Use Release starter', exact: true }).click()
  assert.deepEqual(await fields(page), [
    'My release helper',
    'Keep releases ready to ship.',
    'Investigate failed checks.\nPrepare release notes.\nAsk before publishing.',
  ])
  await page.getByRole('button', { name: 'Use Research starter', exact: true }).waitFor({
    state: 'detached',
  })
  assert.equal((await creates(page)).length, 0, 'A starter sends nothing')
  await page.getByLabel('Bot name', { exact: true }).fill('Release assistant')
  await page.getByLabel('Role', { exact: true }).fill('Keep releases ready to ship')
  await page
    .getByLabel('Responsibilities', { exact: true })
    .fill('Investigate failed checks.\nPrepare release notes.\nAsk before publishing.')
  const text = await fields(page)
  await noOverflow(page, 'filled form')
  await targetSizes(page)
  await page.screenshot({ path: '/tmp/dovo-bot-create-mobile.png' })

  await runsOn.click()
  const radios = page.getByRole('radio')
  assert.equal(await radios.count(), 4)
  for (const [name, status, enabled, checked] of [
    ['Mac Studio', 'Online', true, true],
    ['Travel laptop with a long computer name', 'Online', true, false],
    ['Build server', 'Update required', false, false],
    ['Home NAS', 'Offline', false, false],
  ]) {
    const radio = page.getByRole('radio', { name: `${name}, ${status}`, exact: true })
    assert.equal(await radio.isEnabled(), enabled, `${name} enabled`)
    assert.equal(await radio.getAttribute('aria-checked'), String(checked), `${name} checked`)
  }
  await noOverflow(page, 'open picker')
  await targetSizes(page)
  await page.screenshot({ path: '/tmp/dovo-bot-create-mobile-picker.png' })
  // Changing the computer keeps the form open and the text intact.
  await page.getByRole('radio', { name: 'Travel laptop with a long computer name, Online' }).click()
  assert.equal(await radios.count(), 0)
  assert.deepEqual(await fields(page), text)
  assert.match(
    await runsOn.getAttribute('aria-label'),
    /^Runs on Travel laptop with a long computer name, Online/,
  )

  // An uncertain failure freezes the exact body, computer and pairing.
  await page.evaluate(() => (window.callMode = 'fail'))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByText('Temporary runtime outage', { exact: true }).waitFor()
  const [first] = await creates(page)
  assert.equal(first.runtimeId, 'laptop')
  assert.equal(first.token, 'token-laptop-0123456789abcdef')
  assert.equal(first.input.createTask.repositoryId, 'dovo:scratch')
  assert.equal(first.input.createTask.execution, 'main')
  assert.equal(first.input.createTask.modelSelection, undefined, 'Laptop uses its own defaults')
  assert.equal(first.input.createTask.title, 'Release assistant')
  assert.equal(await runsOn.isDisabled(), true)
  for (const label of ['Bot name', 'Role', 'Responsibilities'])
    assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true)
  await page
    .getByText(
      'Retry sends the original request to Travel laptop with a long computer name. This prevents a duplicate Bot.',
      { exact: true },
    )
    .waitFor()
  await noOverflow(page, 'retry')
  await page.screenshot({ path: '/tmp/dovo-bot-create-mobile-retry.png' })

  // Closing keeps the frozen request in memory.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('[data-modal]').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.deepEqual(await fields(page), text)
  assert.match(await runsOn.getAttribute('aria-label'), /^Runs on Travel laptop/)

  // Offline: retry waits and the request is kept.
  await page.evaluate(() => window.setHost('laptop', (entry) => ({ ...entry, connected: false })))
  await page
    .getByText(
      'Reconnect Travel laptop with a long computer name to retry. Your request is kept.',
      {
        exact: true,
      },
    )
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry Create Bot' }).isDisabled(), true)
  // A replacement pairing that cannot be matched to the same computer blocks the retry.
  await page.evaluate(() =>
    window.setHost('laptop', (entry) => ({
      ...entry,
      connected: true,
      profile: {
        ...entry.profile,
        connection: {
          ...entry.profile.connection,
          token: 'token-unknown-0123456789abcdef',
          runtimeId: undefined,
        },
      },
    })),
  )
  await page.getByText(/was paired again, so Dovo will not resend the earlier request/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry Create Bot' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Discard earlier request', exact: true }).waitFor()
  // The same machine ID with new credentials still does not inherit the frozen request.
  await page.evaluate(() =>
    window.setHost('laptop', (entry) => ({
      ...entry,
      profile: {
        ...entry.profile,
        connection: {
          ...entry.profile.connection,
          token: 'token-repaired-0123456789abcdef',
          runtimeId: 'machine-laptop',
        },
      },
    })),
  )
  await page.getByText(/was paired again, so Dovo will not resend the earlier request/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry Create Bot' }).isDisabled(), true)
  assert.equal((await creates(page)).length, 1, 'Nothing is sent with replacement credentials')
  // Discard needs an explicit confirmation that warns about a second Bot.
  await page.getByRole('button', { name: 'Discard earlier request', exact: true }).click()
  await page.getByText(/may already have created this Bot on Travel laptop/).waitFor()
  await page.getByText(/can make a second Bot/).waitFor()
  await noOverflow(page, 'discard confirmation')
  await page.screenshot({ path: '/tmp/dovo-bot-create-mobile-discard.png' })
  await page.getByRole('button', { name: 'Keep earlier request', exact: true }).click()
  assert.equal(await page.getByLabel('Bot name', { exact: true }).isDisabled(), true)
  // The original pairing comes back with new defaults. Retry sends the frozen body unchanged.
  await page.evaluate(() =>
    window.setHost('laptop', (entry) => ({
      ...entry,
      profile: {
        ...entry.profile,
        connection: {
          ...entry.profile.connection,
          token: 'token-laptop-0123456789abcdef',
          runtimeId: 'machine-laptop',
        },
      },
      snapshot: {
        ...entry.snapshot,
        defaults: {
          scopedSettings: {
            shared: [],
            environment: { taskDefaults: { modelSelection: 'smart' } },
          },
        },
      },
    })),
  )
  assert.equal(await page.getByRole('button', { name: 'Discard earlier request' }).count(), 0)
  await page.evaluate(() => (window.callMode = 'ok'))
  await page.getByRole('button', { name: 'Retry Create Bot', exact: true }).click()
  await page.waitForFunction(() => window.navigations?.length === 1)
  await page.locator('[data-modal]').waitFor({ state: 'detached' })
  const [, second] = await creates(page)
  assert.deepEqual(second.input, first.input, 'Retry sends the exact original body')
  assert.equal(second.runtimeId, 'laptop')
  assert.equal(second.token, 'token-laptop-0123456789abcdef', 'Retry uses the frozen pairing')
  // Routing uses the receipt and the computer that received the request.
  assert.deepEqual(await page.evaluate(() => window.navigations[0]), [
    'tasks',
    first.input.createTask.id,
    'laptop',
  ])
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.deepEqual(await fields(page), ['', '', ''], 'A created Bot clears its draft')

  // A late reply to an old request cannot close or redirect a newer draft.
  await page.getByLabel('Bot name', { exact: true }).fill('Research Bot')
  await page.getByLabel('Role', { exact: true }).fill('Research lead')
  await runsOn.click()
  await page.getByRole('radio', { name: 'Mac Studio, Online' }).click()
  await page.evaluate(() => (window.callMode = 'hold'))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => window.held.length === 1)
  const [, , held] = await creates(page)
  assert.equal(held.runtimeId, 'studio')
  assert.equal(held.input.createTask.modelSelection, 'smart', 'Studio uses its own defaults')
  assert.notEqual(held.input.requestId, first.input.requestId)
  assert.notEqual(held.input.createTask.id, first.input.createTask.id)
  // Leaving the screen unmounts the in-flight sheet; the frozen request stays in memory.
  await page.evaluate(() => window.showScreen(false))
  await page.getByRole('button', { name: 'New Bot', exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.setHost('studio', (entry) => ({ ...entry, connected: false }))
    window.showScreen(true)
  })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.deepEqual(await fields(page), ['Research Bot', 'Research lead', ''])
  await page.getByRole('button', { name: 'Discard earlier request', exact: true }).click()
  await page.getByRole('button', { name: 'Discard and allow a new request', exact: true }).click()
  await page.getByLabel('Responsibilities', { exact: true }).fill('Summarise new papers')
  await runsOn.click()
  await page.getByRole('radio', { name: 'Travel laptop with a long computer name, Online' }).click()
  await page.evaluate(() => window.held[0]())
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.navigations.length), 1, 'No late redirect')
  assert.deepEqual(await fields(page), ['Research Bot', 'Research lead', 'Summarise new papers'])
  await page.getByTestId('Runs on').waitFor()

  // A confirmed rejection releases the frozen request and keeps the text.
  await page.evaluate(() => (window.callMode = 'reject'))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByText('This Bot request conflicts with an earlier one.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Bot name', { exact: true }).isEnabled(), true)
  assert.equal(await runsOn.isEnabled(), true)
  await page.evaluate(() => (window.callMode = 'ok'))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => window.navigations.length === 2)
  const all = await creates(page)
  assert.notEqual(all.at(-1).input.requestId, all.at(-2).input.requestId)
  assert.deepEqual(await page.evaluate(() => window.navigations[1]), [
    'tasks',
    all.at(-1).input.createTask.id,
    'laptop',
  ])

  // A selected computer that stops being ready shows why. Nothing switches or sends silently.
  const sent = all.length
  await page.evaluate(() => window.setHost('studio', (entry) => ({ ...entry, connected: true })))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByLabel('Bot name', { exact: true }).fill('Waiting Bot')
  await page.getByLabel('Role', { exact: true }).fill('Assistant')
  await runsOn.click()
  await page.getByRole('radio', { name: 'Travel laptop with a long computer name, Online' }).click()
  await page.evaluate(() =>
    window.setHost('laptop', (entry) => ({
      ...entry,
      snapshot: { ...entry.snapshot, workspace: { ...entry.snapshot.workspace, repositories: [] } },
    })),
  )
  await page
    .getByText('This computer cannot safely start a Bot. Refresh its runtime and try again.', {
      exact: true,
    })
    .waitFor()
  assert.match(
    await runsOn.getAttribute('aria-label'),
    /^Runs on Travel laptop with a long computer name, Not ready/,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isDisabled(),
    true,
  )
  assert.equal((await creates(page)).length, sent)
  await runsOn.click()
  await page.getByRole('radio', { name: 'Mac Studio, Online' }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isEnabled(),
    true,
  )
  assert.deepEqual(await fields(page), ['Waiting Bot', 'Assistant', ''])

  // A removed selection never falls back to another computer.
  await page.evaluate(() => {
    window.removed = window.hosts.find((entry) => entry.profile.id === 'studio')
    window.hosts = window.hosts.filter((entry) => entry !== window.removed)
    window.setHost('laptop', (entry) => ({
      ...entry,
      snapshot: {
        ...entry.snapshot,
        workspace: {
          ...entry.snapshot.workspace,
          repositories: [
            {
              id: 'dovo:scratch',
              name: 'No Project',
              kind: 'scratch',
              path: '/scratch',
              branch: 'main',
            },
          ],
        },
      },
    }))
  })
  await page
    .getByText('The selected computer is no longer paired. Choose another computer.', {
      exact: true,
    })
    .waitFor()
  assert.match(await runsOn.getAttribute('aria-label'), /^Runs on Choose a computer, unavailable/)
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isDisabled(),
    true,
  )
  assert.equal((await creates(page)).length, sent)
  await runsOn.click()
  await page.getByRole('radio', { name: 'Travel laptop with a long computer name, Online' }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isEnabled(),
    true,
  )
  assert.deepEqual(await fields(page), ['Waiting Bot', 'Assistant', ''])
  assert.deepEqual(errors, [])
  await page.close()

  // The default destination is fixed once shown. It does not move when its status changes.
  {
    const view = await open()
    const scoped = view.page.getByTestId('Runs on')
    const navigated = () => view.page.evaluate(() => (window.navigations ?? []).length)
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    assert.match(await scoped.getAttribute('aria-label'), /^Runs on Mac Studio, Online/)
    await view.page.evaluate(() =>
      window.setHost('studio', (entry) => ({ ...entry, connected: false })),
    )
    await view.page.getByText('Reconnect this computer to create a Bot.', { exact: true }).waitFor()
    assert.match(await scoped.getAttribute('aria-label'), /^Runs on Mac Studio, Offline/)
    await view.page.evaluate(() =>
      window.setHost('studio', (entry) => ({ ...entry, connected: true })),
    )

    // A late success after the computer was paired again cannot route through the new pairing.
    await view.page.getByLabel('Bot name', { exact: true }).fill('Pairing Bot')
    await view.page.getByLabel('Role', { exact: true }).fill('Assistant')
    await view.page.evaluate(() => (window.callMode = 'hold'))
    await view.page.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.held.length === 1)
    await view.page.evaluate(() => {
      window.setHost('studio', (entry) => ({
        ...entry,
        profile: {
          ...entry.profile,
          connection: { ...entry.profile.connection, token: 'token-studio-new-0123456789abcdef' },
        },
      }))
      window.held[0]()
    })
    await view.page
      .getByText(/The Bot was created, but its computer was paired again or removed/)
      .waitFor()
    assert.equal(await navigated(), 0, 'No route through replacement credentials')
    assert.deepEqual(await fields(view.page), ['Pairing Bot', 'Assistant', ''], 'Text is kept')
    // The frozen request stays bound to the old pairing: no retry with the new token.
    await view.page
      .getByText(/was paired again, so Dovo will not resend the earlier request/)
      .waitFor()
    assert.equal(
      await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).isDisabled(),
      true,
    )
    for (const label of ['Bot name', 'Role', 'Responsibilities'])
      assert.equal(await view.page.getByLabel(label, { exact: true }).isDisabled(), true)
    // The frozen request is the original one: with the original pairing back, retry sends it.
    await view.page.evaluate(() => {
      window.callMode = 'ok'
      window.setHost('studio', (entry) => ({
        ...entry,
        profile: {
          ...entry.profile,
          connection: { ...entry.profile.connection, token: 'token-studio-0123456789abcdef' },
        },
      }))
    })
    await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.navigations?.length === 1)
    const [held, kept] = await creates(view.page)
    assert.deepEqual(kept.input, held.input, 'The held request survived the changed pairing')
    assert.equal(kept.token, held.token)

    // The same holds when the computer is removed before the reply.
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await view.page.getByLabel('Bot name', { exact: true }).fill('Removed Bot')
    await view.page.getByLabel('Role', { exact: true }).fill('Assistant')
    await view.page.evaluate(() => (window.callMode = 'hold'))
    await view.page.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.held.length === 2)
    const [, , removedRequest] = await creates(view.page)
    await view.page.evaluate(() => {
      window.hosts = window.hosts.filter((entry) => entry.profile.id !== 'studio')
      window.publish()
      window.held[1]()
    })
    await view.page
      .getByText(/The Bot was created, but its computer was paired again or removed/)
      .waitFor()
    assert.equal(await navigated(), 1, 'No route to a removed computer')
    assert.deepEqual(await fields(view.page), ['Removed Bot', 'Assistant', ''], 'Text is kept')
    await view.page
      .getByText(/was removed\. The earlier request may already have created/)
      .waitFor()
    // The request stays frozen: the fields lock and only the discard confirmation can release it.
    for (const label of ['Bot name', 'Role', 'Responsibilities'])
      assert.equal(await view.page.getByLabel(label, { exact: true }).isDisabled(), true)
    assert.equal(
      await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).isDisabled(),
      true,
    )
    assert.equal(removedRequest.runtimeId, 'studio')
    assert.deepEqual(view.errors, [])
    await view.page.close()
  }

  // A success that arrives after the sheet closed cannot check the current pairing. The request
  // stays frozen, and the next retry replays the same request ID on the same pairing.
  {
    const view = await open()
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await view.page.getByLabel('Bot name', { exact: true }).fill('Closed Bot')
    await view.page.getByLabel('Role', { exact: true }).fill('Assistant')
    await view.page.evaluate(() => (window.callMode = 'hold'))
    await view.page.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.held.length === 1)
    await view.page.evaluate(() => window.showScreen(false))
    await view.page.locator('[data-modal]').waitFor({ state: 'detached' })
    await view.page.evaluate(() => window.held[0]())
    await view.page.waitForTimeout(100)
    await view.page.evaluate(() => {
      window.callMode = 'ok'
      window.showScreen(true)
    })
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    assert.deepEqual(await fields(view.page), ['Closed Bot', 'Assistant', ''])
    await view.page
      .getByText('Retry sends the original request to Mac Studio. This prevents a duplicate Bot.', {
        exact: true,
      })
      .waitFor()
    await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.navigations?.length === 1)
    const [original, replay] = await creates(view.page)
    assert.deepEqual(replay.input, original.input, 'Replay uses the same request')
    assert.equal(replay.token, original.token)
    assert.deepEqual(view.errors, [])
    await view.page.close()
  }

  // An old reply on the same computer and pairing cannot close or route a newer request.
  {
    const view = await open()
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await view.page.getByLabel('Bot name', { exact: true }).fill('Old Bot')
    await view.page.getByLabel('Role', { exact: true }).fill('Assistant')
    await view.page.evaluate(() => (window.callMode = 'hold'))
    await view.page.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.held.length === 1)
    await view.page.evaluate(() => window.showScreen(false))
    await view.page.locator('[data-modal]').waitFor({ state: 'detached' })
    await view.page.evaluate(() => {
      window.setHost('studio', (entry) => ({ ...entry, connected: false }))
      window.showScreen(true)
    })
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await view.page.getByRole('button', { name: 'Discard earlier request', exact: true }).click()
    await view.page
      .getByRole('button', { name: 'Discard and allow a new request', exact: true })
      .click()
    await view.page.evaluate(() =>
      window.setHost('studio', (entry) => ({ ...entry, connected: true })),
    )
    await view.page.getByLabel('Bot name', { exact: true }).fill('New Bot')
    await view.page.getByRole('button', { name: 'Create Bot', exact: true }).click()
    await view.page.waitForFunction(() => window.held.length === 2)
    const [older, newer] = await creates(view.page)
    assert.equal(newer.token, older.token, 'Same pairing')
    assert.notEqual(newer.input.requestId, older.input.requestId)
    // An old rejection must not release the newer frozen request.
    await view.page.evaluate(() => window.held[0]('reject'))
    await view.page.waitForTimeout(100)
    await view.page.evaluate(() => window.held[1]('fail'))
    await view.page.getByText('Temporary runtime outage', { exact: true }).waitFor()
    await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).waitFor()
    assert.equal(await view.page.evaluate(() => (window.navigations ?? []).length), 0)
    assert.deepEqual(await fields(view.page), ['New Bot', 'Assistant', ''])
    await view.page.evaluate(() => (window.callMode = 'ok'))
    await view.page.getByRole('button', { name: 'Retry Create Bot', exact: true }).click()
    const [, , retried] = await creates(view.page)
    assert.deepEqual(retried.input, newer.input, 'Retry keeps the newer request')
    await view.page.waitForFunction(() => window.navigations?.length === 1)
    assert.deepEqual(await view.page.evaluate(() => window.navigations[0]), [
      'tasks',
      newer.input.createTask.id,
      'studio',
    ])
    assert.deepEqual(view.errors, [])
    await view.page.close()
  }

  // Dark appearance and large Dynamic Type keep the layout inside the screen.
  for (const [mode, fontScale, path] of [
    ['dark', 1, '/tmp/dovo-bot-create-mobile-dark.png'],
    ['light', 2, '/tmp/dovo-bot-create-mobile-large-text.png'],
  ]) {
    const view = await open({ mode, fontScale })
    await view.page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await view.page.getByLabel('Bot name', { exact: true }).fill('Release assistant')
    await view.page.getByLabel('Role', { exact: true }).fill('Keep releases ready to ship')
    await view.page.getByTestId('Runs on').click()
    await noOverflow(view.page, `${mode} ${fontScale}x`)
    await targetSizes(view.page)
    await view.page.screenshot({ path })
    assert.deepEqual(view.errors, [])
    await view.page.close()
  }
  console.log(
    'Mobile Bot creation: real create sheet across computers, explicit picker, kept text, frozen retry body and pairing, replacement pairing, late replies, rejection, routing and layout pass.',
  )
} finally {
  await createBrowser.close()
}
