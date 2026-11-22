import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
// Keep Workbench, WorkspaceProvider, the extension catalog and all workspace views real.
// A restored selected thread reproduces the command-registration loop in nightly 684.
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {StrictMode} from 'react';
import {decode,runtimeProfile,snapshotSchema} from '@dovo/protocol';
import {Workbench} from './packages/studio-shell/src/workbench.tsx';
import {updateAppPreferences,createTask,useWorkspace,useStudioHost} from '@dovo/studio-core';
import {tasksExtension} from './packages/extension-tasks/src/index.ts';
updateAppPreferences({unifiedWorkspaceEnabled:true,browserWorkspaceEnabled:true,unifiedWorkspaceHideNormalModes:false});
if(window.hideNormalModes)updateAppPreferences({unifiedWorkspaceHideNormalModes:true});
const profile=runtimeProfile({address:'http://host.lan:8787',token:'device-token-at-least-32-characters-fixture'},'Local computer');
localStorage.setItem('dovo.runtime-registry.v1',JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}));
window.dovo={readRuntimeRegistry:async()=>JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}),runtimeConnection:async()=>profile.connection};
const task=createTask({title:'Mode switch thread',objective:'',agentId:'',repositoryId:'scratch'});
task.messages=[{id:'first-message',role:'user',text:'Saved user message https://example.test/thread-link',createdAt:'2026-11-03T10:00:00.000Z'}];
const standalone={id:'standalone-shell',taskId:'studio:terminals',title:'Standalone shell',directory:'/tmp',exited:false,dormant:true};
const projectShell={...standalone,id:'project-shell',title:'Project shell',directory:'/project',repositoryId:'project'};
window.terminalTargets=[standalone,projectShell].map((session)=>JSON.stringify({runtimeId:profile.id,id:session.id}));
const snapshot=decode(snapshotSchema,{revision:1,runtimeId:'fixture',owner:false,terminalWorkspaceToolsSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[{id:'scratch',kind:'scratch',name:'General',path:'/tmp',branch:''},{id:'project',name:'Project',path:'/project',branch:'main'}],tasks:[task],automations:[]},approvals:[],questions:[],terminals:[standalone,projectShell],runs:[],devices:[],pendingDevices:[]});
window.setPreferences=updateAppPreferences;window.threadId=task.id;
const threadTab={kind:'thread',runtimeId:profile.id,id:task.id};
sessionStorage.setItem('dovo.unified-workspace.v1',JSON.stringify({tabs:[threadTab,{kind:'browser',runtimeId:'',id:'saved-page'}],active:JSON.stringify(['thread',profile.id,task.id])}));
localStorage.setItem('dovo.shared-browser-tabs.v1',JSON.stringify({active:'saved-page',tabs:[{id:'saved-page',kind:'web',url:'http://example.lan',title:'Saved browser page',profileId:'default',pinned:true},...Array.from({length:window.fullBrowser?99:0},(_,index)=>({id:'fixture-'+index,kind:'web',url:'http://example.lan/'+index,title:'Page '+index,profileId:'default'}))]}));
window.calls=[];window.revision=1;window.extensionCreations=0;window.viewLoads={};
const terminalAttempts=new Map();window.launchedTerminals=[];
window.fetch=async(url,init={})=>{
 const parsed=new URL(url),path=parsed.pathname,input=init.body?JSON.parse(init.body):undefined;
 window.calls.push({path,input});
 if(path==='/api/snapshot')return Response.json({...snapshot,workspaceTerminalRequestIdSupported:true,terminalWorkspaceToolsSupported:window.legacyTerminalRuntime?undefined:true,revision:++window.revision});
 if(path==='/health')return Response.json({service:'dovo-runtime',runtimeId:snapshot.runtimeId});
 if(path==='/api/retrieval/peers')return Response.json({ok:true});
 if(path==='/api/mutations/status')return Response.json({version:1});
 if(path==='/api/tasks/waiting')return Response.json({dependencies:[]});
 if(path==='/api/scm/changes')return Response.json({files:[]});
 if(path==='/api/terminals/workspace/changes')return Response.json({files:[]});
 if(path==='/api/terminals/workspace/files')return Response.json({entries:[{path:'README.md',kind:'file'}],truncated:false});
 if(path==='/api/terminals/workspace/read')return Response.json({path:input.path,contents:'Files from the terminal checkout'});
 if(path==='/api/device-hosts')return Response.json({hosts:[],enabled:true});
 if(path==='/api/previews/devices')return Response.json({host:'Fixture computer',devices:[],diagnostics:[]});
 if(path==='/api/tasks/viewed')return Response.json({ok:true});
 if(path==='/api/models')return Response.json({providers:[],models:[]});
 if(path==='/api/agents/availability')return Response.json([]);
 if(path==='/api/terminals/shells')return Response.json({shells:[{id:'default',label:'Default shell',path:'/bin/bash',args:['-l']}]});
 if(path==='/api/terminals/workspace'){
  let terminal=input.requestId&&terminalAttempts.get(input.requestId);
  if(!terminal){
   terminal={...standalone,id:'created-shell-'+window.launchedTerminals.length,title:input.command};
   snapshot.terminals.push(terminal);window.launchedTerminals.push(terminal.id);
   if(input.requestId)terminalAttempts.set(input.requestId,terminal);
  }
  if(window.holdTerminal)await new Promise((resolve)=>window.releaseTerminal=resolve);
  if(window.loseTerminalResponse){window.loseTerminalResponse=false;throw new Error('Terminal response lost');}
  return Response.json(terminal);
 }
 if(path==='/api/previews/browser/profiles/read')return Response.json({profiles:[{id:'default',name:'Default'}]});
 throw new Error('Unexpected request '+url);
};
window.browserFocusListeners=new Set();const onBrowserWorkspaceFocus=listener=>{window.browserFocusListeners.add(listener);return()=>window.browserFocusListeners.delete(listener)};window.focusBrowserWorkspace=()=>{for(const listener of window.browserFocusListeners)listener()};
let externalLinkListener;
const onOpenLink=listener=>{externalLinkListener=listener;return()=>{externalLinkListener=undefined}};
window.deliverExternalLink=url=>externalLinkListener(url);
const movedTabs=[];
const browser=async command=>{
 window.calls.push({browser:command.action});
 if(command.action==='tabs')return {tabs:[]};
 if(command.action==='open-tab'){
  const {key,tab}=command;window.openedExternalTab=tab;movedTabs.push({key,tab});
 }
 if(command.action==='status'){
  if(command.tabCount!==undefined&&movedTabs.length)return {url:'about:blank',canGoBack:false,canGoForward:false,movedTabs:movedTabs.splice(0)};
  return window.nativePage;
 }
};
function Probe(){window.store=useWorkspace();window.host=useStudioHost();return null;}
const extension={...tasksExtension,createRuntime:api=>{window.extensionCreations++;return tasksExtension.createRuntime(api)},views:tasksExtension.views.map(view=>({...view,load:async()=>{window.viewLoads[view.id]=(window.viewLoads[view.id]??0)+1;const module=await view.load();return {default:props=><><Probe/><module.default {...props}/></>}}}))};
createRoot(document.getElementById('app')).render(<StrictMode><Workbench extensions={[extension]} browser={browser} onBrowserWorkspaceFocus={onBrowserWorkspaceFocus} openBrowserWindow={async()=>{}} onOpenLink={onOpenLink}/></StrictMode>);

