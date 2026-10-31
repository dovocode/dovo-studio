import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const actions = root + 'apps/mobile/src/tasks/conversation/state/'
const actionOptions = {
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {useConversationActions} from './apps/mobile/src/tasks/conversation/state/use-actions';
window.requests=[];window.fail=true;window.finish=null;window.starts=0;window.acknowledgements=0;window.outcomes=[];window.startFactory=()=>{window.starts++;return {confirmed:()=>{window.acknowledgements++},settled:outcome=>window.outcomes.push(outcome)}};
window.request=(path,input)=>path==='/api/tasks/title'?Effect.succeed({title:'Generated'}):path==='/api/tasks/projects/select'?(window.failProject?Effect.fail(new Error('Project selection failed')):Effect.succeed(window.task)):path==='/api/workspace'?Effect.sync(()=>{window.setTask(task=>({...task,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]))}));return {revision:1}}):Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.requests.push({path,input});window.finish=()=>window.fail?reject(new Error('Send failed')):resolve({ok:true,pending:window.pending===true})}),catch:error=>error});
function App(){const[task,setTask]=useState({id:'settled',title:'Settled',repositoryId:'repo',agentId:'agent',status:'draft',archived:false,draft:'',messages:[],turns:[],files:[],example:false});const actions=useConversationActions(task);window.task=task;window.setTask=setTask;window.actions=actions;return <><textarea aria-label="Message" value={actions.draft.text} disabled={actions.backgroundSubmitting||!!task.archivedAt||(actions.busy&&!actions.submitting)} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/><button disabled={!actions.canSend} onClick={()=>actions.run(()=>actions.submit())}>Send</button><p role="status">{actions.error}</p></>}
const appRoot=createRoot(document.getElementById('app'));let epoch=0;window.remount=()=>appRoot.render(<App key={++epoch}/>);window.remount();`,
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
    '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
}
const actionStubs = [
  {
    path: 'react-native',
    contents:
      'export const Alert={alert(){}};export const Keyboard={dismiss(){window.keyboardDismissed=true}};',
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
    contents: `export const useRuntime=()=>({connected:true,activeId:'computer',profile:{connection:{address:'http://computer.lan',token:'device-token'}},snapshot:{promptQueueStagingSupported:window.stagingSupported!==false,queueRestoreReceiptsSupported:true,queuedTurnSettingsSupported:window.queuedSupported!==false,fullTurnSettingsSupported:true,permissionPolicySupported:true,workspace:{agents:[{id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],attachmentUploads:()=>[],finishAttachmentEffect:()=>Effect.void,reviewAttachments:()=>{},call:()=>{},readEffect:window.request,callEffect:window.request});`,
  },
  {
    path: '../../../runtime/preferences/app-preferences',
    importer: actions,
    contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
  },
  {
    path: '../../draft/use-draft',
    importer: actions,
    contents: `import {useState,useRef} from 'react';import {Effect} from 'effect';export const useDraft=()=>{const[text,setText]=useState(window.draftText??'');const[pendingRestore,setPendingRestore]=useState();const restore=useRef();return {key:'computer:settled',text,ready:true,pendingRestore,stageRestoreEffect:value=>Effect.sync(()=>{restore.current=value;setPendingRestore(value)}),confirmRestoreEffect:()=>Effect.sync(()=>{setText(text=>[text,restore.current?.text].filter(Boolean).join('\\n\\n'));setPendingRestore(undefined)}),discardRestoreEffect:()=>Effect.void,revision:text,update:value=>{window.draftText=value;setText(value)},appendEffect:value=>Effect.sync(()=>setText(text=>[text,value].filter(Boolean).join('\\n\\n'))),stageEffect:()=>Effect.void,confirmEffect:(_attempt,clear)=>Effect.sync(()=>{if(clear)setText(current=>current.trim()===_attempt.text?'':current)})}};`,
  },
  {
    path: '../../composer/attachment-picker',
    importer: actions,
    contents:
      'export const useAttachmentPicker=(_id,editing)=>{window.uploadEdit=file=>editing?.uploaded(file);return {busy:false,pick(){},upload(){}}};',
  },
  {
    path: '../../composer/use-composer-dictation',
    importer: actions,
    contents:
      'export const useComposerDictation=({draft})=>({active:false,update:draft.update,reset(){}});',
  },
]
const built = await bundleBrowser(actionOptions, actionStubs)
const startup = root + 'apps/mobile/src/tasks/creation/'
const startupOptions = {
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {StartupThread} from './apps/mobile/src/tasks/creation/startup-thread';
window.commits=[];window.routes=[];window.saves=[];window.savedDrafts={initial:'Original prompt'};
function App(){const[focused,setFocused]=useState(true);const[mounted,setMounted]=useState(true);window.focus=setFocused;window.mount=setMounted;window.focused=focused;return mounted?<StartupThread taskId="initial" runtimeId="computer" onCommit={(...args)=>window.commits.push(args)} onDraft={(...args)=>window.routes.push(args)} onBrowse={()=>{}} onNewThread={()=>{}}/>:null}
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
    '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
}
const startupStubs = [
  { path: 'expo-crypto', contents: 'let id=0;export const randomUUID=()=>"expo-draft-"+(++id);' },
  { path: 'react-native', contents: 'export const View=({children})=>children;' },
  {
    path: '../../runtime/connection/provider',
    importer: startup,
    contents: "export {RuntimeContext,RuntimeScope,useRuntime} from 'test-runtime';",
  },
  {
    path: 'test-runtime',
    contents: `import {createContext,useContext} from 'react';import {Effect} from 'effect';export const RuntimeContext=createContext(null);export const RuntimeScope=({children})=>children;const request=(path)=>Effect.sync(()=>path==='/api/workspace'?{revision:1}:window.draft);const runtime={activeId:'computer',snapshot:{workspace:{tasks:[]}},readEffect:request,callEffect:request,overviews:[{profile:{id:'computer'},connected:true,snapshot:{workspace:{repositories:[{id:'repo',kind:'scratch',name:'Scratch'}],tasks:[],agents:[]}}}]};export const useRuntime=()=>useContext(RuntimeContext)??runtime;`,
  },
  {
    path: '../../shell/navigation',
    importer: startup,
    contents: 'export const useNavigation=()=>({focused:window.focused});',
  },
  {
    path: '../../ui/content/text',
    importer: startup,
    contents: 'export const Text=({children})=>children;',
  },
  {
    path: '../../ui/controls/action',
    importer: startup,
    contents: 'export const Action=()=>null;',
  },
  {
    path: '../../ui/theme',
    importer: startup,
    contents: 'export const useTheme=()=>({styles:{}});',
  },
  {
    path: '../draft/use-draft',
    importer: startup,
    contents: `export const saveRuntimeDraft=async(runtimeId,taskId,text)=>{window.saves.push({runtimeId,taskId,text});if(window.storageWait)await new Promise(resolve=>window.releaseSave=resolve);if(window.storageFail)throw new Error('Storage unavailable');window.savedDrafts[taskId]=text};`,
  },
  { path: './folder-picker', importer: startup, contents: 'export const FolderPicker=()=>null;' },
  {
    path: '../detail/task-detail',
    importer: startup,
    contents: `import {useRuntime} from 'test-runtime';import {runClientEffect} from '@dovo/client-runtime';import {taskSchema} from '@dovo/protocol';export const TaskDetail=({task,startup})=>{const runtime=useRuntime();window.draft=task;window.commit=()=>runClientEffect(runtime.callEffect('/api/tasks/projects/select',{id:task.id},taskSchema));window.start=(attemptId='attempt')=>{window.background=startup.onStartInBackground({...task,harness:{provider:'codex',model:'configured-model',permission:'read-only'},autoProject:true,draftPlan:true,draftTurnSettings:{provider:'codex',model:'turn-model'},...window.configuration},attemptId)};return <p>{task.id}</p>};`,
  },
]
const startupBuilt = await bundleBrowser(startupOptions, startupStubs)
// Run the real startup controller, temporary runtime and send workflow together.
const integratedBuilt = await bundleBrowser(
  {
    ...startupOptions,
    stdin: {
      ...startupOptions.stdin,
      contents: startupOptions.stdin.contents.replace(
        'window.commits=[];',
        'window.messageRequests=[];window.projectRequests=[];window.failMessage=true;window.commits=[];',
      ),
    },
  },
  [
    ...startupStubs.map((stub) => {
      if (stub.path === 'expo-crypto')
        return {
          ...stub,
          contents: actionStubs.find((item) => item.path === 'expo-crypto').contents,
        }
      if (stub.path === 'react-native')
        return {
          ...stub,
          contents:
            'export const View=({children})=>children;export const Alert={alert(){}};export const Keyboard={dismiss(){}};',
        }
      if (stub.path === 'test-runtime')
        return {
          ...stub,
          contents: `
import {createContext,useContext,useSyncExternalStore} from 'react';import {Effect} from 'effect';import {resolveTaskDefaults} from '@dovo/protocol';
export const RuntimeContext=createContext(null);export const RuntimeScope=({children})=>children;
const repository={id:'repo',kind:'scratch',name:'Scratch'};
let task={...resolveTaskDefaults(undefined,repository),id:'initial',title:'New thread',repositoryId:'repo',agentId:'',autoProject:true,modelSelection:'smart',modelSelectionDifficulty:'high',harnessCustomized:false,status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false};
const listeners=new Set();let revision=0;const notify=()=>{revision++;listeners.forEach(listener=>listener())};window.configure=changes=>{task={...task,...changes};notify()};
const request=(path,input)=>{
 if(path==='/api/workspace')return Effect.sync(()=>{task=input.create??{...task,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after??undefined]))};notify();return {revision:1}});
 if(path==='/api/tasks/projects/select')return Effect.sync(()=>{window.projectRequests.push(input);task={...task,repositoryId:'resolved-repo',autoProject:undefined,modelSelection:undefined,harness:{...task.harness,model:'resolved-model'}};notify();return task});
 if(path==='/api/tasks/message')return Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.messageRequests.push(input);window.finishMessage=()=>{if(window.failMessage){reject(new Error('Message delivery failed'));return}task={...task,status:'running',messages:[{id:input.messageId,role:'user',text:input.text,createdAt:new Date().toISOString()}]};notify();resolve({ok:true})}}),catch:error=>error});
 return Effect.succeed({title:'Generated'});
};
const runtime={activeId:'computer',connected:true,profile:{connection:{address:'http://computer.lan',token:'device-token'}},pendingMessages:()=>[],attachmentUploads:()=>[],finishAttachmentEffect:()=>Effect.void,reviewAttachments(){},call(){},readEffect:request,callEffect:request,get snapshot(){return {promptQueueStagingSupported:true,queueRestoreReceiptsSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,planModeSupported:true,workspace:{tasks:[task],repositories:[repository],agents:[]}}},get overviews(){return [{profile:{id:'computer'},connected:true,snapshot:this.snapshot}]}};
export const useRuntime=()=>{useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>revision);return useContext(RuntimeContext)??runtime};
`,
        }
      if (stub.path === '../detail/task-detail')
        return {
          ...stub,
          contents: `
