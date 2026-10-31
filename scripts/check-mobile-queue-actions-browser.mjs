import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {MessageQueue} from './apps/mobile/src/tasks/composer/message-queue';
window.requests=[];window.menus={};window.pending=[];window.scrolls=[];
window.request=(path,input)=>Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{
  window.requests.push({path,input});window.finish=result=>resolve(result??{ok:true});window.reject=()=>reject(new Error('Uncertain response'));
}),catch:error=>error});
function App(){const[task,setTask]=useState({id:'queue',status:'review',queuePaused:true,messages:[],queue:[{id:'a',role:'user',text:'First'},{id:'b',role:'user',text:'Second'}]});window.task=task;window.setTask=setTask;return <MessageQueue task={task}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: 'react-native',
      contents: `import {forwardRef,useImperativeHandle} from 'react';export const View=forwardRef(({children,accessibilityLabel},ref)=><div aria-label={accessibilityLabel} ref={ref}>{children}</div>);export const ScrollView=forwardRef(({children},ref)=>{useImperativeHandle(ref,()=>({scrollTo:options=>window.scrolls.push(options)}),[]);return <div>{children}</div>});export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;`,
    },
    {
      path: 'react-native-gesture-handler',
      contents: `export {Pressable} from 'react-native';export const GestureDetector=({children})=>children;`,
    },
    {
      path: '../../runtime/state/application-state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '../../runtime/connection/provider',
      contents: `export const useRuntime=()=>({connected:true,callEffect:window.request,snapshot:{promptQueueStagingSupported:window.stagingSupported!==false}});`,
    },
    {
      path: '../conversation/state/provider',
      contents: `export const useTaskConversation=()=>({actions:{pendingMessages:window.pending,dictation:{active:false}}});`,
    },
    { path: '../../ui/theme', contents: `export const useTheme=()=>({colors:{},styles:{}});` },
    {
      path: '../../ui/content/text',
      contents: `export const Text=({children})=><span>{children}</span>;`,
    },
    { path: '../../ui/controls/icon', contents: `export const Icon=()=>null;` },
    {
      path: '../../ui/controls/icon-button',
      contents: `export const IconButton=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    },
    {
      path: '../../ui/layout/sheet',
      contents: `export const Sheet=({children})=><div>{children}</div>;`,
    },
    {
      path: '../conversation/components/watch-message',
      contents: `export const WatchMessageCard=()=>null;`,
    },
    {
      path: '../conversation/components/message-source',
      contents: `export const MessageSource=()=>null;`,
    },
    {
      path: './queue-menu',
      contents: `export function QueueMenu({label,actions}){window.menus[label]=actions;return <div>{actions.map(action=><button key={action.title} aria-label={action.label} disabled={action.disabled} onClick={action.onPress}>{action.title}</button>)}</div>}`,
    },
    {
      path: './queue-drag',
      contents: `import {useRef} from 'react';export const QueueDragTarget=({children})=>children;export function useQueueDrag(options){window.dragOptions=options;const rows=useRef(new Map());window.dragRows=rows;return {scroll:useRef({scrollTo:options=>window.scrolls.push(options)}),rows,viewport:useRef({}),drag:null}}`,
    },
  ].map((stub) => ({
    ...stub,
    ...(stub.path.startsWith('.')
      ? {
          importer:
            root +
            (stub.path === '../../runtime/state/application-state'
              ? 'apps/mobile/src/ui/controls/'
              : 'apps/mobile/src/tasks/composer/'),
        }
      : {}),
  })),
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.menus['Actions for queued message 1'])
  await page.evaluate(() => {
    const move = window.menus['Actions for queued message 1'].find(
      (item) => item.title === 'Move later',
    )
    move.onPress()
    move.onPress()
  })
  await page.waitForFunction(() => window.requests.length === 1)
  assert.deepEqual(await page.evaluate(() => window.requests[0].input.expectedMessageIds), [
    'a',
    'b',
  ])
  assert.match(
    await page.getByRole('button', { name: /^View queued message 1:/ }).getAttribute('aria-label'),
    /Second/,
  )
  assert.deepEqual(await page.evaluate(() => window.task.queue.map((message) => message.id)), [
    'a',
    'b',
  ])
  assert.equal(await page.getByText('Waiting for confirmation', { exact: true }).isVisible(), true)
  await page.evaluate(() => window.finish({ ok: true, queueMessageIds: ['b', 'a'] }))
  // HTTP completion must leave controls disabled until the queue snapshot changes.
  await page.waitForFunction(
    () =>
      window.menus['Actions for queued message 1'].find((item) => item.title === 'Move later')
        .disabled,
  )
  await page.evaluate(() =>
    window.menus['Actions for queued message 1']
      .find((item) => item.title === 'Move later')
      .onPress(),
  )
  assert.equal(await page.evaluate(() => window.requests.length), 1)
  assert.equal(await page.evaluate(() => window.dragOptions.enabled), false)
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, queue: [task.queue[1], task.queue[0]] })),
  )
  await page.waitForFunction(() => window.dragOptions.enabled)
  await page.getByRole('button', { name: 'Duplicate queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 2)
  const firstCopy = await page.evaluate(() => window.requests[1].input.duplicateMessageId)
  await page.evaluate(() => window.reject())
  await page.waitForFunction(
    () =>
      !window.menus['Actions for queued message 1'].find((item) => item.title === 'Duplicate')
        .disabled,
  )
  await page.getByRole('button', { name: 'Duplicate queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 3)
  const nextCopy = await page.evaluate(() => window.requests[2].input.duplicateMessageId)
  assert.notEqual(nextCopy, firstCopy)
  await page.evaluate(() =>
    window.finish({ ok: true, duplicateMessageId: 'copy', queueMessageIds: ['b', 'a', 'copy'] }),
  )
  assert.notEqual(nextCopy, 'copy')
  assert.equal(await page.getByText('Copy', { exact: true }).count(), 0)
  await page.evaluate(() => window.dragRows.current.set('copy', { y: 220, height: 44 }))
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: [...task.queue, { id: 'copy', role: 'user', text: 'Copy' }],
    })),
  )
  await page.waitForFunction(() => window.dragOptions.enabled)
  await page.waitForFunction(() => window.scrolls.some((scroll) => scroll.y === 212))
  assert.equal(await page.getByLabel('Duplicated queued message', { exact: true }).count(), 1)
  // A steering anchor anywhere in the authoritative queue disables every move.
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: task.queue.map((message, index) =>
        index === 1 ? { ...message, steering: true } : message,
      ),
    })),
  )
  await page.waitForFunction(() => !window.dragOptions.enabled)
  assert.equal(
    await page
      .getByRole('button', { name: 'Move queued message 1 later', exact: true })
      .isDisabled(),
    true,
  )
  await page.evaluate(() => window.dragOptions.move('b', 'a'))
  assert.equal(await page.evaluate(() => window.requests.length), 3)
  await page.evaluate(() => {
    window.stagingSupported = false
    window.setTask((task) => ({
      ...task,
      queue: task.queue.map((message) => ({ ...message, steering: false })),
    }))
  })
  await page.waitForFunction(() => window.dragOptions.enabled)
  await page.getByRole('button', { name: 'Move queued message 1 later', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 4)
  assert.equal(
    await page.evaluate(() => Object.hasOwn(window.requests[3].input, 'expectedMessageIds')),
    false,
  )
  assert.match(
    await page.getByRole('button', { name: /^View queued message 1:/ }).getAttribute('aria-label'),
    /First/,
  )
  await page.evaluate(() => window.reject())
  await page.waitForFunction(
    () =>
      !window.menus['Actions for queued message 1'].find((item) => item.title === 'Move later')
        .disabled,
  )
  assert.match(
    await page.getByRole('button', { name: /^View queued message 1:/ }).getAttribute('aria-label'),
    /Second/,
  )
  // Consumption of the original head invalidates the overlay; never rebase/retry it.
  await page.getByRole('button', { name: 'Move queued message 1 later', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 5)
  await page.evaluate(() => window.setTask((task) => ({ ...task, queue: task.queue.slice(1) })))
  await page.waitForFunction(() => window.task.queue.length === 2)
  assert.match(
    await page.getByRole('button', { name: /^View queued message 1:/ }).getAttribute('aria-label'),
    /First/,
  )
  assert.equal(await page.evaluate(() => window.requests.length), 5)
  await page.evaluate(() => window.reject())
  await page.waitForFunction(() => window.dragOptions.enabled)
  await page.evaluate(() => {
    window.stagingSupported = true
    window.setTask((task) => ({ ...task }))
  })
  // The destination head can be consumed while a move-before-head is in flight.
  await page.getByRole('button', { name: 'Move queued message 2 earlier', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 6)
  assert.deepEqual(await page.evaluate(() => window.requests[5].input.expectedMessageIds), [
    'a',
    'copy',
  ])
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: task.queue.filter((message) => message.id !== 'a'),
    })),
  )
  await page.waitForFunction(() => window.task.queue.length === 1)
  assert.equal(await page.evaluate(() => window.requests.length), 6)
  await page.evaluate(() => window.reject())
  // A steering flag change invalidates presentation even if the ID order stays identical.
  await page.waitForFunction(() => !document.body.textContent.includes('Waiting for confirmation'))
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: [
        { id: 'a', role: 'user', text: 'First' },
        { id: 'b', role: 'user', text: 'Second' },
        { id: 'c', role: 'user', text: 'Third' },
      ],
    })),
  )
  await page.waitForFunction(() => window.dragOptions.enabled)
  await page.getByRole('button', { name: 'Move queued message 3 earlier', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 7)
  assert.match(
    await page.getByRole('button', { name: /^View queued message 2:/ }).getAttribute('aria-label'),
    /Third/,
  )
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: task.queue.map((message) =>
        message.id === 'b' ? { ...message, steering: true } : message,
      ),
    })),
  )
  await page.waitForFunction(() => window.task.queue.some((message) => message.steering))
  assert.match(
    await page.getByRole('button', { name: /^View queued message 2:/ }).getAttribute('aria-label'),
    /Second/,
  )
  await page.evaluate(() => window.reject())
  await page.waitForFunction(() => !document.body.textContent.includes('Waiting for confirmation'))
  await page.getByRole('button', { name: 'Duplicate queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 8)
  // Journal recovery can identify a copy already present before the response arrives.
  await page.evaluate(() => window.finish({ ok: true, duplicateMessageId: 'c' }))
  await page.waitForFunction(
    () =>
      !window.menus['Actions for queued message 1'].find((item) => item.title === 'Duplicate')
        .disabled,
  )
  assert.equal(await page.getByLabel('Duplicated queued message', { exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => window.task.queue.length), 3)
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: task.queue.map((message) => ({ ...message, steering: false })),
    })),
  )
  await page.waitForFunction(() => window.dragOptions.enabled)
  for (const result of [
    { ok: true, recovered: true, queueMessageIds: ['b', 'a', 'c'] },
    { ok: true, queueMessageIds: ['a', 'b', 'c'] },
    { ok: true },
  ]) {
    const count = await page.evaluate(() => window.requests.length)
    await page.getByRole('button', { name: 'Move queued message 1 later', exact: true }).click()
    await page.waitForFunction((count) => window.requests.length === count + 1, count)
    assert.match(
      await page
        .getByRole('button', { name: /^View queued message 1:/ })
        .getAttribute('aria-label'),
      /Second/,
    )
    await page.evaluate((result) => window.finish(result), result)
    await page.waitForFunction(() => window.dragOptions.enabled)
    assert.match(
      await page
        .getByRole('button', { name: /^View queued message 1:/ })
        .getAttribute('aria-label'),
      /First/,
    )
    assert.equal(await page.getByText('Waiting for confirmation', { exact: true }).count(), 0)
  }
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: false,
      queue: task.queue.map((message, index) => ({
        ...message,
        paused: index === 0 || index === 1,
      })),
    })),
  )
  const resumeFirst = page.getByRole('button', { name: 'Resume first prompt', exact: true })
  await resumeFirst.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Run queue', exact: true }).count(), 0)
  const beforeResume = await page.evaluate(() => window.requests.length)
  await resumeFirst.click()
  await page.waitForFunction((count) => window.requests.length === count + 1, beforeResume)
  assert.deepEqual(
    await page.evaluate(() => ({
      action: window.requests.at(-1).input.action,
      messageId: window.requests.at(-1).input.messageId,
    })),
    { action: 'resume-message', messageId: 'a' },
  )
  assert.equal(await page.evaluate(() => window.task.queue[1].paused), true)
  await page.evaluate(() => window.finish({ ok: true }))
  await page.waitForFunction(() => !document.body.textContent.includes('Waiting for confirmation'))
  await page.evaluate(() => {
    window.pending = [
      {
        taskId: 'queue',
        state: 'sending',
        destination: 'queue',
        message: {
          id: 'pending-stage',
          role: 'user',
          text: 'Staged append',
          createdAt: new Date().toISOString(),
        },
      },
    ]
    window.setTask((task) => ({
      ...task,
      queuePaused: true,
      queue: task.queue.map((message) => ({ ...message, paused: false })),
    }))
  })
  const runQueue = page.getByRole('button', { name: 'Run queue', exact: true })
  await runQueue.waitFor()
  assert.equal(await runQueue.isDisabled(), true)
  assert.equal(await page.getByText('Waiting for confirmation', { exact: true }).isVisible(), true)
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queuePaused: false,
      queue: task.queue.map((message, index) => ({ ...message, paused: index === 0 })),
    })),
  )
  await resumeFirst.waitFor()
  assert.equal(await resumeFirst.isDisabled(), true)
  assert.equal(
    await page.getByRole('button', { name: 'Pause queued message 2', exact: true }).isEnabled(),
    true,
  )
  await page.evaluate(() => {
    window.pending = []
    window.setTask((task) => ({
      ...task,
      queuePaused: true,
      queue: [
        ...task.queue.map((message) => ({ ...message, paused: false })),
        { id: 'pending-stage', role: 'user', text: 'Staged append' },
      ],
    }))
  })
  await runQueue.waitFor()
  assert.equal(await runQueue.isEnabled(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile queue actions: capability-gated full-order CAS, synchronous admission, optimistic presentation and rollback, snapshot handoff lock, confirmed duplicate reveal, fresh duplicate IDs and steering anchor guards passed.',
  )
} finally {
  await browser.close()
}
