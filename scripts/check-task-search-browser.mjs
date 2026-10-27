import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = root + 'packages/studio-ui/'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';
import {TaskSearchDialog} from './packages/extension-tasks/src/dialogs/task-search-dialog';
window.calls=[];window.opened=[];window.activeCalls=0;window.watches=[];window.stops=[];
const readRuntime=(profile,path,input)=>new Promise(resolve=>window.calls.push({owner:profile.id,token:profile.connection.token,query:input.query,reply:(snippet,taskId='shared')=>resolve({taskIds:[taskId],hits:[{taskId,messageId:'remote',snippet,role:'assistant'}]})}));
function App(){const[cfg,setCfg]=useState({owners:['a','b'],token:'first',online:true,missing:false,older:false}),[tick,setTick]=useState(0),[mode,setMode]=useState(null);window.change=patch=>flushSync(()=>setCfg(old=>({...old,...patch})));window.stream=()=>flushSync(()=>setTick(n=>n+1));
const profiles=['a','b'].filter(id=>id!=='b'||!cfg.missing).map(id=>({id,name:id,connection:{address:'http://'+id+'.lan',token:id==='b'?cfg.token:'first'}}));
window.workspace={activeRuntimeId:'a',connection:profiles[0].connection,runtimeRegistry:{profiles},readRuntime,request:async()=>{window.activeCalls++;return {taskIds:[],hits:[]}}};
const entries=cfg.owners.flatMap(id=>['shared',...(cfg.older?['older']:[])].map(taskId=>({key:JSON.stringify([id,taskId]),projectName:'Studio',source:{runtimeId:id,name:'Computer '+id,online:id==='a'||cfg.online},task:{id:taskId,title:(taskId==='older'?'Older settled thread ':'Thread ')+id,createdAt:'2026-10-24',draft:String(tick),messages:cfg.online?[]:[{id:'local',role:'user',text:'needle in saved messages'}]}})));
return <><button onClick={()=>setMode('messages')}>Search conversations</button><button onClick={()=>setMode('tasks')}>Go to task</button><TaskSearchDialog mode={mode} entries={entries} onModeChange={setMode} onClose={()=>setMode(null)} onSelect={(entry,messageId)=>window.opened.push({key:entry.key,messageId})}/></>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { react: ui + 'node_modules/react', 'react-dom': ui + 'node_modules/react-dom' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: 'export const useWorkspace=()=>window.workspace;',
    },
    {
      path: '@dovo/protocol',
      importer: root + 'packages/extension-tasks/src/dialogs/',
      contents: `export * from '${root}packages/protocol/src/index.ts';import {watchRuntimeSettled as watch} from '${root}packages/protocol/src/index.ts';export const watchRuntimeSettled=(connection,limit)=>{window.watches.push({connection,limit:limit??null});const stop=watch(connection,limit);return()=>{window.stops.push(connection);stop()}};`,
    },
    {
      path: '@dovo/studio-ui',
      importer: root + 'packages/extension-tasks/src/dialogs/',
      contents: `export {Dialog,DialogContent,DialogDescription,DialogTitle} from '${ui}src/components/ui/dialog';export {Input} from '${ui}src/components/ui/input';export {cn} from '${ui}src/lib/utils';`,
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const width of [390, 840]) {
    const page = await browser.newPage({
      viewport: { width, height: 700 },
      reducedMotion: 'reduce',
    })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html class="dark"><body><div id="app"></div></body></html>')
    for (const name of (await readdir(root + 'apps/desktop/dist/assets')).filter((n) =>
      n.endsWith('.css'),
    ))
      await page.addStyleTag({
        content: await readFile(root + 'apps/desktop/dist/assets/' + name, 'utf8'),
      })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Search conversations', exact: true }).click()
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true })
    const before = await input.boundingBox()
    await input.fill('needle')
    await page.getByRole('status').filter({ hasText: 'Searching conversations…' }).waitFor()
    assert.deepEqual(await input.boundingBox(), before, 'Loading keeps the search input anchored')
    await page.waitForFunction(() => window.calls.length === 2)
    await page.evaluate(() => {
      window.calls[0].reply('Old A')
      window.calls[1].reply('Old B')
    })
    await page.getByText('Old A', { exact: true }).waitFor()
    await page.getByText('Old B', { exact: true }).waitFor()
    assert.deepEqual(await input.boundingBox(), before, 'Results keep the search input anchored')
    await page.evaluate(() => {
      window.change({ owners: ['b'] })
      for (let i = 0; i < 10; i++) window.stream()
    })
    await page.getByText('Old A', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(
      await page.getByText('Old B', { exact: true }).count(),
      0,
      'Changing computers invalidates old results immediately',
    )
    await page.waitForFunction(() => window.calls.length === 3)
    await page.evaluate(() => window.calls[2].reply('Current B'))
    await page.getByText('Current B', { exact: true }).waitFor()
    await page.evaluate(() => window.change({ token: 'second' }))
    assert.equal(
      await page.getByText('Current B', { exact: true }).count(),
      0,
      'New pairing cannot reuse old pairing results',
    )
    await page.waitForFunction(() => window.calls.length === 4)
    assert.equal(await page.evaluate(() => window.calls[3].token), 'second')
    await page.evaluate(() => window.change({ online: false }))
    await page.getByText('needle in saved messages', { exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: 'Offline computers' }).waitFor()
    await page.evaluate(async () => {
      window.calls[3].reply('Obsolete reply')
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    assert.equal(await page.getByText('Obsolete reply', { exact: true }).count(), 0)
    await page.evaluate(() => window.change({ online: true, missing: true }))
    await page
      .getByRole('alert')
      .filter({ hasText: 'this computer connection is no longer available' })
      .waitFor()
    assert.equal(
      await page.evaluate(() => window.activeCalls),
      0,
      'A missing remote profile must never send its search to the active computer',
    )
    assert.equal(
      await page.evaluate(() => window.calls.length),
      4,
      'Streaming rerenders do not restart search requests',
    )
    await page.evaluate(() => window.change({ online: false }))
    await page.getByText('needle in saved messages', { exact: true }).waitFor()
    await input.press('ArrowDown')
    await input.press('Enter')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.opened), [
      { key: '["b","shared"]', messageId: 'local' },
    ])
    assert.equal(
      await page.evaluate(() => window.watches.length - window.stops.length),
      0,
      'Closing global search releases its full-list subscriptions',
    )
    await page.evaluate(() => window.change({ owners: ['a', 'b'], missing: false, online: true }))
    await page.getByRole('button', { name: 'Go to task', exact: true }).click()
    await page.waitForFunction(() => window.watches.length - window.stops.length === 2)
    assert.ok(
      await page.evaluate(() => window.watches.every((watch) => watch.limit === null)),
      'Global task and conversation search request complete summaries',
    )
    const taskInput = page.getByRole('combobox', { name: 'Go to task', exact: true })
    // Scope controls preserve normal Tab navigation and retain the query.
    await taskInput.press('Tab')
    await page.waitForFunction(() => document.activeElement?.textContent === 'Tasks')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => document.activeElement?.textContent === 'Messages')
    await page.keyboard.press('Shift+Tab')
    await page.waitForFunction(() => document.activeElement?.textContent === 'Tasks')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await taskInput.evaluate((node) => node === document.activeElement), true)
    await taskInput.fill('Thread')
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await input.waitFor()
    assert.equal(await input.inputValue(), 'Thread')
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await taskInput.waitFor()
    assert.equal(await taskInput.inputValue(), 'Thread')
    await taskInput.fill('Older settled')
    assert.equal(await page.getByRole('option').count(), 0)
    await page.evaluate(() => window.change({ older: true }))
    await page.getByText('Older settled thread a', { exact: true }).waitFor()
    await page.getByText('Older settled thread b', { exact: true }).waitFor()
    await taskInput.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.change({ older: false }))
    await page.getByRole('button', { name: 'Search conversations', exact: true }).click()
    const count = await page.evaluate(() => window.calls.length)
    await input.fill('needle')
    await page.waitForFunction((count) => window.calls.length === count + 2, count)
    await page.evaluate((count) => {
      window.calls[count].reply('Older result A', 'older')
      window.calls[count + 1].reply('Older result B', 'older')
    }, count)
    await page.waitForFunction(
      () => document.querySelector('[role="listbox"]').getAttribute('aria-busy') === 'false',
    )
    assert.equal(await page.getByRole('option').count(), 0)
    await page.evaluate(() => window.change({ older: true }))
    await page.getByText('Older result A', { exact: true }).waitFor()
    await page.getByText('Older result B', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(() => window.calls.length),
      count + 2,
      'Late summaries resolve saved search hits without another request',
    )
    await input.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.watches.length - window.stops.length), 0)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Search stays anchored, scopes results to computer/pairing, ignores obsolete replies, keeps offline messages, avoids streaming refetches and opens keyboard selections.',
  )
} finally {
  await browser.close()
}
