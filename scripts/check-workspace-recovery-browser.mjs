import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Schema} from 'effect';
import {decode,runtimeProfile,snapshotSchema,removeRuntime,upsertRuntime} from '@dovo/protocol';
import {TooltipProvider} from '@dovo/studio-ui';
import DeviceHostsView from './packages/extension-runtime/src/device-hosts-view.tsx';
import {PairingClient} from './packages/extension-runtime/src/pairing-client.tsx';
import {WorkspaceProvider,useWorkspace} from './packages/studio-core/src/workspace/provider.tsx';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {browserMutationStorage,writeWorkspaceDocument} from './packages/studio-core/src/workspace/read-cache.ts';
import {updateAppPreferences} from './packages/studio-core/src/preferences.ts';
import {LauncherWorkspaceProvider} from './packages/studio-core/src/workspace/launcher-provider.tsx';
import {readRuntimeRegistry,writeRuntimeRegistry} from './packages/studio-core/src/workspace/runtime-registry.ts';
window.calls=[];
window.profiles=Array.from({length:6},(_,i)=>runtimeProfile({address:'http://host'+i+'.lan:8787',token:'test-token-for-host-'+i},'Computer '+i));
localStorage.setItem('dovo.runtimes.v1',JSON.stringify({version:1,activeId:window.profiles[0].id,profiles:window.profiles}));
const workspace={version:1,runtimeAddress:'',agents:[{id:'agent',name:'Before',instructions:'',provider:'codex',model:'',permission:'ask',endpoint:''}],tasks:[],repositories:[],automations:[]};
window.server=decode(snapshotSchema,{revision:1,runtimeInstanceId:'test-instance',owner:false,workspace,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],settingsScopesSupported:true,defaults:{scopedSettings:{environment:{},shared:[]}}});
window.failWorkspace=true;
window.fetch=async(url,init={})=>{
  const parsed=new URL(url);const path=parsed.pathname;const input=init.body?JSON.parse(init.body):undefined;
  window.calls.push({host:parsed.host,path,query:parsed.search,input});
  if(path==='/api/snapshot' && window.failSnapshot && parsed.hostname==='host0.lan')throw new Error('No connection to selected computer');
  if(path==='/api/snapshot')return Response.json({...window.server,settingsScopesSupported:parsed.hostname==='host0.lan'});
  if(path==='/api/mutations/status')return Response.json({version:1});
  if(path==='/api/tasks/message')throw new Error('Message delivery offline');
  if(path==='/api/workspace') {
    if(window.autoReconcile)return Response.json({revision:window.server.revision,runtimeInstanceId:'test-instance',reconciled:true});
    if(window.failWorkspace)return Response.json({error:'Workspace conflict'},{status:409});
    const agent=window.server.workspace.agents.find(agent=>agent.id===input.id);
    for(const[field,change]of Object.entries(input.changes)) {
      if(agent[field]!==change.before&&agent[field]!==change.after)return Response.json({error:'Another client changed '+field},{status:409});
    }
    window.server={...window.server,revision:window.server.revision+1,workspace:{...window.server.workspace,agents:window.server.workspace.agents.map(agent=>agent.id===input.id?{...agent,...Object.fromEntries(Object.entries(input.changes).map(([field,change])=>[field,change.after]))}:agent)}};
    return Response.json({ok:true,revision:window.server.revision,runtimeInstanceId:'test-instance'});
  }
  if(path==='/api/agents/settings/sync') {
    window.server={...window.server,defaults:{scopedSettings:{environment:{},shared:input.shared}}};
    return Response.json({shared:input.shared});
  }
  if(path==='/api/workspace/recovered-edits' && parsed.searchParams.has('cursor'))return Response.json({edits:[{id:'older',createdAt:'2026-10-01',patch:{collection:'agents',id:'agent',changes:{}},host:null}]});
  if(path==='/api/workspace/recovered-edits')return Response.json({edits:[{id:'saved',createdAt:'2026-10-13T00:00:00Z',patch:{collection:'agents',id:'agent',changes:{name:{before:'Before',after:'Recovered local name'}}},host:{name:'Runtime name'}}],nextCursor:'100'});
  if(path==='/api/device-hosts')return Response.json({enabled:true,hosts:[]});
  throw new Error('Unexpected request '+url);
};
function LauncherProbe(){window.launcherContext=useWorkspace();return null}
window.mountLauncher=()=>{
  const element=document.body.appendChild(document.createElement('div'));
  window.launcherRoot=createRoot(element);
  window.launcherRoot.render(<LauncherWorkspaceProvider registry={window.workspaceContext.runtimeRegistry}><LauncherProbe/></LauncherWorkspaceProvider>);
};
window.checkCacheFactories=async()=>{
  const profile=window.profiles[0];
  const workspaceCache=window.workspaceContext.runtimeReadCache(profile), launcherCache=window.launcherContext.runtimeReadCache(profile);
  // Neither handle has to read before rotation; their creation-time fence is enough.
  const registry=await readRuntimeRegistry();
  await writeRuntimeRegistry(removeRuntime(registry,profile.id));
  await writeRuntimeRegistry(upsertRuntime(await readRuntimeRegistry(),profile));
  const closed=[workspaceCache.closed,launcherCache.closed];
  const workspaceNext=window.workspaceContext.runtimeReadCache(profile), launcherNext=window.launcherContext.runtimeReadCache(profile);
  await workspaceNext.write('factory-probe','workspace recovered');
  await launcherNext.write('factory-probe','launcher recovered');
  return {closed,recreated:[workspaceNext!==workspaceCache,launcherNext!==launcherCache],value:(await workspaceNext.read('factory-probe',Schema.String))?.value};
};
function Probe(){const value=useWorkspace();window.workspaceContext=value;return <div>{value.ready?'Ready':'Loading'}</div>}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><WorkspaceProvider><Probe/><TooltipProvider><DeviceHostsView/><PairingClient onManage={()=>{}}/></TooltipProvider></WorkspaceProvider></ApplicationStateProvider>);
window.pendingCommands=()=>browserMutationStorage.read(window.profiles[0].connection);
const saveRecovery=browserMutationStorage.recoverWorkspaceEdit.bind(browserMutationStorage);
browserMutationStorage.recoverWorkspaceEdit=(connection,edit)=>window.failRecoveryStorage?Promise.reject(new Error('Recovery storage temporarily unavailable')):saveRecovery(connection,edit);

