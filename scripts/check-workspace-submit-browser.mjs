import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Keep the actual workspace, input, thread, browser and terminal components/providers.
// Only the runtime transport is simulated, so submitting also exercises pane mounting.
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {useCallback,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Effect} from 'effect';
import {decode,snapshotSchema,STUDIO_TERMINAL_SCOPE} from '@dovo/protocol';
import {StudioHostProvider,updateAppPreferences} from '@dovo/studio-core';
import {WorkspaceValueProvider} from './packages/studio-core/src/workspace/selector';
import {ApplicationStateProvider,useApplicationState} from '@dovo/studio-core/state';
import {TooltipProvider,SidebarHeaderLayout,HeaderFallback,HeaderMainSlot} from '@dovo/studio-ui';
import UnifiedWorkspace from './packages/extension-tasks/src/unified/workspace-view';
updateAppPreferences({unifiedWorkspaceEnabled:true});
const connection={address:'http://runtime.lan',token:'fixture-paired-device-token',runtimeId:'runtime'};
const profile={id:'local',name:'Local computer',connection};
const initial=decode(snapshotSchema,{revision:1,runtimeId:'runtime',owner:false,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[{id:'scratch',kind:'scratch',name:'General',path:'/tmp',branch:''}],tasks:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
window.calls=[];window.commands=new Map();window.registrations=0;window.disposals=0;
function App(){
 const [snapshot,setSnapshot]=useState(initial);
 const [collapsed,setCollapsed]=useState(false);
 const [paletteVersion,setPaletteVersion]=useApplicationState(0);
 window.snapshot=snapshot;window.paletteVersion=paletteVersion;window.refreshSnapshot=()=>setSnapshot(current=>({...current}));
 const setWorkspace=useCallback(update=>setSnapshot(current=>({...current,workspace:typeof update==='function'?update(current.workspace):update})),[]);
 const respond=useCallback(async(_profile,path,input,method)=>{
  window.calls.push({path,input,method});
  if(path==='/api/tasks/workspace/route')return {mode:window.routeMode??'thread',reason:'Review this destination'};
  if(path==='/api/workspace'){if(input.create)setWorkspace(workspace=>({...workspace,tasks:[...workspace.tasks,input.create]}));return {revision:2,outcome:'applied'}}
  if(path==='/api/tasks/message'){if(window.messageError)throw Error(window.messageError);setWorkspace(workspace=>({...workspace,tasks:workspace.tasks.map(task=>task.id===input.id?{...task,status:'running',messages:[{id:input.messageId,role:'user',text:input.text}]}:task)}));return {ok:true}}
  if(path==='/api/terminals/shells')return {shells:[{id:'default',label:'Default shell',path:'/bin/bash',args:['-l']}]};
  if(path==='/api/terminals/workspace'){const session={id:'created-terminal',taskId:STUDIO_TERMINAL_SCOPE,title:'Submitted terminal',exited:false,directory:'/tmp',shellId:'default'};setSnapshot(current=>({...current,terminals:[...current.terminals,session]}));return session}
  if(path==='/api/terminals/update'){
   const session=window.snapshot.terminals.find(session=>session.id===input.id);
   if(!session)throw Error('Unknown terminal '+input.id);
   const updated={...session,title:input.title??session.terminalTitle??'Submitted terminal',customTitle:input.title??undefined};
   setSnapshot(current=>({...current,terminals:current.terminals.map(session=>session.id===input.id?updated:session)}));
   return updated;
  }
  if(path==='/api/tasks/waiting')return {dependencies:[]};
  if(path==='/api/previews/browser/profiles/read')return {profiles:[{id:'default',name:'Default'}]};
  if(path==='/api/agents/availability')return [];
  if(path==='/api/models')return {providers:[],models:[]};
  if(path==='/api/tasks/title')return {title:'Submitted thread'};
  throw Error('Unexpected fixture request '+path);
 },[setWorkspace]);
 const read=useCallback(async(profile,path,input,schema,method)=>decode(schema,await respond(profile,path,input,method)),[respond]);
 const readRuntimeEffect=useCallback((...args)=>Effect.promise(()=>read(...args)),[read]);
 const registerCommand=useCallback(command=>{if(window.commands.has(command.id))throw Error('Duplicate command: '+command.id);window.commands.set(command.id,command);window.registrations++;setPaletteVersion(value=>value+1);return ()=>{window.disposals++;window.commands.delete(command.id);setPaletteVersion(value=>value+1)}},[]);
 const actions=useMemo(()=>({ready:true,storageError:null,connected:true,connection,activeRuntimeId:'local',localRuntimeId:null,syncError:null,pendingSync:false,syncConflicts:[],runtimeRegistry:{version:1,activeId:'local',profiles:[profile]},request:(...args)=>read(profile,...args),requestEffect:(...args)=>readRuntimeEffect(profile,...args),readRuntime:read,readRuntimeEffect,setWorkspace,flush:async()=>{},refreshRuntime:async()=>{},refreshRuntimes:async()=>{},switchRuntime:async()=>{},pendingMessages:()=>[],mutationStatus:()=>({pending:0,error:null}),readCache:null,runtimeReadCache:()=>null}),[read,readRuntimeEffect,setWorkspace]);
 const value={...actions,snapshot,workspace:snapshot.workspace,runtimes:[{profile,snapshot,connected:true,error:null}]};
 const host={navigate:()=>{},registerCommand,openExternalLink:async()=>{},platform:'web'};
 return <StudioHostProvider api={host}><WorkspaceValueProvider value={value}><SidebarHeaderLayout collapsed={collapsed} onCollapsedChange={setCollapsed} brand={<div>Workspace fixture</div>}><HeaderFallback><HeaderMainSlot/></HeaderFallback><UnifiedWorkspace/></SidebarHeaderLayout></WorkspaceValueProvider></StudioHostProvider>;
}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><TooltipProvider><App/></TooltipProvider></ApplicationStateProvider>);
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  plugins: [
    {
      name: 'workspace-packages',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: root + 'packages/studio-ui/src/index.ts',
        }))
      },
    },
  ],
  loader: { '.css': 'empty', '.woff2': 'dataurl', '.wasm': 'dataurl' },
  nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.url': '"http://workspace.lan/fixture.js"',
  },
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://workspace.lan')
  // The real canvas renderer needs its containment styles even in this layout-free fixture.
  await page.addStyleTag({
    content:
      readFileSync(
        new URL('../packages/terminal/src/browser/styles.css', import.meta.url),
        'utf8',
      ) + '\n[data-terminal-session] .h-full.p-2 { height: 240px; }',
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Workspace request', exact: true })
  const selectThread = async (title) => {
    const working = page.locator('.studio-task-sidebar details[data-section="working"]')
    if ((await working.count()) && !(await working.evaluate((section) => section.open)))
      await working.locator('summary').click()
    await page
      .locator('.studio-task-sidebar')
      .getByRole('group', { name: `Thread: ${title}`, exact: true })
      .locator('.studio-thread-card')
      .click()
  }
  await page.evaluate(() => {
    window.routeMode = 'browser'
  })
  await input.fill('Investigate the submit crash')
  await input.press('Enter')
  await page.getByRole('button', { name: 'Open browser', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 0)
  assert.equal(await page.getByRole('tab').count(), 0)
  // The AI suggestion remains visible and can be overridden before confirmation.
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Thread', exact: true }).click()
  assert.equal(await input.inputValue(), 'Investigate the submit crash')
  await page.evaluate(() => {
    window.messageError = 'Fixture send failure'
  })
  await input.press('Enter')
  await page.getByRole('alert').filter({ hasText: 'Thread saved' }).waitFor()
  assert.equal(await input.inputValue(), 'Investigate the submit crash')
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 1)
  await page.evaluate(() => {
    window.messageError = ''
  })
  await input.press('Enter')
  await page.getByRole('textbox', { name: 'Message task', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 1)
  const messageIds = await page.evaluate(() =>
    window.calls
      .filter((call) => call.path === '/api/tasks/message')
      .map((call) => call.input.messageId),
  )
  assert.equal(messageIds.length, 2)
  assert.equal(messageIds[0], messageIds[1], 'Retry uses the saved task and message receipt')
  await page
    .getByRole('textbox', { name: 'Message task', exact: true })
    .fill('Retained first-thread draft')
  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Thread', exact: true }).click()
  await input.fill('Second retained thread')
  await input.press('Enter')
  await page.getByRole('textbox', { name: 'Message task', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 2)
  await page
    .getByRole('textbox', { name: 'Message task', exact: true })
    .fill('Retained second-thread draft')
  await selectThread('Investigate the submit crash')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message task', exact: true }).innerText(),
    'Retained first-thread draft',
  )
  await selectThread('Second retained thread')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message task', exact: true }).innerText(),
    'Retained second-thread draft',
  )
  assert.equal(
    await page.evaluate(() => window.commands.size),
    4,
    'Only the visible TasksView owns global commands',
  )
  // The sidebar starter mounts a temporary TasksView; its first edit persists and reroutes it.
  await page
    .locator('.studio-task-sidebar')
    .getByRole('button', { name: 'New thread', exact: true })
    .click()
  const starter = page.getByRole('textbox', { name: 'Message task', exact: true })
  await starter.fill('Draft from the empty thread starter')
  await page.waitForFunction(() => window.snapshot.workspace.tasks.length === 3)
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.path === '/api/tasks/message' &&
        call.input.text === 'Draft from the empty thread starter',
    ),
  )

  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Thread', exact: true }).click()
  await input.fill('Third thread from Home')
  await input.press('Enter')
  await page.getByRole('textbox', { name: 'Message task', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 4)
  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Browser', exact: true }).click()
  await input.fill('http://lan.local:3000/')
  await selectThread('Investigate the submit crash')
  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  assert.equal(await input.inputValue(), 'http://lan.local:3000/')
  assert.equal(
    await page
      .getByRole('button', { name: 'Workspace destination', exact: true })
      .getAttribute('data-value'),
    'browser',
  )
  await page.getByRole('button', { name: 'Open browser', exact: true }).click()
  await page.locator('[data-browser-viewport]').waitFor()
  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Terminal', exact: true }).click()
  await input.fill('printf submit-regression')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  const terminal = page.locator('[data-terminal-session="created-terminal"]')
  await terminal.locator('.dovo-terminal').waitFor()
  await terminal.evaluate((element) => {
    window.originalTerminalPane = element
    window.originalTerminal = element.querySelector('.dovo-terminal')
    window.originalTerminalInput = element.querySelector('.dovo-terminal-input')
  })
  const rename = page.getByRole('button', { name: 'Rename terminal', exact: true })
  await rename.click()
  const titleDialog = page.getByRole('dialog', { name: 'Rename terminal', exact: true })
  const titleInput = titleDialog.getByRole('textbox', { name: 'Terminal title', exact: true })
  assert.equal(await titleInput.inputValue(), 'Submitted terminal')
  await titleInput.fill('  Named terminal  ')
  await titleDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await titleDialog.waitFor({ state: 'hidden' })
  assert.equal(await rename.innerText(), 'Named terminal')
  assert.equal(
    await page.evaluate(() => window.snapshot.terminals[0].customTitle),
    'Named terminal',
  )
  const assertRetainedTerminal = async () => {
    assert.equal(await terminal.count(), 1)
    assert.equal(
      await terminal.evaluate(
        (element) =>
          element === window.originalTerminalPane &&
          element.querySelector('.dovo-terminal') === window.originalTerminal &&
          element.querySelector('.dovo-terminal-input') === window.originalTerminalInput &&
          window.originalTerminal.isConnected,
      ),
      true,
      'Changing the terminal title preserves the mounted pane, terminal engine and input',
    )
  }
  await assertRetainedTerminal()
  await rename.click()
  assert.equal(await titleInput.inputValue(), 'Named terminal')
  await titleDialog.getByRole('button', { name: 'Use automatic title', exact: true }).click()
  await titleDialog.waitFor({ state: 'hidden' })
  assert.equal(await rename.innerText(), 'Submitted terminal')
  assert.equal(await page.evaluate(() => window.snapshot.terminals[0].customTitle), undefined)
  await assertRetainedTerminal()
  assert.deepEqual(
    await page.evaluate(() => window.calls.filter((call) => call.path === '/api/terminals/update')),
    [
      {
        path: '/api/terminals/update',
        input: { id: 'created-terminal', title: 'Named terminal' },
        method: 'POST',
      },
      {
        path: '/api/terminals/update',
        input: { id: 'created-terminal', title: null },
        method: 'POST',
      },
    ],
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    1,
    'Rename and automatic-title reset never create a replacement shell',
  )
  // Allow effects to settle and check that palette invalidation did not restart registration.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const registrations = await page.evaluate(() => window.registrations)
  assert.equal(registrations, 32, 'Eight visible thread lifetimes each register four commands')
  assert.equal(await page.evaluate(() => window.disposals), registrations)
  assert.equal(
    await page.evaluate(() => window.commands.size),
    0,
    'Hidden threads release every global command',
  )
  await page.evaluate(() => window.refreshSnapshot())
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await page.evaluate(() => window.registrations), registrations)
  assert.deepEqual(errors, [])
  console.log(
    'Actual unified input opens real thread, browser and terminal panes; retained threads preserve drafts and release/resume commands without duplicate IDs; routing requires confirmation, failed sends reuse receipts, and terminal rename/reset preserve the engine and send exact POST payloads.',
  )
} finally {
  await browser.close()
}
