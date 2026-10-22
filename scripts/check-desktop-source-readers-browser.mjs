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
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';import {decode,RuntimeRequestError} from '@dovo/protocol';
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
if(path==='/api/scm/pulls/overview'&&window.cacheResponses?.[id])return decode(schema,window.cacheResponses[id]);if(path==='/api/scm/pulls/detail')return decode(schema,{destination:window.destinations[id],pull:{number:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[],destination:window.destinations[id]},capabilities:{actions:['comment','merge'],mergeMethods:['squash'],reviewDecisions:[]},files:[],comments:[],checks:[],warnings:[]});return decode(schema,{pulls:[{number:input.page===2?8:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],viewerIsAuthor:true,destination:window.destinations[id]}],page:input.page,hasMore:input.page===1})},catch:e=>e})}};
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
  // A returning gateway's old cache cannot replace newer results from the same PR owner.
  const continuity = await browser.newPage()
  await continuity.setContent('<div id="app"></div>')
  await continuity.evaluate(() => {
    window.persistentServers = true
  })
  await continuity.addScriptTag({ content: built.outputFiles[0].text })
  await continuity.waitForFunction(
    () => window.result?.pages[0]?.pulls.length && !window.result.busy,
  )
  const preferred = await continuity.evaluate(() => window.result.pages[0].reader.runtimeId)
  await continuity.evaluate((preferred) => {
    const pull = window.result.pages[0].pulls[0]
    window.cacheResponses = Object.fromEntries(
      ['a', 'b'].map((id) => [
        id,
        {
          pulls: [{ ...pull, number: id === preferred ? 608 : 614 }],
          page: 1,
          hasMore: false,
          stale: id === preferred,
          cachedAt: id === preferred ? '2026-10-19T08:39:00Z' : '2026-10-20T11:45:00Z',
        },
      ]),
    )
    window.sources = window.sources.map((source) => ({
      ...source,
      connected: source.runtimeId !== preferred,
    }))
    window.render(false)
  }, preferred)
  await continuity.waitForFunction(
    () => window.result?.pages[0]?.pulls[0]?.number === 614 && !window.result.busy,
  )
  await continuity.evaluate(() => {
    window.sources = window.sources.map((source) => ({ ...source, connected: true }))
    window.render(false)
  })
  await continuity.waitForFunction(
    (preferred) => window.result?.pages[0]?.reader.runtimeId === preferred && !window.result.busy,
    preferred,
  )
  assert.equal(await continuity.evaluate(() => window.result.pages[0].pulls[0].number), 614)
  assert.equal(
    await continuity.evaluate(() => window.result.pages[0].cachedAt),
    '2026-10-20T11:45:00Z',
  )
  assert.match(await continuity.evaluate(() => window.result.pages[0].error), /newer saved PR data/)
  await continuity.close()

  // All six detail sections share discovery; hidden tabs must not start their own polls.
  const polling = await browser.newPage()
  await polling.clock.install()
  await polling.setContent('<div id="app"></div>')
  await polling.evaluate(() => {
    window.mode = 'detail'
  })
  await polling.addScriptTag({ content: built.outputFiles[0].text })
  await polling.waitForFunction(() => window.detailResult?.detail && !window.detailResult.busy)
  const initialDiscovery = await polling.evaluate(() => window.identityCalls)
  assert.ok(initialDiscovery <= 7, `Expected shared detail discovery, received ${initialDiscovery}`)
  await polling.clock.runFor(30001)
  const calls = await polling.evaluate(() => ({
    identity: window.identityCalls,
    detail: window.reads.filter((read) => read.path === '/api/scm/pulls/detail').length,
  }))
  assert.ok(
    calls.identity - calls.detail <= 6,
    'Only one two-computer discovery loop may run per detail',
  )
  await polling.close()

  const check = async (scenario) => {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(
      () => window.result?.pages[0]?.pulls.length === 1 && !window.result.busy,
    )
    assert.deepEqual(await page.evaluate(() => [...new Set(window.reads.map((r) => r.id))]), ['a'])
    assert.equal(
      await page.evaluate(() =>
        window.reads.every((r) => r.input.expectedReaderIdentity === 'same-account'),
      ),
      true,
    )
    await page.evaluate(() => {
      window.store = { activeRuntimeId: 'b' }
      window.render(true)
    })
    await page.waitForFunction(
      () => window.result?.pages[0]?.pulls.length === 1 && !window.result.busy,
    )
    assert.equal(
      await page.evaluate(() => window.result.pages[0].source.runtimeId),
      'a',
      'Reader survives remount and global selection changes',
    )
    await page.evaluate((scenario) => {
      window.reads = []
      if (scenario === 'different') window.accounts.b = 'other-account'
      if (scenario === 'unknown') window.legacy = true
      window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId !== 'a' }))
      window.render(false)
    }, scenario)
    if (scenario === 'same') {
      await page.waitForFunction(
        () =>
          window.result?.pages[0]?.reader.runtimeId === 'b' &&
          !window.result.busy &&
          window.reads.length > 0,
      )
      assert.equal(
        await page.evaluate(() =>
          window.reads.every(
            (r) => r.id === 'b' && r.input.expectedReaderIdentity === 'same-account',
          ),
        ),
        true,
      )
    } else {
      await page.waitForFunction(
        () => window.result?.pages[0]?.reader.connected === false && !window.result.busy,
      )
      // Discovery must finish, so a previously cached alternate identity cannot hide an account switch.
      await page.evaluate(() => window.result.refresh())
      await page.waitForFunction(() => !window.result.busy)
      assert.equal(await page.evaluate(() => window.result.pages[0].pulls[0].title), 'Kept PR')
      assert.equal(
        await page.evaluate(() => window.reads.some((r) => r.id === 'b')),
        false,
        'Unverified or different account cannot silently take over',
      )
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  for (const alternateAccount of ['same-account', 'different-account']) {
    const cold = await browser.newPage()
    cold.setDefaultTimeout(8000)
    await cold.setContent('<div id="app"></div>')
    await cold.evaluate((account) => {
      window.offlineOrigin = true
      window.savedOriginIdentity = true
      window.alternateAccount = account
      window.filter = JSON.stringify(['a', 'repo-a'])
    }, alternateAccount)
    await cold.addScriptTag({ content: built.outputFiles[0].text })
    if (alternateAccount === 'same-account') {
      await cold.waitForFunction(
        () => window.result?.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
      )
      assert.equal(
        await cold.evaluate(() =>
          window.reads.every(
            (read) => read.id === 'b' && read.input.expectedReaderIdentity === 'same-account',
          ),
        ),
        true,
        'A cold offline view uses only a freshly verified same-account alternate',
      )
    } else {
      await cold.waitForFunction(
        () =>
          window.cacheReads.some(
            (read) => read.id === 'a' && JSON.parse(read.key)[0] === 'forge',
          ) &&
          window.result?.connected === false &&
          !window.result.busy,
      )
      assert.deepEqual(
        await cold.evaluate(() => window.reads),
        [],
        'Saved origin identity cannot authorize a different account',
      )
    }
    await cold.close()
  }
  for (const cold of [false, true]) {
    const rows = await browser.newPage()
    rows.setDefaultTimeout(8000)
    const errors = []
    rows.on('pageerror', (error) => errors.push(error.message))
    await rows.setContent('<div id="app"></div>')
    await rows.evaluate((cold) => {
      window.offlineOrigin = cold
      window.savedOriginIdentity = cold
      if (cold) window.filter = JSON.stringify(['a', 'repo-a'])
    }, cold)
    await rows.addScriptTag({ content: built.outputFiles[0].text })
    await rows.waitForFunction(() => window.result?.pages[0]?.pulls.length && !window.result.busy)
    if (!cold) {
      await rows.evaluate(() => {
        window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId !== 'a' }))
        window.render(false)
      })
      await rows.waitForFunction(
        () => window.result?.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
      )
    }
    assert.equal(await rows.evaluate(() => window.result.pages[0].source.runtimeId), 'a')
    assert.equal(await rows.evaluate(() => window.result.pages[0].pulls[0].destination), 'dest-a')
    assert.equal(
      await rows.evaluate(() =>
        window.cacheWrites
          .filter((w) => JSON.parse(w.key)[0] === 'pulls')
          .every((w) => w.id === 'a'),
      ),
      true,
    )
    await rows.evaluate(() => {
      window.mode = 'rows'
      window.render(false)
    })
    if (cold) {
      await rows.getByRole('button', { name: 'Filters', exact: true }).click()
      await rows.getByLabel('PR repository').selectOption(JSON.stringify(['a', 'repo-a']))
    }
    await rows.getByRole('button', { name: 'Open Kept PR', exact: true }).click()
    await rows.getByRole('textbox', { name: 'Comment draft' }).fill('Retain owner')
    assert.deepEqual(await rows.evaluate(() => window.navigation.pullTarget.runtimeId), 'a')
    assert.equal(await rows.locator('[data-owner="a"]').count(), 1)
    assert.equal(await rows.evaluate(() => window.rowDetail.detail.destination), 'dest-a')
    for (const name of ['Comment', 'PR actions', 'New task'])
      assert.equal(await rows.getByRole('button', { name, exact: true }).isEnabled(), false)
    assert.deepEqual(await rows.evaluate(() => window.writes), [])
    // Reconnecting enables real action handlers, still scoped to A's destination.
    await rows.evaluate(() => {
      window.sources = window.sources.map((s) => ({ ...s, connected: true }))
      window.render(false)
    })
    await rows.getByRole('button', { name: 'Comment', exact: true }).click()
    await rows.waitForFunction(() => window.writes.length === 1)
    assert.deepEqual(
      await rows.evaluate(() =>
        window.writes.map((w) => [w.runtimeId, w.input.repositoryId, w.input.expectedDestination]),
      ),
      [['a', 'repo-a', 'dest-a']],
    )
    assert.deepEqual(errors, [])
    await rows.close()
  }
  for (const field of ['destination', 'account']) {
    const race = await browser.newPage()
    race.setDefaultTimeout(8000)
    await race.setContent('<div id="app"></div>')
    await race.addScriptTag({ content: built.outputFiles[0].text })
    await race.waitForFunction(() => window.result?.pages[0]?.pulls.length && !window.result.busy)
    await race.evaluate(() => {
      window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId !== 'a' }))
      window.render(false)
    })
    await race.waitForFunction(
      () => window.result.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
    )
    await race.evaluate((field) => {
      window.cacheWrites = []
      window.dispatchRace = { id: 'b', field }
      window.result.more(window.result.pages[0].source.key)
    }, field)
    await race.waitForFunction(() =>
      window.result.pages[0]?.error?.includes('Source changed during dispatch'),
    )
    assert.equal(await race.evaluate(() => window.result.pages[0].pulls.length), 1)
    assert.deepEqual(
      await race.evaluate(() => window.cacheWrites.filter((w) => JSON.parse(w.key)[0] === 'pulls')),
      [],
      'Rejected pagination must not publish to the origin cache',
    )
    await race.evaluate(() => {
      window.dispatchRace = undefined
      window.result.refresh()
    })
    await race.waitForFunction(() => !window.result.busy && !window.result.pages[0].error)
    await race.evaluate(() => window.result.more(window.result.pages[0].source.key))
    await race.waitForFunction(
      () => window.result.pages[0]?.pulls.length === 2 && !window.result.busy,
    )
    assert.equal(
      await race.evaluate(() =>
        window.result.pages[0].pulls.every((p) => p.destination === 'dest-a'),
      ),
      true,
    )
    assert.equal(
      await race.evaluate(() =>
        window.reads
          .filter((r) => r.id === 'b')
          .every(
            (r) =>
              r.input.expectedDestination === 'dest-b' &&
              r.input.expectedReaderIdentity === 'same-account',
          ),
      ),
      true,
    )
    await race.close()
  }
  const rebound = await browser.newPage()
  rebound.setDefaultTimeout(8000)
  await rebound.setContent('<div id="app"></div>')
  await rebound.addScriptTag({ content: built.outputFiles[0].text })
  await rebound.waitForFunction(() => window.result?.pages[0]?.pulls.length && !window.result.busy)
  await rebound.evaluate(() => {
    window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId !== 'a' }))
    window.render(false)
  })
  await rebound.waitForFunction(
    () => window.result.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
  )
  await rebound.evaluate(() => {
    window.reads = []
    window.cacheWrites = []
    window.destinations.b = 'unrelated-repository'
    window.result.refresh()
  })
  await rebound.waitForFunction(
    () => !window.result.busy && window.result.pages[0]?.reader.connected === false,
  )
  assert.deepEqual(
    await rebound.evaluate(() => window.reads),
    [],
    'A rebind before discovery must not read the unrelated repository',
  )
  assert.deepEqual(
    await rebound.evaluate(() =>
      window.cacheWrites.filter((w) => JSON.parse(w.key)[0] === 'pulls'),
    ),
    [],
    'A rebound reader must not overwrite the origin cache',
  )
  assert.equal(await rebound.evaluate(() => window.result.pages[0].pulls[0].destination), 'dest-a')
  await rebound.close()
  await check('same')
  await check('different')
  await check('unknown')
  const failedDiscovery = await browser.newPage()
  await failedDiscovery.setContent('<div id="app"></div>')
  await failedDiscovery.addScriptTag({ content: built.outputFiles[0].text })
  await failedDiscovery.waitForFunction(
    () => window.result?.pages[0]?.pulls.length === 1 && !window.result.busy,
  )
  await failedDiscovery.evaluate(() => {
    window.reads = []
    window.discoveryFailures.a = true
    window.result.refresh()
  })
  await failedDiscovery.waitForFunction(
    () => window.result?.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
  )
  assert.equal(
    await failedDiscovery.evaluate(() => window.reads.every((r) => r.id === 'b')),
    true,
    'Failed discovery disqualifies a stale reader while retaining its expected account',
  )
  await failedDiscovery.evaluate(() => {
    window.discoveryFailures.b = true
    window.result.refresh()
  })
  await failedDiscovery.waitForFunction(
    () => window.result?.pages[0]?.reader.connected === false && !window.result.busy,
  )
  assert.equal(
    await failedDiscovery.evaluate(() => window.result.pages[0].pulls[0].title),
    'Kept PR',
  )
  await failedDiscovery.evaluate(() => {
    delete window.discoveryFailures.a
    window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId === 'a' }))
    window.render(false)
  })
  await failedDiscovery.waitForFunction(
    () =>
      window.result?.pages[0]?.source.runtimeId === 'a' &&
      window.result.pages[0].source.connected &&
      !window.result.busy,
  )
  assert.equal(
    await failedDiscovery.evaluate(() => window.reads.at(-1).input.expectedReaderIdentity),
    'same-account',
    'A recovered source still verifies the original account',
  )
  await failedDiscovery.close()
  const recovery = await browser.newPage()
  await recovery.setContent('<div id="app"></div>')
  await recovery.addScriptTag({ content: built.outputFiles[0].text })
  await recovery.waitForFunction(
    () => window.result?.pages[0]?.pulls.length === 1 && !window.result.busy,
  )
  await recovery.evaluate(() => {
    window.accounts.a = 'replacement-account'
    window.result.refresh()
  })
  await recovery.waitForFunction(
    () => window.result?.pages[0]?.reader.runtimeId === 'b' && !window.result.busy,
  )
  await recovery.evaluate(async () => {
    const key = window.sources[0].key
    await window.result.chooseReader(key)
    window.setFilter(key)
  })
  // Explicit choice is a new project-filter collection; the merged reader remains pinned.
  await recovery.waitForFunction(
    () =>
      window.result?.pages[0]?.source.connected === true &&
      !window.result.busy &&
      window.reads.at(-1)?.input.expectedReaderIdentity === 'replacement-account',
  )
  assert.equal(await recovery.evaluate(() => window.result.pages[0].source.runtimeId), 'a')
  await recovery.close()
  const detailPage = await browser.newPage()
  await detailPage.setContent('<div id="app"></div>')
  await detailPage.addScriptTag({ content: built.outputFiles[0].text })
  await detailPage.evaluate(() => {
    window.mode = 'detail'
    window.render(false)
  })
  await detailPage.waitForFunction(
    () => window.detailResult?.detail?.pull.title === 'Kept PR' && !window.detailResult.busy,
  )
  await detailPage.evaluate(() => {
    window.reads = []
    window.accounts.a = 'changed-origin-account'
    window.destinations.a = 'changed-origin-destination'
    window.detailResult.refresh()
  })
  await detailPage.waitForFunction(
    () =>
      window.reads.some((r) => r.id === 'b' && r.path === '/api/scm/pulls/detail') &&
      !window.detailResult.busy,
  )
  assert.equal(
    await detailPage.evaluate(() => window.detailResult.detail.pull.destination),
    'dest-a',
    'A changed origin account cannot relabel alternate data with its new destination',
  )
  await detailPage.evaluate(() => {
    window.reads = []
    window.store = { ...window.store, connected: false }
    window.sources = window.sources.map((s) => ({ ...s, connected: s.runtimeId !== 'a' }))
    window.render(false)
  })
  await detailPage.waitForFunction(
    () =>
      window.reads.some((r) => r.id === 'b' && r.path === '/api/scm/pulls/detail') &&
      !window.detailResult.busy,
  )
  assert.equal(
    await detailPage.evaluate(() => window.detailResult.detail.pull.destination),
    'dest-a',
    'Alternate reader cannot replace the original mutation destination',
  )
  assert.equal(await detailPage.evaluate(() => window.store.activeRuntimeId), 'a')
  assert.equal(
    await detailPage.evaluate(() => window.store.connected),
    false,
    'Mutations remain offline on their original source',
  )
  assert.equal(
    await detailPage.evaluate(() =>
      window.reads
        .filter((r) => r.path === '/api/scm/pulls/detail')
        .every((r) => r.input.expectedReaderIdentity === 'same-account'),
    ),
    true,
  )
  await detailPage.evaluate(() => {
    window.reads = []
    window.sources = window.sources.map((s) => ({ ...s, connected: false }))
    window.mount = (window.mount ?? 0) + 1
    window.render(false)
  })
  await detailPage.waitForFunction(
    () => window.detailResult?.detail?.stale && !window.detailResult.busy,
  )
  assert.equal(await detailPage.evaluate(() => window.detailResult.detail.pull.title), 'Kept PR')
  assert.equal(await detailPage.evaluate(() => window.reads.length), 0)
  assert.equal(
    await detailPage.evaluate(() =>
      window.cacheReads.some(
        ({ id, key }) =>
          id === 'a' &&
          key ===
            JSON.stringify([
              'pulls',
              'detail',
              'repo-a',
              '/repo',
              7,
              window.sources[0].repository.forge,
            ]),
      ),
    ),
    true,
    'Offline details retain the cache key used before connection selection was added',
  )
  await detailPage.close()
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
    'Desktop source readers passed: account/destination dispatch and pagination guards; warm/cold PR rows and newly refreshed issue/pipeline rows retain the origin and cache; offline comments/merge/tasks disabled and reconnect writes remain on the origin; same-account handoff, remount, discovery failure and account recovery. Jira issue overview/options/discussion delays, failures, retries, comment pagination and scoped caches passed. Transport and UI primitives mocked; actual list/detail routing, issue layout and action controls exercised.',
  )
} finally {
  await browser.close()
}
