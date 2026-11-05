import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { encodeTerminalStreamFrame } from '../packages/protocol/dist/index.js'
import { WebSocketServer } from 'ws'

const root = fileURLToPath(new URL('../', import.meta.url))
const reactMode = process.argv.includes('--production') ? 'production' : 'development'
// Keep the actual workspace, input, thread, browser and terminal components/providers.
// Only the runtime transport is simulated, so submitting also exercises pane mounting.
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {useCallback,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {Effect} from 'effect';
import {decode,snapshotSchema,STUDIO_TERMINAL_SCOPE} from '@dovo/protocol';
import {StudioHostProvider,updateAppPreferences,createTask} from '@dovo/studio-core';
import {WorkspaceValueProvider} from './packages/studio-core/src/workspace/selector';
import {ApplicationStateProvider,useApplicationState} from '@dovo/studio-core/state';
import {TooltipProvider,SidebarHeaderLayout,HeaderFallback} from '@dovo/studio-ui';
import {TitleBar} from './packages/studio-shell/src/title-bar';
import UnifiedWorkspace from './packages/extension-tasks/src/unified/workspace-view';
updateAppPreferences({unifiedWorkspaceEnabled:true});
const connection={address:window.terminalRuntimeAddress,token:'fixture-paired-device-token',runtimeId:'runtime'};
const profile={id:'local',name:'Local computer',connection};
const remote={id:'remote',name:'Remote computer',connection:{address:'http://remote.lan',token:'remote-paired-device-token',runtimeId:'remote-runtime'}};
const profiles=[profile,remote];
const initial=decode(snapshotSchema,{revision:1,runtimeId:'runtime',owner:false,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[{id:'scratch',kind:'scratch',name:'General',path:'/tmp',branch:''}],tasks:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
const remoteInitial=decode(snapshotSchema,{...initial,runtimeId:'remote-runtime',workspace:{...initial.workspace,tasks:[createTask({title:'Remote retained thread',objective:'',agentId:'',repositoryId:'scratch'})]}});
window.calls=[];window.runtimeCalls=[];window.unexpectedRequests=[];window.switches=[];window.commands=new Map();window.registrations=0;window.disposals=0;
function App(){
 const [snapshots,setSnapshots,snapshotsRef]=useApplicationState({local:initial,remote:remoteInitial});
 const [activeRuntimeId,setActiveRuntimeId]=useApplicationState('local');
 const [collapsedSections,setCollapsedSections]=useApplicationState({});
 const collapsed=collapsedSections.workspace??false;
 const setCollapsed=useCallback(next=>setCollapsedSections(previous=>({...previous,workspace:typeof next==='function'?next(previous.workspace??false):next})),[setCollapsedSections]);
 const [paletteVersion,setPaletteVersion]=useApplicationState(0);
 const owner=profiles.find(profile=>profile.id===activeRuntimeId);
 const snapshot=snapshots[activeRuntimeId];
 const updateSnapshot=useCallback((id,update)=>setSnapshots(current=>({...current,[id]:update(current[id])})),[setSnapshots]);
 const updateWorkspace=useCallback((id,update)=>updateSnapshot(id,current=>({...current,workspace:typeof update==='function'?update(current.workspace):update})),[updateSnapshot]);
 window.snapshot=snapshot;window.snapshots=snapshots;window.activeRuntimeId=activeRuntimeId;window.paletteVersion=paletteVersion;
 window.refreshSnapshot=()=>updateSnapshot(activeRuntimeId,current=>({...current}));
 window.setSidebarCollapsed=setCollapsed;
 const setWorkspace=useCallback(update=>updateWorkspace(activeRuntimeId,update),[activeRuntimeId,updateWorkspace]);
 const respond=useCallback(async(owner,path,input,method)=>{
  window.calls.push({path,input,method});
  window.runtimeCalls.push({owner:owner.id,path,input,method});
  if(path==='/api/tasks/workspace/route')return {mode:window.routeMode??'thread',reason:'Review this destination'};
  if(path==='/api/workspace'){if(input.create)updateWorkspace(owner.id,workspace=>({...workspace,tasks:[...workspace.tasks,input.create]}));return {revision:2,outcome:'applied'}}
  if(path==='/api/tasks/message'){if(window.messageError)throw Error(window.messageError);updateWorkspace(owner.id,workspace=>({...workspace,tasks:workspace.tasks.map(task=>task.id===input.id?{...task,status:'running',messages:[{id:input.messageId,role:'user',text:input.text}]}:task)}));return {ok:true}}
  if(path==='/api/terminals/shells')return {shells:[{id:'default',label:'Default shell',path:'/bin/bash',args:['-l']}]};
  if(path==='/api/terminals/ticket')return {ticket:'fixture-terminal-ticket'};
  if(path==='/api/terminals/workspace'){const session={id:'created-terminal',taskId:STUDIO_TERMINAL_SCOPE,title:'Submitted terminal',exited:false,directory:'/tmp',shellId:'default'};updateSnapshot(owner.id,current=>({...current,terminals:[...current.terminals,session]}));return session}
  if(path==='/api/terminals/update'){
   const session=snapshotsRef.current[owner.id].terminals.find(session=>session.id===input.id);
   if(!session)throw Error('Unknown terminal '+input.id);
   const updated={...session,title:input.title??session.terminalTitle??'Submitted terminal',customTitle:input.title??undefined};
   updateSnapshot(owner.id,current=>({...current,terminals:current.terminals.map(session=>session.id===input.id?updated:session)}));
   return updated;
  }
  if(path==='/api/tasks/waiting')return {dependencies:[]};
  if(path==='/api/activity')return {events:[]};
  if(path==='/api/agents/models/cached'||path==='/api/agents/models')return {models:[{id:'fixture-model',name:'Fixture model'}],reasoning:[]};
  if(path==='/api/previews/browser/profiles/read')return {profiles:[{id:'default',name:'Default'}]};
  if(path==='/api/previews/browser/open')return {ticket:JSON.stringify({url:input.url||'about:blank'}),host:'Fixture browser',tabId:input.tabId,profileId:input.profileId};
  if(path==='/api/agents/availability')return [];
  if(path==='/api/models')return {providers:[],models:[]};
  if(path==='/api/tasks/title')return {title:'Submitted thread'};
  window.unexpectedRequests.push(path);throw Error('Unexpected fixture request '+path);
 },[updateWorkspace,updateSnapshot,snapshotsRef]);
 const read=useCallback(async(profile,path,input,schema,method)=>decode(schema,await respond(profile,path,input,method)),[respond]);
 const readRuntimeEffect=useCallback((...args)=>Effect.promise(()=>read(...args)),[read]);
 const registerCommand=useCallback(command=>{if(window.commands.has(command.id))throw Error('Duplicate command: '+command.id);window.commands.set(command.id,command);window.registrations++;setPaletteVersion(value=>value+1);return ()=>{window.disposals++;window.commands.delete(command.id);setPaletteVersion(value=>value+1)}},[]);
 // Like WorkspaceProvider's cached openProfile path, switch only after asynchronous flush/read.
 const switchRuntime=useCallback(async id=>{if(!profiles.some(profile=>profile.id===id))throw Error('Unknown runtime '+id);window.switches.push(id);await Promise.resolve();setActiveRuntimeId(id)},[setActiveRuntimeId]);
 const refreshRuntime=useCallback(async owner=>updateSnapshot(owner.id,current=>({...current})),[updateSnapshot]);
 const actions=useMemo(()=>({ready:true,storageError:null,connected:true,connection:owner.connection,activeRuntimeId,localRuntimeId:null,syncError:null,pendingSync:false,syncConflicts:[],runtimeRegistry:{version:1,activeId:activeRuntimeId,profiles},request:(...args)=>read(owner,...args),requestEffect:(...args)=>readRuntimeEffect(owner,...args),readRuntime:read,readRuntimeEffect,setWorkspace,flush:async()=>{},refreshRuntime,refreshRuntimes:async()=>{},switchRuntime,pendingMessages:()=>[],mutationStatus:()=>({pending:0,error:null}),readCache:null,runtimeReadCache:()=>null}),[owner,activeRuntimeId,read,readRuntimeEffect,setWorkspace,refreshRuntime,switchRuntime]);
 const value={...actions,snapshot,workspace:snapshot.workspace,runtimes:profiles.map(profile=>({profile,snapshot:snapshots[profile.id],connected:true,error:null}))};
 const host=useMemo(()=>({navigate:()=>{},registerCommand,openExternalLink:async()=>{},platform:'web'}),[registerCommand]);
 const noop=useCallback(()=>{},[]);
 return <StudioHostProvider api={host}><WorkspaceValueProvider value={value}><SidebarHeaderLayout collapsed={collapsed} onCollapsedChange={setCollapsed} brand={<TitleBar sidebar online={0} devices={0} onDevices={noop} onSearch={noop}/>}><HeaderFallback><TitleBar section="Workspace" online={0} devices={0} onDevices={noop} onSearch={noop}/></HeaderFallback><UnifiedWorkspace/></SidebarHeaderLayout></WorkspaceValueProvider></StudioHostProvider>;
}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><TooltipProvider><App/></TooltipProvider></ApplicationStateProvider>);
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  conditions: [reactMode],
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
    'process.env.NODE_ENV': JSON.stringify(reactMode),
    'import.meta.url': 'window.location.href',
  },
})
const terminalWorker = await build({
  entryPoints: [root + 'packages/terminal/src/browser/terminal.worker.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  loader: { '.wasm': 'dataurl' },
})
// Real HTTP gives workers the correct local address space for Chromium's LAN permission checks.
const server = createServer((request, response) => {
  const worker = request.url === '/terminal.worker.ts'
  response.setHeader('Content-Type', worker ? 'text/javascript' : 'text/html')
  response.end(worker ? terminalWorker.outputFiles[0].text : '<div id="app"></div>')
})
const sockets = new WebSocketServer({ server })
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const terminalRuntimeAddress = `http://127.0.0.1:${server.address().port}`
const terminalSockets = []
const browserMessages = []
sockets.on('connection', (socket, request) => {
  const target = new URL(request.url, terminalRuntimeAddress)
  if (target.pathname === '/ws/browser') {
    const { url } = JSON.parse(target.searchParams.get('ticket'))
    const state = {
      type: 'state',
      url,
      title: url === 'about:blank' ? '' : url,
      back: false,
      forward: false,
      loading: false,
      editable: false,
    }
    const publish = () => socket.send(JSON.stringify(state))
    publish()
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      browserMessages.push(message)
      if (['status', 'visibility', 'resize'].includes(message.type)) publish()
    })
    return
  }
  terminalSockets.push(request.url)
  const send = (frame) => socket.send(encodeTerminalStreamFrame(frame))
  send({ type: 'replayStart' })
  send({ type: 'data', data: new TextEncoder().encode('Retained terminal replay\r\n') })
  send({ type: 'replayEnd' })
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'ping') send({ type: 'pong', nonce: message.nonce })
    if (message.type === 'input')
      send({ type: 'data', data: new TextEncoder().encode(message.data) })
  })
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  let phase = 'submit destinations'
  page.on('pageerror', (error) => {
    errors.push(`${phase}: ${error.message}`)
    console.error(`${phase}: ${error.stack}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${phase}: ${message.text()}`)
  })
  await page.goto(terminalRuntimeAddress)
  await page.evaluate((address) => {
    window.terminalRuntimeAddress = address
  }, terminalRuntimeAddress)
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
  await page.getByRole('textbox', { name: 'Message thread', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 1)
  const messageIds = await page.evaluate(() =>
    window.calls
      .filter((call) => call.path === '/api/tasks/message')
      .map((call) => call.input.messageId),
  )
  assert.equal(messageIds.length, 2)
  assert.equal(messageIds[0], messageIds[1], 'Retry uses the saved task and message receipt')
  await page
    .getByRole('textbox', { name: 'Message thread', exact: true })
    .fill('Retained first-thread draft')
  await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  await page.getByRole('button', { name: 'Workspace destination', exact: true }).click()
  await page.getByRole('option', { name: 'Thread', exact: true }).click()
  await input.fill('Second retained thread')
  await input.press('Enter')
  await page.getByRole('textbox', { name: 'Message thread', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.snapshot.workspace.tasks.length), 2)
  await page
    .getByRole('textbox', { name: 'Message thread', exact: true })
    .fill('Retained second-thread draft')
  await selectThread('Investigate the submit crash')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message thread', exact: true }).innerText(),
    'Retained first-thread draft',
  )
  await selectThread('Second retained thread')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message thread', exact: true }).innerText(),
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
  const starter = page.getByRole('textbox', { name: 'Message thread', exact: true })
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
  await page.getByRole('textbox', { name: 'Message thread', exact: true }).waitFor()
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
  await page.waitForFunction(() =>
    document
      .querySelector('.dovo-terminal-accessible')
      ?.textContent.includes('Retained terminal replay'),
  )
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
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  const assertCommands = async (count) => {
    await page.waitForFunction((count) => window.commands.size === count, count)
    await settle()
    assert.equal(await page.evaluate(() => window.commands.size), count)
    assert.deepEqual(errors, [], phase)
  }
  const browserRow = page
    .locator('.studio-task-sidebar')
    .getByRole('group', { name: 'Page: http://lan.local:3000/', exact: true })
  const terminalRow = page
    .locator('.studio-task-sidebar')
    .getByRole('group', { name: 'Terminal: Submitted terminal', exact: true })
  const home = () => page.getByRole('button', { name: 'Workspace home', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Message thread', exact: true })
  await home()
  await input.fill('Home draft survives repeated item swapping')
  await selectThread('Remote retained thread')
  await page.waitForFunction(() => window.activeRuntimeId === 'remote')
  await assertCommands(4)
  await editor.fill('Remote owner draft')
  const localTaskIds = await page.evaluate(() =>
    window.snapshots.local.workspace.tasks.map((task) => task.id),
  )
  // Exercise Activity cleanup/resumption with the real header's fallback/portal target changes.
  // The atom updates and stable host/registry callbacks mirror Workbench; no panes are mocked.
  for (let iteration = 0; iteration < 12; iteration++) {
    const width = iteration % 2 ? 900 : 1280
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(
      (compact) =>
        document.querySelector('.studio-header-layout')?.dataset.compact === String(compact),
      width <= 1023,
    )
    for (const [title, runtimeId, draft] of [
      ['Investigate the submit crash', 'local', 'Retained first-thread draft'],
      ['Second retained thread', 'local', 'Retained second-thread draft'],
      ['Remote retained thread', 'remote', 'Remote owner draft'],
    ]) {
      phase = `switch ${iteration + 1} at ${width}px: ${runtimeId}/${title}`
      await selectThread(title)
      await page.waitForFunction((id) => window.activeRuntimeId === id, runtimeId)
      await assertCommands(4)
      assert.equal(await editor.innerText(), draft, phase)
      assert.equal(await input.isVisible(), false, 'Unified composer is Home-only')

      // Workbench's activity rail uses this same application-state setter.
      await page.evaluate(() => window.setSidebarCollapsed(true))
      await settle()
      assert.equal(
        await page.locator('.studio-titlebar:not([data-sidebar-brand="true"])').count(),
        1,
      )
      if (width > 1023)
        assert.equal(
          await page
            .locator('.studio-window-header-slot .studio-titlebar-task:visible')
            .getAttribute('title'),
          title,
          'The retained thread header portals into the actual TitleBar',
        )
      await assertCommands(4)
      await page.evaluate(() => window.setSidebarCollapsed(false))
      await settle()
      await assertCommands(4)

      phase += ' → browser'
      await browserRow.locator('.studio-browser-tab').click()
      await page.locator('[data-browser-viewport]').waitFor({ state: 'visible' })
      await assertCommands(0)
      assert.equal(await page.evaluate(() => window.activeRuntimeId), runtimeId)

      phase += ' → local terminal'
      await terminalRow.locator('.studio-thread-card').click()
      await terminal.locator('.dovo-terminal').waitFor({ state: 'visible' })
      await page.waitForFunction(() =>
        document
          .querySelector('.dovo-terminal-accessible')
          ?.textContent.includes('Retained terminal replay'),
      )
      await assertCommands(0)
      // Activity tears down and resumes the renderer effect; the owning pane/session survives.
      assert.equal(
        await terminal.evaluate((element) => element === window.originalTerminalPane),
        true,
        'Swapping items preserves the terminal session pane',
      )
      assert.equal(await page.evaluate(() => window.activeRuntimeId), runtimeId)

      phase += ' → Home'
      await home()
      await assertCommands(0)
      assert.equal(await input.inputValue(), 'Home draft survives repeated item swapping')
      await page.evaluate(() => window.refreshSnapshot())
      await assertCommands(0)
    }
  }
  assert.deepEqual(
    await page.evaluate(() => window.snapshots.local.workspace.tasks.map((task) => task.id)),
    localTaskIds,
    'Switching owners never copies remote tasks into the local workspace',
  )
  assert.equal(await page.evaluate(() => window.snapshots.remote.workspace.tasks.length), 1)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    1,
    'Resuming a terminal never creates a replacement session',
  )
  assert.deepEqual(
    await page.evaluate(() => [...new Set(window.switches)]),
    ['remote', 'local'],
    'Thread selections exercise runtime adoption in both directions',
  )
  assert.equal(
    await page.evaluate(() => window.registrations - window.disposals),
    0,
    'Every resumed TasksView releases its commands on Home',
  )
  assert.equal(
    await page.evaluate(() => window.registrations),
    registrations + 37 * 4,
    'Each visible thread lifetime registers once; header and snapshot updates do not churn commands',
  )
  assert.ok(
    await page.evaluate(() => window.runtimeCalls.some((call) => call.owner === 'remote')),
    'The remote TasksView issues requests through its own WorkspaceScope',
  )
  assert.ok(
    await page.evaluate(() =>
      window.runtimeCalls
        .filter(
          (call) =>
            call.path.startsWith('/api/terminals/') || call.path === '/api/previews/browser/open',
        )
        .every((call) => call.owner === 'local'),
    ),
    'Browser and terminal requests retain local ownership when the active thread is remote',
  )
  assert.ok(
    terminalSockets.length >= 37,
    'The actual worker reconnects on every terminal resumption',
  )
  assert.ok(terminalSockets.every((url) => url.includes('ticket=fixture-terminal-ticket')))
  assert.ok(
    browserMessages.filter((message) => message.type === 'visibility' && message.visible).length >=
      36,
    'The actual remote viewer resumes its browser stream on every selection',
  )
  assert.deepEqual(await page.evaluate(() => window.unexpectedRequests), [])
  assert.deepEqual(errors, [])
  console.log(
    `${reactMode} React: actual unified input opens real thread, browser and terminal panes; 36 local/remote thread → browser → terminal → Home cycles preserve drafts, ownership and terminal identity through real header collapse/resumption without React errors or duplicate commands; routing, retries and terminal rename/reset retain their behavior.`,
  )
} finally {
  await browser.close()
  for (const socket of sockets.clients) socket.terminate()
  await new Promise((resolve, reject) =>
    sockets.close((error) => (error ? reject(error) : resolve())),
  )
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
