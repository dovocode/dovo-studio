import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = root + 'packages/studio-ui/'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: dir,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceContext} from '../studio-core/src/workspace/context';
import {StudioConfirmationProvider} from './src/confirmation-provider';import {TooltipProvider} from './src/components/ui/tooltip';
import {TaskContextMenu} from '../extension-tasks/src/detail/task-context-menu';
import {TaskProjectActions} from '../extension-tasks/src/detail/task-project-actions';
import {SavedPromptsDialog} from '../extension-tasks/src/dialogs/saved-prompts-dialog';
import {TaskTemplatesDialog} from '../extension-tasks/src/dialogs/task-templates-dialog';
import {ProjectInstructionsDialog} from '../extension-tasks/src/dialogs/project-instructions-dialog';
import {McpAppView} from '../extension-tasks/src/chat/mcp-app';
const connections=['a','b'].map(id=>({address:'http://'+id,token:'paired-'+id}));
const task={id:'thread',title:'Thread',repositoryId:'repo',status:'completed',pinned:true,messages:[],files:[],turns:[],draft:''};
const repo={id:'repo',name:'Project',prompts:[{id:'prompt',name:'first',text:'Original prompt'}],templates:[{id:'template',name:'Template',objective:'Original goal'}]};
window.calls=[];window.closes=0;window.preferences={confirmUnpin:true,confirmArchive:true,threadInfoSections:{}};window.downloads=[];
const request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/mcp-apps/read'){await new Promise(resolve=>requestAnimationFrame(resolve));window.finishedAppReads=(window.finishedAppReads??0)+1;return {app:{id:input.id,taskId:input.taskId,connected:true,format:'apps'}}};if(path==='/api/mcp-apps/rpc'&&input.method==='resources/read'&&window.holdRead)return new Promise(resolve=>window.resolveRead=()=>resolve({result:{contents:[{uri:'file:///report.txt',text:'export content'}]}}));if(path==='/api/scm/instructions/read')return {text:'Original instructions',version:'v1'};return {ok:true,result:{ok:true}}};
function App(){const [runtime,setRuntime]=useState(0),[view,setView]=useState('row'),[visible,setVisible]=useState(true),[currentTask,setTask]=useState(task),[referenceId,setReferenceId]=useState('app'),[appTitle,setAppTitle]=useState('Fixture app');const [workspace,setWorkspace]=useState({tasks:[task],repositories:[repo],agents:[]});window.showView=next=>{setView(next);setVisible(true)};window.switchRuntime=()=>setRuntime(r=>1-r);window.showCaller=setVisible;window.makeBot=()=>{setView("row");setVisible(true);setTask(task=>({...task,bot:{role:"Assistant",state:"active"}}))};window.changeRun=()=>setTask(t=>({...t,status:'running',activeRunId:'new-run'}));window.changeApp=()=>setReferenceId('other-app');window.changeAppTitle=()=>setAppTitle('Renamed app');
const value={workspace,setWorkspace,request,connected:true,connection:connections[runtime],activeRuntimeId:['a','b'][runtime],runtimeRegistry:{profiles:[]},refreshRuntimes:async()=>{},previewTask:(_connection,_id,_updates,apply)=>apply()};
const close=()=>{window.closes++;setVisible(false)};
return <WorkspaceContext.Provider value={value}><TooltipProvider><StudioConfirmationProvider>{visible&&(view==='row'?<TaskContextMenu dropdown task={currentTask} owner={{runtimeId:value.activeRuntimeId,address:value.connection.address,name:'Computer',online:true,repositories:[],agents:[],worktreeDeletionOverrideSupported:false}} selected={false} busy={false} onOpen={()=>{}} onCreate={()=>{}} onFilter={()=>{}} onDeselect={()=>{}} onError={message=>{if(message)throw Error(message)}}><button>Thread actions</button></TaskContextMenu>:view==='prompts'?<SavedPromptsDialog repositoryId="repo" onClose={close}/>:view==='templates'?<TaskTemplatesDialog repositoryId="repo" onClose={close}/>:view==='instructions'?<ProjectInstructionsDialog repositoryId="repo" onClose={close}/>:view==='actions'?<TaskProjectActions task={task} onTerminal={()=>{}}/>:<McpAppView reference={{taskId:'thread',id:referenceId,title:appTitle}}/>)}</StudioConfirmationProvider></TooltipProvider></WorkspaceContext.Provider>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `
export * from '../studio-core/src/index';
export {useWorkspace} from '../studio-core/src/workspace/context';
import {useWorkspace} from '../studio-core/src/workspace/context';
export const useWorkspaceSelector=select=>select(useWorkspace());export const sameWorkspaceFields=()=>false;
export const useStudioHost=()=>({});export const useResolvedTheme=()=> 'dark';
export const useAppPreferences=()=>window.preferences;export const readAppPreferences=()=>window.preferences;
export const startMcpAppTools=()=>({setTools(){},setVisible(){},stop:async()=>{}});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
export {Button} from './src/components/ui/button';export {IconButton} from './src/components/icon-button';
export {Input} from './src/components/ui/input';export {Textarea} from './src/components/ui/textarea';
export {Checkbox} from './src/components/ui/checkbox';export {FormField} from './src/components/form-field';
export * from './src/components/ui/dialog';
export {permissionPolicyUIIssue} from './src/permission-policy-fields';
export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
    },
    { path: '@dovo/extension-scm/projects', contents: 'export const ProjectSettings=()=>null;' },
    {
      path: '@dovo/extension-scm/project-transfer',
      contents: 'export const ProjectTransferDialog=()=>null;',
    },
    {
      path: '../../../studio-ui/mcp-apps/host.json',
      importer: root + 'packages/extension-tasks/src/chat/',
      contents: `export default ${JSON.stringify(`<script>window.addEventListener('message',e=>{if(e.data.type==='load'){window.nonce=e.data.nonce;parent.postMessage({type:'notice',nonce:window.nonce,message:'Fixture ready '+window.nonce},'*')}if(e.data.type==='reply')window.replies.push(e.data)});window.replies=[];window.sendRequest=(method,params)=>{const requestId=String(++window.sequence);parent.postMessage({type:'request',nonce:window.nonce,requestId,method,params},'*');return requestId};window.sequence=0;</script>`)}`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 850 },
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.on('dialog', () => {
    throw Error('Unexpected native confirmation')
  })
  await page.setContent('<div id="app"></div>')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const dialog = (title) => page.getByRole('dialog', { name: title, exact: true })
  const decide = async (title, accept, label) => {
    const prompt = dialog(title)
    await prompt.waitFor()
    assert.equal(
      await prompt
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    )
    await prompt.getByRole('button', { name: accept ? label : 'Cancel', exact: true }).click()
    await prompt.waitFor({ state: 'hidden' })
  }
  const rowAction = async (name) => {
    await page.getByRole('button', { name: 'Thread actions', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await rowAction('Unpin')
  await decide('Unpin “Thread”?', false)
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await rowAction('Unpin')
  await decide('Unpin “Thread”?', true, 'Unpin thread')
  await page.waitForFunction(() => window.calls.length === 1)
  assert.equal(await page.evaluate(() => window.calls[0].input.changes.pinned.after), false)
  await page.evaluate(() => (window.calls = []))
  await rowAction('Archive thread')
  await page.evaluate(() => window.switchRuntime())
  await dialog('Archive “Thread”?').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await rowAction('Archive thread')
  await decide('Archive “Thread”?', true, 'Archive thread')
  await page.waitForFunction(() => window.calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.calls[0].input), {
    id: 'thread',
    action: 'archive',
  })

  // Every edited project dialog keeps its draft when consent is cancelled.
  for (const [view, title, label] of [
    ['prompts', 'Discard saved prompt changes?', 'Prompt 1 text'],
    ['templates', 'Discard thread template changes?', 'Template 1 goal'],
    ['instructions', 'Discard project instruction changes?', 'AGENTS.md'],
  ]) {
    await page.evaluate((view) => window.showView(view), view)
    await page.getByLabel(label, { exact: true }).fill('Keep this changed draft')
    const close = page
      .getByRole('button', { name: view === 'instructions' ? 'Close' : 'Cancel', exact: true })
      .first()
    await close.click()
    await decide(title, false)
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      'Keep this changed draft',
    )
    await close.click()
    await decide(title, true, 'Discard changes')
    await page.getByLabel(label, { exact: true }).waitFor({ state: 'hidden' })
  }
  await page.evaluate(() => window.showView('actions'))
  await page.getByRole('button', { name: 'Project actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit project actions…', exact: true }).click()
  await page.getByLabel('Command', { exact: true }).fill('pnpm test')
  await dialog('Project actions').getByRole('button', { name: 'Cancel', exact: true }).click()
  await decide('Discard project action changes?', false)
  assert.equal(await page.getByLabel('Command', { exact: true }).inputValue(), 'pnpm test')
  await dialog('Project actions').getByRole('button', { name: 'Cancel', exact: true }).click()
  await decide('Discard project action changes?', true, 'Discard changes')
  await dialog('Project actions').waitFor({ state: 'hidden' })

  let ready = ''
  const waitReady = async () => {
    await page.waitForFunction(
      (previous) =>
        [...document.querySelectorAll('[role="status"]')].some(
          (el) => el.textContent.startsWith('Fixture ready ') && el.textContent !== previous,
        ),
      ready,
    )
    ready = await page.getByText(/^Fixture ready /).innerText()
  }
  await page.evaluate(() => {
    window.calls = []
    window.showView('mcp')
  })
  await waitReady()
  const frame = () => page.frames().find((frame) => frame.parentFrame() === page.mainFrame())
  const send = async (method, params) =>
    frame().evaluate(({ method, params }) => window.sendRequest(method, params), { method, params })
  const params = {
    text: '<img src=x onerror="window.injected=true">' + 'x'.repeat(1800) + 'END_OF_REQUEST',
  }
  await send('ui/message', params)
  const consent = dialog('Send MCP App message?')
  await consent.waitFor()
  assert.match(await consent.getByRole('region', { name: 'Details' }).innerText(), /END_OF_REQUEST/)
  assert.equal(await consent.locator('img').count(), 0)
  assert.equal(
    await consent
      .getByRole('region', { name: 'Details' })
      .evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
  )
  await decide('Send MCP App message?', false)
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path === '/api/mcp-apps/rpc').length),
    0,
  )
  const messageRequestId = await send('ui/message', params)
  await consent.waitFor()
  const readsBeforeRefresh = await page.evaluate(() => window.finishedAppReads)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => window.fixtureVisibility ?? 'visible',
    })
    window.fixtureVisibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.evaluate(() => {
    window.fixtureVisibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForFunction((previous) => window.finishedAppReads > previous, readsBeforeRefresh)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  // Presentation updates may replace the listener while the same request is pending.
  await page.evaluate(() => window.changeAppTitle())
  await page.getByText('Renamed app', { exact: true }).waitFor()
  await decide('Send MCP App message?', true, 'Send message')
  await page.waitForFunction(() => window.calls.some((c) => c.path === '/api/mcp-apps/rpc'), null, {
    timeout: 3000,
  })
  await frame().waitForFunction(
    (requestId) =>
      window.replies.some((reply) => reply.requestId === requestId && reply.result?.ok),
    messageRequestId,
    { timeout: 3000 },
  )
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((c) => c.path === '/api/mcp-apps/rpc').input.params,
    ),
    params,
  )
  await page.evaluate(() => (window.calls = []))
  await send('ui/message', { role: 'user', content: [{ type: 'text', text: 'Create' }] })
  await dialog('Send MCP App message?').waitFor()
  await page.evaluate(() => window.changeApp())
  await dialog('Send MCP App message?').waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path === '/api/mcp-apps/rpc').length),
    0,
  )
  await waitReady()
  await send('ui/download-file', { contents: [{ type: 'text', text: 'file' }] })
  await decide('Download MCP App files?', false)
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path === '/api/mcp-apps/rpc').length),
    0,
  )
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function () {
      window.downloads.push(this.download)
    }
  })
  await send('ui/download-file', {
    contents: [
      { type: 'resource', resource: { uri: 'file:///report.txt', text: 'export content' } },
    ],
  })
  await decide('Download MCP App files?', true, 'Download files')
  await page.waitForFunction(() => window.downloads.length === 1)
  assert.deepEqual(await page.evaluate(() => window.downloads), ['report.txt'])
  await page.evaluate(() => {
    window.calls = []
    window.holdRead = true
  })
  await send('ui/download-file', { contents: [{ type: 'resource_link', uri: 'ui://report.txt' }] })
  await decide('Download MCP App files?', true, 'Download files')
  await page.waitForFunction(() => typeof window.resolveRead === 'function')
  await page.evaluate(() => window.switchRuntime())
  await waitReady()
  await page.evaluate(() => window.resolveRead())
  assert.equal(await page.evaluate(() => window.downloads.length), 1)
  await page.evaluate(() => (window.calls = []))
  await send('ui/message', { text: 'Unmounted app' })
  await dialog('Send MCP App message?').waitFor()
  await page.evaluate(() => window.showCaller(false))
  await dialog('Send MCP App message?').waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path === '/api/mcp-apps/rpc').length),
    0,
  )
  await page.evaluate(() => window.makeBot())
  await page.getByRole('button', { name: 'Thread actions', exact: true }).click()
  await page.getByRole('menu').waitFor()
  for (const label of [
    'Settle',
    'Reopen',
    'Snooze',
    'Archive thread',
    'Restore thread',
    'Delete thread…',
    'Auto-settle behavior',
    'Auto-archive after settled',
    'Regenerate title',
  ])
    assert.equal(
      await page.getByRole('menuitem', { name: label, exact: true }).count(),
      0,
      `Hide ${label} for Bots`,
    )
  assert.equal(await page.getByRole('menuitem', { name: 'Unpin', exact: true }).count(), 1)
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  console.log(
    'Task confirmations: unpin/archive accept/cancel/runtime guards, four draft dialogs, full safe MCP consent, visibility/title refresh completion, app replacement and unmount cancellation pass.',
  )
} finally {
  await browser.close()
}
