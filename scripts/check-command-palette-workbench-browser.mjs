import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
// Real Workbench, extension catalog, Threads and Terminals views and command palette. Checks
// that palette entries follow the sidebar: one Open Browser with its detached-window focus,
// no hidden Bots, and thread actions that still work from the Terminals view.
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
import {updateAppPreferences,createTask} from '@dovo/studio-core';
import {tasksExtension} from './packages/extension-tasks/src/index.ts';
updateAppPreferences({unifiedWorkspaceEnabled:false,browserWorkspaceEnabled:true,botsOverviewEnabled:false});
const profile=runtimeProfile({address:'http://host.lan:8787',token:'device-token-at-least-32-characters-fixture'},'Local computer');
localStorage.setItem('dovo.runtime-registry.v1',JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}));
window.dovo={readRuntimeRegistry:async()=>JSON.stringify({version:1,activeId:profile.id,profiles:[profile]}),runtimeConnection:async()=>profile.connection};
const task=createTask({title:'Palette thread',objective:'',agentId:'',repositoryId:'scratch'});
task.messages=[{id:'first-message',role:'user',text:'Saved user message',createdAt:'2026-11-03T10:00:00.000Z'}];
const shell={id:'standalone-shell',taskId:'studio:terminals',title:'Standalone shell',directory:'/tmp',exited:false,dormant:true};
const snapshot=decode(snapshotSchema,{revision:1,runtimeId:'fixture',owner:false,terminalWorkspaceToolsSupported:true,botsSupported:true,workspace:{version:1,runtimeAddress:'',agents:[],repositories:[{id:'scratch',kind:'scratch',name:'General',path:'/tmp',branch:''}],tasks:[task],automations:[]},approvals:[],questions:[],terminals:[shell],runs:[],devices:[],pendingDevices:[]});
window.setPreferences=updateAppPreferences;window.calls=[];window.revision=1;
window.fetch=async(url,init={})=>{
 const path=new URL(url).pathname,input=init.body?JSON.parse(init.body):undefined;
 window.calls.push({path,input});
 if(path==='/api/snapshot')return Response.json({...snapshot,revision:++window.revision});
 if(path==='/health')return Response.json({service:'dovo-runtime',runtimeId:snapshot.runtimeId});
 if(path==='/api/retrieval/peers')return Response.json({ok:true});
 if(path==='/api/mutations/status')return Response.json({version:1});
 if(path==='/api/tasks/waiting')return Response.json({dependencies:[]});
 if(path==='/api/tasks/search')return Response.json({taskIds:[],hits:[]});
 if(path==='/api/scm/changes')return Response.json({files:[]});
 if(path==='/api/terminals/workspace/changes')return Response.json({files:[]});
 if(path==='/api/terminals/workspace/files')return Response.json({entries:[],truncated:false});
 if(path==='/api/device-hosts')return Response.json({hosts:[],enabled:true});
 if(path==='/api/previews/devices')return Response.json({host:'Fixture computer',devices:[],diagnostics:[]});
 if(path==='/api/tasks/viewed')return Response.json({ok:true});
 if(path==='/api/models')return Response.json({providers:[],models:[]});
 if(path==='/api/agents/availability')return Response.json([]);
 if(path==='/api/terminals/shells')return Response.json({shells:[{id:'default',label:'Default shell',path:'/bin/bash',args:['-l']}]});
 if(path==='/api/previews/browser/profiles/read')return Response.json({profiles:[{id:'default',name:'Default'}]});
 throw new Error('Unexpected request '+url);
};
window.browserCalls=[];window.detachedWindow='';
const browser=async command=>{
 window.browserCalls.push(command.action);
 if(command.action==='focus-detached-browser')return window.detachedWindow?{focusedWindowId:window.detachedWindow}:{};
 if(command.action==='tabs')return {tabs:[]};
 return {url:'about:blank',canGoBack:false,canGoForward:false};
};
createRoot(document.getElementById('app')).render(<StrictMode><Workbench extensions={[tasksExtension]} browser={browser} openBrowserWindow={async()=>{}}/></StrictMode>);
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
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('http://workspace.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://workspace.lan')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const composer = page.getByRole('textbox', { name: 'Message thread', exact: true })
  await composer.waitFor()
  const section = (name) => page.getByRole('button', { name, exact: true })
  const terminals = page.getByRole('region', { name: 'Terminals workspace', exact: true })
  const palette = page.getByRole('combobox', { name: 'Search commands', exact: true })
  const openPalette = async () => {
    await page.keyboard.press('Control+k')
    await palette.waitFor()
    return page.getByRole('option').allTextContents()
  }
  const run = async (title) => {
    await palette.fill(title)
    await page.getByRole('option', { name: title, exact: true }).click()
    await palette.waitFor({ state: 'hidden' })
  }
  const count = (titles, title) => titles.filter((item) => item === title).length

  await section('Terminals').click()
  await terminals.waitFor()
  const titles = await openPalette()
  assert.equal(count(titles, 'Open Browser'), 1, titles.join(' | '))
  assert.equal(count(titles, 'Open Browser settings'), 1)
  assert.equal(count(titles, 'Open Bots'), 0, 'Hidden Bots are not offered')
  assert.equal(count(titles, 'New thread'), 1, 'New thread is offered in Terminals')
  assert.equal(count(titles, 'Search conversations…'), 1)
  assert.equal(count(titles, 'Go to thread…'), 1)
  assert.equal(new Set(titles).size, titles.length, 'Every palette title is unique')

  // Search conversations opens Threads and its search dialog.
  await run('Search conversations…')
  const search = page.getByRole('dialog', { name: 'Search conversations', exact: true })
  await search.waitFor()
  await page.keyboard.press('Escape')
  await search.waitFor({ state: 'hidden' })
  await composer.waitFor()

  // New thread from Terminals opens a fresh Threads composer.
  await section('Terminals').click()
  await terminals.waitFor()
  await openPalette()
  await run('New thread')
  await composer.waitFor()
  await terminals.waitFor({ state: 'detached' })

  // In Threads, the view's own registration replaces the fallback, still listed once.
  const inThreads = await openPalette()
  assert.equal(count(inThreads, 'New thread'), 1)
  await page.keyboard.press('Escape')

  // Open Browser focuses a detached browser window first, as the sidebar does.
  await section('Terminals').click()
  await terminals.waitFor()
  await page.evaluate(() => {
    window.detachedWindow = 'detached-browser'
    window.browserCalls = []
  })
  await openPalette()
  await run('Open Browser')
  await page.waitForFunction(() => window.browserCalls.includes('focus-detached-browser'))
  await page.waitForTimeout(100)
  assert.equal(await terminals.count(), 1, 'A focused detached window keeps the current view')

  // With Bots shown in the sidebar, the palette offers them too.
  await page.evaluate(() => window.setPreferences({ botsOverviewEnabled: true }))
  await section('Bots').waitFor()
  assert.equal(count(await openPalette(), 'Open Bots'), 1)
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  await page.close()
} finally {
  await browser.close()
}
console.log(
  'Command palette: one Open Browser with detached-window focus, Bots only when shown, and New thread, Go to thread and Search conversations from Terminals passed in the real Workbench.',
)
