import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real composer and queue; native controls and the conversation/runtime boundary are adapters.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const controls = `
import {useImperativeHandle} from 'react';
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
export const View=({children,style,testID})=><div data-testid={testID} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const Text=({children,style})=><span style={flat(style)}>{children}</span>;
export const TextInput=({value,onChangeText,accessibilityLabel})=><textarea aria-label={accessibilityLabel} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState,testID})=><button aria-expanded={accessibilityState?.expanded} data-testid={testID} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:'flex',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ActivityIndicator=()=>null;
export const Alert={alert:(...args)=>window.alerts.push(args)};
export const Keyboard={dismiss(){}};export const Linking={openSettings:async()=>{}};
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress} style={{width:44,height:44,padding:0,flexShrink:0}}/>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Glass=View;
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>;
export const Sheet=({title,children,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:callback=>{onClose();queueMicrotask(()=>callback?.())}}));return <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>};
export const useTheme=()=>({colors:{surface:'#202020',border:'#404040',muted:'#999',text:'#eee',accent:'#76a1ff'},styles:{content:{},muted:{color:'#999'}}});
`
const stubs = [
  { path: 'react-native', contents: controls },
  ...[
    '../../ui/content/text',
    '../../ui/controls/icon',
    '../../ui/controls/icon-button',
    '../../ui/controls/action',
    '../../ui/controls/choice',
    '../../ui/controls/field',
    '../../ui/layout/glass',
    '../../ui/layout/sheet',
    '../../ui/theme',
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
  {
    path: '../../agents/use-model-catalog',
    importer: mobile,
    contents: 'export const useModelCatalog=()=>({modelName:"GPT",catalog:null});',
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
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {defaultTaskHarness} from '@dovo/protocol';
import {Composer} from './src/tasks/composer/composer';import {MessageQueue} from './src/tasks/composer/message-queue';
window.calls=[];window.navigations=[];window.alerts=[];window.sideCount=0;
function App(){
  const [task,setTask]=useState({id:'task',title:'Review',repositoryId:'repo',harness:defaultTaskHarness('codex'),status:'running',messages:[{id:'first',role:'user',text:'Review'}],turns:[],queue:[{id:'queued',role:'user',text:'Check the tests'}],contextUsage:{used:190000,limit:200000},files:[],draftAttachments:[]});
  const [text,setText]=useState('Continue the review');const [connected,setConnected]=useState(true);
  window.setTask=update=>setTask(task=>({...task,...update}));window.setConnected=setConnected;
  const snapshot={autoProjectSelectionEnabled:true,questions:[],workspace:{repositories:[{id:'repo',name:'Project',path:'/repo',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/private',branch:''}],agents:[]}};
  const draft={text,ready:true,key:'draft',revision:text,update:setText};
  window.runtime={connected,snapshot,activeId:'runtime',call:async(path,input)=>{window.calls.push({path,input});if(window.failSideSave)throw Error('Side save failed');if(path==='/api/tasks/side-chat/save')return {id:'side-'+(++window.sideCount)};return {answer:'Answer'}},callEffect:(path,input)=>Effect.sync(()=>{window.calls.push({path,input});return path==='/api/tasks/start-fork'?{id:'fork'}:{ok:true}})};
  window.conversation={send:mode=>window.calls.push({mode:mode??'queue'}),stop:()=>window.calls.push({mode:'stop'}),actions:{connected,snapshot,draft,dictation:{active:false},busy:false,stopping:false,error:'',attaching:false,setAttaching(){},attachmentPicker:{pick(){},upload(){}},firstMessage:false,checkoutEditable:task.status==='draft',hasInput:!!text,canSend:connected&&!!text,patch:async changes=>{window.calls.push({patch:changes});setTask(old=>({...old,...Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,value.after]))}))},threadScope:'runtime:task',pendingMessages:[]}};
  return <Composer task={task} renderAbove={setup=> <>{setup}<div>Conversation</div></>} queuedMessages={<MessageQueue task={task}/>} onAsk={chatId=>window.calls.push({mode:'aside',chatId})}/>;
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
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.navigations.length === 1)
  assert.deepEqual(await page.evaluate(() => window.navigations[0]), ['tasks', 'fork', 'runtime'])
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: /1 queued messages/ }).click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .fill('Verify before shipping')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'edit')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.expectedText), 'Check the tests')
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
  assert.deepEqual(errors, [])
  console.log(
    'Mobile composer: compact/queue/input order, inline 44pt actions at 320px, steer and fork dispatch, queue editing, immediate side-chat sending, failure recovery and offline guards passed with native control adapters.',
  )
} finally {
  await browser.close()
}
