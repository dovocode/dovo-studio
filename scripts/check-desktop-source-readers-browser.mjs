import assert from 'node:assert/strict'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const state = `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,set]=useState(initial);const ref=useRef(value);ref.current=value;return [value,next=>{ref.current=typeof next==='function'?next(ref.current):next;set(ref.current)},ref]}`
const mocks = {
  '@dovo/studio-core': `export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useRepositorySources=()=>window.sources;import {createContext,useContext} from 'react';const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)??window.store;export const useStudioHost=()=>({navigate:target=>window.navigation=target});export const repositorySourceKey=(id,repo)=>JSON.stringify([id,repo]);export const readAppPreferences=()=>({mergeMethod:'auto'});export const WorkspaceRuntimeScope=({runtimeId,children})=>{const source=window.sources.find(s=>s.runtimeId===runtimeId);return <Scope value={{...window.store,activeRuntimeId:runtimeId,connection:source.profile.connection,workspace:{repositories:[source.repository],tasks:[]},runtimeRegistry:{activeId:runtimeId},connected:source.connected,readCache:source.readCache,requestEffect:source.requestEffect,request:async(path,input)=>{window.writes.push({runtimeId,path,input});throw Error('Fixture write rejected')}}}><section data-owner={runtimeId}>{children}</section></Scope>};export const formatDateTime=value=>new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));`,
  '@dovo/studio-core/state': state,
  '@dovo/studio-ui': `export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as ContextMenu from '@radix-ui/react-context-menu';export const Badge=({children})=><span>{children}</span>;export const SidebarHeader=()=>null;export const useLeftSidebar=()=>[false];export const useCompactLayout=()=>false;export const FormField=({children})=><label>{children}</label>;export const Checkbox=()=>null;export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';export const PageHeader=({title,leading,children})=><header><h1>{title}</h1>{leading}{children}</header>;export const Input=props=><input {...props}/>;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Dialog=({children,open=true})=>open?<div>{children}</div>:null;export const DialogContent=Dialog;export const DialogHeader=Dialog;export const DialogTitle=Dialog;export const DialogDescription=Dialog;export const MessageResponse=({children})=><div>{children}</div>;`,
  './row': `export const PullRow=({pull,onClick})=><button onClick={onClick}>Open {pull.title}</button>;`,
  './create': `export const CreatePull=()=>null;`,
  './add-to-thread': `export const AddPullsToThread=()=>null;`,
  '../../connections/forge-connections': `export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[]});`,
  '../detail/markdown-editor': `export const PullMarkdownEditor=({value,onChange,disabled})=><textarea aria-label="Comment draft" value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/>;`,
  '../detail/detail': `import {usePullDetail} from '${root}packages/extension-scm/src/pulls/detail/use-pull-detail.ts';import {PullActions,PullCommentComposer} from '${root}packages/extension-scm/src/pulls/list/actions.tsx';import {StartPullTask} from '${root}packages/extension-scm/src/pulls/list/start-task.tsx';export const PullDetail=({repositoryId,number})=>{const value=usePullDetail(repositoryId,number);window.rowDetail=value;return value.detail?<><PullActions repositoryId={repositoryId} detail={value.detail} onDone={()=>{}}/><PullCommentComposer repositoryId={repositoryId} detail={value.detail} onDone={()=>{}}/><StartPullTask repositoryId={repositoryId} pull={value.detail.pull}/></>:null;};`,
  './work-sources': `export {workRemoteKey,matchesWorkSource} from '${root}packages/extension-scm/src/work/work-source-identity.ts';export const jiraSourceKey=(id,source)=>JSON.stringify([id,'jira',source]);export const useIssueSources=()=>window.sources;`,
  './work-form': `export const WorkForm=()=>null;`,
  './issue-detail': `import {IssueDetail as Real} from '${root}packages/extension-scm/src/work/issue-detail.tsx';export const IssueDetail=props=>{window.workDetail=props.detail;return <Real {...props}/>};`,
  './pipeline-detail': `import {PipelineDetail as Real} from '${root}packages/extension-scm/src/work/pipeline-detail.tsx';export const PipelineDetail=props=>{window.workDetail=props.detail;return <Real {...props}/>};`,
  './use-work-sources': `import {useWorkSources as real} from '${root}packages/extension-scm/src/work/use-work-sources.ts';export const useWorkSources=(...args)=>{const result=real(...args);window.workResult=result;return result;};`,
  './jira-toolbar': `export const JiraToolbar=()=>null;`,
  '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
  '../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';import {Effect} from 'effect';import {decode,RuntimeRequestError} from '@dovo/protocol';
window.commit=flushSync;
import PullRequestsView from '${root}packages/extension-scm/src/pulls/list/view.tsx';
import {WorkContent} from '${root}packages/extension-scm/src/work/content.tsx';
import IssuesView,{PipelinesView} from '${root}packages/extension-scm/src/work/work-view.tsx';
import {usePulls} from '${root}packages/extension-scm/src/pulls/list/use-pulls.ts';import {usePullDetail} from '${root}packages/extension-scm/src/pulls/detail/use-pull-detail.ts';
window.reads=[];window.writes=[];window.discoveryFailures={};window.cacheReads=[];window.cacheWrites=[];window.accounts={a:'same-account',b:window.alternateAccount??'same-account'};window.destinations={a:'dest-a',b:'dest-b'};window.active='a';window.legacy=false;
const saved=new Map();
const source=id=>{const profile={id,name:id,connection:{address:'http://'+id,token:'paired-'+id}};const repository={id:'repo-'+id,name:'Project',path:'/repo',gitIdentity:'github.com/team/project',pullIdentity:'github.com/team/project',forge:{connectionId:'local-'+id,repository:'team/project'}};const cache={readEffect:(key,schema)=>Effect.sync(()=>{window.cacheReads.push({id,key});if(window.savedOriginIdentity&&id==='a'&&JSON.parse(key)[0]==='forge')return {value:decode(schema,{readerIdentity:'same-account',destination:'dest-a'}),cachedAt:'2026-10-14'};return saved.has(id+key)?{value:decode(schema,saved.get(id+key)),cachedAt:'2026-10-14'}:null}),writeEffect:(key,value)=>Effect.sync(()=>{window.cacheWrites.push({id,key,value});saved.set(id+key,value)}),removeEffect:key=>Effect.sync(()=>{saved.delete(id+key)})};return {serverId:window.persistentServers?'persistent-'+id:undefined,key:JSON.stringify([id,repository.id]),scope:JSON.stringify([id,profile.connection,repository.forge]),runtimeId:id,runtimeName:id,profile,repository,connected:!(window.offlineOrigin&&id==='a'),readCache:cache,requestEffect:(path,input,schema)=>Effect.tryPromise({try:async()=>{if(path==='/api/scm/source/identity'){window.identityCalls=(window.identityCalls??0)+1;if(window.discoveryFailures[id])throw new RuntimeRequestError({kind:'response',status:503,message:'Discovery unavailable'});if(window.legacy)throw new RuntimeRequestError({kind:'response',status:404,message:'Old runtime'});return decode(schema,{readerIdentity:window.accounts[id],destination:window.destinations[id]})}window.reads.push({id,path,input});if(window.dispatchRace?.id===id){const field=window.dispatchRace.field;const expected=field==='destination'?input.expectedDestination:input.expectedReaderIdentity;const actual=(field==='destination'?window.destinations[id]:window.accounts[id])+'-changed';if(expected!==undefined&&expected!==actual)throw new RuntimeRequestError({kind:'response',status:409,message:'Source changed during dispatch'});}if(input.expectedDestination!==window.destinations[id])throw Error('Missing or wrong destination guard');if(input.expectedReaderIdentity&&input.expectedReaderIdentity!==window.accounts[id])throw new RuntimeRequestError({kind:'response',status:409,message:'Account changed'});if(input.jiraSourceId && (path==='/api/scm/work/options'||path==='/api/scm/work/issues/detail')){
const section=input.section??'issue-options';
if(window.blockedJira?.includes(section))await new Promise(resolve=>(window.jiraReleases[section]??=[]).push(resolve));
if(window.failedJira?.includes(section))throw Error(section+' unavailable');
if(section==='issue-options')return decode(schema,{provider:'jira',issues:true,pipelines:false,pipelineActions:[],issueTypes:['Task'],destination:window.destinations[id]});
return decode(schema,{destination:window.destinations[id],issue:{id:input.id,title:'Jira issue overview',body:'A useful issue description',state:'In progress',type:'Task',priority:'High',url:'https://team.atlassian.net/browse/'+input.id,author:'Dominic',assignees:['account-id'],assigneeNames:['Sam Developer'],labels:['mobile','needs-review'],updatedAt:'2026-10-14T10:00:00Z',revision:window.issueRevision??'same-revision',destination:window.destinations[id]},comments:section==='discussion'?[{id:input.cursor?'second':'first',body:input.cursor?'Ready for review.':'I can reproduce this on mobile.',author:'Dominic',createdAt:'2026-10-14T10:00:00Z'}]:[],next:section==='discussion'&&!input.cursor?'30':undefined});
}
if(path==='/api/scm/work/options')return decode(schema,{provider:'github',issues:true,pipelines:true,pipelineActions:['run','rerun'],destination:window.destinations[id]});
if(path==='/api/scm/work/issues/list')return decode(schema,{items:[{id:input.cursor?'10':window.freshWorkRows?'9':'7',title:input.cursor?'Next issue':window.freshWorkRows?'New issue after handoff':'Listed issue',body:'Description',state:'open',url:'https://github.com/team/project/issues/'+(input.cursor?'10':window.freshWorkRows?'9':'7'),author:'Dominic',assignees:[],labels:[],updatedAt:'2026-10-14',revision:'same-revision',destination:window.destinations[id]}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/work/pipelines/list')return decode(schema,{items:[{id:input.cursor?'10':window.freshWorkRows?'9':'7',title:input.cursor?'Next run':window.freshWorkRows?'New run after handoff':'Listed run',url:'https://github.com/team/project/actions/runs/'+(input.cursor?'10':window.freshWorkRows?'9':'7'),ref:'main',sha:'same-sha',actor:'Dominic',status:'success',createdAt:'2026-10-14',updatedAt:'2026-10-14',destination:window.destinations[id]}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/work/issues/detail')return decode(schema,{destination:window.destinations[id],issue:{id:input.id,title:input.id==='9'?'New issue after handoff':'Kept issue',body:'Description',state:'open',url:'https://github.com/team/project/issues/'+input.id,author:'Dominic',assignees:[],labels:[],updatedAt:'2026-10-14',revision:'same-revision',destination:window.destinations[id]},comments:[{id:input.cursor?'second':'first',body:'Page',author:'Dominic',createdAt:'2026-10-14'}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/work/pipelines/detail')return decode(schema,{destination:window.destinations[id],run:{id:input.id,title:input.id==='9'?'New run after handoff':'Kept run',url:'https://github.com/team/project/actions/runs/'+input.id,ref:'main',sha:'same-sha',actor:'Dominic',status:'success',createdAt:'2026-10-14',updatedAt:'2026-10-14',destination:window.destinations[id]},jobs:[{id:input.cursor?'second':'first',name:'Job',status:'success',url:'https://github.com/team/project/actions/runs/7'}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/pulls/overview'&&window.pagedNumbers){if(input.page===2&&window.failLaterPage)throw Error('Older PR page unavailable');return decode(schema,{destination:window.destinations[id],pulls:(window.pagedNumbers[input.page-1]??[]).map(number=>({number,title:'PR '+number,url:'https://github.com/team/project/pull/'+number,state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],destination:window.destinations[id]})),page:input.page,hasMore:input.page<window.pagedNumbers.length});}if(path==='/api/scm/pulls/overview'&&window.cacheResponses?.[id])return decode(schema,window.cacheResponses[id]);if(path==='/api/scm/pulls/detail')return decode(schema,{destination:window.destinations[id],pull:{number:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[],destination:window.destinations[id]},capabilities:{actions:['comment','merge'],mergeMethods:['squash'],reviewDecisions:[]},files:[],comments:[],checks:[],warnings:[]});return decode(schema,{pulls:[{number:input.page===2?8:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],viewerIsAuthor:true,destination:window.destinations[id]}],page:input.page,hasMore:input.page===1})},catch:e=>e})}};
window.sources=['a','b'].map(source).map(s=>({...s,name:s.repository.name,jira:window.jiraMode?{id:'tracker',site:'https://team.atlassian.net',project:'TEAM',name:'Team'}:undefined,input:window.jiraMode?{jiraSourceId:'tracker'}:{repositoryId:s.repository.id},request:(path,input,schema)=>Effect.runPromise(s.requestEffect(path,input,schema)),readCache:{...s.readCache,read:(key,schema)=>Effect.runPromise(s.readCache.readEffect(key,schema)),write:(key,value)=>Effect.runPromise(s.readCache.writeEffect(key,value)),remove:key=>Effect.runPromise(s.readCache.removeEffect(key))}}));window.store={activeRuntimeId:'a',runtimes:[],workspace:{repositories:[window.sources[0].repository],jiraSources:window.sources[0].jira?[window.sources[0].jira]:[],tasks:[]},runtimeRegistry:{activeId:'a'},connected:true,requestEffect:window.sources[0].requestEffect,readCache:window.sources[0].readCache};
function View(){const [filter,setFilter]=useState(window.filter??'');window.setFilter=value=>{window.filter=value;setFilter(value)};const result=usePulls('open',filter);window.result=result;return <pre>{JSON.stringify(result.pages.map(p=>({owner:p.source.runtimeId,error:p.error,cached:p.stale,pulls:p.pulls})))}</pre>}
function Detail(){const result=usePullDetail('repo-a',7);window.detailResult=result;return <pre>{JSON.stringify(result.detail)}</pre>}
function Work(){return <WorkContent repositoryId={window.jiraMode?undefined:"repo-a"} jiraSourceId={window.jiraMode?"tracker":undefined} repositoryName="Project" collectionHeader={null} initialSelected={window.jiraMode?"TEAM-7":"7"} mode={window.workMode} request={window.sources[0].request} connected={window.store.connected}/>}
const app=createRoot(document.getElementById('app'));window.render=remount=>app.render(window.mode==='work-rows'?(window.workMode==='issues'?<IssuesView/>:<PipelinesView/>):window.mode==='rows'?<PullRequestsView/>:window.mode==='work'?<Work key={window.mount??0}/>:window.mode==='detail'?<Detail key={window.mount??0}/>:<View key={remount?window.mount=(window.mount??0)+1:window.mount??0}/>);window.render(false);
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'fixtures',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'fixture' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  // PRs keep their selected machine even when a same-account server is available.
  for (const alternateAccount of ['same-account', 'personal-account']) {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    await page.clock.install()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.evaluate((account) => {
      window.persistentServers = true
      window.alternateAccount = account
      window.filter = JSON.stringify(['a', 'repo-a'])
    }, alternateAccount)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.result?.pages[0]?.pulls.length && !window.result.busy)
    assert.equal(await page.evaluate(() => window.result.pages[0].reader.runtimeId), 'a')
    assert.equal(await page.evaluate(() => window.result.pages[0].pulls[0].viewerIsAuthor), true)
    await page.evaluate(() => {
      window.mode = 'detail'
      window.render(false)
    })
    await page.waitForFunction(() => window.detailResult?.detail && !window.detailResult.busy)
    assert.equal(await page.evaluate(() => window.detailResult.detail.destination), 'dest-a')
    await page.clock.runFor(30001)
    assert.equal(await page.evaluate(() => window.reads.every((read) => read.id === 'a')), true)
    const discovery = await page.evaluate(() => window.identityCalls)
    assert.ok(discovery < 30, 'Detail polling unexpectedly multiplied account discovery')
    // Connection loss preserves the original saved details, without any replica reads.
    await page.evaluate(() => {
      // Commit disconnection and stop all section pollers before measuring offline reads.
      // Clearing first can count an online status poll dispatched before React commits.
      window.commit(() => {
        window.store = { ...window.store, connected: false }
        window.sources = window.sources.map((source) => ({
          ...source,
          connected: source.runtimeId !== 'a',
        }))
        window.render(false)
      })
      window.reads = []
    })
    await page.waitForFunction(
      () =>
        window.detailResult?.detail?.stale &&
        Object.values(window.detailResult.sections).every((section) => !section.readConnected),
    )
    await page.clock.runFor(30001)
    assert.deepEqual(await page.evaluate(() => window.reads), [])
    await page.evaluate(() => {
      window.mount = (window.mount ?? 0) + 1
      window.render(false)
    })
    await page.waitForFunction(
      () => window.detailResult?.detail?.stale && !window.detailResult.busy,
    )
    assert.equal(await page.evaluate(() => window.detailResult.detail.destination), 'dest-a')
    assert.deepEqual(await page.evaluate(() => window.reads), [])
    // Lists also remain offline on the selected machine through remounts.
    await page.evaluate(() => {
      window.mode = 'list'
      window.render(false)
    })
    await page.waitForFunction(() => window.result?.pages[0]?.pulls.length && !window.result.busy)
    assert.equal(await page.evaluate(() => window.result.pages[0].source.runtimeId), 'a')
    assert.equal(await page.evaluate(() => window.result.pages[0].reader.connected), false)
    await page.clock.runFor(30001)
    assert.deepEqual(await page.evaluate(() => window.reads), [])
    // Reconnecting and paging still use the original account and dispatch guards.
    await page.evaluate(() => {
      window.store = { ...window.store, connected: true }
      window.sources = window.sources.map((source) => ({ ...source, connected: true }))
      window.render(false)
    })
    await page.waitForFunction(() => window.result.connected && !window.result.busy)
    for (const field of ['account', 'destination']) {
      await page.evaluate((field) => {
        window.dispatchRace = { id: 'a', field }
        window.cacheWrites = []
        window.result.more(window.result.pages[0].source.key)
      }, field)
      await page.waitForFunction(() =>
        window.result.pages[0]?.error?.includes('Source changed during dispatch'),
      )
      assert.deepEqual(
        await page.evaluate(() =>
          window.cacheWrites.filter((write) => JSON.parse(write.key)[0] === 'pulls'),
        ),
        [],
      )
      await page.evaluate(() => {
        window.dispatchRace = undefined
        window.result.refresh()
      })
      await page.waitForFunction(() => !window.result.busy && !window.result.pages[0].error)
    }
    await page.evaluate(() => window.result.more(window.result.pages[0].source.key))
    await page.waitForFunction(
      () => window.result.pages[0]?.pulls.length === 2 && !window.result.busy,
    )
    assert.equal(
      await page.evaluate(() =>
        window.reads.every(
          (read) =>
            read.id === 'a' &&
            read.input.expectedReaderIdentity === 'same-account' &&
            read.input.expectedDestination === 'dest-a',
        ),
      ),
      true,
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  const moving = await browser.newPage()
  moving.setDefaultTimeout(8000)
  await moving.clock.install()
  await moving.setContent('<div id="app"></div>')
  await moving.addScriptTag({
    content: "window.filter=JSON.stringify(['a','repo-a']);window.pagedNumbers=[[7,6],[5,4],[3,2]]",
  })
  await moving.addScriptTag({ content: built.outputFiles[0].text })
  await moving.waitForFunction(() => window.result?.pages[0]?.pulls.length === 2)
  await moving.evaluate(() => window.result.more(window.result.pages[0].source.key))
  await moving.waitForFunction(() => window.result.pages[0]?.page === 2)
  await moving.evaluate(() => {
    window.pagedNumbers = [
      [8, 7],
      [6, 5],
      [4, 3],
    ]
  })
  await moving.clock.runFor(30001)
  await moving.waitForFunction(() => window.result.pages[0]?.pulls[0]?.number === 8)
  assert.deepEqual(
    await moving.evaluate(() => window.result.pages[0].pulls.map((pull) => pull.number)),
    [8, 7, 6, 5],
    'Desktop refresh retains PRs shifted across a page boundary',
  )
  assert.equal(
    await moving.evaluate(
      () => window.reads.filter((read) => read.input.page === 2).at(-1).input.refresh,
    ),
    true,
    'Shifted boundaries bypass independently cached later pages',
  )
  await moving.evaluate(() => {
    window.pagedNumbers = [
      [9, 8],
      [7, 6],
      [5, 4],
    ]
    window.failLaterPage = true
  })
  await moving.clock.runFor(30001)
  await moving.waitForFunction(() => window.result.pages[0]?.error === 'Older PR page unavailable')
  assert.deepEqual(
    await moving.evaluate(() => window.result.pages[0].pulls.map((pull) => pull.number)),
    [8, 7, 6, 5],
    'Desktop later-page failure preserves the coherent previous snapshot',
  )
  assert.equal(await moving.evaluate(() => window.result.pages[0].stale), true)
  await moving.evaluate(() => {
    window.failLaterPage = false
    window.pagedNumbers = [
      [9, 8],
      [8, 6],
    ]
    window.result.refresh()
  })
  await moving.waitForFunction(
    () => !window.result.pages[0]?.error && window.result.pages[0]?.pulls[0]?.number === 9,
  )
  assert.deepEqual(
    await moving.evaluate(() => window.result.pages[0].pulls.map((pull) => pull.number)),
    [9, 8, 6],
    'Closed PRs disappear and moving boundaries deduplicate after retry',
  )
  assert.equal(await moving.evaluate(() => window.result.pages[0].hasMore), false)
  assert.equal(await moving.evaluate(() => window.reads.every((read) => read.id === 'a')), true)
  await moving.close()
  // A credential/account change cannot silently authorize another machine or overwrite old data.
  const changed = await browser.newPage()
  changed.setDefaultTimeout(8000)
  await changed.setContent('<div id="app"></div>')
  await changed.evaluate(() => {
    window.mode = 'detail'
  })
  await changed.addScriptTag({ content: built.outputFiles[0].text })
  await changed.waitForFunction(() => window.detailResult?.detail && !window.detailResult.busy)
  await changed.evaluate(() => {
    window.reads = []
    window.accounts.a = 'replacement-account'
    window.destinations.a = 'replacement-destination'
    window.detailResult.refresh()
  })
  // Online owners may retry immediately after discovery failures. A changed account or
  // destination still fails verification before dispatching any PR request.
  await changed.waitForFunction(() => !window.detailResult.busy && !!window.detailResult.error)
  assert.equal(await changed.evaluate(() => window.detailResult.detail.destination), 'dest-a')
  assert.deepEqual(await changed.evaluate(() => window.reads), [])
  await changed.close()
  for (const mode of ['issues', 'pipelines']) {
    const rows = await browser.newPage()
    rows.setDefaultTimeout(8000)
    const errors = []
    rows.on('pageerror', (error) => errors.push(error.message))
    await rows.setContent('<div id="app"></div>')
    await rows.evaluate((mode) => {
      window.mode = 'work-rows'
      window.workMode = mode
    }, mode)
    await rows.addScriptTag({ content: built.outputFiles[0].text })
    await rows.waitForFunction(
      () => window.workResult?.pages[0]?.items.length && !window.workResult.busy,
    )
    await rows.evaluate(() => {
      window.reads = []
      window.cacheWrites = []
      window.freshWorkRows = true
      window.sources = window.sources.map((source) => ({
        ...source,
        connected: source.runtimeId !== 'a',
      }))
      window.render(false)
    })
    await rows.waitForFunction(
      () => window.workResult?.pages[0]?.reader.runtimeId === 'b' && !window.workResult.busy,
    )
    await rows.getByRole('button', { name: 'Refresh', exact: true }).click()
    await rows.waitForFunction(
      () => window.workResult.pages[0]?.items[0]?.id === '9' && !window.workResult.busy,
    )
    assert.equal(await rows.evaluate(() => window.workResult.pages[0].source.runtimeId), 'a')
    assert.equal(
      await rows.evaluate(() => window.workResult.pages[0].options.destination),
      'dest-a',
    )
    assert.equal(
      await rows.evaluate(() => window.workResult.pages[0].items[0].destination),
      'dest-a',
    )
    assert.equal(
      await rows
        .getByRole('button', {
          name: mode === 'issues' ? 'New issue' : 'Run pipeline',
          exact: true,
        })
        .isDisabled(),
      true,
    )
    for (const field of ['destination', 'account']) {
      await rows.evaluate((field) => {
        window.cacheWrites = []
        window.dispatchRace = { id: 'b', field }
        window.workResult.more(window.workResult.pages[0].source.key)
      }, field)
      await rows.waitForFunction(
        () =>
          window.workResult.pages[0]?.error?.includes('Source changed during dispatch') &&
          !window.workResult.busy,
      )
      assert.equal(await rows.evaluate(() => window.workResult.pages[0].items.length), 1)
      assert.deepEqual(
        await rows.evaluate(() =>
          window.cacheWrites.filter((write) => JSON.parse(write.key)[0] === 'work'),
        ),
        [],
        'Rejected work pagination cannot overwrite the origin cache',
      )
      await rows.evaluate(() => {
        window.dispatchRace = undefined
        window.workResult.refresh()
      })
      await rows.waitForFunction(() => !window.workResult.busy && !window.workResult.pages[0].error)
    }
    await rows.getByRole('button', { name: /Load more/ }).click()
    await rows.waitForFunction(
      () => window.workResult.pages[0]?.items.length === 2 && !window.workResult.busy,
    )
    assert.equal(
      await rows.evaluate(() =>
        window.workResult.pages[0].items.every((item) => item.destination === 'dest-a'),
      ),
      true,
    )
    assert.equal(
      await rows.evaluate(() =>
        window.reads.every(
          (read) =>
            read.id === 'b' &&
            read.input.expectedReaderIdentity === 'same-account' &&
            read.input.expectedDestination === 'dest-b',
        ),
      ),
      true,
    )
    assert.equal(
      await rows.evaluate(() =>
        window.cacheWrites
          .filter((write) => JSON.parse(write.key)[0] === 'work')
          .every((write) => write.id === 'a' && JSON.parse(write.key)[1].repositoryId === 'repo-a'),
      ),
      true,
    )
    await rows
      .getByRole('button', {
        name: mode === 'issues' ? /New issue after handoff/ : /New run after handoff/,
      })
      .click()
    await rows.waitForFunction(() => window.workDetail?.destination === 'dest-a')
    assert.equal(
      await rows.locator('[data-owner="a"]').count(),
      1,
      'A newly opened row retains its original runtime scope',
    )
    const action = mode === 'issues' ? 'Issue actions' : 'Pipeline actions'
    const task = mode === 'issues' ? 'Start task from issue' : 'Investigate run'
    assert.equal(await rows.getByRole('button', { name: action, exact: true }).isDisabled(), true)
    assert.equal(await rows.getByRole('button', { name: task, exact: true }).isDisabled(), true)
    if (mode === 'issues')
      assert.equal(
        await rows.getByRole('button', { name: 'Edit issue', exact: true }).isDisabled(),
        true,
      )
    assert.deepEqual(await rows.evaluate(() => window.writes), [])
    await rows.evaluate(() => {
      window.sources = window.sources.map((source) => ({ ...source, connected: true }))
      window.render(false)
    })
    await rows.waitForFunction(
      (action) => !document.querySelector('button[aria-label="' + action + '"]').disabled,
      action,
    )
    await rows.waitForFunction(
      (task) =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent === task && !button.disabled,
        ),
      task,
    )
    assert.equal(await rows.getByRole('button', { name: task, exact: true }).isEnabled(), true)
    await rows.getByRole('button', { name: task, exact: true }).click()
    await rows.waitForFunction(() => window.writes.length === 1)
    assert.deepEqual(
      await rows.evaluate(() =>
        window.writes.map((write) => [
          write.runtimeId,
          write.path,
          write.input.repositoryId,
          write.input.expectedDestination,
        ]),
      ),
      [['a', '/api/scm/work/task', 'repo-a', 'dest-a']],
    )
    if (mode === 'pipelines') {
      await rows.getByRole('button', { name: action, exact: true }).click()
      await rows.getByRole('menuitem', { name: 'Rerun', exact: true }).click()
      await rows.getByRole('button', { name: 'Confirm rerun', exact: true }).click()
      await rows.waitForFunction(() => window.writes.length === 2)
      assert.deepEqual(
        await rows.evaluate(() =>
          window.writes
            .slice(1)
            .map((write) => [
              write.runtimeId,
              write.path,
              write.input.repositoryId,
              write.input.expectedDestination,
            ]),
        ),
        [['a', '/api/scm/work/pipelines/action', 'repo-a', 'dest-a']],
      )
    }
    assert.deepEqual(errors, [])
    await rows.close()
  }
  for (const mode of ['issues', 'pipelines']) {
    const rebound = await browser.newPage()
    rebound.setDefaultTimeout(8000)
    const errors = []
    rebound.on('pageerror', (error) => errors.push(error.message))
    await rebound.setContent('<div id="app"></div>')
    await rebound.evaluate((mode) => {
      window.mode = 'work-rows'
      window.workMode = mode
    }, mode)
    await rebound.addScriptTag({ content: built.outputFiles[0].text })
    await rebound.waitForFunction(
      () => window.workResult?.pages[0]?.items.length && !window.workResult.busy,
    )
    await rebound.evaluate(() => {
      window.sources = window.sources.map((source) => ({
        ...source,
        connected: source.runtimeId !== 'a',
      }))
      window.render(false)
    })
    await rebound.waitForFunction(
      () => window.workResult.pages[0]?.reader.runtimeId === 'b' && !window.workResult.busy,
    )
    await rebound.evaluate(() => {
      window.reads = []
      window.cacheWrites = []
      window.destinations.b = 'unrelated-repository'
      window.workResult.refresh()
    })
    await rebound.waitForFunction(
      () => !window.workResult.busy && window.workResult.pages[0]?.reader.connected === false,
    )
    assert.deepEqual(
      await rebound.evaluate(() => window.reads),
      [],
      'Work refresh rejects a reader rebind before provider access',
    )
    assert.deepEqual(
      await rebound.evaluate(() =>
        window.cacheWrites.filter((write) => JSON.parse(write.key)[0] === 'work'),
      ),
      [],
      'A rebound work reader cannot overwrite the origin cache',
    )
    assert.equal(
      await rebound.evaluate(() => window.workResult.pages[0].items[0].destination),
      'dest-a',
    )
    assert.deepEqual(errors, [])
    await rebound.close()
  }
  for (const mode of ['issues', 'pipelines']) {
    const workPage = await browser.newPage()
    const errors = []
    workPage.on('pageerror', (error) => errors.push(error.message))
    await workPage.setContent('<div id="app"></div>')
    await workPage.addScriptTag({ content: built.outputFiles[0].text })
    await workPage.evaluate((mode) => {
      window.mode = 'work'
      window.workMode = mode
      window.render(false)
    }, mode)
    await workPage
      .getByText(mode === 'issues' ? 'Kept issue' : 'Kept run', { exact: true })
      .first()
      .waitFor({ timeout: 8000 })
      .catch(async (error) => {
        console.error({ errors, body: await workPage.locator('body').innerText() })
        throw error
      })
    await workPage.evaluate(() => {
      window.reads = []
      window.store = { ...window.store, connected: false }
      window.sources = window.sources.map((source) => ({
        ...source,
        connected: source.runtimeId !== 'a',
      }))
      window.render(false)
    })
    await workPage.waitForFunction(
      () =>
        window.reads.some((r) => r.id === 'b' && r.path.endsWith('/detail')) &&
        window.workDetail?.next,
    )
    await workPage
      .getByRole('button', { name: mode === 'issues' ? 'More comments' : 'More jobs', exact: true })
      .click()
    await workPage.waitForFunction(
      (mode) =>
        (mode === 'issues'
          ? window.workDetail?.comments.length
          : window.workDetail?.jobs.length) === 2,
      mode,
    )
    assert.equal(await workPage.evaluate(() => window.workDetail.destination), 'dest-a')
    assert.equal(
      await workPage.evaluate(
        (mode) =>
          mode === 'issues'
            ? window.workDetail.issue.destination
            : window.workDetail.run.destination,
        mode,
      ),
      'dest-a',
      'Pagination keeps mutations on the original source',
    )
    assert.equal(
      await workPage.evaluate(() =>
        window.reads
          .filter((r) => r.path.endsWith('/detail'))
          .every((r) => r.id === 'b' && r.input.expectedReaderIdentity === 'same-account'),
      ),
      true,
    )
    assert.equal(
      await workPage.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(),
      false,
    )
    if (mode === 'issues')
      assert.equal(
        await workPage.getByRole('button', { name: 'Edit issue', exact: true }).isDisabled(),
        true,
        'Reading through an alternate cannot enable origin mutations',
      )
    assert.deepEqual(errors, [])
    await workPage.close()
  }
  const jira = await browser.newPage()
  const jiraErrors = []
  jira.on('pageerror', (error) => jiraErrors.push(error.message))
  await jira.setContent('<div id="app"></div>')
  await jira.evaluate(() => {
    window.jiraMode = true
    window.mode = 'work'
    window.workMode = 'issues'
    window.blockedJira = ['discussion', 'issue-options']
    window.jiraReleases = {}
    window.releaseJira = (section) => {
      window.blockedJira = window.blockedJira.filter((value) => value !== section)
      for (const release of window.jiraReleases[section] ?? []) release()
      window.jiraReleases[section] = []
    }
  })
  await jira.addScriptTag({ content: built.outputFiles[0].text })
  await jira.getByRole('heading', { name: 'Jira issue overview', exact: true }).waitFor()
  await jira.getByText('A useful issue description', { exact: true }).waitFor()
  await jira.getByText('Loading discussion…', { exact: true }).waitFor()
  assert.equal(
    await jira
      .getByText('No comments yet. Add context or start a linked task.', { exact: true })
      .count(),
    0,
  )
  assert.equal(
    await jira.getByRole('button', { name: 'Change status', exact: true }).isDisabled(),
    true,
  )
  await jira.evaluate(() => {
    window.failedJira = ['discussion', 'issue-options']
    window.releaseJira('discussion')
    window.releaseJira('issue-options')
  })
  await jira.getByRole('alert').filter({ hasText: 'Discussion: discussion unavailable' }).waitFor()
  await jira
    .getByRole('alert')
    .filter({ hasText: 'Issue actions: issue-options unavailable' })
    .waitFor()
  await jira.evaluate(() => {
    window.failedJira = []
  })
  await jira.getByRole('button', { name: 'Refresh discussion', exact: true }).click()
  await jira.getByText('I can reproduce this on mobile.', { exact: true }).waitFor()
  await jira.getByRole('button', { name: 'More comments', exact: true }).click()
  await jira.getByText('Ready for review.', { exact: true }).waitFor()
  await jira.getByRole('button', { name: 'Retry actions', exact: true }).click()
  await jira.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Change status' && !button.disabled,
    ),
  )
  await jira.getByText('Ready for review.', { exact: true }).waitFor()
  assert.equal(await jira.evaluate(() => window.workDetail.comments.length), 2)
  await jira.evaluate(() => {
    window.issueRevision = 'updated-revision'
  })
  await jira.getByRole('button', { name: 'Refresh', exact: true }).click()
  await jira.waitForFunction(
    () =>
      window.workDetail?.issue.revision === 'updated-revision' &&
      window.workDetail?.comments.length === 2,
  )

  assert.equal(await jira.evaluate(() => window.reads.every((read) => read.id === 'a')), true)
  const assets = root + 'apps/desktop/dist/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await jira.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  await jira.addStyleTag({
    content:
      'body{font-family:system-ui;background:var(--background);color:var(--foreground)}button{cursor:pointer}header>h1{font-size:14px}button:disabled{opacity:.5}',
  })
  await mkdir('/tmp/dovo-jira', { recursive: true })
  await jira.evaluate(() => document.documentElement.classList.add('dark'))
  await jira
    .getByRole('article', { name: 'Issue details' })
    .screenshot({ path: '/tmp/dovo-jira/desktop-dark.png' })
  await jira.setViewportSize({ width: 390, height: 844 })
  await jira
    .getByRole('article', { name: 'Issue details' })
    .screenshot({ path: '/tmp/dovo-jira/desktop-narrow.png' })
  assert.equal(await jira.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await jira.setViewportSize({ width: 1280, height: 900 })
  await jira.evaluate(() => document.documentElement.classList.remove('dark'))
  await jira
    .getByRole('article', { name: 'Issue details' })
    .screenshot({ path: '/tmp/dovo-jira/desktop-light.png' })
  assert.deepEqual(jiraErrors, [])
  await jira.close()
  console.log(
    'Desktop source readers passed: account/destination dispatch and pagination guards; PRs stay on their selected machine through offline/remount/account changes; issue/pipeline rows retain the origin and cache; offline comments/merge/tasks disabled and reconnect writes remain on the origin; same-account handoff, remount, discovery failure and account recovery. Jira issue overview/options/discussion delays, failures, retries, comment pagination and scoped caches passed. Transport and UI primitives mocked; actual list/detail routing, issue layout and action controls exercised.',
  )
} finally {
  await browser.close()
}
