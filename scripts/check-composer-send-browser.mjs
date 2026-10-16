import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';const Context=createContext(null);export const WorkspaceHarness=Context.Provider;export const useWorkspace=()=>useContext(Context);export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});export const useResolvedTheme=()=> 'dark'; export {studioSyntaxTheme} from '../studio-core/src/themes'; const preferences={followUp:'queue',confirmStop:false};export const useAppPreferences=()=>preferences;export const readAppPreferences=()=>preferences;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {permissionPolicyUIIssue} from '../studio-ui/src/permission-policy-fields';export {Queue,QueueSectionTrigger,QueueList,QueueItem,QueueItemIndicator,QueueItemContent} from '../studio-ui/src/components/ai-elements/queue.tsx';import React from 'react';export const cn=(...values)=>values.filter(Boolean).join(' ');export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=({label,children,...props})=><Button aria-label={label} {...props}>{children}</Button>;export {ComposerSurface,ComposerSubmit} from '../studio-ui/src/composer-surface';`,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:files=>{window.dropped.push(files.map(file=>({name:file.name,size:file.size})))},remove:()=>{}});`,
  './composer-editor': `import {useState,useSyncExternalStore} from 'react';export const ComposerEditor=({controller,submitBusy,submittedText,disabled})=>{const[mount]=useState(()=>++window.editorMounts);const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <textarea data-editor-mount={mount} aria-label="Message" value={submitBusy&&text.trim()===submittedText?'':text} readOnly={submitBusy} disabled={disabled} onChange={event=>controller.update(event.target.value)}/>};`,
}
for (const [path, name] of [
  ['./attachment-picker', 'AttachmentPicker'],
  ['./message-attachments', 'MessageAttachments'],
  ['./composer-command-dialog', 'ComposerCommandDialog'],
  ['../../dialogs/saved-prompts-dialog', 'SavedPromptsDialog'],
  ['../thread/context-meter', 'ContextMeter'],
  ['./composer-harness-controls', 'ComposerHarnessControls'],
  ['./composer-workspace', 'ComposerWorkspace'],
])
  mocks[path] = `export const ${name}=()=>null;`
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {Composer} from './src/chat/composer/composer.tsx';import {MessageQueue} from './src/chat/thread/message-queue.tsx';import {pendingMessageQueue,visiblePendingMessages} from '@dovo/protocol';import {formatCodeReference} from './src/detail/code-reference';
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'draft',messages:[],turns:[],queue:[],draft:'',files:[],example:false};
window.editorMounts=0;window.dropped=[];window.requests=[];window.navigations=[];window.pending=null;window.fail=false;window.response=null;window.asides=[];window.sideResponse=null;
const request=async(path,input)=>{window.requests.push({path,input});if(path==='/api/tasks/side-chat/save'){if(window.failSideSave)throw Error('Side save failed');return new Promise(resolve=>{window.sideSaved=()=>resolve({id:'side-'+window.asides.length})})};if(path==='/api/tasks/side-chat/ask')return new Promise((resolve,reject)=>{window.sideResponse=()=>window.failSideAsk?reject(Error('Side ask failed')):resolve({answer:'Side answer'})});if(path==='/api/tasks/projects/select'){if(window.failAuto)throw Error('AUTO needs a project choice');return {...window.current,repositoryId:'selected-project',autoProject:undefined,linkedCheckouts:[{id:'linked',repositoryId:'api',execution:'worktree',access:'read-only'}]}};if(path==='/api/tasks/title')return{title:'Generated title'};if(path==='/api/tasks/queue'&&input.action==='move'){if(window.failMove)throw Error('Move rejected');window.setTask(task=>{const queue=task.queue.filter(message=>message.id!==input.messageId);const message=task.queue.find(message=>message.id===input.messageId);const index=input.beforeMessageId===null?queue.length:queue.findIndex(message=>message.id===input.beforeMessageId);queue.splice(index,0,message);return {...task,queue}});return {ok:true}};if(path==='/api/tasks/message'||path==='/api/tasks/steer'||path==='/api/tasks/start-fork')return new Promise((resolve,reject)=>{window.response=()=>window.fail?reject(new Error('Network failure')):resolve(path==='/api/tasks/start-fork'?{id:input.forkId}:{ok:true})});return {ok:true}};
function App(){const[insertion,setInsertion]=useState(null);const[mount,setMount]=useState(0);window.addReference=(id,text)=>setInsertion({taskId:'task',id,text});window.remount=()=>setMount(value=>value+1);window.pendingInsertion=insertion;window.reference=formatCodeReference('src/example.ts',1,1,'const answer = 42;','new');const[pendingQueue,setPendingQueue]=useState([]);window.setPendingQueue=setPendingQueue;const[workspace,setWorkspace]=useState({tasks:[initial],repositories:[],agents:[],skills:[],mcpServers:[]});const onPending=useCallback(pending=>{window.pending=pending},[]);window.current=workspace.tasks[0];window.setTask=update=>setWorkspace(old=>({...old,tasks:[update(old.tasks[0])]}));const value={workspace,setWorkspace,request,connected:true,connection:{address:'http://runtime',token:'token'},flush:async()=>{},snapshot:{questions:[]}};return <WorkspaceHarness value={value}><><Composer key={mount} composerInsert={insertion?.taskId===workspace.tasks[0].id?insertion:null} onComposerInsertApplied={()=>setInsertion(null)} task={workspace.tasks[0]} onAside={id=>window.asides.push(id??null)} onPending={onPending} queuedMessages={<MessageQueue task={{...workspace.tasks[0],queue:pendingMessageQueue(workspace.tasks[0],pendingQueue)}} pending={visiblePendingMessages(workspace.tasks[0],pendingQueue)}/>}/></></WorkspaceHarness>};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'composer-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'composer-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'composer-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
          loader: 'tsx',
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Message' })
  const dropFiles = async () =>
    page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['hello'], 'note.txt', { type: 'text/plain' }))
      transfer.items.add(new File(['image'], 'photo.png', { type: 'image/png' }))
      const input = document.querySelector('textarea')
      input.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      )
    })
  const remount = async () => {
    const previous = await input.getAttribute('data-editor-mount')
    await page.evaluate(() => window.remount())
    await page.waitForFunction(
      (previous) => document.querySelector('textarea')?.dataset.editorMount !== previous,
      previous,
    )
  }
  await page.evaluate(() => window.setTask((task) => ({ ...task, autoProject: true })))
  await input.fill('Update dashboard using API')
  await page.evaluate(() => {
    window.failAuto = true
  })
  await page.locator('button[type=submit]').click()
  await page.getByText('Error: AUTO needs a project choice', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'Update dashboard using API')
  assert.equal(
    await page.evaluate(() =>
      window.requests.some((request) => request.path === '/api/tasks/message'),
    ),
    false,
  )
  await page.evaluate(() => {
    window.failAuto = false
    window.requests = []
  })
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response !== null)
  assert.deepEqual(await page.evaluate(() => window.requests.map((request) => request.path)), [
    '/api/tasks/projects/select',
    '/api/tasks/title',
    '/api/tasks/message',
  ])
  assert.equal(await page.evaluate(() => window.current.repositoryId), 'selected-project')
  assert.equal(await page.evaluate(() => window.current.linkedCheckouts[0].repositoryId), 'api')
  await page.evaluate(() => {
    window.response()
    window.response = null
  })
  await page.waitForFunction(() => !document.querySelector('textarea').readOnly)
  await page.evaluate(() => {
    window.setTask((task) => ({
      ...task,
      repositoryId: 'repo',
      autoProject: undefined,
      linkedCheckouts: [],
      draft: '',
    }))
    window.requests = []
    window.pending = null
  })
  // Diff/file references are consumed at the source; a new composer must never replay them.
  await input.fill('Review this change')
  await page.evaluate(() => window.addReference('reference-1', window.reference))
  await page.waitForFunction(
    () =>
      window.pendingInsertion === null &&
      document.querySelector('textarea')?.value.includes(window.reference),
  )
  const referencedDraft = 'Review this change\n\n' + (await page.evaluate(() => window.reference))
  assert.equal(await input.inputValue(), referencedDraft)
  await remount()
  await page.waitForFunction(() => document.querySelector('textarea')?.value.startsWith('Review'))
  assert.equal(await input.inputValue(), referencedDraft, 'Remount replayed a code reference')
  await input.fill('')
  await remount()
  assert.equal(await input.inputValue(), '', 'A deleted reference reappeared')
  // Explicitly selecting the same lines again is still a new insertion.
  await page.evaluate(() => window.addReference('reference-2', window.reference))
  await page.waitForFunction(
    () =>
      window.pendingInsertion === null &&
      document.querySelector('textarea')?.value.includes(window.reference),
  )
  assert.equal(await input.inputValue(), await page.evaluate(() => window.reference))
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response !== null)
  await page.evaluate(() => {
    window.response()
    window.response = null
  })
  await page.waitForFunction(() => !document.querySelector('textarea').readOnly)
  await remount()
  assert.equal(await input.inputValue(), '', 'A sent reference reappeared')
  // Keep the remaining send scenarios independent of the reference regression.
  await page.evaluate(() => {
    window.setTask((task) => ({ ...task, messages: [], queue: [], draft: '' }))
    window.requests = []
    window.pending = null
  })
  await input.fill('Keep this draft')
  await dropFiles()
  await page.getByRole('status').filter({ hasText: 'Drop files to attach' }).waitFor()
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['hello'], 'note.txt', { type: 'text/plain' }))
    transfer.items.add(new File(['image'], 'photo.png', { type: 'image/png' }))
    document
      .querySelector('textarea')
      .dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      )
  })
  if (
    JSON.stringify(await page.evaluate(() => window.dropped)) !==
    JSON.stringify([
      [
        { name: 'note.txt', size: 5 },
        { name: 'photo.png', size: 5 },
      ],
    ])
  )
    throw new Error('Dropped files did not reach attachment upload')
  if ((await input.inputValue()) !== 'Keep this draft') throw new Error('Drop changed draft text')
  await page
    .getByRole('status')
    .filter({ hasText: 'Drop files to attach' })
    .waitFor({ state: 'detached' })
  await input.fill('')
  const submit = async (text, button = 'Send') => {
    await input.fill(text)
    if (button !== 'Send') {
      await page.getByRole('button', { name: 'More message actions', exact: true }).click()
      await page.getByRole('menuitem', { name: button, exact: button === 'Fork' }).click()
    } else await page.locator('button[type=submit]').click()
    await page
      .waitForFunction(() => window.response !== null, undefined, { timeout: 5000 })
      .catch(async (error) => {
        throw new Error(
          JSON.stringify(
            await page.evaluate(() => ({
              requests: window.requests,
              pending: window.pending,
              text: document.body.textContent,
            })),
          ) +
            ' ' +
            error.message,
        )
      })
  }
  const respond = async (fail = false) => {
    await page.evaluate((fail) => {
      window.fail = fail
      window.response()
      window.response = null
    }, fail)
    await page.waitForFunction(() => !document.querySelector('textarea').readOnly)
  }
  const acknowledge = async (destination) => {
    await page.evaluate(
      (destination) =>
        window.setTask((task) => ({
          ...task,
          [destination]: [...task[destination], window.pending.message],
        })),
      destination,
    )
    await page.waitForFunction(() => window.pending === null)
  }
  await submit('First message')
  if ((await page.evaluate(() => window.pending.destination)) !== 'thread')
    throw new Error('First message was queued')
  await respond()
  await acknowledge('messages')
  await page.evaluate(() => window.setTask((task) => ({ ...task, status: 'running' })))
  await submit('Later message')
  if ((await page.evaluate(() => window.pending.destination)) !== 'queue')
    throw new Error('Running follow-up was not queued')
  await respond()
  await acknowledge('queue')
  await page.evaluate(() => window.setTask((task) => ({ ...task, queue: [] })))
  await page.waitForFunction(() => window.pending === null)
  await submit('Steering message', 'Steer agent')
  if ((await page.evaluate(() => window.pending.destination)) !== 'thread')
    throw new Error('Steering was queued')
  await acknowledge('messages')
  await respond(true)
  await submit('Retry this')
  const failedId = await page.evaluate(() => window.pending.message.id)
  await respond(true)
  await page.waitForFunction(() => window.pending?.state === 'failed')
  if ((await input.inputValue()) !== 'Retry this') throw new Error('Failure lost the draft')
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response !== null)
  if ((await page.evaluate(() => window.pending.message.id)) !== failedId)
    throw new Error('Retry changed message identity')
  await acknowledge('queue')
  await respond()
  const requests = await page.evaluate(() =>
    window.requests.filter((request) => /tasks\/(message|steer)$/.test(request.path)),
  )
  if (
    requests.map((request) => request.path).join(',') !==
    '/api/tasks/message,/api/tasks/message,/api/tasks/steer,/api/tasks/message,/api/tasks/message'
  )
    throw new Error(JSON.stringify(requests))
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: [{ id: 'queued-message', role: 'user', text: 'Original queued input' }],
    })),
  )
  await page.locator('[aria-label="Queued follow-ups"] summary').click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .fill('Edited queued input')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .waitFor({ state: 'hidden' })
  const edit = await page.evaluate(() => window.requests.at(-1))
  if (
    edit.path !== '/api/tasks/queue' ||
    edit.input.id !== 'task' ||
    edit.input.messageId !== 'queued-message' ||
    edit.input.text !== 'Edited queued input' ||
    edit.input.expectedText !== 'Original queued input'
  )
    throw new Error('Queue editing corrupted the task or message identity: ' + JSON.stringify(edit))
  // Exercise native desktop drag events through the real queue/composer boundary.
  await page.evaluate(() =>
    window.setTask((task) => ({
      ...task,
      queue: [
        { id: 'first', role: 'user', text: 'First queued request' },
        { id: 'second', role: 'user', text: 'Second queued request' },
        { id: 'third', role: 'user', text: 'Third queued request' },
        { id: 'fourth', role: 'user', text: 'Fourth queued request' },
      ],
    })),
  )
  const queued = page.locator('[aria-label="Queued follow-ups"]')
  const drag = async (from, to, edge) => {
    const target = queued.locator('li').nth(to - 1)
    const bounds = await target.boundingBox()
    await page
      .getByRole('button', { name: `Drag queued message ${from} to reorder`, exact: true })
      .dragTo(target, { targetPosition: { x: 20, y: edge === 'before' ? 2 : bounds.height - 2 } })
  }
  const queueOrder = () =>
    page.evaluate(() => window.current.queue.map((message) => message.id).join(','))
  const moves = () =>
    page.evaluate(() =>
      window.requests.filter(
        (request) => request.path === '/api/tasks/queue' && request.input.action === 'move',
      ),
    )
  await drag(3, 1, 'before')
  if ((await queueOrder()) !== 'third,first,second,fourth')
    throw Error('Dragging to the first position failed')
  await drag(1, 4, 'after')
  if ((await queueOrder()) !== 'first,second,fourth,third')
    throw Error('Dragging to the end failed')
  await drag(4, 1, 'after')
  if ((await queueOrder()) !== 'first,third,second,fourth')
    throw Error('Dragging to a middle position failed')
  const moveRequests = await moves()
  if (
    moveRequests.length !== 3 ||
    moveRequests[0].input.beforeMessageId !== 'first' ||
    moveRequests[1].input.beforeMessageId !== null ||
    moveRequests[2].input.beforeMessageId !== 'second'
  )
    throw Error(
      'Drag sorting did not use one atomic request per drop: ' + JSON.stringify(moveRequests),
    )
  await drag(2, 1, 'after')
  if ((await moves()).length !== 3) throw Error('Dropping in the same position sent a mutation')
  await page.evaluate(() => {
    window.failMove = true
  })
  await drag(3, 1, 'before')
  await page.getByRole('alert').filter({ hasText: 'Move rejected' }).waitFor()
  if ((await queueOrder()) !== 'first,third,second,fourth')
    throw Error('Failed move changed the visible queue')
  await page.evaluate(() => {
    window.failMove = false
  })
  await page
    .getByRole('button', { name: 'Drag queued message 1 to reorder', exact: true })
    .dragTo(input)
  if ((await moves()).length !== 4) throw Error('Canceled drag sent a mutation')
  await page.evaluate(() => window.setTask((task) => ({ ...task, queue: [] })))
  await submit('Fork continuation', 'Fork')
  const forkId = await page.evaluate(() => window.requests.at(-1).input.forkId)
  await respond(true)
  if ((await input.inputValue()) !== 'Fork continuation')
    throw new Error('Fork failure lost the draft')
  await submit('Fork continuation', 'Fork')
  if ((await page.evaluate(() => window.requests.at(-1).input.forkId)) !== forkId)
    throw new Error('Fork retry changed identity')
  await respond()
  await page.waitForFunction(() => window.navigations.length === 1)
  if ((await input.inputValue()) !== '') throw new Error('Accepted fork did not clear composer')
  const forkRequest = await page.evaluate(() => window.requests.at(-1))
  if (
    forkRequest.path !== '/api/tasks/start-fork' ||
    forkRequest.input.id !== 'task' ||
    forkRequest.input.text !== 'Fork continuation'
  )
    throw new Error('Incorrect fork request')
  if ((await page.evaluate(() => window.navigations[0].entityId)) !== forkId)
    throw new Error('Fork did not open the new thread')
  await page.evaluate(() => {
    window.setTask((task) => ({
      ...task,
      queue: [{ id: 'server-queued', role: 'user', text: 'Accepted queue item', createdAt: '' }],
    }))
    window.setPendingQueue([
      {
        taskId: 'task',
        state: 'saved',
        destination: 'queue',
        message: { id: 'saved-queued', role: 'user', text: 'Saved queue item' },
      },
      {
        taskId: 'task',
        state: 'sending',
        destination: 'queue',
        message: { id: 'sending-queued', role: 'user', text: 'Sending queue item' },
      },
    ])
  })
  await page.locator('[aria-label="Queued follow-ups"] summary').click()
  await page.getByText('Saved queue item', { exact: true }).waitFor()
  await page.getByText('Sending queue item', { exact: true }).waitFor()
  for (const index of [2, 3]) {
    for (const name of [
      `Drag queued message ${index} to reorder`,
      `Edit queued message ${index}`,
      `Steer with queued message ${index}`,
      `Move queued message ${index} up`,
      `Move queued message ${index} down`,
      `Cancel queued message ${index} and return it to the composer`,
    ])
      if (!(await page.getByRole('button', { name, exact: true }).isDisabled()))
        throw new Error('Unconfirmed queue item exposed an authoritative action: ' + name)
  }
  if (
    !(await page
      .getByRole('button', { name: 'Move queued message 1 down', exact: true })
      .isDisabled())
  )
    throw new Error('Accepted queue item can be moved into a local-only row')
  if (await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).isDisabled())
    throw new Error('Accepted queue item lost its actions')
  await page.evaluate(() => {
    window.setTask((task) => ({ ...task, status: 'review', archived: true, queue: [] }))
    window.setPendingQueue([])
  })
  await input.fill('Reopen on send')
  if (!(await page.evaluate(() => window.current.archived)))
    throw new Error('Typing reopened the settled thread')
  await submit('Reopen on send')
  const reopeningId = await page.evaluate(() => window.pending.message.id)
  await respond(true)
  if (
    !(await page.evaluate(() => window.current.archived)) ||
    (await input.inputValue()) !== 'Reopen on send'
  )
    throw new Error('Rejected send changed settlement or lost draft')
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => window.response !== null)
  if ((await page.evaluate(() => window.pending.message.id)) !== reopeningId)
    throw new Error('Reopening retry changed identity')
  await respond()
  // The runtime snapshot owns the transition; the composer must not issue a reopen PATCH.
  await page.evaluate(() => window.setTask((task) => ({ ...task, archived: false })))
  await acknowledge('queue')
  if (
    await page.evaluate(() =>
      window.requests.some(
        (request) => request.path === '/api/workspace' && request.input.changes?.archived,
      ),
    )
  )
    throw new Error('Composer reopened before message acceptance')
  const mainRequestsBeforeAside = await page.evaluate(
    () =>
      window.requests.filter((request) =>
        ['/api/tasks/message', '/api/tasks/steer', '/api/tasks/start-fork'].includes(request.path),
      ).length,
  )
  // The side-chat action consumes the current draft only after saving it, leaving attachments.
  await page.evaluate(() => {
    window.setTask((task) => ({
      ...task,
      archived: false,
      draftAttachments: [{ id: 'keep', name: 'keep.txt', type: 'text/plain' }],
    }))
  })
  await input.fill('Explain this worktree')
  const aside = page.getByRole('button', { name: 'Ask a side question (⌘/Ctrl+;)', exact: true })
  await aside.click()
  await page.waitForFunction(() => typeof window.sideSaved === 'function')
  if ((await input.inputValue()) !== 'Explain this worktree')
    throw Error('Side question cleared before persistence')
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('dovo:ask-side-question', { detail: 'task', cancelable: true }),
    )
    window.sideSaved()
    window.sideSaved = null
  })
  await page.waitForFunction(() => window.sideResponse !== null)
  if ((await input.inputValue()) !== '') throw Error('Side send did not consume the saved draft')
  await input.fill('A newer draft')
  const sideAsk = await page.evaluate(() =>
    window.requests.findLast((request) => request.path === '/api/tasks/side-chat/ask'),
  )
  if (
    sideAsk.input.question !== 'Explain this worktree' ||
    sideAsk.input.id !== 'task' ||
    sideAsk.input.chatId !== 'side-0'
  )
    throw Error('Side question went to the wrong destination')
  if (
    (await page.evaluate(
      () =>
        window.requests.filter((request) => request.path === '/api/tasks/side-chat/save').length,
    )) !== 1
  )
    throw Error('Duplicate side send')
  if (
    !(await page.evaluate(() => window.current.draftAttachments.some((file) => file.id === 'keep')))
  )
    throw Error('Side send consumed attachments')
  await page.evaluate(() => {
    window.sideResponse()
    window.sideResponse = null
  })
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Ask a side question (⌘/Ctrl+;)"]').disabled,
  )
  if ((await input.inputValue()) !== 'A newer draft')
    throw Error('Side answer cleared newer typing')
  // Keyboard dispatch targets the same action, using live text rather than a stale task snapshot.
  await input.fill('Keyboard side question')
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('dovo:ask-side-question', { detail: 'task', cancelable: true }),
    ),
  )
  await page.waitForFunction(() => typeof window.sideSaved === 'function')
  await page.evaluate(() => {
    window.sideSaved()
    window.sideSaved = null
  })
  await page.waitForFunction(() => window.sideResponse !== null)
  if ((await input.inputValue()) !== '')
    throw Error('Saved side question remained in the main composer')
  await page.evaluate(() => {
    window.sideResponse()
    window.sideResponse = null
  })
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Ask a side question (⌘/Ctrl+;)"]').disabled,
  )
  const saves = await page.evaluate(
    () => window.requests.filter((request) => request.path === '/api/tasks/side-chat/save').length,
  )
  await aside.click()
  if ((await page.evaluate(() => window.asides.at(-1))) !== null)
    throw Error('Empty composer did not open side chats')
  if (
    (await page.evaluate(
      () =>
        window.requests.filter((request) => request.path === '/api/tasks/side-chat/save').length,
    )) !== saves
  )
    throw Error('Empty composer created a chat')
  await input.fill('Keep after side save failure')
  await page.evaluate(() => {
    window.failSideSave = true
  })
  await aside.click()
  await page.getByText('Side save failed', { exact: true }).waitFor()
  if (
    (await page.evaluate(
      () =>
        window.requests.filter((request) =>
          ['/api/tasks/message', '/api/tasks/steer', '/api/tasks/start-fork'].includes(
            request.path,
          ),
        ).length,
    )) !== mainRequestsBeforeAside
  )
    throw Error('Side-chat controls also submitted the main composer')
  if ((await input.inputValue()) !== 'Keep after side save failure')
    throw Error('Failed side save lost main draft')
  await page.evaluate(() =>
    window.setTask((task) => ({ ...task, archived: true, archivedAt: '2026-10-15T00:00:00Z' })),
  )
  await page.waitForFunction(() => document.querySelector('textarea').disabled)
  if (!(await page.locator('button[type=submit]').isDisabled()))
    throw new Error('Archived thread can send without restoration')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Desktop single-use code references across remount/delete/send, send, queue, steer, response-before-snapshot, snapshot-before-response, failed-send draft recovery, stable retry IDs and queued-message removal and in-place queue editing, desktop drag sorting, fork dispatch and immediate side-chat sending via icon and shortcut passed.',
  )
} finally {
  await browser.close()
}
