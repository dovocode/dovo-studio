import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { chromium } from './browser/harness.mjs'
const assets = fileURLToPath(new URL('../apps/desktop/dist/assets/', import.meta.url))
const catalogMock = `export const useHarnessCatalog=()=>({modelName:'',catalog:{models:[{id:'fast-model',name:'Fast model'},{id:'large-model',name:'Large model',serviceTiers:[{id:'priority',name:'Fast'}]}],reasoning:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});`
const mocks = {
  './harness-catalog': catalogMock,
  './use-harness-availability': `export const useHarnessAvailability=()=>({available:new Set(['harness:codex']),loading:false,refresh:()=>{}});`,
  './agent-avatar': `export const AgentAvatar=()=>null;`,
  './harness-icon': `export const HarnessIcon=()=>null;`,
  '@dovo/studio-core': `export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {providers} from '../studio-core/src/providers';const Context=createContext(null);export const WorkspaceHarness=Context.Provider;export const useWorkspace=()=>useContext(Context);export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});export const resolveTaskAgent=()=>({id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''});export const useResolvedTheme=()=> 'dark'; export {studioSyntaxTheme} from '../studio-core/src/themes'; const preferences={showPlanButton:true,showSendOptions:true,followUp:'queue',confirmStop:false};window.setComposerPreferences=value=>Object.assign(preferences,value);export const useAppPreferences=()=>preferences;export const readAppPreferences=()=>preferences;export const updateAppPreferences=value=>Object.assign(preferences,value);export const useWorkspaceSelector=select=>select(useContext(Context));export const sameWorkspaceFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '../studio-ui/src/components/ui/dialog';export {SearchField} from '../studio-ui/src/search-field';export {ComposerSettingsControls} from '../studio-ui/src/composer-settings-controls';export * as Popover from '@radix-ui/react-popover';export {ChoicePicker} from '../studio-ui/src/choice-picker';export const useHarnessCatalog=()=>({catalog:{models:[{id:'fast-model',name:'Fast model'},{id:'large-model',name:'Large model'}],reasoning:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {permissionPolicyUIIssue} from '../studio-ui/src/permission-policy-fields';export {Queue,QueueSectionTrigger,QueueList,QueueItem,QueueItemIndicator,QueueItemContent} from '../studio-ui/src/components/ai-elements/queue.tsx';import React from 'react';export const cn=(...values)=>values.filter(Boolean).join(' ');import {Button} from '../studio-ui/src/components/ui/button';export {Button};export const IconButton=({label,children,...props})=><Button aria-label={label} {...props}>{children}</Button>;export {ComposerSurface,ComposerSubmit} from '../studio-ui/src/composer-surface';`,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:files=>{window.dropped.push(files.map(file=>({name:file.name,size:file.size})))},remove:()=>{}});`,
  './composer-editor': `import {useSyncExternalStore} from 'react';export const ComposerEditor=({controller,onCommand})=>{const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <><textarea aria-label="Message" value={text} onChange={event=>controller.update(event.target.value)}/><button type="button" onClick={()=>onCommand('undo')}>Open undo</button></>};`,
}
for (const [path, name] of [
  ['../../dialogs/harness-dialog', 'HarnessDialog'],
  ['./attachment-picker', 'AttachmentPicker'],
  ['./message-attachments', 'MessageAttachments'],
  ['../../dialogs/saved-prompts-dialog', 'SavedPromptsDialog'],
  ['../thread/context-meter', 'ContextMeter'],
  ['./composer-harness-controls', 'ComposerHarnessControls'],
  ['./composer-workspace', 'ComposerWorkspace'],
])
  mocks[path] = `export const ${name}=()=>null;`
mocks['./composer-harness-controls'] =
  `export const ComposerHarnessControls=({renderControls})=>renderControls?.({model:null,access:null});`
mocks['./composer-workspace'] =
  `export const ComposerWorkspace=({children})=><div>{children}</div>;`
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {Composer} from './src/chat/composer/composer.tsx';
const profiles=['local','remote'].map(id=>({id,name:id,connection:{address:'http://'+id,token:'token-'+id}}));
const turn=id=>({id,status:'completed',checkpoint:{before:'before',after:'after',files:[{path:'src/task.ts',before:'old',after:'new',viewed:false}],omitted:[]}});
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'draft',messages:[],turns:[turn('older'),turn('last')],queue:[{id:'queued',text:'Keep this queue',role:'user'}],draft:'Keep this draft',files:[],example:false};
window.requests=[];window.refreshes=[];window.flushes=0;window.failUndo=true;window.failRefresh=false;window.refreshMode='same';window.holdRefresh=false;
const request=async(path,input)=>{window.requests.push({path,input});if(path==='/api/tasks/turn/restore'&&window.failUndo)throw Error('The checkout changed. Refresh before trying again.');return {ok:true}};
function App(){
 const [runtime,setRuntime]=useState(0);const [connected,setConnected]=useState(true);const [workspace,setWorkspace]=useState({tasks:[initial],repositories:[],agents:[],skills:[],mcpServers:[]});
 window.setRuntime=setRuntime;window.setConnected=setConnected;window.setTask=update=>setWorkspace(old=>({...old,tasks:[update(old.tasks[0])]}));window.current=workspace.tasks[0];
 const refreshRuntime=async profile=>{window.refreshes.push(profile.id);if(window.holdRefresh)await new Promise(resolve=>{window.finishRefresh=resolve});if(window.failRefresh)throw Error('Refresh failed');if(window.refreshMode==='older')window.setTask(task=>({...task,turns:[task.turns[0],{...task.turns[1],checkpoint:{...task.turns[1].checkpoint,undone:{backup:'saved'}}}]}));if(window.refreshMode==='running')window.setTask(task=>({...task,status:'running'}));};
 const value={workspace,setWorkspace,request,connected,runtimes:[],runtimeRegistry:{profiles,activeId:profiles[runtime].id},activeRuntimeId:profiles[runtime].id,connection:profiles[runtime].connection,refreshRuntime,flush:async()=>{window.flushes++},snapshot:{workspace,questions:[],approvals:[],runs:[]}};
 return <WorkspaceHarness value={value}><Composer task={workspace.tasks[0]} onPending={()=>{}}/></WorkspaceHarness>
}createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'command-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'command-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'command-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
          loader: 'tsx',
        }))
      },
    },
  ],
  nodePaths: [fileURLToPath(new URL('../packages/studio-ui/node_modules', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addStyleTag({
    content: readdirSync(assets)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(assets + file, 'utf8'))
      .join('\n'),
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const undo = page.getByRole('button', { name: 'Undo changes', exact: true })
  const refresh = page.getByRole('button', { name: 'Refresh thread', exact: true })
  const open = async () => {
    await page.getByRole('button', { name: 'Open undo', exact: true }).click()
    await page.getByRole('dialog').waitFor()
  }
  const fail = async () => {
    await undo.click()
    await refresh.waitFor()
    assert.equal(await undo.isDisabled(), true)
    assert.equal(await refresh.getAttribute('data-variant'), 'default')
    assert.equal(await undo.getAttribute('data-variant'), 'outline')
    await page.waitForFunction(() => document.activeElement?.textContent === 'Refresh thread')
  }
  await page.getByRole('textbox', { name: 'Message' }).fill('Typed just before undo')
  await open()
  await fail()
  assert.deepEqual(await page.evaluate(() => window.requests[0].input), {
    id: 'task',
    turnId: 'last',
    direction: 'undo',
  })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await open()
  assert.equal(await undo.isDisabled(), true, 'Reopening bypassed required refresh')
  await page.evaluate(() => {
    window.failRefresh = true
  })
  await refresh.click()
  await page.getByRole('alert').filter({ hasText: 'Refresh failed' }).waitFor()
  assert.equal(await undo.isDisabled(), true, 'Failed refresh enabled stale undo')
  await page.evaluate(() => window.setConnected(false))
  await page.getByRole('status').filter({ hasText: 'Connect to this thread' }).waitFor()
  assert.equal(await refresh.isDisabled(), true)
  await page.evaluate(() => {
    window.setConnected(true)
    window.failRefresh = false
    window.holdRefresh = true
  })
  await refresh.click()
  await page.getByRole('button', { name: 'Refreshing…', exact: true }).waitFor()
  assert.equal(await undo.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 1, 'Busy refresh dialog closed')
  await page.evaluate(() => window.finishRefresh())
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Undo changes',
      )?.disabled,
  )
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['local', 'local'])
  assert.equal(
    await page.evaluate(() => window.requests.length),
    1,
    'Refresh automatically retried undo',
  )
  assert.equal(await page.evaluate(() => window.current.draft), 'Typed just before undo')
  assert.equal(await page.evaluate(() => window.current.queue[0].text), 'Keep this queue')
  await page.evaluate(() => {
    window.failUndo = false
    window.holdRefresh = false
  })
  await undo.click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.requests.length), 2)
  assert.deepEqual(await page.evaluate(() => window.requests[1].input), {
    id: 'task',
    turnId: 'last',
    direction: 'undo',
  })
  // If refresh reveals the turn was already undone, never fall back to an older turn.
  await page.evaluate(() => {
    window.failUndo = true
    window.refreshMode = 'older'
  })
  await open()
  await fail()
  await refresh.click()
  await refresh.waitFor({ state: 'hidden' })
  assert.equal(await undo.isDisabled(), true, 'Refresh silently targeted an older turn')
  await page.getByText('This turn is no longer available to undo.', { exact: false }).waitFor()
  assert.equal(await page.evaluate(() => window.requests.length), 3)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    window.refreshMode = 'running'
  })
  await open()
  await fail()
  await refresh.click()
  await page.getByRole('status').filter({ hasText: 'Wait for the agent' }).waitFor()
  assert.equal(await undo.isDisabled(), true, 'Running thread allowed undo after refresh')
  await page.evaluate(() => window.setTask((task) => ({ ...task, status: 'draft' })))
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Undo changes',
      )?.disabled,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  // A delayed response from another runtime must not reopen/clear the current dialog.
  await page.evaluate(() => {
    window.refreshMode = 'same'
    window.holdRefresh = true
  })
  await open()
  await fail()
  await refresh.click()
  await page.getByRole('button', { name: 'Refreshing…', exact: true }).waitFor()
  await page.evaluate(() => window.setRuntime(1))
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await open()
  await page.evaluate(() => window.finishRefresh())
  assert.equal(await page.getByRole('dialog').count(), 1)
  assert.equal(await undo.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.refreshes.at(-1)), 'local')
  assert.deepEqual(errors, [])
  console.log(
    'Composer command recovery passed: refresh gate, failure/offline/busy states, preserved draft/queue, scoped runtime, captured turn and late response guards.',
  )
} finally {
  await browser.close()
}
