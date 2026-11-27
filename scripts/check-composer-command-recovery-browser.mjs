import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { chromium } from './browser/harness.mjs'
const assets = fileURLToPath(new URL('../apps/desktop/dist/assets/', import.meta.url))
const catalogMock = `export const useHarnessCatalog=()=>({modelName:'',catalog:{models:[{id:'fast-model',name:'Fast model'},{id:'large-model',name:'Large model',serviceTiers:[{id:'priority',name:'Fast'}]}],reasoning:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});`
const mocks = {
  './harness-catalog': catalogMock,
  './use-harness-availability': `export const useHarnessAvailability=()=>({claudeAutoLimits:new Map(),available:new Set(['harness:codex']),loading:false,sandboxNotes:[],refresh:()=>{}});`,
  './agent-avatar': `export const AgentAvatar=()=>null;`,
  './harness-icon': `export const HarnessIcon=()=>null;`,
  '@dovo/studio-core': `export {composerRecoveryKey,createComposerRecovery,composerCaretRecoveryKey} from '../studio-core/src/workspace/composer-recovery';export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {providers} from '../studio-core/src/providers';const Context=createContext(null);export const WorkspaceHarness=Context.Provider;export const useWorkspace=()=>useContext(Context);export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});export const resolveTaskAgent=()=>({id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''});export const useResolvedTheme=()=> 'dark'; export {studioSyntaxTheme} from '../studio-core/src/themes'; const preferences={showPlanButton:true,showSendOptions:true,followUp:'queue',confirmStop:false};window.setComposerPreferences=value=>Object.assign(preferences,value);export const useAppPreferences=()=>preferences;export const readAppPreferences=()=>preferences;export const updateAppPreferences=value=>Object.assign(preferences,value);export const useWorkspaceSelector=select=>select(useContext(Context));export const sameWorkspaceFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {BotAvatar} from '../studio-ui/src/bot-avatar';export {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter,DialogHeader} from '../studio-ui/src/components/ui/dialog';export {Input} from '../studio-ui/src/components/ui/input';export {SearchField} from '../studio-ui/src/search-field';export {ComposerSettingsControls} from '../studio-ui/src/composer-settings-controls';export * as Popover from '@radix-ui/react-popover';export {ChoicePicker} from '../studio-ui/src/choice-picker';export const useHarnessCatalog=()=>({catalog:{models:[{id:'fast-model',name:'Fast model'},{id:'large-model',name:'Large model'}],reasoning:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {permissionPolicyUIIssue} from '../studio-ui/src/permission-policy-fields';export {Queue,QueueSectionTrigger,QueueList,QueueItem,QueueItemIndicator,QueueItemContent} from '../studio-ui/src/components/ai-elements/queue.tsx';import React from 'react';export const cn=(...values)=>values.filter(Boolean).join(' ');import {Button} from '../studio-ui/src/components/ui/button';export {Button};export const IconButton=({label,children,...props})=><Button aria-label={label} {...props}>{children}</Button>;export {ComposerSurface,ComposerSubmit} from '../studio-ui/src/composer-surface';`,
  './use-attachments': `export const useAttachments=task=>({submissionFiles:task.draftAttachments??[],failedUploads:[],canSubmitWhileUploading:false,waitForUploads:async()=>{},files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:files=>{window.dropped.push(files.map(file=>({name:file.name,size:file.size})))},remove:()=>{}});`,
  './composer-editor': `import {useSyncExternalStore} from 'react';export const ComposerEditor=({controller,onCommand})=>{const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <><textarea aria-label="Message" value={text} onChange={event=>controller.update(event.target.value)}/><button type="button" onClick={()=>onCommand('new-session')}>New session</button><button type="button" onClick={()=>onCommand('compact')}>/compact</button></>};`,
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
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'draft',messages:[],turns:[{...turn('older'),checkpoint:{...turn('older').checkpoint,restorePending:true,undone:{at:'now',backup:'saved'}}},turn('last')],queue:[{id:'queued',text:'Keep this queue',role:'user'}],draft:'Keep this draft',files:[],example:false};
window.requests=[];
const request=async(path,input)=>{window.requests.push({path,input});return {ok:true}};
function App(){
 const [supportsReview,setSupportsReview]=useState(false);window.setSupportsReview=setSupportsReview;
 const [runtime,setRuntime]=useState(0);const [connected,setConnected]=useState(true);const [workspace,setWorkspace]=useState({tasks:[initial],repositories:[],agents:[],skills:[],mcpServers:[]});
 window.setRuntime=setRuntime;window.setConnected=setConnected;window.setTask=update=>setWorkspace(old=>({...old,tasks:[update(old.tasks[0])]}));window.current=workspace.tasks[0];
 const value={workspace,setWorkspace,request,connected,runtimes:[],runtimeRegistry:{profiles,activeId:profiles[runtime].id},activeRuntimeId:profiles[runtime].id,connection:profiles[runtime].connection,refreshRuntime:async()=>{},flush:async()=>{},snapshot:{retryUsesCurrentFiles:supportsReview,queuePausePreservationSupported:supportsReview,workspace,questions:[],approvals:[],runs:[]}};
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
  const backup = page.getByRole('button', { name: 'Review saved Undo backup', exact: true })
  await page.getByText('Update the runtime to review the saved Undo backup.').waitFor()
  assert.equal(await backup.count(), 0)
  await page.evaluate(() => window.setSupportsReview(true))
  await backup.click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await backup.click()
  await page.getByRole('button', { name: 'Keep current files', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.requests), [
    { path: '/api/tasks/turn/review-backup', input: { id: 'task', turnId: 'older' } },
  ])
  assert.equal(await page.evaluate(() => window.current.draft), 'Keep this draft')
  assert.equal(await page.evaluate(() => window.current.queue[0].text), 'Keep this queue')
  await page.evaluate(() => window.setTask((task) => ({ ...task, turns: [] })))
  await backup.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'New session' }).click()
  await page.getByRole('button', { name: 'Start fresh' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.requests.at(-1).path), '/api/tasks/new-session')
  const compact = page.getByRole('button', { name: '/compact', exact: true })
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      status: 'running',
      sessionId: 'session',
      queuePaused: true,
    })),
  )
  await compact.click()
  const queued = await page.evaluate(() => window.requests.at(-1))
  assert.equal(queued.path, '/api/tasks/message')
  assert.equal(queued.input.id, 'task')
  assert.equal(queued.input.text, '/compact')
  assert.equal(queued.input.preserveQueuePause, true)
  assert.ok(queued.input.messageId)
  assert.equal(await page.evaluate(() => window.current.draft), 'Keep this draft')
  await page.evaluate(() => window.setSupportsReview(false))
  await compact.click()
  assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), {
    path: '/api/tasks/compact',
    input: { id: 'task' },
  })
  assert.deepEqual(errors, [])
  console.log('Legacy Undo backup recovery, new session and queued compaction checks passed.')
} finally {
  await browser.close()
}
