import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';
import {decode,runtimeProfile,snapshotSchema,responses} from '@dovo/protocol';
import {WorkspaceProvider,useWorkspace} from './packages/studio-core/src/workspace/provider';
import {useWorkspaceSelector,sameWorkspaceFields} from './packages/studio-core/src/workspace/selector';
import {selectConversationConnection} from './packages/extension-tasks/src/chat/thread/workspace-selection';
import {TaskMessageResponse} from './packages/extension-tasks/src/chat/thread/task-message-response';
import {StudioHostProvider} from './packages/studio-core/src/host-context';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state';
const localMode=new URL(location.href).searchParams.has('local');
const cancelMode=new URL(location.href).searchParams.has('cancel');
window.holdFallback=cancelMode;window.fallbackSignals=[];window.cancelledFallbacks=0;
window.profiles=Array.from({length:5},(_,i)=>runtimeProfile({address:localMode&&i===0?'http://127.0.0.1:4300':'http://host'+i+'.lan:8787',token:'paired-host-token-for-startup-'+i},'Computer '+i));
const registry={version:1,activeId:window.profiles[0].id,profiles:window.profiles};
localStorage.setItem('dovo.runtimes.v1',JSON.stringify(registry));
window.snapshot=decode(snapshotSchema,{revision:1,owner:false,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[],tasks:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
window.inactiveStarted=0;window.selectedReads=0;window.transportRenders=0;window.responseRenders=0;
window.inactiveWait=new Promise(resolve=>window.releaseInactive=resolve);
window.currentLocalWait=new Promise(resolve=>window.releaseCurrentLocal=resolve);
window.dovo={runtimeConnection:()=>new Promise(resolve=>window.releaseLocal=resolve)};
window.fetch=async(url,options)=>{
  const parsed=new URL(url);const path=parsed.pathname;
  if(parsed.port==='4300')throw Error('Previous local port is unavailable');
  if(localMode&&parsed.port==='4310'){window.currentLocalStarted=true;await window.currentLocalWait}
  if(path==='/api/snapshot'){
    if(cancelMode)window.fallbackSignals.push(options?.signal);
    if(window.holdFallback&&window.syncOptions?.[parsed.origin]){
      window.heldFallbackSignal=options.signal;
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{window.cancelledFallbacks++;reject(new DOMException('Aborted','AbortError'))},{once:true}));
    }
    return Response.json(window.snapshot);
  }
  if(path==='/api/mutations/status')return Response.json({version:1});
  if(path==='/api/workspace/recovered-edits')return Response.json({edits:[]});
  if(path==='/api/scm/pulls')return Response.json({pulls:[]});
  if(path==='/api/scm/pulls/detail')return Response.json({ok:true});
  if(path==='/api/workspace'){
    window.patchStarted=true;await window.editWait;
    return Response.json({revision:2,runtimeInstanceId:'ordering-fixture',outcome:'applied'});
  }
  throw Error('Unexpected request '+url);
};
function Probe(){window.workspace=useWorkspace();return <div>{window.workspace.ready?'Ready':'Loading'}</div>}
function Transport(){useWorkspaceSelector(selectConversationConnection,sameWorkspaceFields);window.transportRenders++;return null}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><StudioHostProvider api={{}}><WorkspaceProvider><Probe/><Transport/>{Array.from({length:24},(_,i)=><TaskMessageResponse key={i} taskId="thread">Read [the docs](https://example.com) for details.</TaskMessageResponse>)}</WorkspaceProvider></StudioHostProvider></ApplicationStateProvider>);
window.changeUnrelatedWorkspace=()=>window.workspace.setWorkspace(value=>({...value,automations:[...value.automations]}));
window.holdWorkspaceEdit=()=>{
  window.editWait=new Promise(resolve=>window.releaseEdit=resolve);
  window.workspace.setWorkspace(value=>({...value,agents:[{id:'held',name:'Held',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}]}));
};
window.readWhileEditing=()=>Promise.all([
 window.workspace.request('/api/scm/pulls/detail',{},responses.ok),
 window.workspace.readRuntime(window.profiles[0],'/api/scm/pulls/detail',{},responses.ok),
]);
`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
      '@dovo/studio-ui/image-viewer': root + 'packages/studio-ui/src/image-viewer.tsx',
      '@dovo/studio-ui/clipboard': root + 'packages/studio-ui/src/clipboard.ts',
      '@dovo/studio-ui': root + 'packages/studio-ui/src/index.ts',
    },
    plugins: [
      {
        name: 'count-chat-renders',
        setup(builder) {
          builder.onLoad({ filter: /task-message-response\.tsx$/ }, async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replace(
              '  const { openExternalLink } = useStudioHost()',
              '  window.responseRenders++;\n  const { openExternalLink } = useStudioHost()',
            ),
            loader: 'tsx',
          }))
        },
      },
    ],
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
  },
  [
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const startRuntimeSync=(connection,options)=>{window.syncOptions??={};window.syncOptions[connection.address]=options;return {online:()=>window.syncOnline===true,refresh:()=>{},stop:()=>{}}};`,
    },
    {
      path: './read-cache',
      importer: root + 'packages/studio-core/src/workspace/provider.tsx',
      contents: `
import {Effect} from 'effect';
import {browserReadCache as realCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';
export * from '${root}packages/studio-core/src/workspace/read-cache.ts';
export const browserReadCache=connection=>{
 const cache=realCache(connection);
 return {...cache,readEffect:(key,schema)=>key!=='snapshot'?cache.readEffect(key,schema):Effect.gen(function*(){
   if(connection.address.includes('host0.lan')||connection.address.includes('127.0.0.1'))window.selectedReads++;
   else {window.inactiveStarted++;yield* Effect.promise(()=>window.inactiveWait)}
   return {value:{snapshot:window.snapshot,lastSeen:null,pulls:null}};
 })};
};`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  await context.route('http://startup.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://startup.lan/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.workspace?.ready && window.inactiveStarted > 0)
  assert.equal(await page.evaluate(() => window.selectedReads), 1)
  assert.equal(
    await page.evaluate(() => window.workspace.activeRuntimeId),
    await page.evaluate(() => window.profiles[0].id),
  )
  // Neither the local runtime nor inactive caches have completed. The active computer is usable.
  await page.waitForFunction(() => window.workspace.connected)
  const renders = await page.evaluate(() => ({
    transport: window.transportRenders,
    response: window.responseRenders,
  }))
  for (let index = 0; index < 20; index++) {
    await page.evaluate(() => window.changeUnrelatedWorkspace())
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      transport: window.transportRenders,
      response: window.responseRenders,
    })),
    renders,
  )
  await page.evaluate(() => {
    window.releaseInactive()
    window.releaseLocal({
      address: 'http://127.0.0.1:4310',
      token: 'local-owner-token-for-startup-tests',
    })
  })
  await page.waitForFunction(() => window.workspace.runtimeRegistry.profiles.length === 6)
  assert.equal(
    await page.evaluate(() => window.workspace.activeRuntimeId),
    await page.evaluate(() => window.profiles[0].id),
  )
  const localContext = await browser.newContext()
  await localContext.route('http://startup.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const localPage = await localContext.newPage()
  localPage.on('pageerror', (error) => errors.push(error.message))
  await localPage.goto('http://startup.lan/?local=1')
  await localPage.addScriptTag({ content: built.outputFiles[0].text })
  await localPage.waitForFunction(() => window.workspace?.ready && window.releaseLocal)
  assert.equal(
    await localPage.evaluate(() => window.workspace.connection.address),
    'http://127.0.0.1:4300',
  )
  await localPage.evaluate(() => {
    window.releaseInactive()
    window.releaseLocal({
      address: 'http://127.0.0.1:4310',
      token: window.profiles[0].connection.token,
    })
  })
  await localPage.waitForFunction(() => window.currentLocalStarted)
  await localPage.evaluate(() => {
    window.syncOptions['http://127.0.0.1:4300'].onConnection({
      address: 'http://127.0.0.1:4310',
      token: window.profiles[0].connection.token,
    })
  })
  await localPage.evaluate(() => new Promise(requestAnimationFrame))
  assert.doesNotMatch(
    await localPage.evaluate(() => window.workspace.syncError ?? ''),
    /Another connection change/,
  )
  await localPage.evaluate(() => window.releaseCurrentLocal())
  await localPage.waitForFunction(
    () =>
      window.workspace.connected && window.workspace.connection.address === 'http://127.0.0.1:4310',
  )
  const cancelContext = await browser.newContext()
  await cancelContext.route('http://startup.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const cancelPage = await cancelContext.newPage()
  cancelPage.on('pageerror', (error) => errors.push(error.message))
  await cancelPage.goto('http://startup.lan/?cancel=1')
  await cancelPage.addScriptTag({ content: built.outputFiles[0].text })
  await cancelPage.waitForFunction(
    () => window.heldFallbackSignal && window.syncOptions?.['http://host0.lan:8787'],
  )
  await cancelPage.evaluate(() => {
    const stream = window.syncOptions['http://host0.lan:8787']
    window.syncOnline = true
    stream.onStatus('live')
    window.abortedBeforeSnapshot = window.heldFallbackSignal.aborted
    window.readsBeforeReconnect = window.fallbackSignals.length
    stream.onSnapshot({ ...window.snapshot, revision: 2 })
  })
  await cancelPage.waitForFunction(
    () => window.cancelledFallbacks === 1 && window.workspace.connected,
  )
  assert.equal(await cancelPage.evaluate(() => window.abortedBeforeSnapshot), false)
  assert.equal(await cancelPage.evaluate(() => window.workspace.syncError), null)
  await cancelPage.evaluate(() => {
    window.holdFallback = false
    window.syncOnline = false
    window.syncOptions['http://host0.lan:8787'].onStatus('reconnecting')
  })
  await cancelPage.waitForFunction(
    () => window.fallbackSignals.length > window.readsBeforeReconnect && window.workspace.connected,
  )
  const orderingContext = await browser.newContext()
  await orderingContext.route('http://startup.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const orderingPage = await orderingContext.newPage()
  orderingPage.on('pageerror', (error) => errors.push(error.message))
  await orderingPage.goto('http://startup.lan/')
  await orderingPage.addScriptTag({ content: built.outputFiles[0].text })
  await orderingPage.waitForFunction(() => window.workspace?.connected)
  await orderingPage.evaluate(() => window.holdWorkspaceEdit())
  await orderingPage.waitForFunction(() => window.patchStarted)
  assert.equal(
    await orderingPage.evaluate(() =>
      Promise.race([
        window.readWhileEditing().then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]),
    ),
    true,
    'Pure POST reads must finish while a workspace write is held',
  )
  await orderingPage.evaluate(() => window.releaseEdit())
  await orderingPage.waitForFunction(() => !window.workspace.pendingSync)
  assert.deepEqual(errors, [])
  console.log(
    'Selected computer becomes ready before inactive caches/local runtime; unrelated updates preserve chat transport subscriptions; confirmed streaming cancels HTTP fallback and reconnect restores it; pure POST reads bypass held workspace writes.',
  )
} finally {
  await browser.close()
}
