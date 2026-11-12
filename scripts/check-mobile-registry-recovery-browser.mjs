import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/runtime/connection/provider.tsx'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';
import {memo} from 'react';
import {Effect} from 'effect';
import {runtimeProfile,peerAddress,workspacePatchResultSchema,responses} from '@dovo/protocol';window.okSchema=responses.ok;
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {browserReadCache} from './packages/studio-core/src/workspace/read-cache.ts';window.readCacheFor=browserReadCache;
import {RuntimeProvider,useRuntime,useRuntimeSelector} from './apps/mobile/src/runtime/connection/provider.tsx';
import {preparePeerConnection} from './apps/mobile/src/runtime/connection/peer-transport.ts';window.prepareAccountPeer=preparePeerConnection;window.accountPeerAddress=peerAddress;
window.readFails=!location.search.includes('startup');window.holdInactiveCache=!window.readFails;window.inactiveCacheWait=new Promise(resolve=>window.releaseInactiveCache=resolve);window.inactiveCacheStarted=false;window.writes=[];window.requests=[];window.peerOpens=[];window.peerCloses=0;window.setPeerRelay=(id,relay)=>Effect.runPromise(window.runtime.setPeerRelayEffect(id,relay));window.upgradePeer=(profile,peer)=>Effect.runPromise(window.runtime.upgradeInternetEffect(profile.id,profile.connection,peer));window.connectPeer=()=>{const peer={origin:'https://connect.example',secret:'a'.repeat(64)};preparePeerConnection(peer);return window.runtime.connect({address:peerAddress(peer),token:'private-peer-device-token',peer},'Peer')};
const profiles=['one','two'].map(name=>runtimeProfile({address:'http://'+name+'.lan:8787',token:'test-private-token-at-least-32-characters-'+name},name));
window.saved=JSON.stringify({version:1,activeId:profiles[0].id,profiles});
window.liveStartup=location.search.includes('liveStartup');
window.holdActiveCache=location.search.includes('heldActiveCache');window.activeCacheWait=new Promise(resolve=>window.releaseActiveCache=resolve);window.activeCacheStarted=false;
window.cachedStartupSnapshot={revision:1,runtimeInstanceId:'cached-runtime',owner:false,workspaceReconciliationSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],tasks:[],repositories:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]};
window.servers={};window.messageCalls=[];window.holdMessage=false;window.patchOffline=false;window.patchCalls=[];
window.fetch=async(url,init={})=>{
  window.requests.push(String(url));const parsed=new URL(url);
  if(window.rejectPeerSnapshot && parsed.host==='127.0.0.1:44555')return Response.json({error:'Peer path unavailable'},{status:503});
  // Model a history-heavy runtime whose full snapshot cannot fit a mobile connection.
  if(parsed.host==='127.0.0.1:44555' && parsed.pathname==='/api/snapshot' && !parsed.searchParams.has('scope'))return Response.json({error:'Full history download exceeds this connection budget'},{status:413});
  if(parsed.pathname==='/api/mutations/status')return Response.json({version:1,workspaceMutations:1});
  if(parsed.pathname==='/api/echo-ok')return Response.json({ok:true});
  if(parsed.pathname==='/api/tasks/message'){
    window.messageCalls.push(JSON.parse(init.body));
    if(window.holdMessage)await new Promise(resolve=>window.releaseMessage=resolve);
    return Response.json({ok:true});
  }
  // Route verification identifies whichever computer currently answers this address.
  if(parsed.pathname==='/health')return Response.json({service:'dovo-runtime',runtimeId:window.servers[parsed.host]?.runtimeId});
  // Hold reads on the old LAN route while the same computer moves to a new address.
  if(window.holdThird && parsed.host==='third.lan:8787' && ['/api/snapshot','/api/held-read'].includes(parsed.pathname))
    return new Promise(resolve=>window.heldThird.push(()=>resolve(Response.json(parsed.pathname==='/api/held-read'?{ok:true}:window.servers[parsed.host]))));
  const server=window.servers[parsed.host]??= {revision:1,runtimeInstanceId:'runtime-'+parsed.host,owner:false,workspaceReconciliationSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],tasks:[],repositories:[{id:'repo',name:'Runtime name',path:'/before',branch:'main'}],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]};
  if(parsed.pathname==='/api/workspace'){
    if(window.patchOffline)throw Error('Offline');
    window.patchCalls.push(parsed.host);
    server.revision++;
    server.workspace.repositories[0]={...server.workspace.repositories[0],path:window.patchPath??'/local'};
    return Response.json({revision:server.revision,runtimeInstanceId:server.runtimeInstanceId,reconciled:true});
  }
  if(window.holdSnapshotReads && parsed.pathname==='/api/snapshot'){return new Promise(resolve=>window.snapshotResponses.push(()=>resolve(Response.json(server))));}
  if(window.holdSnapshotFailure && parsed.pathname==='/api/snapshot' && parsed.host==='one.lan:8787'){
    window.holdSnapshotFailure=false;
    return new Promise(resolve=>{window.failHeldSnapshot=()=>resolve(Response.json({error:'Old HTTP poll failed'},{status:400}));});
  }
  if(window.streamDuringRead && parsed.pathname==='/api/snapshot' && parsed.host==='one.lan:8787'){
    const previous=structuredClone(server);
    window.streamDuringRead=false;
    window.streams[parsed.origin]?.onSnapshot(structuredClone(server));
    return Response.json(previous);
  }
  return Response.json(window.staleSnapshots ? {...server,revision:server.revision-1,workspace:{...server.workspace,repositories:[{...server.workspace.repositories[0],path:'/stale'}]}} : server);
};
window.offlineEdit=owner=>window.runtime.readRuntime(owner,'/api/workspace',{collection:'repositories',id:'repo',changes:{name:{before:'Old name',after:'Local name'},path:{before:'/before',after:'/local'}}},workspacePatchResultSchema,'PATCH');
function Probe(){window.runtime=useRuntime();return <div>{window.runtime.ready?'Ready':'Loading'}</div>}
// Every published runtime value reaches broad readers; a stable action selector stays quiet.
window.renders={broad:0,selected:0};
const Broad=memo(function Broad(){useRuntime();window.renders.broad++;return null});
const selectCancelPairing=runtime=>runtime.cancelPairing;
const Selected=memo(function Selected(){useRuntimeSelector(selectCancelPairing);window.renders.selected++;return null});
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><RuntimeProvider><Probe/><Broad/><Selected/></RuntimeProvider></ApplicationStateProvider>);
window.connectThird=()=>window.runtime.connect({address:'http://third.lan:8787',token:'test-third-private-token-at-least-32-characters'});
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
      path: 'expo-crypto',
      contents: `let id=0;export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++id).padStart(12,'0');`,
    },
    {
      path: './shared-state-storage',
      importer,
      contents: `export {mobileSharedStateStorage,mobileThreadStateStorage} from '${root}scripts/browser/mobile-state-storage.mjs';`,
    },
    {
      path: './peer-native',
      importer: root + 'apps/mobile/src/runtime/connection/peer-transport.ts',
      contents: `export const openPeerTunnel=async(config,onClosed,abort)=>{window.peerOpens.push(config);let live=true;const close=()=>{if(!live)return;live=false;window.peerCloses++;onClosed()};abort.addEventListener('abort',close,{once:true});return {address:'http://127.0.0.1:44555',alive:()=>live,route:()=>live?'direct':undefined,close}};`,
    },
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const retryRuntimeSync=connection=>{(window.syncRetries??=[]).push(connection.address)};export const runtimeSyncOnline=()=>!!window.streamOnline;export const startRuntimeSync=(connection,callbacks)=>{window.streams??={};window.streams[connection.address]=callbacks;callbacks.onStatus?.(window.liveStartup?'connecting':'reconnecting');return {online:()=>!!window.streamOnline,refresh:()=>{window.liveRefreshes=(window.liveRefreshes??0)+1},stop:()=>{delete window.streams[connection.address]}}};`,
    },
    {
      path: '@dovo/client-runtime',
      contents: `export * from '${root}packages/client-runtime/src/index.ts';import {startPolling as poll} from '${root}packages/client-runtime/src/index.ts';export const startPolling=(work,options)=>poll(work,{...options,onError:error=>{options.onError(error);(window.pollFailures??=[]).push(error.message)}});`,
    },
    {
      path: 'react-native',
      contents: `const listeners=new Set();export const AppState={currentState:'active',addEventListener:(event,listener)=>{listeners.add(listener);return {remove:()=>listeners.delete(listener)}}};window.appStateChanged=state=>{AppState.currentState=state;for(const listener of listeners)listener(state)};`,
    },
    {
      path: 'expo-network',
      contents: `const listeners=new Set();export const addNetworkStateListener=listener=>{listeners.add(listener);return {remove:()=>listeners.delete(listener)}};window.networkChanged=state=>{for(const listener of listeners)listener(state)};export const getNetworkStateAsync=async()=>({isConnected:true});export const NetworkStateType={CELLULAR:'cellular'};`,
    },
    {
      path: 'expo-secure-store',
      contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=async key=>{if(window.readFails)throw Error('Credential store temporarily unavailable');return key==='dovo.runtime.registry'?window.saved:null};export const setItemAsync=async(key,value)=>{window.writes.push({key,value});if(key==='dovo.runtime.registry')window.saved=value};export const deleteItemAsync=async()=>{};`,
    },
    {
      path: './read-cache',
      importer,
      contents: `import {Effect} from 'effect';import {browserReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';export const mobileReadCache=connection=>{const cache=browserReadCache(connection);return {...cache,readEffect:(...args)=>{if(args[0]==='snapshot'&&connection.address.includes('one.lan')&&window.liveStartup&&!location.search.includes('emptyCache')){const value=Effect.succeed({value:{snapshot:window.cachedStartupSnapshot,lastSeen:null,pulls:null}});if(window.holdActiveCache){window.activeCacheStarted=true;return Effect.promise(()=>window.activeCacheWait).pipe(Effect.andThen(value))}return value}if(args[0]==='snapshot'&&connection.address.includes('two.lan')&&window.holdInactiveCache){window.inactiveCacheStarted=true;return Effect.promise(()=>window.inactiveCacheWait).pipe(Effect.andThen(cache.readEffect(...args)))}return cache.readEffect(...args)}}};`,
    },
    {
      path: './mutation-storage',
      importer,
      contents: `import {browserMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';window.outboxStorage=browserMutationStorage;export const mobileMutationStorage=browserMutationStorage;`,
    },
    {
      path: '../preferences/app-preferences',
      importer,
      contents: `const preferences={computerRefresh:location.search.includes('fleetStartup')?'reduced':'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[]};export const useMobilePreferences=()=>preferences;export const readMobilePreferences=()=>preferences;export const updateMobilePreferences=()=>{};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.route('http://mobile-recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.goto('http://mobile-recovery.lan/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.runtime?.ready)
  assert.equal(await page.evaluate(() => window.runtime.registryLoaded), false)
  assert.match(
    await page.evaluate(() => window.runtime.error),
    /Credential store temporarily unavailable/,
  )
  const failure = await page.evaluate(() =>
    window.connectThird().then(
      () => '',
      (error) => error.message,
    ),
  )
  assert.match(failure, /Retry loading/)
  assert.deepEqual(await page.evaluate(() => window.writes), [])
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  assert.equal(await page.evaluate(() => JSON.parse(window.saved).profiles.length), 2)
  await page.evaluate(async () => {
    window.readFails = false
    await window.runtime.refreshAll()
  })
  await page.waitForFunction(
    () => window.runtime.registryLoaded && window.runtime.profiles.length === 2,
  )
  await page.evaluate(() => window.connectThird())
  assert.equal(await page.evaluate(() => JSON.parse(window.saved).profiles.length), 3)
  await page.evaluate(async () => {
    window.patchOffline = true
    const owner = window.runtime.profiles.find((profile) => profile.name === 'one')
    await window.offlineEdit(owner).catch(() => {})
  })
  assert.equal(
    await page.evaluate(
      () =>
        window.runtime.mutationStatus(
          window.runtime.profiles.find((profile) => profile.name === 'one'),
        ).pending,
    ),
    1,
  )
  await page.evaluate(async () => {
    window.patchOffline = false
    await window.runtime.refreshRuntime(
      window.runtime.profiles.find((profile) => profile.name === 'one'),
    )
  })
  await page.waitForFunction(() => {
    const owner = window.runtime.profiles.find((profile) => profile.name === 'one')
    const entry = window.runtime.overviews.find((entry) => entry.profile.id === owner.id)
    return (
      entry?.snapshot?.workspace.repositories[0]?.path === '/local' &&
      window.runtime.mutationStatus(owner).pending === 0
    )
  })
  assert.equal(
    await page.evaluate(
      () =>
        window.runtime.overviews.find((entry) => entry.profile.name === 'one').snapshot.workspace
          .repositories[0].name,
    ),
    'Runtime name',
  )
  assert.deepEqual(await page.evaluate(() => window.patchCalls), ['one.lan:8787'])
  const beforeStaleRead = await page.evaluate(
    () =>
      window.requests.filter((url) => url.includes('one.lan') && url.includes('/api/snapshot'))
        .length,
  )
  await page.evaluate(async () => {
    window.staleSnapshots = true
    window.patchPath = '/next-local'
    await window.offlineEdit(window.runtime.profiles.find((profile) => profile.name === 'one'))
  })
  await page.waitForFunction(
    (before) =>
      window.requests.filter((url) => url.includes('one.lan') && url.includes('/api/snapshot'))
        .length >=
      before + 2,
    beforeStaleRead,
  )
  await page.evaluate(() => window.runtime.refreshAll(false))
  assert.equal(
    await page.evaluate(
      () =>
        window.runtime.overviews.find((entry) => entry.profile.name === 'one').snapshot.workspace
          .repositories[0].path,
    ),
    '/local',
    'A stale response must not replace the last accepted workspace',
  )
  await page.evaluate(() => {
    window.staleSnapshots = false
  })
  await page.waitForFunction(
    () =>
      window.runtime.overviews.find((entry) => entry.profile.name === 'one').snapshot.workspace
        .repositories[0].path === '/next-local',
  )
  assert.ok(
    (await page.evaluate(
      (before) =>
        window.requests.filter((url) => url.includes('one.lan') && url.includes('/api/snapshot'))
          .length - before,
      beforeStaleRead,
    )) < 10,
    'Acknowledgement recovery must use paced reads',
  )
  await page.evaluate(async () => {
    const owner = window.runtime.profiles.find((profile) => profile.name === 'one')
    await window.runtime.selectRuntime(owner.id)
  })
  await page.waitForFunction(() => !!window.streams['http://one.lan:8787'])
  const readsBefore = await page.evaluate(() => window.requests.length)
  await page.evaluate(async () => {
    window.streamDuringRead = true
    const owner = window.runtime.profiles.find((profile) => profile.name === 'one')
    await window.offlineEdit(owner)
  })
  await page.waitForFunction(
    () =>
      !window.streamDuringRead &&
      window.runtime.snapshot?.revision === window.servers['one.lan:8787'].revision,
  )
  const readsAfter = await page.evaluate(() => window.requests.length)
  assert.ok(
    readsAfter - readsBefore < 10,
    'A streamed acknowledgement must not repeatedly trigger HTTP refreshes',
  )
  // An HTTP fallback started before a streamed runtime restart must not mark the
  // accepted replacement offline when that older HTTP request eventually fails.
  await page.evaluate(() => {
    window.holdSnapshotFailure = true
    window.snapshotReadFinished = false
    void window.runtime
      .refreshRuntime(window.runtime.profile)
      .catch(() => {})
      .finally(() => {
        window.snapshotReadFinished = true
      })
  })
  await page.waitForFunction(() => typeof window.failHeldSnapshot === 'function')
  await page.evaluate(() => {
    const server = window.servers['one.lan:8787']
    server.runtimeInstanceId = 'restarted-runtime'
    server.revision = 1
    window.streams['http://one.lan:8787'].onSnapshot(structuredClone(server))
  })
  await page.waitForFunction(
    () => window.runtime.snapshot?.runtimeInstanceId === 'restarted-runtime',
  )
  await page.evaluate(() => window.failHeldSnapshot())
  // Observe the held HTTP read completing before inspecting the newer streamed state.
  await page.waitForFunction(() => window.snapshotReadFinished)
  assert.deepEqual(
    await page.evaluate(() => {
      const entry = window.runtime.overviews.find((entry) => entry.profile.name === 'one')
      return {
        connected: entry.connected,
        error: entry.error,
        runtimeInstanceId: entry.snapshot.runtimeInstanceId,
      }
    }),
    { connected: true, error: null, runtimeInstanceId: 'restarted-runtime' },
    'A superseded HTTP failure must not overwrite the live connection state',
  )
  // A failure of the current request still marks the runtime offline.
  await page.evaluate(() => {
    delete window.failHeldSnapshot
    window.holdSnapshotFailure = true
    window.streams['http://one.lan:8787'].onWake()
  })
  await page.waitForFunction(() => typeof window.failHeldSnapshot === 'function')
  await page.evaluate(() => window.failHeldSnapshot())
  await page.waitForFunction(() =>
    window.runtime.overviews.some(
      (entry) =>
        entry.profile.name === 'one' &&
        !entry.connected &&
        entry.error?.includes('Old HTTP poll failed'),
    ),
  )
  await page.evaluate(() => {
    window.streams['http://one.lan:8787'].onSnapshot(
      structuredClone(window.servers['one.lan:8787']),
    )
  })
  await page.waitForFunction(() =>
    window.runtime.overviews.some(
      (entry) => entry.profile.name === 'one' && entry.connected && entry.error === null,
    ),
  )
  const beforeNetworkWake = await page.evaluate(() => {
    const before = window.liveRefreshes ?? 0
    window.networkChanged({ isConnected: false })
    window.networkChanged({ isConnected: true })
    return before
  })
  assert.ok(
    await page.evaluate((before) => window.liveRefreshes > before, beforeNetworkWake),
    'A real reconnect refreshes the stream',
  )
  // Backgrounding tears down the old stream. A late callback from that stream
  // cannot overwrite the foreground connection, even after the runtime restarts.
  await page.evaluate(() => {
    window.oldStream = window.streams['http://one.lan:8787']
    window.appStateChanged('background')
  })
  await page.waitForFunction(() => !window.streams['http://one.lan:8787'])
  await page.evaluate(() => {
    window.servers['one.lan:8787'].runtimeInstanceId = 'foreground-runtime'
    window.appStateChanged('active')
  })
  await page.waitForFunction(() => !!window.streams['http://one.lan:8787'])
  await page.evaluate(() => {
    const snapshot = structuredClone(window.servers['one.lan:8787'])
    window.streams['http://one.lan:8787'].onSnapshot(snapshot)
    window.oldStream.onSnapshot({ ...snapshot, runtimeInstanceId: 'stopped-stream' })
  })
  await page.waitForFunction(
    () => window.runtime.snapshot?.runtimeInstanceId === 'foreground-runtime',
  )
  assert.equal(await page.evaluate(() => window.runtime.connected), true)
  assert.equal(
    await page.evaluate(() => window.peerOpens.length),
    0,
    'LAN profiles do not open native peers',
  )
  await page.evaluate(() => window.connectPeer())
  await page.waitForFunction(
    () => window.runtime.profile?.name === 'Peer' && window.runtime.connected,
  )
  await page.evaluate(() => {
    window.networkChanged({ type: 'WIFI', isConnected: true })
    window.syncRetries = []
    window.networkChanged({ type: 'CELLULAR', isConnected: true })
  })
  assert.deepEqual(
    await page.evaluate(() => window.syncRetries),
    [await page.evaluate(() => window.runtime.profile.connection.address)],
    'A real handover immediately replaces the old live-sync attempt',
  )
  await page.evaluate(() => window.networkChanged({ type: 'CELLULAR', isConnected: true }))
  assert.equal(
    await page.evaluate(() => window.syncRetries.length),
    1,
    'Repeated network status does not restart live sync',
  )
  const peerId = await page.evaluate(() => window.runtime.profile.id)
  await page.evaluate((id) => window.setPeerRelay(id, 'dovo'), peerId)
  await page.waitForFunction(() => window.runtime.profile.connection.peer.relay === 'dovo')
  await page.evaluate(() => window.runtime.refresh())
  await page.waitForFunction(() => window.peerOpens.at(-1)?.relay === 'dovo')
  await page.evaluate(() => {
    window.oldPeerProfile = window.runtime.profile
  })
  await page.evaluate((id) => window.setPeerRelay(id, undefined), peerId)
  await page.waitForFunction(() => window.runtime.profile.connection.peer.relay === undefined)
  await page.evaluate(() => window.runtime.refreshRuntime(window.oldPeerProfile))
  assert.equal(
    await page.evaluate(() => window.peerOpens.at(-1).relay),
    undefined,
    'A stale read cannot restore relay consent',
  )
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(window.saved).profiles.find((profile) => profile.name === 'Peer').connection.peer
          .relay,
    ),
    undefined,
  )
  await page.evaluate(() => window.appStateChanged('background'))
  await page.waitForFunction(() => !window.runtime.connected)
  const opened = await page.evaluate(() => window.peerOpens.length)
  await page.evaluate(() => window.appStateChanged('active'))
  await page.evaluate(() => window.runtime.refresh())
  await page.waitForFunction(
    (count) => window.peerOpens.length > count && window.runtime.connected,
    opened,
  )
  assert.equal(await page.evaluate(() => window.peerOpens.at(-1).relay), undefined)
  // Upgrade an existing saved profile without a new token or a duplicate registry entry.
  const beforeUpgrade = await page.evaluate(() => {
    window.upgradingProfile = window.runtime.profiles.find((profile) => profile.name === 'two')
    window.rejectPeerSnapshot = true
    return { saved: JSON.parse(window.saved), profile: window.upgradingProfile }
  })
  const failedUpgrade = await page.evaluate(() =>
    window
      .upgradePeer(window.upgradingProfile, {
        origin: 'https://connect.example',
        secret: 'c'.repeat(64),
      })
      .then(
        () => '',
        (error) => error.message,
      ),
  )
  assert.match(failedUpgrade, /Peer path unavailable/)
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(window.saved).profiles.find(
        (profile) => profile.id === window.upgradingProfile.id,
      ),
    ),
    beforeUpgrade.profile,
    'A failed internet probe must keep the old saved connection',
  )
  await page.evaluate(async () => {
    window.rejectPeerSnapshot = false
    await window.upgradePeer(window.upgradingProfile, {
      origin: 'https://connect.example',
      secret: 'c'.repeat(64),
    })
  })
  const afterUpgrade = await page.evaluate(() => JSON.parse(window.saved))
  assert.equal(afterUpgrade.profiles.length, beforeUpgrade.saved.profiles.length)
  const upgraded = afterUpgrade.profiles.find((profile) => profile.id === beforeUpgrade.profile.id)
  assert.equal(upgraded.connection.token, beforeUpgrade.profile.connection.token)
  assert.equal(upgraded.name, beforeUpgrade.profile.name)
  assert.ok(upgraded.connection.address.endsWith('.p2p.invalid'))
  assert.equal(upgraded.connection.peer.secret, 'c'.repeat(64))
  assert.equal(
    afterUpgrade.activeId,
    beforeUpgrade.saved.activeId,
    'Upgrading another computer must not change the active computer',
  )
  // A known computer must prove the same identity before its address or credential is replaced.
  const oneId = await page.evaluate(async () => {
    const one = window.runtime.profiles.find((profile) => profile.name === 'one')
    window.servers['one.lan:8787'].runtimeId = 'one-computer'
    await window.runtime.refreshRuntime(one)
    return one.id
  })
  await page.waitForFunction(
    (id) =>
      JSON.parse(window.saved).profiles.find((profile) => profile.id === id)?.connection
        .runtimeId === 'one-computer',
    oneId,
  )
  const replacement = await page.evaluate(async (id) => {
    const saved = () => JSON.parse(window.saved).profiles.find((profile) => profile.id === id)
    const before = saved()
    const one = window.runtime.profiles.find((profile) => profile.id === id)
    const upgrade = () =>
      window.upgradePeer(one, { origin: 'https://connect.example', secret: '9'.repeat(64) }).then(
        () => 'upgraded',
        (error) => error.message,
      )
    const missing = await upgrade()
    window.servers['127.0.0.1:44555'].runtimeId = 'other-computer'
    const different = await upgrade()
    delete window.servers['127.0.0.1:44555'].runtimeId
    // Another computer now answers at this saved computer's original address.
    window.servers['one.lan:8787'].runtimeId = 'intruder-computer'
    await window.runtime.syncAccountSession('replacement-session')
    const overwrite = await window.runtime
      .connect(
        {
          address: 'http://one.lan:8787',
          token: 'intruder-account-token-private',
          accountSession: 'replacement-session',
        },
        'Intruder',
      )
      .then(
        () => 'saved',
        (error) => error.message,
      )
    window.servers['one.lan:8787'].runtimeId = 'one-computer'
    return { missing, different, overwrite, before, after: saved() }
  }, oneId)
  assert.match(replacement.missing, /Could not verify this is the same computer/)
  assert.match(replacement.different, /different computer/)
  assert.match(replacement.overwrite, /different computer/)
  assert.deepEqual(replacement.after, replacement.before)
  // The same device token on a replacement address still retires work captured for the old route:
  // held reads cannot publish, captured actions cannot dispatch or queue, and overview refreshes
  // cannot join an old-route read.
  const scoped = await page.evaluate(async () => {
    window.previousActiveId = window.runtime.activeId
    const third = window.runtime.profiles.find(
      (profile) => profile.connection.address === 'http://third.lan:8787',
    )
    await window.runtime.selectRuntime(third.id)
    return third
  })
  await page.waitForFunction((id) => window.runtime.profile?.id === id, scoped.id)
  await page.evaluate(() => {
    window.stale = { read: window.runtime.read, call: window.runtime.call }
    window.heldThird = []
    window.holdThird = true
    window.heldRead = window.stale.read('/api/held-read', undefined, window.okSchema, 'GET').then(
      () => 'published',
      (error) => error.message,
    )
    void window.runtime.refreshAll()
  })
  await page.waitForFunction(
    () =>
      window.requests.some((url) => url.startsWith('http://third.lan:8787/api/held-read')) &&
      window.requests.some((url) => url.startsWith('http://third.lan:8787/api/snapshot')),
  )
  await page.evaluate(
    (profile) =>
      window.upgradePeer(profile, { origin: 'https://connect.example', secret: 'd'.repeat(64) }),
    scoped,
  )
  const upgradedThird = await page.evaluate(() => window.runtime.profile)
  assert.equal(upgradedThird.id, scoped.id)
  assert.equal(upgradedThird.connection.token, scoped.connection.token)
  assert.ok(upgradedThird.connection.address.endsWith('.p2p.invalid'))
  const oldRouteRequests = await page.evaluate(
    () => window.requests.filter((url) => url.startsWith('http://third.lan:8787/')).length,
  )
  assert.equal(
    await page.evaluate(() =>
      Promise.race([
        window.runtime.refreshAll().then(() => 'settled'),
        new Promise((resolve) => setTimeout(() => resolve('joined old route'), 2000)),
      ]),
    ),
    'settled',
    'A refresh for the new address must not wait on an old-route overview',
  )
  const staleCall = await page.evaluate(async () => {
    window.patchOffline = true
    const message = await window.stale
      .call(
        '/api/workspace',
        {
          collection: 'repositories',
          id: 'repo',
          changes: { name: { before: 'Runtime name', after: 'Stale route name' } },
        },
        window.okSchema,
        'PATCH',
      )
      .then(
        () => 'dispatched',
        (error) => error.message,
      )
    window.patchOffline = false
    return message
  })
  assert.match(staleCall, /selected computer changed/)
  assert.deepEqual(
    await page.evaluate(
      (old) => [
        window.runtime.mutationStatus(window.runtime.profile).pending,
        window.runtime.mutationStatus(old).pending,
      ],
      scoped,
    ),
    [0, 0],
    'A captured action must not queue under either route',
  )
  assert.equal(
    await page.evaluate(
      (old) =>
        window.runtime.readRuntime(old, '/api/echo-ok', undefined, window.okSchema, 'GET').then(
          () => 'published',
          (error) => error.message,
        ),
      scoped,
    ),
    'This computer connection changed. Refresh the collection.',
  )
  await page.evaluate(() => {
    window.holdThird = false
    for (const release of window.heldThird.splice(0)) release()
  })
  assert.match(await page.evaluate(() => window.heldRead), /selected computer changed/)
  assert.deepEqual(
    await page.evaluate(async (id) => {
      // Let the released old-route overview and live refresh finish publishing.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const entry = window.runtime.overviews.find((item) => item.profile.id === id)
      return [
        entry.profile.connection.address === window.runtime.connection.address,
        entry.snapshot?.runtimeInstanceId,
        window.runtime.snapshot?.runtimeInstanceId,
      ]
    }, scoped.id),
    [true, 'runtime-127.0.0.1:44555', 'runtime-127.0.0.1:44555'],
    'A released old-route snapshot must not replace the current overview',
  )
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((url) => url.startsWith('http://third.lan:8787/')).length,
    ),
    oldRouteRequests,
    'No request may use the replaced address after the upgrade commits',
  )
  // The current saved owner remains readable after another computer becomes active.
  await page.evaluate(() => window.runtime.selectRuntime(window.previousActiveId))
  await page.waitForFunction(() => window.runtime.activeId === window.previousActiveId)
  assert.equal(
    await page.evaluate((id) => {
      const owner = window.runtime.profiles.find((profile) => profile.id === id)
      return window.runtime
        .readRuntime(owner, '/api/echo-ok', undefined, window.okSchema, 'GET')
        .then((result) => result.ok)
    }, scoped.id),
    true,
  )
  await page.evaluate(async () => {
    window.rejectPeerSnapshot = false
    window.accountOriginalCount = window.runtime.profiles.length
    await window.runtime.syncAccountSession('signed-in-phone')
    const peer = { origin: 'https://connect.example', secret: 'e'.repeat(64), relay: 'dovo' }
    window.prepareAccountPeer(peer)
    window.servers['127.0.0.1:44555'].runtimeId = 'account-computer'
    await window.runtime.connect(
      {
        address: window.accountPeerAddress(peer),
        peer,
        runtimeId: 'account-computer',
        token: 'account-internet-token-private',
        accountSession: 'signed-in-phone',
      },
      'Account computer',
    )
    window.accountProfileId = window.runtime.profile.id
  })
  await page.waitForFunction(
    () => window.runtime.profile?.connection.accountSession === 'signed-in-phone',
  )
  await page.evaluate(async () => {
    window.servers['account.lan:8787'] = {
      ...window.servers['127.0.0.1:44555'],
      runtimeId: 'account-computer',
    }
    await window.runtime.connect(
      {
        address: 'http://account.lan:8787',
        token: 'explicit-lan-pairing-token-private',
        runtimeId: 'account-computer',
      },
      'Account computer',
    )
  })
  await page.waitForFunction(
    () => window.runtime.profile?.connection.address === 'http://account.lan:8787',
  )
  assert.equal(
    await page.evaluate(() => window.runtime.profile.id),
    await page.evaluate(() => window.accountProfileId),
  )
  assert.equal(
    await page.evaluate(() => window.runtime.profiles.length),
    await page.evaluate(() => window.accountOriginalCount + 1),
  )
  assert.equal(
    await page.evaluate(() => window.runtime.profile.connection.internet.token),
    'account-internet-token-private',
  )
  // Automatic access recovery verifies its new route before committing, and never selects
  // another computer or replaces the independently paired LAN credential.
  const recovered = await page.evaluate(async () => {
    window.accountBeforeRecovery = window.runtime.profile
    await window.runtime.selectRuntime(window.runtime.profiles.find((p) => p.name === 'one').id)
    const selected = window.runtime.activeId
    const peer = { origin: 'https://connect.example', secret: 'f'.repeat(64), relay: 'dovo' }
    const incoming = {
      address: window.accountPeerAddress(peer),
      peer,
      runtimeId: 'account-computer',
      token: 'renewed-account-internet-device-token',
      accountSession: 'signed-in-phone',
    }
    window.accountIncoming = incoming
    await window.runtime.recoverAccountConnection(
      window.accountBeforeRecovery,
      incoming,
      new AbortController().signal,
    )
    return { selected, saved: JSON.parse(window.saved) }
  })
  assert.equal(recovered.saved.activeId, recovered.selected)
  const savedAccount = recovered.saved.profiles.find(
    (p) => p.connection.runtimeId === 'account-computer',
  )
  assert.equal(savedAccount.connection.token, 'explicit-lan-pairing-token-private')
  assert.equal(savedAccount.connection.internet.token, 'renewed-account-internet-device-token')
  assert.equal(savedAccount.id, await page.evaluate(() => window.accountProfileId))
  const rejectedRecovery = await page.evaluate(async () => {
    const previous = window.runtime.profiles.find((p) => p.id === window.accountProfileId)
    const peer = { ...window.accountIncoming.peer, secret: '1'.repeat(64) }
    window.servers['127.0.0.1:44555'].runtimeId = 'wrong-computer'
    const failure = await window.runtime
      .recoverAccountConnection(
        previous,
        { ...window.accountIncoming, address: window.accountPeerAddress(peer), peer },
        new AbortController().signal,
      )
      .then(
        () => '',
        (e) => e.message,
      )
    window.servers['127.0.0.1:44555'].runtimeId = 'account-computer'
    return { failure, saved: JSON.parse(window.saved) }
  })
  assert.match(rejectedRecovery.failure, /different computer/)
  assert.deepEqual(rejectedRecovery.saved, recovered.saved)
  // A computer reachable only through the account is removed with its offline data at sign-out.
  const accountOnly = await page.evaluate(async () => {
    const peer = { origin: 'https://connect.example', secret: '2'.repeat(64), relay: 'dovo' }
    window.prepareAccountPeer(peer)
    window.servers['127.0.0.1:44555'].runtimeId = 'account-only-computer'
    await window.runtime.connect(
      {
        address: window.accountPeerAddress(peer),
        peer,
        runtimeId: 'account-only-computer',
        token: 'account-only-internet-token-private',
        accountSession: 'signed-in-phone',
      },
      'Account only',
    )
    window.servers['127.0.0.1:44555'].runtimeId = 'account-computer'
    const profile = window.runtime.profiles.find(
      (item) => item.connection.runtimeId === 'account-only-computer',
    )
    const lan = window.runtime.profiles.find((item) => item.id === window.accountProfileId)
    await window.runtime.cacheForRuntime(profile).write('probe', { ok: true })
    await window.runtime.cacheForRuntime(lan).write('probe', { ok: true })
    return profile
  })
  assert.equal(accountOnly.connection.accountSession, 'signed-in-phone')
  await page.evaluate(() => window.runtime.selectRuntime(window.accountProfileId))
  const unresolved = await page.evaluate(async () => {
    const profile = window.runtime.profile
    await window.outboxStorage.update(profile.connection, () => [
      {
        id: 'unresolved',
        path: '/api/tasks/cancel',
        method: 'POST',
        input: { id: 'task' },
        reviewAfterRenewal: true,
      },
    ])
    const error = await window.runtime.syncAccountSession(null).then(
      () => '',
      (error) => error.message,
    )
    return {
      error,
      saved: JSON.parse(window.saved),
      status: window.runtime.mutationStatus(profile),
    }
  })
  assert.match(unresolved.error, /saved actions/)
  assert.ok(
    unresolved.saved.profiles.find((profile) => profile.id === savedAccount.id)?.connection
      .internet,
    'Sign-out must preserve access to unresolved actions',
  )
  assert.equal(unresolved.status.pending, 1)
  assert.match(unresolved.status.error, /saved actions/)
  await page.evaluate(() => window.runtime.discardMutations(window.runtime.profile))
  await page.evaluate(() => window.runtime.syncAccountSession(null))
  await page.waitForFunction(() => !window.runtime.profile.connection.internet)
  assert.equal(
    await page.evaluate(() => window.runtime.profile.connection.token),
    'explicit-lan-pairing-token-private',
  )
  const signedOut = await page.evaluate(async (removed) => {
    const lan = window.runtime.profiles.find((item) => item.id === window.accountProfileId)
    const probe = (connection) =>
      window
        .readCacheFor(connection)
        .read('probe', window.okSchema)
        .then((cached) => !!cached)
    return {
      saved: window.runtime.profiles.some((item) => item.id === removed.id),
      overview: window.runtime.overviews.some((entry) => entry.profile.id === removed.id),
      removedCache: await probe(removed.connection),
      lanCache: await probe(lan.connection),
      error: window.runtime.error,
    }
  }, accountOnly)
  assert.deepEqual(signedOut, {
    saved: false,
    overview: false,
    removedCache: false,
    lanCache: true,
    error: '',
  })
  const renders = await page.evaluate(() => window.renders)
  assert.ok(renders.broad > 3, `broad runtime reader rendered ${renders.broad} times`)
  assert.equal(renders.selected, 1, 'an action selector re-rendered for runtime state changes')
  const startupContext = await browser.newContext()
  await startupContext.route('http://mobile-recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const startup = await startupContext.newPage()
  startup.on('pageerror', (error) => errors.push(error.message))
  await startup.goto('http://mobile-recovery.lan/?startup')
  await startup.addScriptTag({ content: built.outputFiles[0].text })
  await startup.waitForFunction(() => window.runtime?.ready && window.inactiveCacheStarted)
  assert.equal(await startup.evaluate(() => window.runtime.profile.name), 'one')
  await startup.evaluate(() => {
    window.holdInactiveCache = false
    window.releaseInactiveCache()
  })
  await startup.evaluate(() => {
    window.networkChanged({ isConnected: false })
    window.appStateChanged('background')
    window.appStateChanged('active')
  })
  await startup.waitForFunction(() => !window.runtime.connected)
  const offline = await startup.evaluate(async () => {
    const before = window.requests.length
    const result = await window.runtime.call(
      '/api/tasks/message',
      { id: 'offline-thread', messageId: 'offline-first', text: 'Saved locally' },
      window.okSchema,
      undefined,
      { defer: true },
    )
    return {
      result,
      requests: window.requests.length - before,
      pending: window.runtime.mutationStatus(window.runtime.profile).pending,
    }
  })
  assert.deepEqual(offline, { result: { ok: true, pending: true }, requests: 0, pending: 1 })
  await startup.evaluate(() => {
    window.streamOnline = true
    window.holdMessage = true
    window.networkChanged({ isConnected: true })
  })
  await startup.waitForFunction(() => !!window.releaseMessage)
  const second = await startup.evaluate(async () => {
    const result = await window.runtime.call(
      '/api/tasks/message',
      {
        id: 'offline-thread',
        messageId: 'offline-second',
        text: 'Saved while first response is pending',
      },
      window.okSchema,
      undefined,
      { defer: true },
    )
    return {
      result,
      pending: window.runtime.mutationStatus(window.runtime.profile).pending,
      messages: window.messageCalls.length,
    }
  })
  assert.deepEqual(second, { result: { ok: true, pending: true }, pending: 2, messages: 1 })
  await startup.evaluate(() => {
    window.holdMessage = false
    window.releaseMessage()
  })
  await startup.waitForFunction(
    () => window.runtime.mutationStatus(window.runtime.profile).pending === 0,
  )
  assert.deepEqual(
    await startup.evaluate(() => window.messageCalls.map((item) => item.messageId)),
    ['offline-first', 'offline-second'],
  )
  await startup.evaluate(() => {
    window.holdSnapshotReads = true
    window.snapshotResponses = []
    window.sharedRefresh = Promise.all(
      Array.from({ length: 3 }, () => window.runtime.refreshRuntime(window.runtime.profile)),
    )
  })
  await startup.waitForFunction(() => window.snapshotResponses.length === 1)
  assert.equal(await startup.evaluate(() => window.snapshotResponses.length), 1)
  await startup.evaluate(async () => {
    window.holdSnapshotReads = false
    window.snapshotResponses[0]()
    await window.sharedRefresh
  })
  const traffic = await startup.evaluate(async () => {
    const before = window.requests.filter((url) => url.includes('/api/snapshot')).length
    const wakesBefore = window.liveRefreshes ?? 0
    for (let i = 0; i < 20; i++) window.networkChanged({ isConnected: true })
    if ((window.liveRefreshes ?? 0) !== wakesBefore)
      throw Error('Repeated native status woke live sync')
    for (let i = 0; i < 5; i++)
      await window.runtime.call('/api/echo-ok', undefined, window.okSchema)
    for (let i = 0; i < 20; i++)
      window.streams[window.runtime.connection.address].onSnapshot(
        structuredClone(window.servers['one.lan:8787']),
      )
    return window.requests.filter((url) => url.includes('/api/snapshot')).length - before
  })
  assert.equal(traffic, 0, 'live mutations and streamed snapshots must not trigger full downloads')
  // A cached screen is already usable: do not race the live baseline with an HTTP copy.
  const liveContext = await browser.newContext()
  await liveContext.route('http://mobile-recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const heldStartup = await liveContext.newPage()
  heldStartup.on('pageerror', (error) => errors.push(error.message))
  await heldStartup.goto('http://mobile-recovery.lan/?startup&liveStartup&heldActiveCache')
  await heldStartup.addScriptTag({ content: built.outputFiles[0].text })
  await heldStartup.waitForFunction(() => window.activeCacheStarted)
  // Keep disk restoration blocked. Live rows must be usable without releasing it.
  await heldStartup.waitForFunction(
    () => window.inactiveCacheStarted && !!window.streams?.['http://one.lan:8787'],
    null,
    { timeout: 2000 },
  )
  await heldStartup.evaluate(() => {
    const live = structuredClone(window.cachedStartupSnapshot)
    live.revision = 8
    live.workspace.tasks = [
      {
        id: 'real',
        title: 'Real thread',
        agentId: '',
        repositoryId: 'project',
        harness: { provider: 'claude', model: 'test', permission: 'read-only' },
        status: 'review',
        createdAt: '2026-11-12',
        draft: '',
        example: false,
        messages: [],
        files: [],
      },
    ]
    live.workspace.repositories = [
      {
        id: 'project',
        name: 'Real project',
        path: '/real',
        branch: 'main',
        iconOverride: 'data:image/png;base64,cmVhbA==',
      },
    ]
    window.streamOnline = true
    window.streams['http://one.lan:8787'].onSnapshot(live)
  })
  await heldStartup.waitForFunction(
    () => window.runtime.ready && window.runtime.snapshot?.revision === 8,
  )
  await heldStartup.evaluate(() => window.releaseActiveCache())
  await heldStartup.waitForFunction(() => window.runtime.ready)
  assert.deepEqual(
    await heldStartup.evaluate(() => ({
      titles: window.runtime.snapshot.workspace.tasks.map((task) => task.title),
      status: window.runtime.snapshot.workspace.tasks[0].status,
      provider: window.runtime.snapshot.workspace.tasks[0].harness.provider,
      icon: window.runtime.snapshot.workspace.repositories[0].iconOverride,
      reads: window.requests.filter((url) => url.includes('/api/snapshot')).length,
    })),
    {
      titles: ['Real thread'],
      status: 'review',
      provider: 'claude',
      icon: 'data:image/png;base64,cmVhbA==',
      reads: 0,
    },
  )
  // A fast thread revisit must not depend on the 15-second disk writer.
  await heldStartup.evaluate(() => {
    const live = structuredClone(window.runtime.snapshot)
    live.revision++
    live.detailTaskIds = ['real']
    live.workspace.tasks[0].messages = [{ id: 'reply', role: 'assistant', text: 'Recent reply' }]
    window.streams['http://one.lan:8787'].onSnapshot(live)
  })
  await heldStartup.waitForFunction(() => window.runtime.snapshot?.revision === 9)
  await heldStartup.evaluate(() => {
    const live = structuredClone(window.runtime.snapshot)
    live.revision++
    live.detailTaskIds = []
    live.workspace.tasks[0] = { ...live.workspace.tasks[0], messages: [], draft: 'New draft' }
    window.streams['http://one.lan:8787'].onSnapshot(live)
  })
  await heldStartup.waitForFunction(() => window.runtime.snapshot?.revision === 10)
  assert.deepEqual(
    await heldStartup.evaluate(() => ({
      messages: window.runtime.snapshot.workspace.tasks[0].messages.map((message) => message.text),
      draft: window.runtime.snapshot.workspace.tasks[0].draft,
      detailed: window.runtime.snapshot.detailTaskIds,
    })),
    { messages: ['Recent reply'], draft: 'New draft', detailed: ['real'] },
    'A summary must retain recently opened history before the disk writer runs',
  )
  await heldStartup.close()
  const fleetStartup = await liveContext.newPage()
  fleetStartup.on('pageerror', (error) => errors.push(error.message))
  await fleetStartup.goto('http://mobile-recovery.lan/?startup&liveStartup&fleetStartup')
  await fleetStartup.addScriptTag({ content: built.outputFiles[0].text })
  await fleetStartup.waitForFunction(
    () => window.runtime.overviews.find((entry) => entry.profile.name === 'two')?.connected,
    null,
    { timeout: 2000 },
  )
  assert.equal(
    await fleetStartup.evaluate(
      () =>
        window.requests.filter(
          (url) => url.includes('/api/snapshot?scope=overview') && url.includes('two.lan'),
        ).length,
    ),
    1,
  )
  assert.equal(
    await fleetStartup.evaluate(() =>
      window.requests.some((url) => url.includes('/api/scm/pulls')),
    ),
    false,
  )
  await fleetStartup.close()
  const livePage = await liveContext.newPage()
  livePage.on('pageerror', (error) => errors.push(error.message))
  await livePage.goto('http://mobile-recovery.lan/?startup&liveStartup')
  await livePage.addScriptTag({ content: built.outputFiles[0].text })
  await livePage.waitForFunction(() => !!window.streams?.['http://one.lan:8787'])
  const snapshotReads = () =>
    livePage.evaluate(() => window.requests.filter((url) => url.includes('/api/snapshot')).length)
  assert.equal(await snapshotReads(), 0, 'cached startup must wait for the live handshake')
  await livePage.evaluate(() => {
    window.streamOnline = true
    const stream = window.streams['http://one.lan:8787']
    stream.onStatus('live')
    stream.onSnapshot(window.cachedStartupSnapshot)
  })
  await livePage.waitForFunction(() => window.runtime.connected)
  assert.equal(await snapshotReads(), 0, 'a healthy live baseline needs no HTTP copy')
  await livePage.evaluate(() => window.appStateChanged('background'))
  await livePage.waitForFunction(() => !window.streams['http://one.lan:8787'])
  await livePage.evaluate(() => {
    window.streamOnline = false
    window.appStateChanged('active')
  })
  await livePage.waitForFunction(() => !!window.streams['http://one.lan:8787'])
  assert.equal(await snapshotReads(), 0, 'cached resume must also wait for the live handshake')
  await livePage.evaluate(() => window.streams['http://one.lan:8787'].onStatus('unsupported'))
  await livePage.waitForFunction(() => window.runtime.connected)
  assert.equal(await snapshotReads(), 1, 'unsupported streams must wake HTTP fallback immediately')
  await livePage.evaluate(() => window.appStateChanged('background'))
  await livePage.waitForFunction(() => !window.streams['http://one.lan:8787'])
  await livePage.evaluate(() => window.appStateChanged('active'))
  await livePage.waitForFunction(() => !!window.streams['http://one.lan:8787'])
  await livePage.evaluate(() => window.streams['http://one.lan:8787'].onStatus('reconnecting'))
  await livePage.waitForFunction(() => window.runtime.connected)
  assert.equal(await snapshotReads(), 2, 'failed handshakes must wake HTTP fallback immediately')
  // No cached screen: start HTTP without waiting for the stream handshake.
  const emptyContext = await browser.newContext()
  await emptyContext.route('http://mobile-recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const emptyPage = await emptyContext.newPage()
  emptyPage.on('pageerror', (error) => errors.push(error.message))
  await emptyPage.goto('http://mobile-recovery.lan/?startup&liveStartup&emptyCache')
  await emptyPage.addScriptTag({ content: built.outputFiles[0].text })
  await emptyPage.waitForFunction(() => window.runtime?.connected)
  assert.equal(
    await emptyPage.evaluate(
      () => window.requests.filter((url) => url.includes('/api/snapshot')).length,
    ),
    1,
    'uncached startup must keep its immediate HTTP baseline',
  )
  await liveContext.close()
  await emptyContext.close()
  assert.deepEqual(errors, [])
  console.log(
    `Mobile registry recovery: credential-store recovery, stale/current HTTP failures, streamed restarts, network wakeups, peer background/foreground recovery and persistent relay opt-out, offline sends, held-response admission, zero extra live snapshot downloads, cached startup/resume without duplicate baselines and immediate failed/unsupported/uncached HTTP fallback passed; ${renders.broad} broad renders, ${renders.selected} selector render.`,
  )
} finally {
  await browser.close()
}
