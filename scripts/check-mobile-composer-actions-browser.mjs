import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real composer and queue; native controls and the conversation/runtime boundary are adapters.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const controls = `
import {useImperativeHandle} from 'react';
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
export const View=({children,style,testID,accessibilityRole,accessibilityLabel})=><div role={accessibilityRole} aria-label={accessibilityLabel} data-testid={testID} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const ScrollView=View;
export const Text=({children,style})=><span style={flat(style)}>{children}</span>;
export const TextInput=({value,onChangeText,accessibilityLabel})=><textarea aria-label={accessibilityLabel} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState,testID,accessibilityRole})=><button role={accessibilityRole} aria-selected={accessibilityState?.selected} aria-expanded={accessibilityState?.expanded} data-testid={testID} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:'flex',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ActivityIndicator=()=>null;
export const Alert={alert:(...args)=>window.alerts.push(args)};
export const Keyboard={dismiss(){}};export const Linking={openSettings:async()=>{}};
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress} style={{width:44,height:44,padding:0,flexShrink:0}}/>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Glass=View;
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>;
export const Sheet=({title,children,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:callback=>{onClose();queueMicrotask(()=>callback?.())}}));return <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>};
export const useTheme=()=>({colors:{surface:'#202020',border:'#404040',muted:'#999',text:'#eee',accent:'#76a1ff'},styles:{content:{},muted:{color:'#999'}}});
`
const stubs = [
  { path: 'react-native', contents: controls },
  ...[
    '../../../ui/content/text',
    '../../../ui/controls/icon',
    '../../../ui/theme',
    '../../ui/content/text',
    '../../ui/controls/icon',
    '../../ui/controls/icon-button',
    '../../ui/controls/action',
    '../../ui/controls/choice',
    '../../ui/controls/field',
    '../../ui/layout/glass',
    '../../ui/layout/sheet',
    '../../ui/theme',
    '../ui/theme',
    '../ui/content/text',
    '../ui/controls/action',
    '../ui/controls/field',
    '../ui/controls/icon',
  ].map((path) => ({ path, importer: mobile, contents: controls })),
  {
    path: '../../runtime/state/application-state',
    importer: mobile,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../conversation/state/provider',
    importer: mobile,
    contents: 'export const useTaskConversation=()=>window.conversation;',
  },
  {
    path: '../../runtime/connection/provider',
    importer: mobile,
    contents: 'export const useRuntime=()=>window.runtime;',
  },
  {
    path: '../../shell/navigation',
    importer: mobile,
    contents:
      'export const useNavigation=()=>({navigate:(...args)=>window.navigations.push(args)});',
  },
  {
    path: '../../runtime/preferences/app-preferences',
    importer: mobile,
    contents: 'export const useCarMode=()=>false;',
  },
  { path: './harness-icon', importer: mobile, contents: 'export const HarnessIcon=()=>null;' },
  {
    path: '../../agents/use-model-catalog',
    importer: mobile,
    contents:
      'export const useCachedModelCatalog=()=>({modelName:"Model"});export const useModelCatalog=()=>({modelName:"GPT",catalog:{models:[{id:"large-model",name:"Large model"},{id:"fast-model",name:"Fast model"}],reasoning:[{id:"high",name:"High"},{id:"low",name:"Low"}]}});',
  },
  {
    path: 'react-native-safe-area-context',
    contents: 'export const useSafeAreaInsets=()=>({bottom:0});',
  },
  { path: 'expo-crypto', contents: 'let id=0;export const randomUUID=()=> "fork-"+(++id);' },
  {
    path: './file-drop-target',
    importer: mobile,
    contents: `export {View as FileDropTarget} from 'react-native';`,
  },
  {
    path: './composer-field',
    importer: mobile,
    contents:
      'export const ComposerField=({value,onChangeText,onFocus,onBlur,editable})=><textarea aria-label="Message" value={value} disabled={!editable} onFocus={onFocus} onBlur={onBlur} onChange={event=>onChangeText(event.target.value)}/>;',
  },
  ...[
    ['../creation/checkout-choice', 'CheckoutChoice'],
    ['../creation/task-machine-selector', 'TaskMachineSelector'],
    ['../creation/worktree-base-picker', 'WorktreeBasePicker'],
    ['../conversation/components/message-attachments', 'MessageAttachments'],
    ['../conversation/components/file-mentions', 'FileMentions'],
    ['../detail/harness-settings', 'HarnessSettings'],
    ['./car-composer', 'CarComposer'],
  ].map(([path, name]) => ({ path, importer: mobile, contents: `export const ${name}=()=>null;` })),
]
stubs.push({
  ...stubs.find((stub) => stub.path === '../../agents/use-model-catalog'),
  path: './use-model-catalog',
})
stubs.push({
  ...stubs.find((stub) => stub.path === '../../runtime/connection/provider'),
  path: '../runtime/connection/provider',
})
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {defaultTaskHarness} from '@dovo/protocol';
import {Composer} from './src/tasks/composer/composer';import {ComposerActivity} from './src/tasks/composer/composer-activity';
window.calls=[];window.navigations=[];window.alerts=[];window.sideCount=0;
function App(){
  const [task,setTask]=useState({id:'task',title:'Review',repositoryId:'repo',harness:defaultTaskHarness('codex'),status:'running',messages:[{id:'first',role:'user',text:'Review'}],turns:[],queue:[{id:'queued',role:'user',text:'Check the tests'}],contextUsage:{used:190000,limit:200000},files:[],draftAttachments:[]});
  const [inputs,setInputs]=useState({questions:[],approvals:[]});window.setInputs=setInputs;
  const [turnSettings,setTurnSettings]=useState(null);window.turnSettings=turnSettings;const [text,setText]=useState('Continue the review');const [connected,setConnected]=useState(true);
  window.currentTask=task;window.setTask=update=>setTask(task=>({...task,...update}));window.setConnected=setConnected;
  const snapshot={queuedTurnSettingsSupported:true,autoProjectSelectionEnabled:true,...inputs,workspace:{repositories:[{id:'repo',name:'Project',path:'/repo',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/private',branch:''}],agents:[]}};
  const draft={text,ready:true,key:'draft',revision:text,update:setText};
  window.runtime={connected,snapshot,activeId:'runtime',call:async(path,input)=>{window.calls.push({path,input});if(path==='/api/tasks/checklist/clear'){if(window.failClear)throw Error('Clear failed');if(JSON.stringify(window.currentTask.nativeTodos)!==JSON.stringify(input.expectedItems))throw Error('The checklist changed');const finish=()=>{window.setTask({nativeTodos:undefined});return {ok:true}};return window.holdClear?new Promise(resolve=>{window.finishClear=()=>resolve(finish())}):finish()};if(window.failSideSave)throw Error('Side save failed');if(path==='/api/tasks/side-chat/save')return {id:'side-'+(++window.sideCount)};return {answer:'Answer'}},callEffect:(path,input)=>Effect.sync(()=>{window.calls.push({path,input});return path==='/api/tasks/start-fork'?{id:'fork'}:{ok:true}})};
  window.conversation={send:mode=>window.calls.push({mode:mode??'queue'}),stop:()=>window.calls.push({mode:'stop'}),actions:{turnSettings,setTurnSettings,agent:{...defaultTaskHarness('codex'),id:'agent',name:'Agent'},connected,snapshot,draft,dictation:{active:false},busy:false,stopping:false,error:'',attaching:false,setAttaching(){},attachmentPicker:{pick(){},upload(){}},firstMessage:false,checkoutEditable:task.status==='draft',hasInput:!!text,canSend:connected&&!!text,patch:async changes=>{window.calls.push({patch:changes});setTask(old=>({...old,...Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,value.after]))}))},threadScope:'runtime:task',pendingMessages:[]}};
  return <Composer task={task} renderAbove={setup=> <>{setup}<div>Conversation</div></>} queuedMessages={<ComposerActivity task={task}/>} onAsk={chatId=>window.calls.push({mode:'aside',chatId})}/>;
}createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: mobile + 'node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [mobile + 'node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  stubs,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'queue' })
  assert.equal(
    await page.getByRole('button', { name: 'More message actions', exact: true }).count(),
    0,
  )
  const inlineActions = []
  for (const name of ['Queue follow-up', 'Steer agent', 'Fork', 'Stop']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44)
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320)
    inlineActions.push(bounds)
  }
  assert.ok(inlineActions.every((bounds) => bounds.y === inlineActions[0].y))
  const compact = await page
    .getByRole('button', { name: 'Compact context', exact: true })
    .boundingBox()
  const queue = await page.getByRole('button', { name: /1 queued messages/ }).boundingBox()
  const input = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox()
  assert.ok(compact.y + compact.height <= queue.y && queue.y + queue.height <= input.y)
  await page.getByRole('button', { name: 'Steer agent', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'steer' })
  assert.equal(await page.getByRole('dialog', { name: 'Message actions' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Agent & model', exact: true }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: 'Next turn model and reasoning', exact: true }).count(),
    0,
  )
  const activeHarness = await page.evaluate(() => window.currentTask.harness)
  await page.getByRole('button', { name: 'Agent & model', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Agents', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Large model', exact: true }).click()
  await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption('high')
  assert.deepEqual(await page.evaluate(() => window.turnSettings), {
    provider: 'codex',
    model: 'large-model',
    reasoning: 'high',
  })
  assert.deepEqual(await page.evaluate(() => window.currentTask.harness), activeHarness)
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.path === '/api/workspace')),
    false,
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Steer agent', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Agent & model', exact: true }).click()
  await page.getByRole('button', { name: 'Use thread defaults', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.navigations.length === 1)
  assert.deepEqual(await page.evaluate(() => window.navigations[0]), ['tasks', 'fork', 'runtime'])
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: /1 queued messages/ }).click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .fill('Verify before shipping')
  await page.getByRole('combobox', { name: 'Turn model', exact: true }).selectOption('fast-model')
  await page
    .getByRole('combobox', { name: 'Turn reasoning level', exact: true })
    .selectOption('low')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'edit')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.expectedText), 'Check the tests')
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1).input.turnSettings), {
    provider: 'codex',
    model: 'fast-model',
    reasoning: 'low',
  })
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.expectedTurnSettings), null)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Explain this checkout')
  await page.getByRole('button', { name: 'Ask a side question', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.path === '/api/tasks/side-chat/ask'),
  )
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/tasks/side-chat/ask').input,
    ),
    { id: 'task', chatId: 'side-1', question: 'Explain this checkout' },
  )
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '')
  assert.deepEqual(await page.evaluate(() => window.calls.find((call) => call.mode === 'aside')), {
    mode: 'aside',
    chatId: 'side-1',
  })
  // The side-chat icon sends immediately for both running and idle threads.
  await page.evaluate(() => window.setTask({ status: 'review' }))
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('From the icon')
  await page.getByRole('button', { name: 'Ask a side question', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.path === '/api/tasks/side-chat/ask').length === 2,
  )
  await page.evaluate(() => {
    window.failSideSave = true
  })
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep on failure')
  await page.getByRole('button', { name: 'Ask a side question', exact: true }).click()
  await page.waitForFunction(() => window.alerts.some((alert) => alert[1] === 'Side save failed'))
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep on failure',
  )
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Offline draft')
  await page.evaluate(() => {
    window.setTask({ status: 'running' })
    window.setConnected(false)
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Queue follow-up"]')?.disabled,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Queue follow-up', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Steer agent', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await page.getByRole('button', { name: 'Fork', exact: true }).isDisabled(), true)
  assert.equal(
    await page.getByRole('button', { name: 'Ask a side question', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.setTask({ repositoryId: undefined }))
  assert.equal(await page.getByRole('button', { name: 'Fork', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.setConnected(true)
    window.setTask({ repositoryId: 'scratch', status: 'draft', messages: [], linkedCheckouts: [] })
  })
  await page.getByRole('button', { name: 'Link projects', exact: true }).click()
  const links = page.getByRole('dialog', { name: 'Linked projects', exact: true })
  await links.getByRole('button', { name: 'Add checkout', exact: true }).click()
  await links.getByRole('combobox', { name: 'Checkout', exact: true }).selectOption('main')
  await links.getByRole('combobox', { name: 'Access', exact: true }).selectOption('edit')
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.patch).at(-1).patch.linkedCheckouts.after[0].access,
    ),
    'edit',
  )
  await links.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Link projects (1)', exact: true }).waitFor()
  await page.evaluate(() => window.setConnected(false))
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent === 'Link projects (1)' && b.disabled,
    ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Link projects (1)', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.setConnected(true)
    window.setTask({ autoProject: true, autoProjectExecution: undefined })
  })
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true })
  const defaults = page.getByRole('button', { name: 'Project defaults', exact: true })
  assert.equal(await defaults.count(), 0)
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false')
  await advanced.click()
  await defaults.waitFor()
  await page.getByRole('button', { name: 'New worktrees', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.patch).at(-1).patch.autoProjectExecution.after,
    ),
    'worktree',
  )
  await advanced.click()
  assert.equal(await defaults.count(), 0)
  await advanced.click()
  await page.evaluate(() => window.setTask({ repositoryId: 'repo', autoProject: false }))
  assert.equal(
    await page.getByRole('button', { name: 'Checkout & branch', exact: true }).count(),
    0,
  )
  await advanced.click()
  await page.getByRole('button', { name: 'Checkout & branch', exact: true }).waitFor()
  await advanced.click()
  assert.equal(
    await page.getByRole('button', { name: 'Checkout & branch', exact: true }).count(),
    0,
  )
  await page.evaluate(() =>
    window.setTask({
      status: 'running',
      messages: [{ id: 'first', role: 'user', text: 'Started' }],
      queue: [{ id: 'tabs', role: 'user', text: 'Queued follow-up' }],
      nativeTodos: [{ text: 'Native progress step', status: 'in-progress' }],
    }),
  )
  const queueTab = page.getByRole('tab', { name: 'Queue · 1', exact: true })
  const checklistTab = page.getByRole('tab', { name: /Checklist · 0\/1/ })
  await checklistTab.click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  assert.equal(await queueTab.getAttribute('aria-selected'), 'false')
  assert.equal(await page.getByTestId('Queued messages').isVisible(), false)
  const collapse = page.getByRole('button', { name: 'Collapse composer activity', exact: true })
  const expand = page.getByRole('button', { name: 'Expand composer activity', exact: true })
  await collapse.click()
  assert.equal(await page.getByText('Native progress step', { exact: true }).isVisible(), false)
  assert.equal(await expand.getAttribute('aria-expanded'), 'false')
  await checklistTab.click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  await queueTab.click()
  await page.getByTestId('Queued messages').waitFor()
  await page.getByTestId('Queued messages').click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .fill('Keep native queue edit')
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'foreign', taskId: 'other', prompt: {} }],
      approvals: [],
    }),
  )
  assert.equal(
    await page.getByRole('dialog', { name: 'Queued messages', exact: true }).isVisible(),
    true,
  )
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [],
    }),
  )
  await expand.waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  await expand.click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Edit queued message', exact: true }).inputValue(),
    'Keep native queue edit',
  )
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [],
    }),
  )
  assert.equal(
    await page.getByRole('dialog', { name: 'Queued messages', exact: true }).isVisible(),
    true,
  )
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [{ id: 'approval', taskId: 'task' }],
    }),
  )
  await expand.waitFor()
  await page.evaluate(() => window.setInputs({ questions: [], approvals: [] }))
  await expand.click()
  await page.evaluate(() => window.setTask({ queue: [] }))
  await page.getByRole('tab', { name: 'Queue · 0', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Edit queued message', exact: true }).inputValue(),
    'Keep native queue edit',
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 0)
  await collapse.click()
  assert.equal(await page.getByText('Native progress step', { exact: true }).isVisible(), false)
  await page.evaluate(() =>
    window.setTask({ nativeTodos: [{ text: 'Updated progress step', status: 'completed' }] }),
  )
  await expand.waitFor()
  await expand.click()
  await page.getByText('Updated progress step', { exact: true }).waitFor()
  const clear = page.getByRole('button', { name: 'Clear checklist', exact: true })
  const confirmClear = page.getByRole('button', { name: 'Confirm clear checklist', exact: true })
  const clearRequests = () =>
    page.evaluate(() =>
      window.calls.filter((request) => request.path === '/api/tasks/checklist/clear'),
    )
  await clear.click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await clearRequests()).length, 0)
  await page.evaluate(() => window.setConnected(false))
  await page.getByRole('button', { name: 'Clear checklist', exact: true, disabled: true }).waitFor()
  assert.equal(await clear.isDisabled(), true)
  await page.evaluate(() => {
    window.setConnected(true)
    window.failClear = true
  })
  await clear.click()
  await confirmClear.click()
  await page.getByText('Clear failed', { exact: true }).waitFor()
  assert.equal(await page.getByText('Updated progress step', { exact: true }).isVisible(), true)
  await page.evaluate(() => {
    window.failClear = false
  })
  await clear.click()
  await page.evaluate(() =>
    window.setTask({
      nativeTodos: [
        ...window.currentTask.nativeTodos,
        { text: 'Added during confirmation', status: 'pending' },
      ],
    }),
  )
  await confirmClear.click()
  await page.getByText('The checklist changed', { exact: true }).waitFor()
  await page.getByText('Added during confirmation', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.holdClear = true
  })
  await clear.click()
  await confirmClear.click()
  await page.getByRole('button', { name: 'Clearing…', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Clearing…', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.finishClear())
  await page.getByLabel('Composer activity', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() =>
    window.setTask({
      queue: [{ id: 'keep-queue', role: 'user', text: 'Preserve queued message' }],
      nativeTodos: [{ text: 'Clear this step', status: 'pending' }],
    }),
  )
  await page.getByRole('tab', { name: 'Queue · 1', exact: true }).click()
  await page.getByTestId('Queued messages').click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  const queueEdit = page.getByRole('textbox', { name: 'Edit queued message', exact: true })
  await queueEdit.fill('Keep edit after clearing checklist')
  await page.getByRole('tab', { name: /Checklist · 0\/1/ }).click()
  await clear.click()
  await confirmClear.click()
  await page.evaluate(() => window.finishClear())
  await queueEdit.waitFor()
  assert.equal(await queueEdit.inputValue(), 'Keep edit after clearing checklist')
  assert.equal(await page.getByRole('button', { name: 'Clear checklist', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() => window.currentTask.queue[0].text),
    'Preserve queued message',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile composer: compact/queue/input order, inline 44pt actions at 320px, steer and fork dispatch, queue editing, immediate side-chat sending, failure recovery and offline guards passed with native control adapters.',
  )
} finally {
  await browser.close()
}
