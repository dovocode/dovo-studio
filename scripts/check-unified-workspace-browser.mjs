import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import { createServer } from 'vite-plus'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const vite = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import UnifiedWorkspace from './packages/extension-tasks/src/unified/workspace-view';
import TerminalWorkspace from './packages/extension-tasks/src/terminal/terminal-workspace';
import {RootFixture} from '@dovo/studio-core';
window.root=createRoot(document.getElementById('app'));window.render=()=>window.root.render(<RootFixture>{window.terminalOnly?<TerminalWorkspace/>:<UnifiedWorkspace/>}</RootFixture>);window.render();`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [
      root + '/packages/extension-tasks/node_modules',
      root + '/packages/studio-ui/node_modules',
      root + '/node_modules',
    ],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `
import React,{createContext,useContext,useState,useEffect} from 'react';
export {responses} from '${root}/packages/protocol/src/runtime/connection/runtime';
export {createTask} from '${root}/packages/studio-core/src/workspace/actions';
export const resolveTaskDefaults=()=>({});
const Store=createContext(null),Host=createContext(null);
export const useWorkspace=()=>useContext(Store);
export const useStudioHost=()=>useContext(Host);
export const useAppPreferences=()=>({unifiedWorkspaceEnabled:true,taskSnoozeMinutes:[60,240,1440],taskSnoozeSchedule:{timeZone:'local',morningTime:'09:00',eveningTime:'18:00',weekStartsOn:1,presets:['later-today','tomorrow-morning','tomorrow-evening','next-week']}});
export const readAppPreferences=()=>({confirmUnpin:false});
export const sameWorkspaceFields=()=>false;export const useWorkspaceSelector=selector=>selector(useWorkspace());
export const StudioHostProvider=({api,children})=><Host.Provider value={api}>{children}</Host.Provider>;
export function WorkspaceScope({profile,children}){const store=useWorkspace();const owner=store.runtimes.find(entry=>entry.profile.id===profile.id);return <Store.Provider value={{...store,activeRuntimeId:profile.id,connection:profile.connection,snapshot:owner.snapshot,workspace:owner.snapshot.workspace,connected:owner.connected}}>{children}</Store.Provider>}
export function RootFixture({children}){const [version,update]=useState(0);useEffect(()=>{window.refresh=()=>update(v=>v+1)},[]);
const active=window.computers.find(entry=>entry.profile.id===window.activeRuntimeId);
const read=async(profile,path,input)=>{
 window.calls.push({path,input,owner:profile.id});
 const owner=window.computers.find(entry=>entry.profile.id===profile.id);
 if(path==='/api/tasks/workspace/route'){if(window.routeError)throw Error(window.routeError);if(window.delayRoute)await new Promise(resolve=>window.finishRoute=resolve);return {mode:window.routeMode,reason:'Fixture decision'}}
 if(path==='/api/terminals/workspace'){const id=profile.id===window.activeRuntimeId?'created-'+window.calls.length:'remote-created';owner.snapshot.terminals.push({id,taskId:'studio:terminals',title:'Created shell',exited:false,repositoryId:input.repositoryId});window.refresh();return {id}}
 if(path==='/api/terminals/update'){if(window.terminalUpdateError)throw Error(window.terminalUpdateError);const session=owner.snapshot.terminals.find(item=>item.id===input.id);if(input.pinned!==undefined)session.pinned=input.pinned;if(input.settled!==undefined){session.settledAt=input.settled?new Date().toISOString():undefined;session.snoozedUntil=undefined}if(input.snoozedUntil!==undefined){session.snoozedUntil=input.snoozedUntil??undefined;if(input.snoozedUntil)session.settledAt=undefined}window.refresh();return {...session}}
 if(path==='/api/workspace'){const task=owner.snapshot.workspace.tasks.find(item=>item.id===input.id);for(const [key,value] of Object.entries(input.changes))task[key]=value.after;window.refresh();return {applied:true,conflicts:[]}}
 return {ok:true};
};
const request=(path,input)=>read(active.profile,path,input);
const store={activeRuntimeId:window.activeRuntimeId,runtimes:window.computers,runtimeRegistry:{profiles:window.computers.map(entry=>entry.profile)},snapshot:active.snapshot,workspace:active.snapshot.workspace,connected:active.connected,request,readRuntime:read,previewTask:async(_connection,_id,_updates,apply)=>apply(),refreshRuntime:async()=>{},refreshRuntimes:async()=>{},switchRuntime:async(id)=>{window.activeRuntimeId=id;window.refresh()},flush:async()=>{},setWorkspace:update=>{active.snapshot.workspace=update(active.snapshot.workspace);window.refresh()}};
return <Host.Provider value={{navigate:target=>window.navigation.push(target)}}><Store.Provider value={store}>{children}</Store.Provider></Host.Provider>}
`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `import React from 'react';
import {Button} from '${root}/packages/studio-ui/src/components/ui/button';
export {Button};
export * as DropdownMenu from '@radix-ui/react-dropdown-menu';
export {Input} from '${root}/packages/studio-ui/src/components/ui/input';
export {cn} from '${root}/packages/studio-ui/src/lib/utils';
export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}/packages/studio-ui/src/components/ui/dialog';
export const HeaderContent=({children})=><>{children}</>;
export const useNavigationSidebar=()=>({collapsed:false});
export const SidebarHeader=()=> <div className="flex h-[52px] shrink-0 items-center gap-2 px-5 text-sm font-semibold"><span className="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] text-primary-foreground">D</span>Dovo <span className="ml-auto text-[10px] font-normal text-muted-foreground">Workspace</span></div>;
export const IconButton=({label,...props})=><Button variant="ghost" size="icon" aria-label={label} {...props}/>;
export const ChoicePicker=({onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}/>;`,
    },
    {
      path: '../detail/resizable-sidebar',
      importer: root + '/packages/extension-tasks/src/',
      contents: `export const ResizableSidebar=({children,className})=><aside className={className} style={{width:280,flexShrink:0}}>{children}</aside>;`,
    },
    {
      path: '../view',
      importer: root + '/packages/extension-tasks/src/unified/',
      contents: `import {useState,useEffect} from 'react';import {useWorkspace} from '@dovo/studio-core';export default function Thread({entityId}){const [draft,setDraft]=useState('');const store=useWorkspace();useEffect(()=>{window.effects.push('show-thread:'+entityId);return()=>window.effects.push('hide-thread:'+entityId)},[entityId]);return <div data-thread={entityId} data-owner={store.activeRuntimeId}><input aria-label="Thread draft" value={draft} onChange={event=>setDraft(event.target.value)}/></div>}`,
    },
    {
      path: './terminal-pane',
      importer: root + '/packages/extension-tasks/src/terminal/',
      contents: `import {useEffect} from 'react';import {useWorkspace} from '@dovo/studio-core';export function TerminalPane({focusId,onClose}){const store=useWorkspace();useEffect(()=>{window.effects.push('show-terminal:'+focusId);return()=>window.effects.push('hide-terminal:'+focusId)},[focusId]);return <div data-terminal={focusId} data-owner={store.activeRuntimeId}><button onClick={onClose}>Hide terminal pane</button></div>}`,
    },
    {
      path: '../browser/browser-pane',
      importer: root + '/packages/extension-tasks/src/unified/',
      contents: `import {useEffect,useRef,useState} from 'react';
import {readSharedBrowserTabs,saveSharedBrowserTabs} from '${root}/packages/extension-tasks/src/browser/shared-browser-tabs';
import {isPrivateBrowserProfile,wakeBrowserTab,settleBrowserTab,snoozeBrowserTab} from '@dovo/protocol';
export const sharedBrowserWindowId=host=>host.browserWindowId;
export const restoredSharedBrowserTabs=windowId=>readSharedBrowserTabs(windowId).state?.tabs;
export function saveSharedBrowserWorkspaceTabs(tabs,windowId){const saved=readSharedBrowserTabs(windowId).state;const restorable=tabs.filter(tab=>!tab.previewOf&&!isPrivateBrowserProfile(tab.profileId));if(restorable.length)saveSharedBrowserTabs({tabs:restorable,active:restorable.some(tab=>tab.id===saved?.active)?saved.active:restorable[0].id,closed:saved?.closed??[]},windowId)}
export function BrowserPane({workspaceControl:control,openLink,onLinkOpened}){
const [ownTabs,setOwnTabs]=useState(()=>restoredSharedBrowserTabs()??[]);const tabs=control.tabs??ownTabs;const setTabs=control.onSetTabs??setOwnTabs;const opened=useRef('');
useEffect(()=>{if(!control.tabs)control.onSetTabs?.(ownTabs)},[control.tabs,ownTabs]);
useEffect(()=>{control.onTabsChange(tabs,tabs.at(-1)?.id);saveSharedBrowserWorkspaceTabs(tabs)},[tabs]);
useEffect(()=>{const req=control.lifecycleRequest;if(!req)return;setTabs(previous=>previous.map(tab=>tab.id!==req.tabId?tab:req.action==='pin'||req.action==='unpin'?{...wakeBrowserTab(tab),pinned:req.action==='pin'}:req.action==='settle'?settleBrowserTab(tab):req.action==='snooze'?snoozeBrowserTab(tab,req.until):wakeBrowserTab(tab)));control.onLifecycleHandled?.(req.requestId)},[control.lifecycleRequest?.requestId]);
useEffect(()=>{if(!control.newTabRequest||opened.current===control.newTabRequest)return;opened.current=control.newTabRequest;const id='page-'+control.newTabRequest;setTabs(previous=>[...previous,{id,url:'',title:'New page',kind:'remote',profileId:'default'}]);control.onSelect(id)},[control.newTabRequest]);
useEffect(()=>{if(!openLink)return;const id='link-'+openLink.id;setTabs(previous=>[...previous,{id,url:openLink.url,title:openLink.url,kind:'remote',profileId:'default'}]);window.openedUrls.push(openLink.url);control.onSelect(id);onLinkOpened()},[openLink?.id]);
return <div data-browser={control.focusTabId}>Browser surface</div>}`,
    },
  ],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.clock.install()
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.goto(origin)
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="app" style="height:100vh;display:flex"></div>'
    window.calls = []
    window.navigation = []
    window.effects = []
    window.openedUrls = []
    localStorage.setItem(
      'dovo.shared-browser-tabs.v1',
      JSON.stringify({
        active: 'page',
        tabs: [
          {
            id: 'page',
            url: 'http://lan.local:3000/',
            title: 'LAN browser',
            kind: 'remote',
            profileId: 'default',
            runtimeId: 'remote',
          },
        ],
      }),
    )
    window.routeMode = 'terminal'
    window.activeRuntimeId = 'local'
    const workspace = (id) => ({
      repositories: [
        { id: 'scratch', kind: 'scratch', name: 'General', path: '/tmp' },
        { id: 'project', name: 'Project', path: '/project' },
      ],
      tasks: [
        {
          id: 'thread',
          title: id + ' thread',
          repositoryId: 'project',
          status: 'draft',
          createdAt: '2026-11-03T10:00:00Z',
          messages: [],
        },
        { id: 'example', title: 'Tutorial example', repositoryId: 'project', example: true },
        {
          id: 'archived',
          title: 'Archived thread',
          repositoryId: 'project',
          archivedAt: '2026-11-03T10:00:00Z',
        },
      ],
    })
    window.computers = ['local', 'remote'].map((id) => ({
      profile: {
        id,
        name: id,
        nameIsCustom: true,
        connection: { address: 'http://' + id + '.lan:8787/', token: 'fixture-token' },
      },
      connected: true,
      snapshot: {
        workspace: workspace(id),
        terminals: [
          { id: 'shell', title: id + ' shell', taskId: 'studio:terminals', exited: false },
        ],
        runtimeHost: id,
      },
    }))
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    const assets = root + '/apps/desktop/dist/assets'
    const css = (await readdir(assets)).find((file) => /^index-.*\.css$/.test(file))
    assert.ok(css, 'Build the desktop stylesheet before capturing the overview')
    await page.addStyleTag({ path: assets + '/' + css })
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    await page.getByRole('heading', { name: 'What are you working on?' }).waitFor()
    await page.screenshot({ path: '/tmp/dovo-unified-overview.png' })
  }
  assert.deepEqual(
    await page.locator('.studio-thread-card').allTextContents(),
    [
      'LAN browserhttp://lan.local:3000/',
      'local shelllocal · Home folder',
      'local threadlocal',
      'remote shellremote · Home folder',
      'remote threadremote',
    ],
    'Threads, browser pages and terminals share one title order across kinds and computers',
  )
  assert.equal(
    await page.getByRole('heading', { name: /^(Threads|Browser|Terminals)$/ }).count(),
    0,
    'Mixed workspace has no type sections',
  )
  assert.equal(
    await page.getByRole('form', { name: 'New workspace terminal' }).count(),
    0,
    'Creation controls stay out of the navigation panel',
  )
  await page.getByLabel('Search workspace').fill('not-a-session')
  await page.getByText('No matching workspace items.').waitFor()
  await page.getByLabel('Search workspace').fill('')
  await page.getByRole('button', { name: 'Filter workspace', exact: true }).click()
  await page.getByLabel('Workspace computer filter').selectOption('local')
  assert.equal(
    await page.locator('.studio-thread-card').filter({ hasText: 'remote thread' }).count(),
    0,
  )
  await page.getByLabel('Workspace computer filter').selectOption('')
  await page.getByRole('button', { name: 'Filter workspace', exact: true }).click()
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(() => window.calls.length),
    0,
    'Dismissing creation does not open a shell',
  )
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    for (const width of [1000, 760]) {
      await page.setViewportSize({ width, height: 800 })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Overview must fit the window',
      )
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  await page.locator('.studio-thread-card').filter({ hasText: 'local thread' }).click()
  await page.getByLabel('Thread draft').fill('Keep this draft')
  const expandSection = async (name) => {
    const toggle = page
      .getByRole('region', { name: name + ' workspace items' })
      .getByRole('button')
      .first()
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  }
  const rowAction = async (title, action) => {
    await page
      .locator('.studio-thread-row')
      .getByRole('button', { name: `Actions for ${title}`, exact: true })
      .click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const snoozeRow = async (title, duration = 'For 1 hour') => {
    await page
      .locator('.studio-thread-row')
      .getByRole('button', { name: `Actions for ${title}`, exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Snooze', exact: true }).hover()
    await page.getByRole('menuitem', { name: duration, exact: true }).click()
  }
  await rowAction('LAN browser', 'Pin')
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs[0].pinned,
    ),
    true,
    'Hidden browser metadata persists immediately',
  )
  assert.equal(
    await page.getByLabel('Thread draft').inputValue(),
    'Keep this draft',
    'Browser menu does not steal focus from a thread',
  )
  await rowAction('LAN browser', 'Unpin')
  await rowAction('LAN browser', 'Settle')
  await expandSection('Settled')
  await rowAction('LAN browser', 'Reopen')
  await snoozeRow('LAN browser')
  await expandSection('Snoozed')
  assert.ok(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs[0].snoozedUntil >
        Date.now(),
    ),
  )
  await snoozeRow('LAN browser', 'Unsnooze')
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  await snoozeRow('local thread')
  await expandSection('Snoozed')
  await snoozeRow('local thread', 'Unsnooze')
  await rowAction('local thread', 'Pin')
  await page.waitForFunction(() => window.computers[0].snapshot.workspace.tasks[0].pinned === true)
  assert.ok(
    (await page.locator('.studio-thread-card').first().textContent()).includes('local thread'),
    'Pinned items lead the mixed list',
  )
  await rowAction('local thread', 'Unpin')
  await rowAction('local thread', 'Settle')
  await page.waitForFunction(
    () => window.computers[0].snapshot.workspace.tasks[0].archived === true,
  )
  await expandSection('Settled')
  await page.locator('.studio-thread-card').filter({ hasText: 'local thread' }).waitFor()
  await rowAction('local thread', 'Reopen')
  await page.waitForFunction(
    () => window.computers[0].snapshot.workspace.tasks[0].archived === false,
  )
  await page.evaluate(() => {
    window.computers[0].snapshot.workspace.tasks[0].status = 'running'
    window.refresh()
  })
  await page.getByRole('button', { name: 'Actions for local thread', exact: true }).click()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Settle', exact: true }).getAttribute('aria-disabled'),
    'true',
    'Working threads cannot be settled',
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.computers[0].snapshot.workspace.tasks[0].status = 'draft'
    window.refresh()
  })
  await snoozeRow('remote shell')
  await page.waitForFunction(
    () => Date.parse(window.computers[1].snapshot.terminals[0].snoozedUntil) > Date.now(),
  )
  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'Remote lifecycle actions do not switch the active computer',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/terminals/update').owner,
    ),
    'remote',
  )
  await expandSection('Snoozed')
  await rowAction('remote shell', 'Settle')
  await page.waitForFunction(() => !!window.computers[1].snapshot.terminals[0].settledAt)
  await rowAction('remote shell', 'Reopen')
  await page.waitForFunction(() => !window.computers[1].snapshot.terminals[0].settledAt)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
    'Lifecycle actions never close terminals',
  )
  await page.evaluate(() => {
    window.terminalUpdateError = 'Terminal lifecycle fixture rejected'
  })
  await rowAction('remote shell', 'Pin')
  await page.getByRole('alert').filter({ hasText: 'Terminal lifecycle fixture rejected' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.computers[1].snapshot.terminals[0].pinned),
    undefined,
    'Rejected updates preserve terminal metadata',
  )
  await page.evaluate(() => {
    window.terminalUpdateError = undefined
  })
  await rowAction('remote shell', 'Pin')
  await page.waitForFunction(() => window.computers[1].snapshot.terminals[0].pinned === true)
  await rowAction('remote shell', 'Unpin')

  await page.locator('.studio-thread-card').filter({ hasText: 'remote shell' }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    const terminal = await page.locator('[data-terminal-primary]').boundingBox()
    const panel = await page.getByRole('tabpanel').boundingBox()
    assert.ok(
      terminal.width > panel.width * 0.9 && terminal.height > panel.height * 0.7,
      'Terminal owns the main workspace area',
    )
  }

  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'opening remote terminals must not switch the active computer',
  )
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-thread:thread'))
  await page.getByRole('tab', { name: 'local thread' }).click()
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-terminal:shell'))
  await page.locator('.studio-thread-card').filter({ hasText: 'remote thread' }).click()
  await page.waitForSelector('[data-thread="thread"][data-owner="remote"]')
  assert.equal(await page.evaluate(() => window.activeRuntimeId), 'remote')
  await page.getByLabel('Workspace request').fill('printf original-input')
  await page.getByRole('button', { name: 'Choose destination' }).click()
  await page.getByRole('button', { name: 'Run command' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    0,
    'classification must not execute',
  )
  await page.getByLabel('Workspace destination').selectOption('browser')
  await page.getByLabel('Workspace request').fill('http://lan.local:3000/plain-http')
  await page.getByLabel('Workspace destination').selectOption('browser')
  await page.getByRole('button', { name: 'Open browser', exact: true }).click()
  await page.waitForFunction(() => window.openedUrls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.openedUrls), [
    'http://lan.local:3000/plain-http',
  ])
  assert.equal(
    await page.getByRole('tab', { name: 'browser · New tab', exact: true }).count(),
    0,
    'new-page placeholder must be replaced',
  )
  await page.getByLabel('Workspace request').fill('printf original-input')
  await page.getByRole('button', { name: 'Choose destination' }).click()
  await page.getByRole('button', { name: 'Run command' }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/terminals/workspace').input.command,
    ),
    'printf original-input',
  )
  await page.getByLabel('Workspace request').fill('Continue this work')
  await page.getByLabel('Workspace destination').selectOption('thread')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.path === '/api/tasks/message'))
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/tasks/message').input.text,
    ),
    'Continue this work',
  )
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.getByLabel('Terminal computer', { exact: true }).selectOption('local')
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByRole('dialog').getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.waitForSelector('[data-terminal="remote-created"][data-owner="local"]')
  assert.deepEqual(
    await page.evaluate(() => {
      const call = window.calls.find(
        (call) => call.owner === 'local' && call.path === '/api/terminals/workspace',
      )
      return call.input
    }),
    { repositoryId: 'project' },
  )
  await page.getByRole('button', { name: 'Hide terminal pane', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
  )
  await page.evaluate(() => {
    window.routeError = 'No utility model configured'
  })
  await page.getByLabel('Workspace request').fill('Investigate the bug')
  await page.getByRole('button', { name: 'Choose destination' }).click()
  await page.getByRole('alert').filter({ hasText: 'No utility model configured' }).waitFor()
  await page.getByLabel('Workspace destination').selectOption('thread')
  assert.equal(
    await page.getByLabel('Workspace request').inputValue(),
    'Investigate the bug',
    'failed classification retains input for manual override',
  )
  await page.evaluate(() => {
    window.terminalOnly = true
    window.render()
  })
  await page.getByRole('region', { name: 'Terminals workspace' }).waitFor()
  await page.locator('.studio-thread-card').filter({ hasText: 'remote shell' }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await rowAction('remote shell', 'Pin')
  await rowAction('remote shell', 'Settle')
  assert.ok(
    (await page.locator('.studio-thread-card').first().textContent()).includes('remote shell'),
    'Pinned settled terminals stay in Pinned',
  )
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await rowAction('remote shell', 'Reopen')
  await rowAction('remote shell', 'Unpin')
  await snoozeRow('remote shell')
  await snoozeRow('remote shell', 'Unsnooze')
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
  )
  await page.evaluate(() => {
    window.computers[1].snapshot.terminals[0].snoozedUntil = new Date(
      Date.now() + 1000,
    ).toISOString()
    window.refresh()
  })
  await page.getByRole('heading', { name: 'Snoozed', exact: true }).waitFor()
  await page.clock.fastForward(31_000)
  await page.getByRole('heading', { name: 'Snoozed', exact: true }).waitFor({ state: 'hidden' })
  await page.locator('.studio-thread-card').filter({ hasText: 'remote shell' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Unified workspace: mixed tabs, retained drafts, remote ownership, routing override, HTTP, explicit execution and terminal launcher passed.',
  )
} finally {
  await browser.close()
  await vite.close()
}
