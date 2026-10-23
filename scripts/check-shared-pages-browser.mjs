import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export {useAccount} from '${root}/packages/studio-core/src/use-account';export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useRepositorySources=()=>[];export const repositorySourceKey=(a,b)=>a+b;export const useWorkspace=()=>window.store;export const useStudioHost=()=>({appInfo:{version:'0.0.9',channel:'nightly'},windowPlatform:window.platform,navigate:()=>{}});export const useAppPreferences=()=>({showIssues:true,showJira:true});export const updateAppPreferences=()=>{};export const formatDateTime=value=>String(value);export const WorkspaceScope=({children})=>children;`,
  '@dovo/studio-ui': `export {PageHeader} from '${ui}/page-header';export * from '${ui}/sidebar-header';export {Button} from '${ui}/components/ui/button';export {Input} from '${ui}/components/ui/input';export * from '${ui}/components/ui/dialog';export {ChoicePicker} from '${ui}/choice-picker';export {cn} from '${ui}/lib/utils';export {IconButton} from '${ui}/components/icon-button';export {EmptyState} from '${ui}/components/empty-state';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as Popover from '@radix-ui/react-popover';export const useCompactLayout=()=>innerWidth<1024;`,
  './work-sources': `export const workRemoteKey=source=>source.jira?JSON.stringify(['jira',new URL(source.jira.site).origin,source.jira.project]):source.key;export const matchesWorkSource=(source,key)=>!key||source.key===key||workRemoteKey(source)===key;export const jiraSourceKey=(a,b)=>a+b;export const useIssueSources=()=>window.sources;`,
  './use-work-sources': `export const useWorkSources=(mode,query,kind)=>({sources:[{...window.source,reader:window.source}],pages:[{source:window.source,reader:window.source,items:mode==='issues'?window.issues:[window.pipeline.run],options:{issues:true,pipelines:true,pipelineActions:[]}}],busy:false,refresh:()=>{},more:async()=>{}});`,
  '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
  '../connections/source-picker': `export const SourcePicker=()=>null;`,
  './work-form': `export const WorkForm=()=>null;`,
  './work-task-links': `export const WorkTaskLinks=()=>null;`,
  './issue-detail': `export const IssueDetail=({detail})=><p>{detail.issue.body}</p>;`,
  './job-controls': `export const JobControls=()=>null;`,
  './automation-canvas': `export const AutomationCanvas=()=>null;`,
  './node-inspector': `export const NodeInspector=()=>null;`,
  './use-automation': `export const useAutomation=id=>({workspace:window.store.workspace,flow:window.flow,drafts:new Map(),messages:[],setMessages:()=>{},update:()=>{}});`,
  './use-job-actions': `export const useJobActions=()=>({});`,
  './run-details': `export const StepStatus=()=>null;export const RunDetails=()=>null;`,
  './chat/artifact-snapshot': `export const ArtifactSnapshot=()=>null;`,
  './chat/artifact-library-actions': `export const ArtifactLibraryActions=()=>null;`,
  './chat/artifacts': `export const ArtifactBrowser=()=>null;`,
  './chat/artifact-presentation': `export const ArtifactIcon=()=>null;`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {TooltipProvider} from '@radix-ui/react-tooltip';import {useState} from 'react';import {Effect} from 'effect';import {SidebarHeaderLayout,HeaderFallback,HeaderMainSlot} from '${ui}/sidebar-header';import {PageHeader} from '${ui}/page-header';
import IssuesView,{JiraView,PipelinesView} from '${root}/packages/extension-scm/src/work/work-view';import {WorkContent} from '${root}/packages/extension-scm/src/work/content';import JobsView from '${root}/packages/extension-jobs/src/view';import ArtifactsView from '${root}/packages/extension-tasks/src/artifacts-view';
window.platform='darwin';window.flow={id:'flow',name:'Nightly automation',nodes:[],edges:[],triggers:[]};
const repo={id:'repo',name:'Dovo Studio',path:'/studio',branch:'main'};const profile={id:'mac',name:'MacBook',connection:{address:'http://mac.local',token:'paired'}};
window.issues=[{id:'1',title:'Fix reconnection',body:'Preserve the runtime session',state:'open',url:'https://github.com/o/r/issues/1',labels:[],assignees:[],author:'Dominic',updatedAt:''}];
window.source={key:'source',scope:'source',name:'Dovo Studio',runtimeId:'mac',runtimeName:'MacBook',connected:true,repository:repo,input:{repositoryId:'repo'},jira:{id:'jira',site:'https://team.atlassian.net',project:'STUDIO'}};
window.pipeline={run:{id:'42',title:'Release',url:'https://github.com/o/r/actions/runs/42',ref:'main',sha:'a'.repeat(40),actor:'Dominic',status:'in_progress',createdAt:'2026-10-14T09:00:00Z',updatedAt:'2026-10-14T09:00:00Z'},jobs:[{id:'1',name:'Tests',status:'success',url:'https://github.com/o/r/actions/runs/42/job/1'},{id:'2',name:'Build',status:'in_progress',url:'https://github.com/o/r/actions/runs/42/job/2',steps:[{id:'1',name:'Compile',status:'in_progress'}]}],graph:[{id:'check',name:'Tests',needs:[],jobIds:['1']},{id:'build',name:'Build',needs:['check'],jobIds:['2']}]};
const workspace={repositories:[repo],automations:[window.flow],tasks:[]};const snapshot={workspace,runs:[],artifactsEnabled:true};
const request=async(path,input)=>{if(path==='/api/scm/source/identity')return{readerIdentity:'fixture-account',destination:'fixture-destination'};if(path.endsWith('/options'))return{provider:'github',issues:true,pipelines:true,issueActions:[],pipelineActions:[],issueStates:[]};if(path.endsWith('/issues/detail'))return{issue:window.issues[0],comments:[]};if(path.endsWith('/pipelines/detail'))return window.pipeline;return{items:[],artifacts:[]}};
window.sources=[window.source];window.source.request=request;window.source.requestEffect=(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error});window.source.readCache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void,removeEffect:()=>Effect.void};
window.store={workspace,snapshot,profile,connection:profile.connection,connected:true,activeRuntimeId:'mac',runtimes:[{profile,snapshot,connected:true}],request,readRuntime:request,readCache:null,switchRuntime:async()=>{},refreshRuntimes:async()=>{},setWorkspace:()=>{}};
function App(){const[page,setPage]=useState('issues'),[sidebar,setSidebar]=useState(true);window.show=setPage;window.toggle=()=>setSidebar(v=>!v);return <SidebarHeaderLayout collapsed={!sidebar} onCollapsedChange={value=>setSidebar(previous=>!(typeof value==='function'?value(!previous):value))} brand={<div className="studio-sidebar-brand">Dovo Studio · Nightly</div>}><HeaderFallback><div className="studio-titlebar flex items-center"><span className="px-4">Dovo Studio · Nightly</span><HeaderMainSlot/></div></HeaderFallback><div className="flex h-full min-h-0">{page==='issues'?<IssuesView/>:page==='jira'?<JiraView/>:page==='pipelines'?<PipelinesView/>:page==='jobs'?<JobsView/>:page==='artifacts'?<ArtifactsView/>:<WorkContent key={page} repositoryId="repo" repositoryName="Dovo Studio" mode={page==='pipeline'?'pipelines':'issues'} initialSelected={page==='pipeline'?'42':'1'} request={request} connected onBack={()=>setPage('issues')} collectionHeader={<PageHeader title="Collection"/>}/>}</div></SidebarHeaderLayout>};createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + '/node_modules', root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'page-fixtures',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const assets = root + '/apps/web/dist/client/assets'
const css = (
  await Promise.all(
    (await readdir(assets))
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFile(assets + '/' + name, 'utf8')),
  )
).join('\n')
const browser = await chromium.launch()
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent(
      '<html class="dark"><style>body{margin:0}#app{height:100vh;overflow:hidden}</style><div id="app"></div></html>',
    )
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    for (const target of [
      'issues',
      'jira',
      'pipelines',
      'jobs',
      'artifacts',
      'issue',
      'pipeline',
    ]) {
      await page.evaluate((target) => window.show(target), target)
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.studio-page-header,.studio-task-thread-header').length === 1,
      )
      if (target === 'issue')
        await page.getByText('Preserve the runtime session', { exact: true }).waitFor()
      if (target === 'pipeline')
        await page
          .locator('[aria-label="Pipeline graph"]')
          .waitFor()
          .catch(async (error) => {
            console.error(await page.locator('body').innerText())
            throw error
          })
      await page.waitForFunction(
        () => !document.querySelector('[role="status"]')?.textContent?.includes('Loading'),
      )
      assert.equal(
        await page.locator('.studio-page-header,.studio-task-thread-header').count(),
        1,
        `${target}: one header`,
      )
      if (width === 1280)
        assert.equal(
          await page.locator('.studio-titlebar .studio-page-header').count(),
          1,
          `${target}: shared desktop row`,
        )
      await page.screenshot({ path: `/tmp/dovo-page-${target}-${width}.png` })
      if (target === 'pipeline') {
        await page.getByRole('button', { name: 'View job Build', exact: true }).click()
        await page.getByText('Compile', { exact: true }).waitFor()
        assert.equal(
          await page.locator('[aria-label="Pipeline graph"] svg path[stroke]').count(),
          1,
        )
      }
    }
    await page.evaluate(() => window.show('jobs'))
    await page.getByRole('button', { name: /Nightly automation/ }).click()
    await page.getByRole('heading', { name: 'Nightly automation', exact: true }).waitFor()
    assert.equal(await page.locator('.studio-page-header').count(), 1)
    await page.evaluate(() => window.toggle())
    await page.waitForFunction(
      () => document.querySelector('.studio-header-layout')?.dataset.sidebarCollapsed === 'true',
    )
    await page.evaluate(() => window.toggle())
    await page.locator('[aria-label="Automations across computers"]').waitFor({ state: 'attached' })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `Shared page headers at ${width}px: Issues, Jira, Pipelines, Automations, Artifacts, issue/run details, dependency edges and sidebar collapse passed.`,
    )
  }
} finally {
  await browser.close()
}
