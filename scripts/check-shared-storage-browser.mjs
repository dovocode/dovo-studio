import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

// Ordinary HTTP is intentional: Web Locks/WebCrypto must not be prerequisites.
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
      import { Effect, Schema } from 'effect';
      import { RuntimeMutations } from './packages/protocol/src/runtime/connection/mutations.ts';
      import { browserMutationStorage, browserReadCache, readWorkspaceOutbox, writeWorkspaceOutbox } from './packages/studio-core/src/workspace/read-cache.ts';
      import { WorkspaceSynchronization } from './packages/studio-core/src/runtime/synchronization.ts';
      import { createTask } from './packages/studio-core/src/workspace/actions.ts';
      window.connection = {address:'http://runtime.lan:4310',token:'test-device'};
      const queue = new RuntimeMutations(browserMutationStorage);
      window.enqueue = messageId => Effect.runPromise(queue.requestEffect(window.connection, '/api/tasks/message', {messageId}, Schema.Struct({ok:Schema.Boolean})));
      window.recover = () => Effect.runPromise(queue.recoverEffect(window.connection));
      window.pending = () => browserMutationStorage.read(window.connection);
      window.cache = browserReadCache(window.connection);
      window.createTask = () => createTask({title:'HTTP task',agentId:'',repositoryId:'',objective:'Work over LAN'});
      const base = {version:1,runtimeAddress:'',tasks:[],repositories:[],automations:[],agents:[{id:'agent',name:'Before',instructions:'Before',provider:'codex',model:'',permission:'ask',endpoint:''}]};
      window.workspaceDelivered = [];
      window.workspaceSync = new WorkspaceSynchronization(() => {}, async (_connection, patch) => window.workspaceDelivered.push(patch), writeWorkspaceOutbox);
      window.workspaceSync.bind(window.connection);
      window.editWorkspace = async (field, after) => {
        const patch = {collection:'agents',id:'agent',changes:{[field]:{before:'Before',after}}};
        window.workspaceSync.enqueue([patch], {...base, agents:[{...base.agents[0],[field]:after}]});
        return Effect.runPromise(window.workspaceSync.savedEffect());
      };
      window.workspacePending = () => readWorkspaceOutbox(window.connection);
      window.flushWorkspace = () => window.workspaceSync.flush();
      window.restoreWorkspace = async () => {
        window.workspaceSync.bind(window.connection, await window.workspacePending());
        await window.workspaceSync.retry();
      };
      window.transferWorkspace = async () => {
        const outbox = await window.workspacePending();
        const target = {...window.connection, token:'replacement-device'};
        await writeWorkspaceOutbox(target, outbox);
        return {outbox,target};
      };
      window.removeTransferred = outbox => writeWorkspaceOutbox(window.connection, null, {append:[],remove:outbox.ids});
      window.legacyWorkspace = async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('dovo-read-cache', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('entries', 'readwrite');
          const store = tx.objectStore('entries');
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            if (String(entry.key).includes('workspace-outbox')) {
              const value = JSON.parse(entry.value);
              delete value.ids;
              entry.update(JSON.stringify(value));
            }
            entry.continue();
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      };
      window.delivered = [];
      window.online = false;
      window.fetch = async (url, init) => {
        if (!window.online) throw new Error('Offline');
        if (String(url).endsWith('/api/mutations/status')) return Response.json({version:1});
        window.delivered.push({id:new Headers(init.headers).get('X-Dovo-Mutation-Id'), input:JSON.parse(init.body)});
        return Response.json({ok:true});
      };
    `,
    resolveDir: root,
  },
  alias: { '@dovo/protocol': `${root}packages/protocol/src/index.ts` },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
})
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  await context.route('http://storage.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Shared storage regression</title>' }),
  )
  const open = async () => {
    const page = await context.newPage()
    await page.goto('http://storage.lan/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    return page
  }
  const first = await open(),
    second = await open()
  assert.equal(await first.evaluate(() => window.isSecureContext), false)
  assert.equal(await first.evaluate(() => typeof crypto.randomUUID), 'undefined')
  const task = await first.evaluate(() => window.createTask())
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  assert.match(task.id, uuid)
  assert.match(task.messages[0].id, uuid)
  assert.notEqual(task.id, task.messages[0].id)
  await Promise.all([
    first.evaluate(() => window.editWorkspace('name', 'Name from tab A')),
    second.evaluate(() => window.editWorkspace('instructions', 'Instructions from tab B')),
  ])
  let workspaceOutbox = await first.evaluate(() => window.workspacePending())
  assert.equal(workspaceOutbox.patches.length, 2)
  assert.equal(new Set(workspaceOutbox.ids).size, 2)
  assert.equal(workspaceOutbox.workspace.agents[0].name, 'Name from tab A')
  assert.equal(workspaceOutbox.workspace.agents[0].instructions, 'Instructions from tab B')
  await first.evaluate(() => window.flushWorkspace())
  workspaceOutbox = await second.evaluate(() => window.workspacePending())
  assert.equal(workspaceOutbox.patches.length, 1)
  assert.equal(workspaceOutbox.patches[0].changes.instructions.after, 'Instructions from tab B')
  assert.deepEqual(
    await Promise.all(
      [first, second].map((page, i) => page.evaluate((i) => window.enqueue(String(i)), i)),
    ),
    [{ ok: true }, { ok: true }],
  )
  const pending = await first.evaluate(() => window.pending())
  assert.equal(pending.length, 2)
  assert.equal(new Set(pending.map((item) => item.id)).size, 2)
  await Promise.all(
    [first, second].map((page, tab) =>
      page.evaluate(async (tab) => {
        await Promise.all(
          Array.from({ length: 55 }, (_, i) => window.cache.write(`pr:${tab}:${i}`, { tab, i })),
        )
      }, tab),
    ),
  )
  const entries = await first.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dovo-read-cache', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries')
      const store = tx.objectStore('entries')
      const keys = store.getAllKeys(),
        values = store.getAll()
      tx.oncomplete = () => {
        db.close()
        resolve(keys.result.map((key, i) => [key, values.result[i]]))
      }
      tx.onerror = () => reject(tx.error)
    })
  })
  const cached = entries.filter(([key]) => key.startsWith('dovo.read-cache.v1.'))
  const index = cached.find(([key]) => key.endsWith('._index'))
  assert.equal(JSON.parse(index[1]).length, 100)
  assert.equal(cached.length, 101)
  await first.close()
  await second.close()
  const restarted = await open()
  await restarted.evaluate(() => window.restoreWorkspace())
  assert.equal(await restarted.evaluate(() => window.workspacePending()), null)
  assert.equal((await restarted.evaluate(() => window.workspaceDelivered)).length, 1)
  await restarted.evaluate(async () => {
    window.online = true
    await window.recover()
  })
  assert.deepEqual(await restarted.evaluate(() => window.pending()), [])
  const delivered = await restarted.evaluate(() => window.delivered)
  assert.deepEqual(
    delivered.map((item) => item.id),
    pending.map((item) => item.id),
  )
  assert.deepEqual(new Set(delivered.map((item) => item.input.messageId)), new Set(['0', '1']))
  // Moving a journal cannot erase edits accepted by another old-address tab.
  await restarted.evaluate(() => window.editWorkspace('name', 'Transferred name'))
  const transferred = await restarted.evaluate(() => window.transferWorkspace())
  const otherWriter = await open()
  await otherWriter.evaluate(() =>
    window.editWorkspace('instructions', 'Keep this old-address edit'),
  )
  await restarted.evaluate((outbox) => window.removeTransferred(outbox), transferred.outbox)
  const remaining = await otherWriter.evaluate(() => window.workspacePending())
  assert.equal(remaining.patches.length, 1)
  assert.equal(remaining.patches[0].changes.instructions.after, 'Keep this old-address edit')
  // A stale reader must not reappend records already acknowledged by a peer.
  const stale = await open()
  await stale.evaluate(async () =>
    window.workspaceSync.bind(window.connection, await window.workspacePending()),
  )
  await otherWriter.evaluate(() => window.flushWorkspace())
  assert.equal(await restarted.evaluate(() => window.workspacePending()), null)
  await stale.evaluate(() => window.editWorkspace('name', 'New edit after peer acknowledgement'))
  assert.equal((await stale.evaluate(() => window.workspacePending())).patches.length, 1)
  // Legacy version-1 journals acquire the same IDs in all readers.
  await stale.evaluate(() => window.legacyWorkspace())
  const legacy = await Promise.all([
    stale.evaluate(() => window.workspacePending()),
    restarted.evaluate(() => window.workspacePending()),
  ])
  assert.deepEqual(legacy[0].ids, legacy[1].ids)
  await restarted.evaluate(() => window.restoreWorkspace())
  assert.equal(await restarted.evaluate(() => window.workspacePending()), null)
  console.log(
    'Shared HTTP-origin storage checks passed: task UUIDs, cross-tab workspace/action durability, isolated acknowledgement and transfer, legacy recovery and transactional cache eviction.',
  )
} finally {
  await browser.close()
}
