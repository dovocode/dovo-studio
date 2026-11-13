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
const profile=runtimeProfile({address:'http://host.lan:8787',token:'device-token-at-least-32-characters-fixture'},'Local computer');
localStorage.setItem('dovo.runtime-registry.v1',JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}));
window.dovo={readRuntimeRegistry:async()=>JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}),runtimeConnection:async()=>profile.connection};
const task=createTask({title:'Mode switch thread',objective:'',agentId:'',repositoryId:'scratch'});
task.messages=[{id:'first-message',role:'user',text:'Saved user message',createdAt:'2026-11-03T10:00:00.000Z'}];
const snapshot=decode(snapshotSchema,{revision:1,runtimeId:'fixture',owner:false,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[{id:'scratch',kind:'scratch',name:'General',path:'/tmp',branch:''}],tasks:[task],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
window.setPreferences=updateAppPreferences;
const threadTab={kind:'thread',runtimeId:profile.id,id:task.id};
sessionStorage.setItem('dovo.unified-workspace.v1',JSON.stringify({tabs:[threadTab,{kind:'browser',runtimeId:'',id:'saved-page'}],active:JSON.stringify(['thread',profile.id,task.id])}));
localStorage.setItem('dovo.shared-browser-tabs.v1',JSON.stringify({active:'saved-page',tabs:[{id:'saved-page',kind:'web',url:'http://example.lan',title:'Saved browser page',profileId:'default',pinned:true}]}));
window.calls=[];window.revision=1;window.extensionCreations=0;window.viewLoads={};
window.fetch=async(url,init={})=>{
 const parsed=new URL(url),path=parsed.pathname,input=init.body?JSON.parse(init.body):undefined;
 window.calls.push({path,input});
 if(path==='/api/snapshot')return Response.json({...snapshot,revision:++window.revision});
 if(path==='/health')return Response.json({service:'dovo-runtime',runtimeId:snapshot.runtimeId});
 if(path==='/api/retrieval/peers')return Response.json({ok:true});
 if(path==='/api/mutations/status')return Response.json({version:1});
 if(path==='/api/tasks/waiting')return Response.json({dependencies:[]});
 if(path==='/api/tasks/viewed')return Response.json({ok:true});
 if(path==='/api/models')return Response.json({providers:[],models:[]});
 if(path==='/api/agents/availability')return Response.json([]);
 if(path==='/api/terminals/shells')return Response.json({shells:[{id:'default',label:'Default shell',path:'/bin/bash',args:['-l']}]});
 if(path==='/api/previews/browser/profiles/read')return Response.json({profiles:[{id:'default',name:'Default'}]});
 throw new Error('Unexpected request '+url);
};
window.browserFocusListeners=new Set();const onBrowserWorkspaceFocus=listener=>{window.browserFocusListeners.add(listener);return()=>window.browserFocusListeners.delete(listener)};window.focusBrowserWorkspace=()=>{for(const listener of window.browserFocusListeners)listener()};
const browser=async command=>{window.calls.push({browser:command.action});if(command.action==='tabs')return {tabs:[]};if(command.action==='status')return window.nativePage;return undefined};
function Probe(){window.store=useWorkspace();window.host=useStudioHost();return null;}
const extension={...tasksExtension,createRuntime:api=>{window.extensionCreations++;return tasksExtension.createRuntime(api)},views:tasksExtension.views.map(view=>({...view,load:async()=>{window.viewLoads[view.id]=(window.viewLoads[view.id]??0)+1;const module=await view.load();return {default:props=><><Probe/><module.default {...props}/></>}}}))};
createRoot(document.getElementById('app')).render(<StrictMode><Workbench extensions={[extension]} browser={browser} onBrowserWorkspaceFocus={onBrowserWorkspaceFocus} openBrowserWindow={async()=>{}}/></StrictMode>);

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
try {
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
  console.log(
    'Actual Workbench: 72 mode switches with restored Unified threads/pages, snapshot updates, sidebar collapse, compact layout and thread info pass without React errors or extension reloads',
  )
} finally {
  await browser.close()
}
