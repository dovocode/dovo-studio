import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { createServer } from 'vite-plus'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const vite = await createServer({
  configFile: false,
  plugins: [tailwindcss()],
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
import {TooltipProvider} from '@dovo/studio-ui';
window.root=createRoot(document.getElementById('app'));window.render=()=>window.root.render(<TooltipProvider><RootFixture>{window.terminalOnly?<TerminalWorkspace entityId={window.terminalTarget}/>:<UnifiedWorkspace/>}</RootFixture></TooltipProvider>);window.render();`,
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
import React,{createContext,useContext,useState,useEffect,useCallback} from 'react';
export * from '@dovo/protocol';
export {clientScopeKey} from '${root}/packages/client-runtime/src/effects/request-scope';
export const useConfirmation=()=>async()=>true;
export {responses} from '${root}/packages/protocol/src/runtime/connection/runtime';
export {createTask,updateTask} from '${root}/packages/studio-core/src/workspace/actions';
export {acpHarnessName,resolveTaskAgent,hasUnviewedTaskCompletion,isSnoozed,compareTaskActivity} from '@dovo/protocol';
export {providers} from '${root}/packages/studio-core/src/providers';
export {formatDateTime} from '${root}/packages/studio-core/src/preferences';
export const useRemoteBrowserProfiles=profile=>({profiles:[{id:'default',name:profile?.id==='remote'?'Remote Default':'Local Default'}],loading:false});
export const resolveTaskDefaults=()=>({});
const Store=createContext(null),Host=createContext(null);
export const useWorkspace=()=>useContext(Store);
export const useStudioHost=()=>useContext(Host);
export const useAppPreferences=()=>({unifiedWorkspaceEnabled:true,sendWith:'enter',minimalComposer:true,taskSnoozeMinutes:[60,240,1440],taskSnoozeSchedule:{timeZone:'local',morningTime:'09:00',eveningTime:'18:00',weekStartsOn:1,presets:['later-today','tomorrow-morning','tomorrow-evening','next-week']},...window.composerPreferences});
export const readAppPreferences=()=>({confirmUnpin:false});
export const sameWorkspaceFields=()=>false;export const useWorkspaceSelector=selector=>selector(useWorkspace());
export const StudioHostProvider=({api,children})=><Host.Provider value={api}>{children}</Host.Provider>;
export function WorkspaceScope({profile,children}){const store=useWorkspace();const owner=store.runtimes.find(entry=>entry.profile.id===profile.id);return <Store.Provider value={{...store,activeRuntimeId:profile.id,connection:profile.connection,snapshot:owner.snapshot,workspace:owner.snapshot.workspace,connected:owner.connected}}>{children}</Store.Provider>}
export function RootFixture({children}){const [version,update]=useState(0);useEffect(()=>{window.refresh=()=>update(v=>v+1)},[]);
const active=window.computers.find(entry=>entry.profile.id===window.activeRuntimeId);
const read=useCallback(async(profile,path,input)=>{
 window.calls.push({path,input:input===undefined?undefined:JSON.parse(JSON.stringify(input)),owner:profile.id});
 const owner=window.computers.find(entry=>entry.profile.id===profile.id);
 if(path==='/api/snapshot')return owner.snapshot;
 if(path==='/api/tasks/message'){if(window.messageError)throw Error(window.messageError);return {ok:true}}
 if(path==='/api/tasks/workspace/route'){if(window.routeError)throw Error(window.routeError);if(window.delayRoute)await new Promise(resolve=>window.finishRoute=resolve);return {mode:window.routeMode,reason:'Fixture decision'}}
 if(path==='/api/previews/browser/profiles/read')return {profiles:[{id:'default',name:'Default'},{id:'work',name:'Work'}]};
 if(path==='/api/agents/models/cached')return null;
 if(path==='/api/terminals/shells'){if(window.shellError)throw Error(window.shellError);if(window.delayShellOwner===profile.id)await new Promise(resolve=>window.finishShells=resolve);return {shells:[{id:'default',label:'Default ('+profile.id+')',path:'/bin/bash',args:['-l']},{id:profile.id==='local'?'bash':'fish',label:profile.id==='local'?'Bash':'Fish',path:profile.id==='local'?'/bin/bash':'/usr/bin/fish',args:['-l']}]}}
 if(path==='/api/scm/branches')return {branches:[{ref:'refs/heads/main',name:'main',remote:false,checkedOut:true},{ref:'refs/heads/feature',name:'feature',remote:false,checkedOut:false}],current:'main',revision:'fixture'};
 if(path==='/api/scm/worktrees/choices'){if(window.checkoutError)throw Error(window.checkoutError);return {worktrees:[{path:'/project/existing',branch:'feature',dirty:true}]}};
 if(path==='/api/terminals/workspace'){if(window.terminalError)throw Error(window.terminalError);const id=profile.id+'-created-'+window.calls.length;const session={id,taskId:'studio:terminals',title:'Created shell',exited:false,repositoryId:input.repositoryId,shellId:input.shellId,directory:input.existingWorktreePath??(input.repositoryId?'/project':'/home/'+profile.id)};const publish=()=>{owner.snapshot.terminals.push(session);window.refresh()};if(window.delayTerminalSnapshot)window.publishTerminalSnapshot=publish;else publish();if(window.delayTerminalResponse)await new Promise(resolve=>window.finishTerminalResponse=resolve);return {id}}
 if(path==='/api/terminals/update'){if(window.terminalUpdateError)throw Error(window.terminalUpdateError);const session=owner.snapshot.terminals.find(item=>item.id===input.id);if(input.pinned!==undefined)session.pinned=input.pinned;if(input.settled!==undefined){session.settledAt=input.settled?new Date().toISOString():undefined;session.snoozedUntil=undefined}if(input.snoozedUntil!==undefined){session.snoozedUntil=input.snoozedUntil??undefined;if(input.snoozedUntil)session.settledAt=undefined}window.refresh();return {...session}}
 if(path==='/api/workspace'){let task=owner.snapshot.workspace.tasks.find(item=>item.id===input.id);if(!task&&input.create){task=input.create;owner.snapshot.workspace.tasks.push(task)}for(const [key,value] of Object.entries(input.changes))task[key]=value.after;window.refresh();if(window.delayCreate&&input.create)await new Promise(resolve=>window.finishCreate=resolve);return {applied:true,outcome:'applied',conflicts:[]}}
 return {ok:true};
},[]);
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
export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as ContextMenu from '@radix-ui/react-context-menu';
export {Input} from '${root}/packages/studio-ui/src/components/ui/input';
export {Checkbox} from '${root}/packages/studio-ui/src/components/ui/checkbox';
export {FormField} from '${root}/packages/studio-ui/src/components/form-field';
export {ComposerSurface,ComposerTextarea,ComposerSubmit,ComposerWorkspaceBar} from '${root}/packages/studio-ui/src/composer-surface';
export {ProjectIcon} from '${root}/packages/studio-ui/src/project-icon';
export {AgentAvatar} from '${root}/packages/studio-ui/src/agent-avatar';
export {pullRequestIconTone,PullRequestIcon} from '${root}/packages/studio-ui/src/pull-request-icon';
export {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '${root}/packages/studio-ui/src/components/ui/tooltip';
export const useModelLabel=()=>undefined;
export {cn} from '${root}/packages/studio-ui/src/lib/utils';
export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}/packages/studio-ui/src/components/ui/dialog';
export const HeaderContent=({children})=><>{children}</>;
export const useNavigationSidebar=()=>({collapsed:!!window.sidebarCollapsed});
export const SidebarHeader=()=> <div className="flex h-[52px] shrink-0 items-center gap-2 px-5 text-sm font-semibold"><span className="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] text-primary-foreground">D</span>Dovo <span className="ml-auto text-[10px] font-normal text-muted-foreground">Workspace</span></div>;
export const IconButton=({label,...props})=><Button variant="ghost" size="icon" aria-label={label} {...props}/>;
export const ChoicePicker=({onValueChange,icons,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}/>;`,
    },
    {
      path: '@dovo/extension-scm/project-transfer',
      contents: 'export const ProjectTransferDialog=()=>null;',
    },
    { path: '@dovo/extension-scm/projects', contents: 'export const ProjectSettings=()=>null;' },
    {
      path: '../dialogs/continue-elsewhere-dialog',
      importer: root + '/packages/extension-tasks/src/detail/',
      contents: 'export const ContinueElsewhereDialog=()=>null;',
    },
    {
      path: '../detail/resizable-sidebar',
      importer: root + '/packages/extension-tasks/src/',
      contents: `export const ResizableSidebar=({children,className,label})=><aside aria-label={label} className={className} style={{width:280,flexShrink:0}}>{children}</aside>;`,
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
      contents: `import {useEffect,useRef,useState} from 'react';import {createPortal} from 'react-dom';
import {BrowserTabRow} from '${root}/packages/extension-tasks/src/browser/browser-tab-row';
import {SnoozeDialog} from '${root}/packages/extension-tasks/src/dialogs/snooze-dialog';
import {readSharedBrowserTabs,saveSharedBrowserTabs} from '${root}/packages/extension-tasks/src/browser/shared-browser-tabs';
import {isPrivateBrowserProfile,wakeBrowserTab,settleBrowserTab,snoozeBrowserTab} from '@dovo/protocol';
export const sharedBrowserWindowId=host=>host.browserWindowId;
export const restoredSharedBrowserTabs=windowId=>readSharedBrowserTabs(windowId).state?.tabs;
export function saveSharedBrowserWorkspaceTabs(tabs,windowId){const saved=readSharedBrowserTabs(windowId).state;const restorable=tabs.filter(tab=>!tab.previewOf&&!isPrivateBrowserProfile(tab.profileId));if(restorable.length)saveSharedBrowserTabs({tabs:restorable,active:restorable.some(tab=>tab.id===saved?.active)?saved.active:restorable[0].id,closed:saved?.closed??[]},windowId)}
export function BrowserPane({workspaceControl:control,openLink,onLinkOpened}){
const [snoozing,setSnoozing]=useState(null);window.openBrowserSnooze=setSnoozing;const [activity,setActivity]=useState({});window.setBrowserActivity=states=>{window.browserActivity=states;setActivity(states)};
const [ownTabs,setOwnTabs]=useState(()=>restoredSharedBrowserTabs()??[]);const tabs=control.tabs??ownTabs;const setTabs=control.onSetTabs??setOwnTabs;const opened=useRef('');
useEffect(()=>{if(!control.tabs)control.onSetTabs?.(ownTabs)},[control.tabs,ownTabs]);
useEffect(()=>{control.onTabsChange(tabs,tabs.at(-1)?.id);saveSharedBrowserWorkspaceTabs(tabs)},[tabs]);
useEffect(()=>{const req=control.lifecycleRequest;if(!req)return;setTabs(previous=>previous.map(tab=>tab.id!==req.tabId?tab:req.action==='pin'||req.action==='unpin'?{...wakeBrowserTab(tab),pinned:req.action==='pin'}:req.action==='settle'?settleBrowserTab(tab):req.action==='snooze'?snoozeBrowserTab(tab,req.until):wakeBrowserTab(tab)));control.onLifecycleHandled?.(req.requestId)},[control.lifecycleRequest?.requestId]);
useEffect(()=>{if(!control.newTabRequest||opened.current===control.newTabRequest)return;opened.current=control.newTabRequest;const id='page-'+control.newTabRequest;setTabs(previous=>[...previous,{id,url:'',title:'New page',kind:'remote',profileId:'default'}]);control.onSelect(id)},[control.newTabRequest]);
useEffect(()=>{if(!openLink)return;const id='link-'+openLink.id;setTabs(previous=>[...previous,{id,url:openLink.url,title:openLink.url,kind:'remote',profileId:'default'}]);window.openedUrls.push(openLink.url);control.onSelect(id);onLinkOpened()},[openLink?.id]);
return <>{snoozing&&<SnoozeDialog name={snoozing.title} onClose={()=>setSnoozing(null)} onSnooze={until=>setTabs(previous=>previous.map(item=>item.id===snoozing.id?snoozeBrowserTab(item,until):item))}/>}<div data-browser={control.focusTabId}>Browser surface</div>{control.tabTargets?.map(target=>{const tab=tabs.find(tab=>tab.id===target.tabId);if(!tab)return null;return createPortal(<BrowserTabRow tab={tab} pinnedTile={target.pinnedTile} active={target.active} disabled={target.disabled} busy={target.disabled||!!tab.detached} state={activity[tab.id]} onMute={tab.kind==='web'?()=>{}:undefined} onError={()=>{}} onMenuOpen={()=>{}} onSelect={()=>{setTabs(previous=>previous.map(item=>item.id===tab.id?wakeBrowserTab(item):item));control.onSelect(tab.id)}} onPin={()=>setTabs(previous=>previous.map(item=>item.id===tab.id?{...wakeBrowserTab(item),pinned:!item.pinned}:item))} onSettle={()=>setTabs(previous=>previous.map(item=>item.id===tab.id?settleBrowserTab(item):item))} onSnooze={()=>setTabs(previous=>previous.map(item=>item.id===tab.id?snoozeBrowserTab(item,Date.now()+3600000):item))} onCustomSnooze={()=>window.openBrowserSnooze(tab)} onClose={()=>setTabs(previous=>previous.filter(item=>item.id!==tab.id))} onHome={tab.pinned?()=>{}:undefined} onEditHome={tab.pinned?()=>{}:undefined} onKeepAwake={()=>{}} onMove={()=>{}} windows={[{id:2,title:'Other window'}]} studioId={'studio:local:browser:workspace:'+tab.id} />,target.element,target.key)})}</>}`,
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
    console.error(error.stack)
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
          ...['Docs', 'Issues', 'Metrics', 'Notes', 'Preview'].map((title, index) => ({
            id: 'pinned-' + index,
            url: 'http://lan.local:3000/' + title.toLowerCase(),
            title,
            kind: 'remote',
            pinned: true,
            profileId: 'default',
            runtimeId: index % 2 ? 'local' : 'remote',
            favicon:
              'data:image/svg+xml,' +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="4" fill="${['#5988e8', '#cf7b39', '#9d74d5', '#4aab8d', '#d25c78'][index]}"/><text x="8" y="12" text-anchor="middle" font-family="sans-serif" font-size="11" fill="white">${title[0]}</text></svg>`,
              ),
          })),
        ],
      }),
    )
    window.routeMode = 'terminal'
    window.activeRuntimeId = 'local'
    const workspace = (id) => ({
      agents: [],
      repositories: [
        { id: 'scratch', kind: 'scratch', name: 'General', path: '/tmp' },
        { id: 'project', name: 'Project', path: '/project', branch: 'main' },
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
        {
          id: 'pinned-thread',
          title: 'Pinned ' + id + ' work',
          repositoryId: 'project',
          status: 'draft',
          pinned: true,
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
        terminalRecoverySupported: true,
        workspace: workspace(id),
        terminals: [
          { id: 'shell', title: id + ' shell', taskId: 'studio:terminals', exited: false },
          {
            id: 'thread-shell',
            title: id + ' thread terminal',
            taskId: 'thread',
            exited: false,
            repositoryId: 'project',
            directory: '/project',
          },
          ...(id === 'local'
            ? [
                {
                  id: 'pinned-shell',
                  title: 'Pinned shell',
                  taskId: 'studio:terminals',
                  pinned: true,
                  exited: false,
                  repositoryId: 'project',
                  directory: '/project',
                },
              ]
            : []),
        ],
        runtimeHost: id,
        agents: [],
      },
    }))
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const workspaceInput = page.getByLabel('Workspace request')
  const savedWorkspace = () =>
    page.evaluate(() => JSON.parse(sessionStorage.getItem('dovo.unified-workspace.v1')))
  const selectSidebarItem = (kind, title) =>
    page
      .getByRole('complementary')
      .getByRole('group', { name: `${kind}: ${title}`, exact: true })
      .locator('button')
      .first()
      .click()
  const returnHome = async () => {
    await page.getByRole('button', { name: 'Workspace home', exact: true }).click()
    await workspaceInput.waitFor({ state: 'visible' })
  }
  const assertComposerHidden = async (kind) => {
    await workspaceInput.waitFor({ state: 'hidden' })
    assert.equal(await workspaceInput.count(), 1, 'Home input remains mounted')
    assert.equal(
      await workspaceInput.evaluate((input) => {
        const overview = input.closest('[hidden]')
        return !!overview && overview.getClientRects().length === 0
      }),
      true,
      `Home composer has no layout footprint in an active ${kind}`,
    )
    assert.equal(
      await page.getByRole('form', { name: 'Workspace input', exact: true }).count(),
      0,
      `No shared composer toolbar is exposed in an active ${kind}`,
    )
    assert.equal(await page.getByRole('tablist').count(), 0, 'Unified has no horizontal tab strip')
    assert.equal(
      await page.getByRole('tab').count(),
      0,
      'Navigation uses the sidebar for every kind',
    )
    const content = page.locator('#workspace-content')
    assert.equal(await content.getAttribute('aria-labelledby'), null)
    assert.match(
      await content.getAttribute('aria-label'),
      new RegExp(`^${kind === 'browser' ? 'Page' : kind === 'thread' ? 'Thread' : 'Terminal'}: `),
      'The content region names the selected resource without an absent tab label',
    )
  }
  const assertComposerDesign = async (name) => {
    const form = page.getByRole('form', { name, exact: true })
    const design = await form.evaluate((surface) => {
      const submit = surface.querySelector('button[type="submit"]')
      const input = surface.querySelector('textarea')
      const workspace = surface.parentElement.querySelector('[data-composer-workspace]')
      return {
        radius: parseFloat(getComputedStyle(surface).borderRadius),
        submitWidth: submit.getBoundingClientRect().width,
        submitHeight: submit.getBoundingClientRect().height,
        submitRadius: parseFloat(getComputedStyle(submit).borderRadius),
        inputBackground: getComputedStyle(input).backgroundColor,
        inputShadow: getComputedStyle(input).boxShadow,
        workspaceBorder: getComputedStyle(workspace).borderBottomWidth,
        workspaceBackground: getComputedStyle(workspace).backgroundColor,
      }
    })
    assert.ok(design.radius >= 20, 'Uses the rounded thread composer surface')
    assert.equal(design.submitWidth, design.submitHeight, 'Submit keeps the thread icon size')
    assert.ok(design.submitRadius >= design.submitWidth / 2, 'Submit uses the circular design')
    assert.equal(design.inputBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(
      design.inputShadow,
      'none',
      'Dialog field styling cannot cover the composer surface',
    )
    assert.equal(design.workspaceBorder, '0px', 'Workspace controls have no attached panel border')
    assert.equal(design.workspaceBackground, 'rgba(0, 0, 0, 0)')
  }
  const assertComposerInteractions = async (name, inputLabel, controlLabel) => {
    const form = page.getByRole('form', { name, exact: true })
    const input = page.getByLabel(inputLabel, { exact: true })
    const control = page.getByLabel(controlLabel, { exact: true })
    const original = await input.elementHandle()
    const idle = page.locator('form[data-idle]').filter({ has: input })
    const expanded = page.locator('form:not([data-idle])').filter({ has: input })
    const finishLayout = () =>
      form.evaluate((surface) => {
        for (const animation of surface.getAnimations({ subtree: true })) animation.finish()
      })
    await input.evaluate((element) => element.blur())
    await idle.waitFor()
    await finishLayout()
    const idleBounds = await form.boundingBox()
    const idleEditorBounds = await input.boundingBox()
    if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
      const narrow = await form.evaluate((surface) => {
        const container = surface.closest('.task-composer')
        const style = getComputedStyle(container)
        return (
          innerWidth >= 768 &&
          container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) <=
            576
        )
      })
      assert.ok(
        idleBounds.height <= (narrow ? 90 : 48),
        `${name} uses ${narrow ? 'two compact rows in a narrow pane' : 'a single idle row'}`,
      )
      const editor = await input.boundingBox()
      const action = await form.locator('[data-composer-actions]').boundingBox()
      assert.ok(editor.width > 70, 'The idle editor leaves space for the placeholder')
      if (narrow) assert.ok(editor.y + editor.height <= action.y)
      else assert.ok(Math.abs(editor.y + editor.height / 2 - (action.y + action.height / 2)) < 2)
    }
    await input.focus()
    await expanded.waitFor()
    await finishLayout()
    if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
      assert.ok(
        (await input.boundingBox()).height > idleEditorBounds.height,
        'Focus expands the editor',
      )
      await page.screenshot({
        path:
          name === 'Workspace input'
            ? '/tmp/dovo-unified-composer-expanded.png'
            : '/tmp/dovo-terminal-composer-expanded.png',
        animations: 'disabled',
      })
    }
    await control.focus()
    assert.equal(
      await form.getAttribute('data-idle'),
      null,
      'Toolbar focus keeps the editor expanded',
    )
    await control.evaluate((element) => element.blur())
    await idle.waitFor()
    await page.evaluate(() => {
      window.composerPreferences = { sendWith: 'mod-enter', markdownComposerPreview: true }
      window.refresh()
    })
    const before = await page.evaluate(() => window.calls.length)
    await input.fill('**literal draft**')
    await input.press('Enter')
    assert.equal(
      await input.inputValue(),
      '**literal draft**\n',
      'The shared send preference adds a newline',
    )
    assert.equal(
      await page.evaluate(() => window.calls.length),
      before,
      'Plain Enter cannot dispatch in mod-enter mode',
    )
    assert.equal(
      await form.getByLabel('Formatted message preview').count(),
      0,
      'Commands and addresses remain plain text',
    )
    if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
      const shortDraft = await input.boundingBox()
      const multiline = Array.from({ length: 8 }, (_, index) => `Draft line ${index}`).join('\n')
      await input.fill(multiline)
      await finishLayout()
      assert.ok(
        (await input.boundingBox()).height > shortDraft.height + 20,
        'The shared textarea grows to fit multiline drafts',
      )
      assert.equal(await input.inputValue(), multiline)
    }
    await control.focus()
    await control.evaluate((element) => element.blur())
    assert.equal(await form.getAttribute('data-idle'), null, 'A draft stays expanded after blur')
    assert.equal(
      await input.evaluate((element, initial) => element === initial, original),
      true,
      'Focus and preference changes preserve the editor',
    )
    await input.fill('')
    await input.evaluate((element) => element.blur())
    await idle.waitFor()
    await page.evaluate(() => {
      window.composerPreferences = { minimalComposer: false }
      window.refresh()
    })
    await expanded.waitFor()
    await page.evaluate(() => {
      window.composerPreferences = undefined
      window.refresh()
    })
    await idle.waitFor()
  }
  assert.equal(
    await workspaceInput.evaluate((element) => element === document.activeElement),
    true,
    'The fresh starter focuses the editor like Start Thread',
  )
  const browseWorkspace = page.locator('[data-workspace-browse] > summary')
  assert.equal(
    await page.locator('[data-workspace-browse]').evaluate((element) => element.open),
    false,
  )
  await page
    .getByRole('region', { name: 'Continue working', exact: true })
    .waitFor({ state: 'hidden' })
  const starterEditor = await workspaceInput.elementHandle()
  await browseWorkspace.click()
  await page.getByRole('region', { name: 'Continue working', exact: true }).waitFor()
  await browseWorkspace.click()
  assert.equal(
    await workspaceInput.evaluate((element, original) => element === original, starterEditor),
    true,
    'Browsing recent work preserves the starter editor',
  )
  const workspaceRows = page.getByRole('complementary').locator('[data-workspace-kind]')
  const pinnedSection = page.getByRole('region', { name: 'Pinned workspace items', exact: true })
  const pinnedGrid = pinnedSection.getByRole('group', { name: 'Pinned browser tabs', exact: true })
  const pinnedPages = pinnedGrid.locator('[data-pinned-page]')
  await pinnedPages.first().waitFor()

  assert.deepEqual(
    await pinnedPages.evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    ['Page: Docs', 'Page: Issues', 'Page: Metrics', 'Page: Notes', 'Page: Preview'],
    'Pinned browser pages keep their own card grid',
  )
  assert.deepEqual(
    await pinnedSection
      .locator('[data-workspace-kind]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    [
      'Page: Docs',
      'Page: Issues',
      'Page: Metrics',
      'Page: Notes',
      'Page: Preview',
      'Thread: Pinned local work',
      'Thread: Pinned remote work',
      'Terminal: Pinned shell',
    ],
    'Actual thread rows sit directly below pinned pages, followed by standalone terminal rows',
  )
  assert.equal(await pinnedPages.locator('.studio-browser-tab-title').count(), 0)
  assert.equal(await pinnedPages.locator('.studio-browser-tab-favicon img').count(), 5)
  assert.equal(await pinnedPages.locator('.studio-browser-tab-profile').count(), 0)
  assert.ok(
    (
      await pinnedPages.first().locator('.studio-browser-tab-select').getAttribute('title')
    ).includes('local'),
  )
  assert.equal(
    await pinnedSection.locator('[data-workspace-kind="thread"] .studio-thread-card').count(),
    2,
  )
  assert.equal(
    await pinnedSection.locator('[data-workspace-kind="thread"] .lucide-message-square').count(),
    0,
  )
  assert.equal(
    await pinnedSection.locator('[data-workspace-kind="terminal"] .lucide-square-terminal').count(),
    1,
  )
  for (const title of ['Pinned local work', 'Pinned shell']) {
    for (const action of ['Unpin', 'Snooze', 'Settle']) {
      assert.equal(
        await pinnedSection
          .getByRole('button', { name: `${action} ${title}`, exact: true })
          .count(),
        1,
      )
    }
  }
  assert.equal(await pinnedSection.getByRole('button', { name: /More|ellipsis/i }).count(), 0)
  for (const row of await workspaceRows
    .filter({ has: page.locator('[data-workspace-kind-icon]') })
    .all()) {
    const icon = row.locator('[data-workspace-kind-icon]')
    assert.equal(await icon.count(), 1, 'Each mixed row has one type icon')
    assert.equal(
      await icon.evaluate((element) =>
        element.parentElement.classList.contains('studio-thread-card-title'),
      ),
      true,
      'The type icon belongs to the title rather than floating over the row',
    )
  }
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    const css = await vite.transformRequest('/packages/studio-ui/src/styles.css?direct')
    assert.ok(css, 'Compile the current shared stylesheet for visual checks')
    await page.addStyleTag({ content: css.code })
    const checkTypeIconAlignment = async () => {
      for (const row of await workspaceRows
        .filter({ has: page.locator('[data-workspace-kind-icon]') })
        .all()) {
        const geometry = await row.locator('[data-workspace-kind-icon]').evaluate((icon) => {
          const text = icon.nextElementSibling.getBoundingClientRect()
          const box = icon.getBoundingClientRect()
          const style = getComputedStyle(icon)
          return {
            center: box.y + box.height / 2 - text.y - text.height / 2,
            gap: text.x - box.right,
            width: box.width,
            position: style.position,
            background: style.backgroundColor,
            shadow: style.boxShadow,
          }
        })
        assert.ok(Math.abs(geometry.center) <= 1, 'Type icons align with the title')
        assert.ok(
          geometry.gap >= 4 && geometry.gap <= 8,
          'Type icons have a consistent gap from the title',
        )
        assert.equal(geometry.width, 14)
        assert.equal(geometry.position, 'static')
        assert.equal(geometry.background, 'rgba(0, 0, 0, 0)')
        assert.equal(geometry.shadow, 'none')
      }
    }
    await checkTypeIconAlignment()
    const unifiedPinGeometry = () =>
      pinnedPages.evaluateAll((rows) =>
        rows.map((row) => {
          const { x, y, width, height } = row.getBoundingClientRect()
          return { x, y, width, height }
        }),
      )
    const assertCenteredFavicons = async () => {
      const offsets = await pinnedPages.locator('.studio-browser-tab').evaluateAll((tiles) =>
        tiles.map((tile) => {
          const icon = tile.querySelector('.studio-browser-tab-favicon').getBoundingClientRect()
          const card = tile.getBoundingClientRect()
          return {
            x: icon.x + icon.width / 2 - card.x - card.width / 2,
            y: icon.y + icon.height / 2 - card.y - card.height / 2,
            width: icon.width,
            height: icon.height,
          }
        }),
      )
      assert.ok(
        offsets.every(({ x, y }) => Math.abs(x) < 1 && Math.abs(y) < 1),
        JSON.stringify(offsets),
      )
      assert.ok(
        offsets.every(({ width, height }) => width === 24 && height === 24),
        'Pinned icons use the Browser workspace’s 24px size',
      )
    }
    await assertCenteredFavicons()
    const idleUnifiedPins = await unifiedPinGeometry()
    assert.ok(
      idleUnifiedPins.every((tile) => tile.height === 56),
      'Unified pins match browser density',
    )
    await page.evaluate(() =>
      window.setBrowserActivity({
        'pinned-0': {
          key: 'pinned-0',
          url: 'http://lan.local:3000/docs',
          title: 'Docs',
          audible: true,
          microphone: true,
          camera: true,
          screenSharing: true,
          agent: true,
        },
      }),
    )
    await pinnedPages
      .first()
      .getByRole('img', { name: 'Audio playing in Docs', exact: true })
      .waitFor()
    assert.deepEqual(
      await unifiedPinGeometry(),
      idleUnifiedPins,
      'Unified pins keep their geometry when all media indicators appear',
    )
    await assertCenteredFavicons()
    const microphonePosition = await pinnedPages
      .first()
      .getByRole('img', { name: 'Microphone on in Docs', exact: true })
      .boundingBox()
    await page.evaluate(() =>
      window.setBrowserActivity({
        'pinned-0': {
          key: 'pinned-0',
          url: 'http://lan.local:3000/docs',
          title: 'Docs',
          microphone: true,
        },
      }),
    )
    await pinnedPages
      .first()
      .getByRole('img', { name: 'Audio playing in Docs', exact: true })
      .waitFor({ state: 'hidden' })
    const microphoneOnly = await pinnedPages
      .first()
      .getByRole('img', { name: 'Microphone on in Docs', exact: true })
      .boundingBox()
    const microphoneTile = await pinnedPages.first().boundingBox()
    assert.equal(microphoneOnly.width, microphonePosition.width)
    assert.equal(microphoneOnly.height, microphonePosition.height)
    assert.ok(
      microphoneOnly.x >= microphoneTile.x &&
        microphoneOnly.x + microphoneOnly.width <= microphoneTile.x + microphoneTile.width &&
        microphoneOnly.y >= microphoneTile.y &&
        microphoneOnly.y + microphoneOnly.height <= microphoneTile.y + microphoneTile.height,
      'Wrapping media indicators stay inside their tile without reserving empty slots',
    )
    assert.deepEqual(await unifiedPinGeometry(), idleUnifiedPins)
    await assertCenteredFavicons()
    await page.evaluate(() => window.setBrowserActivity({}))
    await pinnedPages
      .first()
      .getByLabel('Tab activity', { exact: true })
      .waitFor({ state: 'hidden' })
    assert.deepEqual(
      await unifiedPinGeometry(),
      idleUnifiedPins,
      'Unified idle pins retain their reserved space',
    )
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    await page.getByRole('heading', { name: 'What would you like to work on?' }).waitFor()
    await assertComposerDesign('Workspace input')
    const starterGeometry = await page.locator('[data-workspace-input]').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const form = element.querySelector('form').getBoundingClientRect()
      const heading = element.querySelector('h2').getBoundingClientRect()
      return {
        height: bounds.height,
        viewport: element.parentElement.clientHeight,
        formX: form.x,
        formWidth: form.width,
        headingCenter: heading.x + heading.width / 2,
      }
    })
    assert.ok(
      starterGeometry.height >= starterGeometry.viewport - 1,
      'The starter fills the available thread-sized canvas',
    )
    assert.ok(
      Math.abs(
        starterGeometry.formX + starterGeometry.formWidth / 2 - starterGeometry.headingCenter,
      ) < 2,
      'Heading and composer share the thread start column',
    )
    assert.equal(
      await page.getByRole('region', { name: 'Continue working', exact: true }).isVisible(),
      false,
      'Recent work does not crowd the initial composer',
    )
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.dataset.theme = 'light'
    })
    await assertComposerDesign('Workspace input')
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    for (const size of [
      { width: 900, height: 520 },
      { width: 760, height: 540 },
    ]) {
      await page.setViewportSize(size)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const formBounds = await page
        .getByRole('form', { name: 'Workspace input', exact: true })
        .boundingBox()
      const headingBounds = await page
        .getByRole('heading', { name: 'What would you like to work on?' })
        .boundingBox()
      const browseBounds = await browseWorkspace.boundingBox()
      assert.ok(
        headingBounds.y >= 0 && browseBounds.y + browseBounds.height <= size.height,
        'The complete starter fits in a short window',
      )
      assert.ok(
        formBounds.x >= 280 && formBounds.x + formBounds.width <= size.width,
        'The composer stays inside the content column at narrow widths',
      )
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    const action = page
      .getByRole('complementary')
      .getByRole('button', { name: 'Pin local thread', exact: true })
    const actionOpacity = () =>
      action.evaluate(
        (button) =>
          getComputedStyle(
            button.closest('.studio-workspace-row').querySelector('[data-workspace-actions]'),
          ).opacity,
      )
    await page.getByRole('heading', { name: 'What would you like to work on?' }).hover()
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-workspace-kind="thread"][aria-label="Thread: local thread"] [data-workspace-actions]',
          ),
        ).opacity === '0',
    )
    assert.equal(await actionOpacity(), '0', 'Row actions stay hidden at rest')
    await workspaceRows
      .filter({ has: page.getByRole('button', { name: 'Pin local thread', exact: true }) })
      .hover()
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-workspace-kind="thread"][aria-label="Thread: local thread"] [data-workspace-actions]',
          ),
        ).opacity === '1',
    )
    assert.equal(await actionOpacity(), '1', 'Hover reveals row actions')
    await page.getByRole('heading', { name: 'What would you like to work on?' }).hover()
    await action.focus()
    assert.equal(await action.evaluate((button) => button.matches(':focus')), true)
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-workspace-kind="thread"][aria-label="Thread: local thread"] [data-workspace-actions]',
          ),
        ).opacity === '1',
    )
    await action.evaluate((button) => button.blur())
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-workspace-kind="thread"][aria-label="Thread: local thread"] [data-workspace-actions]',
          ),
        ).opacity === '0',
    )
    await page.screenshot({ path: '/tmp/dovo-unified-overview.png', animations: 'disabled' })
    await page.screenshot({
      path: '/tmp/dovo-unified-pinned-browser-grid.png',
      animations: 'disabled',
    })
    await workspaceRows
      .filter({ has: page.getByRole('button', { name: 'Pin local thread', exact: true }) })
      .hover()
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-workspace-kind="thread"][aria-label="Thread: local thread"] [data-workspace-actions]',
          ),
        ).opacity === '1',
    )
    await page.screenshot({ path: '/tmp/dovo-unified-hover.png', animations: 'disabled' })
    const tile = pinnedPages.first()
    const tileBounds = await tile.boundingBox()
    const nextGridRow = await pinnedPages.last().boundingBox()
    const firstThread = await pinnedSection
      .locator('[data-workspace-kind="thread"]')
      .first()
      .boundingBox()
    assert.ok(tileBounds.width >= 56 && tileBounds.width < 100, 'Uses Browser workspace card width')
    assert.equal(
      await tile
        .locator('[data-browser-tab-select]')
        .evaluate((button) => button.getBoundingClientRect().height),
      54,
    )
    assert.ok(nextGridRow.y > tileBounds.y, 'Five fixture pages wrap in the compact grid')
    assert.ok(
      firstThread.y >= nextGridRow.y + nextGridRow.height,
      'Threads follow the entire pinned grid',
    )
    await tile.hover()
    assert.equal(
      await tile.locator('.studio-browser-tab-actions,[data-workspace-actions]').count(),
      0,
      'Pinned pages have no hover toolbar',
    )
    await tile.locator('[data-browser-tab-select]').focus()
    assert.equal(
      await tile.locator('.studio-browser-tab-actions,[data-workspace-actions]').count(),
      0,
      'Pinned pages keep actions in the context menu on keyboard focus too',
    )
    await page.screenshot({
      path: '/tmp/dovo-unified-pinned-browser-hover.png',
      animations: 'disabled',
    })
    const runtimeBeforeMenu = await page.evaluate(() => window.activeRuntimeId)
    await tile.locator('[data-browser-tab-select]').click({ button: 'right' })
    for (const action of [
      'Unpin tab',
      'Return to home',
      'Edit home URL',
      'Detach to new window',
      'Detach without sidebars',
      'Copy Studio ID (for agents)',
    ]) {
      assert.equal(
        await page.getByRole('menuitem', { name: action, exact: true }).isEnabled(),
        true,
      )
    }
    await page.screenshot({
      path: '/tmp/dovo-unified-pinned-browser-context.png',
      animations: 'disabled',
    })
    assert.equal(
      await page.getByRole('menuitemcheckbox', { name: 'Keep awake', exact: true }).isEnabled(),
      true,
    )
    for (const action of ['Settle tab', 'Snooze until tomorrow', 'Close tab']) {
      assert.equal(
        await page.getByRole('menuitem', { name: action, exact: true }).isDisabled(),
        true,
        'Pinned tabs keep the Browser workspace’s lifecycle guards',
      )
    }
    await page.getByRole('menuitem', { name: 'Move to another window', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Other window', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    assert.equal(
      await page.evaluate(() => window.activeRuntimeId),
      runtimeBeforeMenu,
      'Opening and dismissing the pinned menu preserves the active computer',
    )
    await page.getByRole('heading', { name: 'What would you like to work on?' }).waitFor()
    await tile.locator('[data-browser-tab-select]').evaluate((button) => button.blur())
    await page.getByRole('heading', { name: 'What would you like to work on?' }).hover()
  }
  // Replication copies share one logical row, with the same preference as Threads.
  await page.evaluate(() => {
    const task = {
      id: 'copy-owner',
      title: 'Replicated conversation',
      repositoryId: 'project',
      status: 'draft',
      createdAt: '2026-11-03T10:00:00Z',
      messages: [],
    }
    window.computers[0].snapshot.runtimeId = 'copy-machine'
    window.computers[0].snapshot.workspace.tasks.push(task)
    window.computers[1].snapshot.workspace.tasks.push({
      ...task,
      id: 'copy-replica',
      replica: {
        ownerRuntimeId: 'copy-machine',
        threadId: task.id,
        ownerName: 'local',
        projectName: 'Project',
      },
    })
    window.computers = window.computers.map((owner) => ({
      ...owner,
      snapshot: { ...owner.snapshot },
    }))
    window.refresh()
  })
  const copyRow = page
    .getByRole('complementary')
    .getByRole('group', { name: 'Thread: Replicated conversation', exact: true })
  await copyRow.waitFor()
  assert.equal(await copyRow.count(), 1, 'Original and replica have one sidebar row')
  await copyRow.getByLabel('local', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.computers = window.computers.map((owner, index) =>
      index === 0 ? { ...owner, connected: false } : owner,
    )
    window.refresh()
  })
  await copyRow.getByLabel('remote', { exact: true }).waitFor()
  assert.equal(await copyRow.count(), 1, 'A connected replica replaces an offline owner')
  await page.evaluate(() => {
    window.computers = window.computers.map((owner) => ({
      ...owner,
      connected: true,
      snapshot: {
        ...owner.snapshot,
        workspace: {
          ...owner.snapshot.workspace,
          tasks: owner.snapshot.workspace.tasks.filter((task) => !task.id.startsWith('copy-')),
        },
      },
    }))
    window.refresh()
  })
  // Unified must use the same relationship tree as Threads, across paired computers.
  const groupingOriginalRuntime = await page.evaluate(() => window.activeRuntimeId)
  await page.evaluate(() => {
    const task = (id, title, facts = {}) => ({
      id,
      title,
      repositoryId: 'project',
      status: 'draft',
      createdAt: '2026-11-03T10:00:00Z',
      messages: [],
      ...facts,
    })
    window.computers[0].snapshot.runtimeId = 'local-identity'
    window.computers[1].snapshot.runtimeId = 'remote-identity'
    window.computers[0].snapshot.workspace.tasks.push(
      task('group-parent', 'Grouping parent', {
        subagents: [
          {
            id: 'native',
            name: 'Native reviewer',
            provider: 'codex',
            status: 'working',
            sessionLive: true,
            startedAt: '2026-11-03T10:00:00Z',
          },
        ],
      }),
      task('group-local', 'Grouping local child', {
        delegation: { parentTaskId: 'group-parent' },
        status: 'running',
      }),
    )
    window.computers[1].snapshot.workspace.tasks.push(
      task('group-remote', 'Grouping remote child', {
        spawnParent: { runtimeId: 'local-identity', threadId: 'group-parent' },
        status: 'running',
      }),
      task('group-grandchild', 'Grouping grandchild', {
        delegation: { parentTaskId: 'group-remote' },
        status: 'running',
      }),
    )
    window.computers[1].snapshot.questions = [{ taskId: 'group-grandchild' }]
    window.computers = window.computers.map((computer) => ({
      ...computer,
      snapshot: { ...computer.snapshot },
    }))
    window.refresh()
  })
  const groupParent = page
    .getByRole('complementary')
    .getByRole('group', { name: 'Thread: Grouping parent', exact: true })
  await groupParent.waitFor()
  assert.equal(
    await groupParent.evaluate((element) => element.closest('section').getAttribute('aria-label')),
    'Needs input workspace items',
    'Remote descendant attention reaches the parent section',
  )
  for (const title of ['Grouping local child', 'Grouping remote child', 'Grouping grandchild']) {
    assert.equal(
      await page.getByRole('group', { name: 'Thread: ' + title, exact: true }).count(),
      0,
      'Subagents have no duplicate top-level rows',
    )
  }
  await groupParent
    .getByRole('button', { name: 'Subthreads for Grouping parent', exact: true })
    .click()
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping local child', exact: true })
    .waitFor()
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping remote child', exact: true })
    .waitFor()
  await groupParent
    .getByRole('button', { name: 'Open child thread Native reviewer', exact: true })
    .waitFor()
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping remote child', exact: true })
    .click()
  await page.locator('[data-thread="group-remote"][data-owner="remote"]').waitFor()
  assert.equal(
    await groupParent.getAttribute('data-highlighted'),
    'true',
    'Selecting a child highlights its owning root',
  )
  await page.getByLabel('Search workspace').fill('Grouping grandchild')
  assert.equal(
    await groupParent
      .getByRole('button', { name: 'Open child thread Grouping grandchild', exact: true })
      .count(),
    0,
    'Search starts with the parent result',
  )
  await page.keyboard.down('Alt')
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping grandchild', exact: true })
    .waitFor()
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping grandchild', exact: true })
    .click()
  await page.locator('[data-thread="group-grandchild"][data-owner="remote"]').waitFor()
  await page.keyboard.up('Alt')
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping grandchild', exact: true })
    .waitFor({ state: 'detached' })
  await page.getByLabel('Search workspace').fill('')
  await groupParent
    .getByRole('button', { name: 'Subthreads for Grouping parent', exact: true })
    .click()
  await page.getByRole('button', { name: 'Filter workspace', exact: true }).click()
  await page.getByLabel('Workspace computer filter').selectOption('remote')
  await groupParent.waitFor()
  assert.equal(
    await page.getByRole('group', { name: 'Thread: Grouping remote child', exact: true }).count(),
    0,
    'A computer filter keeps subagents behind the parent icon',
  )
  assert.equal(
    await page.getByRole('group', { name: 'Thread: Grouping grandchild', exact: true }).count(),
    0,
  )
  const filteredSubagents = groupParent.getByRole('button', {
    name: 'Subthreads for Grouping parent',
    exact: true,
  })
  assert.equal(await filteredSubagents.getAttribute('aria-expanded'), 'false')
  await filteredSubagents.click()
  await groupParent
    .getByRole('button', { name: 'Open child thread Grouping remote child', exact: true })
    .waitFor()
  await page.getByLabel('Workspace computer filter').selectOption('')
  await page.getByRole('button', { name: 'Filter workspace', exact: true }).click()
  await page.evaluate(() => {
    const owner = window.computers[0]
    owner.snapshot.workspace.tasks = owner.snapshot.workspace.tasks.map((task) =>
      task.id === 'group-parent' ? { ...task, archivedAt: '2026-11-09T09:00:00Z' } : task,
    )
    window.computers = window.computers.map((computer) => ({ ...computer }))
    window.refresh()
  })
  await groupParent.waitFor()
  assert.equal(
    await page.getByRole('group', { name: 'Thread: Grouping local child', exact: true }).count(),
    0,
    'Archiving the parent does not mix subagents into the main list',
  )
  await groupParent
    .getByRole('button', { name: 'Subthreads for Grouping parent', exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Hide Grouping grandchild', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Grouping remote child', exact: true }).click()
  await returnHome()
  await page.evaluate((originalRuntime) => {
    window.activeRuntimeId = originalRuntime
    for (const computer of window.computers) {
      computer.snapshot.workspace.tasks = computer.snapshot.workspace.tasks.filter(
        (task) => !task.id.startsWith('group-'),
      )
      computer.snapshot.questions = []
    }
    window.computers = window.computers.map((computer) => ({
      ...computer,
      snapshot: { ...computer.snapshot },
    }))
    window.refresh()
  }, groupingOriginalRuntime)
  await page.evaluate(() => {
    window.computers[0].snapshot.workspace.tasks.push(
      {
        id: 'unified-section-fixture-snoozed',
        title: 'Section fixture snoozed',
        repositoryId: 'project',
        status: 'running',
        waitingForFeedback: true,
        snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
        messages: [],
      },
      {
        id: 'unified-section-fixture-settled',
        title: 'Section fixture settled',
        repositoryId: 'project',
        status: 'running',
        waitingForFeedback: true,
        snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
        archived: true,
        messages: [],
      },
      ...[
        { id: 'working', status: 'running', waitingForFeedback: true },
        {
          id: 'pending',
          status: 'done',
          queue: [
            {
              id: 'result',
              role: 'user',
              text: 'Pending child result',
              subagentResultId: 'child-result',
            },
          ],
        },
        { id: 'waiting', status: 'done', waitingForFeedback: true },
        { id: 'review', status: 'review' },
        {
          id: 'input',
          status: 'running',
          waitingForFeedback: true,
          snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
        },
        { id: 'approval', status: 'review' },
      ].map(({ id, ...facts }) => ({
        id: 'unified-section-fixture-' + id,
        title: 'Section fixture ' + id,
        repositoryId: 'project',
        createdAt: '2026-11-03T10:00:00Z',
        messages: [],
        ...facts,
      })),
    )
    const snapshot = window.computers[0].snapshot
    const pinned = snapshot.workspace.tasks.find((task) => task.id === 'pinned-thread')
    window.sectionPinnedBackup = { ...pinned }
    Object.assign(pinned, {
      status: 'running',
      waitingForFeedback: true,
      snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
    })
    snapshot.questions = [
      { taskId: 'unified-section-fixture-input' },
      { taskId: 'unified-section-fixture-settled' },
      { taskId: 'pinned-thread' },
    ]
    snapshot.approvals = [{ taskId: 'unified-section-fixture-approval' }]
    window.computers[0].snapshot = { ...snapshot }
    window.refresh()
  })
  for (const [name, count, initiallyOpen] of [
    ['Pinned', 8, true],
    ['Needs input', 2, true],
    ['Active', 6, true],
    ['Working', 2, false],
    ['Waiting', 1, false],
    ['Snoozed', 1, false],
    ['Settled', 1, false],
  ]) {
    const disclosure = page
      .getByRole('region', { name: `${name} workspace items`, exact: true })
      .locator('details')
    const header = disclosure.locator(':scope > summary')
    await header.waitFor()
    assert.equal(await header.getAttribute('class'), 'studio-list-section-header')
    assert.equal(await header.locator('span').last().textContent(), String(count))
    assert.equal(
      await header.locator('.studio-thread-section-dot').count(),
      ['Needs input', 'Working', 'Waiting', 'Snoozed', 'Settled'].includes(name) ? 1 : 0,
    )
    assert.equal(await disclosure.evaluate((element) => element.open), initiallyOpen)
    if (!initiallyOpen) await header.click()
    const actualRows = await disclosure
      .locator('[data-workspace-kind]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))
    const expectedRows = {
      'Needs input': ['Thread: Section fixture approval', 'Thread: Section fixture input'],
      Working: ['Thread: Section fixture pending', 'Thread: Section fixture working'],
      Waiting: ['Thread: Section fixture waiting'],
      Snoozed: ['Thread: Section fixture snoozed'],
      Settled: ['Thread: Section fixture settled'],
    }[name]
    if (expectedRows)
      assert.deepEqual(
        actualRows,
        expectedRows,
        `${name} follows the TaskList classifier and priority`,
      )
    if (name === 'Active') {
      assert.ok(actualRows.includes('Page: LAN browser'))
      assert.ok(
        actualRows.includes('Terminal: local shell') &&
          actualRows.includes('Terminal: remote shell'),
        'Running standalone shells stay Active',
      )
      assert.ok(
        actualRows.includes('Thread: Section fixture review'),
        'Review alone is not Waiting without feedback',
      )
    }
    if (name === 'Pinned')
      assert.ok(
        actualRows.includes('Thread: Pinned local work'),
        'Pinning outranks snooze, input, work and feedback',
      )
    if (!initiallyOpen) await header.click()
    await header.focus()
    await page.keyboard.press('Enter')
    assert.equal(
      await disclosure.evaluate((element) => element.open),
      !initiallyOpen,
      `${name} supports keyboard collapse/expand`,
    )
    assert.equal(
      await header.locator('span').last().textContent(),
      String(count),
      'Collapsed headers retain counts',
    )
    await page.keyboard.press('Space')
    assert.equal(await disclosure.evaluate((element) => element.open), initiallyOpen)
    if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
      await header.hover()
      const hoveredSurface = await header.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      )
      await page.getByRole('heading', { name: 'What would you like to work on?' }).hover()
      const style = await header.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          uppercase: style.textTransform,
          border: style.borderTopWidth,
          background: style.backgroundImage,
          color: style.backgroundColor,
        }
      })
      assert.equal(style.uppercase, 'none', `${name} uses the thread section typography`)
      assert.equal(style.border, '1px', `${name} uses the shared bordered header`)
      assert.equal(style.background, 'none', `${name} uses the shared flat surface`)
      assert.notEqual(style.color, hoveredSurface, `${name} uses the shared hover surface`)
    }
  }
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    for (const id of ['active', 'working', 'waiting'])
      await page.getByRole('complementary').locator(`[data-section="${id}"] > summary`).click()
    await page.setViewportSize({ width: 1280, height: 1280 })
    await pinnedSection.evaluate((section) => {
      section.parentElement.scrollTop = 0
    })
    await page.getByRole('heading', { name: 'What would you like to work on?' }).hover()
    await page.screenshot({ path: '/tmp/dovo-unified-section-headers.png', animations: 'disabled' })
    await page.screenshot({ path: '/tmp/dovo-unified-working-waiting.png', animations: 'disabled' })
    for (const id of ['active', 'working', 'waiting'])
      await page.getByRole('complementary').locator(`[data-section="${id}"] > summary`).click()
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  await page.getByLabel('Search workspace').fill('Section fixture')
  const searchingDisclosure = page
    .getByRole('region', { name: 'Snoozed workspace items', exact: true })
    .locator('details')
  assert.equal(
    await searchingDisclosure.evaluate((element) => element.open),
    true,
    'Search reveals matching collapsed sections',
  )
  assert.equal(await searchingDisclosure.locator('summary').getAttribute('aria-disabled'), 'true')
  await searchingDisclosure.locator('summary').focus()
  await page.keyboard.press('Enter')
  assert.equal(
    await searchingDisclosure.evaluate((element) => element.open),
    true,
    'Matching search results stay expanded',
  )
  await page.getByLabel('Search workspace').fill('')
  assert.equal(
    await searchingDisclosure.evaluate((element) => element.open),
    false,
    'Clearing search restores collapse state',
  )
  await page.evaluate(() => {
    window.computers[0].snapshot.workspace.tasks =
      window.computers[0].snapshot.workspace.tasks.filter(
        (task) => !task.id.startsWith('unified-section-fixture-'),
      )
    const snapshot = window.computers[0].snapshot
    const pinnedIndex = snapshot.workspace.tasks.findIndex((task) => task.id === 'pinned-thread')
    snapshot.workspace.tasks[pinnedIndex] = window.sectionPinnedBackup
    snapshot.questions = []
    snapshot.approvals = []
    window.computers[0].snapshot = { ...snapshot }
    window.refresh()
  })
  const pinnedSelect = pinnedPages.first().locator('[data-browser-tab-select]')
  assert.equal(
    await pinnedSelect.getAttribute('aria-label'),
    'Docs Remote · remote · Remote Default',
  )
  await pinnedSelect.focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-browser="pinned-0"]:visible')
  assert.equal(await pinnedSelect.getAttribute('aria-current'), 'page')
  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'Selecting a pinned remote browser page preserves global computer selection',
  )
  await assertComposerHidden('browser')
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    await page.screenshot({
      path: '/tmp/dovo-unified-pinned-browser-selected.png',
      animations: 'disabled',
    })
  }
  const beforeCollapsedHome = (await savedWorkspace()).tabs
  await page.evaluate(() => {
    window.sidebarCollapsed = true
    window.refresh()
  })
  await page.getByRole('complementary').waitFor({ state: 'hidden' })
  await returnHome()
  assert.deepEqual(
    (await savedWorkspace()).tabs,
    beforeCollapsedHome,
    'Collapsed Home retains open views',
  )
  await page.evaluate(() => {
    window.sidebarCollapsed = false
    window.refresh()
  })
  await selectSidebarItem('Page', 'Docs')
  await page.evaluate(() => {
    window.sidebarCollapsed = true
    window.refresh()
  })
  await page.getByRole('complementary').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Hide Docs', exact: true }).click()
  await workspaceInput.waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Workspace request',
  )
  assert.deepEqual((await savedWorkspace()).tabs, [], 'Hiding the last item returns focus to Home')
  await page.evaluate(() => {
    window.sidebarCollapsed = false
    window.refresh()
  })
  await page.getByRole('complementary').waitFor()
  assert.equal(await pinnedPages.count(), 5, 'Hiding an open page keeps its pinned sidebar tile')
  await selectSidebarItem('Page', 'Docs')
  await assertComposerHidden('browser')
  await returnHome()
  await assertComposerInteractions('Workspace input', 'Workspace request', 'Workspace destination')
  assert.deepEqual(
    await workspaceRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    [
      'Page: Docs',
      'Page: Issues',
      'Page: Metrics',
      'Page: Notes',
      'Page: Preview',
      'Thread: Pinned local work',
      'Thread: Pinned remote work',
      'Terminal: Pinned shell',
      'Page: LAN browser',
      'Terminal: local shell',
      'Thread: local thread',
      'Terminal: remote shell',
      'Thread: remote thread',
    ],
    'Pinned pages lead, threads follow, and Active items retain mixed title order across computers',
  )
  assert.equal(await workspaceRows.filter({ hasText: 'thread terminal' }).count(), 0)
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
  assert.deepEqual(
    await pinnedPages.evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    ['Page: Issues', 'Page: Notes'],
    'Pinned grid respects each browser page’s owning computer',
  )
  assert.equal(
    await page
      .getByRole('complementary')
      .locator('.studio-thread-card')
      .filter({ hasText: 'remote thread' })
      .count(),
    0,
  )
  await page.getByLabel('Workspace computer filter').selectOption('')
  await page.getByRole('button', { name: 'Browsers', exact: true }).click()
  assert.equal(await workspaceRows.locator('.studio-thread-card').count(), 0)
  assert.equal(await pinnedPages.count(), 5)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: 'Filter workspace', exact: true }).click()
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.locator('[data-terminal-starter]:visible').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0, 'Terminal creation stays inline')
  await assertComposerInteractions('New workspace terminal', 'Startup command', 'Terminal shell')
  await page.getByLabel('Startup command', { exact: true }).fill('printf retained-inline-draft')
  await page.getByRole('button', { name: 'Return to workspace', exact: true }).click()
  assert.equal(
    await workspaceInput.inputValue(),
    '',
    'The workspace draft stays separate from the terminal draft',
  )
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  assert.equal(
    await page.getByLabel('Startup command', { exact: true }).inputValue(),
    'printf retained-inline-draft',
  )
  assert.equal(
    await page
      .getByLabel('Startup command', { exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
    'Returning to a terminal draft focuses its editor',
  )
  await page.getByLabel('Startup command', { exact: true }).fill('')

  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    await assertComposerDesign('New workspace terminal')
    await page.screenshot({ path: '/tmp/dovo-terminal-starter-dialog.png', animations: 'disabled' })
  }
  await page.getByRole('button', { name: 'Return to workspace', exact: true }).click()
  await page.locator('[data-terminal-starter]:visible').waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
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
  await workspaceInput.fill('Keep the shared draft')
  await page.getByLabel('Workspace input computer').selectOption('local')
  await page.getByLabel('Workspace destination').selectOption('thread')
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'local thread' })
    .click()
  await page.getByLabel('Thread draft').fill('Keep this draft')
  await assertComposerHidden('thread')
  const openItems = (await savedWorkspace()).tabs
  const threadDraft = await page.getByLabel('Thread draft').elementHandle()
  await returnHome()
  await browseWorkspace.click()
  await page.getByRole('region', { name: 'Continue working', exact: true }).waitFor()
  await browseWorkspace.click()
  assert.deepEqual(
    (await savedWorkspace()).tabs,
    openItems,
    'Home retains open items without a visible tab strip',
  )
  assert.equal(await page.getByLabel('Workspace request').inputValue(), 'Keep the shared draft')
  assert.equal(await page.getByLabel('Workspace destination').inputValue(), 'thread')
  await workspaceRows.getByRole('button', { name: /^LAN browser Remote ·/ }).click()
  await page.waitForSelector('[data-browser="page"]:visible')
  await assertComposerHidden('browser')
  await returnHome()
  assert.equal(await workspaceInput.inputValue(), 'Keep the shared draft')
  assert.equal(await page.getByLabel('Workspace destination').inputValue(), 'thread')
  await selectSidebarItem('Thread', 'local thread')
  await assertComposerHidden('thread')
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  assert.equal(
    await page
      .getByLabel('Thread draft')
      .evaluate((input, original) => input === original, threadDraft),
    true,
    'Sidebar navigation retains the thread editor mount',
  )
  const expandSection = async (name) => {
    const disclosure = page
      .getByRole('region', { name: name + ' workspace items' })
      .locator('details')
    if (!(await disclosure.evaluate((element) => element.open)))
      await disclosure.locator('summary').click()
  }
  const openRowMenu = async (title) => {
    const sidebar = page.getByRole('complementary')
    const row = sidebar
      .getByRole('group', { name: `Page: ${title}`, exact: true })
      .or(sidebar.getByRole('group', { name: `Thread: ${title}`, exact: true }))
      .or(sidebar.getByRole('group', { name: `Terminal: ${title}`, exact: true }))
    await row.locator('[data-browser-tab-select],.studio-thread-card').click({ button: 'right' })
  }
  await openRowMenu('local thread')
  for (const name of [
    'Rename…',
    'Copy',
    'Project',
    'Advanced',
    'New thread',
    'Archive thread',
    'Delete thread…',
  ])
    assert.equal(await page.getByRole('menuitem', { name, exact: true }).isVisible(), true, name)
  await page.screenshot({ path: '/tmp/dovo-unified-thread-context.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await openRowMenu('remote shell')
  for (const name of [
    'Rename…',
    'Split left/right',
    'Split top/bottom',
    'New terminal',
    'Copy terminal ID',
    'Close terminal…',
  ])
    assert.equal(await page.getByRole('menuitem', { name, exact: true }).isVisible(), true, name)
  await page.screenshot({ path: '/tmp/dovo-unified-terminal-context.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  const menuRuntime = await page.evaluate(() => window.activeRuntimeId)
  for (const [title, next] of [
    ['remote thread', 'Renamed remote thread'],
    ['Renamed remote thread', 'remote thread'],
  ]) {
    await openRowMenu(title)
    await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename thread', exact: true })
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(next)
    await dialog.getByRole('button', { name: 'Save title', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const call = await page.evaluate(() =>
      window.calls.filter((call) => call.path === '/api/workspace').at(-1),
    )
    assert.equal(call.owner, 'remote', 'Thread rename uses its own computer')
    assert.equal(call.input.changes.title.after, next)
    assert.equal(await page.evaluate(() => window.activeRuntimeId), menuRuntime)
    assert.equal(
      await page
        .getByLabel('Thread draft')
        .evaluate((input, original) => input === original, threadDraft),
      true,
    )
  }
  await openRowMenu('local thread')
  await page.getByRole('menuitem', { name: 'Project', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Filter by project', exact: true }).click()
  const clearProject = page.getByRole('button', {
    name: 'Clear workspace project filter',
    exact: true,
  })
  await clearProject.waitFor()
  assert.equal(
    await page
      .getByRole('complementary')
      .getByRole('group', { name: 'Terminal: remote shell', exact: true })
      .count(),
    0,
  )
  await clearProject.click()
  await page
    .getByRole('complementary')
    .getByRole('group', { name: 'Terminal: remote shell', exact: true })
    .waitFor()
  const rowAction = async (title, action) => {
    await openRowMenu(title)
    const browser = await page
      .getByRole('menuitem', { name: 'Copy Studio ID (for agents)', exact: true })
      .count()
    const label = browser
      ? ({ Pin: 'Pin tab', Unpin: 'Unpin tab', Settle: 'Settle tab', Reopen: 'Wake tab' }[action] ??
        action)
      : action
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  const snoozeRow = async (title, duration = 'For 1 hour') => {
    await openRowMenu(title)
    if (
      await page.getByRole('menuitem', { name: 'Copy Studio ID (for agents)', exact: true }).count()
    ) {
      const label =
        duration === 'Unsnooze'
          ? 'Wake tab'
          : duration === 'Choose date and time…'
            ? duration
            : 'Snooze until tomorrow'
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    } else {
      await page.getByRole('menuitem', { name: 'Snooze', exact: true }).hover()
      await page.getByRole('menuitem', { name: duration, exact: true }).click()
    }
  }
  await page.evaluate(() => {
    const snapshot = window.computers[1].snapshot
    const later = new Date(Date.now() + 3600000).toISOString()
    snapshot.terminals.push(
      ...[
        {
          id: 'build',
          activity: {
            state: 'working',
            progress: 40,
            app: 'Builder',
            message: 'Compiling project',
          },
        },
        {
          id: 'approval',
          activity: { state: 'blocked', kind: 'permission', message: 'Approve deployment?' },
        },
        { id: 'done', activity: { state: 'done' } },
        { id: 'error', activity: { state: 'error' } },
        { id: 'idle', activity: { state: 'idle' } },
        { id: 'unknown' },
        { id: 'exited', exited: true, exitCode: 7, activity: { state: 'working' } },
        { id: 'snoozed', snoozedUntil: later, activity: { state: 'working' } },
        {
          id: 'settled',
          settledAt: new Date().toISOString(),
          snoozedUntil: later,
          activity: { state: 'blocked' },
        },
        {
          id: 'pinned',
          pinned: true,
          settledAt: new Date().toISOString(),
          snoozedUntil: later,
          activity: { state: 'blocked' },
        },
      ].map(({ id, ...metadata }) => ({
        id: 'program-' + id,
        title: 'Program ' + id,
        taskId: 'studio:terminals',
        exited: false,
        repositoryId: 'project',
        directory: '/project',
        ...metadata,
      })),
    )
    window.computers[1].snapshot = { ...snapshot }
    window.refresh()
  })
  await page.getByLabel('Search workspace').fill('Program ')
  for (const [section, title, label, tone] of [
    ['Working', 'Program build', 'Working 40%', 'text-primary'],
    ['Needs input', 'Program approval', 'Needs input', 'text-status-warning'],
    ['Active', 'Program done', 'Done', 'text-status-success'],
    ['Active', 'Program error', 'Failed', 'text-destructive'],
    ['Active', 'Program idle', 'Idle', 'text-muted-foreground'],
    ['Active', 'Program unknown', 'Live session', 'text-muted-foreground'],
    ['Active', 'Program exited', 'Exited 7', 'text-destructive'],
    ['Snoozed', 'Program snoozed', 'Working', 'text-primary'],
    ['Settled', 'Program settled', 'Needs input', 'text-status-warning'],
    ['Pinned', 'Program pinned', 'Needs input', 'text-status-warning'],
  ]) {
    const row = page
      .getByRole('region', { name: section + ' workspace items', exact: true })
      .getByRole('group', { name: `Terminal: ${title}`, exact: true })
    await row.waitFor()
    assert.ok(
      (await row.getByText(label, { exact: true }).getAttribute('class')).includes(tone),
      `${title} uses the common label and tone in ${section}`,
    )
  }
  for (const [section, count] of [
    ['Pinned', 1],
    ['Needs input', 1],
    ['Active', 5],
    ['Working', 1],
    ['Snoozed', 1],
    ['Settled', 1],
  ]) {
    assert.equal(
      await page
        .getByRole('region', { name: section + ' workspace items', exact: true })
        .locator('summary > span')
        .last()
        .textContent(),
      String(count),
    )
  }
  assert.equal(
    await workspaceRows
      .filter({ hasText: 'Program build' })
      .getByTitle('Compiling project')
      .count(),
    1,
  )
  assert.equal(
    await workspaceRows
      .filter({ hasText: 'Program approval' })
      .getByTitle('Approve deployment?')
      .count(),
    1,
  )
  await page.evaluate(() => {
    window.computers[1].connected = false
    window.refresh()
  })
  const offlineBuild = page
    .getByRole('region', { name: 'Active workspace items', exact: true })
    .getByRole('group', { name: 'Terminal: Program build', exact: true })
  await offlineBuild.getByText('Offline', { exact: true }).waitFor()
  assert.equal(
    await offlineBuild.getByText('Working 40%', { exact: true }).count(),
    0,
    'Offline overrides stale program work',
  )
  await openRowMenu('Program build')
  for (const action of ['Pin', 'Snooze', 'Settle']) {
    assert.equal(
      await page.getByRole('menuitem', { name: action, exact: true }).isDisabled(),
      true,
      'Offline terminal actions stay disabled in the context menu',
    )
  }
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.computers[1].connected = true
    window.refresh()
  })
  await selectSidebarItem('Terminal', 'Program build')
  await page.waitForSelector('[data-terminal="program-build"][data-owner="remote"]')
  await assertComposerHidden('terminal')
  await rowAction('Program build', 'Pin')
  await rowAction('Program build', 'Settle')
  await page
    .getByRole('region', { name: 'Pinned workspace items', exact: true })
    .getByRole('group', { name: 'Terminal: Program build', exact: true })
    .waitFor()
  await rowAction('Program build', 'Unpin')
  await page
    .getByRole('region', { name: 'Settled workspace items', exact: true })
    .getByRole('group', { name: 'Terminal: Program build', exact: true })
    .waitFor()
  await rowAction('Program build', 'Reopen')
  await snoozeRow('Program build')
  await page
    .getByRole('region', { name: 'Snoozed workspace items', exact: true })
    .getByRole('group', { name: 'Terminal: Program build', exact: true })
    .waitFor()
  await snoozeRow('Program build', 'Unsnooze')
  assert.equal(
    await page.evaluate(
      () =>
        window.computers[1].snapshot.terminals.find((session) => session.id === 'program-build')
          .activity.state,
    ),
    'working',
    'Lifecycle changes retain program metadata',
  )
  await page.evaluate(() => {
    const snapshot = window.computers[1].snapshot
    const session = snapshot.terminals.find((session) => session.id === 'program-build')
    session.title = session.terminalTitle = 'Program build updated'
    window.computers[1].snapshot = { ...snapshot }
    window.refresh()
  })
  await page.getByRole('region', { name: 'Terminal: Program build updated', exact: true }).waitFor()
  await page.evaluate(() => {
    const snapshot = window.computers[1].snapshot
    const session = snapshot.terminals.find((session) => session.id === 'program-build')
    session.title = session.customTitle = 'Program custom name'
    session.terminalTitle = 'Program automatic title'
    window.computers[1].snapshot = { ...snapshot }
    window.refresh()
  })
  await page.getByRole('region', { name: 'Terminal: Program custom name', exact: true }).waitFor()
  await page
    .getByRole('complementary')
    .getByRole('group', { name: 'Terminal: Program custom name', exact: true })
    .waitFor()
  assert.equal(
    await workspaceRows.filter({ hasText: 'Program automatic title' }).count(),
    0,
    'Unified renders the backend-resolved custom title',
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.computers[1].snapshot.terminals.find((session) => session.id === 'program-done')
          .settledAt,
    ),
    undefined,
    'A Done report never auto-settles the session',
  )
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 1200 })
    await page
      .getByRole('complementary')
      .locator('[data-section="pinned"]')
      .evaluate((section) => {
        section.parentElement.parentElement.scrollTop = 0
      })
    await page.locator('#workspace-content').hover()
    await page.screenshot({
      path: '/tmp/dovo-unified-terminal-statuses.png',
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  await page
    .getByRole('complementary')
    .getByRole('button', { name: 'Hide Program custom name', exact: true })
    .click()
  await page.getByLabel('Search workspace').fill('')
  const activeThreads = page.getByRole('complementary').locator('[data-section="active"]')
  await activeThreads.locator(':scope > summary:not([aria-disabled="true"])').waitFor()
  if (!(await activeThreads.evaluate((section) => section.open)))
    await activeThreads.locator(':scope > summary').click()
  await selectSidebarItem('Thread', 'local thread')
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  await page.evaluate(() => {
    const snapshot = window.computers[1].snapshot
    snapshot.terminals = snapshot.terminals.filter((session) => !session.id.startsWith('program-'))
    window.computers[1].snapshot = { ...snapshot }
    window.refresh()
  })
  await rowAction('Docs', 'Unpin')
  assert.equal(await pinnedGrid.getByRole('group', { name: 'Page: Docs', exact: true }).count(), 0)
  await rowAction('Docs', 'Pin')
  await pinnedGrid.getByRole('group', { name: 'Page: Docs', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'Pinned browser lifecycle actions preserve the active computer',
  )
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
  await snoozeRow('LAN browser', 'Choose date and time…')
  const customSnooze = page.getByRole('dialog', { name: 'Snooze LAN browser', exact: true })
  await customSnooze.getByLabel('Wake date and time').fill('2099-11-10T09:30')
  await customSnooze.getByRole('button', { name: 'Snooze', exact: true }).click()
  await expandSection('Snoozed')
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs[0].snoozedUntil,
    ),
    await page.evaluate(() => new Date('2099-11-10T09:30').getTime()),
    'The unified tab menu preserves the chosen wake time',
  )
  await snoozeRow('LAN browser', 'Unsnooze')
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
    (await pinnedSection.locator('.studio-thread-card').first().textContent()).includes(
      'local thread',
    ),
    'Pinned items lead the mixed list',
  )
  await rowAction('local thread', 'Unpin')
  await rowAction('local thread', 'Settle')
  await page.waitForFunction(
    () => window.computers[0].snapshot.workspace.tasks[0].archived === true,
  )
  await expandSection('Settled')
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'local thread' })
    .waitFor()
  await rowAction('local thread', 'Reopen')
  await page.waitForFunction(
    () => window.computers[0].snapshot.workspace.tasks[0].archived === false,
  )
  await page.evaluate(() => {
    window.computers[0].snapshot.workspace.tasks[0].status = 'running'
    window.refresh()
  })
  await expandSection('Working')
  await openRowMenu('local thread')
  assert.equal(
    await page.getByRole('menuitem', { name: 'Settle', exact: true }).isDisabled(),
    true,
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

  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'remote shell' })
    .click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await assertComposerHidden('terminal')
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    const terminal = await page.locator('[data-terminal-primary]').boundingBox()
    const panel = await page
      .getByRole('region', { name: 'Terminal: remote shell', exact: true })
      .boundingBox()
    assert.ok(
      terminal.width > panel.width * 0.9 && terminal.height > panel.height * 0.7,
      'Terminal owns the main workspace area',
    )
    await page.setViewportSize({ width: 1280, height: 1050 })
    await pinnedSection.evaluate((section) => {
      section.parentElement.scrollTop = 0
    })
    await page.screenshot({
      path: '/tmp/dovo-unified-terminal-no-tabs.png',
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 1280, height: 900 })
  }

  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'local',
    'opening remote terminals must not switch the active computer',
  )
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-thread:thread'))
  await page
    .getByRole('complementary')
    .getByRole('button', { name: 'Hide remote shell', exact: true })
    .click()
  await page.waitForFunction(() => document.activeElement?.id === 'workspace-content')
  assert.equal(
    (await savedWorkspace()).tabs.some(
      (item) => item.kind === 'terminal' && item.runtimeId === 'remote' && item.id === 'shell',
    ),
    false,
    'The direct sidebar Hide action releases the retained item without closing its session',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
  )
  await selectSidebarItem('Terminal', 'remote shell')
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await selectSidebarItem('Thread', 'local thread')
  assert.equal(await page.getByLabel('Thread draft').inputValue(), 'Keep this draft')
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 1050 })
    await pinnedSection.evaluate((section) => {
      section.parentElement.scrollTop = 0
    })
    await page.screenshot({ path: '/tmp/dovo-unified-thread-no-tabs.png', animations: 'disabled' })
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  assert.ok((await page.evaluate(() => window.effects)).includes('hide-terminal:shell'))
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'remote thread' })
    .click()
  await page.waitForSelector('[data-thread="thread"][data-owner="remote"]')
  assert.equal(await page.evaluate(() => window.activeRuntimeId), 'remote')
  await assertComposerHidden('thread')
  await returnHome()
  assert.equal(await workspaceInput.inputValue(), 'Keep the shared draft')
  assert.equal(await page.getByLabel('Workspace destination').inputValue(), 'thread')
  assert.equal(
    await page.getByLabel('Workspace input computer').inputValue(),
    'local',
    'Opening a remote thread does not retarget the Home draft',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/tasks/workspace/route').length,
    ),
    0,
    'Sidebar and Home navigation never reclassifies the draft',
  )
  await page.getByLabel('Workspace input computer').selectOption('remote')
  await page.getByLabel('Workspace destination').selectOption('auto')
  await page.getByLabel('Workspace request').fill('printf original-input')
  await workspaceInput.press('Enter')
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
    (await savedWorkspace()).tabs.some((item) => item.kind === 'browser' && item.id === 'new'),
    false,
    'new-page placeholder must be replaced',
  )
  await assertComposerHidden('browser')
  await returnHome()
  await page.getByLabel('Workspace request').fill('printf original-input')
  await page.getByRole('button', { name: 'Choose destination' }).click()
  await page.getByLabel('Workspace terminal shell').selectOption('fish')
  await page.getByRole('button', { name: 'Run command' }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/terminals/workspace').input.command,
    ),
    'printf original-input',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/terminals/workspace').input.shellId,
    ),
    'fish',
  )
  await assertComposerHidden('terminal')
  const lastUnifiedCreate = () =>
    page.evaluate(() =>
      window.calls.filter((call) => call.path === '/api/terminals/workspace').at(-1),
    )
  await returnHome()
  await page.getByLabel('Workspace destination').selectOption('terminal')
  await page.getByLabel('Workspace input project').selectOption('project')
  await page.evaluate(() => {
    window.checkoutError = 'Checkout catalog unavailable'
  })
  await page.getByLabel('Terminal checkout', { exact: true }).selectOption('existing')
  await page.getByRole('alert').filter({ hasText: 'Checkout catalog unavailable' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Open terminal', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.checkoutError = undefined
  })
  await page.getByRole('button', { name: 'Retry checkout choices', exact: true }).click()
  await page.getByLabel('Terminal existing worktree').selectOption('/project/existing')
  await page.getByLabel('Workspace request').fill('  printf existing-checkout  ')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await assertComposerHidden('terminal')
  assert.deepEqual(await lastUnifiedCreate(), {
    path: '/api/terminals/workspace',
    owner: 'remote',
    input: {
      repositoryId: 'project',
      command: '  printf existing-checkout  ',
      shellId: 'fish',
      execution: 'worktree',
      existingWorktreePath: '/project/existing',
      rememberSession: true,
    },
  })
  await returnHome()
  await page.getByLabel('Workspace destination').selectOption('terminal')
  await page.getByLabel('Terminal checkout', { exact: true }).selectOption('worktree')
  await page.getByLabel('Terminal base branch').selectOption('refs/heads/feature')
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
  await assertComposerHidden('terminal')
  assert.deepEqual(
    (await lastUnifiedCreate()).input,
    {
      repositoryId: 'project',
      shellId: 'fish',
      execution: 'worktree',
      worktreeBaseBranch: 'refs/heads/feature',
      rememberSession: true,
    },
    'Explicit Terminal mode can open an empty shell in a new worktree',
  )
  await returnHome()
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
  await page.locator('[data-terminal-starter]:visible').waitFor()
  await page.getByLabel('Terminal computer', { exact: true }).selectOption('local')
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByLabel('Terminal shell', { exact: true }).selectOption('bash')
  await page.getByLabel('Startup command', { exact: true }).fill('  printf starter-command  ')
  await page.getByLabel('Startup command', { exact: true }).press('Enter')
  await page.waitForSelector('[data-terminal^="local-created-"][data-owner="local"]')
  assert.deepEqual(
    await page.evaluate(() => {
      const call = window.calls.find(
        (call) => call.owner === 'local' && call.path === '/api/terminals/workspace',
      )
      return call.input
    }),
    {
      rememberSession: true,
      repositoryId: 'project',
      command: '  printf starter-command  ',
      shellId: 'bash',
      execution: 'main',
    },
  )
  await page.getByRole('button', { name: 'Hide terminal pane', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
  )
  const openStarter = async () => {
    await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
    await page.locator('[data-terminal-starter]:visible').waitFor()
  }
  const launchStarter = async () => {
    await page
      .locator('[data-terminal-starter]:visible')
      .getByRole('button', { name: 'Open terminal', exact: true })
      .click()
    await page.locator('[data-terminal-starter]:visible').waitFor({ state: 'hidden' })
  }
  const lastCreate = () =>
    page.evaluate(() =>
      window.calls.filter((call) => call.path === '/api/terminals/workspace').at(-1),
    )
  await page.evaluate(() => {
    window.delayShellOwner = 'remote'
  })
  await openStarter()
  await page.waitForFunction(() => !!window.finishShells)
  await page.getByLabel('Startup command', { exact: true }).fill('printf keep-draft')
  await page.getByLabel('Terminal computer', { exact: true }).selectOption('local')
  await page.getByLabel('Terminal shell', { exact: true }).selectOption('bash')
  await page.evaluate(() => {
    window.delayShellOwner = undefined
    window.finishShells()
  })
  assert.equal(
    await page.getByLabel('Startup command', { exact: true }).inputValue(),
    'printf keep-draft',
  )
  assert.equal(await page.getByLabel('Terminal shell', { exact: true }).inputValue(), 'bash')
  assert.equal(
    await page
      .getByLabel('Terminal shell', { exact: true })
      .locator('option[value="fish"]')
      .count(),
    0,
    'Stale remote shells never replace the local catalog',
  )
  assert.equal(
    await page.getByLabel('Terminal working directory').locator('option[value="scratch"]').count(),
    0,
    'No Project uses home, not the scratch workspace',
  )
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByLabel('Terminal checkout', { exact: true }).selectOption('existing')
  await page.getByLabel('Terminal existing worktree').selectOption('/project/existing')
  await launchStarter()
  assert.deepEqual(await lastCreate(), {
    path: '/api/terminals/workspace',
    owner: 'local',
    input: {
      rememberSession: true,
      repositoryId: 'project',
      command: 'printf keep-draft',
      shellId: 'bash',
      execution: 'worktree',
      existingWorktreePath: '/project/existing',
    },
  })
  assert.equal(
    await page.evaluate(() => window.activeRuntimeId),
    'remote',
    'Creation on another computer preserves the global selection',
  )
  await openStarter()
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByLabel('Terminal checkout', { exact: true }).selectOption('worktree')
  await page.getByLabel('Terminal base branch').selectOption('refs/heads/feature')
  await launchStarter()
  assert.deepEqual((await lastCreate()).input, {
    rememberSession: true,
    repositoryId: 'project',
    shellId: 'default',
    execution: 'worktree',
    worktreeBaseBranch: 'refs/heads/feature',
  })
  await page.evaluate(() => {
    window.shellError = 'Shell catalog unavailable'
  })
  await openStarter()
  await page.getByRole('alert').filter({ hasText: 'Shell catalog unavailable' }).waitFor()
  assert.equal(
    await page
      .locator('[data-terminal-starter]:visible')
      .getByRole('button', { name: 'Open terminal', exact: true })
      .isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.shellError = undefined
  })
  await page.getByRole('button', { name: 'Retry shells', exact: true }).click()
  await page.getByLabel('Terminal shell', { exact: true }).selectOption('fish')
  await page.getByRole('button', { name: 'Remember session', exact: true }).click()
  await page.getByLabel('Startup command', { exact: true }).fill('   ')
  await launchStarter()
  assert.deepEqual(
    (await lastCreate()).input,
    { shellId: 'fish', rememberSession: false },
    'Blank startup input opens a home shell without project or worktree settings',
  )
  await returnHome()
  await page.evaluate(() => {
    window.delayRoute = true
  })
  await page.getByLabel('Workspace destination').selectOption('auto')
  await page.getByLabel('Workspace request').fill('Old classification input')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRoute)
  await page.getByLabel('Workspace request').fill('New browser draft')
  await page.getByLabel('Workspace destination').selectOption('browser')
  await page.evaluate(() => {
    window.delayRoute = false
    window.finishRoute()
  })
  assert.equal(
    await page.getByLabel('Workspace destination').inputValue(),
    'browser',
    'Late AI suggestions cannot override a manual destination',
  )
  assert.equal(await page.getByLabel('Workspace request').inputValue(), 'New browser draft')
  await page.getByLabel('Workspace destination').selectOption('terminal')
  await page.getByLabel('Workspace terminal shell').selectOption('fish')
  await page.getByLabel('Workspace request').fill('printf delayed-snapshot')
  await page.evaluate(() => {
    window.delayTerminalSnapshot = true
  })
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Waiting for terminal session' }).waitFor()
  const delayedItem = (await savedWorkspace()).active
  await page.evaluate(() => window.refresh())
  assert.equal(
    (await savedWorkspace()).active,
    delayedItem,
    'A delayed terminal snapshot cannot erase a freshly opened item',
  )
  await page.evaluate(() => {
    window.delayTerminalSnapshot = false
    window.publishTerminalSnapshot()
  })
  await page.waitForSelector('[data-terminal^="remote-created-"][data-owner="remote"]:visible')
  await returnHome()
  await page.getByLabel('Workspace destination').selectOption('thread')
  await page.getByLabel('Workspace request').fill('Retry this captured request')
  await page.evaluate(() => {
    window.messageError = 'Computer disconnected'
  })
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'its message could not be confirmed' }).waitFor()
  const failedMessage = await page.evaluate(() =>
    window.calls.filter((c) => c.path === '/api/tasks/message').at(-1),
  )
  const createsBeforeRetry = await page.evaluate(
    () => window.calls.filter((c) => c.path === '/api/workspace' && c.input.create).length,
  )
  await page.evaluate(() => {
    window.messageError = undefined
  })
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Workspace request"]').value === '',
  )
  const retriedMessage = await page.evaluate(() =>
    window.calls.filter((c) => c.path === '/api/tasks/message').at(-1),
  )
  assert.equal(retriedMessage.input.id, failedMessage.input.id)
  assert.equal(retriedMessage.input.messageId, failedMessage.input.messageId)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.path === '/api/workspace' && c.input.create).length,
    ),
    createsBeforeRetry,
    'Retry never creates a duplicate thread',
  )
  await assertComposerHidden('thread')
  await returnHome()
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
    window.delayCreate = true
    window.routeError = undefined
  })
  await page.getByLabel('Workspace request').fill('Complete the captured submission')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.waitForFunction(() => !!window.finishCreate)
  const savingTask = await page.evaluate(() =>
    window.calls.filter((c) => c.path === '/api/workspace' && c.input.create).at(-1),
  )
  await page.evaluate(() => {
    window.terminalOnly = true
    window.render()
  })
  await page.getByRole('region', { name: 'Terminals workspace' }).waitFor()
  await page.evaluate(() => {
    window.delayCreate = false
    window.finishCreate()
  })
  await page.waitForFunction(
    (id) => window.calls.some((c) => c.path === '/api/tasks/message' && c.input.id === id),
    savingTask.input.id,
  )
  const completedMessage = await page.evaluate(() =>
    window.calls.filter((c) => c.path === '/api/tasks/message').at(-1),
  )
  assert.equal(completedMessage.owner, savingTask.owner)
  assert.equal(
    completedMessage.input.text,
    'Complete the captured submission',
    'Unmounting input cannot leave an authorized saved thread without its message',
  )
  if (process.env.DOVO_WORKSPACE_SCREENSHOTS) {
    await page.getByRole('heading', { name: 'What would you like to work on?' }).waitFor()
    await assertComposerDesign('New workspace terminal')
    await page.screenshot({ path: '/tmp/dovo-terminal-starter.png', animations: 'disabled' })
    for (const width of [1000, 760]) {
      await page.setViewportSize({ width, height: 800 })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Terminal starter must fit the window',
      )
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'remote shell' })
    .click()

  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByLabel('Startup command', { exact: true }).fill('printf dedicated-draft')
  await page.getByLabel('Terminal working directory').selectOption('project')
  await page.getByLabel('Terminal checkout', { exact: true }).selectOption('worktree')
  await page.getByLabel('Terminal base branch').selectOption('refs/heads/feature')
  await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  assert.equal(
    await page.getByLabel('Startup command', { exact: true }).inputValue(),
    'printf dedicated-draft',
  )
  await page.getByLabel('Terminal base branch').waitFor()
  assert.equal(
    await page.getByLabel('Terminal base branch').inputValue(),
    'refs/heads/feature',
    'Returning to a starter preserves its checkout and selected base branch',
  )
  await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/close').length,
    ),
    0,
    'Opening and leaving a starter keeps the shell alive',
  )
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.evaluate(() => {
    window.terminalError = 'Could not launch shell'
  })
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Could not launch shell' }).waitFor()
  assert.equal(
    await page.getByLabel('Startup command', { exact: true }).inputValue(),
    'printf dedicated-draft',
    'A launch failure retains the command for retry',
  )
  await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
  await page.evaluate(() => {
    window.terminalError = undefined
    window.delayTerminalResponse = true
  })
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
  await page.waitForFunction(() => !!window.finishTerminalResponse)
  const pendingSession = await page.evaluate(
    () =>
      window.computers.find((owner) => owner.profile.id === 'remote').snapshot.terminals.at(-1).id,
  )
  await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await page.evaluate(() => {
    window.delayTerminalResponse = false
    window.finishTerminalResponse()
  })
  assert.equal(
    await page.locator('[data-terminal="shell"]:visible').count(),
    1,
    'A background launch does not take over the selected terminal',
  )
  const callsBeforeResume = await page.evaluate(
    () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
  )
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click()
  await page.locator('[data-terminal="' + pendingSession + '"]:visible').waitFor()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    callsBeforeResume,
    'Returning to a completed launch opens the created shell without a duplicate',
  )
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'remote shell' })
    .click()
  await rowAction('remote shell', 'Pin')
  await rowAction('remote shell', 'Settle')
  assert.ok(
    await page
      .getByRole('complementary')
      .locator('[data-section="pinned"] .studio-thread-card')
      .filter({ hasText: 'remote shell' })
      .count(),
    'Pinned settled terminals stay in Pinned',
  )
  await page.waitForSelector('[data-terminal="shell"][data-owner="remote"]')
  await rowAction('remote shell', 'Reopen')
  await rowAction('remote shell', 'Unpin')
  await snoozeRow('remote shell')
  await page.getByRole('complementary').locator('[data-section="snoozed"] > summary').click()
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
  await page.getByRole('complementary').locator('[data-section="snoozed"]').waitFor()
  await page.clock.fastForward(31_000)
  await page
    .getByRole('complementary')
    .locator('[data-section="snoozed"]')
    .waitFor({ state: 'hidden' })
  await page
    .getByRole('complementary')
    .locator('.studio-thread-card')
    .filter({ hasText: 'remote shell' })
    .waitFor()
  assert.equal(
    await page
      .getByRole('complementary')
      .getByText(/thread terminal/)
      .count(),
    0,
    'Thread shells never appear as standalone sessions',
  )
  await page.evaluate(() => {
    window.root.render(null)
  })
  await page.getByRole('region', { name: 'Terminals workspace' }).waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    window.terminalTarget = JSON.stringify({ runtimeId: 'remote', id: 'thread-shell' })
    window.render()
  })
  await page.getByText('This terminal belongs to a thread. Open the thread to use it.').waitFor()
  assert.equal(await page.locator('[data-terminal="thread-shell"]').count(), 0)
  assert.equal(
    await page.evaluate(
      () => window.computers[1].snapshot.terminals.find((s) => s.id === 'thread-shell').exited,
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Unified workspace: sidebar navigation without horizontal tabs, pinned browser grid, retained drafts, lifecycle, remote ownership, HTTP, routing and terminal launcher passed.',
  )
} finally {
  await browser.close()
  await vite.close()
}
