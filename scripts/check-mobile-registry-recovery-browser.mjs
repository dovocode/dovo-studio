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
import {runtimeProfile,peerAddress,workspacePatchResultSchema} from '@dovo/protocol';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {RuntimeProvider,useRuntime,useRuntimeSelector} from './apps/mobile/src/runtime/connection/provider.tsx';
import {preparePeerConnection} from './apps/mobile/src/runtime/connection/peer-transport.ts';window.prepareAccountPeer=preparePeerConnection;window.accountPeerAddress=peerAddress;
window.readFails=true;window.writes=[];window.requests=[];window.peerOpens=[];window.peerCloses=0;window.setPeerRelay=(id,relay)=>Effect.runPromise(window.runtime.setPeerRelayEffect(id,relay));window.upgradePeer=(profile,peer)=>Effect.runPromise(window.runtime.upgradeInternetEffect(profile.id,profile.connection,peer));window.connectPeer=()=>{const peer={origin:'https://connect.example',secret:'a'.repeat(64)};preparePeerConnection(peer);return window.runtime.connect({address:peerAddress(peer),token:'private-peer-device-token',peer},'Peer')};
const profiles=['one','two'].map(name=>runtimeProfile({address:'http://'+name+'.lan:8787',token:'test-private-token-at-least-32-characters-'+name},name));
window.saved=JSON.stringify({version:1,activeId:profiles[0].id,profiles});
window.servers={};window.patchOffline=false;window.patchCalls=[];
window.fetch=async(url,init={})=>{
  window.requests.push(String(url));const parsed=new URL(url);
  if(window.rejectPeerSnapshot && parsed.host==='127.0.0.1:44555')return Response.json({error:'Peer path unavailable'},{status:503});
  // Model a history-heavy runtime whose full snapshot cannot fit a mobile connection.
  if(parsed.host==='127.0.0.1:44555' && parsed.pathname==='/api/snapshot' && !parsed.searchParams.has('scope'))return Response.json({error:'Full history download exceeds this connection budget'},{status:413});
  if(parsed.pathname==='/api/mutations/status')return Response.json({version:1,workspaceMutations:1});
  const server=window.servers[parsed.host]??= {revision:1,runtimeInstanceId:'runtime-'+parsed.host,owner:false,workspaceReconciliationSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],tasks:[],repositories:[{id:'repo',name:'Runtime name',path:'/before',branch:'main'}],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]};
  if(parsed.pathname==='/api/workspace'){
    if(window.patchOffline)throw Error('Offline');
    window.patchCalls.push(parsed.host);
    server.revision++;
    server.workspace.repositories[0]={...server.workspace.repositories[0],path:window.patchPath??'/local'};
    return Response.json({revision:server.revision,runtimeInstanceId:server.runtimeInstanceId,reconciled:true});
  }
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
      path: './peer-native',
      importer: root + 'apps/mobile/src/runtime/connection/peer-transport.ts',
      contents: `export const openPeerTunnel=async(config,onClosed,abort)=>{window.peerOpens.push(config);let live=true;const close=()=>{if(!live)return;live=false;window.peerCloses++;onClosed()};abort.addEventListener('abort',close,{once:true});return {address:'http://127.0.0.1:44555',alive:()=>live,route:()=>live?'direct':undefined,close}};`,
    },
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const retryRuntimeSync=connection=>{(window.syncRetries??=[]).push(connection.address)};export const startRuntimeSync=(connection,callbacks)=>{window.streams??={};window.streams[connection.address]=callbacks;return {online:()=>false,refresh:()=>{window.liveRefreshes=(window.liveRefreshes??0)+1},stop:()=>{delete window.streams[connection.address]}}};`,
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
      contents: `export {browserReadCache as mobileReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
    },
    {
      path: './mutation-storage',
      importer,
      contents: `import {browserMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';window.outboxStorage=browserMutationStorage;export const mobileMutationStorage=browserMutationStorage;`,
    },
    {
      path: '../preferences/app-preferences',
      importer,
      contents: `const preferences={computerRefresh:'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[]};export const useMobilePreferences=()=>preferences;export const readMobilePreferences=()=>preferences;export const updateMobilePreferences=()=>{};`,
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
    window.networkChanged({ isConnected: true })
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
  const failuresBefore = await page.evaluate(() => window.pollFailures?.length ?? 0)
  await page.evaluate(() => window.failHeldSnapshot())
  // Observe the real polling worker finishing its error callback before inspecting state.
  await page.waitForFunction((before) => window.pollFailures?.length > before, failuresBefore)
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
  assert.ok(
    await page.evaluate(() => window.liveRefreshes > 0),
    'A network change refreshes the stream',
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
  const renders = await page.evaluate(() => window.renders)
  assert.ok(renders.broad > 3, `broad runtime reader rendered ${renders.broad} times`)
  assert.equal(renders.selected, 1, 'an action selector re-rendered for runtime state changes')
  assert.deepEqual(errors, [])
  console.log(
    `Mobile registry recovery: credential-store recovery, stale/current HTTP failures, streamed restarts, network wakeups, peer background/foreground recovery and persistent relay opt-out passed; ${renders.broad} broad renders, ${renders.selected} selector render.`,
  )
} finally {
  await browser.close()
}
