import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {StrictMode} from 'react';
import {decode,runtimeProfile,snapshotSchema} from '@dovo/protocol';
import {Workbench} from './packages/studio-shell/src/workbench.tsx';
import {useWorkspace,useStudioHost,defineStudioExtension} from '@dovo/studio-core';
import {TaskContextMenu} from './packages/extension-tasks/src/detail/task-context-menu.tsx';
import {mergeRuntimeRegistry} from './packages/studio-core/src/workspace/runtime-registry.ts';
const profiles=[0,1].map(i=>runtimeProfile({address:'http://host'+i+'.lan:8787',token:'device-token-at-least-32-characters-'+i},'Computer '+i));
if(!localStorage.getItem('desktop.registry'))localStorage.setItem('desktop.registry',JSON.stringify({version:1,activeId:profiles[0].id,profiles}));
window.registryWrites=0;const registryListeners=new Set();
window.addEventListener('storage',event=>{if(event.key==='desktop.registry')for(const listener of registryListeners)listener()});
window.dovo={readRuntimeRegistry:async()=>localStorage.getItem('desktop.registry'),writeRuntimeRegistry:async(value,before)=>{window.registryWrites++;const saved=JSON.stringify(mergeRuntimeRegistry(JSON.parse(localStorage.getItem('desktop.registry')),JSON.parse(before),JSON.parse(value)));localStorage.setItem('desktop.registry',saved);for(const listener of registryListeners)listener();return saved},subscribeRuntimeRegistry:listener=>{registryListeners.add(listener);return()=>registryListeners.delete(listener)},runtimeConnection:async()=>profiles[0].connection};
window.calls=[];window.popped=[];window.snapshotRevision=1;
window.fetch=async(url,init={})=>{
 const parsed=new URL(url),path=parsed.pathname,input=init.body?JSON.parse(init.body):undefined;
 window.calls.push({host:parsed.host,path,input});
 if(path==='/api/snapshot')return Response.json(decode(snapshotSchema,{revision:window.snapshotRevision,owner:false,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[],automations:[],tasks:[{id:'thread',title:'Thread on '+parsed.hostname+(window.snapshotRevision>1?' update '+window.snapshotRevision:''),agentId:'',repositoryId:'',status:'draft',sessionId:'session',createdAt:'2026-10-12',messages:[],files:[],draft:'',example:false}]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]}));
 if(path==='/api/mutations/status')return Response.json({version:1});
 if(path==='/api/tasks/compact')return Response.json({ok:true,revision:1});
 throw new Error('Unexpected request '+url);
};
function Thread({entityId}){const value=useWorkspace(),host=useStudioHost();window.store=value;window.host=host;const task=value.workspace.tasks.find(t=>t.id===entityId);return <><output id="selection">{value.activeRuntimeId+'|'+(task?.id??'fresh')}</output><output id="title">{task?.title}</output><output id="focused">{String(host.threadWindow)}</output>{task&&<TaskContextMenu dropdown task={task} owner={{runtimeId:value.activeRuntimeId,name:'Owner',online:value.connected,agents:[],repositories:[],worktreeDeletionOverrideSupported:false}} selected={false} busy={false} onOpen={()=>{}} onCreate={()=>{}} onFilter={()=>{}} onDeselect={()=>{}} onError={message=>{if(message)throw Error(message)}}><button>Task actions</button></TaskContextMenu>}</>}
window.taskViewLoads=0;
window.featureLoads={};
function Feature({view,threadConnection}){const value=useWorkspace(),host=useStudioHost();window.store=value;window.host=host;window.threadConnection=threadConnection;return <output id="feature">{view+'|'+value.activeRuntimeId}</output>}
const extensions=[defineStudioExtension({id:'dovo.tasks',name:'Tasks',version:'1'},[{id:'tasks',title:'Tasks',order:0,load:async()=>{window.taskViewLoads++;return {default:Thread}}}]),...['pulls','agents','runtime'].map(view=>defineStudioExtension({id:'fixture.'+view,name:view,version:'1'},[{id:view,title:view,order:1,load:async()=>{window.featureLoads[view]=(window.featureLoads[view]??0)+1;return {default:props=> <Feature view={view} {...props}/>}}}]))];
const target=location.hash?{runtimeId:profiles[location.hash==='#local'?0:1].id,taskId:'thread',title:'Popped thread'}:undefined;
createRoot(document.getElementById('app')).render(<StrictMode><Workbench extensions={extensions} threadWindow={target} popOutThread={async target=>{window.popped.push(target)}}/></StrictMode>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
      '@dovo/studio-core': root + 'packages/studio-core/src/index.ts',
      '@dovo/studio-core/links': root + 'packages/studio-core/src/links/index.ts',
      '@dovo/studio-core/state': root + 'packages/studio-core/src/runtime/application-state.ts',
      '@dovo/studio-ui/runtime-icon': root + 'packages/studio-ui/src/runtime-icon.tsx',
      '@dovo/studio-ui': root + 'packages/studio-ui/src/index.ts',
    },
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
  },
  [
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const startRuntimeSync=()=>({online:()=>false,refresh:()=>{},stop:()=>{}});`,
    },
    {
      path: './appearance',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const useAppearance=()=>{};',
    },
    {
      path: './task-notifications',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const useTaskNotifications=()=>({});',
    },
    {
      path: './app-extension',
      importer: root + 'packages/studio-shell/src/',
      contents:
        "import {defineStudioExtension} from '@dovo/studio-core';export const appSettingsExtension=defineStudioExtension({id:'app',name:'Settings',version:'1'},[]);",
    },
    {
      path: './activity-bar',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const ActivityBar=()=> <nav aria-label="Main navigation"/>;',
    },
    {
      path: './settings-nav',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const SettingsNav=()=>null;',
    },
    {
      path: './title-bar',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const TitleBar=()=>null;',
    },
    {
      path: './command-palette',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const CommandPalette=()=>null;',
    },
    {
      path: './task-launcher',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const TaskLauncher=()=>null;',
    },
    {
      path: '@dovo/extension-scm/projects',
      contents: 'export const ProjectSettings=()=>null;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.route('http://popout.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const main = await context.newPage(),
    detached = await context.newPage(),
    errors = []
  for (const page of [main, detached]) page.on('pageerror', (error) => errors.push(error.message))
  await main.goto('http://popout.test/')
  await main.addScriptTag({ content: built.outputFiles[0].text })
  await main.waitForFunction(() => window.store?.ready)
  // Real extension activation in desktop StrictMode, including multiple screens and live updates.
  await main.waitForFunction(() => window.host && document.getElementById('selection'))
  await main.evaluate(() => {
    window.initialHost = window.host
  })
  for (const view of ['pulls', 'agents', 'runtime']) {
    await main.evaluate((view) => window.host.navigate({ viewId: view }), view)
    await main.waitForFunction(
      (view) => document.getElementById('feature')?.textContent === view + '|http://host0.lan:8787',
      view,
    )
    const revision = await main.evaluate(async () => {
      window.snapshotRevision++
      await window.store.refreshRuntime(window.store.runtimeRegistry.profiles[0])
      return window.snapshotRevision
    })
    await main.waitForFunction((revision) => window.store.snapshot.revision === revision, revision)
    assert.equal(await main.evaluate(() => window.initialHost === window.host), true)
    assert.equal(await main.getByRole('button', { name: 'Retry view' }).count(), 0)
  }
  await main.evaluate(() => window.host.navigate({ viewId: 'tasks' }))
  await main.waitForFunction(() => document.getElementById('selection'))
  assert.deepEqual(await main.evaluate(() => window.featureLoads), {
    pulls: 1,
    agents: 1,
    runtime: 1,
  })
  await main.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('desktop.registry'))
    saved.profiles[0].connection.alternateAddresses = [
      'http://host0.lan:8787',
      'http://100.64.0.1:8787',
    ]
    localStorage.setItem('desktop.registry', JSON.stringify(saved))
  })
  const savedBeforePopout = await main.evaluate(() => localStorage.getItem('desktop.registry'))
  await detached.goto('http://popout.test/#thread')
  await detached.addScriptTag({ content: built.outputFiles[0].text })
  await detached.waitForFunction(
    () => document.getElementById('selection')?.textContent === 'http://host1.lan:8787|thread',
  )
  assert.equal(await detached.evaluate(() => window.registryWrites), 0)
  assert.equal(await detached.evaluate(() => Boolean(window.store.storageError)), false)
  assert.equal(
    await detached.evaluate(() => localStorage.getItem('desktop.registry')),
    savedBeforePopout,
  )
  assert.match(await detached.locator('#title').textContent(), /^Thread on host1\.lan/)
  assert.equal(await detached.locator('#focused').textContent(), 'true')
  const localPopout = await context.newPage()
  localPopout.on('pageerror', (error) => errors.push(error.message))
  await localPopout.goto('http://popout.test/#local')
  await localPopout.addScriptTag({ content: built.outputFiles[0].text })
  await localPopout.waitForFunction(
    () => document.getElementById('selection')?.textContent === 'http://host0.lan:8787|thread',
  )
  assert.equal(await localPopout.evaluate(() => window.registryWrites), 0)
  assert.equal(await localPopout.evaluate(() => Boolean(window.store.storageError)), false)
  assert.equal(
    await localPopout.evaluate(() => localStorage.getItem('desktop.registry')),
    savedBeforePopout,
  )
  await localPopout.close()
  assert.equal(await detached.getByRole('navigation', { name: 'Main navigation' }).count(), 1)
  assert.equal(await main.getByRole('navigation', { name: 'Main navigation' }).count(), 1)
  assert.equal(
    await detached.evaluate(() => JSON.parse(localStorage.getItem('desktop.registry')).activeId),
    'http://host0.lan:8787',
  )
  await detached.getByRole('button', { name: 'Task actions', exact: true }).click()
  await detached.getByRole('menuitem', { name: 'Pop out thread', exact: true }).click()
  assert.deepEqual(await detached.evaluate(() => window.popped), [
    { runtimeId: 'http://host1.lan:8787', taskId: 'thread', title: 'Thread on host1.lan' },
  ])
  // Switching the main window never changes the detached thread's owning computer.
  await main.evaluate(() => window.store.switchRuntime('http://host1.lan:8787'))
  await main.evaluate(() => window.store.switchRuntime('http://host0.lan:8787'))
  await detached.evaluate(() => window.store.switchRuntime('http://host1.lan:8787'))
  await detached.getByRole('button', { name: 'Task actions', exact: true }).click()
  await detached.getByRole('menuitem', { name: 'Advanced', exact: true }).focus()
  await detached.keyboard.press('ArrowRight')
  await detached.getByRole('menuitem', { name: 'Compact agent context', exact: true }).click()
  await detached.waitForFunction(() =>
    window.calls.some((row) => row.path === '/api/tasks/compact'),
  )
  assert.equal(
    await detached.evaluate(
      () => window.calls.find((row) => row.path === '/api/tasks/compact').host,
    ),
    'host1.lan:8787',
  )
  assert.equal(await main.evaluate(() => window.store.activeRuntimeId), 'http://host0.lan:8787')
  assert.equal(
    await detached.evaluate(() => JSON.parse(localStorage.getItem('desktop.registry')).activeId),
    'http://host0.lan:8787',
  )
  await assert.rejects(
    detached.evaluate(() => window.store.switchRuntime('http://host0.lan:8787')),
    /stays with its thread/,
  )
  // Open a child using another client's profile ID but the same paired runtime identity.
  await main.evaluate(() => {
    window.store.runtimes.find(
      (entry) => entry.profile.id === 'http://host1.lan:8787',
    ).snapshot.runtimeId = 'identity-host1.lan'
  })
  await main.evaluate(() =>
    window.host.openThread({
      runtimeId: 'another-client-profile-id',
      runtimeIdentity: 'identity-host1.lan',
      threadId: 'thread',
      title: 'Remote child',
      parent: { runtimeId: 'http://host0.lan:8787', threadId: 'thread', title: 'Release parent' },
    }),
  )
  await main.waitForFunction(
    () => document.getElementById('selection')?.textContent === 'http://host1.lan:8787|thread',
  )
  await main.getByRole('button', { name: 'Back to parent · Release parent', exact: true }).click()
  await main.waitForFunction(
    () => document.getElementById('selection')?.textContent === 'http://host0.lan:8787|thread',
  )
  assert.equal(await main.getByRole('button', { name: /Back to parent/ }).count(), 0)
  // Pairing is never bypassed for a removed computer.
  await main.evaluate(() =>
    window.host.openThread({ runtimeId: 'missing', threadId: 'thread', title: 'Missing' }),
  )
  await main.waitForFunction(
    () => document.getElementById('feature')?.textContent === 'runtime|http://host0.lan:8787',
  )
  assert.deepEqual(await main.evaluate(() => window.threadConnection), {
    runtimeId: 'missing',
    threadId: 'thread',
    title: 'Missing',
  })
  assert.equal(await main.evaluate(() => window.store.activeRuntimeId), 'http://host0.lan:8787')
  assert.equal(
    await main.evaluate(() => window.taskViewLoads),
    1,
    'snapshot updates and computer navigation keep the extension host alive',
  )
  assert.equal(await main.getByRole('button', { name: 'Retry view' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop extensions and thread popout: stable commands across screens/updates, remote navigation, and independent window requests pass.',
  )
} finally {
  await browser.close()
}
