import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react'; export const Context=createContext(null); export const useWorkspace=()=>useContext(Context); export const responses={ok:{},queueAction:{}};`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `import React from 'react'; export const Queue=({children,embedded})=>embedded?<div>{children}</div>:<details>{children}</details>; export const QueueSectionTrigger=({children})=><summary>{children}</summary>; export const QueueList=({children,...props})=><ol {...props}>{children}</ol>; export const QueueItem=({children,...props})=><li {...props}>{children}</li>; export const QueueItemContent=({children,...props})=><span {...props}>{children}</span>; export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>; export const Dialog=()=>null; export const DialogContent=()=>null; export const DialogTitle=()=>null;`,
  './watch-message': `export const WatchMessageCard=()=>null;`,
  './message-source': `export const MessageSource=()=>null;`,
  '../composer/queue-edit': `export const useQueueEdit=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {Context} from '@dovo/studio-core'; import {MessageQueue} from './src/chat/thread/message-queue';
const initial=['one','two','three'].map(id=>({id,role:'user',text:id}));
function App(){const [queue,setQueue]=useState(initial); const [embedded,setEmbedded]=useState(true); const [pending,setPending]=useState([]); const [queuePaused,setQueuePaused]=useState(false); window.setQueuePaused=setQueuePaused; window.setPending=setPending; window.setEmbedded=setEmbedded; window.setQueue=setQueue; const task={id:'task',status:'running',queue,queuePaused,messages:[]}; const displayed={...task,queue:[...queue,...pending.map(item=>item.message)]}; const request=(path,input)=>{window.calls.push(input); return new Promise((resolve,reject)=>{window.accept=(result={ok:true})=>resolve(result);window.reject=()=>reject(Error('Rejected'))})}; return <Context.Provider value={{workspace:{tasks:[task]},connected:true,request,snapshot:{promptQueueStagingSupported:true}}}><MessageQueue task={displayed} pending={pending} embedded={embedded}/></Context.Provider>}; window.calls=[]; createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mocks' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mocks' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
        }))
      },
    },
  ],
  nodePaths: [fileURLToPath(new URL('../packages/studio-ui/node_modules', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const rows = () => page.locator('li').allTextContents()
  await page.getByRole('button', { name: 'Move queued message 3 earlier' }).click()
  assert.deepEqual(
    (await rows()).map((text) => text.trim().slice(-3)),
    ['one', 'ree', 'two'],
  )
  assert.deepEqual(await page.evaluate(() => window.calls[0].expectedMessageIds), [
    'one',
    'two',
    'three',
  ])
  assert.equal(await page.getByRole('status').textContent(), 'Waiting for confirmation…')
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.reject())
  await page.getByRole('alert').waitFor()
  assert.deepEqual(
    (await rows()).map((text) => text.trim().slice(-3)),
    ['one', 'two', 'ree'],
  )
  await page.getByRole('button', { name: 'Move queued message 3 earlier' }).click()
  await page.evaluate(() => window.accept({ ok: true, queueMessageIds: ['one', 'three', 'two'] }))
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.setQueue((queue) => [queue[0], queue[2], queue[1]]))
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Duplicate queued message 1' }).click()
  await page.evaluate(() =>
    window.accept({
      ok: true,
      queueMessageIds: ['one', 'three', 'two', 'actual-copy'],
      duplicateMessageId: 'actual-copy',
    }),
  )
  await page.evaluate(() =>
    window.setQueue((queue) => [...queue, { id: 'actual-copy', role: 'user', text: 'copy' }]),
  )
  await page.getByText('Message duplicated').waitFor()
  assert.match(await page.locator('li').last().getAttribute('class'), /ring-primary/)
  await page.evaluate(() =>
    window.setQueue((queue) =>
      queue.map((item, index) => (index === 0 ? { ...item, steering: true } : item)),
    ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Move queued message 3 earlier' }).isDisabled(),
    true,
  )
  await page.evaluate(() =>
    window.setQueue((queue) => queue.map((item) => ({ ...item, steering: false }))),
  )
  const firstRow = page.locator('li').first()
  await page.getByRole('button', { name: 'Drag queued message 3 to reorder' }).dragTo(firstRow, {
    targetPosition: { x: 5, y: 1 },
  })
  assert.equal((await rows())[0].trim().endsWith('two'), true)
  await page.evaluate(() => window.setQueue((queue) => queue.slice(1)))
  assert.equal((await rows())[0].trim().endsWith('three'), true)
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.reject())
  await page.getByRole('alert').waitFor()
  await page.getByRole('button', { name: 'Move queued message 2 earlier' }).click()
  await page.evaluate(() =>
    window.accept({ ok: true, queueMessageIds: ['two', 'three', 'actual-copy'] }),
  )
  await page.getByRole('button', { name: 'Stop waiting' }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isEnabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Move queued message 2 earlier' }).isDisabled(),
    true,
  )
  await page.getByText('Queue update not yet confirmed; reordering is unavailable.').waitFor()
  await page.evaluate(() => window.setQueue((queue) => [queue[1], queue[0], ...queue.slice(2)]))
  await page
    .getByText('Queue update not yet confirmed; reordering is unavailable.')
    .waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Duplicate queued message 1' }).click()
  await page.evaluate(() =>
    window.accept({
      ok: true,
      recovered: true,
      duplicateMessageId: 'actual-copy',
      queueMessageIds: window.calls.at(-1).expectedMessageIds,
    }),
  )
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isEnabled(),
    true,
  )
  assert.match(await page.locator('li').last().getAttribute('class'), /ring-primary/)
  await page.getByRole('button', { name: 'Move queued message 2 earlier' }).click()
  await page.evaluate(() =>
    window.accept({ ok: true, recovered: true, queueMessageIds: ['outdated'] }),
  )
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Move queued message 2 earlier' }).isEnabled(),
    true,
  )
  await page.getByRole('button', { name: 'Move queued message 2 earlier' }).click()
  await page.evaluate(() =>
    window.accept({ ok: true, queueMessageIds: ['two', 'three', 'actual-copy'] }),
  )
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Move queued message 2 earlier' }).isEnabled(),
    true,
  )
  await page.getByRole('button', { name: 'Duplicate queued message 1' }).click()
  await page.evaluate(() => window.accept({ ok: true }))
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Duplicate queued message 1' }).isEnabled(),
    true,
  )
  // A running host can consume the head before publishing the moved order.
  // Any newer authoritative order releases the acknowledged handoff.
  await page.getByRole('button', { name: 'Move queued message 2 earlier' }).click()
  await page.evaluate(() =>
    window.accept({ ok: true, queueMessageIds: ['three', 'two', 'actual-copy'] }),
  )
  await page.getByText('Waiting for confirmation…').waitFor()
  await page.evaluate(() => window.setQueue((queue) => queue.slice(1)))
  await page.getByText('Waiting for confirmation…').waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Move queued message 2 earlier' }).isEnabled(),
    true,
  )
  // Restore the fixture for the header controls below.
  await page.evaluate(() =>
    window.setQueue([
      { id: 'two', role: 'user', text: 'two' },
      { id: 'three', role: 'user', text: 'three' },
      { id: 'actual-copy', role: 'user', text: 'copy' },
    ]),
  )
  await page.evaluate(() => window.setEmbedded(false))
  assert.equal(
    await page.locator('details').evaluate((details) => details.firstElementChild.tagName),
    'SUMMARY',
  )
  assert.equal(await page.locator('details').evaluate((details) => details.open), false)
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isVisible(),
    true,
  )
  await page.evaluate(() =>
    window.setQueue((queue) =>
      queue.map((item, index) => (index === 0 ? { ...item, paused: true } : item)),
    ),
  )
  await page.getByRole('button', { name: 'Resume first prompt' }).click()
  assert.deepEqual(
    await page.evaluate(() => ({
      action: window.calls.at(-1).action,
      messageId: window.calls.at(-1).messageId,
    })),
    { action: 'resume-message', messageId: 'two' },
  )
  await page.evaluate(() => window.accept())
  await page.evaluate(() => {
    window.setQueue((queue) => queue.map((item) => ({ ...item, paused: false })))
    window.setQueuePaused(true)
    window.setPending([
      {
        taskId: 'task',
        destination: 'queue',
        state: 'sending',
        message: { id: 'pending', role: 'user', text: 'Pending' },
      },
    ])
  })
  assert.equal(
    await page.getByRole('button', { name: 'Run queue', exact: true }).isDisabled(),
    true,
  )
  assert.match(
    await page.getByRole('button', { name: 'Run queue', exact: true }).getAttribute('title'),
    /confirmed/,
  )
  await page.evaluate(() => window.setQueuePaused(false))
  assert.equal(
    await page.getByRole('button', { name: 'Pause queue', exact: true }).isEnabled(),
    true,
  )
  await page.evaluate(() =>
    window.setQueue((queue) =>
      queue.map((item, index) => (index === 0 ? { ...item, paused: true } : item)),
    ),
  )
  assert.equal(await page.getByRole('button', { name: 'Resume first prompt' }).isDisabled(), true)
  await page.evaluate(() => {
    window.setQueue([])
    window.setQueuePaused(true)
  })
  assert.equal(
    await page.getByRole('button', { name: 'Run queue', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.setPending([]))
  console.log('Desktop queue handoff checks passed')
} finally {
  await browser.close()
}
