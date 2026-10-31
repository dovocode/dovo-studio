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
import {createRoot} from 'react-dom/client';
import {useConversationHistory} from '${root}apps/mobile/src/tasks/conversation/state/use-conversation-history.ts';
const live={id:'thread',messages:[{id:'m650',role:'assistant',text:'latest'}],turns:[],historyBefore:'m650',historyRevision:1};
function App(){const history=useConversationHistory(live,false);window.historyState=history;return <div>{history.task.messages.length}</div>}
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
export const useRuntime=()=>({profile,connected:true,readCache:null,read});`,
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
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.unmount())
  console.log(
    'Mobile history memory: active reading range protected; old pages released after moving forward; evicted pages reload without gaps or duplicates.',
  )
} finally {
  await browser.close()
}
