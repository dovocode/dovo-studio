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
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {useConversationHistory} from '${root}apps/mobile/src/tasks/conversation/state/use-conversation-history.ts';
const live={id:'thread',messages:[{id:'m650',role:'assistant',text:'latest'}],turns:[],historyBefore:'m650',historyRevision:1};
function App(){const[current,setLive]=useState(live);const[mode,setMode]=useState(false);const[connected,setConnected]=useState(true);window.setLive=setLive;window.setHistoryMode=setMode;window.connected=connected;window.setConnected=setConnected;const history=useConversationHistory(current,mode);window.historyState=history;return <div>{history.task.messages.length}</div>}
const app=createRoot(document.getElementById('app'));app.render(<App/>);window.unmount=()=>app.unmount();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'apps/mobile/node_modules', root + 'node_modules'],
  },
  [
    {
      path: 'react-native',
      contents: `export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/conversation/state/use-conversation-history.ts',
      contents: `
const profile={connection:{address:'http://localhost',token:'memory-fixture-device-token'}};
const read=async(_path,{before})=>{window.requests.push(before);const end=Number(before.slice(1));const start=Math.max(0,end-50);return {messages:Array.from({length:end-start},(_,index)=>({id:'m'+(start+index),role:(start+index)%2?'assistant':'user',text:'x'.repeat(6000),bookmarked:start+index===1||start+index===649})),turns:[],before:start?'m'+start:undefined,historyRevision:1}};
const readCache={read:()=>new Promise(resolve=>{window.restoreHistory=()=>resolve(window.cachedHistory?{value:window.cachedHistory}:null)}),write:async()=>{}};export const useRuntime=()=>({profile,connected:window.connected,readCache:window.enableCache?readCache:null,read});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.evaluate(() => {
    window.requests = []
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.historyState)
  for (let index = 0; index < 13; index++) {
    await page.evaluate(() => window.historyState.load())
    await page.waitForFunction(
      (count) => !window.historyState.busy && window.historyState.task.messages.length === count,
      (index + 1) * 50 + 1,
    )
  }
  assert.equal(await page.evaluate(() => window.historyState.task.messages.length), 651)
  // A reader at the oldest loaded message is protected even beyond the budget.
  await page.evaluate(() => window.historyState.trim('m0'))
  assert.equal(await page.evaluate(() => window.historyState.task.messages[0].id), 'm0')
  assert.deepEqual(await page.evaluate(() => window.historyState.bookmarks), ['m1', 'm649'])
  // Moving forward releases old pages without losing the protected recent 500 messages.
  await page.evaluate(() => window.historyState.trim('m640'))
  await page.waitForFunction(() => window.historyState.task.messages.length < 651)
  const retained = await page.evaluate(() => ({
    count: window.historyState.task.messages.length,
    first: window.historyState.task.messages[0].id,
    last: window.historyState.task.messages.at(-1).id,
    more: window.historyState.hasMore,
  }))
  assert.ok(retained.count >= 500 && retained.count < 651)
  assert.deepEqual(
    await page.evaluate(() => window.historyState.bookmarks),
    ['m1', 'm649'],
    'eviction retains bookmark navigation IDs',
  )
  assert.equal(retained.last, 'm650')
  assert.equal(retained.more, true, 'evicted history remains accessible')
  await page.evaluate(() => window.historyState.load())
  await page.waitForFunction(
    (count) => !window.historyState.busy && window.historyState.task.messages.length === count + 50,
    retained.count,
  )
  assert.equal(await page.evaluate(() => window.requests.at(-1)), retained.first)
  const messages = await page.evaluate(() =>
    window.historyState.task.messages.map((message) => message.id),
  )
  assert.equal(new Set(messages).size, messages.length)
  assert.equal(messages.at(-1), 'm650')
  // Opening fills nearest older pages automatically after the latest reply lays out.
  await page.evaluate(() => {
    window.setHistoryMode(false)
    window.setLive({
      id: 'opening',
      messages: [{ id: 'm650', role: 'assistant', text: 'Latest' }],
      turns: [],
      historyBefore: 'm650',
      historyRevision: 1,
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'opening')
  const openingRequests = await page.evaluate(() => window.requests.length)
  assert.equal(await page.evaluate(() => window.historyState.task.messages.length), 1)
  await page.evaluate(() => window.setHistoryMode(true))
  await page.waitForFunction(
    () => !window.historyState.busy && window.historyState.task.messages.length >= 500,
  )
  assert.equal(await page.evaluate(() => window.requests.length), openingRequests + 10)
  assert.equal(await page.evaluate(() => window.historyState.task.messages.at(-1).text), 'Latest')
  assert.deepEqual(
    await page.evaluate(() => window.requests.slice(-10)),
    Array.from({ length: 10 }, (_, index) => 'm' + (650 - index * 50)),
  )
  // Delayed cache hydration also fills automatically; live text wins on overlap.
  await page.evaluate(() => {
    window.enableCache = true
    window.cachedHistory = {
      messages: Array.from({ length: 51 }, (_, i) => ({
        id: 'm' + (600 + i),
        role: 'assistant',
        text: 'Cached ' + i,
      })),
      turns: [],
      historyRevision: 1,
    }
    window.restoreHistory = undefined
    window.setLive({
      id: 'cached-opening',
      messages: [{ id: 'm650', role: 'assistant', text: 'Live latest' }],
      turns: [],
      historyBefore: 'm650',
      historyRevision: 1,
    })
  })
  await page.waitForFunction(
    () =>
      window.historyState.task.id === 'cached-opening' &&
      typeof window.restoreHistory === 'function',
  )
  const cachedRequests = await page.evaluate(() => window.requests.length)
  assert.equal(await page.evaluate(() => window.historyState.task.messages.length), 1)
  await page.evaluate(() => window.restoreHistory())
  await page.waitForFunction(() => window.historyState.task.messages.length === 51)
  assert.equal(
    await page.evaluate(() => window.historyState.task.messages.at(-1).text),
    'Live latest',
  )
  assert.equal(await page.evaluate(() => window.requests.length), cachedRequests)
  assert.equal(await page.evaluate(() => window.historyState.hasMore), false)
  // Offline opening and reconnect keep the restored window without manual loading.
  await page.evaluate(() => {
    window.setConnected(false)
    window.setLive({ id: 'offline-opening', messages: [], turns: [], historyRevision: 1 })
    window.restoreHistory = undefined
  })
  await page.waitForFunction(() => typeof window.restoreHistory === 'function')
  await page.evaluate(() => window.restoreHistory())
  await page.waitForFunction(() => window.historyState.task.messages.length === 51)
  const offlineRequests = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => {
    window.setConnected(true)
    window.setLive({
      id: 'offline-opening',
      messages: [{ id: 'm650', role: 'assistant', text: 'Live again' }],
      turns: [],
      historyBefore: 'm650',
      historyRevision: 1,
    })
  })
  await page.waitForFunction(() => window.historyState.task.messages.at(-1)?.text === 'Live again')
  assert.equal(await page.evaluate(() => window.historyState.task.messages.length), 51)
  assert.equal(await page.evaluate(() => window.requests.length), offlineRequests)
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.unmount())
  console.log(
    'Mobile history: automatic newest-first history fill, delayed cache restoration and offline/reconnect restoration; reading ranges protected and evicted pages reload without gaps or duplicates.',
  )
} finally {
  await browser.close()
}
