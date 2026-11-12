import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';import {Effect} from 'effect';
import {useTaskSearch} from './apps/mobile/src/tasks/list/use-task-search';
import {requestMessageReveal,useMessageReveal,consumeMessageReveal} from './apps/mobile/src/tasks/conversation/message-reveal';
window.calls=[];window.aborts=[];
window.read=(profile,path,input)=>Effect.callback(resume=>{const call={id:profile.id,token:profile.connection.token,query:input.query,reply:snippet=>resume(Effect.succeed({taskIds:['child'],hits:[{taskId:'child',messageId:'old-message',role:'assistant',snippet}]})),fail:()=>resume(Effect.fail(new Error('Host unavailable')))};window.calls.push(call);return Effect.sync(()=>window.aborts.push(call.id+':'+call.query));});
function App(){const[cfg,setCfg]=useState({query:'needle',token:'first',online:true,source:'all',history:1,enabled:true});window.change=patch=>flushSync(()=>setCfg(old=>({...old,...patch})));const entries=['a','b'].filter(id=>cfg.source==='all'||cfg.source===id).map(id=>({profile:{id,name:'Computer '+id,connection:{address:'http://'+id+'.lan',token:id==='b'?cfg.token:'first'}},connected:id==='a'||cfg.online,snapshot:{workspace:{tasks:[{id:'child',status:'running',historyRevision:cfg.history}]}}}));const search=useTaskSearch(entries,cfg.query,cfg.enabled);window.search=search;const reveal=useMessageReveal();window.reveal=reveal;return <><div role="status">{search.loading?'Searching':'Settled'}</div><div role="alert">{search.error}</div>{search.offline&&<div>Offline computers</div>}{search.hits.map(hit=><button key={hit.runtimeId+hit.messageId} onClick={()=>requestMessageReveal(entries.find(entry=>entry.profile.id===hit.runtimeId).profile.connection,hit.taskId,hit.messageId)}>{hit.runtimeId+':'+hit.snippet}</button>)}<button onClick={()=>reveal&&consumeMessageReveal(reveal)}>Consume</button></>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/list/use-task-search.ts',
      contents: 'export const useRuntime=()=>({readRuntimeEffect:window.read});',
    },
    {
      path: '../../runtime/state/app-active',
      importer: root + 'apps/mobile/src/tasks/list/use-task-search.ts',
      contents: 'export const useAppActive=()=>true;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.calls.length === 2)
  await page.evaluate(() => window.calls[0].reply('fast excerpt'))
  await page.getByRole('button', { name: 'a:fast excerpt', exact: true }).waitFor()
  assert.equal(await page.getByRole('status').textContent(), 'Searching')
  await page.evaluate(() => window.calls[1].fail())
  await page.getByRole('alert').filter({ hasText: 'Computer b: Host unavailable' }).waitFor()
  assert.equal(await page.getByRole('status').textContent(), 'Settled')
  await page.getByRole('button', { name: 'a:fast excerpt', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.reveal), {
    scope: '["http://a.lan","first","child"]',
    messageId: 'old-message',
  })
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  assert.equal(await page.evaluate(() => window.reveal), null)
  await page.evaluate(() => window.change({ history: 2 }))
  await page.waitForFunction(() => window.calls.length === 4)
  // Keep useful results during a same-query history refresh.
  await page.getByRole('button', { name: 'a:fast excerpt', exact: true }).waitFor()
  await page.evaluate(() => window.change({ query: 'new needle' }))
  await page.waitForFunction(() => window.calls.length === 6)
  assert.equal(await page.getByRole('button', { name: 'a:fast excerpt', exact: true }).count(), 0)
  assert.ok(
    await page.evaluate(
      () => window.aborts.includes('a:needle') && window.aborts.includes('b:needle'),
    ),
  )
  await page.evaluate(() => {
    window.calls[2].reply('obsolete')
    window.calls[3].reply('obsolete')
    window.calls[4].reply('new A')
  })
  await page.getByRole('button', { name: 'a:new A', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /obsolete/ }).count(), 0)
  await page.evaluate(() => window.change({ token: 'second' }))
  await page.waitForFunction(() => window.calls.length === 8)
  assert.equal(await page.getByRole('button', { name: 'a:new A', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.calls[5].reply('old credential')
    window.calls[6].reply('same ID A')
    window.calls[7].reply('same ID B')
  })
  await page.getByRole('button', { name: 'b:same ID B', exact: true }).waitFor()
  await page.getByRole('button', { name: 'a:same ID A', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /old credential/ }).count(), 0)
  await page.getByRole('button', { name: 'b:same ID B', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.reveal), {
    scope: '["http://b.lan","second","child"]',
    messageId: 'old-message',
  })
  await page.evaluate(() => window.change({ source: 'b' }))
  await page.waitForFunction(() => window.calls.length === 9)
  assert.equal(await page.getByRole('button', { name: 'a:same ID A', exact: true }).count(), 0)
  await page.evaluate(() => window.change({ online: false }))
  await page.getByText('Offline computers', { exact: true }).waitFor()
  await page.evaluate(() => window.calls[8].reply('disconnected response'))
  assert.equal(await page.getByRole('button', { name: /disconnected response/ }).count(), 0)
  await page.waitForFunction(() => !window.search.loading)
  assert.deepEqual(errors, [])
  await page.close()
} finally {
  await browser.close()
}
console.log(
  'Mobile search publishes fast hosts, keeps partial results through failures, aborts obsolete reads, scopes credentials/queries/computers, and carries exact child-message targets.',
)
