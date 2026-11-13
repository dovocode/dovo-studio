import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobileImporter = root + 'apps/mobile/src/runtime/connection/provider.tsx'

async function bundle(mobile) {
  return bundleBrowser(
    {
      stdin: {
        contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {runtimeProfile,defaultTaskHarness,decode,snapshotSchema,agentPresetSchema,taskSchema,aggregateRuntimeTasks} from '@dovo/protocol';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {readAppPreferences,updateAppPreferences} from './packages/studio-core/src/preferences.ts';
import {${mobile ? 'RuntimeProvider as Provider,useRuntime as useProvider' : 'WorkspaceProvider as Provider,useWorkspace as useProvider'}} from './${mobile ? 'apps/mobile/src/runtime/connection' : 'packages/studio-core/src/workspace'}/provider.tsx';
window.cacheModule=import('./packages/studio-core/src/workspace/read-cache.ts');window.protocolModule=import('@dovo/protocol');
window.profiles=['one','two'].map(name=>runtimeProfile({address:'http://'+name+'.lan:8787',token:'test-private-token-at-least-32-characters-'+name},name));
window.saved=JSON.stringify({version:1,activeId:window.profiles[0].id,profiles:window.profiles});
localStorage.setItem('dovo.runtimes.v1',window.saved);
window.preset=decode(agentPresetSchema,{...defaultTaskHarness('codex'),id:'preset',name:'Team agent',instructions:'Initial baseline'});
window.ownedTask=host=>decode(taskSchema,{id:'same-thread',title:'Owned by '+host,repositoryId:'repo',agentId:'agent',status:'review',createdAt:'2026-01-01',messages:[{id:'message',role:'user',text:'History for '+host}],files:[],draft:'Draft for '+host,example:false});
window.mirrorTask={...window.ownedTask('foreign'),id:'legacy-mirror',status:'running',replica:{ownerRuntimeId:'foreign',threadId:'same-thread',ownerName:'Foreign',projectName:'Original project'}};
window.rows=()=>aggregateRuntimeTasks(window.entries);
window.calls=[];window.failures={presets:{},settings:{}};window.offline={};
window.servers=Object.fromEntries(window.profiles.map(profile=>[new URL(profile.connection.address).hostname,decode(snapshotSchema,{revision:1,runtimeId:profile.id,runtimeInstanceId:profile.id,owner:false,threadReplicationVersion:1,settingsScopesSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],tasks:[window.ownedTask(profile.name),window.mirrorTask],repositories:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],defaults:{scopedSettings:{environment:{},shared:[]}}})]));
window.fetch=async(url,init={})=>{
  const {hostname:host,pathname:path}=new URL(url);
  const input=init.body?JSON.parse(init.body):undefined;
  window.calls.push({host,path,input});
  const server=window.servers[host];
  if(path==='/health')return Response.json({service:'dovo-runtime',runtimeId:server.runtimeId});
  if(path==='/api/snapshot' && window.startupOffline)throw new TypeError('Offline at launch');
  if(path==='/api/snapshot')return window.offline[host]?Response.json({error:'Runtime offline'},{status:403}):Response.json(server);
  // Legacy runtimes reject invalid settings without retaining a blocked command.
  if(path==='/api/mutations/status')return Response.json({error:'Unsupported'},{status:404});
  const kind=path==='/api/agents/presets/apply'?'presets':path==='/api/agents/settings/sync'?'settings':null;
  if(kind){
    if(window.failures[kind][host])return Response.json({error:window.failures[kind][host]},{status:400});
    if(kind==='presets')server.workspace.agents=input.presets.map(preset=>({...preset,globalPreset:preset}));
    else server.defaults.scopedSettings.shared=input.shared;
    server.revision++;
    return Response.json(kind==='presets'?{ok:true}:{shared:input.shared});
  }
  if(path==='/api/devices/revoke-self')return Response.json({ok:true});
  throw new Error('Unexpected request '+url);
};
window.changePreset=instructions=>{
  window.preset={...window.preset,instructions};
  updateAppPreferences({globalAgentPresets:[window.preset]});
};
window.privatePreset=()=>{window.preset={...window.preset,env:{TOKEN:'private-preset-fixture-marker'}};updateAppPreferences({globalAgentPresets:[window.preset]})};
window.restorePortablePreset=()=>{const {env,...portable}=window.preset;window.preset=portable;window.changePreset('Portable after private preset')};
window.privateShared=()=>updateAppPreferences({sharedScopedSettings:[{key:'global',updatedAt:10000,changeId:'private-fixture',value:{taskDefaults:{harness:{...defaultTaskHarness('codex'),env:{TOKEN:'private-shared-fixture-marker'}}}}}]});
window.preferences=()=>readAppPreferences();
window.changeSettings=version=>updateAppPreferences({sharedScopedSettings:[{key:'global',updatedAt:version,changeId:'settings-'+version,value:{taskDefaults:{setupCommand:'echo '+version}}}]});
window.reconcile=(host,kind)=>{
  const server=window.servers[host];
  if(kind==='presets')server.workspace.agents=[{...window.preset,globalPreset:window.preset}];
  else server.defaults.scopedSettings.shared=readAppPreferences().sharedScopedSettings;
  server.revision++;
};
window.restoreSecond=async()=>{await window.store.connect(window.profiles[1].connection${mobile ? ", 'two'" : ''});await window.store.${mobile ? 'selectRuntime' : 'switchRuntime'}(window.profiles[0].id)};
window.refresh=()=>window.store.${mobile ? 'refreshAll' : 'refreshRuntimes'}();
window.refreshHost=host=>window.store.refreshRuntime(window.profiles.find(profile=>new URL(profile.connection.address).hostname===host));
function Probe(){const value=useProvider();window.store=value;window.syncError=value.${mobile ? 'error' : 'syncError'};window.entries=value.${mobile ? 'overviews' : 'runtimes'};return <output>{window.syncError||'Synced'}</output>}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><Provider><Probe/></Provider></ApplicationStateProvider>);
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
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
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
      ...(mobile
        ? [
            {
              path: 'expo-crypto',
              contents: `let id=0;export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++id).padStart(12,'0');`,
            },
            {
              path: './shared-state-storage',
              importer: mobileImporter,
              contents: `export {mobileSharedStateStorage,mobileThreadStateStorage} from '${root}scripts/browser/mobile-state-storage.mjs';`,
            },
            {
              path: './peer-native',
              importer: root + 'apps/mobile/src/runtime/connection/peer-transport.ts',
              contents:
                'export const openPeerTunnel=async()=>{throw Error("LAN sync tests must not open a native peer")};',
            },
            {
              path: 'react-native',
              contents: `window.appStateListeners=new Set();export const AppState={currentState:'active',addEventListener:(event,listener)=>{window.appStateListeners.add(listener);return{remove:()=>window.appStateListeners.delete(listener)}}};`,
            },
            {
              path: 'expo-network',
              contents: `export const addNetworkStateListener=()=>({remove:()=>{}});export const getNetworkStateAsync=async()=>({isConnected:true});export const NetworkStateType={CELLULAR:'cellular'};`,
            },
            {
              path: 'expo-secure-store',
              contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=async key=>key==='dovo.runtime.registry'?window.saved:null;export const setItemAsync=async(key,value)=>{if(key==='dovo.runtime.registry')window.saved=value};export const deleteItemAsync=async()=>{};`,
            },
            {
              path: './read-cache',
              importer: mobileImporter,
              contents: `export {browserReadCache as mobileReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
            },
            {
              path: './mutation-storage',
              importer: mobileImporter,
              contents: `export {browserMutationStorage as mobileMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
            },
            {
              path: '../preferences/app-preferences',
              importer: mobileImporter,
              contents: `import {useAppPreferences} from '${root}packages/studio-core/src/preferences.ts';export {readAppPreferences as readMobilePreferences,updateAppPreferences as updateMobilePreferences} from '${root}packages/studio-core/src/preferences.ts';export const useMobilePreferences=()=>({...useAppPreferences(),computerRefresh:'manual'});`,
            },
          ]
        : []),
    ],
  )
}

const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await bundle(mobile)
    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://preset-sync.lan/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    await page.goto('http://preset-sync.lan/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page
      .waitForFunction(() => window.store?.connected)
      .catch(async (error) => {
        console.error({
          mobile,
          errors,
          state: await page.evaluate(() => ({
            error: window.syncError,
            calls: window.calls,
            ready: window.store?.ready,
            server: window.servers,
          })),
        })
        throw error
      })
    await page.evaluate(() => window.refresh())
    await page
      .waitForFunction(() => window.entries.every((entry) => entry.connected))
      .catch(async (error) => {
        console.error({
          mobile,
          errors,
          state: await page.evaluate(() => ({
            error: window.syncError,
            calls: window.calls,
            entries: window.entries,
          })),
        })
        throw error
      })

    // Actual desktop/mobile providers accept old runtime snapshots but present owned rows only.
    assert.deepEqual(
      await page.evaluate(() =>
        window.entries.map((entry) => entry.snapshot.workspace.tasks.map((task) => task.id)),
      ),
      [['same-thread'], ['same-thread']],
    )
    assert.equal(await page.evaluate(() => window.rows().length), 2)
    assert.deepEqual(
      await page.evaluate(() =>
        window.entries.map((entry) => entry.snapshot.workspace.tasks[0].draft).sort(),
      ),
      ['Draft for one', 'Draft for two'],
    )

    // Explicitly flush the cache through the page lifecycle before a real IndexedDB reload.
    await page.evaluate((mobile) => {
      if (mobile) for (const listener of window.appStateListeners) listener('background')
      else window.dispatchEvent(new Event('pagehide'))
    }, mobile)
    await page.waitForFunction(async () => {
      const { browserReadCache } = await window.cacheModule
      const { runtimeSnapshotCacheSchema } = await window.protocolModule
      return (
        await Promise.all(
          window.profiles.map((profile) =>
            browserReadCache(profile.connection).read('snapshot', runtimeSnapshotCacheSchema),
          ),
        )
      ).every(Boolean)
    })
    await page.reload()
    await page.evaluate(() => (window.startupOffline = true))
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page
      .waitForFunction(
        () =>
          window.entries?.length === 2 &&
          window.entries.every((entry) => entry.snapshot && !entry.connected),
      )
      .catch(async (error) => {
        console.error(
          JSON.stringify({
            mobile,
            state: await page.evaluate(() => ({
              entries: window.entries,
              error: window.syncError,
              calls: window.calls,
            })),
          }),
        )
        throw error
      })
    assert.deepEqual(
      await page.evaluate(() =>
        window
          .rows()
          .map((row) => row.task.title)
          .sort(),
      ),
      ['Owned by one', 'Owned by two'],
    )
    assert.equal(
      await page.evaluate(() =>
        window.entries.some((entry) => entry.snapshot.workspace.tasks.some((task) => task.replica)),
      ),
      false,
    )
    await page.evaluate(async () => {
      window.startupOffline = false
      await window.refresh()
    })
    await page.waitForFunction(() => window.entries.every((entry) => entry.connected))
    assert.equal(await page.evaluate(() => window.rows().length), 2)
    assert.deepEqual(
      await page.evaluate(() =>
        window.calls.filter((call) => call.path.startsWith('/api/threads/')),
      ),
      [],
    )

    const count = (kind) =>
      page.evaluate(
        (kind) => window.calls.filter((call) => call.path === '/api/agents/' + kind).length,
        kind === 'presets' ? 'presets/apply' : 'settings/sync',
      )
    const waitError = (message) =>
      page
        .waitForFunction((message) => window.syncError?.includes(message), message)
        .catch(async (error) => {
          console.error(
            await page.evaluate(() => ({
              error: window.syncError,
              calls: window.calls.slice(-12),
              entries: window.entries.map((e) => ({ id: e.profile.id, connected: e.connected })),
            })),
          )
          throw error
        })
    const waitSynced = () => page.waitForFunction(() => !window.syncError)

    for (const kind of ['presets', 'settings']) {
      // Fail on both hosts in a known order so the displayed failure belongs to two.
      await page.evaluate((kind) => {
        window.failures[kind] = { 'one.lan': kind + ' failed one' }
        if (kind === 'presets') window.changePreset('First edit')
        else window.changeSettings(1)
      }, kind)
      await waitError(kind + ' failed one')
      await page.waitForFunction((kind) => {
        const server = window.servers['two.lan']
        return kind === 'presets'
          ? server.workspace.agents[0]?.instructions === 'First edit'
          : server.defaults.scopedSettings.shared[0]?.updatedAt === 1
      }, kind)
      assert.match(await page.evaluate(() => window.syncError), new RegExp(kind + ' failed one'))
      await page.evaluate((kind) => {
        window.failures[kind]['two.lan'] = kind + ' failed two'
        if (kind === 'presets') window.changePreset('Second edit')
        else window.changeSettings(2)
      }, kind)
      await waitError(kind + ' failed two')
      const failedCount = await count(kind)
      await page.evaluate(() => window.refreshHost('one.lan'))
      await page.evaluate(() => window.refreshHost('two.lan'))
      assert.equal(await count(kind), failedCount, 'Unchanged failures must not retry')

      // Two recovers on a changed baseline while one's failure remains outstanding.
      await page.evaluate((kind) => {
        window.failures[kind]['two.lan'] = ''
        if (kind === 'presets') window.changePreset('Third edit')
        else window.changeSettings(3)
      }, kind)
      await waitError(kind + ' failed one')
      await page.waitForFunction((kind) => {
        const server = window.servers['two.lan']
        return kind === 'presets'
          ? server.workspace.agents[0]?.instructions === 'Third edit'
          : server.defaults.scopedSettings.shared[0]?.updatedAt === 3
      }, kind)
      assert.match(await page.evaluate(() => window.syncError), new RegExp(kind + ' failed one'))
      assert.doesNotMatch(await page.evaluate(() => window.syncError), /failed two/)

      // Another client already applied one's baseline: refresh resolves a no-op without a write.
      const beforeNoop = await count(kind)
      await page.evaluate((kind) => window.reconcile('one.lan', kind), kind)
      await page.evaluate(() => window.refreshHost('one.lan'))
      await waitSynced()
      assert.equal(await count(kind), beforeNoop, 'Resolved no-op must not write again')

      // Disconnect clears failures; reconnect permits one attempt, forgetting clears it again.
      await page.evaluate((kind) => {
        if (kind === 'presets') window.changePreset('Fourth edit')
        else window.changeSettings(4)
      }, kind)
      await waitError(kind + ' failed one')
      // Disconnect the inactive host, keeping connection errors out of the displayed result.
      await page.evaluate((kind) => {
        window.failures[kind]['one.lan'] = ''
        window.failures[kind]['two.lan'] = kind + ' failed two'
        window.offline['two.lan'] = false
        if (kind === 'presets') window.changePreset('Fifth edit')
        else window.changeSettings(5)
      }, kind)
      await waitError(kind + ' failed two')
      await page.evaluate(() => {
        window.offline['two.lan'] = true
      })
      await page.evaluate(() => window.refreshHost('two.lan').catch(() => {}))
      await waitSynced()
      await page.evaluate(() => {
        window.offline['two.lan'] = false
      })
      await page.evaluate(() => window.refreshHost('two.lan'))
      await waitError(kind + ' failed two')
      await page.evaluate(async () => {
        await window.store.forgetRuntime(window.profiles[1].id)
      })
      await waitSynced()
      assert.equal(await page.evaluate(() => window.entries.length), 1)
      // Restore the second pairing for the next synchronization path.
      await page.evaluate(async (kind) => {
        window.failures[kind] = {}
        await window.restoreSecond()
      }, kind)
      await page.evaluate(() => window.refresh())
      await page.waitForFunction(
        () => window.entries.length === 2 && window.entries.every((entry) => entry.connected),
      )
      await waitSynced()
    }
    assert.deepEqual(
      await page.evaluate(() =>
        window.calls.filter((call) => call.path.startsWith('/api/threads/')),
      ),
      [],
    )
    const presetCalls = await count('presets')
    await page.evaluate(() => window.privatePreset())
    await waitError('environment values')
    assert.equal(await count('presets'), presetCalls)
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(window.calls).includes('private-preset-fixture-marker'),
      ),
      false,
    )
    assert.equal(await page.evaluate(() => !!window.preferences().globalAgentPresets[0].env), true)
    await page.evaluate(() => window.restorePortablePreset())
    await waitSynced()
    await page.evaluate(() => window.privateShared())
    await waitError('environment values')
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(window.calls).includes('private-shared-fixture-marker'),
      ),
      false,
    )
    assert.equal(
      await page.evaluate(
        () => !!window.preferences().sharedScopedSettings[0].value.taskDefaults.harness.env,
      ),
      true,
    )
    await page.evaluate(() => window.changeSettings(10001))
    await waitSynced()
    assert.deepEqual(errors, [])
    console.log(
      (mobile ? 'Mobile' : 'Desktop') +
        ' per-runtime preset/settings sync, owner-only rows, no mirroring, and IndexedDB offline/reconnect passed',
    )
    await context.close()
  }
} finally {
  await browser.close()
}