window.seedLegacyRecoveries=async()=>{
  const connection=window.profiles[0].connection;
  const key='dovo.workspace-recoveries.v1.'+bytesToHex(sha256(utf8ToBytes(new URL(connection.address).origin)))+'.'+bytesToHex(sha256(utf8ToBytes(connection.token)));
  window.corruptLocalRecoveries=()=>writeWorkspaceDocument(key,'corrupt');
  const edit={id:'legacy-local',createdAt:'2026-10-13',patch:{collection:'agents',id:'agent',changes:{name:{before:'Before',after:'Legacy local'}}},host:null};
  await writeWorkspaceDocument(key,JSON.stringify({edits:[edit]}));
  const migrated=await browserMutationStorage.workspaceRecoveries(connection);
  const newer={...edit,id:'new-local'};
  await browserMutationStorage.recoverWorkspaceEdit(connection,newer);
  await browserMutationStorage.recoverWorkspaceEdit(connection,newer);
  return {migrated,all:await browserMutationStorage.workspaceRecoveries(connection)};
};
window.saveMessage=()=>window.workspaceContext.request('/api/tasks/message',{taskId:'task',messageId:'saved-message',text:'Do not lose this command'},Schema.Struct({ok:Schema.Boolean}));
window.editWorkspace=()=>window.workspaceContext.setWorkspace(value=>({...value,agents:value.agents.map(agent=>({...agent,name:'Edited'}))}));
window.changeSettings=()=>updateAppPreferences({sharedScopedSettings:[{key:'global',updatedAt:10,changeId:'retry-settings',value:{taskDefaults:{setupCommand:'echo retry'}}}]});
window.readDeviceHub=()=>window.workspaceContext.request('/api/device-hosts',undefined,Schema.Struct({enabled:Schema.Boolean,hosts:Schema.Array(Schema.Unknown)}),'GET');
`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
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
  ],
)
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.route('http://recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://recovery.lan/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.workspaceContext?.connected)
  await page.waitForFunction(() => window.workspaceContext.runtimes.length === 6)
  await page.evaluate(() => window.workspaceContext.refreshRuntimes())
  const reads = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/snapshot'),
  )
  assert.ok(
    reads.every((read) => read.query.includes('scope=')),
    'No unrestricted fleet snapshots',
  )
  assert.ok(
    reads
      .filter((read) => read.host !== 'host0.lan:8787')
      .every((read) => read.query === '?scope=overview'),
  )
  assert.ok(
    reads
      .filter((read) => read.host === 'host0.lan:8787')
      .every((read) => read.query.includes('history=paged')),
  )
  assert.deepEqual(await page.evaluate(() => window.readDeviceHub()), { enabled: true, hosts: [] })

  await page.getByRole('switch', { name: 'Enable Device Hub', exact: true }).waitFor()
  await page.evaluate(async () => {
    window.failSnapshot = true
    await window.workspaceContext.refreshRuntime(window.profiles[0]).catch(() => {})
  })
  await page.getByRole('button', { name: 'Retry connection', exact: true }).waitFor()
  await page.evaluate(() => {
    window.failSnapshot = false
  })
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click()
  await page.getByRole('switch', { name: 'Enable Device Hub', exact: true }).waitFor()
  await page.evaluate(() => window.editWorkspace())
  await page.waitForFunction(() =>
    window.workspaceContext.syncError?.includes('Workspace conflict'),
  )
  assert.deepEqual(
    await page.evaluate(() => window.readDeviceHub()),
    { enabled: true, hosts: [] },
    'Device Hub reads must not wait for conflicting workspace writes',
  )
  await page.evaluate(() => window.changeSettings())
  await page.waitForFunction(() =>
    window.workspaceContext.syncError?.includes('Changes are waiting to sync'),
  )
  await page.evaluate(() => {
    window.failWorkspace = false
  })
  await page.evaluate(() => window.workspaceContext.retrySync())
  await page.waitForFunction(() =>
    window.calls.some((call) => call.path === '/api/agents/settings/sync'),
  )

  // A legacy receipt runtime automatically keeps competing host values while
  // applying independent fields and durably retaining the superseded intent.
  await page.evaluate(() => {
    window.failRecoveryStorage = true
    window.server = {
      ...window.server,
      revision: window.server.revision + 1,
      workspace: {
        ...window.server.workspace,
        agents: window.server.workspace.agents.map((agent) => ({
          ...agent,
          name: 'Competing host name',
        })),
      },
    }
    window.workspaceContext.setWorkspace((value) => ({
      ...value,
      agents: value.agents.map((agent) => ({
        ...agent,
        name: 'My local name',
        instructions: 'Preserve these local instructions',
      })),
    }))
  })
  await page.waitForFunction(() =>
    window.workspaceContext.syncError?.includes('Recovery storage temporarily unavailable'),
  )
  await page.evaluate(() => {
    window.failRecoveryStorage = false
  })
  await page.waitForFunction(
    () =>
      !window.workspaceContext.pendingSync &&
      window.workspaceContext.workspace.agents[0].instructions ===
        'Preserve these local instructions',
  )
  const agent = await page.evaluate(() => window.workspaceContext.workspace.agents[0])
  assert.equal(agent.name, 'Competing host name')
  assert.equal(await page.getByRole('button', { name: 'Keep my edit', exact: true }).count(), 0)

  await page.evaluate(async () => {
    window.autoReconcile = true
    window.server = { ...window.server, workspaceReconciliationSupported: true }
    await window.workspaceContext.refreshRuntime(window.profiles[0])
    window.editWorkspace()
  })
  await page.waitForFunction(
    () =>
      !window.workspaceContext.pendingSync &&
      window.workspaceContext.workspace.agents[0].name === window.server.workspace.agents[0].name,
  )
  const recoveries = await page.evaluate(() => window.seedLegacyRecoveries())
  assert.ok(recoveries.migrated.some((edit) => edit.id === 'legacy-local'))
  assert.equal(recoveries.all.filter((edit) => edit.id === 'new-local').length, 1)
  await page.getByRole('button', { name: 'Recovered edits', exact: true }).first().click()
  await page
    .getByRole('dialog')
    .getByText('2026-10-13T00:00:00Z · agents/agent', { exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByText(/Recovered local name/)
    .waitFor()
  await page.getByRole('button', { name: 'Load older edits', exact: true }).click()
  await page.getByRole('dialog').getByText('2026-10-01 · agents/agent', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.corruptLocalRecoveries())
  await page.getByRole('button', { name: 'Recovered edits', exact: true }).first().click()
  await page
    .getByRole('dialog')
    .getByText('Local recovered edits could not be read. They remain preserved on this device.', {
      exact: true,
    })
    .waitFor()
  await page
    .getByRole('dialog')
    .getByText('2026-10-13T00:00:00Z · agents/agent', { exact: true })
    .waitFor()
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.saveMessage())
  assert.equal((await page.evaluate(() => window.pendingCommands())).length, 1)
  await page.evaluate(() => window.workspaceContext.discardAndReload())
  const pending = await page.evaluate(() => window.pendingCommands())
  assert.equal(pending.length, 1, 'Workspace reload must retain saved commands')
  assert.equal(pending[0].input.text, 'Do not lose this command')
  await page.evaluate(() => window.mountLauncher())
  await page.waitForFunction(() => !!window.launcherContext)
  assert.deepEqual(await page.evaluate(() => window.checkCacheFactories()), {
    closed: [true, true],
    recreated: [true, true],
    value: 'launcher recovered',
  })
  assert.deepEqual(errors, [])
  console.log(
    'Workspace recovery: six HTTP hosts, scoped polling, Device Hub reads, settings retry, automatic conflict reconciliation and saved-command preservation passed.',
  )
} finally {
  await browser.close()
}
