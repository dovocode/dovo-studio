import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const runtimeMock = `import {createContext,useContext} from 'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);export const RuntimeScope=({runtimeId,children})=>{const root=useRuntime();const entry=root.overviews.find(e=>e.profile.id===runtimeId);return <RuntimeContext.Provider value={{...root,activeId:runtimeId,profile:entry.profile,snapshot:entry.snapshot,connected:entry.connected,readEffect:(...args)=>root.request(runtimeId,...args),callEffect:(...args)=>root.request(runtimeId,...args)}}>{children}</RuntimeContext.Provider>};`
const mocks = {
  '../../runtime/connection/provider': runtimeMock,
  '../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  'react-native': `export const View=({children})=><div>{children}</div>;`,
  'expo-crypto': `let id=0;export const randomUUID=()=> 'thread-'+(++id);`,
  '../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../ui/controls/action': `export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;`,
  '../../ui/theme': `export const useTheme=()=>({styles:{}});`,
  '../draft/use-draft': `export const saveRuntimeDraft=async(...args)=>{window.savedDraft=args};`,
  './folder-picker': `export const FolderPicker=()=>null;`,
  '../detail/task-detail': `import {Composer} from '../composer/composer';import {ConversationProvider} from '../conversation/state/provider';export const TaskDetail=({task,startup})=><ConversationProvider><span>What would you like to work on?</span><Composer task={task} onSelectRemote={startup.temporary?startup.onSelectRemote:undefined}/></ConversationProvider>;`,
  '../conversation/state/provider': `export const ConversationProvider=({children})=>children;`,
  '../composer/composer': `import {useState} from 'react';import {Schema} from 'effect';import {runClientEffect} from '@dovo/client-runtime';import {useRuntime} from '../../runtime/connection/provider';export const Composer=({task})=>{const runtime=useRuntime();const [text,setText]=useState(task.draft);window.task=task;const request=(path,input,method,options)=>runClientEffect(runtime.callEffect(path,input,Schema.Unknown,method,options)).then(()=>{window.failure=''},e=>{window.failure=String(e)});const message=()=>({id:task.id,messageId:'message-'+task.id,text,initialTitle:{before:task.title,after:text}});return <><input aria-label="Message" value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>request('/api/workspace',{collection:'tasks',id:task.id,changes:{execution:{before:task.execution,after:'worktree'},setupCommand:{before:task.setupCommand,after:'pnpm install'},draft:{before:task.draft,after:text}}},'PATCH')}>Settings</button><button onClick={()=>request('/api/tasks/message',message())}>Send</button><button onClick={()=>request('/api/tasks/message',message(),'POST',{defer:true})}>Queue</button><button onClick={()=>request('/api/attachments/upload',{taskId:task.id})}>Attach</button></>};`,
}
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {RuntimeContext} from '../../runtime/connection/provider';import {StartupThread} from './src/tasks/creation/startup-thread';window.requests=[];window.commits=[];window.failure='';window.failMessage=false;window.holdMessage=false;function App(){const [version,setVersion]=useState(0);const overviews=['a'].map(id=>({profile:{id,name:id,connection:{address:'http://'+id}},connected:true,snapshot:{messageSetupSupported:true,threadStartSupported:window.legacy?undefined:true,workspace:{tasks:[],agents:[],repositories:[{id:'chat-'+id,kind:'scratch',name:'Chat',path:'/scratch',branch:''}]}}}));return <RuntimeContext.Provider value={{activeId:'a',overviews,request:(runtimeId,path,input,schema,method,options)=>Effect.tryPromise({try:async()=>{window.requests.push({path,input:JSON.parse(JSON.stringify(input)),defer:!!options?.defer});if(path==='/api/tasks/message'&&window.holdMessage)await new Promise(resolve=>window.releaseMessage=resolve);if(path==='/api/tasks/message'&&window.failMessage){window.failMessage=false;throw Error('Message failed')}return options?.defer?{ok:true,pending:true}:{revision:1,ok:true}},catch:e=>e})}}><button onClick={()=>setVersion(v=>v+1)}>New thread</button><StartupThread key={version} taskId={'thread-'+version} runtimeId="a" onNewThread={()=>setVersion(v=>v+1)} onBrowse={()=>{}} onCommit={(runtimeId,id)=>window.commits.push(id)}/></RuntimeContext.Provider>};createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: new URL('../apps/mobile/', import.meta.url).pathname,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: new URL('../apps/mobile/', import.meta.url).pathname,
        }))
      },
    },
  ],
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
  page.on('pageerror', (e) => errors.push(e.message))
  const load = async (legacy = false) => {
    await page.setContent('<div id="app"></div>')
    await page.evaluate((value) => {
      window.legacy = value
    }, legacy)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('What would you like to work on?').waitFor()
  }
  const click = (name) => page.getByRole('button', { name, exact: true }).click()
  const reset = () =>
    page.evaluate(() => {
      window.requests = []
      window.commits = []
    })
  const fresh = async () => {
    const previous = await page.evaluate(() => window.task.id)
    await click('New thread')
    await page.waitForFunction((id) => window.task.id !== id, previous)
    await reset()
    return page.evaluate(() => window.task.id)
  }
  await load()
  // Settings and typing stay local; one request creates the thread with its first message.
  const first = await page.evaluate(() => window.task.id)
  await page.getByLabel('Message').fill('Hello')
  await click('Settings')
  await page.waitForFunction(() => window.task.setupCommand === 'pnpm install')
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  await click('Send')
  await page.waitForFunction((id) => window.commits.includes(id), first)
  let requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/tasks/message'],
  )
  assert.equal(requests[0].input.createTask.id, first)
  assert.equal(requests[0].input.createTask.setupCommand, 'pnpm install')
  assert.equal(requests[0].input.createTask.execution, 'worktree')
  assert.equal(requests[0].input.createTask.draft, '')
  assert.equal(requests[0].input.text, 'Hello')
  // Later messages use the created thread.
  await click('Send')
  await page.waitForFunction(() => window.requests.length === 2)
  assert.equal(await page.evaluate(() => window.requests[1].input.createTask), undefined)

  // A failed start stays temporary; its retry repeats the same message and draft.
  const failed = await fresh()
  await page.getByLabel('Message').fill('Retry me')
  await page.evaluate(() => {
    window.failMessage = true
  })
  await click('Send')
  await page.waitForFunction(() => window.failure.includes('Message failed'))
  assert.deepEqual(await page.evaluate(() => window.commits), [])
  await click('Send')
  await page.waitForFunction((id) => window.commits.includes(id), failed)
  requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/tasks/message', '/api/tasks/message'],
  )
  assert.equal(requests[1].input.messageId, requests[0].input.messageId)
  assert.deepEqual(requests[1].input.createTask, requests[0].input.createTask)

  // A deferred send commits after durable local admission, without waiting for the network.
  const deferred = await fresh()
  await page.getByLabel('Message').fill('Queued start')
  await click('Queue')
  await page.waitForFunction((id) => window.commits.includes(id), deferred)
  requests = await page.evaluate(() => window.requests)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].defer, true)
  assert.equal(requests[0].input.createTask.id, deferred)

  // Attachments still need the thread first; the later message does not create it again.
  const attached = await fresh()
  await click('Attach')
  await page.waitForFunction((id) => window.commits.includes(id), attached)
  await page.getByLabel('Message').fill('With files')
  await click('Send')
  await page.waitForFunction(() => window.requests.length === 3)
  requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/workspace', '/api/attachments/upload', '/api/tasks/message'],
  )
  assert.equal(requests[0].input.create.id, attached)
  assert.equal(requests[2].input.createTask, undefined)

  // An attachment during an in-flight start waits instead of creating the thread twice.
  await fresh()
  await page.getByLabel('Message').fill('Hold')
  await page.evaluate(() => {
    window.holdMessage = true
  })
  await click('Send')
  await page.waitForFunction(() => !!window.releaseMessage)
  await click('Attach')
  await page.evaluate(() => {
    window.holdMessage = false
    window.releaseMessage()
  })
  await page.waitForFunction(() => window.requests.length === 2)
  assert.deepEqual(await page.evaluate(() => window.requests.map((r) => r.path)), [
    '/api/tasks/message',
    '/api/attachments/upload',
  ])

  // Older runtimes create the thread separately before its first message.
  await load(true)
  await reset()
  await page.getByLabel('Message').fill('Legacy')
  await click('Send')
  await page.waitForFunction(() => window.commits.length === 1)
  requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/workspace', '/api/tasks/message'],
  )
  assert.equal(requests[1].input.createTask, undefined)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile thread start: local settings, one combined request, failed retry identity, deferred admission, attachment precreation, in-flight ordering and legacy fallback passed.',
  )
} finally {
  await browser.close()
}