`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['production'],
    loader: { '.css': 'empty', '.woff2': 'dataurl', '.wasm': 'dataurl', '.md': 'text' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.url': '"http://workspace.lan/fixture.js"',
    },
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${root}packages/studio-ui/src/index.ts';`,
    },
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const startRuntimeSync=()=>({online:()=>false,refresh:()=>{},stop:()=>{}});`,
    },
    {
      // The dashboard's VNC transport uses an ES module and is outside this fixture.
      path: '@dovo/extension-runtime/remote-desktop-viewer',
      importer: root + 'packages/extension-tasks/src/dashboards/',
      contents: 'export const RemoteDesktopViewer = () => null;',
    },
    {
      path: './appearance',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const useAppearance=()=>{};',
    },
    {
      path: './task-notifications',
      importer: root + 'packages/studio-shell/src/',
      contents: 'export const useTaskNotifications=()=>({});',
    },
  ],
)
const browser = await chromium.launch({ headless: true })
async function checkWorkspaceModes() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
      console.error(message.text())
    }
  })
  const healthy = () => assert.deepEqual(errors, [])
  const view = async (locator) => {
    await locator.waitFor()
    healthy()
  }
  await page.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://workspace.lan')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await view(page.getByRole('textbox', { name: 'Message thread', exact: true }))
  const composer = page.getByRole('textbox', { name: 'Message thread', exact: true })
  await composer.fill('Draft kept while settings are open')
  const draft = await composer.elementHandle()
  assert.ok(draft)
  await page.evaluate(() => window.host.navigate({ viewId: 'general' }))
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await view(settings)
  await view(settings.getByRole('textbox', { name: 'Search settings', exact: true }))
  assert.equal(await draft.evaluate((node) => node.isConnected), true)
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await settings.waitFor({ state: 'hidden' })
  await view(composer)
  assert.equal(
    await composer.evaluate((node) =>
      node instanceof HTMLTextAreaElement ? node.value : node.textContent,
    ),
    'Draft kept while settings are open',
  )
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true)
  await composer.fill('')
  const botOverview = page.getByRole('button', { name: 'Bots', exact: true })
  assert.equal(await botOverview.count(), 0, 'Separate Bot overview starts hidden')
  for (const [botsInThreads, botsOverviewEnabled] of [
    [false, true],
    [true, true],
    [false, false],
    [true, false],
  ]) {
    await page.evaluate(
      ([botsInThreads, botsOverviewEnabled]) =>
        window.setPreferences({ botsInThreads, botsOverviewEnabled }),
      [botsInThreads, botsOverviewEnabled],
    )
    await page.waitForFunction(
      ({ botsInThreads, botsOverviewEnabled }) =>
        !!document.querySelector('section[aria-label="Bots"]') === botsInThreads &&
        !!document.querySelector('button[aria-label="Bots"]') === botsOverviewEnabled,
      { botsInThreads, botsOverviewEnabled },
    )
  }
  const creations = await page.evaluate(() => window.extensionCreations)
  const mode = (name) => page.getByRole('button', { name, exact: true })
  for (let i = 0; i < 12; i++) {
    await page.evaluate((open) => window.setPreferences({ projectPanelOpen: open }), i % 2 === 0)
    await page.setViewportSize({ width: i % 3 === 2 ? 900 : 1280, height: 900 })
    for (const name of ['Workspace', 'Browser', 'Workspace', 'Threads', 'Workspace', 'Terminals']) {
      const refreshing = page.evaluate(() =>
        window.store.refreshRuntime(window.store.runtimeRegistry.profiles[0]),
      )
      await mode(name).click()
      await refreshing
      if (name === 'Workspace')
        await view(page.getByRole('region', { name: 'Unified workspace', exact: true }))
      if (name === 'Browser')
        await page.getByRole('region', { name: 'Browser previews', exact: true }).waitFor()
      if (name === 'Terminals')
        await page.getByRole('region', { name: 'Terminals workspace', exact: true }).waitFor()
      if (name === 'Threads')
        await view(page.getByRole('textbox', { name: 'Message thread', exact: true }))
      await mode(name).click()

      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.deepEqual(errors, [])
    }
  }
  await mode('Workspace').click()
  await view(page.getByRole('region', { name: 'Unified workspace', exact: true }))
  await page.setViewportSize({ width: 1280, height: 900 })
  // Unified and the embedded Browser sidebar use the same native tab row. Select its owner.
  const unifiedPage = page
    .getByRole('region', { name: 'Pinned workspace items', exact: true })
    .locator('[data-browser-tab-id="saved-page"] [data-browser-tab-select]')
  await unifiedPage.click()
  await view(page.getByRole('region', { name: 'Browser previews', exact: true }))
  await page.evaluate(() => {
    window.nativePage = {
      url: 'http://example.lan/redirected',
      title: 'Redirect destination',
      canGoBack: true,
      canGoForward: false,
    }
  })
  await page.evaluate(() => window.focusBrowserWorkspace())
  await view(page.getByRole('region', { name: 'Unified workspace', exact: true }))
  assert.equal(
    await mode('Workspace').getAttribute('aria-current'),
    'page',
    'Native browser focus keeps Unified selected',
  )
  await page
    .getByRole('region', { name: 'Pinned workspace items', exact: true })
    .getByRole('button', { name: /^Redirect destination / })
    .waitFor()
  assert.equal(
    await unifiedPage.getAttribute('aria-current'),
    'page',
    'The redirected page keeps its selected identity in Unified',
  )
  await mode('Threads').click()
  await page.evaluate(() => window.focusBrowserWorkspace())
  await view(page.getByRole('region', { name: 'Browser previews', exact: true }))
  assert.equal(
    await page.getByRole('tablist', { name: 'Browser tabs', exact: true }).count(),
    0,
    'Standalone Browser keeps page navigation in the sidebar',
  )
  await page.evaluate(() => window.host.navigate({ viewId: 'tasks', entityId: window.threadId }))
  const tools = page.getByRole('navigation', { name: 'Thread tools', exact: true })
  const openTools = () =>
    page
      .locator('.studio-task-thread-header')
      .getByRole('button', { name: 'Thread tools', exact: true })
      .click()
  assert.equal(await page.locator('.studio-tools-navigation').count(), 0)
  await openTools()
  // The picker shows text labels; focusing its first item must not add a duplicate tooltip.
  await tools.getByRole('button', { name: 'Show tools pane', exact: true }).focus()
  await page.waitForTimeout(800)
  assert.equal(await page.getByRole('tooltip').count(), 0, 'Thread tools menu has no tooltips')
  await tools.getByRole('button', { name: 'Side chats', exact: true }).click()
  const rightPane = page.getByRole('complementary', { name: 'Workspace tools', exact: true })
  const rightTabs = rightPane.getByRole('tablist', { name: 'Right pane tabs', exact: true })
  await rightPane.getByRole('button', { name: 'Add pane tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
  const filesTab = rightTabs.getByRole('tab', { name: 'Files', exact: true })
  await filesTab.waitFor()
  assert.equal(await filesTab.getAttribute('aria-selected'), 'true')
  await rightPane
    .locator('.studio-pane-header')
    .getByRole('button', { name: 'Refresh files', exact: true })
    .waitFor()
  await filesTab.press('Control+Shift+ArrowLeft')
  assert.deepEqual(await rightTabs.getByRole('tab').allTextContents(), ['Files', 'Side chats'])
  const resize = rightPane.getByRole('separator', { name: 'Resize tools sidebar', exact: true })
  const initialWidth = await resize.getAttribute('aria-valuenow')
  await resize.press('ArrowRight')
  const resizedWidth = await resize.getAttribute('aria-valuenow')
  assert.notEqual(resizedWidth, initialWidth)
  await rightPane.getByRole('button', { name: 'Hide right pane', exact: true }).click()
  await openTools()
  await tools.getByRole('button', { name: 'Show tools pane', exact: true }).click()
  assert.deepEqual(await rightTabs.getByRole('tab').allTextContents(), ['Files', 'Side chats'])
  assert.equal(await resize.getAttribute('aria-valuenow'), resizedWidth)

  await page.getByRole('button', { name: 'Open thread workspace launcher', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal', exact: true })
  const moveRight = terminal.getByRole('button', {
    name: 'Move terminal to right pane',
    exact: true,
  })
  await moveRight.waitFor()
  const dockedTerminal = await terminal.elementHandle()
  assert.ok(dockedTerminal)
  await moveRight.click()
  await rightTabs.getByRole('tab', { name: 'Terminal', exact: true }).waitFor()
  assert.equal(await dockedTerminal.evaluate((node) => node.isConnected), true)
  await rightPane.getByRole('button', { name: 'Move terminal to bottom pane', exact: true }).click()
  await moveRight.waitFor()
  assert.equal(
    await dockedTerminal.evaluate((node) => node.isConnected && !node.closest('aside')),
    true,
    'Docking preserves the mounted terminal',
  )
  const chooseDevTools = async () => {
    await rightPane.getByRole('button', { name: 'Add pane tab', exact: true }).click()
    await page.getByRole('menuitem', { name: 'DevTools', exact: true }).click()
  }
  await chooseDevTools()
  await rightPane.getByText('Open a local browser page to use DevTools.', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.browser === 'devtools').length),
    0,
  )
  const browserAddress = rightPane.getByRole('textbox', {
    name: 'New browser address',
    exact: true,
  })
  await browserAddress.fill('http://example.lan/redirected')
  await browserAddress.press('Enter')
  await rightPane.getByRole('textbox', { name: 'Preview URL', exact: true }).waitFor()
  await chooseDevTools()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.browser === 'devtools').length === 1,
  )
  const workspaceTools = page.getByRole('button', { name: 'Workspace tools', exact: true })
  await mode('Workspace').click()
  await page.getByRole('button', { name: 'Workspace home', exact: true }).first().click()
  await workspaceTools.click()
  assert.equal(await page.getByRole('menuitem', { name: 'Changes', exact: true }).count(), 0)
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  await rightPane.getByLabel('New browser address', { exact: true }).waitFor()
  await rightPane.getByRole('button', { name: 'Hide right pane', exact: true }).click()
  await mode('Browser').click()
  await workspaceTools.click()
  await page.getByRole('menuitem', { name: 'Thread for this tab', exact: true }).click()
  await page
    .getByRole('complementary', { name: 'Browser tab thread', exact: true })
    .first()
    .waitFor()
  await page.getByRole('button', { name: 'Close tab thread panel', exact: true }).click()
  for (const hasCheckout of [false, true]) {
    await page.evaluate(
      (index) =>
        window.host.navigate({ viewId: 'terminals', entityId: window.terminalTargets[index] }),
      Number(hasCheckout),
    )
    await workspaceTools.click()
    const changes = page.getByRole('menuitem', { name: 'Changes', exact: true })
    assert.equal(await changes.count(), Number(hasCheckout))
    if (hasCheckout) {
      await changes.click()
      await rightPane.getByText('No working tree changes.', { exact: true }).waitFor()
      assert.ok(
        await page.evaluate(() =>
          window.calls.some(
            (call) =>
              call.path === '/api/terminals/workspace/changes' && call.input.id === 'project-shell',
          ),
        ),
      )
      await workspaceTools.click()
      await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
      await rightPane.getByRole('button', { name: 'README.md', exact: true }).click()
      await rightPane.getByText('Files from the terminal checkout', { exact: true }).waitFor()
    } else {
      assert.equal(await page.getByRole('menuitem', { name: 'Files', exact: true }).count(), 0)
      await page.keyboard.press('Escape')
    }
    await workspaceTools.click()
    await page.getByRole('menuitem', { name: 'Side thread', exact: true }).click()
    const project = rightPane.getByLabel('Project for side thread', { exact: true })
    assert.equal(await project.inputValue(), hasCheckout ? 'project' : 'scratch')
    await rightPane.getByRole('button', { name: /^Mode switch thread/ }).click()
    await rightPane.getByRole('button', { name: 'Open full thread', exact: true }).waitFor()
    await workspaceTools.click()
    await page.getByRole('menuitem', { name: 'Devices', exact: true }).click()
    await rightPane
      .getByText('No devices found. Connect a phone to the host or create a simulator.', {
        exact: true,
      })
      .waitFor()
    await page.waitForFunction(() =>
      window.calls.some(
        (call) => call.path === '/api/previews/devices' && call.input.taskId === 'studio:terminals',
      ),
    )
    await workspaceTools.click()
    await page.getByRole('menuitem', { name: 'Side thread', exact: true }).click()
    await rightPane.getByRole('button', { name: 'Open full thread', exact: true }).waitFor()
  }
  await page.evaluate(async () => {
    window.legacyTerminalRuntime = true
    await window.store.refreshRuntime(window.store.runtimeRegistry.profiles[0])
  })
  await workspaceTools.click()
  await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
  await rightPane
    .getByText('Update the terminal’s computer to use this tool.', { exact: true })
    .waitFor()
  await workspaceTools.click()
  await page.getByRole('menuitem', { name: 'Changes', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.path === '/api/scm/changes' && call.input?.repositoryId === 'project',
    ),
  )
  assert.deepEqual(errors, [])
  assert.equal(
    await page.evaluate(() => window.extensionCreations),
    creations,
    'Palette updates and navigation preserve the extension catalog',
  )
  assert.deepEqual(
    await page.evaluate(() => window.viewLoads),
    { tasks: 1, workspace: 1, browser: 1, terminals: 1 },
    'Each real view loads once across mode switches',
  )
  assert.ok(
    (await page.evaluate(() => window.revision)) >= 74,
    'Runtime snapshots arrive throughout switching',
  )
  const continuity = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await continuity.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await continuity.goto('http://workspace.lan')
  await continuity.addScriptTag({ content: built.outputFiles[0].text })
  const selectMode = (name) => continuity.getByRole('button', { name, exact: true }).click()
  await selectMode('Workspace')
  const threadLink = continuity.locator('a[href="https://example.test/thread-link"]')
  await threadLink.click({ button: 'right' })
  await continuity.getByRole('menuitem', { name: 'Open in Dovo browser', exact: true }).click()
  await continuity.getByRole('tab', { name: 'Browser', exact: true }).waitFor()
  assert.equal(
    await continuity.evaluate(
      () => JSON.parse(JSON.parse(sessionStorage.getItem('dovo.unified-workspace.v1')).active)[0],
    ),
    'thread',
    'The thread browser action stays in its thread pane',
  )
  await continuity.getByRole('button', { name: 'Workspace home', exact: true }).click()
  const home = continuity.getByRole('textbox', { name: 'Workspace request', exact: true })
  await home.fill('Keep the unsent Home draft across modes')
  await selectMode('Threads')
  await continuity.getByRole('textbox', { name: 'Message thread', exact: true }).waitFor()
  await selectMode('Workspace')
  await home.waitFor()
  assert.equal(await home.inputValue(), 'Keep the unsent Home draft across modes')
  await selectMode('Threads')
  const firstText = 'Recover first text before the workspace write'
  await continuity.getByRole('textbox', { name: 'Message thread', exact: true }).fill(firstText)
  // Restore local storage without IndexedDB, as when the draft journal is the only completed write.
  const restoredContext = await browser.newContext({
    storageState: await continuity.context().storageState(),
  })
  await restoredContext.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const restored = await restoredContext.newPage()
  await restored.goto('http://workspace.lan')
  await restored.addScriptTag({ content: built.outputFiles[0].text })
  await restored.getByRole('textbox', { name: 'Message thread', exact: true }).waitFor()
  await restored.waitForFunction((expected) => {
    const input = document.querySelector('[aria-label="Message thread"]')
    return (input instanceof HTMLTextAreaElement ? input.value : input?.textContent) === expected
  }, firstText)
  console.log(
    'Actual Workbench: mode switches, draft recovery, thread links, floating Settings, right-pane tabs, terminal docking and the Chrome DevTools action passed.',
  )
}

async function openHomeFixture(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://workspace.lan')
  await page.evaluate((options) => Object.assign(window, options), options)
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const selectMode = (name) => page.getByRole('button', { name, exact: true }).click()
  await selectMode('Workspace')
  await selectMode('Workspace home')
  return {
    page,
    errors,
    selectMode,
    draft: page.getByRole('textbox', { name: 'Workspace request', exact: true }),
  }
}

async function checkTerminalDraft() {
  const { page, errors, selectMode, draft } = await openHomeFixture()
  try {
    await page.evaluate(() => window.store.refreshRuntime(window.store.runtimeRegistry.profiles[0]))
    const submit = async (command) => {
      await draft.fill(command)
      await page.getByRole('button', { name: 'Workspace destination' }).click()
      await page.getByRole('option', { name: 'Terminal', exact: true }).click()
      await page.getByRole('button', { name: 'Run command', exact: true }).click()
    }
    const leave = async () => {
      await selectMode('Threads')
      await draft.waitFor({ state: 'detached' })
    }
    const returnToDraft = async () => {
      await selectMode('Workspace')
      await draft.waitFor()
    }
    const callsFor = (command) =>
      page.evaluate(
        (command) =>
          window.calls.filter(
            (call) => call.path === '/api/terminals/workspace' && call.input.command === command,
          ),
        command,
      )
    const retry = 'printf retry-after-switch'
    await page.evaluate(() => {
      window.loseTerminalResponse = true
    })
    await submit(retry)
    await page.getByRole('alert').filter({ hasText: 'Cannot reach host.lan' }).waitFor()
    await leave()
    await returnToDraft()
    assert.equal(await draft.inputValue(), retry)
    await submit(retry)
    await draft.waitFor({ state: 'hidden' })
    const [first, second] = await callsFor(retry)
    assert.ok(first.input.requestId, 'The runtime supports request IDs')
    assert.equal(
      second.input.requestId,
      first.input.requestId,
      'The retry uses the same request ID after Home remounts',
    )
    assert.equal(await page.evaluate(() => window.launchedTerminals.length), 1)

    for (const edit of [false, true]) {
      await selectMode('Workspace home')
      await page.evaluate(() => {
        window.holdTerminal = true
        window.releaseTerminal = undefined
      })
      const command = 'printf finish-in-background'
      await submit(command)
      await page.waitForFunction(() => !!window.releaseTerminal)
      await leave()
      await returnToDraft()
      assert.equal(await draft.inputValue(), command)
      if (edit) {
        await draft.fill('newer edit')
        await draft.fill(command)
      }
      await page.evaluate(() => {
        window.holdTerminal = false
        window.releaseTerminal()
      })
      if (edit) {
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        assert.equal(
          await draft.inputValue(),
          command,
          'A newer edit with the same text survives the old response',
        )
      } else {
        await page.waitForFunction(
          () => document.querySelector('[aria-label="Workspace request"]').value === '',
        )
      }
      assert.equal(
        await draft.isVisible(),
        true,
        'A background terminal response leaves Home selected',
      )
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}

async function checkFullBrowser() {
  const { page, errors, draft } = await openHomeFixture({ fullBrowser: true })
  try {
    const address = 'http://example.lan/explicit-retry'
    const persistedTabs = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs)
    await draft.fill(address)
    await page.getByRole('button', { name: 'Workspace destination' }).click()
    await page.getByRole('option', { name: 'Browser', exact: true }).click()
    const submit = page.getByRole('button', { name: 'Open browser', exact: true })
    await submit.click()
    assert.equal(
      await draft.inputValue(),
      address,
      'A rejected browser request keeps the address in Home',
    )
    const capacity = page
      .getByRole('alert')
      .filter({ hasText: 'Close a tab before opening more than 100 tabs.' })
    await capacity.waitFor()
    assert.equal(await capacity.count(), 1)
    assert.equal((await persistedTabs()).length, 100)
    await page.getByRole('button', { name: 'Close tab Page 0', exact: true }).click()
    await page.waitForFunction(
      () =>
        !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some(
          (tab) => tab.id === 'fixture-0',
        ),
    )
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.equal((await persistedTabs()).length, 99)
    assert.equal(await draft.inputValue(), address)
    await submit.click()
    await draft.waitFor({ state: 'hidden' })
    const tabs = await persistedTabs()
    assert.equal(tabs.length, 100)
    assert.equal(tabs.filter((tab) => tab.url === address).length, 1)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}

async function checkExternalLink() {
  const { page, errors } = await openHomeFixture({ hideNormalModes: true })
  try {
    await page.evaluate(() => window.deliverExternalLink('http://example.lan/external'))
    const dialog = page.getByRole('dialog', { name: 'Open external link', exact: true })
    await dialog
      .getByRole('button', { name: /This computer/ })
      .first()
      .click()
    await dialog.waitFor({ state: 'hidden' })
    const tab = await page.evaluate(() => window.openedExternalTab)
    assert.ok(tab?.id)
    await page.waitForFunction(
      (id) =>
        JSON.parse(sessionStorage.getItem('dovo.unified-workspace.v1')).active ===
        JSON.stringify(['browser', '', id]),
      tab.id,
    )
    await page.getByRole('region', { name: 'Browser previews', exact: true }).waitFor()
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}

const recoveryChecks = {
  terminal: checkTerminalDraft,
  capacity: checkFullBrowser,
  external: checkExternalLink,
}
try {
  const scenario = process.argv[2]
  if (scenario) await recoveryChecks[scenario]()
  else {
    await checkWorkspaceModes()
    for (const check of Object.values(recoveryChecks)) await check()
  }
} finally {
  await browser.close()
}
