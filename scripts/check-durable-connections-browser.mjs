import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const built = await build({
  alias: {
    react: require.resolve('react'),
    'react-dom': require.resolve('react-dom/package.json').replace(/package\.json$/, ''),
  },
  stdin: {
    resolveDir: root,
    contents: `
import {DurableState,jsonStateStorage} from './packages/durable-connections/src/index.ts';
import {browserSharedStateStorage} from './packages/studio-core/src/runtime/shared-state-storage.ts';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {decode,runtimeProfile,runtimeRegistrySchema,retainRuntimeConnections} from './packages/protocol/src/index.ts';
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
  assert.deepEqual(errors, [])
  console.log(
    'Durable browser state: offline reload, two-way sync, replay, recovery, storage failure, concurrent IndexedDB journals and mobile draft scopes passed.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
