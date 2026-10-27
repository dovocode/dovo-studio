import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

// Ordinary HTTP is intentional: Web Locks/WebCrypto must not be prerequisites.
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
      import { Effect, Schema } from 'effect';
      import { RuntimeMutations } from './packages/protocol/src/runtime/connection/mutations.ts';
      import { browserMutationStorage, browserReadCache, readWorkspaceOutbox, writeWorkspaceOutbox, readWorkspaceDocument, updateWorkspaceDocument } from './packages/studio-core/src/workspace/read-cache.ts';
      import { readRuntimeRegistry, writeRuntimeRegistry, mergeRuntimeRegistry } from './packages/studio-core/src/workspace/runtime-registry.ts';
      import { runtimeProfile, upsertRuntime, removeRuntime, writeRuntimeSnapshotCache, cachedRuntimeThread, decode, snapshotSchema } from '@dovo/protocol';
      window.readRegistry = async () => { window.registry = await readRuntimeRegistry(); return window.registry; };
      window.addComputer = async address => { window.registry = await writeRuntimeRegistry(upsertRuntime(window.registry, runtimeProfile({address,token:'registry-test-token-at-least-32-characters'}))); };
      window.clearSelection = async () => { window.registry = await writeRuntimeRegistry({...window.registry,activeId:null}); };
      import { WorkspaceSynchronization } from './packages/studio-core/src/runtime/synchronization.ts';
      import { createTask } from './packages/studio-core/src/workspace/actions.ts';
      window.Schema=Schema;
      window.connection = {address:'http://runtime.lan:4310',token:'test-device'};
      const queue = new RuntimeMutations(browserMutationStorage);
      window.enqueue = messageId => Effect.runPromise(queue.requestEffect(window.connection, '/api/tasks/message', {messageId}, Schema.Struct({ok:Schema.Boolean})));
      window.recover = () => Effect.runPromise(queue.recoverEffect(window.connection));
      window.pending = () => browserMutationStorage.read(window.connection);
      window.cache = browserReadCache(window.connection);
      window.cachedString = key => window.cache.read(key, Schema.String);
      window.forgottenConnection = {address:'http://forget-runtime.lan:4310',token:'forget-device-token-at-least-32-characters'};
      window.repairConnection = {...window.forgottenConnection,token:'replacement-device-token-at-least-32-characters'};
      window.openForgotten = connection => {window.forgotten = browserReadCache(connection??window.forgottenConnection)};
      window.pairForgotten = async connection => {
        const registry=await readRuntimeRegistry();
        await writeRuntimeRegistry(upsertRuntime(registry,runtimeProfile(connection??window.forgottenConnection)));
      };
      window.forgetComputer = async () => {
        const registry=await readRuntimeRegistry();
        await writeRuntimeRegistry(removeRuntime(registry,window.forgottenConnection.address));
        await window.forgotten.clear();
      };
      window.warmForgottenReplica = () => Effect.runPromise(writeRuntimeSnapshotCache(window.forgotten,{snapshot:decode(snapshotSchema,{
        revision:1,workspace:{version:1,runtimeAddress:'',tasks:[{id:'private-task',title:'Private',repositoryId:'',agentId:'',status:'draft',createdAt:'2026-10-27',draft:'',example:false,messages:[{id:'message',role:'user',text:'Private history'}],files:[]}],repositories:[],automations:[],agents:[]},approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],owner:false
      }),lastSeen:null,pulls:null}));
      window.hasForgottenReplica = () => !!cachedRuntimeThread(window.forgotten,'private-task');
      window.enableRegistryBridge = async () => {
        const initial=await readRuntimeRegistry();
        await updateWorkspaceDocument('fixture.encrypted-registry', current=>current??JSON.stringify(initial));
        window.dovo={
          readRuntimeRegistry:()=>readWorkspaceDocument('fixture.encrypted-registry'),
          writeRuntimeRegistry:async(value,before)=>{
            const saved=await updateWorkspaceDocument('fixture.encrypted-registry',raw=>JSON.stringify(mergeRuntimeRegistry(JSON.parse(raw),JSON.parse(before),JSON.parse(value))));
            if(window.registryAckGate){window.registryWriteCommitted=true;await window.registryAckGate}
            return saved;
          },
          subscribeRuntimeRegistry:()=>()=>{},
        };
        await readRuntimeRegistry();
      };
      window.holdRegistryCacheCommit = () => {
        window.registryCacheCommitReady=false;
        window.registryCacheCommitGate=new Promise(resolve=>window.releaseRegistryCacheCommit=resolve);
      };
      window.beforeRegistryCacheCommit = async () => {
        if(window.registryCacheCommitGate){window.registryCacheCommitReady=true;await window.registryCacheCommitGate}
      };
      window.holdRegistryAck = () => {
        window.registryWriteCommitted=false;
        window.registryAckGate=new Promise(resolve=>window.releaseRegistryAck=resolve);
      };
      window.holdCacheWrite = () => {
        window.blockedCacheWrite=false;
        window.cacheWriteGate=new Promise(resolve=>window.releaseCacheWrite=resolve);
      };
      window.beforeCacheWrite = async key => {
        if(!window.cacheWriteGate)return;
        window.blockedCacheWrite=true;
        await window.cacheWriteGate;
      };
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
      window.startConflict = async (peer) => {
        window.connection = {...window.connection,token:'conflict-test-device'};
        window.workspaceSync.bind(window.connection);
        const patches = peer
          ? [{collection:'agents',id:'agent',changes:{instructions:{before:'Before',after:'Peer instructions'}}}]
          : [
              {collection:'agents',id:'agent',changes:{name:{before:'Before',after:'Intermediate'}}},
              {collection:'agents',id:'agent',changes:{name:{before:'Intermediate',after:'Latest edit'}}},
            ];
        window.workspaceSync.enqueue(patches,{...base,agents:[{...base.agents[0],name:peer?'Before':'Latest edit',instructions:peer?'Peer instructions':'Before'}]});
        await Effect.runPromise(window.workspaceSync.savedEffect());
      };
      window.conflictHost = {...base,agents:[{...base.agents[0],name:'Changed on host'}]};
      window.resolveWorkspace = () => window.workspaceSync.resolve(window.workspaceSync.conflicts(window.conflictHost)[0], 'host', window.conflictHost, window.workspaceSync.checkpoint());

      window.flushWorkspace = () => window.workspaceSync.flush();
      window.restoreWorkspace = async () => {
        window.workspaceSync.bind(window.connection, await window.workspacePending());
        window.workspaceSync.clearNetworkError();
        await window.workspaceSync.flush();
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
  // Pause before the real IndexedDB write transaction, never inside it (which would
  // correctly serialize clear after the write). Both pages still use production storage.
  plugins: [
    {
      name: 'cache-write-gate',
      setup(build) {
        build.onLoad(
          { filter: /packages\/studio-core\/src\/workspace\/read-cache\.ts$/ },
          async (args) => {
            const source = await readFile(args.path, 'utf8')
            const marker = 'export async function readWorkspaceDocument'
            const patched = source
              .replace(
                'const registry = await readRegistry()',
                'const registry = await readRegistry(); await window.beforeRegistryCacheCommit?.()',
              )
              .replace('const storage: CacheStorage = {', 'const originalStorage: CacheStorage = {')
              .replace(
                marker,
                `const storage: CacheStorage = new Proxy(originalStorage, {get(target,key){const method=Reflect.get(target,key);if(key!=='setItem'&&key!=='writeIndexedItem')return method;return async (...args)=>{await window.beforeCacheWrite?.(args[0]);return Reflect.apply(method,target,args)}}});\n${marker}`,
              )
            assert.notEqual(patched, source)
            return { contents: patched, loader: 'ts' }
          },
        )
      },
    },
  ],
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
  await first.evaluate(() => window.readRegistry())
  await first.evaluate(() => window.addComputer('http://first-runtime.lan:8787'))
  await Promise.all([first, second].map((page) => page.evaluate(() => window.readRegistry())))
  await first.evaluate(() => window.addComputer('http://new-runtime.lan:8787'))
  await second.evaluate(() => window.clearSelection())
  const savedRegistry = await first.evaluate(() => window.readRegistry())
  assert.equal(savedRegistry.profiles.length, 2, 'A stale tab must preserve another tab pairing')
  assert.equal(savedRegistry.activeId, null)
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
  // Migrate an older index and enforce the same byte budget across independent tabs.
  await first.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('dovo-read-cache', 1)
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const entries = tx.objectStore('entries')
      const keys = entries.getAllKeys()
      keys.onsuccess = () => {
        for (const key of keys.result.filter((key) => String(key).endsWith('._index'))) {
          const index = entries.get(key)
          index.onsuccess = () =>
            entries.put(JSON.stringify(JSON.parse(index.result).map((entry) => entry.key)), key)
        }
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  })
  await first.evaluate(() => window.cache.write('large:one', '€'.repeat(4 * 1024 * 1024)))
  await second.evaluate(() => window.cache.write('large:two', '€'.repeat(4 * 1024 * 1024)))
  await first.evaluate(() => window.cache.write('large:three', '€'.repeat(4 * 1024 * 1024)))
  assert.equal(
    await second.evaluate(async () => (await window.cachedString('large:one')) === null),
    true,
  )
  // Independent JS contexts: forgetting must fence both delayed writes and new handles
  // created from a stale registry, while other computers and explicit re-pairing work.
  await first.evaluate(() => window.pairForgotten())
  await Promise.all([first, second].map((page) => page.evaluate(() => window.openForgotten())))
  await first.evaluate(() => window.forgotten.write('snapshot', 'old snapshot'))
  await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))
  for (const key of ['snapshot', 'conversation:late']) {
    if (key !== 'snapshot') {
      await first.evaluate(() => window.pairForgotten())
      await Promise.all([first, second].map((page) => page.evaluate(() => window.openForgotten())))
      await first.evaluate(() => window.forgotten.write('snapshot', 'old snapshot'))
    }
    await second.evaluate(() => window.warmForgottenReplica())
    assert.equal(await second.evaluate(() => window.hasForgottenReplica()), true)
    await second.evaluate((key) => {
      window.holdCacheWrite()
      window.delayedWrite = window.forgotten.write(key, 'must not return')
    }, key)
    await second.waitForFunction(() => window.blockedCacheWrite)
    await first.evaluate(() => window.forgetComputer())
    assert.equal(
      await second.evaluate(() => window.hasForgottenReplica()),
      false,
      'Forget invalidates decoded in-memory history in another page',
    )
    await second.evaluate(async () => {
      window.releaseCacheWrite()
      await window.delayedWrite
      window.cacheWriteGate = null
    })
    assert.equal(
      await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String)),
      null,
    )
    await second.evaluate(() => window.openForgotten())
    await second.evaluate(() => window.forgotten.write('stale-new-handle', 'must not return'))
    assert.equal(
      await second.evaluate(() => window.forgotten.read('stale-new-handle', window.Schema.String)),
      null,
    )
    const rows = await second.evaluate(async () => {
      const request = indexedDB.open('dovo-read-cache', 1)
      const db = await new Promise((resolve) => (request.onsuccess = () => resolve(request.result)))
      return new Promise((resolve) => {
        const tx = db.transaction('entries')
        const all = tx.objectStore('entries').getAll()
        const keys = tx.objectStore('entries').getAllKeys()
        tx.oncomplete = () => {
          db.close()
          resolve(keys.result.map((key, index) => [key, all.result[index]]))
        }
      })
    })
    assert.equal(
      rows.some(([, raw]) => typeof raw === 'string' && raw.includes('must not return')),
      false,
      'Forgotten snapshots/index entries must not be resurrected by a second page',
    )
    const forgottenPrefix = `dovo.read-cache.v1.${createHash('sha256').update('http://forget-runtime.lan:4310').digest('hex')}.`
    assert.equal(
      rows.some(([key]) => String(key).startsWith(forgottenPrefix)),
      false,
      'No snapshot, freshness, conversation or index row may remain',
    )
    assert.ok(
      await first.evaluate(() => window.cachedString('large:three')),
      'Other computer stays cached',
    )
  }
  await second.evaluate(() => {
    window.oldForgotten = window.forgotten
  })
  await first.evaluate(() => window.pairForgotten(window.repairConnection))
  await first.evaluate(() => window.openForgotten(window.repairConnection))
  await first.evaluate(() => window.forgotten.write('snapshot', 'newly paired snapshot'))
  await second.evaluate(() => window.openForgotten(window.repairConnection))
  await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))
  await second.evaluate(() => window.oldForgotten.clear())
  assert.equal(
    await second.evaluate(() => window.forgotten.closed),
    false,
    'An old handle cannot close a later pairing handle',
  )
  assert.equal(
    (await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'newly paired snapshot',
  )
  assert.equal(
    (await first.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'newly paired snapshot',
  )
  await second.evaluate(() => window.openForgotten())
  await second.evaluate(() => window.forgotten.write('snapshot', 'old credential after repair'))
  await second.evaluate(() => {
    window.openForgotten()
    window.invalidCredentialHandle = window.forgotten
    window.openForgotten(window.repairConnection)
  })
  await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))
  await second.evaluate(() => window.invalidCredentialHandle.clear())
  assert.equal(
    await second.evaluate(() => window.forgotten.closed),
    false,
    'A newly constructed unapproved credential must not close an authorized handle',
  )
  assert.equal(
    (await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'newly paired snapshot',
  )
  await second.evaluate(() => window.openForgotten())
  assert.equal(
    await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String)),
    null,
  )
  // Simulate Electron's encrypted main-process bridge using an independent durable
  // registry document. Pause its acknowledgement after commit, then forget in A.
  await first.evaluate(() => window.enableRegistryBridge())
  await second.evaluate(() => window.enableRegistryBridge())
  for (const token of [
    'third-device-token-at-least-32-characters',
    'third-device-token-at-least-32-characters',
  ]) {
    await first.evaluate(() => window.forgetComputer())
    await second.evaluate((token) => {
      window.holdRegistryAck()
      window.delayedPair = window.pairForgotten({ ...window.forgottenConnection, token })
    }, token)
    await second.waitForFunction(() => window.registryWriteCommitted)
    await first.evaluate(() => window.forgetComputer())
    await second.evaluate(async () => {
      window.releaseRegistryAck()
      await window.delayedPair
      window.registryAckGate = null
    })
    await second.evaluate(
      (token) => window.openForgotten({ ...window.forgottenConnection, token }),
      token,
    )
    await second.evaluate(() =>
      window.forgotten.write('snapshot', 'delayed authorization must stay forgotten'),
    )
    assert.equal(
      await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String)),
      null,
      'Delayed encrypted-registry acknowledgement cannot reactivate forgotten credentials',
    )
    await first.evaluate(() => window.readRegistry())
    await first.evaluate(() => window.clearSelection())
    await second.evaluate(() => window.forgotten.write('snapshot', 'selection must not reactivate'))
    assert.equal(
      await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String)),
      null,
    )
    await first.evaluate(
      (token) => window.pairForgotten({ ...window.forgottenConnection, token }),
      token,
    )
    await first.evaluate(
      (token) => window.openForgotten({ ...window.forgottenConnection, token }),
      token,
    )
    await first.evaluate(() => window.forgotten.write('snapshot', 'explicit new pairing'))
    assert.equal(
      (await first.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
      'explicit new pairing',
    )
  }
  // Both registry reads precede the cache commits: B adds, then A removes; B wins
  // the first generation CAS. A must reconcile the latest registry after losing it.
  await first.evaluate(() => window.forgetComputer())
  await second.evaluate(() => {
    window.holdRegistryCacheCommit()
    window.operation = window.pairForgotten({
      ...window.forgottenConnection,
      token: 'interleaved-device-token-at-least-32-characters',
    })
  })
  await second.waitForFunction(() => window.registryCacheCommitReady)
  await first.evaluate(() => {
    window.holdRegistryCacheCommit()
    window.operation = window.forgetComputer()
  })
  await first.waitForFunction(() => window.registryCacheCommitReady)
  await second.evaluate(async () => {
    window.releaseRegistryCacheCommit()
    await window.operation
    window.registryCacheCommitGate = null
  })
  await first.evaluate(async () => {
    window.releaseRegistryCacheCommit()
    await window.operation
    window.registryCacheCommitGate = null
  })
  await second.evaluate(() =>
    window.openForgotten({
      ...window.forgottenConnection,
      token: 'interleaved-device-token-at-least-32-characters',
    }),
  )
  await second.evaluate(() =>
    window.forgotten.write('snapshot', 'losing removal must still revoke'),
  )
  assert.equal(
    await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String)),
    null,
  )
  // The inverse order: A's removal acknowledgement is late after B has repaired.
  // Reconcile current registry on conflict instead of unconditionally revoking B.
  await second.evaluate(() => window.pairForgotten(window.repairConnection))
  await first.evaluate(() => {
    window.holdRegistryCacheCommit()
    window.operation = window.forgetComputer()
  })
  await first.waitForFunction(() => window.registryCacheCommitReady)
  await second.evaluate(() => window.pairForgotten(window.repairConnection))
  await second.evaluate(() => window.openForgotten(window.repairConnection))
  await second.evaluate(() =>
    window.forgotten.write('snapshot', 'later legitimate pairing survives'),
  )
  await first.evaluate(async () => {
    window.releaseRegistryCacheCommit()
    await window.operation
    window.registryCacheCommitGate = null
  })
  assert.equal(
    await second.evaluate(() => window.forgotten.closed),
    false,
    'A losing reconciliation must preserve the already-authorized handle',
  )
  assert.equal(
    (await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'later legitimate pairing survives',
  )
  // A previously unseen host still needs an initial fence so its first re-pairing
  // can win against an older removal. Existing offline data migrates without deletion.
  await Promise.all(
    [first, second].map((page) =>
      page.evaluate(() => {
        window.forgottenConnection = {
          address: 'http://initial-runtime.lan:4310',
          token: 'initial-device-token-at-least-32-characters',
        }
        window.repairConnection = { ...window.forgottenConnection }
        window.openForgotten()
      }),
    ),
  )
  await first.evaluate(() => window.forgotten.write('snapshot', 'pre-registration offline replica'))
  await first.evaluate(() => window.pairForgotten())
  await first.evaluate(() => window.openForgotten())
  assert.equal(
    (await first.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'pre-registration offline replica',
    'Initial registration retains migrated offline data',
  )
  await first.evaluate(() => {
    window.holdRegistryCacheCommit()
    window.operation = window.forgetComputer()
  })
  await first.waitForFunction(() => window.registryCacheCommitReady)
  await second.evaluate(() => window.pairForgotten())
  await second.evaluate(() => window.openForgotten())
  await second.evaluate(() => window.forgotten.write('snapshot', 'fresh host pairing survives'))
  await first.evaluate(async () => {
    window.releaseRegistryCacheCommit()
    await window.operation
    window.registryCacheCommitGate = null
  })
  assert.equal(
    await second.evaluate(() => window.forgotten.closed),
    false,
    'The first removal cannot revoke an intervening initial-host re-pairing',
  )
  assert.equal(
    (await second.evaluate(() => window.forgotten.read('snapshot', window.Schema.String))).value,
    'fresh host pairing survives',
  )
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
  // Replace dependent records at their original positions and preserve a peer's edit.
  await restarted.evaluate(() => window.startConflict(false))
  await stale.evaluate(() => window.startConflict(true))
  const beforeResolution = await restarted.evaluate(() => window.workspacePending())
  await stale.evaluate(async () =>
    window.workspaceSync.bind(window.connection, await window.workspacePending()),
  )
  await restarted.evaluate(() => window.resolveWorkspace())
  const resolved = await restarted.evaluate(() => window.workspacePending())
  assert.equal(resolved.patches.length, 3)
  assert.notEqual(resolved.ids[0], beforeResolution.ids[0])
  assert.notEqual(resolved.ids[1], beforeResolution.ids[1])
  assert.equal(resolved.ids[2], beforeResolution.ids[2])
  assert.equal(resolved.patches[0].changes.name.after, 'Changed on host')
  assert.equal(resolved.patches[1].changes.name.before, 'Changed on host')
  assert.equal(resolved.workspace.agents[0].name, 'Changed on host')
  assert.equal(resolved.workspace.agents[0].instructions, 'Peer instructions')
  const staleResolution = await stale.evaluate(() =>
    window.resolveWorkspace().then(
      () => '',
      (error) => error.message,
    ),
  )
  assert.match(staleResolution, /changed in another window/)
  assert.deepEqual(await restarted.evaluate(() => window.workspacePending()), resolved)
  await restarted.evaluate(() => window.flushWorkspace())
  const peerRemaining = await restarted.evaluate(() => window.workspacePending())
  assert.equal(peerRemaining.patches.length, 1)
  assert.equal(peerRemaining.patches[0].changes.instructions.after, 'Peer instructions')
  await restarted.evaluate(() => window.restoreWorkspace())
  assert.equal(await restarted.evaluate(() => window.workspacePending()), null)
  console.log(
    'Shared HTTP-origin storage checks passed: task UUIDs, cross-tab workspace/action durability, isolated acknowledgement and transfer, legacy recovery, individual conflict resolution and transactional cache eviction, cross-page forget fences, decoded-history invalidation and delayed encrypted-registry pairing receipts.',
  )
} finally {
  await browser.close()
}
