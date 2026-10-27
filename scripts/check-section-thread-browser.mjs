import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `
    import {createContext,useContext,useState} from 'react';
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
    export const useAppPreferences=()=>({lastThreadId:'mac-a',showIssues:true,showJira:true});
    export const updateAppPreferences=()=>{};
    export const useConfirmSettingsNavigation=()=>()=>window.allowSettings;
    export function WorkspaceProvider({children}) {
      const [runtimeId,setRuntimeId]=useState('mac');
      const [defaults,setDefaults]=useState(null);
      window.configureDefaults=value=>setDefaults(value===null?null:decode(runtimeDefaultsSchema,value));
      window.defaultHarness=defaultTaskHarness('codex');
      const [spaces,setSpaces]=useState({mac:{tasks:[{id:'mac-a',draft:''},{id:'mac-b',draft:''}]},remote:{tasks:[{id:'remote-a',draft:''}]}});
      const switchRuntime=async id=>{if(window.holdSwitch){window.holdSwitch=false;await new Promise(resolve=>window.finishSwitch=resolve)}setRuntimeId(id);window.finishedSwitchId=id};
      window.switchRuntime=switchRuntime;window.spaces=spaces;
      const workspace=spaces[runtimeId];
      const runtimes=Object.entries(spaces).map(([id,workspace])=>({profile:{id,name:id,connection:{address:'http://'+id+'.lan',token:'fixture-token'}},connected:true,snapshot:{workspace}}));
      const store={workspace,ready:true,connected:true,snapshot:defaults?{defaults}:null,storageError:null,syncError:null,pendingSync:false,runtimes,
        runtimeRegistry:{activeId:runtimeId,profiles:[{id:'mac',connection:{address:'http://mac.lan',token:'fixture-token'}},{id:'remote',connection:{address:'http://remote.lan',token:'fixture-token'}}]},activeRuntimeId:runtimeId,switchRuntime,
        setWorkspace:update=>setSpaces(current=>({...current,[runtimeId]:typeof update==='function'?update(current[runtimeId]):update}))};
      return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
    }
  `,
  '@dovo/studio-ui': `export * from '${root}packages/studio-ui/src/sidebar-header.tsx';export * from '${root}packages/studio-ui/src/components/ui/dialog.tsx';export const Button=({children,onClick,disabled,...props})=><button onClick={onClick} disabled={disabled} aria-label={props['aria-label']}>{children}</button>;export const ErrorBoundary=({children})=>children;export const TooltipProvider=({children})=>children;export const useCompactLayout=()=>false;`,
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
  './activity-bar':
    'export const ActivityBar=({views,onSelect})=><nav aria-label="Main navigation">{views.map(v=><button key={v.id} onClick={()=>onSelect(v.id)}>{v.title}</button>)}</nav>;',
  './settings-nav': 'export const SettingsNav=()=>null;',
  './title-bar': 'export const TitleBar=()=>null;',
  './command-palette': 'export const CommandPalette=()=>null;',
  './task-launcher': 'export const TaskLauncher=()=>null;',
}
const built = await build({
  stdin: {
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
    contents: `
      import {useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
      import {Workbench} from '../studio-shell/src/workbench';
      import {useStudioHost,useWorkspace} from '@dovo/studio-core';
      import {useComposerDraft} from '../extension-tasks/src/chat/composer/use-composer-draft';
      window.allowSettings=true;
      function Composer({task}){const {controller,update}=useComposerDraft(task);const text=useSyncExternalStore(controller.subscribe,()=>controller.text);return <textarea aria-label="Message" value={text} onChange={e=>update(e.target.value)}/>;}
      function Threads({entityId}){const host=useStudioHost(),store=useWorkspace();const task=store.workspace.tasks.find(t=>t.id===entityId);return <><output id="selected">{task?.id||'fresh'}</output>{store.workspace.tasks.map(t=><button key={t.id} onClick={()=>host.navigate({viewId:'tasks',entityId:t.id})}>Select {t.id}</button>)}<button onClick={()=>host.openPullLink('https://github.com/team/project/pull/7/files#diff-example')}>Open linked PR</button><button onClick={()=>host.navigate({viewId:'tasks'})}>New thread</button>{task&&<Composer key={store.activeRuntimeId+task.id} task={task}/>}</>;}
      function PRs({entityId,navigationKey}){const host=useStudioHost();window.host=host;return <><p>PR section</p><output id="pull-target">{entityId}</output><output id="navigation-key">{navigationKey}</output><button onClick={()=>host.goBack()}>Back to origin</button><button onClick={()=>host.navigate({viewId:'tasks'})}>Explicit fresh composer</button></>;}
      function Settings(){return <p>Settings section</p>;}
      const extensions=[{views:[{id:'tasks',title:'Threads',order:0,load:async()=>({default:Threads})},{id:'pulls',title:'PRs',order:1,load:async()=>({default:PRs})},{id:'settings',title:'Settings',navigationGroup:'settings',order:2,load:async()=>({default:Settings})}]}];
      const app=createRoot(document.getElementById('app'));window.restart=()=>app.render(<Workbench key={window.run=(window.run||0)+1} extensions={extensions}/>);window.restart();
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const selected = async (id) =>
    page.waitForFunction((id) => document.getElementById('selected')?.textContent === id, id)
  const section = (name) =>
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true })
      .click()
  await selected('fresh')
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
  await page.evaluate(() => {
    window.allowSettings = true
  })
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
  assert.deepEqual(errors, [])
  console.log(
    'Actual workbench navigation restores thread and real composer drafts across sections, keeps computer selections separate, respects settings cancellation and preserves fresh startup/New thread.',
  )
} finally {
  await browser.close()
}
