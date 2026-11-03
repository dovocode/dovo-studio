import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
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
    nodePaths: [root + '/packages/extension-tasks/node_modules', root + '/node_modules'],
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
export const useAppPreferences=()=>({unifiedWorkspaceEnabled:true});
export const StudioHostProvider=({api,children})=><Host.Provider value={api}>{children}</Host.Provider>;
export function WorkspaceScope({profile,children}){const store=useWorkspace();const owner=store.runtimes.find(entry=>entry.profile.id===profile.id);return <Store.Provider value={{...store,activeRuntimeId:profile.id,connection:profile.connection,snapshot:owner.snapshot,workspace:owner.snapshot.workspace,connected:owner.connected}}>{children}</Store.Provider>}
export function RootFixture({children}){const [version,update]=useState(0);useEffect(()=>{window.refresh=()=>update(v=>v+1)},[]);
const active=window.computers.find(entry=>entry.profile.id===window.activeRuntimeId);
const request=async(path,input)=>{window.calls.push({path,input,owner:window.activeRuntimeId});if(path==='/api/tasks/workspace/route'){if(window.routeError)throw Error(window.routeError);if(window.delayRoute)await new Promise(resolve=>window.finishRoute=resolve);return {mode:window.routeMode,reason:'Fixture decision'}}if(path==='/api/terminals/workspace'){const id='created-'+window.calls.length;active.snapshot.terminals.push({id,taskId:'studio:terminals',title:'Created shell',exited:false,repositoryId:input.repositoryId});window.refresh();return {id}}return {ok:true}};
const store={activeRuntimeId:window.activeRuntimeId,runtimes:window.computers,snapshot:active.snapshot,workspace:active.snapshot.workspace,connected:active.connected,request,readRuntime:async(profile,path,input)=>{window.calls.push({path,input,owner:profile.id});const owner=window.computers.find(entry=>entry.profile.id===profile.id);const id='remote-created';owner.snapshot.terminals.push({id,taskId:'studio:terminals',title:'Remote created shell',exited:false,repositoryId:input.repositoryId});window.refresh();return {id}},switchRuntime:async(id)=>{window.activeRuntimeId=id;window.refresh()},flush:async()=>{},setWorkspace:update=>{active.snapshot.workspace=update(active.snapshot.workspace);window.refresh()}};
return <Host.Provider value={{navigate:target=>window.navigation.push(target)}}><Store.Provider value={store}>{children}</Store.Provider></Host.Provider>}
`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `import React from 'react';export const useNavigationSidebar=()=>({collapsed:false});export const SidebarHeader=()=>null;export const Button=({size,variant,...props})=><button {...props}/>;export const IconButton=({label,...props})=><button aria-label={label} {...props}/>;export const Input=props=><input {...props}/>;export const ChoicePicker=({onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}/>;`,
    },
    {
      path: '../detail/resizable-sidebar',
      importer: root + '/packages/extension-tasks/src/',
      contents: `export const ResizableSidebar=({children})=><aside style={{width:280,flexShrink:0}}>{children}</aside>;`,
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
      contents: `import {useEffect,useRef,useState} from 'react';export function BrowserPane({workspaceControl:control,openLink,onLinkOpened}){const [tabs,setTabs]=useState([{id:'page',url:'http://lan.local:3000/',title:'LAN browser',kind:'remote',profileId:'default',runtimeId:'remote'}]);const opened=useRef('');useEffect(()=>control.onTabsChange(tabs,tabs.at(-1).id),[tabs]);useEffect(()=>{if(!control.newTabRequest||opened.current===control.newTabRequest)return;opened.current=control.newTabRequest;const id='page-'+control.newTabRequest;setTabs(previous=>[...previous,{id,url:'',title:'New page',kind:'remote',profileId:'default'}]);control.onSelect(id);control.onTabsChange(tabs,tabs.at(-1).id)},[control.newTabRequest]);useEffect(()=>{if(!openLink)return;const id='link-'+openLink.id;setTabs(previous=>[...previous,{id,url:openLink.url,title:openLink.url,kind:'remote',profileId:'default'}]);window.openedUrls.push(openLink.url);control.onSelect(id);control.onTabsChange(tabs,tabs.at(-1).id);onLinkOpened()},[openLink?.id]);return <div data-browser={control.focusTabId}>Browser surface</div>}`,
    },
  ],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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
    window.routeMode = 'terminal'
    window.activeRuntimeId = 'local'
    const workspace = (id) => ({
      repositories: [
        { id: 'scratch', kind: 'scratch', name: 'General', path: '/tmp' },
        { id: 'project', name: 'Project', path: '/project' },
      ],
      tasks: [{ id: 'thread', title: id + ' thread', repositoryId: 'project' }],
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
  await page.getByRole('button', { name: /local thread/, exact: false }).click()
  await page.getByLabel('Thread draft').fill('Keep this draft')
  await page.getByRole('button', { name: /remote shell/, exact: false }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'opening remote terminals must not switch the active computer',
  )
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-thread:thread'))
  await page.getByRole('tab', { name: 'local thread' }).click()
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-terminal:shell'))
  await page.getByRole('button', { name: /remote thread/, exact: false }).click()
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
  await page.getByLabel('Terminal computer', { exact: true }).selectOption('local')
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
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
  await page.getByRole('button', { name: /remote shell/, exact: false }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  assert.deepEqual(errors, [])
  console.log(
    'Unified workspace: mixed tabs, retained drafts, remote ownership, routing override, HTTP, explicit execution and terminal launcher passed.',
  )
} finally {
  await browser.close()
  await vite.close()
}
