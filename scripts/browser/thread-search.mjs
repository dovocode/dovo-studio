import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './harness.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';
import {useThreadSearch} from './packages/extension-tasks/src/chat/thread/use-thread-search';
window.calls=[];const request=(path,input)=>new Promise((resolve,reject)=>window.calls.push({input,reply:resolve,fail:()=>reject(new Error('Search failed'))}));
function App(){const[query,setQuery]=useState('needle'),[revision,setRevision]=useState(1),[before,setBefore]=useState('tail'),[connected,setConnected]=useState(true);window.workspace={connection:{address:'http://local.lan',token:'token'},connected,request};window.query=value=>flushSync(()=>setQuery(value));window.revise=()=>flushSync(()=>setRevision(n=>n+1));window.before=value=>flushSync(()=>setBefore(value));window.online=value=>flushSync(()=>setConnected(value));const search=useThreadSearch({id:'thread',messages:[],historyBefore:before,historyRevision:revision},query);window.result=search;
return <><span role="status">{search.matches.length}{search.loading?'…':search.hasMore?'+':''}</span><span role="alert">{search.error}</span><button disabled={search.loading||!search.hasMore} onClick={()=>void search.loadMore()}>Older matches</button></>};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [{ path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.workspace;' }],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const reply = async (index, start, count, nextBefore) =>
    page.evaluate(
      ({ index, start, count, nextBefore }) =>
        window.calls[index].reply({
          taskIds: ['thread'],
          hits: Array.from({ length: count }, (_, i) => ({
            taskId: 'thread',
            messageId: String(start - i),
            role: 'assistant',
            snippet: 'needle ' + (start - i),
          })),
          nextBefore,
        }),
      { index, start, count, nextBefore },
    )
  await page.getByRole('status').filter({ hasText: '0…' }).waitFor()
  await page.waitForFunction(() => window.calls.length === 1)
  await reply(0, 149, 50, '100')
  await page.getByRole('status').filter({ hasText: '50+' }).waitFor()
  await page.getByRole('button').click()
  await page.waitForFunction(() => window.calls.length === 2)
  assert.equal(await page.evaluate(() => window.calls[1].input.before), '100')
  await page.evaluate(() => window.calls[1].fail())
  await page.getByRole('alert').filter({ hasText: 'Search failed' }).waitFor()
  await page.getByRole('button').click()
  await page.waitForFunction(() => window.calls.length === 3)
  await reply(2, 99, 50, '50')
  await page.getByRole('status').filter({ hasText: '100+' }).waitFor()
  await page.evaluate(() => window.before('earlier-tail'))
  assert.equal(
    await page.evaluate(() => window.calls.length),
    3,
    'Loading history must not reset paged search',
  )
  await page.getByRole('button').click()
  await page.waitForFunction(() => window.calls.length === 4)
  await reply(3, 49, 50)
  await page.getByRole('status').filter({ hasText: /^150$/ }).waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.result.matches.map((m) => m.id)),
    Array.from({ length: 150 }, (_, i) => String(i)),
  )
  assert.equal(await page.getByRole('button').isDisabled(), true)
  await page.evaluate(() => window.revise())
  await page.waitForFunction(() => window.calls.length === 5)
  await reply(4, 200, 1, '200')
  await page.getByRole('status').filter({ hasText: '1+' }).waitFor()
  await page.getByRole('button').click()
  await page.waitForFunction(() => window.calls.length === 6)
  await page.evaluate(() => window.query('other'))
  await page.waitForFunction(() => window.calls.length === 7)
  await reply(6, 300, 1)
  await page.getByRole('status').filter({ hasText: /^1$/ }).waitFor()
  await reply(5, 199, 1)
  assert.deepEqual(
    await page.evaluate(() => window.result.matches.map((m) => m.id)),
    ['300'],
    'Old paged replies cannot replace another query',
  )
  await page.evaluate(() => window.query('needle'))
  await page.waitForFunction(() => window.calls.length === 8)
  await reply(7, 400, 1, '400')
  await page.getByRole('button').click()
  await page.waitForFunction(() => window.calls.length === 9)
  await reply(8, 399, 1, '400')
  await page.getByRole('alert').filter({ hasText: 'Search did not advance' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.result.matches.map((m) => m.id)), ['400'])
  await page.evaluate(() => window.online(false))
  await page.getByRole('status').filter({ hasText: /^0$/ }).waitFor()
  await page.evaluate(() => window.online(true))
  await page.waitForFunction(() => window.calls.length === 10)
  await reply(9, 500, 1)
  await page.getByRole('status').filter({ hasText: /^1$/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'In-thread search: all 150 matches, loading/count, older-page retry, retained pages, stale reply rejection, revision/reconnect refresh and repeated-cursor rejection passed.',
  )
} finally {
  await browser.close()
}
