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
import {decode,runtimeProfile,snapshotSchema} from '@dovo/protocol';
import {TooltipProvider} from '@dovo/studio-ui';
import DeviceHostsView from './packages/extension-runtime/src/device-hosts-view.tsx';
import {WorkspaceProvider,useWorkspace} from './packages/studio-core/src/workspace/provider.tsx';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {browserMutationStorage} from './packages/studio-core/src/workspace/read-cache.ts';
import {updateAppPreferences} from './packages/studio-core/src/preferences.ts';
window.calls=[];
window.profiles=Array.from({length:6},(_,i)=>runtimeProfile({address:'http://host'+i+'.lan:8787',token:'test-token-for-host-'+i},'Computer '+i));
localStorage.setItem('dovo.runtimes.v1',JSON.stringify({version:1,activeId:window.profiles[0].id,profiles:window.profiles}));
const workspace={version:1,runtimeAddress:'',agents:[{id:'agent',name:'Before',instructions:'',provider:'codex',model:'',permission:'ask',endpoint:''}],tasks:[],repositories:[],automations:[]};
window.server=decode(snapshotSchema,{revision:1,owner:false,workspace,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],settingsScopesSupported:true,defaults:{scopedSettings:{environment:{},shared:[]}}});
window.failWorkspace=true;
window.fetch=async(url,init={})=>{
  const parsed=new URL(url);const path=parsed.pathname;const input=init.body?JSON.parse(init.body):undefined;
  window.calls.push({host:parsed.host,path,query:parsed.search,input});
  if(path==='/api/snapshot' && window.failSnapshot && parsed.hostname==='host0.lan')throw new Error('No connection to selected computer');
  if(path==='/api/snapshot')return Response.json({...window.server,settingsScopesSupported:parsed.hostname==='host0.lan'});
  if(path==='/api/mutations/status')return Response.json({version:1});
  if(path==='/api/tasks/message')throw new Error('Message delivery offline');
  if(path==='/api/workspace') {
    if(window.failWorkspace)return Response.json({error:'Workspace conflict'},{status:409});
    return Response.json({ok:true,revision:1,runtimeInstanceId:'test-instance'});
  }
  if(path==='/api/agents/settings/sync') {
    window.server={...window.server,defaults:{scopedSettings:{environment:{},shared:input.shared}}};
    return Response.json({shared:input.shared});
  }
  if(path==='/api/device-hosts')return Response.json({enabled:true,hosts:[]});
  throw new Error('Unexpected request '+url);
};
function Probe(){const value=useWorkspace();window.workspaceContext=value;return <div>{value.ready?'Ready':'Loading'}</div>}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><WorkspaceProvider><Probe/><TooltipProvider><DeviceHostsView/></TooltipProvider></WorkspaceProvider></ApplicationStateProvider>);
window.pendingCommands=()=>browserMutationStorage.read(window.profiles[0].connection);
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
    alias: { '@dovo/studio-ui': root + 'packages/studio-ui/src/index.ts' },
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

  await page.evaluate(() => window.saveMessage())
  assert.equal((await page.evaluate(() => window.pendingCommands())).length, 1)
  await page.evaluate(() => window.workspaceContext.discardAndReload())
  const pending = await page.evaluate(() => window.pendingCommands())
  assert.equal(pending.length, 1, 'Workspace reload must retain saved commands')
  assert.equal(pending[0].input.text, 'Do not lose this command')
  assert.deepEqual(errors, [])
  console.log(
    'Workspace recovery: six HTTP hosts, scoped polling, Device Hub reads, settings retry and saved-command preservation passed.',
  )
} finally {
  await browser.close()
}
