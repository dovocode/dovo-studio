import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real list rows, intent hook, PR list/detail hooks, source readers and runtime scope. Transport,
// menus and presentation primitives are mocked.
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `${root}/packages/studio-core/src`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {Effect} from 'effect';
import {decode,RuntimeRequestError} from '@dovo/protocol';
import {WorkspaceContext} from '${core}/workspace/context';
import {ApplicationStateProvider} from '${core}/runtime/application-state';
import {WorkspaceRuntimeScope} from '${core}/workspace/runtime-scope';
import {usePullDetail} from '${root}/packages/extension-scm/src/pulls/detail/use-pull-detail';
import {usePulls} from '${root}/packages/extension-scm/src/pulls/list/use-pulls';
import {usePullIntentPrefetch} from '${root}/packages/extension-scm/src/pulls/list/intent-prefetch';
import {PullRow} from '${root}/packages/extension-scm/src/pulls/list/row';
const profile={id:'owner',name:'Owner',connection:{address:'http://owner.local',token:'paired-fixture'}};
window.requests=[];window.held=new Map();window.account='account';window.destination='destination';
const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void,removeEffect:()=>Effect.void};
const runtimeReadCache=()=>cache;
const summary=number=>({number,title:'PR '+number,url:'https://github.com/team/project/pull/'+number,state:'open',draft:false,author:'Dominic',viewerIsAuthor:true,updatedAt:'2026-10-27',head:'feature-'+number,base:'main',labels:[]});
const readRuntimeEffect=(_profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
  window.requests.push({path,input});
  if(path==='/api/scm/source/identity')return decode(schema,{readerIdentity:window.account,destination:window.destination});
  // The runtime guard: a pinned account or destination that no longer matches is rejected.
  if(input.expectedReaderIdentity!==undefined&&input.expectedReaderIdentity!==window.account)throw new RuntimeRequestError({kind:'response',status:409,message:'This integration reader account changed. Refresh before continuing.'});
  if(input.expectedDestination!==undefined&&input.expectedDestination!==window.destination)throw new RuntimeRequestError({kind:'response',status:409,message:'This integration destination or account changed.'});
  if(path==='/api/scm/pulls/overview')return decode(schema,{pulls:[1,2,3,4,5,6,7].map(summary),page:1,hasMore:false});
  if(input.section==='overview'&&window.hold?.includes(input.number))await new Promise(resolve=>window.held.set(input.number,resolve));
  const pull=summary(input.number);
  return decode(schema,{destination:window.destination,pull:{...pull,title:'Loaded PR '+input.number,body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:1,deletions:0,changedFiles:1,mergeable:true,reviewers:[],assignees:[]},files:[],comments:[],checks:[],warnings:[]});
},catch:error=>error});
const readRuntime=(...args)=>Effect.runPromise(readRuntimeEffect(...args));
const requestEffect=(...args)=>readRuntimeEffect(profile,...args);
function Detail({number}){const result=usePullDetail('repo',number);window.detail=result;return <p>{result.detail?.pull.title??'Loading PR '+number}{result.error?' · '+result.error:''}</p>}
function List(){
  const list=usePulls('open','');window.list=list;
  const [selected,setSelected]=useState(null);
  const pulls=window.hiddenRows?[]:list.pages.flatMap(page=>page.pulls.map(pull=>({...pull,source:page.source})));
  window.intentTarget=null;
  const {intent,prefetch}=usePullIntentPrefetch(target=>(window.intentTarget=target.number,true)&&selected!==target.number&&pulls.some(pull=>pull.number===target.number&&pull.source.key===target.source.key&&pull.source.connected));
  window.removeRows=()=>window.setHidden(true);
  return <div>
    {pulls.map(pull=><PullRow key={pull.number} pull={pull} repository="Project" selected={selected===pull.number} onSelect={()=>setSelected(pull.number)} onIntent={resting=>intent(resting?{source:pull.source,number:pull.number}:null)}/>)}
    {prefetch}
    {selected&&<WorkspaceRuntimeScope runtimeId={profile.id}><Detail key={selected} number={selected}/></WorkspaceRuntimeScope>}
  </div>;
}
function App(){const [,setHidden]=useState(false);window.setHidden=value=>{window.hiddenRows=value;setHidden(value)};
 const workspace={version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main',gitIdentity:'github.com/team/project',pullIdentity:'github.com/team/project'}],tasks:[],agents:[],automations:[]};
 const snapshot={revision:1,workspace};
 const value={activeRuntimeId:profile.id,connection:profile.connection,workspace,snapshot,connected:true,runtimes:[{profile,snapshot,connected:true}],readRuntime,readRuntimeEffect,runtimeReadCache,readCache:cache,requestEffect,refreshRuntime:async()=>{},setWorkspace:()=>{},pendingMessages:()=>[]};
 return <WorkspaceContext value={value}><List/></WorkspaceContext>;
}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);`,
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
    nodePaths: [root + '/node_modules', root + '/packages/studio-core/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {useWorkspace} from '${core}/workspace/context';export {useRepositorySources} from '${core}/workspace/repository-sources';export {WorkspaceRuntimeScope} from '${core}/workspace/runtime-scope';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling';export {clientTaskScope} from '${root}/packages/client-runtime/src/effects/task-scope';export const formatDateTime=value=>String(value);`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useApplicationState} from '${core}/runtime/application-state';`,
    },
    {
      path: './provider',
      importer: core + '/workspace/repository-sources.ts',
      contents: `export {useWorkspace} from '${core}/workspace/context';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `const Pass=({children})=><>{children}</>;const None=()=>null;const menu={Root:Pass,Trigger:Pass,Portal:None,Content:None,Item:None,Label:None,Separator:None};export const ContextMenu=menu;export const DropdownMenu=menu;export const Badge=({children})=><span>{children}</span>;`,
    },
    {
      path: '../detail/status',
      importer: root + '/packages/extension-scm/src/pulls/list/',
      contents: `export const Signal=()=>null;`,
    },
  ],
)

