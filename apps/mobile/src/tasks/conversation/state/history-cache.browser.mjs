import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from '../../../../../../scripts/browser/harness.mjs'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useConversationHistory} from '${root}apps/mobile/src/tasks/conversation/state/use-conversation-history.ts';
const live={id:'thread',messages:[{id:'new'}],turns:[],historyBefore:'new',historyRevision:1};
function App(){const history=useConversationHistory(live);window.historyState=history;return <div>{history.task.messages.map(message=>message.id).join(',')}</div>}
const root=createRoot(document.getElementById('app'));root.render(<App/>);window.unmount=()=>root.unmount();
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { react: root + 'apps/mobile/node_modules/react' },
    nodePaths: [root + 'apps/mobile/node_modules', root + 'node_modules'],
  },
  [
    {
      path: '@dovo/protocol',
      contents: `export {conversationPagesSize,trimConversationPages} from '${root}packages/protocol/src/conversation/history-retention.ts';export const conversationPageSchema={};export const compactConversationPages=pages=>pages;export const mergeConversationHistory=(live,pages)=>({...live,messages:[...new Map([...pages.flatMap(page=>page.messages),...live.messages].map(message=>[message.id,message])).values()]});`,
    },
    {
      path: 'react-native',
      contents: `export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/conversation/state/use-conversation-history.ts',
      contents: `
const profile={connection:{address:'http://localhost',token:'device'}};
const readCache={read:()=>new Promise((resolve,reject)=>{window.finishRestore=reject}),write:async()=>{window.writes++}};
const read=async()=>{window.reads++;return {messages:[{id:'old'}],turns:[],historyRevision:1}};
export const useRuntime=()=>({profile,connected:true,readCache,read});
`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.route('http://localhost/**', (route) =>
    route.fulfill({ body: '<div id="app"></div>', contentType: 'text/html' }),
  )
  await page.goto('http://localhost/')
  await page.evaluate(() => {
    window.reads = 0
    window.writes = 0
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => typeof window.finishRestore === 'function')
  assert.equal(await page.evaluate(() => window.reads), 0)
  await page.evaluate(() => window.finishRestore(new Error('storage unavailable')))
  await page.waitForFunction(() => window.reads === 1 && !window.historyState.busy)
  assert.deepEqual(await page.evaluate(() => window.historyState.task.messages.map((m) => m.id)), [
    'old',
    'new',
  ])
  assert.match(await page.evaluate(() => window.historyState.cacheError), /storage unavailable/)
  assert.equal(await page.evaluate(() => window.historyState.error), '')
  await page.evaluate(() => window.unmount())
  assert.equal(await page.evaluate(() => window.writes), 0)
  console.log(
    'Mobile history: failed cache hydration preserves storage and permits live pagination.',
  )
} finally {
  await browser.close()
}
