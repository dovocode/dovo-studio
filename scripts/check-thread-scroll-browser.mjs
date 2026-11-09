import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '../task-creation/task-empty-state': 'export const TaskEmptyState=()=>null;',
  // Sharing is verified separately from scroll anchoring and composer collapse.
  '../chat/thread-sharing':
    'export const ThreadSharing=()=>null;export const InlineThreadSuggestions=()=>null;',
  '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;export * from '@dovo/protocol';export const useAppPreferences=()=>({minimalComposer:true,collapseComposerOnScroll:true});export const useWorkspace=()=>({snapshot:null,connected:true,workspace:{repositories:[]}});export const formatDateTime=value=>value;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '../chat/composer/chat-image-edit': `export const ChatImageEditProvider=({children})=>children;`,
  '@dovo/studio-ui': `export * from '${root}packages/studio-ui/src/components/ai-elements/conversation.tsx';export const Button=({children,...props})=><button {...props}>{children}</button>;`,
  '@dovo/web-ui/conversation': `export * from '${root}packages/web-ui/src/conversation.tsx';`,
  '../chat/thread/use-task-viewed': `export const useTaskViewed=()=>({});`,
  '../chat/thread/chat-thread': `import {Conversation,ConversationContent,ConversationHistory,ConversationRail,ConversationScrollButton} from '@dovo/studio-ui';import {DeferredTurn} from '${root}packages/extension-tasks/src/chat/thread/deferred-turn.tsx';import {useStickToBottomContext} from 'use-stick-to-bottom';function FollowProbe(){window.followProbe=useStickToBottomContext();return null}export function ChatThread({task,onReadingHistory,active}){const indices=Array.from({length:window.turnCount??20},(_,index)=>index);return <Conversation><FollowProbe/><ConversationHistory active={active} settled={task.archived} onReadingHistory={onReadingHistory}><ConversationContent data-conversation-content className="studio-conversation-content mx-auto w-full" style={{paddingBlock:16}}><div className="flex flex-col"><div style={{height:window.olderHeight??0}}>Earlier preloaded history</div>{indices.map(index=><section id={task.id+'-'+index} key={index} style={{contentVisibility:window.staticTurns?"visible":"auto",containIntrinsicSize:"auto 240px"}}><DeferredTurn id={task.id+'-deferred-'+index} pinned={window.staticTurns||index>=indices.length-2}>{()=> <div style={{height:350}}>Turn {task.id} {index+1}</div>}</DeferredTurn></section>)}<div style={{height:window.newHeight??0}}>Latest response</div></div></ConversationContent></ConversationHistory><ConversationRail items={indices.map(index=>({id:task.id+'-'+index,label:'Turn '+(index+1),preview:'Request and response for this turn'}))}/><ConversationScrollButton/></Conversation>}`,
  '../chat/composer/composer': `export function Composer({collapsed}){return <div className="task-composer"><form data-collapsed={collapsed} style={{height:collapsed?48:150,maxWidth:'var(--chat-max)',marginInline:'auto'}}><textarea aria-label="Message" style={{width:'100%',height:collapsed?30:100}} onChange={e=>{e.currentTarget.form.style.height=e.target.value.length>20?'300px':'150px'}}/></form></div>}`,
}
for (const [path, name] of [
  ['../chat/composer/composer-activity', 'ComposerActivity'],
  ['../chat/thread/task-questions', 'TaskQuestions'],
  ['../chat/actions/run-controls', 'RunControls'],
  ['../chat/thread/preparation-progress', 'PreparationProgress'],
  ['../chat/thread/review-comments-tray', 'ReviewCommentsTray'],
  ['../chat/thread/plan-approval', 'PlanApproval'],
  ['../chat/thread/native-todos', 'NativeTodos'],
  ['../chat/thread/review-findings', 'ReviewFindings'],
  ['../review/code-review-card', 'CodeReviewCard'],
  ['../dialogs/task-pull-link-dialog', 'TaskPullLinkDialog'],
])
  mocks[path] = `export const ${name}=()=>null;`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';window.flushSync=flushSync;import {TaskConversation} from '${root}packages/extension-tasks/src/detail/task-conversation.tsx';function App(){const[id,setId]=useState('first');const[settled,setSettled]=useState(true);const[visible,setVisible]=useState(true);const[revision,render]=useState(0);window.openThread=setId;window.setSettled=setSettled;window.setVisible=setVisible;window.setTurnCount=count=>{window.turnCount=count;render(n=>n+1)};window.resizeHistory=(older,newest)=>{window.olderHeight=older;window.newHeight=newest;render(n=>n+1)};return <div style={{height:600,display:'flex',flexDirection:'column'}}><TaskConversation key={id} task={{id,title:id,status:'completed',archived:settled,revision,draft:'',messages:[],queue:[],turns:[],files:[]}} historyLoaded visible={visible} onReview={()=>{}}/></div>}createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'scroll-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const cssServer = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  logLevel: 'error',
})
let css
try {
  css = (await cssServer.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await cssServer.close()
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<style>${css}</style><div id="app"></div>`)
  // Delay initial scrolling to check the content before its first anchored frame.
  await page.evaluate(() => {
    const requestFrame = window.requestAnimationFrame.bind(window)
    const queued = []
    let holding = true
    window.requestAnimationFrame = (callback) => {
      if (!holding) return requestFrame(callback)
      queued.push(callback)
      return -queued.length
    }
    window.releaseInitialFrames = () => {
      holding = false
      for (const callback of queued) requestFrame(callback)
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const content = page.locator('[data-conversation-content]')
  await content.waitFor({ state: 'attached' })
  assert.equal(await content.evaluate((e) => getComputedStyle(e).visibility), 'hidden')
  assert.ok(
    (await page
      .locator('[role=log] > div')
      .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop)) < 3,
  )
  assert.equal(await content.evaluate((e) => getComputedStyle(e).paddingBlock), '16px')
  await page.evaluate(() => window.releaseInitialFrames())
  const bottom = () =>
    page.waitForFunction(
      () => {
        const scroll = document.querySelector('[role=log] > div')
        return scroll && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3
      },
      undefined,
      { timeout: 3000 },
    )
  const uncollapsed = async () =>
    assert.equal(await page.locator('form').getAttribute('data-collapsed'), 'false')
  await bottom()
  await content.waitFor({ state: 'visible' })
  assert.equal(await content.evaluate((e) => e.style.visibility), '')
  await uncollapsed()
  // Explicit navigation must release a follow action that ignores passive scroll events.
  await page.evaluate(() => {
    void window.followProbe.scrollToBottom({
      animation: 'instant',
      ignoreEscapes: true,
      duration: 1000,
    })
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  const stopped = await page.evaluate(() => {
    window.followProbe.stopScroll()
    const root = document.querySelector('[role=log] > div')
    const expected = root.scrollTop - 200
    root.scrollTo({ top: expected, behavior: 'instant' })
    root.dispatchEvent(new Event('scroll'))
    return { expected, animationReleased: window.followProbe.state.animation === undefined }
  })
  assert.equal(
    stopped.animationReleased,
    true,
    'Stop releases an in-flight follow action immediately',
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.locator('[role=log] > div').evaluate((node) => node.scrollTop),
    stopped.expected,
    'An old follow action cannot undo explicit navigation',
  )
  await page.evaluate(() => window.followProbe.scrollToBottom({ animation: 'instant' }))
  await bottom()
  // A shrinking transcript must not resume following after an explicit stop.
  await page.evaluate(() => window.resizeHistory(0, 300))
  await bottom()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.evaluate(() => {
    window.followProbe.stopScroll()
    window.flushSync(() => window.resizeHistory(0, 200))
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.evaluate(() => window.followProbe.state.isAtBottom),
    false,
    'A negative resize cannot cancel an explicit stop near the latest message',
  )
  await page.evaluate(() => window.followProbe.scrollToBottom({ animation: 'instant' }))
  await page.evaluate(() => window.resizeHistory(0, 0))
  await bottom()
  // Opening another sidebar thread starts at the latest turn, including deferred layout.
  await page.evaluate(() => window.openThread('second'))
  await page.waitForSelector('[data-task-conversation=second]')
  await bottom()
  await uncollapsed()
  // A transcript without links remains reachable and scrollable from the keyboard.
  const viewport = page.locator('[role=log] > div')
  assert.equal(await viewport.getAttribute('tabindex'), '0')
  await viewport.focus()
  assert.equal(await viewport.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('PageUp')
  await page.waitForFunction(() => {
    const node = document.querySelector('[role=log] > div')
    return node.scrollHeight - node.clientHeight - node.scrollTop > 100
  })
  await page.keyboard.press('End')
  await bottom()
  // Growing only the composer changes the viewport, not the observed content size.
  const input = page.getByRole('textbox', { name: 'Message' })
  await input.fill('A longer draft that grows the composer viewport')
  await bottom()
  await uncollapsed()
  // Reading old turns suspends following and collapses an unfocused composer.
  await input.blur()
  await page.locator('[role=log]').hover()
  await page.mouse.wheel(0, -700)
  await page.waitForSelector('form[data-collapsed=true]')
  await page.waitForTimeout(200)
  assert.ok(
    (await page
      .locator('[role=log] > div')
      .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop)) > 120,
  )
  // Refocusing and typing while away from the bottom must not collapse again.
  await input.focus()
  await input.fill('New draft')
  await page.waitForTimeout(200)
  await uncollapsed()
  // A viewport resize while reading must preserve the detached position.
  const before = await page.locator('[role=log] > div').evaluate((e) => e.scrollTop)
  await input.fill('Another longer draft that resizes the composer')
  await page.waitForTimeout(200)
  assert.equal(await page.locator('[role=log] > div').evaluate((e) => e.scrollTop), before)
  // Reopen an already mounted settled thread while reading an older turn.
  await page.evaluate(() => window.setSettled(false))
  await bottom()
  // Earlier pages, late Markdown measurements and new responses preserve following.
  for (const [older, newest] of [
    [4000, 0],
    [8000, 250],
    [8500, 700],
    [5000, 1000],
  ]) {
    const beforePaint = await page.evaluate(
      ([older, newest]) => {
        window.flushSync(() => window.resizeHistory(older, newest))
        const root = document.querySelector('[role=log] > div')
        return root.scrollHeight - root.clientHeight - root.scrollTop
      },
      [older, newest],
    )
    assert.ok(beforePaint < 3, `following must settle before paint, left ${beforePaint}px below`)
    await bottom()
  }
  await input.blur()
  await page.locator('[role=log]').hover()
  await page.mouse.wheel(0, -1000)
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor()
  await page.waitForTimeout(200)
  const detached = await page.locator('[role=log] > div').evaluate((e) => e.scrollTop)
  await page.evaluate(() => window.resizeHistory(5000, 1700))
  await page.waitForTimeout(200)
  assert.equal(await page.locator('[role=log] > div').evaluate((e) => e.scrollTop), detached)
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await bottom()
  await page.evaluate(() => window.resizeHistory(9000, 2200))
  await bottom()
  // Returning from another surface restores the latest reply too.
  await page.mouse.wheel(0, -1000)
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor()
  await page.evaluate(() => window.setVisible(false))
  await page.waitForTimeout(50)
  await page.evaluate(() => window.setVisible(true))
  await bottom()
  // The plain dash rail fits long conversations without a pill or list icon.
  await page.evaluate(() => window.setTurnCount(80))
  await bottom()
  const rail = page.getByRole('navigation', { name: 'Conversation turns', exact: true })
  const targets = rail.getByRole('button')
  assert.equal(await targets.count(), 80)
  assert.ok(await rail.evaluate((element) => element.scrollHeight <= element.clientHeight))
  assert.equal(await rail.locator('svg').count(), 0)
  assert.equal(
    await rail.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgba(0, 0, 0, 0)',
  )
  await targets.nth(39).focus()
  await page.getByRole('tooltip').filter({ hasText: 'Turn 40' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const target = document.getElementById('second-39')
    const scroll = document.querySelector('[role=log] > div')
    return (
      Math.abs(target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16) < 3
    )
  })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Jump to turn 40: Turn 40"]')
        ?.getAttribute('aria-current') === 'location',
  )
  // A newer explicit jump replaces a smooth jump that is still in flight.
  await targets.nth(9).focus()
  await page.keyboard.press('Enter')
  await targets.nth(59).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const target = document.getElementById('second-59')
    const scroll = document.querySelector('[role=log] > div')
    return (
      Math.abs(target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16) < 3
    )
  })
  // Reader interruption cancels correction, including later deferred-layout signals.
  const interrupted = await page.evaluate(() => {
    const root = document.querySelector('[role=log] > div')
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }))
    root.scrollTo({ top: root.scrollTop + 400, behavior: 'instant' })
    return root.scrollTop
  })
  await page.evaluate(() => window.resizeHistory(9000, 2700))
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.locator('[role=log] > div').evaluate((element) => element.scrollTop),
    interrupted,
  )
  // Returning to latest during a smooth turn jump cancels its native animation and correction.
  await targets.nth(9).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await bottom()
  await page.evaluate(() => window.resizeHistory(9000, 3000))
  await bottom()
  await targets.nth(39).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const target = document.getElementById('second-39')
    const scroll = document.querySelector('[role=log] > div')
    return (
      Math.abs(target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16) < 3
    )
  })
  const screenshots = process.env.DOVO_SCROLL_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })
  for (const width of [1280, 560, 360]) {
    await page.setViewportSize({ width: width === 560 ? 1280 : width, height: 720 })
    await page.locator('#app').evaluate((element, width) => {
      element.style.width = `${width}px`
    }, width)
    const latest = page.getByRole('button', { name: 'Scroll to latest message' })
    await latest.waitFor()
    const geometry = await latest.evaluate((button) => {
      const action = button.getBoundingClientRect()
      const log = document.querySelector('[role=log]').getBoundingClientRect()
      const composer = document.querySelector('form').getBoundingClientRect()
      const content = document.querySelector('[data-conversation-content]')
      const proseRight =
        content.getBoundingClientRect().right - parseFloat(getComputedStyle(content).paddingRight)
      return {
        action: { left: action.left, right: action.right, bottom: action.bottom },
        logRight: log.right,
        logCenter: log.left + log.width / 2,
        logBottom: log.bottom,
        composerRight: composer.right,
        composerTop: composer.top,
        proseRight,
      }
    })
    assert.ok(
      geometry.action.right <= geometry.logRight - 11,
      'Latest action stays within narrow panes',
    )
    assert.ok(
      geometry.action.bottom <= geometry.logBottom - 11,
      'Latest action clears the conversation edge',
    )
    assert.ok(geometry.action.bottom < geometry.composerTop, 'Latest action clears the composer')
    assert.ok(
      Math.abs((geometry.action.left + geometry.action.right) / 2 - geometry.logCenter) < 1,
      'Latest action stays centered in the conversation pane: ' + JSON.stringify(geometry),
    )
    assert.equal(await rail.isVisible(), width !== 360)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (screenshots) await page.screenshot({ path: `${screenshots}/conversation-${width}.png` })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.locator('#app').evaluate((element) => {
    element.style.width = '1280px'
  })
  await targets.last().focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const target = document.getElementById('second-79')
    const scroll = document.querySelector('[role=log] > div')
    return (
      Math.abs(target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16) < 3
    )
  })
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await bottom()
  assert.equal(await page.getByRole('button', { name: 'Scroll to latest message' }).count(), 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const layoutFrames = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  const programmaticScroll = () =>
    page.evaluate(async () => {
      const root = document.querySelector('[role=log] > div')
      const expected = root.scrollTop - 1000
      const done = new Promise((resolve) =>
        root.addEventListener(
          'scrollend',
          () => requestAnimationFrame(() => requestAnimationFrame(resolve)),
          { once: true },
        ),
      )
      root.scrollTo({ top: expected, behavior: 'instant' })
      await done
      return { expected, actual: root.scrollTop }
    })
  // A repeated zero-distance jump must not leave a listener for some future scroll.
  await targets.nth(39).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => Math.abs(document.getElementById('second-39').getBoundingClientRect().top - 16) < 3,
  )
  await layoutFrames()
  await page.keyboard.press('Enter')
  await layoutFrames()
  let result = await programmaticScroll()
  assert.equal(result.actual, result.expected, 'An aligned turn jump releases its anchor')
  // A last turn without room below it clamps to the end and also releases its anchor.
  await page.evaluate(() => {
    window.staticTurns = true
    window.resizeHistory(9000, 0)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await bottom()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await targets.last().focus()
  await page.keyboard.press('Enter')
  await layoutFrames()
  result = await programmaticScroll()
  assert.equal(result.actual, result.expected, 'A clamped last-turn jump releases its anchor')
  // Unmounting a thread cancels an in-flight jump before the new thread follows latest.
  await targets.nth(9).focus()
  await page.keyboard.press('Enter')
  await page.evaluate(() => window.openThread('third'))
  await page.waitForSelector('[data-task-conversation=third]')
  await bottom()
  assert.deepEqual(errors, [])
  console.log(
    'Thread following, composer resizing, long turn navigation, keyboard previews, reduced motion, and reading-column action placement passed.',
  )
} finally {
  await browser.close()
}
