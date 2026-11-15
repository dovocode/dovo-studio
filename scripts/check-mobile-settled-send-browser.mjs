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
import {NativeComposerInput} from './apps/mobile/src/tasks/composer/native-composer-input.native';
window.requests=[];window.historyRequests=[];window.fail=true;window.finish=null;
window.request=(path,input,_schema,_method,options)=>path==='/api/tasks/composer-history'?Effect.tryPromise({try:async()=>{window.historyRequests.push(input);if(window.historyPage)return window.historyPage(input);return {messages:[{id:'previous',role:'user',text:'Earlier request'}],hasMore:false}},catch:error=>error}):window.offline?Effect.sync(()=>{window.requests.push({path,input,defer:options?.defer});return {ok:true,pending:true}}):path==='/api/workspace'?Effect.sync(()=>{window.setTask(task=>({...task,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]))}));return {revision:1}}):Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.requests.push({path,input});window.finish=()=>window.fail?reject(new Error('Send failed')):resolve({ok:true})}),catch:error=>error});
function App(){const[task,setTask]=useState({id:'settled',title:'Settled',repositoryId:'repo',agentId:'agent',status:'review',archived:true,draft:'',messages:[{id:'previous',role:'user',text:'Earlier request'}],turns:[],files:[],example:false});const actions=useConversationActions(task);window.task=task;window.setTask=setTask;window.actions=actions;return <>{window.nativeComposer?<NativeComposerInput inputRef={actions.composerInput} value={actions.draft.text} revision={actions.draft.revision} resources={{skills:[],mcpServers:[]}} expanded={false} editable={!actions.busy} onChangeText={text=>actions.draft.update(text,'keyboard')} onSelectionChange={()=>{}}/>:<textarea aria-label="Message" value={actions.draft.text} disabled={!!task.archivedAt||actions.busy} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/>}<button disabled={!actions.canSend} onClick={()=>actions.run(()=>actions.submit())}>Send</button><p role="status">{actions.error}</p></>}
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
        'export const Alert={alert(){}};export const Keyboard={dismiss(){}};export const useWindowDimensions=()=>({fontScale:1});',
    },
    {
      path: 'expo',
      contents: `import {useImperativeHandle,useRef} from 'react';export const requireOptionalNativeModule=()=>({supportsDraftSnapshot:true});export const requireNativeView=()=>props=>{const latest=useRef(props);latest.current=props;useImperativeHandle(props.ref,()=>({readText:()=>{const snapshot={text:latest.current.content.text,eventCount:window.nativeEventCount??0,revision:latest.current.content.revision};return window.holdNativeRead?new Promise(resolve=>window.finishNativeRead=()=>resolve(snapshot)):Promise.resolve(snapshot)}}),[]);window.nativeProps=props;return <textarea aria-label="Message" value={props.content.text} disabled={!props.editable} onChange={event=>props.onTextChange({nativeEvent:{text:event.target.value,eventCount:window.nativeEventCount=(window.nativeEventCount??0)+1}})}/>};`,
    },
    {
      path: '../../ui/theme',
      importer: root + 'apps/mobile/src/tasks/composer/native-composer-input.native.tsx',
      contents: 'export const useTheme=()=>({colors:{text:"#fff",muted:"#aaa",surface:"#222"}});',
    },
    {
      path: '../../runtime/preferences/app-preferences',
      importer: root + 'apps/mobile/src/tasks/composer/native-composer-input.native.tsx',
      contents: 'export const useCarMode=()=>false;export const carZoom=1.4;',
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
      contents: `export const useRuntime=()=>({connected:!window.offline,activeId:'computer',profile:{connection:{address:'http://computer.lan',token:'device-token'}},snapshot:{queueRestoreReceiptsSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,workspace:{agents:[{id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],attachmentUploads:()=>[],finishAttachmentEffect:()=>Effect.void,reviewAttachments:()=>{},call:()=>{},readEffect:window.request,callEffect:window.request});`,
    },
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: actions,
      contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
    },
    {
      path: '../../draft/use-draft',
      importer: actions,
      contents: `import {useState,useRef} from 'react';import {Effect} from 'effect';export const useDraft=()=>{const[{text,revision},setDraft]=useState({text:'',revision:0});const update=(value,source)=>setDraft(previous=>({text:typeof value==='function'?value(previous.text):value,revision:source==='keyboard'?previous.revision:previous.revision+1}));const setText=value=>update(value);const[pendingRestore,setPendingRestore]=useState();const restore=useRef();return {key:window.draftScope??'computer:settled',text,ready:true,pendingRestore,stageRestoreEffect:value=>Effect.sync(()=>{restore.current=value;setPendingRestore(value)}),confirmRestoreEffect:()=>Effect.sync(()=>{setText(text=>[text,restore.current?.text].filter(Boolean).join('\\n\\n'));setPendingRestore(undefined)}),discardRestoreEffect:()=>Effect.void,revision,update,appendEffect:value=>Effect.sync(()=>setText(text=>[text,value].filter(Boolean).join('\\n\\n'))),stageEffect:()=>Effect.void,confirmEffect:(_attempt,clear)=>Effect.sync(()=>{if(clear)setText('')})}};`,
    },
    {
      path: '../../composer/attachment-picker',
      importer: actions,
      contents:
        'export const useAttachmentPicker=(_id,editing)=>{window.uploadEdit=file=>editing?.uploaded(file);return {submissionFiles:[],failedUploads:[],canSubmitWhileUploading:false,waitForUploads:async()=>{},busy:false,pick(){},upload(){}}};',
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
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await input.fill('Unsent history draft')
  await page.evaluate(() => window.actions.composerHistory.begin())
  await page.waitForFunction(() => window.actions.composerHistory.active)
  assert.equal(await input.inputValue(), 'Earlier request')
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  assert.deepEqual(await page.evaluate(() => window.historyRequests), [{ id: 'settled' }])
  await page.evaluate(() => window.actions.composerHistory.cancel())
  await page.waitForFunction(() => !window.actions.composerHistory.active)
  assert.equal(await input.inputValue(), 'Unsent history draft')
  await page.evaluate(() => window.actions.composerHistory.begin())
  await page.waitForFunction(() => window.actions.composerHistory.active)
  assert.equal(await page.evaluate(() => window.historyRequests.length), 2)
  await input.fill('Edited recalled request')
  assert.equal(await page.evaluate(() => window.actions.composerHistory.active), false)
  assert.equal(await input.inputValue(), 'Edited recalled request')
  await input.fill('New work')
  assert.equal(await page.evaluate(() => window.task.archived), true)
  assert.equal(await send.isEnabled(), true)
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(await page.evaluate(() => window.task.archived), true)
  await page.evaluate(() => {
    window.finish()
    window.finish = null
  })
  await page.getByRole('status').filter({ hasText: 'Send failed' }).waitFor()
  assert.equal(await input.inputValue(), 'New work')
  assert.equal(await page.evaluate(() => window.task.archived), true)
  await send.click()
  await page.waitForFunction(() => window.requests.length === 2 && window.finish !== null)
  assert.equal(
    await page.evaluate(
      () => window.requests[0].input.messageId === window.requests[1].input.messageId,
    ),
    true,
  )
  assert.equal(
    await page.evaluate(() =>
      window.requests.every((request) => request.path === '/api/tasks/message'),
    ),
    true,
  )
  await page.evaluate(() => {
    window.fail = false
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), '')
  await page.evaluate(() => window.setTask((task) => ({ ...task, archived: false })))
  await input.fill('Attachment only next')
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, archived: true, archivedAt: '2026-10-15T00:00:00Z' })),
  )
  await page.waitForFunction(() => !window.actions.canSend)
  assert.equal(await input.isDisabled(), true)
  assert.equal(await send.isDisabled(), true)
  // Settled attachment-only messages remain valid submissions.
  await page.evaluate(() => {
    window.actions.draft.update('')
    window.setTask((task) => ({
      ...task,
      archivedAt: undefined,
      draftAttachments: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'note.txt',
          mime: 'text/plain',
          size: 1,
        },
      ],
    }))
  })
  await send.click()
  await page.waitForFunction(() => window.requests.length === 3)
  assert.deepEqual(
    await page.evaluate(() => ({
      text: window.requests[2].input.text,
      attachmentIds: window.requests[2].input.attachmentIds,
    })),
    { text: '', attachmentIds: ['00000000-0000-0000-0000-000000000000'] },
  )
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  await page.evaluate(() => {
    window.setTask((task) => ({ ...task, status: 'running', draftAttachments: [] }))
    window.actions.setTurnSettings({ provider: 'codex', model: 'large-model', reasoning: 'high' })
  })
  await page.waitForFunction(
    () => !window.actions.busy && window.actions.turnSettings?.model === 'large-model',
  )
  await input.fill('Queue with another model')
  await page.evaluate(() => {
    window.fail = true
    window.finish = null
  })
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  const selection = { provider: 'codex', model: 'large-model', reasoning: 'high' }
  assert.deepEqual(await page.evaluate(() => window.requests.at(-1).input.turnSettings), selection)
  assert.deepEqual(
    await page.evaluate(() => window.actions.pendingMessage.message.turnSettings),
    selection,
  )
  const modelMessageId = await page.evaluate(() => window.requests.at(-1).input.messageId)
  await page.evaluate(() => {
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.deepEqual(await page.evaluate(() => window.actions.turnSettings), selection)
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.messageId), modelMessageId)
  await page.evaluate(() => {
    window.fail = false
    window.finish()
  })
  await page.waitForFunction(() => !window.actions.busy && window.actions.turnSettings === null)

  // Restore uses the real action hook, locks the composer and keeps newer text.
  await input.fill('Latest draft')
  await page.evaluate(() => {
    window.finish = null
    void window.actions.restoreQueuedMessage({
      id: 'restore',
      role: 'user',
      text: 'Queued restore',
    })
  })
  await page.waitForFunction(() => window.actions.busy && window.finish !== null)
  assert.equal(await input.isDisabled(), true)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.action), 'restore')
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Latest draft\n\nQueued restore')

  await input.fill('Draft kept while editing')
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      archived: false,
      queuePaused: true,
      queue: [{ id: 'edit-me', role: 'user', text: 'Queued original' }],
    })),
  )
  await page.waitForFunction(() => window.task.queue?.[0]?.id === 'edit-me')
  await page.evaluate(() => window.actions.beginEdit(window.task.queue[0]))
  await page.waitForFunction(() => window.actions.editing?.text === 'Queued original')
  assert.equal(await input.inputValue(), 'Queued original')
  await input.fill('Queued edit')
  await page.waitForFunction(() => window.actions.editing?.text === 'Queued edit')
  const beforeSettings = await page.evaluate(() => window.requests.length)
  await page.evaluate(() =>
    window.actions.setTurnSettings({
      provider: 'codex',
      model: 'large',
      reasoning: 'high',
      harness: {
        provider: 'codex',
        model: 'large',
        reasoning: 'high',
        instructions: 'Review',
        endpoint: '',
        permission: 'read-only',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        serviceTier: 'priority',
      },
    }),
  )
  await page.waitForFunction(() => window.actions.turnSettings?.harness?.serviceTier === 'priority')
  assert.equal(await page.evaluate(() => window.requests.length), beforeSettings)
  await page.evaluate(() =>
    window.uploadEdit({
      id: '10000000-0000-0000-0000-000000000000',
      name: 'edit.txt',
      size: 2,
      mime: 'text/plain',
    }),
  )
  await page.waitForFunction(() => window.actions.draftAttachments?.[0]?.name === 'edit.txt')
  assert.equal(await page.evaluate(() => window.actions.draftAttachments[0].name), 'edit.txt')
  assert.deepEqual(await page.evaluate(() => window.task.draftAttachments), [])
  await page.evaluate(() => {
    window.fail = true
    window.finish = null
  })
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  const edit = await page.evaluate(() => window.requests.at(-1))
  assert.equal(edit.path, '/api/tasks/queue')
  assert.equal(edit.input.action, 'edit')
  assert.equal(edit.input.messageId, 'edit-me')
  assert.equal(edit.input.expectedText, 'Queued original')
  assert.equal(edit.input.turnSettings.harness.permission, 'read-only')
  assert.deepEqual(edit.input.attachmentIds, ['10000000-0000-0000-0000-000000000000'])
  await page.evaluate(() => {
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Queued edit')
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  await page.evaluate(() => {
    window.fail = false
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy && !window.actions.editing)
  assert.equal(await input.inputValue(), 'Draft kept while editing')
  assert.equal(await page.evaluate(() => window.task.queuePaused), true)
  await page.evaluate(() => window.actions.beginEdit(window.task.queue[0]))
  await page.waitForFunction(() => window.actions.editing?.text === 'Queued original')
  await input.fill('Unsaved edit')
  await page.waitForFunction(() => window.actions.editing?.text === 'Unsaved edit')
  await page.evaluate(() => window.setTask((task) => ({ ...task, queue: [] })))
  await page.waitForFunction(() => !window.actions.canSend)
  assert.equal(await input.inputValue(), 'Unsaved edit')
  await page.evaluate(() => window.actions.cancelEdit())
  await page.waitForFunction(() => !window.actions.editing)
  assert.equal(await input.inputValue(), 'Draft kept while editing')
  // Send uses the preview, persists it for retries, and clears it after acceptance.
  await page.evaluate(() => {
    window.setTask((task) => ({ ...task, status: 'review' }))
    window.fail = true
    window.finish = null
    window.actions.composerHistory.begin()
  })
  await page.waitForFunction(() => window.actions.composerHistory.active)
  assert.equal(await input.inputValue(), 'Earlier request')
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.text), 'Earlier request')
  const historyMessageId = await page.evaluate(() => window.requests.at(-1).input.messageId)
  await page.evaluate(() => {
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Earlier request')
  assert.equal(await page.evaluate(() => window.actions.composerHistory.active), false)
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.messageId), historyMessageId)
  await page.evaluate(() => {
    window.fail = false
    window.finish()
    window.finish = null
  })
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), '')
  await page.evaluate(() => {
    window.offline = true
    window.setTask((task) => ({ ...task }))
  })
  await input.fill('Keep this offline message')
  await page.waitForFunction(() => window.actions.canSend && !window.actions.connected)
  await send.click()
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.requests.at(-1).defer), true)
  assert.equal(
    await page.evaluate(() => window.requests.at(-1).input.text),
    'Keep this offline message',
  )
  await page.evaluate(() => {
    window.offline = false
    window.fail = false
    window.finish = null
    window.setTask((task) => ({ ...task }))
  })
  await input.fill('First half')
  await page.evaluate(
    () =>
      (window.actions.composerInput.current = {
        readText: async () => {
          const full = 'First half and the rest 🚀\n第二行'
          window.actions.draft.update(full, 'keyboard')
          return full
        },
      }),
  )
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(
    await page.evaluate(() => window.requests.at(-1).input.text),
    'First half and the rest 🚀\n第二行',
  )
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), '')
  // New edits after the snapshot belong to the next message.
  await input.fill('Next request')
  await page.evaluate(() => {
    window.finish = null
    window.actions.composerInput.current = { readText: async () => 'Next request' }
  })
  await send.click()
  await page.waitForFunction(() => window.finish !== null)
  await page.evaluate(() => window.actions.draft.update('Keep this newer draft', 'keyboard'))
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  assert.equal(await input.inputValue(), 'Keep this newer draft')
  const beforeReadFailure = await page.evaluate(() => window.requests.length)
  await page.evaluate(
    () =>
      (window.actions.composerInput.current = {
        readText: async () => {
          throw Error('Snapshot unavailable')
        },
      }),
  )
  await send.click()
  await page.getByRole('status').filter({ hasText: 'Snapshot unavailable' }).waitFor()
  assert.equal(await page.evaluate(() => window.requests.length), beforeReadFailure)
  assert.equal(await input.inputValue(), 'Keep this newer draft')
  // The action semaphore rejects a second tap while the native read is pending.
  await page.evaluate(() => {
    window.finish = null
    window.readCount = 0
    window.actions.composerInput.current = {
      readText: () =>
        new Promise((resolve) => {
          window.readCount++
          window.finishRead = resolve
        }),
    }
    void window.actions.run(() => window.actions.submit())
    void window.actions.run(() => window.actions.submit())
  })
  await page.waitForFunction(() => window.readCount === 1)
  await page.evaluate(() => window.finishRead('Keep this newer draft'))
  await page.waitForFunction(() => window.finish !== null)
  assert.equal(await page.evaluate(() => window.requests.length), beforeReadFailure + 1)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => !window.actions.busy)
  // Slow React work so native reads cannot rely on navigation committing in the next tick.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  // Scope changes during a native read must not send either thread's draft.
  await input.fill('Do not send after switching')
  await page.evaluate(() => {
    window.finish = null
    window.finishRead = null
    window.actions.composerInput.current = {
      readText: () => new Promise((resolve) => (window.finishRead = resolve)),
    }
    void window.actions.run(() => window.actions.submit())
  })
  await page.waitForFunction(() => window.actions.busy && typeof window.finishRead === 'function')
  await page.evaluate(() => {
    window.draftScope = 'computer:other-thread'
    window.setTask((task) => ({ ...task }))
  })
  await page.waitForFunction(() => window.actions.draft.key === 'computer:other-thread')
  await page.evaluate(() => window.finishRead('Do not send after switching'))
  await page.getByRole('status').filter({ hasText: 'thread changed before sending' }).waitFor()
  assert.equal(await page.evaluate(() => window.requests.length), beforeReadFailure + 1)
  assert.equal(await input.inputValue(), 'Do not send after switching')
  // Exercise the real native adapter and its asynchronous draft-identity fence.
  const nativePage = await browser.newPage()
  nativePage.on('pageerror', (error) => errors.push(error.message))
  await nativePage.setContent('<div id="app"></div>')
  await nativePage.evaluate(() => (window.nativeComposer = true))
  await nativePage.addScriptTag({ content: built.outputFiles[0].text })
  const nativeInput = nativePage.getByRole('textbox', { name: 'Message' })
  const nativeSend = nativePage.getByRole('button', { name: 'Send', exact: true })
  await nativeInput.fill('Keep my draft when history is cancelled')
  await nativePage.evaluate(() => window.actions.composerHistory.begin())
  await nativePage.waitForFunction(() => window.actions.composerHistory.active)
  await nativePage.evaluate(() => window.actions.composerHistory.cancel())
  assert.equal(await nativeInput.inputValue(), 'Keep my draft when history is cancelled')
  await nativePage.evaluate(() => {
    window.actions.composerHistory.begin()
    window.holdNativeRead = true
  })
  await nativePage.waitForFunction(() => window.actions.composerHistory.active)
  await nativeSend.click()
  await nativePage.waitForFunction(
    () => window.actions.busy && typeof window.finishNativeRead === 'function',
  )
  assert.equal(
    await nativeInput.inputValue(),
    'Earlier request',
    'Acquiring the send lock must keep the recalled native draft until its snapshot is read',
  )
  await nativePage.evaluate(() => window.finishNativeRead())
  await nativePage.waitForFunction(() => window.finish !== null || !!window.actions.error)
  assert.equal(await nativePage.evaluate(() => window.actions.error), '')
  assert.equal(
    await nativePage.evaluate(() => window.requests.at(-1).input.text),
    'Earlier request',
  )
  const nativeMessageId = await nativePage.evaluate(() => window.requests.at(-1).input.messageId)
  await nativePage.evaluate(() => window.finish())
  await nativePage.waitForFunction(() => !window.actions.busy)
  assert.equal(await nativeInput.inputValue(), 'Earlier request', 'Failed sends keep recalled text')
  await nativePage.evaluate(() => {
    window.finish = null
    window.holdNativeRead = false
    window.fail = false
  })
  await nativeSend.click()
  await nativePage.waitForFunction(() => window.finish !== null)
  assert.equal(
    await nativePage.evaluate(() => window.requests.at(-1).input.messageId),
    nativeMessageId,
    'Retry the same message after a failed recalled send',
  )
  await nativePage.evaluate(() => window.finish())
  await nativePage.waitForFunction(() => !window.actions.busy)
  assert.equal(await nativeInput.inputValue(), '')
  await nativePage.evaluate(() => {
    window.finish = null
    window.actions.composerHistory.begin()
  })
  await nativePage.waitForFunction(() => window.actions.composerHistory.active)
  await nativeInput.fill('Edited recalled request')
  assert.equal(await nativePage.evaluate(() => window.actions.composerHistory.active), false)
  await nativeSend.click()
  await nativePage.waitForFunction(() => window.finish !== null)
  assert.equal(
    await nativePage.evaluate(() => window.requests.at(-1).input.text),
    'Edited recalled request',
  )
  await nativePage.evaluate(() => window.finish())
  await nativePage.waitForFunction(() => !window.actions.busy)
  assert.equal(await nativeInput.inputValue(), '')
  // Late older pages must not replace the text selected for sending.
  await nativePage.evaluate(() => {
    window.historyPage = async ({ before }) =>
      before
        ? new Promise(
            (resolve) =>
              (window.finishOlder = () =>
                resolve({
                  messages: [{ role: 'user', text: 'Late older message' }],
                  turns: [],
                  historyRevision: 0,
                })),
          )
        : {
            messages: Array.from({ length: 50 }, (_, i) => ({ role: 'user', text: 'Paged ' + i })),
            turns: [],
            before: 'older',
            historyRevision: 0,
          }
    window.actions.composerHistory.begin()
  })
  await nativePage.waitForFunction(() => window.actions.composerHistory.active)
  for (let i = 0; i < 49; i++)
    await nativePage.evaluate(() => window.actions.composerHistory.older())
  assert.equal(await nativeInput.inputValue(), 'Paged 0')
  await nativePage.evaluate(() => window.actions.composerHistory.older())
  await nativePage.waitForFunction(
    () => window.actions.composerHistory.loading && !!window.finishOlder,
  )
  await nativePage.evaluate(() => {
    window.holdNativeRead = true
    window.finishNativeRead = null
    window.finish = null
  })
  await nativeSend.click()
  await nativePage.waitForFunction(() => window.actions.busy && !!window.finishNativeRead)
  await nativePage.evaluate(() => window.finishOlder())
  await nativePage.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await nativeInput.inputValue(),
    'Paged 0',
    'Send cancels pending older-page navigation',
  )
  await nativePage.evaluate(() => window.finishNativeRead())
  await nativePage.waitForFunction(() => window.finish !== null || !!window.actions.error)
  assert.equal(await nativePage.evaluate(() => window.actions.error), '')
  assert.equal(await nativePage.evaluate(() => window.requests.at(-1).input.text), 'Paged 0')
  await nativePage.evaluate(() => window.finish())
  await nativePage.waitForFunction(() => !window.actions.busy)
  assert.equal(await nativeInput.inputValue(), '')
  // A real draft replacement must still reject the native snapshot.
  await nativeInput.fill('Before a real draft change')
  const beforeNativeChange = await nativePage.evaluate(() => window.requests.length)
  await nativePage.evaluate(() => {
    window.holdNativeRead = true
    window.finishNativeRead = null
  })
  await nativeSend.click()
  await nativePage.waitForFunction(() => typeof window.finishNativeRead === 'function')
  await nativePage.evaluate(() => window.actions.draft.update('Keep the replacement draft'))
  await nativePage.waitForFunction(
    () => window.nativeProps.content.text === 'Keep the replacement draft',
  )
  await nativePage.evaluate(() => window.finishNativeRead())
  await nativePage
    .getByRole('status')
    .filter({ hasText: 'message changed before sending' })
    .waitFor()
  assert.equal(await nativePage.evaluate(() => window.requests.length), beforeNativeChange)
  assert.equal(await nativeInput.inputValue(), 'Keep the replacement draft')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile settled-thread submission: drafting, recalled native sends, edited recall, stable retries, native revision guards, attachment-only input and archived-thread guard passed.',
  )
} finally {
  await browser.close()
}
