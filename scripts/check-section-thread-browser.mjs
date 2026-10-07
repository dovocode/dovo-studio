import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `
    import {createContext,useContext,useState} from 'react';
    import {WorkspaceContext} from '${root}packages/studio-core/src/workspace/context.ts';
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
      const [spaces,setSpaces]=useState({mac:{tasks:[{id:'mac-a',draft:''},{id:'mac-b',draft:''}]},remote:{tasks:[{id:'remote-a',draft:''}]}});
      const switchRuntime=async id=>setRuntimeId(id);
      window.switchRuntime=switchRuntime;window.spaces=spaces;
      const workspace=spaces[runtimeId];
      const store={workspace,ready:true,connected:true,snapshot:null,storageError:null,syncError:null,pendingSync:false,runtimes:[],
        runtimeRegistry:{activeId:runtimeId,profiles:[{id:'mac'},{id:'remote'}]},activeRuntimeId:runtimeId,switchRuntime,
        setWorkspace:update=>setSpaces(current=>({...current,[runtimeId]:typeof update==='function'?update(current[runtimeId]):update}))};
      return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
    }
  `,
  '@dovo/studio-ui': `export const Button=({children,onClick,disabled,...props})=><button onClick={onClick} disabled={disabled} aria-label={props['aria-label']}>{children}</button>;export const ErrorBoundary=({children})=>children;export const TooltipProvider=({children})=>children;export const useCompactLayout=()=>false;`,
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
      function Threads({entityId}){const host=useStudioHost(),store=useWorkspace();const task=store.workspace.tasks.find(t=>t.id===entityId);return <><output id="selected">{task?.id||'fresh'}</output>{store.workspace.tasks.map(t=><button key={t.id} onClick={()=>host.navigate({viewId:'tasks',entityId:t.id})}>Select {t.id}</button>)}<button onClick={()=>host.navigate({viewId:'tasks'})}>New thread</button>{task&&<Composer key={store.activeRuntimeId+task.id} task={task}/>}</>;}
      function PRs(){const host=useStudioHost();return <><p>PR section</p><button onClick={()=>host.navigate({viewId:'tasks'})}>Explicit fresh composer</button></>;}
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
  alias: { '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts' },
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
  await page.evaluate(() => window.restart())
  await selected('fresh')
  assert.deepEqual(errors, [])
  console.log(
    'Actual workbench navigation restores thread and real composer drafts across sections, keeps computer selections separate, respects settings cancellation and preserves fresh startup/New thread.',
  )
} finally {
  await browser.close()
}
