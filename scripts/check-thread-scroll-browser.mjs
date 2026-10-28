import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '../task-creation/task-empty-state': 'export const TaskEmptyState=()=>null;',
  // Sharing is verified separately from scroll anchoring and composer collapse.
  '../chat/thread-sharing':
    'export const ThreadSharing=()=>null;export const InlineThreadSuggestions=()=>null;',
  '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;export * from '@dovo/protocol';export const useAppPreferences=()=>({collapseComposerOnScroll:true});export const useWorkspace=()=>({snapshot:null,connected:true,workspace:{repositories:[]}});export const formatDateTime=value=>value;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '../chat/composer/chat-image-edit': `export const ChatImageEditProvider=({children})=>children;`,
  '@dovo/studio-ui': `export * from '${root}packages/studio-ui/src/components/ai-elements/conversation.tsx';export const Button=({children,...props})=><button {...props}>{children}</button>;`,
  '../chat/thread/use-task-viewed': `export const useTaskViewed=()=>({});`,
  '../chat/thread/chat-thread': `import {Conversation,ConversationContent,ConversationHistory,ConversationScrollButton} from '@dovo/studio-ui';import {DeferredTurn} from '${root}packages/extension-tasks/src/chat/thread/deferred-turn.tsx';export function ChatThread({task,onReadingHistory,active}){return <Conversation><ConversationHistory active={active} settled={task.archived} onReadingHistory={onReadingHistory}><ConversationContent data-conversation-content style={{padding:16}}><div className="flex flex-col"><div style={{height:window.olderHeight??0}}>Earlier preloaded history</div>{Array.from({length:20},(_,index)=>index).map(index=><section key={index} style={{contentVisibility:"auto",containIntrinsicSize:"auto 240px"}}><DeferredTurn id={task.id+'-'+index} pinned={index>=18}>{()=> <div style={{height:350}}>Turn {task.id} {index}</div>}</DeferredTurn></section>)}<div style={{height:window.newHeight??0}}>Latest response</div></div></ConversationContent></ConversationHistory><ConversationScrollButton/></Conversation>}`,
  '../chat/composer/composer': `export function Composer({collapsed}){return <form data-collapsed={collapsed} style={{height:collapsed?48:150}}><textarea aria-label="Message" style={{width:'100%',height:collapsed?30:100}} onChange={e=>{e.currentTarget.form.style.height=e.target.value.length>20?'300px':'150px'}}/></form>}`,
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
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TaskConversation} from '${root}packages/extension-tasks/src/detail/task-conversation.tsx';function App(){const[id,setId]=useState('first');const[settled,setSettled]=useState(true);const[visible,setVisible]=useState(true);const[revision,render]=useState(0);window.openThread=setId;window.setSettled=setSettled;window.setVisible=setVisible;window.resizeHistory=(older,newest)=>{window.olderHeight=older;window.newHeight=newest;render(n=>n+1)};return <div style={{height:600,display:'flex',flexDirection:'column'}}><TaskConversation key={id} task={{id,title:id,status:'completed',archived:settled,revision,draft:'',messages:[],queue:[],turns:[],files:[]}} historyLoaded visible={visible} onReview={()=>{}}/></div>}createRoot(document.getElementById('app')).render(<App/>);`,
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
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<style>
    *{box-sizing:border-box} body{margin:0} .flex{display:flex}.flex-col{flex-direction:column}.flex-col-reverse{flex-direction:column-reverse}.flex-1{flex:1}.h-full{height:100%}.min-h-0{min-height:0}.overflow-y-hidden{overflow-y:hidden}
  </style><div id="app"></div>`)
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
      .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop)) > 300,
  )
  assert.equal(await content.evaluate((e) => getComputedStyle(e).padding), '16px')
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
  // Opening another sidebar thread starts at the latest turn, including deferred layout.
  await page.evaluate(() => window.openThread('second'))
  await page.waitForSelector('[data-task-conversation=second]')
  await bottom()
  await uncollapsed()
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
    await page.evaluate(([older, newest]) => window.resizeHistory(older, newest), [older, newest])
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
  assert.deepEqual(errors, [])
  console.log(
    'Newest-first thread opening, initial visibility, deferred layout, composer resizing, and reading-history focus checks passed.',
  )
} finally {
  await browser.close()
}
