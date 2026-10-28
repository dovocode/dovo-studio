import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './harness.mjs'
import { checkPinRemoval } from './pin-removal.mjs'

// Real ChatThread, DeferredTurn and studio-ui Conversation: only leaf presentation is stubbed.
const studioUi = fileURLToPath(new URL('../../packages/studio-ui/', import.meta.url))
const mocks = {
  '../../task-creation/task-empty-state': `export const TaskEmptyState=()=>null;`,
  './pull-link-actions': `export const PullLinkActions=()=>null;`,
  '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;export * from '@dovo/protocol';const store={workspace:{tasks:[]},connected:true,connection:{address:'http://lan-host:4317',token:'paired'},request:async()=>({ok:true})};export const useWorkspace=()=>store;export const useStudioHost=()=>({});export const formatDateTime=()=>'';export const useAppPreferences=()=>({responseStreaming:'tokens',themePalette:'dovo'});export const useResolvedTheme=()=> 'dark';export const completedStreamingText=text=>text;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export * from '${studioUi}src/components/ai-elements/conversation.tsx';export {cn} from '${studioUi}src/lib/utils';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {Dialog,DialogContent,DialogTitle} from '${studioUi}src/components/ui/dialog';export {FileTypeIcon} from '${studioUi}src/file-tree';export {RepositoryOpenItems} from '${studioUi}src/repository-open-items';const Plain=({children,...props})=><div {...props}>{children}</div>;export const Message=({children,id})=><div id={id}>{children}</div>;export const MessageContent=Plain;export const MessageResponse=({children})=>{window.markdownRenders++;return <p style={{whiteSpace:'pre-wrap',margin:0}}>{children}</p>};export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;`,
  './task-activity': `export const useTaskActivity=()=>({tools:[],error:''});export const TaskActivity=()=>null;`,
}
for (const [path, name] of [
  ['./turn-checkpoint', 'TurnCheckpoint'],
  ['../composer/message-attachments', 'MessageAttachments'],
  ['./message-copy', 'MessageCopy'],
  ['../actions/run-in-terminal', 'RunInTerminal'],
  ['../actions/fork-turn', 'ForkTurn'],
  ['../actions/retry-turn', 'RetryTurn'],
  ['./turn-label', 'TurnLabel'],
])
  mocks[path] = `export const ${name}=()=>'Worked';`
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {ChatThread} from './src/chat/thread/chat-thread.tsx';
window.markdownRenders=0;
const messages=[];const turns=[];
for(let index=0;index<300;index++){
  messages.push({id:'u'+index,role:'user',text:'Request '+index});
  const lines=Array.from({length:(index*7)%13+1},(_,line)=>'Reply '+index+' line '+line).join('\\n');
  messages.push({id:'a'+index,role:'assistant',text:lines,bookmarked:index===12});
  turns.push({id:'turn-'+index,assistantId:'a'+index,status:index===299?'running':'completed',startedAt:'2026-10-02T12:00:00Z',finishedAt:index===299?undefined:'2026-10-02T12:00:01Z'});
}
function App(){const [task,setTask]=useState({id:'thread',status:'running',messages,turns});
window.stream=()=>setTask(old=>({...old,messages:old.messages.map((message,index)=>index===old.messages.length-1?{...message,text:message.text+'\\nstreamed line'}:message)}));
return <div style={{height:700,display:'flex',flexDirection:'column'}}><ChatThread task={task}/></div>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'thread-window',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'thread-window' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'thread-window' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: studioUi,
          loader: 'tsx',
        }))
      },
    },
  ],
  bundle: true,
  alias: {
    '@dovo/protocol': fileURLToPath(
      new URL('../../packages/protocol/src/index.ts', import.meta.url),
    ),
  },
  nodePaths: [studioUi + 'node_modules'],
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const browser = await chromium.launch({ headless: true })
try {
  await checkPinRemoval(browser, 'turn')
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<style>
    *{box-sizing:border-box} body{margin:0;font:14px/20px sans-serif}
    .flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.relative{position:relative}
    .overflow-y-hidden{overflow-y:hidden}.min-h-0{min-height:0}.gap-3{gap:12px}.gap-5{gap:20px}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden}
  </style><div id="app"></div>`)
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const scroller = '[role=log] > div'
  await page.waitForFunction(() => document.getElementById('message-thread-a299'))
  const state = () =>
    page.evaluate((selector) => {
      const root = document.querySelector(selector)
      const mounted = [...document.querySelectorAll('[id^="message-thread-"]')]
      return {
        top: root.scrollTop,
        height: root.scrollHeight,
        bottom: root.scrollHeight - root.clientHeight - root.scrollTop,
        messages: mounted.length,
        nodes: root.querySelectorAll('*').length,
        ids: mounted.map((element) => element.id.slice('message-thread-'.length)),
      }
    }, scroller)
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))),
        ),
    )
  const scrollTo = async (top) => {
    await page.evaluate(
      ([selector, top]) => {
        document.querySelector(selector).scrollTop = top
      },
      [scroller, top],
    )
    await settle()
    await settle()
  }
  await page.waitForFunction((selector) => {
    const root = document.querySelector(selector)
    return root.scrollHeight - root.clientHeight - root.scrollTop < 3
  }, scroller)
  await settle()
  const opened = await state()
  assert.ok(opened.messages < 80, `opening mounted ${opened.messages} messages`)

  // Read the whole thread from the bottom to the top in viewport steps.
  let peakMessages = opened.messages
  let peakNodes = opened.nodes
  let visited = new Set(opened.ids)
  const started = performance.now()
  for (let step = 0; step < 400; step++) {
    const current = await state()
    if (current.top === 0) break
    await scrollTo(Math.max(0, current.top - 650))
    const after = await state()
    peakMessages = Math.max(peakMessages, after.messages)
    peakNodes = Math.max(peakNodes, after.nodes)
    for (const id of after.ids) visited.add(id)
  }
  const readMs = Math.round(performance.now() - started)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const heapAfterRead = Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024)
  const top = await state()
  assert.equal(top.top, 0)
  assert.ok(visited.has('u0') && visited.has('a150'), 'the reader reached every turn')
  assert.ok(visited.size >= 590, `only ${visited.size} messages were ever mounted`)
  // Without the window, every visited turn stayed mounted: all 600 messages.
  assert.ok(peakMessages < 140, `peak mounted messages ${peakMessages}`)
  assert.ok(top.messages < 140, `top of thread kept ${top.messages} messages mounted`)
  assert.ok(top.ids.includes('a299'), 'the running turn stays mounted')
  assert.ok(!top.ids.includes('a200'), 'a distant read turn was released')

  // Measured placeholders keep the same extent: scrolling back down never moves visible text.
  await scrollTo(6000)
  const anchor = await page.evaluate((selector) => {
    const root = document.querySelector(selector)
    const view = root.getBoundingClientRect()
    const element = [...document.querySelectorAll('[id^="message-thread-"]')].find(
      (candidate) => candidate.getBoundingClientRect().top > view.top + 40,
    )
    return { id: element.id, top: element.getBoundingClientRect().top - view.top }
  }, scroller)
  for (const offset of [200, -200, 400, -400]) {
    await scrollTo((await state()).top + offset)
    await scrollTo((await state()).top - offset)
  }
  const anchored = await page.evaluate(
    ([selector, id]) =>
      document.getElementById(id).getBoundingClientRect().top -
      document.querySelector(selector).getBoundingClientRect().top,
    [scroller, anchor.id],
  )
  assert.ok(Math.abs(anchored - anchor.top) <= 2, `anchor moved ${anchor.top} → ${anchored}`)
  const heightBefore = (await state()).height
  await scrollTo(0)
  await scrollTo(6000)
  assert.equal((await state()).height, heightBefore, 'measured turns return with the same height')

  // Selected text and focus keep their turn mounted until released.
  await page.evaluate(() =>
    document.getElementById('turn-thread-u40').scrollIntoView({ block: 'center' }),
  )
  await page.locator('#message-thread-a40').waitFor()
  await page.evaluate(() => {
    const text = document.getElementById('message-thread-a40').querySelector('p').firstChild
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await scrollTo((await state()).height)
  await settle()
  assert.ok((await state()).ids.includes('a40'), 'selected text was unmounted')
  assert.equal(await page.evaluate(() => getSelection().toString()), 'Reply 40')
  await page.evaluate(() => getSelection().removeAllRanges())
  await page.waitForFunction(() => !document.getElementById('message-thread-a40'))
  await page.evaluate(() =>
    document.getElementById('turn-thread-u60').scrollIntoView({ block: 'center' }),
  )
  await page.locator('#message-thread-a60').waitFor()
  await page.locator('#message-thread-a60 button[aria-label="Bookmark reply"]').focus()
  await scrollTo((await state()).height)
  await settle()
  assert.ok((await state()).ids.includes('a60'), 'focused control was unmounted')
  await page.evaluate(() => document.activeElement.blur())
  await page.waitForFunction(() => !document.getElementById('message-thread-a60'))

  // A disclosure choice returns with its turn.
  await page.evaluate(() =>
    document.getElementById('turn-thread-u80').scrollIntoView({ block: 'center' }),
  )
  await settle()
  const disclosure = page.locator('#turn-thread-u80 button[aria-expanded]').first()
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  await disclosure.click()
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'true')
  await page.evaluate(() => document.activeElement.blur())
  await scrollTo((await state()).height)
  await page.waitForFunction(() => !document.getElementById('message-thread-a80'))
  await page.evaluate(() =>
    document.getElementById('turn-thread-u80').scrollIntoView({ block: 'center' }),
  )
  await settle()
  await page.locator('#message-thread-a80').waitFor()
  assert.equal(
    await page
      .locator('#turn-thread-u80 button[aria-expanded]')
      .first()
      .getAttribute('aria-expanded'),
    'true',
  )

  // Bookmarks and search jump into released turns. Jumping while still following the live end
  // races use-stick-to-bottom (also before windowing), so the reader first scrolls up.
  const leaveLiveEnd = async () => {
    await scrollTo((await state()).height)
    await page.locator('[role=log]').hover()
    await page.mouse.wheel(0, -400)
    await page.waitForFunction((selector) => {
      const root = document.querySelector(selector)
      return root.scrollHeight - root.clientHeight - root.scrollTop > 300
    }, scroller)
    await settle()
  }
  await leaveLiveEnd()
  await page.waitForFunction(() => !document.getElementById('message-thread-a12'))
  await page.getByRole('navigation', { name: 'Bookmarked replies' }).getByRole('button').click()
  await page.waitForFunction((selector) => {
    const element = document.getElementById('message-thread-a12')
    const view = document.querySelector(selector).getBoundingClientRect()
    const box = element?.getBoundingClientRect()
    return box && box.bottom > view.top && box.top < view.bottom
  }, scroller)
  await leaveLiveEnd()
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('dovo:search-thread', { detail: 'thread' })),
  )
  await page.getByRole('searchbox', { name: 'Search this thread' }).fill('Reply 33 line 0')
  await page.waitForFunction((selector) => {
    const element = document.getElementById('message-thread-a33')
    const view = document.querySelector(selector).getBoundingClientRect()
    const box = element?.getBoundingClientRect()
    return box && box.bottom > view.top && box.top < view.bottom
  }, scroller)
  await page.keyboard.press('Escape')

  // Use the real follow action: restoring virtualized turns can change the total height.
  // Following a stream at the live end keeps the window bounded.
  // A native smooth search/rail jump may still be in flight when follow is requested.
  await page.evaluate((selector) => {
    const root = document.querySelector(selector)
    root.scrollTo({ top: root.scrollTop - 3000, behavior: 'smooth' })
  }, scroller)
  await page.waitForFunction((selector) => {
    const root = document.querySelector(selector)
    const top = root.scrollTop
    return new Promise((resolve) => requestAnimationFrame(() => resolve(root.scrollTop < top)))
  }, scroller)
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await page.waitForFunction((selector) => {
    const root = document.querySelector(selector)
    return root.scrollHeight - root.clientHeight - root.scrollTop < 3
  }, scroller)
  await settle()
  const followBaseline = await state()
  for (let index = 0; index < 10; index++) {
    await page.evaluate(() => window.stream())
    await settle()
  }
  const followed = await state()
  assert.ok(followed.bottom < 3, `stream follow left ${followed.bottom}px below`)
  assert.ok(followed.messages <= followBaseline.messages + 2)

  // Without native scroll anchoring, an earlier turn growing on mount must not move the reader.
  await page.evaluate((selector) => {
    document.querySelector(selector).style.overflowAnchor = 'none'
  }, scroller)
  await scrollTo(2500)
  const manual = await page.evaluate((selector) => {
    const root = document.querySelector(selector)
    const view = root.getBoundingClientRect()
    const element = [...document.querySelectorAll('[id^="message-thread-"]')].find(
      (candidate) => candidate.getBoundingClientRect().top > view.top + 40,
    )
    return { id: element.id, top: element.getBoundingClientRect().top - view.top }
  }, scroller)
  for (let step = 0; step < 6; step++) await scrollTo((await state()).top - 300)
  for (let step = 0; step < 6; step++) await scrollTo((await state()).top + 300)
  const manualAfter = await page.evaluate(
    ([selector, id]) =>
      document.getElementById(id).getBoundingClientRect().top -
      document.querySelector(selector).getBoundingClientRect().top,
    [scroller, manual.id],
  )
  assert.ok(
    Math.abs(manualAfter - manual.top) <= 2,
    `fallback anchoring moved ${manual.top} → ${manualAfter}`,
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      turns: 300,
      messages: 600,
      openedMessages: opened.messages,
      peakMountedMessages: peakMessages,
      peakDomNodes: peakNodes,
      everMounted: visited.size,
      readTopMs: readMs,
      heapAfterReadKiB: heapAfterRead,
    }),
  )
  console.log(
    'Thread window: bounded mounted turns, stable measured anchors, selection/focus holds, retained disclosures, bookmark/search jumps and stream following passed.',
  )
} finally {
  await browser.close()
}
