import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const extension = fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url))
const mocks = {
  './harness-catalog': `export const useHarnessCatalog=()=>({modelName:'',catalog:{models:[],reasoning:[]}});`,
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {providers} from '../studio-core/src/providers';const Context=createContext(null);export const WorkspaceHarness=Context.Provider;export const useWorkspace=()=>useContext(Context);export const useStudioHost=()=>({navigate:()=>{}});export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});export const resolveTaskAgent=()=>({id:'agent',name:'Agent',provider:window.provider,model:'model',permission:'full-access',instructions:'',args:[],endpoint:''});const preferences={followUp:'queue',confirmStop:false};export const useAppPreferences=()=>preferences;export const readAppPreferences=()=>preferences;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export * as Popover from '@radix-ui/react-popover';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {permissionPolicyUIIssue} from '../studio-ui/src/permission-policy-fields';export {Queue,QueueSectionTrigger,QueueList,QueueItem,QueueItemIndicator,QueueItemContent} from '../studio-ui/src/components/ai-elements/queue.tsx';export {Dialog,DialogContent,DialogTitle,DialogDescription} from '../studio-ui/src/components/ui/dialog';export const cn=(...values)=>values.filter(Boolean).join(' ');export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=({label,children,...props})=><Button aria-label={label} {...props}>{children}</Button>;export {ComposerSurface,ComposerSubmit} from '../studio-ui/src/composer-surface';`,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:()=>{},remove:()=>{}});`,
  './composer-editor': `import {useSyncExternalStore} from 'react';export const ComposerEditor=({controller,submitBusy,submittedText,disabled})=>{const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <textarea aria-label="Message" value={submitBusy&&text.trim()===submittedText?'':text} readOnly={submitBusy} disabled={disabled} onChange={event=>controller.update(event.target.value)}/>};`,
  './composer-harness-controls': `export const ComposerHarnessControls=({renderControls})=>renderControls?.({model:null,access:null});`,
  './turn-model-controls': `export const TurnModelControls=({renderControls})=>renderControls?.({model:null,access:null})??null;`,
  './composer-workspace': `export const ComposerWorkspace=({children})=><div>{children}</div>;`,
}
for (const [path, name] of [
  ['./attachment-picker', 'AttachmentPicker'],
  ['./message-attachments', 'MessageAttachments'],
  ['./composer-command-dialog', 'ComposerCommandDialog'],
  ['../../dialogs/saved-prompts-dialog', 'SavedPromptsDialog'],
  ['../thread/context-meter', 'ContextMeter'],
])
  mocks[path] = `export const ${name}=()=>null;`
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {Composer} from './src/chat/composer/composer.tsx';import {ComposerActivity} from './src/chat/composer/composer-activity.tsx';
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'review',messages:[{id:'first',role:'user',text:'Hello'},{id:'reply',role:'assistant',text:'Hi'}],turns:[],queue:[],draft:'',files:[],example:false};
window.provider='codex';window.requests=[];window.fail=false;window.response=null;
const request=async(path,input)=>{window.requests.push({path,input});if(path==='/api/tasks/message'||path==='/api/tasks/steer')return new Promise((resolve,reject)=>{window.response=()=>{window.response=null;window.fail?reject(new Error('Network failure')):resolve({ok:true})}});return {ok:true}};
function App(){const[supported,setSupported]=useState(false);window.setSupported=setSupported;const[workspace,setWorkspace]=useState({tasks:[initial],repositories:[],agents:[],skills:[],mcpServers:[]});const onPending=useCallback(()=>{},[]);window.current=workspace.tasks[0];window.setTask=update=>setWorkspace(old=>({...old,tasks:[update(old.tasks[0])]}));const value={workspace,setWorkspace,request,connected:true,runtimes:[],activeRuntimeId:'runtime',connection:{address:'http://runtime',token:'token'},flush:async()=>{},snapshot:{workspace,questions:[],approvals:[],runs:[],queuedTurnSettingsSupported:true,persistentTurnModelsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,...(supported?{planModeSupported:true}:{})}};return <WorkspaceHarness value={value}><Composer task={workspace.tasks[0]} onPending={onPending} queuedMessages={<ComposerActivity task={workspace.tasks[0]} pending={[]}/>}/></WorkspaceHarness>};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: extension,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'plan-mode-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'plan-mode-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'plan-mode-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: extension,
          loader: 'tsx',
        }))
      },
    },
  ],
  alias: {
    '@dovo/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
  },
  nodePaths: [fileURLToPath(new URL('../packages/studio-ui/node_modules', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const root = fileURLToPath(new URL('../', import.meta.url))
const actions = root + 'apps/mobile/src/tasks/conversation/state/'
const mobileBuilt = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {useConversationActions} from './apps/mobile/src/tasks/conversation/state/use-actions';
window.provider='codex';window.supported=true;window.requests=[];window.patches=[];window.fail=false;window.finish=null;
window.request=(path,input)=>path==='/api/workspace'?Effect.sync(()=>{window.patches.push(input.changes);window.setTask(task=>({...task,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]))}));return {revision:1}}):Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.requests.push({path,input});window.finish=()=>{window.finish=null;if(window.fail)return reject(new Error('Send failed'));if(input.plan&&path==='/api/tasks/message')window.setTask(task=>({...task,draftPlan:undefined}));resolve({ok:true})}}),catch:error=>error});
function App(){const[task,setTask]=useState({id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'review',draft:'',messages:[{id:'previous',role:'user',text:'Earlier'}],turns:[],files:[],example:false});const actions=useConversationActions(task);window.task=task;window.setTask=setTask;window.actions=actions;return <><textarea aria-label="Message" value={actions.draft.text} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/>{actions.planSupported&&<button aria-pressed={actions.plan} onClick={()=>actions.setPlan(!actions.plan)}>Plan</button>}<button disabled={!actions.canSend} onClick={()=>actions.run(()=>actions.submit())}>Send</button><button onClick={()=>actions.run(()=>actions.submit('steer'))}>Steer</button><p role="status">{actions.error}</p></>}
createRoot(document.getElementById('app')).render(<App/>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: 'react-native',
      contents: 'export const Alert={alert(){}};export const Keyboard={dismiss(){}};',
    },
    {
      path: 'expo-crypto',
      contents:
        'let id=0;export const randomUUID=()=>"submission-"+(++id);export const CryptoDigestAlgorithm={SHA256:"SHA256"};export const digestStringAsync=async(_algorithm,text)=>text;',
    },
    {
      path: '../../../runtime/state/application-state',
      importer: actions,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../../runtime/connection/provider',
      importer: actions,
      contents: `export const useRuntime=()=>({connected:true,activeId:'computer',profile:{connection:{address:'http://computer.lan',token:'device-token'}},snapshot:{queueRestoreReceiptsSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,...(window.supported?{planModeSupported:true}:{}),workspace:{agents:[{id:'agent',name:'Agent',provider:window.provider,model:'model',permission:'full-access',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],attachmentUploads:()=>[],finishAttachmentEffect:()=>Effect.void,reviewAttachments:()=>{},call:()=>{},readEffect:window.request,callEffect:window.request});`,
    },
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: actions,
      contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
    },
    {
      path: '../../draft/use-draft',
      importer: actions,
      contents: `import {useState} from 'react';import {Effect} from 'effect';export const useDraft=()=>{const[text,setText]=useState('');return {key:'computer:task',text,ready:true,revision:text,update:setText,stageEffect:()=>Effect.void,confirmEffect:(_attempt,clear)=>Effect.sync(()=>{if(clear)setText('')})}};`,
    },
    {
      path: '../../composer/attachment-picker',
      importer: actions,
      contents: 'export const useAttachmentPicker=()=>({busy:false,pick(){},upload(){}});',
    },
    {
      path: '../../composer/use-composer-dictation',
      importer: actions,
      contents:
        'export const useComposerDictation=({draft})=>({active:false,update:draft.update,reset(){}});',
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Message' })
  const toggle = page.getByRole('button', { name: 'Plan', exact: true })
  await input.waitFor()
  // Older runtimes would drop the flag, so the control is hidden instead of sending it.
  assert.equal(await toggle.count(), 0)
  await page.evaluate(() => window.setSupported(true))
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => window.current.draftPlan), true)
  await input.fill('Add login')
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response)
  const sent = await page.evaluate(() => window.requests.at(-1))
  assert.equal(sent.path, '/api/tasks/message')
  assert.equal(sent.input.plan, true)
  // A failed send keeps both the draft and the one-message toggle for retry.
  await page.evaluate(() => {
    window.fail = true
    window.response()
  })
  await page.getByText('Network failure').waitFor()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(await input.inputValue(), 'Add login')
  await page.evaluate(() => (window.fail = false))
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response)
  const retry = await page.evaluate(() => window.requests.at(-1))
  assert.equal(retry.input.messageId, sent.input.messageId)
  assert.equal(retry.input.plan, true)
  await page.evaluate(() => window.response())
  await page.waitForFunction(
    () => document.querySelector('[aria-pressed]')?.getAttribute('aria-pressed') === 'false',
  )
  // The next message is a normal turn again.
  await input.fill('Implement it')
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.plan), undefined)
  await page.evaluate(() => window.response())
  // While a run is active, a plan message can only queue.
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, status: 'running', activeRunId: 'run' })),
  )
  await toggle.click()
  await input.fill('Plan the follow-up')
  await page.getByRole('button', { name: 'More message actions', exact: true }).click()
  assert.equal(
    await page.getByRole('menuitem', { name: /Steer agent/ }).getAttribute('data-disabled'),
    '',
  )
  await page.keyboard.press('Escape')
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response)
  assert.equal(await page.evaluate(() => window.requests.at(-1).path), '/api/tasks/message')
  await page.evaluate(() => window.response())
  // Publish the accepted queue identity before editing its stored plan flag.
  await page.evaluate(() => {
    const { input } = window.requests.at(-1)
    window.setTask((task) => ({
      ...task,
      queue: [
        { id: input.messageId, role: 'user', text: input.text, plan: input.plan, createdAt: '' },
      ],
    }))
  })
  await page.getByText('Plan', { exact: true }).first().waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Steer with queued message 1', exact: true })
      .isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
  await toggle.click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page
    .getByRole('button', { name: 'Cancel edit', exact: true })
    .waitFor({ state: 'detached' })
  const edit = await page.evaluate(() => window.requests.at(-1))
  assert.equal(edit.path, '/api/tasks/queue')
  assert.equal(edit.input.plan, false)
  assert.equal(edit.input.expectedPlan, true)
  // Harnesses without a read-only boundary cannot enable plan mode.
  await page.evaluate(() => {
    window.provider = 'hermes'
    window.setTask((task) => ({ ...task, status: 'review', queue: [], activeRunId: undefined }))
  })
  await page.waitForFunction(() => document.querySelector('[aria-pressed]')?.disabled === true)
  assert.match((await toggle.getAttribute('title')) ?? '', /no read-only mode/)
  const phone = await browser.newPage()
  phone.on('pageerror', (error) => errors.push(error.message))
  await phone.setContent('<div id="app"></div>')
  await phone.addScriptTag({ content: mobileBuilt.outputFiles[0].text })
  const message = phone.getByRole('textbox', { name: 'Message' })
  const plan = phone.getByRole('button', { name: 'Plan', exact: true })
  const send = phone.getByRole('button', { name: 'Send', exact: true })
  await plan.click()
  await phone.waitForFunction(() => window.task.draftPlan === true)
  assert.deepEqual(await phone.evaluate(() => window.patches.at(-1)), {
    draftPlan: { before: null, after: true },
  })
  await message.fill('Plan from phone')
  await phone.getByRole('button', { name: 'Steer', exact: true }).click()
  await phone.getByRole('status').filter({ hasText: 'Queue this message to plan' }).waitFor()
  assert.equal(await phone.evaluate(() => window.requests.length), 0)
  await phone.evaluate(() => (window.fail = true))
  await send.click()
  await phone.waitForFunction(() => window.finish)
  const first = await phone.evaluate(() => window.requests.at(-1))
  assert.equal(first.path, '/api/tasks/message')
  assert.equal(first.input.plan, true)
  assert.equal(await phone.evaluate(() => window.actions.pendingMessage.message.plan), true)
  await phone.evaluate(() => window.finish())
  await phone.getByRole('status').filter({ hasText: 'Send failed' }).waitFor()
  assert.equal(await plan.getAttribute('aria-pressed'), 'true')
  assert.equal(await message.inputValue(), 'Plan from phone')
  await phone.evaluate(() => (window.fail = false))
  await send.click()
  await phone.waitForFunction(() => window.finish)
  assert.equal(
    await phone.evaluate(() => window.requests.at(-1).input.messageId),
    first.input.messageId,
  )
  await phone.evaluate(() => window.finish())
  await phone.waitForFunction(() => !window.actions.busy && !window.actions.plan)
  await message.fill('Normal follow-up')
  await send.click()
  await phone.waitForFunction(() => window.finish)
  assert.equal(await phone.evaluate(() => window.requests.at(-1).input.plan), undefined)
  await phone.evaluate(() => window.finish())
  await phone.waitForFunction(() => !window.actions.busy)
  await phone.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: true,
      queue: [{ id: 'queued', role: 'user', text: 'Queued', createdAt: '' }],
    })),
  )
  await phone.waitForFunction(() => window.task.queue?.length === 1)
  await phone.evaluate(() => window.actions.beginEdit(window.task.queue[0]))
  await phone.waitForFunction(() => window.actions.editing?.text === 'Queued')
  await plan.click()
  await phone.waitForFunction(() => window.actions.editing?.plan === true)
  await send.click()
  await phone.waitForFunction(() => window.finish)
  const phoneEdit = await phone.evaluate(() => window.requests.at(-1))
  assert.equal(phoneEdit.path, '/api/tasks/queue')
  assert.deepEqual([phoneEdit.input.plan, phoneEdit.input.expectedPlan], [true, false])
  await phone.evaluate(() => window.finish())
  await phone.waitForFunction(() => !window.actions.editing)
  // Editing only changes the queued message; the composer toggle stays off.
  assert.equal(await phone.evaluate(() => window.actions.plan), false)
  assert.equal(await plan.getAttribute('aria-pressed'), 'false')
  await phone.evaluate(() => {
    window.provider = 'grok'
    window.setTask((task) => ({ ...task, queue: [], draftPlan: true }))
  })
  await message.fill('Plan with grok')
  await phone.getByRole('status').filter({ hasText: 'no read-only mode' }).waitFor()
  assert.equal(await send.isDisabled(), true)
  await phone.evaluate(() => {
    window.provider = 'codex'
    window.supported = false
    window.setTask((task) => ({ ...task }))
  })
  await phone.getByRole('status').filter({ hasText: 'Update the task computer' }).waitFor()
  assert.equal(await plan.count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/mobile plan mode: capability gating, persisted toggle, plan sends and stable retries, one-message reset, steer refusal, queue edits and unsupported harnesses passed.',
  )
} finally {
  await browser.close()
}
