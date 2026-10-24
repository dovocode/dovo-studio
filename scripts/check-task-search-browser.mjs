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
window.calls=[];window.opened=[];window.activeCalls=0;
const readRuntime=(profile,path,input)=>new Promise(resolve=>window.calls.push({owner:profile.id,token:profile.connection.token,query:input.query,reply:snippet=>resolve({taskIds:['shared'],hits:[{taskId:'shared',messageId:'remote',snippet,role:'assistant'}]})}));
function App(){const[cfg,setCfg]=useState({owners:['a','b'],token:'first',online:true,missing:false}),[tick,setTick]=useState(0),[mode,setMode]=useState(null);window.change=patch=>flushSync(()=>setCfg(old=>({...old,...patch})));window.stream=()=>flushSync(()=>setTick(n=>n+1));
const profiles=['a','b'].filter(id=>id!=='b'||!cfg.missing).map(id=>({id,name:id,connection:{address:'http://'+id+'.lan',token:id==='b'?cfg.token:'first'}}));
window.workspace={activeRuntimeId:'a',connection:profiles[0].connection,runtimeRegistry:{profiles},readRuntime,request:async()=>{window.activeCalls++;return {taskIds:[],hits:[]}}};
const entries=cfg.owners.map(id=>({key:JSON.stringify([id,'shared']),projectName:'Studio',source:{runtimeId:id,name:'Computer '+id,online:id==='a'||cfg.online},task:{id:'shared',title:'Thread '+id,createdAt:'2026-10-24',draft:String(tick),messages:cfg.online?[]:[{id:'local',role:'user',text:'needle in saved messages'}]}}));
return <><button onClick={()=>setMode('messages')}>Search conversations</button><TaskSearchDialog mode={mode} entries={entries} onModeChange={setMode} onClose={()=>setMode(null)} onSelect={(entry,messageId)=>window.opened.push({key:entry.key,messageId})}/></>}
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
      importer: root + 'packages/extension-tasks/src/list/',
      contents: 'export const useWorkspace=()=>window.workspace;',
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
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Search stays anchored, scopes results to computer/pairing, ignores obsolete replies, keeps offline messages, avoids streaming refetches and opens keyboard selections.',
  )
} finally {
  await browser.close()
}
