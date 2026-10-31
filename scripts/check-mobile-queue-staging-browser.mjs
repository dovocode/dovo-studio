import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const actions = root + 'apps/mobile/src/tasks/conversation/state/'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {useConversationActions} from './apps/mobile/src/tasks/conversation/state/use-actions';
window.requests=[];window.fail=true;window.finish=null;
window.request=(path,input)=>path==='/api/workspace'?Effect.sync(()=>{window.setTask(task=>({...task,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]))}));return {revision:1}}):Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.requests.push({path,input});window.finish=()=>window.fail?reject(new Error('Send failed')):resolve({ok:true})}),catch:error=>error});
function App(){const[task,setTask]=useState({id:'settled',title:'Settled',repositoryId:'repo',agentId:'agent',status:'review',archived:false,draft:'',messages:[{id:'previous',role:'user',text:'Earlier request'}],turns:[],files:[],example:false});const actions=useConversationActions(task);window.task=task;window.setTask=setTask;window.actions=actions;return <><textarea aria-label="Message" value={actions.draft.text} disabled={!!task.archivedAt||(actions.busy&&!actions.submitting)} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/><button disabled={!actions.canSend} onClick={()=>actions.run(()=>actions.submit())}>Send</button><p role="status">{actions.error}</p></>}
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
      contents: `export const useRuntime=()=>({connected:true,activeId:'computer',profile:{connection:{address:'http://computer.lan',token:'device-token'}},snapshot:{queuePausePreservationSupported:true,promptQueueStagingSupported:window.stagingSupported!==false,queueRestoreReceiptsSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,workspace:{agents:[{id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],attachmentUploads:()=>[],finishAttachmentEffect:()=>Effect.void,reviewAttachments:()=>{},call:()=>{},readEffect:window.request,callEffect:window.request});`,
    },
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: actions,
      contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
    },
    {
      path: '../../draft/use-draft',
      importer: actions,
      contents: `import {useState,useRef} from 'react';import {Effect} from 'effect';export const useDraft=()=>{const[text,setText]=useState('');const[pendingRestore,setPendingRestore]=useState();const restore=useRef();return {key:'computer:settled',text,ready:true,pendingRestore,stageRestoreEffect:value=>Effect.sync(()=>{restore.current=value;setPendingRestore(value)}),confirmRestoreEffect:()=>Effect.sync(()=>{setText(text=>[text,restore.current?.text].filter(Boolean).join('\\n\\n'));setPendingRestore(undefined)}),discardRestoreEffect:()=>Effect.void,revision:text,update:setText,appendEffect:value=>Effect.sync(()=>setText(text=>[text,value].filter(Boolean).join('\\n\\n'))),stageEffect:()=>Effect.void,confirmEffect:(_attempt,clear)=>Effect.sync(()=>{if(clear)setText(current=>current.trim()===_attempt.text?'':current)})}};`,
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
  await input.fill('Stage this')
  // Same-tick admission must reject a second request before React publishes busy.
  await page.evaluate(() => {
    window.actions.run(() => window.actions.submit('stage'))
    window.actions.run(() => window.actions.submit('stage'))
  })
  await page.waitForFunction(() => window.requests.length === 1)
  const first = await page.evaluate(() => window.requests[0])
  assert.equal(first.path, '/api/tasks/message')
  assert.equal(first.input.queueOnly, true)
  assert.equal(await input.isEnabled(), true)
  assert.equal(await input.evaluate((element) => element === document.activeElement), true)
  assert.equal(await page.evaluate(() => !!window.keyboardDismissed), false)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy && window.actions.error === 'Send failed')
  assert.equal(await page.evaluate(() => window.actions.defaultSendMode), 'stage')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 2)
  const retry = await page.evaluate(() => window.requests[1])
  assert.equal(retry.input.messageId, first.input.messageId)
  assert.equal(retry.input.queueOnly, true)
  // A newer draft must survive completion of the previous request.
  await input.fill('Next draft while sending')
  await page.evaluate(() => {
    window.fail = false
    window.finish()
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Next draft while sending')
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: true,
      queue: [
        {
          id: 'staged',
          role: 'user',
          text: 'Stage this',
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  )
  await page.waitForFunction(() => window.actions.defaultSendMode === 'stage')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 3)
  assert.equal(await page.evaluate(() => window.requests[2].input.queueOnly), true)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await input.fill('Send explicitly')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit('queue')))
  await page.waitForFunction(() => window.requests.length === 4)
  assert.equal(await page.evaluate(() => window.requests[3].input.queueOnly), undefined)
  assert.equal(await page.evaluate(() => window.requests[3].input.preserveQueuePause), undefined)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: false,
      queue: task.queue.map((message, index) => ({ ...message, paused: index === 0 })),
    })),
  )
  await page.waitForFunction(
    () => !window.task.queuePaused && window.actions.defaultSendMode === 'stage',
  )
  await input.fill('Behind paused first prompt')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 5)
  assert.equal(await page.evaluate(() => window.requests[4].input.queueOnly), true)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await input.fill('Unsupported stage')
  await page.evaluate(() => {
    window.stagingSupported = false
    window.setTask((task) => ({ ...task }))
  })
  await page.waitForFunction(() => !window.actions.stageSupported)
  await page.evaluate(() => void window.actions.run(() => window.actions.submit('stage')))
  await page.waitForFunction(() => window.actions.error.includes('stage queued messages'))
  assert.equal(await page.evaluate(() => window.requests.length), 5)
  await page.evaluate(() => {
    window.stagingSupported = true
    window.setTask((task) => ({
      ...task,
      status: 'review',
      activeRunId: undefined,
      queue: [],
      queuePaused: false,
    }))
  })
  await page.waitForFunction(() => window.actions.stageSupported)
  await input.fill('Gap prompt A')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit('stage')))
  await page.waitForFunction(() => window.requests.length === 6)
  const gapA = await page.evaluate(() => window.requests[5].input.messageId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), '')
  assert.equal(
    await page.evaluate(() => !!window.task.queue?.length || !!window.task.queuePaused),
    false,
  )
  await input.fill('Gap prompt B')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 7)
  assert.equal(await page.evaluate(() => window.requests[6].input.queueOnly), true)
  const gapB = await page.evaluate(() => window.requests[6].input.messageId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await page.evaluate(
    ({ gapA, gapB }) =>
      window.setTask((task) => ({
        ...task,
        queuePaused: true,
        queue: [
          { id: gapA, role: 'user', text: 'Gap prompt A' },
          { id: gapB, role: 'user', text: 'Gap prompt B' },
        ],
      })),
    { gapA, gapB },
  )
  await page.waitForFunction(() => window.actions.defaultSendMode === 'stage')
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      status: 'review',
      activeRunId: undefined,
      queuePaused: false,
    })),
  )
  await page.waitForFunction(() => window.actions.defaultSendMode === 'queue')
  // A remote start also clears staging intent when the queue snapshot skipped acceptance.
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, status: 'review', activeRunId: undefined, queue: [] })),
  )
  await input.fill('Gap prompt C')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit('stage')))
  await page.waitForFunction(() => window.requests.length === 8)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(
    () => !window.actions.busy && window.actions.defaultSendMode === 'stage',
  )
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, status: 'running', activeRunId: 'new-remote-run' })),
  )
  await page.waitForFunction(() => window.actions.defaultSendMode === 'queue')
  // Idle automatic additions must not inherit staging or require Run queue, even before snapshots.
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, status: 'review', activeRunId: undefined })),
  )
  await input.fill('Automatic prompt A')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 9)
  assert.equal(await page.evaluate(() => window.requests[8].input.queueOnly), undefined)
  assert.equal(await page.evaluate(() => window.requests[8].input.preserveQueuePause), true)
  await input.fill('Automatic prompt B')
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Automatic prompt B')
  assert.equal(await page.evaluate(() => window.actions.defaultSendMode), 'queue')
  await page.evaluate(() => void window.actions.run(() => window.actions.submit()))
  await page.waitForFunction(() => window.requests.length === 10)
  assert.deepEqual(
    await page.evaluate(() => window.requests.slice(8).map((request) => request.input.text)),
    ['Automatic prompt A', 'Automatic prompt B'],
  )
  assert.equal(await page.evaluate(() => window.requests[9].input.queueOnly), undefined)
  assert.equal(await page.evaluate(() => window.requests[9].input.preserveQueuePause), true)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await input.fill('Automatic retry')
  await page.evaluate(() => {
    window.fail = true
    void window.actions.run(() => window.actions.submit())
  })
  await page.waitForFunction(() => window.requests.length === 11)
  const automaticId = await page.evaluate(() => window.requests[10].input.messageId)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: true,
      queue: [{ id: 'other', role: 'user', text: 'Paused elsewhere' }],
    })),
  )
  assert.equal(await page.evaluate(() => window.actions.defaultSendMode), 'queue')
  await page.evaluate(() => {
    window.fail = false
    void window.actions.run(() => window.actions.submit())
  })
  await page.waitForFunction(() => window.requests.length === 12)
  const automaticRetry = await page.evaluate(() => window.requests[11].input)
  assert.equal(automaticRetry.messageId, automaticId)
  assert.equal(automaticRetry.preserveQueuePause, true)
  assert.equal(automaticRetry.queueOnly, undefined)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile queue staging: capability gate, atomic queue-only payload, synchronous admission, retry identity, editable focused input, newer draft preservation, paused default and explicit Send passed.',
  )
} finally {
  await browser.close()
}
