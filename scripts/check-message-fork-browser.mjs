import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// Shared fixture state: the runtime reply mode, recorded requests and the rendered message.
const fixture = `window.requests=[];window.navigations=[];window.prompts=[];window.reveals=[];window.mode='ok';
window.respond=async(path,input)=>{window.requests.push({path,input});if(window.mode==='lost'){window.mode='ok';throw new Error('Connection lost');}return {id:input.forkId??'turn-fork',...(path==='/api/tasks/fork'&&window.state.supported?{messageId:'answer-1'}:{})}};`
const options = (contents) => ({
  stdin: { contents, resolveDir: root, loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
})

const desktopFolder = root + 'packages/extension-tasks/src/chat/actions/'
const desktop = await bundleBrowser(
  options(`import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ForkMessage} from '${desktopFolder}fork-message';
import {ForkTurn} from '${desktopFolder}fork-turn';
${fixture}
window.state={supported:true,task:{id:'task',status:'review'},status:'completed',message:{id:'user-1',role:'user',text:'First request'}};
function App(){const[state,setState]=useState(window.state);window.update=next=>setState(old=>{window.state={...old,...next};return window.state});return <><ForkMessage key={state.message.id} taskId="task" message={state.message} status={state.status}/>{state.turn&&<ForkTurn taskId="task" turn={state.turn} message={state.message}/>}</>}
createRoot(document.getElementById('app')).render(<App/>);`),
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>({connected:true,workspace:{tasks:[window.state.task],repositories:[{id:'repo',taskDefaults:{execution:'worktree'}}]},snapshot:window.state.supported?{messageForkSupported:true}:{},request:(path,input)=>window.respond(path,input)});
export const useConfirmation=()=>async options=>{window.prompts.push(options);return window.confirmResult??true};
export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const MessageAction=({label,children,...props})=><button aria-label={label} title={label} {...props}>{children}</button>;`,
    },
  ],
)

const mobileFolder = root + 'apps/mobile/src/tasks/conversation/components/'
const mobile = await bundleBrowser(
  options(`import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {MessageActions} from '${mobileFolder}message-actions';
${fixture}
window.alerts=[];
window.state={supported:true,status:'completed',task:{id:'task',status:'review',messages:[{id:'user-1',role:'user',text:'First request'},{id:'answer-1',role:'assistant',text:'First answer',turnId:'t1'}],turns:[{id:'t1',assistantId:'answer-1',status:'completed'}]},messageId:'user-1',user:true};
function App(){const[state,setState]=useState(window.state);window.update=next=>setState(old=>{window.state={...old,...next};return window.state});const message=state.task.messages.find(item=>item.id===state.messageId);return <MessageActions key={state.messageId} text={message.text} user={state.user} messageId={state.messageId}/>}
createRoot(document.getElementById('app')).render(<App/>);`),
  [
    {
      path: 'react-native',
      contents: `export const Platform={OS:'ios'};export const AccessibilityInfo={announceForAccessibility(){}};export const ActionSheetIOS={showActionSheetWithOptions(){}};
export const Alert={alert:(title,message,buttons)=>{window.alerts.push({title,message});if(window.confirmResult!==false)buttons?.find(button=>button.text==='Fork')?.onPress?.()}};
export const View=({children})=><div>{children}</div>;
export const Pressable=({children,accessibilityLabel,accessibilityHint,onPress,disabled})=><button aria-label={accessibilityLabel} title={accessibilityHint} disabled={disabled} onClick={onPress}>{children}</button>;`,
    },
    {
      path: '../../../agents/use-model-catalog',
      importer: mobileFolder,
      contents: `export const loadMobileModelCatalog=()=>{throw Error('Unexpected model read')};`,
    },
    {
      path: '../../../ui/controls/icon',
      importer: mobileFolder,
      contents: `export const Icon=()=>null;`,
    },
    {
      path: '../../../ui/content/text',
      importer: mobileFolder,
      contents: `export const Text=({children})=><span>{children}</span>;`,
    },
    {
      path: '../../../ui/theme',
      importer: mobileFolder,
      contents: `export const useTheme=()=>({colors:{muted:'#aaa'}});`,
    },
    {
      path: '../../../ui/content/clipboard',
      importer: mobileFolder,
      contents: `export const copyText=async()=>{};export const shareText=async()=>{};`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: mobileFolder,
      contents: `export const useRuntime=()=>({connected:true,activeId:'computer',profile:{connection:{address:'http://computer',token:'test'}},snapshot:{messageForkSupported:window.state.supported,workspace:{agents:[],repositories:[]}},call:(path,input)=>window.respond(path,input)});`,
    },
    {
      path: '../message-reveal',
      importer: mobileFolder,
      contents: `export const requestMessageReveal=(connection,taskId,messageId)=>window.reveals.push({address:connection.address,taskId,messageId});`,
    },
    {
      path: '../state/provider',
      importer: mobileFolder,
      contents: `export const useAppendConversationTemplate=()=>()=>{};
export const useConversationSelector=selector=>selector({task:window.state.task,history:{setBookmark(){}},openTerminal(){}});
export const useConversationPresentation=()=>({status:window.state.status});
export const usePendingConversationMessage=()=>null;`,
    },
    {
      path: 'expo-router',
      contents: `export const router={navigate:href=>window.navigations.push(href)};`,
    },
    {
      path: '../../../shell/task-route',
      importer: mobileFolder,
      contents: `export const taskHref=(runtimeId,taskId)=>'/'+runtimeId+'/'+taskId;`,
    },
  ],
)

const browser = await chromium.launch()
try {
  const open = async (built) => {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    return { page, errors }
  }
  const forkButton = (page) => page.getByRole('button', { name: /^Fork conversation/ })
  const filesButton = (page) =>
    page.getByRole('button', { name: /^Fork with files from this turn/ })
  const replyButton = (page) => page.getByRole('button', { name: 'Fork from this reply' })

  {
    const { page, errors } = await open(desktop)
    // A lost reply keeps its fork ID, so the retry cannot create a second thread.
    await page.evaluate(() => (window.mode = 'lost'))
    await forkButton(page).click()
    await page.getByRole('alert').getByText('Connection lost').waitFor()
    await forkButton(page).click()
    await page.waitForFunction(() => window.navigations.length === 1)
    const [lost, retried] = await page.evaluate(() => window.requests)
    assert.equal(lost.path, '/api/tasks/fork-message')
    assert.deepEqual(retried.input, lost.input)
    assert.equal(retried.input.messageId, 'user-1')
    assert.match(retried.input.forkId, uuid)
    assert.deepEqual(await page.evaluate(() => window.navigations[0]), {
      viewId: 'tasks',
      entityId: retried.input.forkId,
      messageId: 'user-1',
    })
    const prompt = await page.evaluate(() => window.prompts[0])
    assert.match(prompt.description, /Files are not rewound/)
    assert.match(prompt.description, /up to and including this message/)
    assert.match(prompt.description, /local checkout/)
    assert.equal(prompt.details, 'Selected message: First request')
    assert.match((await forkButton(page).getAttribute('aria-label')) ?? '', /not rewound/)
    // The next fork is a new request.
    await forkButton(page).click()
    await page.waitForFunction(() => window.requests.length === 3)
    const next = await page.evaluate(() => window.requests[2].input)
    assert.notEqual(next.forkId, retried.input.forkId)
    // Cancelling the confirmation sends nothing.
    await page.evaluate(() => (window.confirmResult = false))
    await forkButton(page).click()
    await page.waitForFunction(() => window.prompts.length === 4)
    assert.equal(await page.evaluate(() => window.requests.length), 3)
    await page.evaluate(() => (window.confirmResult = true))
    // A thread kind that stays with its execution explains itself without a request.
    await page.evaluate(() =>
      window.update({
        task: {
          id: 'task',
          status: 'review',
          delegation: { parentTaskId: 'p', parentRunId: 'r', key: 'k' },
        },
      }),
    )
    await forkButton(page).click()
    await page.getByRole('alert').getByText('Fork the parent thread instead').waitFor()
    assert.equal(await page.evaluate(() => window.requests.length), 3)
    // Hidden for running turns, review comments, Bots and runtimes without support.
    const hidden = [
      { task: { id: 'task', status: 'running' }, status: 'running' },
      { task: { id: 'task', status: 'running' }, status: 'waiting' },
      {
        task: { id: 'task', status: 'review' },
        status: 'completed',
        message: { id: 'comment', role: 'user', text: 'Rename', file: 'a.ts' },
      },
      { task: { id: 'task', status: 'review', bot: {} } },
      { task: { id: 'task', status: 'review' }, supported: false },
    ]
    for (const state of hidden) {
      await page.evaluate(
        (state) =>
          window.update({
            supported: true,
            status: 'completed',
            message: { id: 'user-1', role: 'user', text: 'First request' },
            ...state,
          }),
        state,
      )
      await forkButton(page).waitFor({ state: 'detached' })
    }
    // Earlier history stays available while a later turn runs.
    await page.evaluate(() =>
      window.update({
        supported: true,
        task: { id: 'task', status: 'running' },
        status: 'completed',
        message: { id: 'answer-1', role: 'assistant', text: 'First answer' },
      }),
    )
    await forkButton(page).waitFor()
    // A settled reply offers both forks with distinct labels. The files fork keeps its turn request.
    await page.evaluate(() => {
      window.confirmResult = false
      window.update({
        task: { id: 'task', status: 'review', repositoryId: 'repo', execution: 'main' },
        turn: { id: 'turn-1', checkpoint: { after: 'snapshot-tree' } },
      })
    })
    await forkButton(page).waitFor()
    await filesButton(page).click()
    await page.waitForFunction(() => window.prompts.length === 5)
    const snapshotPrompt = await page.evaluate(() => window.prompts.at(-1))
    assert.match(snapshotPrompt.description, /new worktree.*saved snapshot/)
    assert.equal(snapshotPrompt.details, 'Selected reply: First answer')
    assert.equal(await page.evaluate(() => window.requests.length), 3)
    await page.evaluate(() => (window.confirmResult = true))
    await filesButton(page).click()
    await page.waitForFunction(() => window.navigations.at(-1)?.entityId === 'turn-fork')
    assert.deepEqual(await page.evaluate(() => window.requests[3]), {
      path: '/api/tasks/fork',
      input: { id: 'task', turnId: 'turn-1' },
    })
    assert.equal(await page.evaluate(() => window.navigations.at(-1).messageId), 'answer-1')
    await forkButton(page).click()
    await page.waitForFunction(() => window.requests.length === 5)
    assert.match(await page.evaluate(() => window.prompts.at(-1).description), /from a Git commit/)
    // An older runtime keeps the reply fork and returns no message anchor.
    await page.evaluate(() => window.update({ supported: false, turn: { id: 'turn-1' } }))
    await forkButton(page).waitFor({ state: 'detached' })
    await filesButton(page).waitFor({ state: 'detached' })
    await replyButton(page).click()
    await page.waitForFunction(() => window.requests.length === 6)
    assert.match(
      await page.evaluate(() => window.prompts.at(-1).description),
      /no saved file snapshot.*local checkout/,
    )
    assert.deepEqual(await page.evaluate(() => window.navigations.at(-1)), {
      viewId: 'tasks',
      entityId: 'turn-fork',
    })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      'desktop message fork: confirmation copy, retry-safe fork ID, navigation, refusal reasons, hidden unsettled or unsupported states, both labelled fork actions and the older-runtime files fork pass.',
    )
  }

  {
    const { page, errors } = await open(mobile)
    await forkButton(page).click()
    await page.waitForFunction(() => window.navigations.length === 1)
    const [request] = await page.evaluate(() => window.requests)
    assert.equal(request.path, '/api/tasks/fork-message')
    assert.equal(request.input.messageId, 'user-1')
    assert.match(request.input.forkId, uuid)
    assert.equal(
      await page.evaluate(() => window.navigations[0]),
      `/computer/${request.input.forkId}`,
    )
    const [confirmation] = await page.evaluate(() => window.alerts)
    assert.equal(confirmation.title, 'Fork conversation?')
    assert.match(confirmation.message, /Files are not rewound/)
    assert.match(confirmation.message, /Selected message: First request/)
    assert.deepEqual(await page.evaluate(() => window.reveals[0]), {
      address: 'http://computer',
      taskId: request.input.forkId,
      messageId: 'user-1',
    })
    // Running turns hide the action.
    await page.evaluate(() => window.update({ status: 'running' }))
    await forkButton(page).waitFor({ state: 'detached' })
    // Refusals name the reason and send nothing.
    await page.evaluate(() =>
      window.update({
        status: 'completed',
        task: { ...window.state.task, sideThread: { parentTaskId: 'parent' } },
      }),
    )
    await forkButton(page).click()
    const refusal = await page.evaluate(() => window.alerts.at(-1))
    assert.equal(refusal.title, 'Could not fork')
    assert.match(refusal.message, /Side threads stay with their parent thread/)
    assert.equal(await page.evaluate(() => window.requests.length), 1)
    // User messages have no files fork. A settled reply offers both forks.
    await page.evaluate(() =>
      window.update({ task: { ...window.state.task, sideThread: undefined } }),
    )
    await forkButton(page).waitFor()
    await filesButton(page).waitFor({ state: 'detached' })
    await page.evaluate(() => {
      window.confirmResult = false
      window.update({ messageId: 'answer-1', user: false })
    })
    await forkButton(page).waitFor()
    await replyButton(page).click()
    const noSnapshot = await page.evaluate(() => window.alerts.at(-1))
    assert.equal(noSnapshot.title, 'Fork from this reply?')
    assert.match(noSnapshot.message, /Selected reply: First answer/)
    assert.match(noSnapshot.message, /no saved file snapshot.*local checkout/)
    assert.equal(await page.evaluate(() => window.requests.length), 1)
    await page.evaluate(() => {
      window.confirmResult = true
      window.update({
        task: {
          ...window.state.task,
          turns: [{ ...window.state.task.turns[0], checkpoint: { after: 'snapshot-tree' } }],
        },
      })
    })
    await filesButton(page).click()
    await page.waitForFunction(() => window.requests.length === 2)
    assert.deepEqual(await page.evaluate(() => window.requests[1]), {
      path: '/api/tasks/fork',
      input: { id: 'task', turnId: 't1' },
    })
    assert.equal(
      await page.evaluate(() => window.alerts.at(-1).title),
      'Fork with files from this turn?',
    )
    assert.match(
      await page.evaluate(() => window.alerts.at(-1).message),
      /new worktree.*saved snapshot/,
    )
    assert.deepEqual(await page.evaluate(() => window.reveals.at(-1)), {
      address: 'http://computer',
      taskId: 'turn-fork',
      messageId: 'answer-1',
    })
    // Older runtimes keep only the files fork on replies and show no fork on user messages.
    await page.evaluate(() => window.update({ supported: false }))
    await forkButton(page).waitFor({ state: 'detached' })
    await filesButton(page).click()
    await page.waitForFunction(() => window.requests.length === 3)
    assert.equal(await page.evaluate(() => window.requests[2].path), '/api/tasks/fork')
    assert.equal(await page.evaluate(() => window.reveals.length), 2)
    await page.evaluate(() => window.update({ messageId: 'user-1', user: true }))
    await forkButton(page).waitFor({ state: 'detached' })
    await filesButton(page).waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      'mobile message fork: confirmation copy, request, navigation, running and refused states, both labelled fork actions and the older-runtime files fork pass with native view stubs.',
    )
  }
} finally {
  await browser.close()
}