import {useConversationActions} from './apps/mobile/src/tasks/conversation/state/use-actions';
export const TaskDetail=({task,startup})=>{const actions=useConversationActions(task);window.actions=actions;window.draft=task;window.start=()=>{void actions.run(()=>actions.submit('queue',undefined,attemptId=>startup.onStartInBackground({...task,draftTurnSettings:actions.turnSettings??undefined,draftPlan:actions.plan},attemptId)))};return <textarea aria-label="Message" value={actions.draft.text} disabled={actions.backgroundSubmitting} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/>};
`,
        }
      return stub
    }),
    ...actionStubs
      .filter((stub) => !['react-native', 'expo-crypto'].includes(stub.path))
      .map((stub) =>
        stub.path === '../../../runtime/connection/provider'
          ? { ...stub, contents: "export {useRuntime} from 'test-runtime';" }
          : stub,
      ),
  ],
)
const browser = await chromium.launch({ headless: true })
const errors = []
async function fixture(bundle) {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return page
}
async function backgroundSend(page) {
  await page.evaluate(() => {
    void window.actions.run(() => window.actions.submit('queue', undefined, window.startFactory))
  })
}
try {
  const page = await fixture(built)
  const input = page.getByRole('textbox', { name: 'Message' })
  await input.fill('Start this thread')
  // Same-tick admission must not run a dropped action's suppression factory.
  await page.evaluate(() => {
    void window.actions.run(() => window.actions.submit('queue', undefined, window.startFactory))
    void window.actions.run(() => window.actions.submit('queue', undefined, window.startFactory))
    void window.actions.run(() => {
      window.normalAdmitted = true
      return window.actions.submit('queue')
    })
  })
  await page.waitForFunction(() => window.requests.length === 1)
  assert.equal(await page.evaluate(() => window.starts), 1)
  assert.equal(await page.evaluate(() => !!window.normalAdmitted), false)
  assert.equal(await input.isDisabled(), true)
  await page.evaluate(() => window.actions.draft.update('Late native input', 'keyboard'))
  const firstId = await page.evaluate(() => window.requests[0].input.messageId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Start this thread')
  assert.deepEqual(await page.evaluate(() => window.outcomes), ['failed'])
  assert.equal(await input.isDisabled(), false)
  await page.evaluate(() => {
    window.fail = false
    window.pending = true
  })
  await backgroundSend(page)
  await page.waitForFunction(() => window.requests.length === 2)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.messageId), firstId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.deepEqual(await page.evaluate(() => window.outcomes), ['failed', 'pending'])
  assert.equal(await page.evaluate(() => window.acknowledgements), 0)
  assert.equal(await input.inputValue(), 'Start this thread')
  await page.evaluate(() => {
    window.pending = false
  })
  await backgroundSend(page)
  await page.waitForFunction(() => window.requests.length === 3)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.messageId), firstId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await page.evaluate(() => window.acknowledgements), 1)
  assert.deepEqual(await page.evaluate(() => window.outcomes), ['failed', 'pending', 'confirmed'])
  assert.equal(await input.inputValue(), '')
  await page.close()

  for (const mode of ['stage', 'queue']) {
    const retry = await fixture(built)
    await retry.getByRole('textbox', { name: 'Message' }).fill('Unresolved normal send')
    await retry.evaluate((mode) => {
      void window.actions.run(() => window.actions.submit(mode))
    }, mode)
    await retry.waitForFunction(() => window.requests.length === 1)
    const original = await retry.evaluate(() => window.requests[0].input.messageId)
    await retry.evaluate(() => window.finish())
    await retry.waitForFunction(() => !window.actions.busy)
    assert.equal(await retry.evaluate(() => window.actions.canStartInBackground), mode === 'queue')
    await retry.evaluate(() => window.remount())
    await retry.waitForFunction(
      () => window.actions.draft.text === 'Unresolved normal send' && !window.actions.busy,
    )
    assert.equal(await retry.evaluate(() => window.actions.canStartInBackground), mode === 'queue')
    await backgroundSend(retry)
    if (mode === 'stage') {
      await retry.waitForFunction(() => !window.actions.busy)
      assert.equal(await retry.evaluate(() => window.starts), 0)
      assert.equal(await retry.evaluate(() => window.requests.length), 1)
      await retry.evaluate(() => {
        void window.actions.run(() => window.actions.submit('stage'))
      })
    }
    await retry.waitForFunction(() => window.requests.length === 2)
    assert.equal(await retry.evaluate(() => window.requests.at(-1).input.messageId), original)
    assert.equal(await retry.evaluate(() => window.starts), mode === 'queue' ? 1 : 0)
    await retry.evaluate(() => window.finish())
    await retry.waitForFunction(() => !window.actions.busy)
    await retry.close()
  }

  const validation = await fixture(built)
  await validation.getByRole('textbox', { name: 'Message' }).fill('Validation rejected')
  await validation.evaluate(() => {
    window.queuedSupported = false
    window.actions.setTurnSettings({ provider: 'codex', model: 'turn-model' })
  })
  await validation.waitForFunction(
    () => !window.actions.busy && window.actions.turnSettings?.model === 'turn-model',
  )
  await backgroundSend(validation)
  await validation.waitForFunction(() => !window.actions.busy)
  assert.equal(await validation.evaluate(() => window.starts), 0)
  assert.equal(await validation.evaluate(() => window.requests.length), 0)
  await validation.close()

  const project = await fixture(built)
  await project.getByRole('textbox', { name: 'Message' }).fill('Project selection fails')
  await project.evaluate(() => {
    window.failProject = true
    window.setTask((task) => ({ ...task, autoProject: true }))
  })
  await project.waitForFunction(() => window.task.autoProject === true)
  await backgroundSend(project)
  await project.waitForFunction(() => !window.actions.busy)
  assert.deepEqual(await project.evaluate(() => window.outcomes), ['failed'])
  assert.equal(await project.evaluate(() => window.actions.backgroundSubmitting), false)
  await project.close()

  for (const mode of ['inherit', 'auto', 'smart']) {
    const integration = await fixture(integratedBuilt)
    await integration.evaluate((mode) => window.configure({ modelSelection: mode }), mode)
    await integration.waitForFunction((mode) => window.draft.modelSelection === mode, mode)
    await integration
      .getByRole('textbox', { name: 'Message' })
      .fill('Resolve then retry this request')
    await integration.evaluate(() => window.start())
    await integration.waitForFunction(
      () => window.messageRequests.length === 1 && window.draft.repositoryId === 'resolved-repo',
    )
    const messageId = await integration.evaluate(() => window.messageRequests[0].messageId)
    assert.equal(await integration.evaluate(() => window.draft.autoProject), undefined)
    assert.equal(await integration.evaluate(() => window.draft.modelSelection), undefined)
    assert.equal(await integration.evaluate(() => window.draft.harness.model), 'resolved-model')
    await integration.evaluate(() => window.finishMessage())
    await integration.waitForFunction(() => !window.actions.busy)
    assert.deepEqual(await integration.evaluate(() => window.routes), [])
    assert.equal(await integration.evaluate(() => window.actions.canStartInBackground), true)
    await integration.evaluate(() => {
      window.failMessage = false
      window.start()
    })
    await integration.waitForFunction(() => window.messageRequests.length === 2)
    assert.equal(await integration.evaluate(() => window.messageRequests[1].messageId), messageId)
    assert.equal(await integration.evaluate(() => window.projectRequests.length), 1)
    await integration.evaluate(() => window.finishMessage())
    await integration.waitForFunction(() => window.routes.length === 1)
    const fresh = await integration.evaluate(() => window.draft)
    assert.equal(fresh.repositoryId, 'repo')
    assert.equal(fresh.autoProject, true)
    assert.equal(fresh.modelSelection, mode)
    assert.equal(fresh.modelSelectionDifficulty, 'high')
    assert.notEqual(fresh.harness.model, 'resolved-model')
    assert.equal(fresh.draft, '')
    await integration.close()
  }

  const differentAttempt = await fixture(startupBuilt)
  await differentAttempt.evaluate(() => {
    window.start('first')
    window.background.settled('failed')
    window.configuration = {
      repositoryId: 'explicit-project',
      autoProject: false,
      modelSelection: 'auto',
      harness: { provider: 'codex', model: 'explicit-model', permission: 'read-only' },
    }
    window.start('different-attempt')
  })
  await differentAttempt.evaluate(() => window.background.confirmed())
  await differentAttempt.waitForFunction(() => window.routes.length === 1)
  assert.equal(await differentAttempt.evaluate(() => window.draft.repositoryId), 'explicit-project')
  assert.equal(await differentAttempt.evaluate(() => window.draft.autoProject), false)
  assert.equal(await differentAttempt.evaluate(() => window.draft.modelSelection), 'auto')
  assert.equal(await differentAttempt.evaluate(() => window.draft.harness.model), 'explicit-model')
  await differentAttempt.close()

  // Exercise the real temporary runtime: a suppressed projects/select notification
  // remains deferred and can still notify after a background failure.
  for (const outcome of ['failed', 'pending', 'confirmed']) {
    const fallback = await fixture(startupBuilt)
    await fallback.evaluate(() => window.start())
    await fallback.evaluate(() => window.commit())
    assert.deepEqual(await fallback.evaluate(() => window.commits), [])
    await fallback.evaluate((outcome) => window.background.settled(outcome), outcome)
    await fallback.evaluate(() => window.commit())
    assert.deepEqual(await fallback.evaluate(() => window.commits), [['computer', 'initial']])
    await fallback.close()
  }

  const startupPage = await fixture(startupBuilt)
  await startupPage.evaluate(() => {
    window.start()
    window.background.settled('failed')
    window.configuration = {
      autoProject: false,
      harness: { provider: 'codex', model: 'resolved-model', permission: 'full' },
    }
    window.start()
    window.storageFail = true
    window.background.confirmed()
  })
  await startupPage.waitForFunction(() => window.draft.id !== 'initial')
  const next = await startupPage.evaluate(() => window.draft)
  assert.match(next.id, /^expo-draft-/)
  assert.equal(next.draft, '')
  assert.equal(next.harness.model, 'configured-model')
  assert.equal(next.harness.permission, 'read-only')
  assert.equal(next.autoProject, true)
  assert.equal(next.draftPlan, true)
  assert.deepEqual(next.draftTurnSettings, { provider: 'codex', model: 'turn-model' })
  assert.deepEqual(await startupPage.evaluate(() => window.routes), [['computer', next.id]])
  assert.deepEqual(await startupPage.evaluate(() => window.saves), [])
  await startupPage.evaluate(() => window.background.confirmed())
  assert.equal(await startupPage.evaluate(() => window.routes.length), 1)
  await startupPage.close()

  for (const leave of ['blur', 'unmount', 'blur-return']) {
    const lifecycle = await fixture(startupBuilt)
    await lifecycle.evaluate(() => window.start())
    await lifecycle.evaluate((leave) => {
      if (leave === 'unmount') window.mount(false)
      else window.focus(false)
    }, leave)
    await lifecycle.waitForFunction(() => !window.focused || !document.querySelector('p'))
    if (leave === 'blur-return') {
      await lifecycle.evaluate(() => window.focus(true))
      await lifecycle.waitForFunction(() => window.focused)
    }
    await lifecycle.evaluate(() => window.background.confirmed())
    // Flush promises and React publication before checking navigation.
    await lifecycle.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.deepEqual(await lifecycle.evaluate(() => window.routes), [])
    assert.equal(await lifecycle.evaluate(() => window.draft.id), 'initial')
    await lifecycle.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    'Mobile background start: admitted lifecycle, validation/project failure cleanup, deferred commit, edit lock, pending retry identity, queue retry after remount, stage retry guard, synchronous reset without redundant storage writes, configuration retention, focus/unmount and stale callback guards passed.',
  )
} finally {
  await browser.close()
}
