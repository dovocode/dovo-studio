import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const built = await build({
  plugins: [
    {
      name: 'native-alert-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^react-native$/ }, () => ({
          path: 'react-native',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const Alert={alert:()=>{throw Error("Unexpected draft limit alert")}};',
        }))
      },
    },
  ],
  alias: {
    react: require.resolve('react'),
    'react-dom': require.resolve('react-dom/package.json').replace(/package\.json$/, ''),
  },
  stdin: {
    resolveDir: root,
    contents: `
import {DurableState,jsonStateStorage,startReplication} from './packages/durable-connections/src/index.ts';
import {browserSharedStateStorage,browserThreadStateStorage} from './packages/studio-core/src/runtime/shared-state-storage.ts';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {decode,runtimeProfile,runtimeRegistrySchema,retainRuntimeConnections,decodeThreadRecord,validateThreadVersion,recoverThreadParentVersion,threadReplicationChannel,threadRecordKey} from './packages/protocol/src/index.ts';
import {clientScopeKey} from './packages/client-runtime/src/effects/request-scope.ts';
import {createDetailDrafts,detailDraftKey,useDetailDraft} from './apps/mobile/src/runtime/state/detail-drafts.ts';
const drafts=createDetailDrafts();let registry,draftRoot;
function Draft({connection}) {
  const {draft,setField}=useDetailDraft(drafts,detailDraftKey(connection,'thread'),()=>({text:''}));
  return React.createElement('input',{id:'draft',value:draft.text,onInput:event=>setField('text',event.target.value)});
}
function renderDraft(){const connection=registry.profiles[1].connection;
  flushSync(()=>draftRoot.render(React.createElement(Draft,{key:clientScopeKey(connection),connection})));}
window.mountDraftFixture=()=>{
  const host=document.createElement('div');document.body.append(host);draftRoot=createRoot(host);
  registry=decode(runtimeRegistrySchema,{version:1,activeId:null,profiles:[
    runtimeProfile({address:'http://a.local:4310',token:'a'.repeat(32)}),
    runtimeProfile({address:'http://b.local:4310',token:'b'.repeat(32)})]});renderDraft();
};
window.renameOtherComputer=()=>{registry=retainRuntimeConnections(registry,decode(runtimeRegistrySchema,
  {...registry,profiles:registry.profiles.map((profile,i)=>i===0?{...profile,name:'Renamed'}:profile)}));renderDraft();};
window.renewDraftComputer=()=>{registry=retainRuntimeConnections(registry,decode(runtimeRegistrySchema,
  {...registry,profiles:registry.profiles.map((profile,i)=>i===1?{...profile,connection:{...profile.connection,token:'c'.repeat(32)}}:profile)}));renderDraft();};
window.openSharedReplica=async id=>{
  await window.state?.close?.();
  window.state=await DurableState.openPersisted({channel:'shared-browser-state',createReplicaId:()=>id,now:()=>100,
    storage:browserSharedStateStorage,
    decode:value=>{if(typeof value!=='string')throw Error('Expected string');return value}});
};
window.bareThread=(()=>{const value={kind:'thread',ownerRuntimeId:'owner',threadId:'child',ownerName:'Owner',projectName:'Project',createdAt:'2026-01-01',status:'done',historyRevision:0,removed:false};return {key:threadRecordKey(value),updatedAt:100,changeId:'owner:100',deleted:false,value}})();
window.richThread={...window.bareThread,value:{...window.bareThread.value,parent:{runtimeId:'owner',threadId:'parent'}}};
window.checkPagedParentReplay=async()=>{
  const open=id=>DurableState.openPersisted({channel:threadReplicationChannel,createReplicaId:()=>id,
    storage:jsonStateStorage({read:()=>localStorage.getItem(id),write:value=>localStorage.setItem(id,value)}),
    decode:decodeThreadRecord,validateVersion:validateThreadVersion,recoverVersion:recoverThreadParentVersion});
  let source=await open('paged-source');const target=await open('paged-target');let worker;
  try{
    const prefix=Array.from({length:128},(_,i)=>{const value={kind:'title',ownerRuntimeId:'owner',threadId:'prefix-'+i,value:'Retain '+i};
      return {key:threadRecordKey(value),updatedAt:i+1,changeId:'prefix:'+i,deleted:false,value};});
    await source.importVersions([...prefix,window.bareThread]);
    let after=0;
    do{const batch=source.batch(after);await target.receive(batch);after=batch.through;}while(after<source.revision);
    await source.importVersions([window.richThread]);
    await source.close();source=await open('paged-source');
    const errors=[];
    worker=startReplication({state:source,peerId:'paged-target',intervalMs:null,
      exchange:request=>target.exchange(request),onError:error=>errors.push(error.message)});
    const deadline=Date.now()+5000;
    while(!target.get(window.bareThread.key)?.parent&&Date.now()<deadline&&!errors.length)
      await new Promise(resolve=>setTimeout(resolve,10));
    if(errors.length)throw Error(errors.join('; '));
    if(target.get(window.bareThread.key)?.parent?.threadId!=='parent')throw Error('Repaired page two did not reach a caught-up peer after reopening');
    if(source.revision!==129||target.revision!==129)throw Error('Repair changed retained history counts');
  }finally{await worker?.stop();await source.close();await target.close();}
};
window.openThreadReplica=async(id,recover=true)=>{
  await window.state?.close?.();
  window.state=await DurableState.openPersisted({channel:threadReplicationChannel,createReplicaId:()=>id,
    storage:browserThreadStateStorage,decode:decodeThreadRecord,validateVersion:validateThreadVersion,
    ...(recover?{recoverVersion:recoverThreadParentVersion}:{})});
};
window.openReplica=async id=>{
  window.failStorage=false;
  window.state=await DurableState.open({channel:'browser-state',replicaId:id,now:()=>100,
    storage:jsonStateStorage({read:()=>localStorage.getItem(id),write:json=>{if(window.failStorage)throw Error('Storage full');localStorage.setItem(id,json)}}),
    decode:value=>{if(typeof value!=='string')throw Error('Expected string');return value}});
  const render=()=>document.getElementById('state').textContent=JSON.stringify(window.state.latest());
  window.state.subscribe(render);render();
};`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
})
const server = createServer((request, response) => {
  response.setHeader(
    'Content-Type',
    request.url === '/bundle.js' ? 'application/javascript' : 'text/html',
  )
  response.end(
    request.url === '/bundle.js'
      ? built.outputFiles[0].text
      : '<div id="state"></div><script src="/bundle.js"></script>',
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const a = await context.newPage(),
    b = await context.newPage()
  const errors = []
  for (const page of [a, b]) {
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`)
  }
  await a.evaluate(() => window.openReplica('a'))
  await b.evaluate(() => window.openReplica('b'))
  await a.evaluate(() => window.state.set('theme', 'light'))
  await b.evaluate(() => window.state.set('theme', 'dark'))
  const sync = async () => {
    let peer,
      sentThrough = 0
    for (let index = 0; index < 20; index++) {
      const request = await a.evaluate(
        ({ peer, sentThrough }) => window.state.request(peer, sentThrough),
        { peer, sentThrough },
      )
      const response = await b.evaluate((request) => window.state.exchange(request), request)
      const accepted = await a.evaluate((response) => window.state.accept(response), response)
      peer = accepted.peer
      sentThrough = accepted.sentThrough
      if (!accepted.more) return
    }
    throw new Error('Browser replicas did not settle')
  }
  await sync()
  assert.equal(await a.evaluate(() => window.state.get('theme')), 'dark')
  assert.match(await a.locator('#state').innerText(), /dark/)
  await a.evaluate(() => window.state.set('draft', 'offline text'))
  await a.reload()
  await a.evaluate(() => window.openReplica('a'))
  assert.equal(await a.evaluate(() => window.state.get('draft')), 'offline text')
  const request = await a.evaluate(() => window.state.request())
  await b.evaluate((request) => window.state.exchange(request), request) // lose the response
  await b.evaluate((request) => window.state.exchange(request), request)
  await sync()
  assert.equal(await b.evaluate(() => window.state.history('draft').length), 1)
  await a.evaluate(() => window.state.delete('draft'))
  await sync()
  await b.evaluate((request) => window.state.exchange(request), request) // replay an old prefix
  assert.equal(await b.evaluate(() => window.state.get('draft')), undefined)
  await a.evaluate(() => window.state.restoreVersion(window.state.history('theme').at(-1)))
  await sync()
  assert.equal(await b.evaluate(() => window.state.get('theme')), 'light')
  const failure = await a.evaluate(async () => {
    window.failStorage = true
    try {
      await window.state.set('theme', 'unsaved')
    } catch (error) {
      return error.message
    }
  })
  assert.equal(failure, 'Storage full')
  assert.equal(await a.evaluate(() => window.state.get('theme')), 'light')
  // Use the actual app IndexedDB adapter, with independent owners in separate windows.
  await Promise.all([
    a.evaluate(() => window.openSharedReplica('window-a')),
    b.evaluate(() => window.openSharedReplica('window-b')),
  ])
  assert.equal(
    await a.evaluate(() => window.state.replicaId),
    await b.evaluate(() => window.state.replicaId),
  )
  // Use the real mobile draft hook and the same connection-keyed React boundary as RuntimeScope.
  await a.evaluate(() => window.mountDraftFixture())
  await a.locator('#draft').fill('Keep my unsent draft')
  await a.evaluate(() => window.renameOtherComputer())
  assert.equal(await a.locator('#draft').inputValue(), 'Keep my unsent draft')
  await a.evaluate(() => window.renewDraftComputer())
  assert.equal(await a.locator('#draft').inputValue(), '')
  await Promise.all([
    a.evaluate(() =>
      Promise.all(
        Array.from({ length: 20 }, (_, index) => window.state.set('a-' + index, 'A' + index)),
      ),
    ),
    b.evaluate(() =>
      Promise.all(
        Array.from({ length: 20 }, (_, index) => window.state.set('b-' + index, 'B' + index)),
      ),
    ),
  ])
  await a.evaluate(() => window.state.refresh())
  await b.evaluate(() => window.state.refresh())
  const journal = await a.evaluate(() => window.state.versions())
  assert.equal(journal.length, 40)
  assert.equal(new Set(journal.map((entry) => entry.changeId)).size, 40)
  assert.deepEqual(await b.evaluate(() => window.state.versions()), journal)
  await a.reload()
  await a.evaluate(() => window.openSharedReplica('must-not-replace-identity'))
  assert.deepEqual(await a.evaluate(() => window.state.versions()), journal)
  assert.equal(
    await a.evaluate(() => window.state.replicaId),
    await b.evaluate(() => window.state.replicaId),
  )
  // Upgrade an actual IndexedDB thread journal, then rebase a second open window.
  await a.evaluate(async () => {
    await window.openThreadReplica('retained-thread-identity', false)
    await window.state.importVersions([window.bareThread])
  })
  await a.evaluate(() => window.openThreadReplica('must-not-replace-identity'))
  await b.evaluate(() => window.openThreadReplica('second-window'))
  await a.evaluate(() => window.state.importVersions([window.richThread]))
  await b.evaluate(() =>
    window.state.set(JSON.stringify(['owner', 'child', 'title']), {
      kind: 'title',
      ownerRuntimeId: 'owner',
      threadId: 'child',
      value: 'Keep this offline edit',
    }),
  )
  await a.evaluate(() => window.state.refresh())
  assert.deepEqual(
    await a.evaluate(() => window.state.history(window.bareThread.key)),
    await a.evaluate(() => [window.richThread]),
  )
  assert.equal(await a.evaluate(() => window.state.revision), 2)
  assert.equal(await a.evaluate(() => window.state.replicaId), 'retained-thread-identity')
  const repairedJournal = await a.evaluate(() => window.state.versions())
  await a.reload()
  await a.evaluate(() => window.openThreadReplica('unused-after-reload'))
  assert.deepEqual(await a.evaluate(() => window.state.versions()), repairedJournal)
  await a.evaluate(() => window.checkPagedParentReplay())
  assert.deepEqual(errors, [])
  console.log(
    'Durable browser state: offline reload, two-way sync, replay, recovery, storage failure, concurrent IndexedDB journals, parent repair across windows and after page one/reopen, and mobile draft scopes passed.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
