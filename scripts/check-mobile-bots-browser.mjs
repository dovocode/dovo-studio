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
import {CreateBot} from './apps/mobile/src/bots/bot-create';
import {BotMemory} from './apps/mobile/src/bots/bot-memory';
import {BotSettings} from './apps/mobile/src/bots/bot-settings';
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
function App(){useSyncExternalStore(window.subscribe,()=>window.version);const [mode,setMode]=useState('editor');window.showMode=value=>{setMode(value);setShow(true)};const [show,setShow]=useState(true);const [owner,setOwner]=useState('owner-a');const [offline,setOffline]=useState(false);window.disableFields=()=>setOffline(true);window.openEditor=next=>{setOwner(next);setOffline(false);setShow(true)};return !show?null:mode==='create'?<CreateBot onClose={()=>setShow(false)} onCreated={id=>{window.created=id;setShow(false)}}/>:mode==='list'?<BotsScreen/>:mode==='memory'?<BotMemory taskId='bot-a' onClose={()=>setShow(false)}/>:mode==='settings'?<BotSettings task={window.botTask} onClose={()=>setShow(false)}/>:show?<BotEditor draftKey={owner} initial={initial} unavailable={offline?'Computer is offline':undefined} onClose={()=>setShow(false)} onSave={async value=>{if(window.rejectSave)throw Error('Runtime unavailable');window.saved.push({owner,value})}}/>:null}
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
      path: '../runtime/connection/creation-target',
      importer: mobile + 'bots/',
      contents: 'export const CreationTarget=()=>null;',
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
      path: '../ui/controls/choice',
      importer: mobile + 'bots/',
      contents:
        'export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;',
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
  await page.evaluate(() => window.showMode('create'))
  assert.equal(await page.getByLabel('Project', { exact: true }).count(), 0)
  await page.getByLabel('Bot name', { exact: true }).fill('Release Bot')
  await page.getByLabel('Role', { exact: true }).fill('Release lead')
  await page.getByLabel('Responsibilities', { exact: true }).fill('Check releases')
  await page.evaluate(() => {
    window.failCreate = true
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByText('Temporary runtime outage', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    window.showMode('create')
    window.failCreate = false
    window.runtime.snapshot.defaults = { execution: 'worktree' }
  })
  assert.equal(await page.getByLabel('Bot name', { exact: true }).inputValue(), 'Release Bot')
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const creates = await page.evaluate(() =>
    window.requests.filter((request) => request.path === '/api/bots/create'),
  )
  assert.equal(creates.length, 2)
  assert.deepEqual(creates[0].input, creates[1].input)
  assert.equal(creates[0].owner, 'paired-owner')
  assert.equal(creates[0].input.createTask.repositoryId, 'dovo:scratch')
  assert.equal(creates[0].input.createTask.execution, 'main')
  assert.equal(creates[0].input.createTask.setupCommand, undefined)
  assert.equal(creates[0].input.createTask.bot, undefined)
  await page.evaluate(() => {
    window.runtime.snapshot.workspace.repositories = []
    window.showMode('create')
  })
  await page.getByLabel('Bot name', { exact: true }).fill('Waiting Bot')
  await page.getByLabel('Role', { exact: true }).fill('Assistant')
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page
    .getByText('This computer cannot safely start a Bot. Refresh its runtime and try again.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((item) => item.path === '/api/bots/create').length,
    ),
    2,
  )
  await page.evaluate(() => {
    window.runtime.snapshot.workspace.repositories = [
      { id: 'dovo:scratch', name: 'No Project', path: '/scratch', kind: 'scratch', branch: 'main' },
    ]
    window.showMode('create')
  })
  assert.equal(await page.getByLabel('Project', { exact: true }).count(), 0)
  const beforeFirstRun = await page.evaluate(() => window.requests.length)
  await page.getByLabel('Bot name', { exact: true }).fill('First Bot')
  await page.getByLabel('Role', { exact: true }).fill('Assistant')
  assert.equal(await page.evaluate(() => window.requests.length), beforeFirstRun)
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(
      () =>
        window.requests.filter((request) => request.path === '/api/bots/create').at(-1).input
          .createTask.repositoryId,
    ),
    'dovo:scratch',
  )
  await page.evaluate(() => {
    window.runtime.snapshot.botsSupported = false
    window.showMode('create')
  })
  await page.getByText('Update this runtime to create Bots.', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
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
        nodes: [{ data: { botId: 'bot-a' } }],
      },
    ]
    window.publish()
  })
  await page.getByRole('button', { name: 'Release check', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.route), {
    pathname: '/settings/automations/[runtimeId]/[automationId]',
    params: { runtimeId: 'paired-owner', automationId: 'release-check' },
  })
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).waitFor()
  await page.getByLabel('Role', { exact: true }).fill('Senior reviewer')
  await page.getByRole('button', { name: 'Bot MCP servers and skills', exact: true }).click()
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
    .getByRole('dialog', { name: 'Bot MCP servers and skills', exact: true })
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
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Bots: real create/settings/memory components, stable retry body, owner scope, pause/resume, private notes, conflict drafts and old runtime gates pass.',
  )
} finally {
  await browser.close()
}