const detailReads = (number) =>
  `window.requests.filter((request) => request.path === '/api/scm/pulls/detail' && request.input.number === ${number})`
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('PR 5', { exact: true }).waitFor()
  // The list's discovery has verified the account before any intent.
  await page.waitForFunction(() =>
    window.requests.some((request) => request.path === '/api/scm/source/identity'),
  )
  await page.clock.pauseAt(Date.now() + 1000)
  const row = (number) =>
    page.locator('button.studio-collection-row', { hasText: `PR ${number}` }).first()
  const identityCalls = () =>
    page.evaluate(
      () => window.requests.filter((request) => request.path === '/api/scm/source/identity').length,
    )

  // Passing over a row for less than the intent delay sends nothing.
  await row(1).hover()
  await page.clock.runFor(100)
  await page.mouse.move(0, 0)
  await page.clock.runFor(1000)
  assert.equal(await page.evaluate(`${detailReads(1)}.length`), 0, 'A passing pointer prefetched')

  // A resting pointer prefetches only the overview, with the verified guard and no lookup.
  const identityBefore = await identityCalls()
  await page.evaluate(() => {
    window.hold = [2]
  })
  await row(2).hover()
  await page.clock.runFor(149)
  assert.equal(await page.evaluate(`${detailReads(2)}.length`), 0, 'Prefetch ran before 150 ms')
  await page.clock.runFor(1)
  await page.waitForFunction(`${detailReads(2)}.length === 1`)
  const prefetched = await page.evaluate(`${detailReads(2)}[0].input`)
  assert.equal(prefetched.section, 'overview')
  assert.equal(prefetched.expectedReaderIdentity, 'account')
  assert.equal(prefetched.expectedDestination, 'destination')
  assert.equal(prefetched.refresh, false)
  assert.equal(await identityCalls(), identityBefore, 'Prefetch added an identity lookup')

  // A sustained rest does not poll, and a click joins the pending prefetch at once.
  await page.clock.runFor(29_000)
  assert.equal(await page.evaluate(`${detailReads(2)}.length`), 1, 'A resting prefetch polled')
  await row(2).click()
  await page.getByText('Loading PR 2', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      `${detailReads(2)}.filter((read) => read.input.section === 'overview').length`,
    ),
    1,
    'The opened detail did not share the prefetched overview read',
  )
  await page.evaluate(() => window.held.get(2)())
  await page.getByText('Loaded PR 2', { exact: true }).waitFor()
  const sections = await page.evaluate(
    `[...new Set(${detailReads(2)}.map((read) => read.input.section))]`,
  )
  assert.ok(sections.includes('status'), 'The opened detail loads its own further sections')

  // Opened details reuse the verified account: section polls need no identity lookups. Only the
  // two 30-second discovery pollers (list and detail) ask for identity.
  const pollIdentity = await identityCalls()
  const pollReads = await page.evaluate(`${detailReads(2)}.length`)
  for (let second = 0; second < 120; second += 10) await page.clock.runFor(10_000)
  await page.clock.runFor(100)
  const polled = (await page.evaluate(`${detailReads(2)}.length`)) - pollReads
  const lookups = (await identityCalls()) - pollIdentity
  console.log(
    JSON.stringify({ fixture: 'open PR detail, two idle minutes', reads: polled, lookups }),
  )
  assert.ok(polled >= 8, 'Detail did not poll its sections')
  assert.ok(lookups <= 8, 'Detail reads preflighted the account')
  assert.ok(
    (await page.evaluate(`${detailReads(2)}`)).every(
      (read) =>
        read.input.expectedReaderIdentity === 'account' &&
        read.input.expectedDestination === 'destination',
    ),
    'A detail read was sent without its verified guard',
  )

  // A click without any rest opens and reads at once; it never waits for the intent delay.
  await page.evaluate(() => {
    window.hold = []
  })
  await row(3).click()
  await page.clock.runFor(1)
  await page.waitForFunction(`${detailReads(3)}.length > 0`)
  await page.getByText('Loaded PR 3', { exact: true }).waitFor()

  // Leaving a row before its response stops the waiter and starts no later reads.
  await page.evaluate(() => {
    window.hold = [4]
  })
  await row(4).hover()
  await page.clock.runFor(150)
  await page.waitForFunction(`${detailReads(4)}.length === 1`)
  await page.mouse.move(0, 0)
  await page.clock.runFor(10)
  await page.evaluate(() => window.held.get(4)())
  await page.clock.runFor(61_000)
  assert.equal(await page.evaluate(`${detailReads(4)}.length`), 1, 'A left row kept reading')

  // Switching rows while the first keeps focus fires no leave event for it. The first row's
  // prefetch unmounts at once, not when the second row's timer fires. Its one sent read is not
  // cancelled: it finishes into the shared cache with no follow-up reads or polling.
  await page.evaluate(() => {
    window.hold = [6]
  })
  await row(6).focus()
  await page.clock.runFor(150)
  await page.waitForFunction(`${detailReads(6)}.length === 1`)
  assert.equal(await page.evaluate(() => window.intentTarget), 6)
  await row(7).hover()
  await page.waitForFunction(() => window.intentTarget === null)
  await page.clock.runFor(149)
  assert.equal(await page.evaluate(`${detailReads(7)}.length`), 0, 'Row B read before its rest')
  await page.evaluate(() => window.held.get(6)())
  await page.clock.runFor(1)
  await page.waitForFunction(`${detailReads(7)}.length === 1`)
  assert.equal(await page.evaluate(() => window.intentTarget), 7)
  await page.mouse.move(0, 0)
  await page.waitForFunction(() => window.intentTarget === null)
  await page.clock.runFor(61_000)
  assert.equal(await page.evaluate(`${detailReads(6)}.length`), 1, 'Row A read again after switch')
  assert.equal(await page.evaluate(`${detailReads(7)}.length`), 1, 'Row B read again after leave')
  assert.ok(
    (await page.evaluate(`[...${detailReads(6)}, ...${detailReads(7)}]`)).every(
      (read) => read.input.section === 'overview',
    ),
    'Prefetch read a section other than the overview',
  )
  await row(6).evaluate((element) => element.blur())

  // A removed row fires no leave event, but its pending intent and prefetch still stop.
  await row(5).hover()
  await page.clock.runFor(100)
  await page.evaluate(() => window.removeRows())
  await page.clock.runFor(1000)
  assert.equal(await page.evaluate(`${detailReads(5)}.length`), 0, 'A removed row prefetched')
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.setHidden(false))
  await page.getByText('PR 5', { exact: true }).waitFor()

  // An account change is rejected by the runtime guard. Prefetch never sends the new account,
  // and the rejection rediscovers the source instead of retrying the read.
  const beforeChange = await identityCalls()
  await page.evaluate(() => {
    window.account = 'replacement-account'
  })
  await row(5).hover()
  await page.clock.runFor(150)
  await page.waitForFunction(`${detailReads(5)}.length === 1`)
  await page.waitForFunction((before) => {
    const calls = window.requests.filter((request) => request.path === '/api/scm/source/identity')
    return calls.length > before
  }, beforeChange)
  await page.clock.runFor(1000)
  const changed = await page.evaluate(`${detailReads(5)}`)
  assert.equal(changed.length, 1, 'A rejected prefetch was retried')
  assert.equal(changed[0].input.expectedReaderIdentity, 'account')
  assert.ok(
    (await page.evaluate(() => window.requests)).every(
      (request) => request.input.expectedReaderIdentity !== 'replacement-account',
    ),
    'A read adopted the replacement account without an explicit choice',
  )
  assert.deepEqual(errors, [])
  console.log(
    'PR intent prefetch: passing pointer sends nothing; 150 ms rest reads one guarded overview with no identity lookup and no polling; click joins it at once; unprefetched click reads at once; leave, row switch and removal unmount it at once and its one sent read finishes without follow-ups; opened detail polls without identity preflights; account changes are rejected and rediscovered, never adopted.',
  )
} finally {
  await browser.close()
}
