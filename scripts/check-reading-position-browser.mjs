import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': 'export const reducedMotion=()=>true;',
  '@dovo/studio-core/state': "export {useState as useApplicationState} from 'react';",
  '@dovo/protocol': `export * from '${root}packages/protocol/src/conversation/reading-position.ts';`,
}
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {Conversation,ConversationContent,ConversationHistory} from '${root}packages/studio-ui/src/components/ai-elements/conversation.tsx';
function Thread({scope}){const[start,setStart]=useState(scope.startsWith('a')?20:0);const[busy,setBusy]=useState(false);const[height,setHeight]=useState(0);const[active,setActive]=useState(true);window.showThread=setActive;window.grow=()=>setHeight(400);const load=useCallback(()=>{window.loads++;setBusy(true);setTimeout(()=>{setStart(0);setBusy(false)},window.delay??20)},[]);return <Conversation style={{height:500,display:active?'flex':'none',flexDirection:'column'}}><ConversationHistory active={active} positionKey={scope} hasEarlier={start>0} loadingEarlier={busy} onLoadEarlier={start>0&&!busy?load:undefined}><ConversationContent data-content style={{display:'flex',flexDirection:'column',padding:0}}>{busy&&<span>Loading earlier</span>}{Array.from({length:40-start},(_,i)=>start+i).map(i=><section data-conversation-anchor id={scope+'-row-'+i} key={i} style={{height:100+i*3,flexShrink:0}}>Row {i}</section>)}<div style={{height,flexShrink:0}}/></ConversationContent></ConversationHistory></Conversation>}
function App(){const[scope,setScope]=useState('a-token1');window.openThread=setScope;return <Thread key={scope} scope={scope}/>};window.loads=0;createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>*{box-sizing:border-box}body{margin:0}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.overflow-y-hidden{overflow-y:hidden}.min-h-0{min-height:0}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const scroller = page.locator('[role=log] > div')
  await page.waitForFunction(() => {
    const e = document.querySelector('[role=log] > div')
    return e && e.scrollHeight - e.clientHeight - e.scrollTop < 3
  })
  // User scrolls to a row in the current page, then loads older messages and keeps reading.
  await scroller.dispatchEvent('wheel')
  await scroller.evaluate((e) => {
    e.scrollTop = 0
    e.dispatchEvent(new Event('scroll'))
  })
  await page.waitForSelector('#a-token1-row-10')
  await scroller.evaluate((e) => {
    const row = document.getElementById('a-token1-row-10')
    e.scrollTop += row.getBoundingClientRect().top - e.getBoundingClientRect().top + 27
    e.dispatchEvent(new Event('scroll'))
  })
  await page.waitForFunction(
    () => Math.abs(document.getElementById('a-token1-row-10').getBoundingClientRect().top + 27) < 2,
  )
  // Capture runs on an animation frame; navigation cleanup also records synchronously.
  await page.evaluate(() => window.openThread('b-token1'))
  await page.waitForSelector('#b-token1-row-10')
  await page.waitForFunction(() => {
    const e = document.querySelector('[role=log] > div')
    return e.scrollHeight - e.clientHeight - e.scrollTop < 3
  })
  await page.evaluate(() => window.openThread('a-token1'))
  await page.waitForSelector('#a-token1-row-10')
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-content]')).visibility === 'visible',
  )
  assert.ok(
    Math.abs(
      (await page.locator('#a-token1-row-10').evaluate((e) => e.getBoundingClientRect().top)) + 27,
    ) < 3,
    'restores a stable anchor after fetching missing history',
  )
  assert.ok((await page.evaluate(() => window.loads)) >= 2)
  const before = await scroller.evaluate((e) => e.scrollTop)
  await page.evaluate(() => window.grow())
  await page.waitForFunction(
    () => document.querySelector('[data-content]').lastElementChild.clientHeight === 400,
  )
  assert.equal(
    await scroller.evaluate((e) => e.scrollTop),
    before,
    'streaming below a reader preserves the reading position',
  )
  await page.evaluate(() => window.showThread(false))
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[role=log]')).display === 'none',
  )
  await page.evaluate(() => window.showThread(true))
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-content]')).visibility === 'visible',
  )
  assert.ok(
    Math.abs(
      (await page.locator('#a-token1-row-10').evaluate((e) => e.getBoundingClientRect().top)) + 27,
    ) < 3,
    'reopening a mounted hidden thread restores the reader',
  )
  // Identical thread IDs on a different credential cannot retrieve the previous position.
  await page.evaluate(() => window.openThread('a-token2'))
  await page.waitForSelector('#a-token2-row-39')
  await page.waitForFunction(() => {
    const e = document.querySelector('[role=log] > div')
    return e.scrollHeight - e.clientHeight - e.scrollTop < 3
  })
  // A gesture while an old anchor's history is loading cancels the pending restore.
  await page.evaluate(() => {
    window.delay = 300
    window.openThread('a-token1')
  })
  await page.waitForFunction(() =>
    document.querySelector('[data-content]')?.textContent.includes('Loading earlier'),
  )
  await scroller.dispatchEvent('wheel')
  await scroller.evaluate((e) => {
    e.scrollTop = 100
    e.dispatchEvent(new Event('scroll'))
  })
  await page.waitForSelector('#a-token1-row-10')
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-content]')).visibility === 'visible',
  )
  assert.ok(
    Math.abs(
      (await page.locator('#a-token1-row-10').evaluate((e) => e.getBoundingClientRect().top)) + 27,
    ) > 30,
    'a new gesture wins over the remembered anchor',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Reading-position browser checks passed: missing history, measured anchor, streaming, credential isolation and interruption.',
  )
} finally {
  await browser.close()
}
