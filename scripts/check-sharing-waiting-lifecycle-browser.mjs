import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      loader: 'tsx',
      resolveDir: root + 'apps/web',
      contents: `
import {createRoot} from 'react-dom/client';
import {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting';
import {ThreadSharing} from '${root}apps/mobile/src/tasks/detail/thread-sharing';
import {ThreadSharing as DesktopThreadSharing} from '${root}packages/extension-tasks/src/chat/thread-sharing';
import {useSharingPeople} from '${root}packages/studio-core/src/use-sharing-people';
window.counts={};const count=name=>window.counts[name]=(window.counts[name]??0)+1;
window.active=true;window.online=true;window.session='a';window.key='key';
window.record={id:'share',source:'key:thread:runtime:task',kind:'thread',version:1,updatedAt:1,grants:[],packet:{generation:1},ownerBox:{ciphertext:'box'}};
const listeners=new Set();window.emit=()=>{for(const listener of listeners)listener()};
window.client={origin:'http://lan',sessionId:()=>window.session,snapshot:()=>({directory:{}}),
sharingService:async()=>{count('service');if(window.holdService)await new Promise(resolve=>window.releaseService=resolve);return 'http://lan'},
people:async()=>{count('people');const name=window.session;if(window.holdPeople)await new Promise(resolve=>window.releasePeople=resolve);return {friends:[{name}],organizations:[]}},
updatePeople:async()=>{count('updatePeople');return {friends:[],organizations:[]}},
sharing:{subscribe:f=>{listeners.add(f);return ()=>listeners.delete(f)},snapshot:()=>0,
syncKey:async()=>{count('syncKey')},recoveryKey:async()=>{count('key');return window.key},
list:async()=>{count('list');const {id,source,kind,version,updatedAt,ownerBox}=window.record;return [structuredClone({id,source,kind,version,updatedAt,ownerBox})]},source:(kind,id,key)=>key+':'+kind+':'+id,
refresh:async()=>{count('open');return {record:structuredClone(window.record),vault:{},content:{title:'version '+window.record.version}}}}};
window.call=async(path)=>{if(path!=='/api/sharing/status')throw new Error('Unexpected runtime call '+path);count('status');if(window.holdStatus)await new Promise(resolve=>window.releaseStatus=resolve);return {enabled:true,error:''}};
window.host={accountStorage:{},openExternalLink:async()=>{}};window.task={id:'task'};window.runtimeId='runtime';
const read=async input=>{count(input.unlink?'unlink':'waiting');if(window.holdRead)await new Promise(resolve=>window.releaseRead=resolve);return {dependencies:[]}};
function App(){window.waiting=useTaskWaiting('task',window.online,read,window.session,window.active);
window.people=useSharingPeople(window.client,window.active);return window.desktop?<DesktopThreadSharing taskId={window.task.id} title="Thread"/>:<ThreadSharing onClose={()=>{}}/>}
const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<App/>);window.render();
`,
    },
    alias: {
      react: root + 'packages/studio-core/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {sharedContentSchema,sharingStatusSchema} from '${root}packages/studio-core/src/use-encrypted-sharing';export const useWorkspace=()=>({request:window.call,connected:window.online,activeRuntimeId:window.runtimeId});export const useAccount=()=>({client:window.client,directory:{}});export const useAppPreferences=()=>({});export const useStudioHost=()=>window.host;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Button=({children,onClick})=><button onClick={onClick}>{children}</button>;export const Dialog=({children})=>children;export const DialogContent=Dialog;export const DialogDescription=Dialog;export const DialogTitle=Dialog;`,
    },
    {
      path: './thread-suggestions',
      importer: root + 'packages/extension-tasks/src/chat/thread-sharing.tsx',
      contents: `export const ThreadSuggestions=()=>null;`,
    },
    {
      path: './sharing-panel',
      importer: root + 'packages/extension-tasks/src/chat/thread-sharing.tsx',
      contents: `import {useEncryptedSharing} from '${root}packages/studio-core/src/use-encrypted-sharing';export const SharingPanel=props=>{window.sharing=useEncryptedSharing({...props,active:window.active});return null};`,
    },
    {
      path: '../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `export const useRuntime=()=>({call:window.call,activeId:window.runtimeId,connected:window.online});`,
    },
    {
      path: '../../runtime/connection/account-provider',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `export const useMobileAccount=()=>({client:window.client,directory:{}});`,
    },
    {
      path: '../conversation/state/provider',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `export const useTaskConversation=()=>({task:window.task});`,
    },
    {
      path: '../../ui/layout/sheet',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `export const Sheet=({children})=>children;`,
    },
    {
      path: '../../ui/content/thread-suggestions',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `export const ThreadSuggestions=()=>null;`,
    },
    {
      path: '../../ui/content/sharing-panel',
      importer: root + 'apps/mobile/src/tasks/detail/thread-sharing.tsx',
      contents: `import {useEncryptedSharing} from '${root}packages/studio-core/src/use-encrypted-sharing';export const SharingPanel=props=>{window.sharing=useEncryptedSharing({...props,client:window.client,active:window.active});return null};`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  for (const desktop of [false, true]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.setContent('<div id="app"></div>')
    await page.evaluate((desktop) => {
      window.desktop = desktop
    }, desktop)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (desktop) await page.getByRole('button', { name: 'Share thread', exact: true }).click()
    const ready = () =>
      page.waitForFunction(
        () =>
          window.sharing?.loaded &&
          !window.sharing.busy &&
          !window.waiting.busy &&
          !window.people.busy,
      )
    await ready()
    assert.equal(await page.evaluate(() => window.counts.open), 1)
    await page.clock.runFor(600_000)
    await ready()
    assert.equal(
      await page.evaluate(() => window.counts.open),
      1,
      'Unchanged authoritative list entries reuse the opened share',
    )
    assert.equal(
      await page.evaluate(() => window.counts.syncKey ?? 0),
      1,
      'Periodic loads leave recovery cadence to its owner',
    )
    const visibility = async (hidden) => {
      await page.evaluate((hidden) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: hidden ? 'hidden' : 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      }, hidden)
    }
    await visibility(true)
    const parked = await page.evaluate(() => ({ ...window.counts }))
    await page.clock.runFor(600_000)
    assert.deepEqual(
      await page.evaluate(() => window.counts),
      parked,
      'Hidden documents park all three hooks',
    )
    await page.evaluate(() => window.people.run({ kind: 'test' }))
    assert.equal(
      await page.evaluate(() => window.counts.updatePeople),
      1,
      'Explicit people actions remain available while hidden',
    )
    await page.evaluate(() => window.sharing.refresh())
    assert.equal(
      await page.evaluate(() => window.counts.syncKey),
      2,
      'Explicit recovery still runs while hidden',
    )
    await visibility(false)
    await ready()
    assert.ok(
      await page.evaluate((n) => window.counts.waiting > n, parked.waiting),
      'Foreground refreshes immediately',
    )
    for (const change of ['version', 'updatedAt', 'ownerBox']) {
      const before = await page.evaluate(() => window.counts.open)
      await page.evaluate((change) => {
        if (change === 'ownerBox') window.record.ownerBox.ciphertext += 'changed'
        else window.record[change]++
        window.emit()
      }, change)
      await page.waitForFunction((before) => window.counts.open === before + 1, before)
      await ready()
    }
    for (const change of ['grants', 'generation']) {
      const before = await page.evaluate(() => window.counts.open)
      await page.evaluate((change) => {
        window.record.version++
        if (change === 'grants') window.record.grants.push({ id: 'new-grant' })
        else window.record.packet.generation++
        window.emit()
      }, change)
      await page.waitForFunction((before) => window.counts.open === before + 1, before)
      await ready()
      assert.equal(
        await page.evaluate(
          (change) =>
            change === 'grants'
              ? window.sharing.share.record.grants.length
              : window.sharing.share.record.packet.generation,
          change,
        ),
        change === 'grants' ? 1 : 2,
      )
    }
    await page.evaluate(() => {
      window.holdStatus = true
      window.statusRefresh = window.sharing.refresh()
    })
    await page.waitForFunction(() => !!window.releaseStatus)
    await page.evaluate(() => {
      window.task = { ...window.task }
      window.render()
    })
    await page.waitForTimeout(20)
    await page.evaluate(() => {
      window.holdStatus = false
      window.releaseStatus()
    })
    await page.evaluate(() => window.statusRefresh)
    assert.equal(
      await page.evaluate(() => window.sharing.sync?.enabled),
      true,
      'A normal thread parent rerender preserves the runtime descriptor and accepts pending status',
    )
    await page.evaluate(() => {
      window.online = false
      window.render()
    })
    await page.waitForFunction(() => window.sharing.sync === null)
    await page.evaluate(() => {
      window.online = true
      window.render()
    })
    await page.waitForTimeout(20)
    await page.evaluate(() => window.sharing.refresh())
    assert.equal(await page.evaluate(() => window.sharing.sync?.enabled), true)
    await page.evaluate(() => {
      window.releaseStatus = null
      window.holdStatus = true
      window.statusRefresh = window.sharing.refresh()
    })
    await page.waitForFunction(() => !!window.releaseStatus)
    await page.evaluate(() => {
      window.online = false
      window.render()
    })
    await page.waitForFunction(() => window.sharing.sync === null)
    await page.evaluate(() => {
      window.holdStatus = false
      window.releaseStatus()
    })
    await page.evaluate(() => window.statusRefresh)
    assert.equal(
      await page.evaluate(() => window.sharing.sync),
      null,
      'Disconnect cannot restore pending online status',
    )
    await page.evaluate(() => {
      window.online = true
      window.render()
    })
    await page.waitForTimeout(20)
    await page.evaluate(() => {
      window.active = false
      window.render()
    })
    await page.waitForFunction(() => !window.sharing.busy)
    // Flush React's passive visibility effects before advancing the fake clock.
    await page.waitForTimeout(20)
    const inactive = await page.evaluate(() => ({ ...window.counts }))
    await page.clock.runFor(600_000)
    assert.deepEqual(
      await page.evaluate(() => window.counts),
      inactive,
      'Inactive views park without unmounting',
    )
    await page.evaluate(() => {
      window.holdRead = true
      window.readPromise = window.waiting.refresh()
    })
    await page.waitForFunction(() => !!window.releaseRead)
    await page.evaluate(() => {
      window.unlinkPromise = window.waiting.refresh({
        kind: 'pipeline',
        repositoryId: 'project',
        target: '1',
      })
      window.holdRead = false
      window.releaseRead()
    })
    await page.evaluate(() => window.unlinkPromise)
    assert.equal(
      await page.evaluate(() => window.counts.unlink),
      1,
      'Parking cannot discard a queued explicit unlink',
    )
    await page.evaluate(() => {
      window.releaseRead = null
      window.holdRead = true
      window.readPromise = window.waiting.refresh()
    })
    await page.waitForFunction(() => !!window.releaseRead)
    const unlinks = await page.evaluate(() => window.counts.unlink)
    await page.evaluate(() => {
      window.unlinkPromise = window.waiting.refresh({
        kind: 'pipeline',
        repositoryId: 'project',
        target: 'disconnect',
      })
      window.online = false
      window.render()
    })
    await page.waitForTimeout(20)
    await page.evaluate(() => {
      window.holdRead = false
      window.releaseRead()
    })
    await page.evaluate(() => window.unlinkPromise)
    assert.equal(await page.evaluate(() => window.counts.unlink), unlinks)
    assert.match(
      await page.evaluate(() => window.waiting.error),
      /Reconnect.*No changes were made/,
      'A queued confirmed unlink reports why it could not dispatch after disconnect',
    )
    await page.evaluate(() =>
      window.waiting.refresh({ kind: 'pipeline', repositoryId: 'project', target: 'offline' }),
    )
    assert.match(await page.evaluate(() => window.waiting.error), /Reconnect.*No changes were made/)
    assert.equal(await page.evaluate(() => window.counts.unlink), unlinks)
    const offline = await page.evaluate(() => window.counts.waiting)
    await page.evaluate(() => window.waiting.refresh())
    assert.equal(await page.evaluate(() => window.counts.waiting), offline)
    await page.evaluate(() => {
      window.online = true
      window.render()
    })
    await page.waitForTimeout(20)
    assert.equal(
      await page.evaluate(() => window.counts.unlink),
      unlinks,
      'Reconnect never replays offline writes',
    )
    await page.evaluate(() => {
      window.releaseRead = null
      window.holdRead = true
      window.readPromise = window.waiting.refresh()
    })
    await page.waitForFunction(() => !!window.releaseRead)
    await page.evaluate(() => {
      window.unlinkPromise = window.waiting.refresh({
        kind: 'pipeline',
        repositoryId: 'project',
        target: 'old-scope',
      })
      window.session = 'different-scope'
      window.render()
    })
    await page.waitForFunction(() => window.waiting.data === null)
    await page.evaluate(() => {
      window.holdRead = false
      window.releaseRead()
    })
    await page.evaluate(() => window.unlinkPromise)
    assert.equal(
      await page.evaluate(() => window.counts.unlink),
      unlinks,
      'Queued unlink cannot migrate across scopes',
    )
    await page.evaluate(() => {
      window.key = null
      window.emit()
      window.active = true
      window.render()
    })
    await page.waitForFunction(
      () => window.sharing.loaded && !window.sharing.hasKey && window.sharing.share === null,
    )
    await page.evaluate(() => {
      window.holdService = true
      window.pendingRefresh = window.sharing.refresh()
    })
    await page.waitForFunction(() => !!window.releaseService)
    await page.evaluate(() => {
      window.session = 'b'
      window.key = 'new'
      window.active = false
      window.render()
    })
    await page.waitForFunction(() => window.sharing.loaded === false)
    await page.evaluate(() => {
      window.holdService = false
      window.releaseService()
    })
    await page.evaluate(() => window.pendingRefresh)
    assert.equal(
      await page.evaluate(() => window.sharing.share),
      null,
      'Old session cannot publish pending state',
    )
    await page.evaluate(() => {
      window.holdPeople = true
      window.oldPeople = window.people.run()
    })
    await page.waitForFunction(() => !!window.releasePeople)
    await page.evaluate(() => {
      window.client = { ...window.client }
      window.render()
    })
    await page.waitForFunction(() => window.people.directory === null)
    await page.evaluate(() => {
      window.holdPeople = false
      window.releasePeople()
    })
    assert.equal(
      await page.evaluate(() => window.oldPeople),
      false,
      'A replacement client fences old directory responses even with the same origin and session',
    )
    assert.equal(await page.evaluate(() => window.people.directory), null)
    await page.evaluate(() => window.people.run())
    assert.equal(await page.evaluate(() => window.people.directory.friends[0].name), 'b')
    assert.deepEqual(errors, [])
    console.log(
      `${desktop ? 'Desktop' : 'Mobile'} sharing/waiting lifecycle: hidden/inactive parking, foreground refresh, unchanged metadata, key/session fences, explicit recovery, queued unlink disconnect/scope fencing and status rerenders passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
