import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `export * from '@dovo/protocol';export const useAppPreferences=()=>({collapseComposerOnScroll:true});export const useWorkspace=()=>({snapshot:null,connected:true});export const formatDateTime=value=>value;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export * from '${root}packages/studio-ui/src/components/ai-elements/conversation.tsx';export const Button=({children,...props})=><button {...props}>{children}</button>;`,
  '../chat/thread/use-task-viewed': `export const useTaskViewed=()=>({});`,
  '../chat/thread/chat-thread': `import {Conversation,ConversationContent,ConversationHistory} from '@dovo/studio-ui';import {DeferredTurn} from '${root}packages/extension-tasks/src/chat/thread/deferred-turn.tsx';export function ChatThread({task,onReadingHistory}){return <Conversation><ConversationHistory onReadingHistory={onReadingHistory}><ConversationContent>{Array.from({length:20},(_,index)=><section key={index} style={{contentVisibility:"auto",containIntrinsicSize:"auto 240px"}}><DeferredTurn immediate={index>=18}>{()=> <div style={{height:350}}>Turn {task.id} {index}</div>}</DeferredTurn></section>)}</ConversationContent></ConversationHistory></Conversation>}`,
  '../chat/composer/composer': `export function Composer({collapsed}){return <form data-collapsed={collapsed} style={{height:collapsed?48:150}}><textarea aria-label="Message" style={{width:'100%',height:collapsed?30:100}} onChange={e=>{e.currentTarget.form.style.height=e.target.value.length>20?'300px':'150px'}}/></form>}`,
}
for (const [path, name] of [
  ['../chat/thread/message-queue', 'MessageQueue'],
  ['../chat/thread/task-questions', 'TaskQuestions'],
  ['../chat/actions/run-controls', 'RunControls'],
  ['../chat/thread/preparation-progress', 'PreparationProgress'],
  ['../chat/thread/review-comments-tray', 'ReviewCommentsTray'],
  ['../chat/thread/plan-approval', 'PlanApproval'],
  ['../chat/thread/review-findings', 'ReviewFindings'],
  ['../dialogs/task-pull-link-dialog', 'TaskPullLinkDialog'],
])
  mocks[path] = `export const ${name}=()=>null;`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TaskConversation} from '${root}packages/extension-tasks/src/detail/task-conversation.tsx';function App(){const[id,setId]=useState('first');window.openThread=setId;return <div style={{height:600,display:'flex',flexDirection:'column'}}><TaskConversation key={id} task={{id,title:id,status:'completed',draft:'',messages:[],queue:[],turns:[],files:[]}} historyLoaded visible onReview={()=>{}}/></div>}createRoot(document.getElementById('app')).render(<App/>);`,
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
    *{box-sizing:border-box} body{margin:0} .flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.h-full{height:100%}.min-h-0{min-height:0}.overflow-y-hidden{overflow-y:hidden}
  </style><div id="app"></div>`)
  await page.addScriptTag({ content: built.outputFiles[0].text })
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
  assert.deepEqual(errors, [])
  console.log(
    'Thread opening, deferred layout, composer resizing, and reading-history focus checks passed.',
  )
} finally {
  await browser.close()
}
