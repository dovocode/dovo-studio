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
function App(){const[task,setTask]=useState({id:'settled',title:'Settled',repositoryId:'repo',agentId:'agent',status:'review',archived:true,draft:'',messages:[{id:'previous',role:'user',text:'Earlier request'}],turns:[],files:[],example:false});const actions=useConversationActions(task);window.task=task;window.setTask=setTask;window.actions=actions;return <><textarea aria-label="Message" value={actions.draft.text} disabled={!!task.archivedAt||actions.busy} onChange={event=>actions.draft.update(event.target.value,'keyboard')}/><button disabled={!actions.canSend} onClick={()=>actions.run(()=>actions.submit())}>Send</button><p role="status">{actions.error}</p></>}
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
    { path: 'expo-crypto', contents: 'let id=0;export const randomUUID=()=>"submission-"+(++id);' },
    {
      path: '../../../runtime/state/application-state',
      importer: actions,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../../runtime/connection/provider',
      importer: actions,
      contents: `export const useRuntime=()=>({connected:true,activeId:'computer',profile:{connection:{address:'http://computer.lan',token:'device-token'}},snapshot:{queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,permissionPolicySupported:true,workspace:{agents:[{id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],call:()=>{},readEffect:window.request,callEffect:window.request});`,
    },
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: actions,
      contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
    },
    {
      path: '../../draft/use-draft',
      importer: actions,
      contents: `import {useState} from 'react';import {Effect} from 'effect';export const useDraft=()=>{const[text,setText]=useState('');return {text,ready:true,revision:text,update:setText,stageEffect:()=>Effect.void,confirmEffect:(_attempt,clear)=>Effect.sync(()=>{if(clear)setText('')})}};`,
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
  const send = page.getByRole('button', { name: 'Send', exact: true })
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

  await input.fill('Draft kept while editing')
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      archived: false,
      queuePaused: true,
      queue: [{ id: 'edit-me', role: 'user', text: 'Queued original' }],
    })),
  )
  await page.evaluate(() => window.actions.beginEdit(window.task.queue[0]))
  assert.equal(await input.inputValue(), 'Queued original')
  await input.fill('Queued edit')
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
  assert.equal(await page.evaluate(() => window.requests.length), beforeSettings)
  await page.evaluate(() =>
    window.uploadEdit({
      id: '10000000-0000-0000-0000-000000000000',
      name: 'edit.txt',
      size: 2,
      mime: 'text/plain',
    }),
  )
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
  assert.equal(await input.inputValue(), 'Draft kept while editing')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile settled-thread submission: drafting, rejected send, stable retries, attachment-only input and archived-thread guard passed.',
  )
} finally {
  await browser.close()
}
