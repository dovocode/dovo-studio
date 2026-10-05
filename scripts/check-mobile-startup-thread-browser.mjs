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
  '../../ui/theme': `export const styles={};`,
  '../draft/use-draft': `export const saveRuntimeDraft=async(...args)=>{window.savedDraft=args};`,
  './folder-picker': `export const FolderPicker=()=>null;`,
  '../conversation/state/provider': `export const ConversationProvider=({children})=>children;`,
  '../composer/composer': `import {useState} from 'react';import {Effect,Schema} from 'effect';import {runClientEffect} from '@dovo/client-runtime';import {useRuntime} from '../../runtime/connection/provider';export const Composer=({task,onSelectRemote})=>{const runtime=useRuntime();const [text,setText]=useState(task.draft);window.task=task;window.runtimeId=runtime.activeId;const request=(path,input,method)=>runClientEffect(runtime.callEffect(path,input,Schema.Unknown,method)).catch(e=>window.failure=String(e));return <><input aria-label="Message" value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>request('/api/workspace',{collection:'tasks',id:task.id,changes:{execution:{before:task.execution,after:'worktree'},setupCommand:{before:task.setupCommand,after:'pnpm install'}}},'PATCH')}>Settings</button><button onClick={()=>request('/api/tasks/message',{id:task.id,text})}>Send</button><button onClick={()=>request('/api/attachments/upload',{taskId:task.id})}>Attach</button><button onClick={()=>onSelectRemote('b',{id:'remote',kind:'folder',name:'Remote',path:'/remote',branch:''},text)}>Remote</button></>};`,
}
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {RuntimeContext} from '../../runtime/connection/provider';import {StartupThread} from './src/tasks/creation/startup-thread';window.requests=[];window.commits=[];window.failure='';window.failCreate=false;function App(){const [version,setVersion]=useState(0);const overviews=['a','b'].map(id=>({profile:{id,name:id,connection:{address:'http://'+id}},connected:true,snapshot:{workspace:{tasks:[],agents:[],repositories:[{id:'chat-'+id,kind:'scratch',name:'Chat',path:'/scratch',branch:''}]}}}));return <RuntimeContext.Provider value={{activeId:'a',overviews,request:(runtimeId,path,input)=>Effect.tryPromise({try:async()=>{window.requests.push({runtimeId,path,input});if(path==='/api/workspace'&&window.holdCreate)await new Promise(resolve=>window.releaseCreate=resolve);if(path==='/api/workspace'&&window.failCreate){window.failCreate=false;throw Error('Creation failed')}return {revision:1,ok:true}},catch:e=>e})}}><button onClick={()=>setVersion(v=>v+1)}>New thread</button><StartupThread key={version} onBrowse={()=>window.browsed=true} onCommit={(runtimeId,id)=>window.commits.push({runtimeId,id})}/></RuntimeContext.Provider>};createRoot(document.getElementById('app')).render(<App/>);`,
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('What would you like to work on?').waitFor()
  const original = await page.evaluate(() => window.task.id)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForFunction(() => window.task.setupCommand === 'pnpm install')
  await page.getByLabel('Message').fill('Hello')
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => window.commits.length === 1)
  const requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/workspace', '/api/tasks/message'],
  )
  assert.equal(requests[0].input.create.setupCommand, 'pnpm install')
  assert.equal(requests[0].input.create.execution, 'worktree')
  assert.equal(requests[1].input.text, 'Hello')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 3)
  assert.equal(await page.evaluate(() => window.commits.length), 1)
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  await page.waitForFunction((id) => window.task.id !== id, original)
  assert.equal(await page.getByLabel('Message').inputValue(), '')
  await page.evaluate(() => {
    window.requests = []
    window.commits = []
  })
  await page.getByLabel('Message').fill('Remote draft')
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.waitForFunction(() => window.runtimeId === 'b')
  assert.equal(await page.getByLabel('Message').inputValue(), 'Remote draft')
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  assert.equal(await page.evaluate(() => window.task.repositoryId), 'remote')
  await page.evaluate(() => {
    window.failCreate = true
  })
  await page.getByRole('button', { name: 'Attach', exact: true }).click()
  await page.waitForFunction(() => window.failure.includes('Creation failed'))
  assert.equal(await page.evaluate(() => window.commits.length), 0)
  await page.getByRole('button', { name: 'Attach', exact: true }).click()
  await page.waitForFunction(() => window.commits.length === 1)
  assert.deepEqual(await page.evaluate(() => window.requests.map((r) => [r.runtimeId, r.path])), [
    ['b', '/api/workspace'],
    ['b', '/api/workspace'],
    ['b', '/api/attachments/upload'],
  ])
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  await page.evaluate(() => {
    window.holdCreate = true
    window.commits = []
    window.requests = []
  })
  await page.getByLabel('Message').fill('Background send')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  const fresh = await page.evaluate(() => window.task.id)
  await page.evaluate(() => {
    window.holdCreate = false
    window.releaseCreate()
  })
  await page.waitForFunction(() => window.requests.length === 2)
  assert.equal(await page.evaluate(() => window.task.id), fresh)
  assert.equal(await page.evaluate(() => window.commits.length), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile startup composer: temporary settings, first send, fresh threads, remote drafts, attachments and creation retry passed.',
  )
} finally {
  await browser.close()
}
