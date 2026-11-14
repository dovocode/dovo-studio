import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `
    import {createContext,useContext,useState} from 'react';
export {ConfirmationContext,useConfirmation} from '${root}packages/studio-core/src/confirmation.tsx';
export {composerRecoveryKey,createComposerRecovery,composerCaretRecoveryKey} from '${root}packages/studio-core/src/workspace/composer-recovery.ts';
    import {decode,runtimeDefaultsSchema,defaultTaskHarness} from '@dovo/protocol';
    import {WorkspaceContext} from '${root}packages/studio-core/src/workspace/context.ts';
    // This navigation fixture has no active remote desktop sessions.
    export const useRuntimeSources=()=>[];
    export const WorkspaceScope=({children})=>children;
    export const useRepositorySources=()=>[];
    export {useWorkspace} from '${root}packages/studio-core/src/workspace/context.ts';
    export {updateTask} from '${root}packages/studio-core/src/workspace/actions.ts';
    const Host=createContext(null);
    export const StudioHostProvider=({api,children})=><Host.Provider value={api}>{children}</Host.Provider>;
    export const useStudioHost=()=>useContext(Host);
    export const SettingsTargetProvider=({children})=>children;
    export const useAppPreferences=()=>({interfaceLanguage:'en-US',botsOverviewEnabled:true,lastThreadId:'mac-a',showIssues:true,showJira:true,browserWorkspaceEnabled:true,browserProfiles:[]});
    export const updateAppPreferences=changes=>{(window.preferenceWrites??=[]).push(changes)};
    export const useAppPreferenceSaveError=()=>null;export const retryAppPreferences=()=>true;
    const confirmSettingsNavigation=()=>window.holdSettings ? new Promise(resolve=>window.finishSettings=resolve) : Promise.resolve(window.allowSettings);export const useConfirmSettingsNavigation=()=>confirmSettingsNavigation;
    export function WorkspaceProvider({children}) {
      const [runtimeId,setRuntimeId]=useState('mac');
      const [defaults,setDefaults]=useState(null);
      window.configureDefaults=value=>setDefaults(value===null?null:decode(runtimeDefaultsSchema,value));
      window.defaultHarness=defaultTaskHarness('codex');
      const repositories=[{id:'repo',name:'Project',path:'/project',gitIdentity:'github.com/team/project'}];const [spaces,setSpaces]=useState({mac:{repositories,tasks:[{id:'mac-a',draft:''},{id:'mac-b',draft:''},{id:'mac-bot',draft:'',bot:{role:'Assistant'}}]},remote:{repositories,tasks:[{id:'remote-a',draft:''}]}});
      const switchRuntime=async id=>{if(window.holdSwitch){window.holdSwitch=false;await new Promise(resolve=>window.finishSwitch=resolve)}setRuntimeId(id);window.finishedSwitchId=id};
      window.switchRuntime=switchRuntime;window.spaces=spaces;
      const workspace=spaces[runtimeId];
      const runtimes=Object.entries(spaces).map(([id,workspace])=>({profile:{id,name:id,connection:{address:'http://'+id+'.lan',token:'fixture-token'}},connected:true,snapshot:{workspace}}));
      const store={connection:runtimes.find(source=>source.profile.id===runtimeId).profile.connection,flush:async()=>{},workspace,ready:true,connected:true,snapshot:defaults?{defaults}:null,storageError:null,syncError:null,pendingSync:false,runtimes,
        runtimeRegistry:{activeId:runtimeId,profiles:[{id:'mac',connection:{address:'http://mac.lan',token:'fixture-token'}},{id:'remote',connection:{address:'http://remote.lan',token:'fixture-token'}}]},activeRuntimeId:runtimeId,switchRuntime,
        setWorkspace:update=>setSpaces(current=>({...current,[runtimeId]:typeof update==='function'?update(current[runtimeId]):update}))};
      return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
    }
  `,
  '@dovo/studio-ui': `export {StudioConfirmationProvider} from '${root}packages/studio-ui/src/confirmation-provider.tsx';export * from '${root}packages/studio-ui/src/sidebar-header.tsx';export * from '${root}packages/studio-ui/src/components/ui/dialog.tsx';export const Button=({children,onClick,disabled,...props})=><button onClick={onClick} disabled={disabled} aria-label={props['aria-label']}>{children}</button>;export const ErrorBoundary=({children})=>children;export const TooltipProvider=({children})=>children;export const useCompactLayout=()=>false;`,
  // Pair registration has its own browser suite; this fixture tests thread navigation.
  './studio-paired-computers-bridge': 'export const StudioPairedComputersBridge=()=>null;',
  // External-link destinations are covered by check-browser-profile-settings-browser.mjs.
  './external-browser-link-chooser': 'export const ExternalBrowserLinkChooser=()=>null;',
  // Capture permissions are covered by check-browser-media-browser.mjs.
  './browser-media-controls': 'export const BrowserMediaControls=()=>null;',
  './app-extension': 'export const appSettingsExtension={views:[]};',
  './appearance': 'export const useAppearance=()=>{};',
  './task-notifications': 'export const useTaskNotifications=open=>{window.notify=open;return {}};',
  './extension-catalog':
    'export const createExtensionCatalog=extensions=>({views:extensions.flatMap(e=>e.views),host:{dispose:async()=>{}}});',
  // Workspace mode visibility is covered by activity-bar.test.ts; this fixture keeps modes visible.
  './activity-bar':
    'export const workspaceModeVisible=()=>true;export const visibleWorkspaceTarget=target=>target;export const ActivityBar=({views,onSelect,onDetachBrowser})=><nav aria-label="Main navigation">{views.map(v=><button key={v.id} onClick={()=>onSelect(v.id)}>{v.title}</button>)}{onDetachBrowser&&<button onClick={onDetachBrowser}>Detach browser</button>}</nav>;',
  './settings-nav': 'export const SettingsNav=()=>null;',
  './title-bar': 'export const TitleBar=()=>null;',
  './command-palette':
    'export const CommandPalette=({open})=>open?<div role="dialog" aria-label="Command palette" tabIndex={0}>Palette</div>:null;',
  './task-launcher': 'export const TaskLauncher=()=>null;',
}
const built = await build({
  stdin: {
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
    contents: `
      import {useEffect,useState,useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
      import {Workbench} from '../studio-shell/src/workbench';
      import {TerminalCloseDialog} from '../extension-tasks/src/terminal/terminal-close-dialog';
      import {useStudioHost,useWorkspace} from '@dovo/studio-core';
      import {useComposerDraft} from '../extension-tasks/src/chat/composer/use-composer-draft';
      window.allowSettings=true;
      function Composer({task}){const {controller,update}=useComposerDraft(task);const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <textarea aria-label="Message" value={text} onChange={e=>update(e.target.value)}/>;}
      function PipelineAnchor(){return <a href="https://github.com/team/project/actions/runs/42" onClick={()=>{window.innerPipelineClicks=(window.innerPipelineClicks||0)+1}}>Open pipeline link</a>}
      function Pipelines({entityId,preview}){window.previewTarget=entityId;const host=useStudioHost();return <><p>{preview?'Embedded pipeline contents':'Full pipeline contents'}</p><button onClick={()=>host.goBack()}>Back from pipeline</button></>}
      function Threads({entityId}){const host=useStudioHost(),store=useWorkspace();const [closing,setClosing]=useState(false);const task=store.workspace.tasks.find(t=>t.id===entityId);return <><PipelineAnchor/><output id="selected">{task?.id||'fresh'}</output><button onClick={()=>setClosing(true)}>Close terminal tab</button>{closing&&<TerminalCloseDialog labels={['Terminal 1']} onCancel={()=>setClosing(false)} onConfirm={()=>setClosing(false)} onRestoreFocus={()=>document.querySelector('[aria-label="Message"]')?.focus()}/ >}{store.workspace.tasks.map(t=><button key={t.id} onClick={()=>host.navigate({viewId:'tasks',entityId:t.id})}>Select {t.id}</button>)}<button onClick={()=>host.openPullLink('https://github.com/team/project/pull/7/files#diff-example')}>Open linked PR</button><button onClick={()=>host.navigate({viewId:'tasks'})}>New thread</button>{task&&<Composer key={store.activeRuntimeId+task.id} task={task}/>}</>;}
      function PRs({entityId,navigationKey}){const host=useStudioHost();window.host=host;return <><PipelineAnchor/><p>PR section</p><output id="pull-target">{entityId}</output><output id="navigation-key">{navigationKey}</output><button onClick={()=>host.goBack()}>Back to origin</button><button onClick={()=>host.navigate({viewId:'tasks'})}>Explicit fresh composer</button></>;}
      function Browser(){const {registerCommand,navigate}=useStudioHost();useEffect(()=>registerCommand({id:'browser.detach',title:'Detach browser',run:()=>{window.detachCalls=(window.detachCalls||0)+1;navigate({viewId:'tasks'})}}),[registerCommand,navigate]);return <p>Embedded browser</p>;}
      function Settings(){return <p>Settings section</p>;}
      const extensions=[{views:[{id:'tasks',title:'Threads',order:0,load:async()=>({default:Threads})},{id:'bots',title:'Bots',order:5,load:async()=>({default:Threads})},{id:'browser',title:'Browser',order:4,load:async()=>({default:Browser})},{id:'pulls',title:'PRs',order:1,load:async()=>({default:PRs})},{id:'shortcuts',title:'Shortcuts',order:2,load:async()=>({default:()=> <p>Shortcuts section</p>})},{id:'pipelines',title:'Pipelines',navigationGroup:'hidden',order:10,load:async()=>({default:Pipelines})},{id:'settings',title:'Settings',navigationGroup:'settings',order:3,load:async()=>({default:Settings})}]}];
      const app=createRoot(document.getElementById('app'));window.restart=()=>app.render(<Workbench key={window.run=(window.run||0)+1} extensions={extensions} openExternalLink={async url=>{window.externalURL=url}} openBrowserWindow={async()=>{}} browser={async command=>{if(command.action!=="focus-detached-browser")return;window.browserFocusCalls=(window.browserFocusCalls||0)+1;if(window.holdBrowserFocus)await new Promise(resolve=>window.finishBrowserFocus=resolve);return window.detachedBrowser?{focusedWindowId:2}:undefined}}/>);window.restart();
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'shell-environment',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const selected = async (id) =>
    page.waitForFunction((id) => document.getElementById('selected')?.textContent === id, id)
  const section = (name) =>
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true })
      .click()
  await selected('fresh')
  for (const modifier of ['Control', 'Meta']) {
    await page.getByRole('button', { name: 'Close terminal tab' }).click()
    const dialog = page.getByRole('dialog', { name: 'Close terminal?' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).focus()
    await page.keyboard.press(`${modifier}+/`)
    await dialog.waitFor()
    assert.equal(await page.locator('#selected').textContent(), 'fresh')
    await page.keyboard.press(`${modifier}+k`)
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.keyboard.press(`${modifier}+/`)
    await page.getByText('Shortcuts section', { exact: true }).waitFor()
    await section('Threads')
    await selected('fresh')
  }
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
  await page.keyboard.press('Control+k')
  assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0)
  const setupBar = page.getByRole('button', { name: 'Set up defaults', exact: true })
  await page.evaluate(() => window.configureDefaults({}))
  await setupBar.waitFor()
  await page.evaluate(() => window.configureDefaults({ configured: true }))
  await setupBar.waitFor({ state: 'hidden' })
  // Scoped defaults are configured even when the legacy wizard flag remains false.
  await page.evaluate(() =>
    window.configureDefaults({
      configured: false,
      scopedSettings: {
        environment: { taskDefaults: { harness: window.defaultHarness } },
        shared: [],
      },
    }),
  )
  assert.equal(await setupBar.count(), 0)
  await page.evaluate(() =>
    window.configureDefaults({
      configured: false,
      scopedSettings: {
        environment: { taskDefaults: { permission: 'ask' } },
        shared: [],
      },
    }),
  )
  await setupBar.waitFor()
  await page.evaluate(() =>
    window.configureDefaults({
      configured: false,
      scopedSettings: {
        environment: {},
        shared: [
          {
            key: 'global',
            updatedAt: 1,
            changeId: 'setup',
            value: { taskDefaults: { harness: window.defaultHarness } },
          },
        ],
      },
    }),
  )
  await setupBar.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.configureDefaults(null))
  await page.getByRole('button', { name: 'Select mac-a', exact: true }).click()
  await selected('mac-a')
  await page.getByRole('textbox', { name: 'Message' }).fill('Unsent feedback')
  await section('PRs')
  await page.getByText('PR section', { exact: true }).waitFor()
  await section('Threads')
  await selected('mac-a')
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Unsent feedback')
  await section('Threads')
  await selected('mac-a')
  await section('Settings')
  await page.getByText('Settings section', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.allowSettings = false
  })
  await section('Threads')
  await page.getByText('Settings section', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.host.goBack()),
    true,
    'Canceled Back is handled and must not trigger a caller fallback',
  )
  await page.getByText('Settings section', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.notify({ runtimeId: 'remote', viewId: 'tasks', entityId: 'remote-a' }),
  )
  await page.getByText('Settings section', { exact: true }).waitFor()
  assert.notEqual(
    await page.evaluate(() => window.finishedSwitchId),
    'remote',
    'Canceled notification must not switch computers',
  )
  await page.evaluate(() => {
    window.allowSettings = true
    window.holdSettings = true
  })
  await section('PRs')
  await page.waitForFunction(() => !!window.finishSettings)
  await page.evaluate(() => (window.holdSettings = false))
  await section('Shortcuts')
  await page.getByText('Shortcuts section', { exact: true }).waitFor()
  await page.evaluate(() => window.finishSettings(true))
  await page.getByText('Shortcuts section', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('PR section', { exact: true }).count(),
    0,
    'An older accepted decision must preserve newer navigation',
  )
  await section('Threads')
  await selected('mac-a')
  await section('PRs')
  await page.evaluate(() =>
    window.notify({ runtimeId: 'remote', viewId: 'tasks', entityId: 'remote-a' }),
  )
  await selected('remote-a')
  await section('PRs')
  await page.evaluate(() => window.switchRuntime('mac'))
  await section('Threads')
  await selected('mac-a')
  await section('PRs')
  await page.evaluate(() => window.switchRuntime('remote'))
  await section('Threads')
  await selected('remote-a')
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  await selected('fresh')
  await section('PRs')
  await section('Threads')
  await selected('fresh')
  await page.getByRole('button', { name: 'Select remote-a', exact: true }).click()
  await section('PRs')
  await page.getByRole('button', { name: 'Explicit fresh composer', exact: true }).click()
  await selected('fresh')
  assert.equal(await page.locator('.studio.dark').count(), 0, 'Appearance controls dark variants')
  await page.getByRole('button', { name: 'Select remote-a', exact: true }).click()
  await page.getByRole('button', { name: 'Open linked PR', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.getElementById('pull-target')?.textContent ===
      'https://github.com/team/project/pull/7/files#diff-example',
  )
  const key = await page.locator('#navigation-key').innerText()
  await page.evaluate(() =>
    window.host.openPullLink('https://github.com/team/project/pull/7/files#diff-example'),
  )
  await page.waitForFunction(
    (key) => document.getElementById('navigation-key')?.textContent !== key,
    key,
  )
  await page.getByRole('button', { name: 'Back to origin', exact: true }).click()
  await selected('remote-a')
  await page.getByRole('button', { name: 'Open linked PR', exact: true }).click()
  await page.getByText('PR section', { exact: true }).waitFor()
  await page.keyboard.press('Alt+ArrowLeft')
  await selected('remote-a')
  await page.getByRole('button', { name: 'Open linked PR', exact: true }).click()
  await page.getByText('PR section', { exact: true }).waitFor()
  await page.evaluate(async () => {
    await window.switchRuntime('mac')
    window.holdSwitch = true
  })
  await page.getByRole('button', { name: 'Back to origin', exact: true }).click()
  await section('Settings')
  await page.getByText('Settings section', { exact: true }).waitFor()
  await page.evaluate(() => window.finishSwitch())
  await page.waitForFunction(() => window.finishedSwitchId === 'remote')
  await page.getByText('Settings section', { exact: true }).waitFor()
  assert.equal(await page.locator('#selected').count(), 0, 'a late Back replaced newer navigation')
  await page.evaluate(() => {
    window.holdSwitch = true
    window.notify({ runtimeId: 'mac', viewId: 'tasks', entityId: 'mac-b' })
  })
  await section('PRs')
  await page.getByText('PR section', { exact: true }).waitFor()
  await page.evaluate(() => window.finishSwitch())
  await page.waitForFunction(() => window.finishedSwitchId === 'mac')
  await page.getByText('PR section', { exact: true }).waitFor()
  assert.equal(
    await page.locator('#selected').count(),
    0,
    'a late notification replaced newer navigation',
  )
  await page.evaluate(() => window.restart())
  await selected('fresh')
  await page.evaluate(() => {
    window.detachedBrowser = true
  })
  await section('Browser')
  await page.waitForFunction(() => window.browserFocusCalls > 0)
  await selected('fresh')
  assert.equal(
    await page.getByText('Embedded browser', { exact: true }).count(),
    0,
    'Detached focus preserves the Threads view',
  )
  await page.evaluate(() => {
    window.detachedBrowser = false
  })
  await section('Browser')
  await page.getByText('Embedded browser', { exact: true }).waitFor()
  await section('Threads')
  await selected('fresh')
  await page.evaluate(() => {
    window.holdBrowserFocus = true
  })
  await section('Browser')
  await page.waitForFunction(() => typeof window.finishBrowserFocus === 'function')
  await section('PRs')
  await page.evaluate(() => {
    window.holdBrowserFocus = false
    window.finishBrowserFocus()
  })
  await page.getByText('PR section', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('Embedded browser', { exact: true }).count(),
    0,
    'Late browser response preserves newer navigation',
  )
  // Detach requests from another section wait for the browser's command to mount.
  await page.getByRole('button', { name: 'Detach browser', exact: true }).click()
  await page.waitForFunction(() => window.detachCalls === 1)
  await selected('fresh')
  await section('Settings')
  await page.getByText('Settings section', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.allowSettings = false
  })
  await page.getByRole('button', { name: 'Detach browser', exact: true }).click()
  await page.getByText('Settings section', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.allowSettings = true
  })
  await section('Browser')
  await page.getByText('Embedded browser', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.detachCalls),
    1,
    'Cancelled navigation must not detach later',
  )
  await section('Threads')
  await page.getByRole('button', { name: 'Select mac-a', exact: true }).click()
  await selected('mac-a')
  await page.getByRole('textbox', { name: 'Message' }).fill('Draft kept behind pipeline preview')
  await page.getByRole('link', { name: 'Open pipeline link', exact: true }).click()
  const pipelineDialog = page.getByRole('dialog', { name: 'Pipeline preview', exact: true })
  await pipelineDialog.getByText('Embedded pipeline contents', { exact: true }).waitFor()
  assert.equal(await page.locator('#selected').textContent(), 'mac-a')
  assert.equal(await page.getByRole('dialog', { name: 'Open link', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.innerPipelineClicks ?? 0), 0)
  await pipelineDialog.getByRole('link', { name: 'Open URL', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.externalURL),
    'https://github.com/team/project/actions/runs/42',
  )
  await page.keyboard.press('Escape')
  await pipelineDialog.waitFor({ state: 'hidden' })
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Draft kept behind pipeline preview',
  )
  await page.getByRole('link', { name: 'Open pipeline link', exact: true }).click()
  await pipelineDialog.getByRole('button', { name: 'Open details', exact: true }).click()
  await page.getByText('Full pipeline contents', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back from pipeline', exact: true }).click()
  await selected('mac-a')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Draft kept behind pipeline preview',
  )
  await section('PRs')
  await page.getByRole('link', { name: 'Open pipeline link', exact: true }).click()
  await pipelineDialog.getByText('Embedded pipeline contents', { exact: true }).waitFor()
  assert.equal(await page.getByText('PR section', { exact: true }).count(), 1)
  await page.keyboard.press('Escape')
  await pipelineDialog.waitFor({ state: 'hidden' })
  await section('Threads')
  await page.getByRole('button', { name: 'Select mac-bot', exact: true }).click()
  await selected('mac-bot')
  await section('PRs')
  await section('Bots')
  await selected('mac-bot')
  await page.getByRole('textbox', { name: 'Message' }).fill('Bot draft kept')
  await section('Settings')
  await section('Bots')
  await selected('mac-bot')
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Bot draft kept')
  assert.deepEqual(errors, [])
  assert.equal(
    await page.evaluate(
      () => (window.preferenceWrites ?? []).filter((changes) => 'lastThreadId' in changes).length,
    ),
    0,
    'Thread navigation must not synchronously rewrite unused preferences',
  )
  console.log(
    'Actual workbench navigation restores thread and real composer drafts across sections, keeps computer selections separate, respects settings cancellation and preserves fresh startup/New thread.',
  )
} finally {
  await browser.close()
}
