import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const runtime = `import {useSyncExternalStore} from 'react';import {Effect} from 'effect';const listeners=new Set();window.host={id:'computer-a',token:'original-token',connected:true};window.changeHost=next=>{window.host={...window.host,...next};listeners.forEach(fn=>fn())};export function useRuntime(){const host=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>window.host);return {connected:host.connected,activeId:host.id,profile:{connection:{address:'http://'+host.id+'.lan',token:host.token}},callEffect:(path,input)=>window.request(host,path,input)}}`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {useDraft,appendRuntimeDraft} from './apps/mobile/src/tasks/draft/use-draft';
import {useForkDraft} from './apps/mobile/src/tasks/composer/use-fork-draft';
window.requests=[];window.navigations=[];window.alerts=[];window.mode='hold';window.append=appendRuntimeDraft;
const original={id:'source-file',name:'original.txt',mime:'text/plain',size:1};
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'running',draft:'',messages:[],files:[],example:false,draftAttachments:[original]};
window.server=JSON.parse(localStorage.getItem('server')||'null')||{forks:{},tasks:{'computer-a':initial,'computer-b':{...initial,draftAttachments:[]}}};
const saveServer=()=>localStorage.setItem('server',JSON.stringify(window.server));
window.request=(owner,path,input)=>Effect.tryPromise({try:async()=>{
  const valid=()=>window.host.id===owner.id&&window.host.token===owner.token;
  if(!valid())throw new Error('Computer connection changed');
  window.requests.push({owner:owner.id,path,input});
  if(path==='/api/tasks/start-fork'){
    if(window.mode==='hold')await new Promise((resolve,reject)=>{window.finish=resolve;window.reject=()=>reject(new Error('Connection lost before commit'))});
    const key=owner.id+':'+input.forkId;
    const existing=window.server.forks[key];
    if(existing&&JSON.stringify(existing)!==JSON.stringify(input))throw new Error('different contents');
    if(!existing){window.server.forks[key]=input;saveServer()}
    if(window.mode==='lost')throw new Error('Response lost after commit');
    if(!valid())throw new Error('Computer connection changed');
    return {id:input.forkId};
  }
  if(path==='/api/workspace'){
    if(window.failCleanup)throw new Error('Cleanup unavailable');
    window.server.tasks[owner.id]={...window.server.tasks[owner.id],draftAttachments:input.changes.draftAttachments.after};saveServer();
    window.refresh();return {revision:1};
  }
  return {ok:true};
},catch:error=>error});
function Thread(){const[blocked,setBlocked]=useState(window.blocked??false);window.setBusyOperation=value=>{window.blocked=value;setBlocked(value)};const[revision,setRevision]=useState(0);const[settings,setSettings]=useState(null);window.setSettings=setSettings;window.refresh=()=>setRevision(value=>value+1);const host=window.host;const task=window.server.tasks[host.id];const draft=useDraft(task.id,task.draft);const fork=useForkDraft({task,draft,turnSettings:settings,disabled:blocked});window.draft=draft;window.fork=fork;return <><textarea aria-label="Draft" value={draft.text} onChange={e=>draft.update(e.target.value,'keyboard')}/><button onClick={fork.start}>Fork</button><button onClick={fork.retry}>Retry</button><button onClick={fork.discard}>Discard</button><p role="status">{fork.error}</p></>}
function App(){const[key,setKey]=useState(0);window.remount=()=>setKey(value=>value+1);return <Thread key={key}/>}
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
        'export const Alert={alert:(...args)=>window.alerts.push(args)};export const AppState={addEventListener(){return {remove(){}}}};',
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
      path: '../../runtime/state/application-state',
      importer: mobile,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    { path: 'test-runtime', contents: runtime },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: 'export {useRuntime} from "test-runtime"',
    },
    {
      path: '../../shell/navigation',
      importer: mobile,
      contents:
        'export const useNavigation=()=>({navigate:(...args)=>window.navigations.push(args)})',
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const mount = async () => {
    await page.goto('http://localhost/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.draft.ready)
  }
  await mount()
  const input = page.getByRole('textbox', { name: 'Draft' })
  await input.fill('  Fork this draft  ')
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.finish)
  const request = await page.evaluate(() => window.requests[0].input)
  assert.equal(request.text, 'Fork this draft')
  assert.deepEqual(request.attachmentIds, ['source-file'])
  assert.ok(
    (await page.evaluate(() => localStorage.getItem('dovo.draft.computer-a.task'))).includes(
      request.forkId,
    ),
  )
  // Browser insertions and newly uploaded files remain in the source while the request runs.
  await page.evaluate(async () => {
    await window.append('computer-a', 'task', 'Browser insertion')
    window.server.tasks['computer-a'].draftAttachments.push({
      id: 'new-file',
      name: 'later.txt',
      mime: 'text/plain',
      size: 1,
    })
    window.refresh()
    window.mode = 'lost'
    window.finish()
  })
  await page.waitForFunction(() => !window.fork.busy && window.fork.error.includes('Response lost'))
  assert.equal(await input.inputValue(), '  Fork this draft  \n\nBrowser insertion')
  assert.deepEqual(
    await page.evaluate(() =>
      window.server.tasks['computer-a'].draftAttachments.map((file) => file.id),
    ),
    ['source-file', 'new-file'],
  )
  assert.equal(await page.evaluate(() => window.navigations.length), 0)
  const beforeDeferredReplay = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => {
    window.mode = 'success'
    window.setBusyOperation(true)
    window.remount()
  })
  await page.waitForFunction(() => window.draft.ready && !!window.fork.pending)
  assert.equal(await page.evaluate(() => window.requests.length), beforeDeferredReplay)
  await page.evaluate(() => window.setBusyOperation(false))
  await page.waitForFunction(
    () => window.draft.ready && !window.fork.busy && window.navigations.length === 1,
  )
  assert.equal(await input.inputValue(), '  Fork this draft  \n\nBrowser insertion')
  assert.equal(await page.evaluate(() => Object.keys(window.server.forks).length), 1)
  assert.deepEqual(
    await page.evaluate(() =>
      window.requests.filter((r) => r.path === '/api/tasks/start-fork').map((r) => r.input),
    ),
    [request, request],
  )
  assert.deepEqual(
    await page.evaluate(() =>
      window.server.tasks['computer-a'].draftAttachments.map((file) => file.id),
    ),
    ['new-file'],
  )
  // A process restart reuses its durable identity and clears an unchanged draft once.
  await input.fill('Restart fork')
  await page.evaluate(() => {
    window.mode = 'lost'
  })
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => !window.fork.busy && window.fork.error.includes('Response lost'))
  const restartRequest = await page.evaluate(() => window.requests.at(-1).input)
  await mount()
  await page.waitForFunction(() => window.finish)
  assert.equal(await page.evaluate(() => window.requests[0].input.forkId), restartRequest.forkId)
  assert.deepEqual(await page.evaluate(() => window.requests[0].input.attachmentIds), ['new-file'])
  await page.evaluate(() => {
    window.mode = 'success'
    window.finish()
  })
  await page.waitForFunction(() => !window.fork.busy && window.navigations.length === 1)
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => Object.keys(window.server.forks).length), 2)
  // If cleanup fails after acceptance, retry never resends or clears a follow-up.
  await input.fill('Cleanup fork')
  await page.evaluate(() => {
    window.server.tasks['computer-a'].draftAttachments = [
      { id: 'cleanup-file', name: 'cleanup.txt', mime: 'text/plain', size: 1 },
    ]
    window.failCleanup = true
    window.refresh()
  })
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(
    () => !window.fork.busy && window.fork.error.includes('Cleanup unavailable'),
  )
  assert.equal(await page.evaluate(() => window.fork.pending.accepted), true)
  await input.fill('Cleanup fork')
  const beforeCleanup = await page.evaluate(
    () => window.requests.filter((r) => r.path === '/api/tasks/start-fork').length,
  )
  await page.evaluate(() => {
    window.failCleanup = false
    window.remount()
  })
  await page.waitForFunction(() => window.draft.ready && !window.fork.busy && !window.fork.pending)
  assert.equal(await input.inputValue(), 'Cleanup fork')
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((r) => r.path === '/api/tasks/start-fork').length,
    ),
    beforeCleanup,
  )
  // A precommit failure keeps the original payload on its owner through connection changes.
  await input.fill('Connection fork')
  await page.evaluate(() => {
    window.mode = 'hold'
    window.finish = null
  })
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.finish)
  await page.evaluate(() => window.reject())
  await page.waitForFunction(() => !window.fork.busy)
  const beforeOwner = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => {
    window.mode = 'success'
    window.changeHost({ token: 'replacement-token' })
  })
  await page.waitForFunction(() => window.fork.error.includes('original computer connection'))
  assert.equal(await page.evaluate(() => window.requests.length), beforeOwner)
  await page.evaluate(() => window.changeHost({ id: 'computer-b' }))
  await page.waitForFunction(() => window.draft.ready && window.draft.key.includes('computer-b'))
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.fork.pending), undefined)
  await page.evaluate(() => window.changeHost({ id: 'computer-a', token: 'original-token' }))
  await page.waitForFunction(() => window.draft.ready && !window.fork.busy && !window.fork.pending)
  assert.equal(await input.inputValue(), '')
  // Discarding an uncertain request keeps text and never issues a new fork.
  await input.fill('Discard this fork')
  await page.evaluate(() => {
    window.mode = 'hold'
    window.finish = null
  })
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.finish)
  await page.evaluate(() => window.reject())
  await page.waitForFunction(() => !window.fork.busy)
  const beforeDiscard = await page.evaluate(() => window.requests.length)
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.evaluate(() =>
    window.alerts
      .at(-1)[2]
      .find((button) => button.style === 'destructive')
      .onPress(),
  )
  await page.waitForFunction(() => !window.fork.busy && !window.fork.pending)
  assert.equal(await input.inputValue(), 'Discard this fork')
  assert.equal(await page.evaluate(() => window.requests.length), beforeDiscard)
  // One-turn overrides cannot be silently dropped by the source-harness-only fork API.
  await input.fill('Keep override')
  await page.evaluate(() =>
    window.setSettings({ provider: 'codex', model: 'one-turn', reasoning: '' }),
  )
  const beforeOverride = await page.evaluate(() => window.requests.length)
  await page.getByRole('button', { name: 'Fork', exact: true }).click()
  assert.equal(await page.evaluate(() => window.requests.length), beforeOverride)
  assert.equal(await input.inputValue(), 'Keep override')
  console.log(
    'Mobile fork checks passed: durable identity, lost responses, remount/restart, newest text and files, cleanup recovery, original computer and source-harness semantics',
  )
} finally {
  await browser.close()
}
