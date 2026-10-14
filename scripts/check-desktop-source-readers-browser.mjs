import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const state = `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,set]=useState(initial);const ref=useRef(value);ref.current=value;return [value,next=>{ref.current=typeof next==='function'?next(ref.current):next;set(ref.current)},ref]}`
const mocks = {
  '@dovo/studio-core': `export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useRepositorySources=()=>window.sources;export const useWorkspace=()=>window.store;export const formatDateTime=value=>String(value);`,
  '@dovo/studio-core/state': state,
  '@dovo/studio-ui': `export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const PageHeader=({title,leading,children})=><header><h1>{title}</h1>{leading}{children}</header>;export const Input=props=><input {...props}/>;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Dialog=({children})=><div>{children}</div>;export const DialogContent=Dialog;export const DialogHeader=Dialog;export const DialogTitle=Dialog;export const DialogDescription=Dialog;export const MessageResponse=({children})=><div>{children}</div>;`,
  './work-sources': `export {workRemoteKey} from '${root}packages/extension-scm/src/work/work-source-identity.ts';export const useIssueSources=()=>window.sources;`,
  './work-form': `export const WorkForm=()=>null;`,
  './issue-detail': `import {IssueDetail as Real} from '${root}packages/extension-scm/src/work/issue-detail.tsx';export const IssueDetail=props=>{window.workDetail=props.detail;return <Real {...props}/>};`,
  './pipeline-detail': `import {PipelineDetail as Real} from '${root}packages/extension-scm/src/work/pipeline-detail.tsx';export {PipelineState} from '${root}packages/extension-scm/src/work/pipeline-detail.tsx';export const PipelineDetail=props=>{window.workDetail=props.detail;return <Real {...props}/>};`,
  './work-task-links': `export const WorkTaskLinks=()=>null;`,
}
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';import {decode,RuntimeRequestError} from '@dovo/protocol';
import {WorkContent} from '${root}packages/extension-scm/src/work/content.tsx';
import {usePulls} from '${root}packages/extension-scm/src/pulls/list/use-pulls.ts';import {usePullDetail} from '${root}packages/extension-scm/src/pulls/detail/use-pull-detail.ts';
window.reads=[];window.discoveryFailures={};window.cacheReads=[];window.accounts={a:'same-account',b:'same-account'};window.destinations={a:'dest-a',b:'dest-b'};window.active='a';window.legacy=false;
const saved=new Map();
const source=id=>{const profile={id,name:id,connection:{address:'http://'+id,token:'paired-'+id}};const repository={id:'repo-'+id,name:'Project',path:'/repo',gitIdentity:'github.com/team/project',pullIdentity:'github.com/team/project',forge:{connectionId:'local-'+id,repository:'team/project'}};const cache={readEffect:(key,schema)=>Effect.sync(()=>{window.cacheReads.push({id,key});return saved.has(id+key)?{value:decode(schema,saved.get(id+key)),cachedAt:'2026-10-14'}:null}),writeEffect:(key,value)=>Effect.sync(()=>{saved.set(id+key,value)})};return {key:JSON.stringify([id,repository.id]),scope:JSON.stringify([id,profile.connection,repository.forge]),runtimeId:id,runtimeName:id,profile,repository,connected:true,readCache:cache,requestEffect:(path,input,schema)=>Effect.try({try:()=>{if(path==='/api/scm/source/identity'){if(window.discoveryFailures[id])throw new RuntimeRequestError({kind:'response',status:503,message:'Discovery unavailable'});if(window.legacy)throw new RuntimeRequestError({kind:'response',status:404,message:'Old runtime'});return decode(schema,{readerIdentity:window.accounts[id],destination:window.destinations[id]})}window.reads.push({id,path,input});if(input.expectedReaderIdentity&&input.expectedReaderIdentity!==window.accounts[id])throw new RuntimeRequestError({kind:'response',status:409,message:'Account changed'});if(path==='/api/scm/work/options')return decode(schema,{provider:'github',issues:true,pipelines:true,pipelineActions:[],destination:window.destinations[id]});
if(path==='/api/scm/work/issues/detail')return decode(schema,{destination:window.destinations[id],issue:{id:'7',title:'Kept issue',body:'Description',state:'open',url:'https://github.com/team/project/issues/7',author:'Dominic',assignees:[],labels:[],updatedAt:'2026-10-14',revision:'same-revision',destination:window.destinations[id]},comments:[{id:input.cursor?'second':'first',body:'Page',author:'Dominic',createdAt:'2026-10-14'}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/work/pipelines/detail')return decode(schema,{destination:window.destinations[id],run:{id:'7',title:'Kept run',url:'https://github.com/team/project/actions/runs/7',ref:'main',sha:'same-sha',actor:'Dominic',status:'success',createdAt:'2026-10-14',updatedAt:'2026-10-14',destination:window.destinations[id]},jobs:[{id:input.cursor?'second':'first',name:'Job',status:'success',url:'https://github.com/team/project/actions/runs/7'}],next:input.cursor?undefined:'page-2'});
if(path==='/api/scm/pulls/detail')return decode(schema,{destination:window.destinations[id],pull:{number:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[],destination:window.destinations[id]},files:[],comments:[],checks:[],warnings:[]});return decode(schema,{pulls:[{number:7,title:'Kept PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-14',head:'branch',base:'main',labels:[],viewerIsAuthor:true,destination:window.destinations[id]}],page:1,hasMore:false})},catch:e=>e})}};
window.sources=['a','b'].map(source).map(s=>({...s,name:s.repository.name,input:{repositoryId:s.repository.id},request:(path,input,schema)=>Effect.runPromise(s.requestEffect(path,input,schema)),readCache:{...s.readCache,read:(key,schema)=>Effect.runPromise(s.readCache.readEffect(key,schema)),write:(key,value)=>Effect.runPromise(s.readCache.writeEffect(key,value))}}));window.store={activeRuntimeId:'a',workspace:{repositories:[window.sources[0].repository]},connected:true,requestEffect:window.sources[0].requestEffect,readCache:window.sources[0].readCache};
function View(){const [filter,setFilter]=useState(window.filter??'');window.setFilter=value=>{window.filter=value;setFilter(value)};const result=usePulls('open',filter);window.result=result;return <pre>{JSON.stringify(result.pages.map(p=>({owner:p.source.runtimeId,error:p.error,cached:p.stale,pulls:p.pulls})))}</pre>}
function Detail(){const result=usePullDetail('repo-a',7);window.detailResult=result;return <pre>{JSON.stringify(result.detail)}</pre>}
function Work(){return <WorkContent repositoryId="repo-a" repositoryName="Project" collectionHeader={null} initialSelected="7" mode={window.workMode} request={window.sources[0].request} connected={window.store.connected}/>}
const app=createRoot(document.getElementById('app'));window.render=remount=>app.render(window.mode==='work'?<Work key={window.mount??0}/>:window.mode==='detail'?<Detail key={window.mount??0}/>:<View key={remount?window.mount=(window.mount??0)+1:window.mount??0}/>);window.render(false);
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
          window.result?.pages[0]?.source.runtimeId === 'b' &&
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
        () => window.result?.pages[0]?.source.connected === false && !window.result.busy,
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
    () => window.result?.pages[0]?.source.runtimeId === 'b' && !window.result.busy,
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
    () => window.result?.pages[0]?.source.connected === false && !window.result.busy,
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
    () => window.result?.pages[0]?.source.runtimeId === 'b' && !window.result.busy,
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
  console.log(
    'Actual desktop PR readers: identity-verified same-account handoff, remount/global selection retention and readonly cached data without unknown/different-account handoff passed.',
  )
} finally {
  await browser.close()
}
