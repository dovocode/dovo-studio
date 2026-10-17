import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const core = `
import {createContext,useContext,useState,useCallback} from 'react';
export * from '@dovo/protocol';export * from '@dovo/client-runtime';
const Store=createContext(null),Host=createContext(null);
export const useWorkspace=()=>useContext(Store);export const useStudioHost=()=>useContext(Host);
export const StudioHostProvider=({api,children})=>{window.host=api;return <Host.Provider value={api}>{children}</Host.Provider>};
export const SettingsTargetProvider=({children})=>children;
export const useAppPreferences=()=>({showIssues:true,showJira:true});export const updateAppPreferences=()=>{};
export const useConfirmSettingsNavigation=()=>()=>true;export const repositorySourceKey=(r,p)=>JSON.stringify([r,p]);
export const useRepositorySources=()=>{useWorkspace();return window.sources};
export function WorkspaceProvider({children}) {
 const [active,setActive]=useState('a'),[revision,update]=useState(0);
 const switchRuntime=useCallback(async id=>{window.switches.push(id);setActive(id)},[]);
 window.switchRuntime=switchRuntime;window.update=()=>update(v=>v+1);
 const value={activeRuntimeId:active,workspace:window.spaces[active],runtimeRegistry:{activeId:active,profiles:window.profiles},runtimes:window.profiles.map(profile=>({profile,connected:window.sources.some(s=>s.runtimeId===profile.id&&s.connected),snapshot:{workspace:window.spaces[profile.id]}})),ready:true,connected:true,snapshot:null,switchRuntime,request:window.request};window.active=active;
 return <Store.Provider value={value}>{children}</Store.Provider>;
}
export const WorkspaceRuntimeScope=({runtimeId,children})=>{const global=useWorkspace();const connected=window.sources.some(s=>s.runtimeId===runtimeId&&s.connected);return <Store.Provider value={{...global,activeRuntimeId:runtimeId,workspace:window.spaces[runtimeId],connected}}><section data-owner={runtimeId}>{children}</section></Store.Provider>};
export const formatDateTime=v=>v;
`
const ui = `
export * from '${root}packages/studio-ui/src/sidebar-header.tsx';
export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as ContextMenu from '@radix-ui/react-context-menu';
export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;
export const Input=props=><input {...props}/>;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;
export const Badge=({children})=><span>{children}</span>;export const PageHeader=({title,children})=><header><h1>{title}</h1>{children}</header>;
export const Dialog=({open,children})=>open===false?null:<div role="dialog">{children}</div>;export const DialogContent=({children})=><div>{children}</div>;export const DialogHeader=DialogContent;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;
export const TooltipProvider=({children})=>children;export const ErrorBoundary=({children})=>children;export const useCompactLayout=()=>false;
`
const stubs = [
  { path: '@dovo/studio-core', contents: core },
  { path: '@dovo/studio-ui', contents: ui },
  ...Object.entries({
    // Pair registration is covered by check-studio-tools-browser; this fixture tests navigation.
    './studio-paired-computers-bridge': 'export const StudioPairedComputersBridge=()=>null;',
    './app-extension': 'export const appSettingsExtension={views:[]};',
    './appearance': 'export const useAppearance=()=>{};',
    './task-notifications': 'export const useTaskNotifications=()=>({});',
    './extension-catalog':
      'export const createExtensionCatalog=extensions=>({views:extensions.flatMap(e=>e.views),host:{dispose:async()=>{}}});',
    './activity-bar':
      'export const ActivityBar=({views,onSelect})=><nav aria-label="Main navigation">{views.map(v=><button key={v.id} onClick={()=>onSelect(v.id)}>{v.title}</button>)}</nav>;',
    './settings-nav': 'export const SettingsNav=()=>null;',
    './title-bar': 'export const TitleBar=()=>null;',
    './command-palette': 'export const CommandPalette=()=>null;',
    './task-launcher': 'export const TaskLauncher=()=>null;',
  }).map(([path, contents]) => ({ path, contents, importer: root + 'packages/studio-shell/src/' })),
  {
    path: './use-pulls',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents:
      'import {useWorkspace} from "@dovo/studio-core";export const usePulls=()=>{useWorkspace();return {sources:window.sources,pages:window.sources.filter(s=>s.pull).map(source=>({source,reader:source,pulls:[source.pull]})),busy:false,connected:true,more:()=>{},refresh:()=>{}}};',
  },
  {
    path: '../detail/detail',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents: `import {useWorkspace} from '@dovo/studio-core';import {StartPullTask} from '${root}packages/extension-scm/src/pulls/list/start-task.tsx';export const PullDetail=({repositoryId,number,initialTab,initialFragment,onBack,onTabChange})=>{const store=useWorkspace();const source=window.sources.find(s=>s.runtimeId===store.activeRuntimeId&&s.repository.id===repositoryId);return <div aria-label="PR detail" data-tab={initialTab} data-fragment={initialFragment}><p>Detail {store.activeRuntimeId} {repositoryId} #{number}</p><p>{store.connected?'Online':'Offline'}</p><button onClick={onBack}>Back to PRs</button><button onClick={()=>onTabChange?.("checks")}>PR checks</button><StartPullTask repositoryId={repositoryId} pull={{...source?.pull,number,headSha:'same-sha',destination:'dest-'+store.activeRuntimeId}}/></div>};`,
  },
  {
    path: '../detail/status',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents: 'export const Signal=()=>null;',
  },
  {
    path: './create',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents: 'export const CreatePull=()=>null;',
  },
  {
    path: './add-to-thread',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents: 'export const AddPullsToThread=()=>null;',
  },
  {
    path: '../../connections/forge-connections',
    importer: root + 'packages/extension-scm/src/pulls/list/',
    contents:
      'export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[]});',
  },
  {
    path: './work-sources',
    importer: root + 'packages/extension-scm/src/work/',
    contents: `import {useWorkspace} from '@dovo/studio-core';export {workRemoteKey,matchesWorkSource} from '${root}packages/extension-scm/src/work/work-source-identity.ts';export const jiraSourceKey=(r,p)=>JSON.stringify([r,'jira',p]);export const useIssueSources=()=>{useWorkspace();return window.workSources};`,
  },
  {
    path: './use-work-sources',
    importer: root + 'packages/extension-scm/src/work/',
    contents:
      'export const useWorkSources=()=>({sources:window.workSources,pages:[],busy:false,refresh:()=>{},more:async()=>{}});',
  },
  {
    path: './content',
    importer: root + 'packages/extension-scm/src/work/',
    contents:
      'export const WorkContent=({initialSelected,mode,onBack})=><div><p>{mode} {initialSelected}</p><button onClick={onBack}>Back to source</button></div>;',
  },
  {
    path: './work-form',
    importer: root + 'packages/extension-scm/src/work/',
    contents: 'export const WorkForm=()=>null;',
  },
  {
    path: './pipeline-detail',
    importer: root + 'packages/extension-scm/src/work/',
    contents: 'export const PipelineState=()=>null;',
  },
  {
    path: './jira-toolbar',
    importer: root + 'packages/extension-scm/src/work/',
    contents: 'export const JiraToolbar=()=>null;',
  },
  {
    path: './jira-issue-list',
    importer: root + 'packages/extension-scm/src/work/',
    contents:
      'export const JiraIssueList=()=>null;export const jiraIssueRowKey=(s,id)=>JSON.stringify([s.key,id]);',
  },
  {
    path: '../connections/jira-binding',
    importer: root + 'packages/extension-scm/src/work/',
    contents: 'export const JiraSourcesDialog=()=>null;',
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {Workbench} from '${root}packages/studio-shell/src/workbench.tsx';
import PRs from '${root}packages/extension-scm/src/pulls/list/view.tsx';import Issues,{JiraView,PipelinesView} from '${root}packages/extension-scm/src/work/work-view.tsx';import {useStudioHost,useWorkspace} from '@dovo/studio-core';
window.switches=[];window.requests=[];window.profiles=['a','b'].map(id=>({id,name:id.toUpperCase(),connection:{address:'http://'+id,token:'paired-'+id}}));
const make=(runtimeId,id,identity,url)=>({key:JSON.stringify([runtimeId,id]),scope:runtimeId+id,runtimeId,runtimeName:runtimeId.toUpperCase(),connected:true,profile:window.profiles.find(p=>p.id===runtimeId),repository:{id,name:id,path:'/'+id,gitIdentity:id==='upstream'?'github.com/fork/project':identity,pullIdentity:identity,forge:{connectionId:'account-'+runtimeId,repository:identity.split('/').slice(1).join('/')}},pull:{number:7,title:'Keep '+id,url,state:'open',draft:false,author:'Dominic',head:'feature',base:'main',updatedAt:'2026-10-14',labels:[],headCloneUrl:'http://clone',headSha:'same-sha'}});
window.sources=[make('a','upstream','github.com/team/project','https://github.com/team/project/pull/7'),make('b','mirror','github.com/team/project','https://github.com/team/project/pull/7'),make('b','fork','github.com/fork/project','https://github.com/fork/project/pull/7'),make('a','forge','forge.local/team/project','http://forge.local/team/project/pulls/7'),make('a','gitlab','gitlab.local/group/subgroup/project','http://gitlab.local/group/subgroup/project/-/merge_requests/7'),make('a','enterprise','ghe.local/team/project','http://ghe.local/team/project/pull/7')];
window.spaces=Object.fromEntries(['a','b'].map(id=>[id,{repositories:window.sources.filter(s=>s.runtimeId===id).map(s=>s.repository),tasks:[{id:'thread-'+id,repositoryId:id==='a'?'upstream':'mirror'}],jiraSources:[]} ]));
window.workSources=window.sources.map(s=>({...s,name:s.repository.name,input:{repositoryId:s.repository.id}}));window.workSources.push({key:JSON.stringify(['a','jira','tracker']),scope:'tracker',runtimeId:'a',runtimeName:'A',name:'Jira',connected:true,jira:{id:'tracker',site:'https://jira.local',project:'TEAM'},input:{jiraSourceId:'tracker'}});
window.request=async(path,input)=>{window.requests.push({path,input});return await new Promise(resolve=>window.resolveTask=resolve)};
function Tasks({entityId}){const host=useStudioHost(),store=useWorkspace();return <div><output id="task">{entityId??'fresh'}</output><button onClick={()=>host.navigate({viewId:'tasks',entityId:'thread-'+store.activeRuntimeId})}>Select thread</button><button onClick={()=>host.openPullLink('https://github.com/team/project/pull/7/files#comment')}>Open linked PR</button>{['issues','jira','pipelines'].map(view=><button key={view} onClick={()=>host.navigate({viewId:view,entityId:JSON.stringify({runtimeId:'a',...(view==='jira'?{jiraSourceId:'tracker'}:{repositoryId:'upstream'}),id:view==='jira'?'TEAM-7':'7',url:'http://source/'+view})})}>Open {view}</button>)}</div>}
const extensions=[{views:[{id:'tasks',title:'Tasks',load:async()=>({default:Tasks})},{id:'pulls',title:'PRs',load:async()=>({default:PRs})},{id:'issues',title:'Issues',load:async()=>({default:Issues})},{id:'jira',title:'Jira',load:async()=>({default:JiraView})},{id:'pipelines',title:'Pipelines',load:async()=>({default:PipelinesView})}]}];
createRoot(document.getElementById('app')).render(<Workbench extensions={extensions}/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  stubs,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const task = async (id) =>
    page.waitForFunction((id) => document.querySelector('#task')?.textContent === id, id)
  const section = (title) =>
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: title, exact: true })
      .click()
  await task('fresh')
  await page.getByRole('button', { name: 'Select thread', exact: true }).click()
  await task('thread-a')
  await section('PRs')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search pull requests' }).fill('Keep')
  await page.evaluate(() => window.switchRuntime('b'))
  assert.equal(
    await page.getByRole('textbox', { name: 'Search pull requests' }).inputValue(),
    'Keep',
  )
  await page
    .getByRole('button', { name: /Keep upstream/ })
    .first()
    .click()
  await page.getByText('Detail a upstream #7', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.active), 'b')
  await page.evaluate(() => window.host.navigate({ viewId: 'tasks', entityId: 'thread-b' }))
  await task('thread-b')
  await page.evaluate(() => window.host.goBack())
  await page.getByText('Detail a upstream #7', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Search pull requests' }).inputValue(),
    'Keep',
  )
  await page.evaluate(() => {
    window.originalUpstream = window.sources[0]
    window.host.navigate({ viewId: 'tasks', entityId: 'thread-b' })
    window.sources = window.sources.map((s) =>
      s.repository.id === 'upstream'
        ? {
            ...s,
            scope: s.scope + 'rebound',
            repository: { ...s.repository, pullIdentity: 'github.com/other/project' },
          }
        : s,
    )
    window.update()
  })
  await task('thread-b')
  await page.evaluate(() => window.host.goBack())
  await page.getByRole('alert').filter({ hasText: 'another PR repository' }).waitFor()
  assert.equal(
    await page.getByText('Detail a upstream #7', { exact: true }).count(),
    0,
    'History cannot reopen the same PR number in a rebound repository',
  )
  await page.evaluate(() => {
    window.sources = window.sources.map((s) =>
      s.repository.id === 'upstream' ? window.originalUpstream : s,
    )
    window.update()
  })
  await page.getByText('Detail a upstream #7', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.sources = window.sources.map((s) =>
      s.runtimeId === 'a' ? { ...s, connected: false } : s,
    )
    window.update()
  })
  await page.getByText('Offline', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.active), 'b')
  await page.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search pull requests' }).waitFor()
  await page.evaluate(() => {
    window.sources = window.sources.map((s) => ({ ...s, connected: true }))
    window.update()
    window.host.navigate({ viewId: 'tasks', entityId: 'thread-b' })
  })
  await task('thread-b')
  await page.getByRole('button', { name: 'Open linked PR', exact: true }).click()
  await page.getByText('Detail b mirror #7', { exact: true }).waitFor()
  assert.equal(await page.locator('[aria-label="PR detail"]').getAttribute('data-tab'), 'changes')
  await page.evaluate(() =>
    window.host.navigate({
      viewId: 'pulls',
      entityId: 'https://github.com/fork/project/pull/7',
      pullTarget: {
        runtimeId: 'b',
        repositoryId: 'fork',
        number: 7,
        url: 'https://github.com/fork/project/pull/7',
      },
    }),
  )
  await page.getByText('Detail b fork #7', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await page.getByText('Detail b mirror #7', { exact: true }).waitFor()
  assert.equal(
    await page.locator('[aria-label="PR detail"]').getAttribute('data-fragment'),
    '#comment',
  )
  await page.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await task('thread-b')
  for (const kind of ['issues', 'jira', 'pipelines']) {
    await page.getByRole('button', { name: 'Open ' + kind, exact: true }).click()
    await page.getByRole('button', { name: 'Back to source', exact: true }).click()
    await task('thread-b')
  }
  for (const url of [
    'http://forge.local/team/project/pulls/7',
    'http://gitlab.local/group/subgroup/project/-/merge_requests/7',
    'http://ghe.local/team/project/pull/7',
  ]) {
    await page.evaluate((url) => window.host.openPullLink(url), url)
    await page.locator('[aria-label="PR detail"]').waitFor()
    await page.getByRole('button', { name: 'Back to PRs', exact: true }).click()
    await task('thread-b')
  }
  await page.evaluate(() =>
    window.host.navigate({
      viewId: 'pulls',
      entityId: 'https://github.com/team/project/pull/7',
      pullTarget: {
        runtimeId: 'a',
        repositoryId: 'upstream',
        number: 7,
        url: 'https://github.com/team/project/pull/7',
      },
    }),
  )
  await page.getByText('Detail a upstream #7', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.host.navigate({
      viewId: 'pulls',
      entityId: 'https://github.com/unlinked/project/pull/7',
      pullTarget: {
        runtimeId: 'b',
        number: 7,
        url: 'https://github.com/unlinked/project/pull/7',
        tab: 'changes',
      },
    }),
  )
  await page
    .getByText('Detail b https://github.com/unlinked/project/pull/7 #7', { exact: true })
    .waitFor()
  assert.equal(await page.locator('[aria-label="PR detail"]').getAttribute('data-tab'), 'changes')
  await page.getByRole('button', { name: 'PR checks', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="PR detail"]')?.dataset.tab === 'checks',
  )
  assert.equal(await page.locator('[aria-label="PR detail"]').getAttribute('data-tab'), 'checks')
  await page.evaluate(() => window.host.navigate({ viewId: 'tasks', entityId: 'thread-b' }))
  await task('thread-b')
  await page.evaluate(() => window.host.goBack())
  await page
    .getByText('Detail b https://github.com/unlinked/project/pull/7 #7', { exact: true })
    .waitFor()
  assert.equal(
    await page.locator('[aria-label="PR detail"]').getAttribute('data-tab'),
    'checks',
    'URL-only history retains the selected tab',
  )
  await page.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await page.getByText('Detail a upstream #7', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New branch from PR', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 1)
  assert.equal(await page.evaluate(() => window.requests[0].input.expectedDestination), 'dest-a')
  await page.evaluate(() => window.host.navigate({ viewId: 'tasks', entityId: 'thread-b' }))
  await task('thread-b')
  await page.evaluate(() => window.resolveTask({ id: 'created-on-a' }))
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await task('thread-b')
  assert.equal(await page.evaluate(() => window.active), 'b')
  assert.deepEqual(await page.evaluate(() => window.switches), ['b'])
  assert.deepEqual(errors, [])
  console.log(
    'Desktop workbench: merged filters, pinned PR history/accounts, fork/upstream IDs, disconnected owner, Forgejo/GitLab routes, issue/Jira/pipeline Back and late creation guards passed.',
  )
} finally {
  await browser.close()
}
