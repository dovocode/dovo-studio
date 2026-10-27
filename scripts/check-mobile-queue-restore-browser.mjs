import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const actions = root + 'apps/mobile/src/tasks/conversation/state/'
const draft = root + 'apps/mobile/src/tasks/draft/'
const runtime = `import {useSyncExternalStore} from 'react';const listeners=new Set();window.host={connected:true,id:'computer-a',token:'original-token',supported:true};window.switchHost=next=>{window.host={...window.host,...next};listeners.forEach(fn=>fn())};export function useRuntime(){const host=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>window.host);return {connected:host.connected,activeId:host.id,profile:{connection:{address:'http://'+host.id+'.lan',token:host.token}},snapshot:{queueRestoreReceiptsSupported:host.supported,permissionPolicySupported:true,workspace:{agents:[{id:'agent',name:'Agent',provider:'codex',model:'model',permission:'ask',instructions:'',args:[],endpoint:''}]}},pendingMessages:()=>[],call:()=>{},readEffect:window.request,callEffect:window.request}}`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {useConversationActions} from './apps/mobile/src/tasks/conversation/state/use-actions';
window.requests=[];window.receipts=new Map();window.mode='hold';
window.request=(path,input)=>Effect.tryPromise({try:async()=>{
 if(path!='/api/tasks/queue')return {revision:1};
 const host=window.host.id;window.requests.push({host,input});
 if(window.mode==='hold')await new Promise((resolve,reject)=>{window.finish=resolve;window.reject=()=>reject(new Error('Connection lost before commit'))});
 const receipt=host+':'+input.restoreRequestId;
 if(!window.receipts.has(receipt)){
   if(window.mode==='conflict')throw new Error('The queued message changed. Refresh it before restoring');
   window.receipts.set(receipt,true);window.commitCount=(window.commitCount||0)+1;
   window.setTask(task=>({...task,queue:[],draft:'Queued text'}));
 }
 if(window.mode==='lost')throw new Error('Response lost after commit');
 return {ok:true}
},catch:error=>error});
function Thread(){const[task,setTask]=useState({id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'draft',draft:'',messages:[],files:[],example:false,queue:[{id:'queued',role:'user',text:'Queued text'}]});window.setTask=setTask;const actions=useConversationActions(task);window.actions=actions;return <><textarea aria-label="Draft" value={actions.draft.text} onChange={e=>actions.draft.update(e.target.value,'keyboard')}/><button onClick={()=>actions.restoreQueuedMessage(task.queue[0])}>Restore</button><button onClick={actions.retryRestore}>Retry</button><p role="status">{actions.error}</p><p data-pending>{actions.pendingRestore?.requestId}</p></>}
function App(){const[key,setKey]=useState(0);window.remount=()=>setKey(key=>key+1);return <Thread key={key}/>}
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
        'export const Alert={alert(){}};export const Keyboard={dismiss(){}};export const AppState={addEventListener(){return {remove(){}}}};',
    },
    {
      path: 'expo-crypto',
      contents:
        'export const randomUUID=()=>crypto.randomUUID();export const CryptoDigestAlgorithm={SHA256:"SHA-256"};export async function digestStringAsync(algorithm,text){return Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,"0")).join("")}',
    },
    {
      path: '@react-native-async-storage/async-storage',
      contents:
        'export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>{if(window.failDisk)throw new Error("Disk unavailable");localStorage.setItem(key,value)},removeItem:async key=>localStorage.removeItem(key)}',
    },
    {
      path: '../../../runtime/state/application-state',
      importer: actions,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../runtime/state/application-state',
      importer: draft,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    { path: 'test-runtime', contents: runtime },
    {
      path: '../../../runtime/connection/provider',
      importer: actions,
      contents: 'export {useRuntime} from "test-runtime"',
    },
    {
      path: '../../runtime/connection/provider',
      importer: draft,
      contents: 'export {useRuntime} from "test-runtime"',
    },
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: actions,
      contents: 'export const readMobilePreferences=()=>({confirmStop:false});',
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
  await page.route('http://fixture.local/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  // localhost supplies browser crypto's secure context without using any system browser.
  await page.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://localhost/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Draft' })
  await page.waitForFunction(() => window.actions.draft.ready)
  await input.fill('Existing draft')
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.waitForFunction(() => window.finish)
  const operation = await page.evaluate(() => window.requests[0].input.restoreRequestId)
  const durable = await page.evaluate(() => localStorage.getItem('dovo.draft.computer-a.task'))
  assert.ok(durable.includes(operation), 'intent must be durable before request')
  await input.fill('New typing')
  await page.evaluate(() => {
    window.mode = 'lost'
    window.finish()
  })
  await page.waitForFunction(
    () => !window.actions.busy && window.actions.error.includes('Response lost'),
  )
  assert.equal(await input.inputValue(), 'New typing')
  await page.evaluate(() => {
    window.mode = 'success'
    window.remount()
  })
  await page.waitForFunction(
    () => window.actions.draft.ready && !window.actions.pendingRestore && !window.actions.busy,
  )
  assert.equal(await input.inputValue(), 'New typing\n\nQueued text')
  assert.equal(await page.evaluate(() => window.commitCount), 1)
  assert.equal(await page.evaluate(() => window.requests.at(-1).input.restoreRequestId), operation)
  await page.evaluate(() => window.remount())
  await page.waitForFunction(() => window.actions.draft.ready)
  assert.equal(await input.inputValue(), 'New typing\n\nQueued text')
  // Pre-commit failure stays pending and refuses a replaced connection or another computer.
  await page.evaluate(() => {
    window.mode = 'hold'
    window.setTask((task) => ({
      ...task,
      queue: [{ id: 'queued-two', role: 'user', text: 'Second queued' }],
    }))
  })
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.waitForFunction(
    () => window.actions.busy && window.requests.at(-1).input.messageId === 'queued-two',
  )
  await page.evaluate(() => window.reject())
  await page.waitForFunction(() => !window.actions.busy)
  const before = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => {
    window.mode = 'success'
    window.switchHost({ token: 'replacement-token' })
  })
  await page.waitForFunction(() => window.actions.error.includes('original computer connection'))
  assert.equal(await page.evaluate(() => window.requests.length), before)
  await page.evaluate(() => window.switchHost({ id: 'computer-b' }))
  await page.waitForFunction(
    () => window.actions.draft.ready && window.actions.draft.key.includes('computer-b'),
  )
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.actions.pendingRestore), undefined)
  await page.evaluate(() => window.switchHost({ id: 'computer-a', token: 'original-token' }))
  await page.waitForFunction(
    () => window.actions.draft.ready && !window.actions.busy && !window.actions.pendingRestore,
  )
  assert.equal(await input.inputValue(), 'New typing\n\nQueued text\n\nSecond queued')
  assert.equal(await page.evaluate(() => window.requests.at(-1).host), 'computer-a')
  // A failed local stage must not issue a request, and keeps a visible retry intent.
  await page.evaluate(() => {
    window.failDisk = true
    window.setTask((task) => ({
      ...task,
      queue: [{ id: 'disk', role: 'user', text: 'Disk recovery' }],
    }))
  })
  const beforeDisk = await page.evaluate(() => window.requests.length)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.waitForFunction(
    () => !window.actions.busy && window.actions.error.includes('Disk unavailable'),
  )
  assert.ok(await page.evaluate(() => window.actions.pendingRestore))
  assert.equal(await page.evaluate(() => window.requests.length), beforeDisk)
  await page.evaluate(() => {
    window.failDisk = false
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.waitForFunction(() => !window.actions.busy && !window.actions.pendingRestore)
  assert.equal(
    await input.inputValue(),
    'New typing\n\nQueued text\n\nSecond queued\n\nDisk recovery',
  )
  // Older runtimes fail closed before sending an unsupported restore operation.
  await page.evaluate(() => {
    window.switchHost({ supported: false })
    window.setTask((task) => ({
      ...task,
      queue: [{ id: 'old', role: 'user', text: 'Unsupported' }],
    }))
  })
  const requests = await page.evaluate(() => window.requests.length)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.waitForFunction(() => window.actions.error.includes('Update this computer'))
  assert.equal(await page.evaluate(() => window.requests.length), requests)
  console.log(
    'Mobile queue restore checks passed: durable intent, lost response, remount, exactly once, newer typing, original computer, replaced credentials and old runtimes',
  )
} finally {
  await browser.close()
}
