import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';const Context=createContext(null);export const WorkspaceHarness=Context.Provider;export const useWorkspace=()=>useContext(Context);export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});export const useResolvedTheme=()=> 'dark'; export {studioSyntaxTheme} from '../studio-core/src/themes'; const preferences={followUp:'queue',confirmStop:false};export const useAppPreferences=()=>preferences;export const readAppPreferences=()=>preferences;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {Queue,QueueSectionTrigger,QueueList,QueueItem,QueueItemIndicator,QueueItemContent} from '../studio-ui/src/components/ai-elements/queue.tsx';import React from 'react';export const cn=(...values)=>values.filter(Boolean).join(' ');export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=({label,children,...props})=><Button aria-label={label} {...props}>{children}</Button>;export {ComposerSurface,ComposerSubmit} from '../studio-ui/src/composer-surface';`,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:()=>{},remove:()=>{}});`,
  './composer-editor': `import {useSyncExternalStore} from 'react';export const ComposerEditor=({controller,submitBusy,submittedText})=>{const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <textarea aria-label="Message" value={submitBusy&&text.trim()===submittedText?'':text} readOnly={submitBusy} onChange={event=>controller.update(event.target.value)}/>};`,
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
import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {Composer} from './src/chat/composer/composer.tsx';import {MessageQueue} from './src/chat/thread/message-queue.tsx';
const initial={id:'task',title:'Task',repositoryId:'repo',agentId:'agent',status:'draft',messages:[],turns:[],queue:[],draft:'',files:[],example:false};
window.requests=[];window.navigations=[];window.pending=null;window.fail=false;window.response=null;
const request=async(path,input)=>{window.requests.push({path,input});if(path==='/api/tasks/title')return{title:'Generated title'};if(path==='/api/tasks/message'||path==='/api/tasks/steer'||path==='/api/tasks/start-fork')return new Promise((resolve,reject)=>{window.response=()=>window.fail?reject(new Error('Network failure')):resolve(path==='/api/tasks/start-fork'?{id:input.forkId}:{ok:true})});return {ok:true}};
function App(){const[workspace,setWorkspace]=useState({tasks:[initial],repositories:[],agents:[],skills:[],mcpServers:[]});const onPending=useCallback(pending=>{window.pending=pending},[]);window.current=workspace.tasks[0];window.setTask=update=>setWorkspace(old=>({...old,tasks:[update(old.tasks[0])]}));const value={workspace,setWorkspace,request,connected:true,connection:{address:'http://runtime',token:'token'},flush:async()=>{},snapshot:{questions:[]}};return <WorkspaceHarness value={value}><><Composer task={workspace.tasks[0]} onPending={onPending}/><MessageQueue task={workspace.tasks[0]}/></></WorkspaceHarness>};createRoot(document.getElementById('app')).render(<App/>);
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
  const submit = async (text, button = 'Send') => {
    await input.fill(text)
    await (
      button === 'Send'
        ? page.locator('button[type=submit]')
        : page.getByRole('button', { name: button, exact: true })
    ).click()
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
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Desktop send, queue, steer, response-before-snapshot, snapshot-before-response, failed-send draft recovery, stable retry IDs and queued-message removal and in-place queue editing and fork dispatch with stable retry IDs passed.',
  )
} finally {
  await browser.close()
}
