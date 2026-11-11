import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = root + '/apps/mobile/src'
async function fixture(platform) {
  const native = platform === 'mobile'
  return bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {RegistryProvider} from '@effect/atom-react';
import {Effect} from 'effect';
import {decode,snapshotSchema} from '@dovo/protocol';
${
  native
    ? `
import {RuntimeContext} from '${mobile}/runtime/connection/provider';
import {NavigationContext} from '${mobile}/shell/navigation';
import {usePullDetail} from '${mobile}/scm/pulls/detail/use-pull-detail';
import {usePulls} from '${mobile}/scm/pulls/list/use-pulls';
`
    : `
import {WorkspaceContext} from '${root}/packages/studio-core/src/workspace/context';
import {ApplicationStateProvider} from '${root}/packages/studio-core/src/runtime/application-state';
import {usePullDetail} from '${root}/packages/extension-scm/src/pulls/detail/use-pull-detail';
import {usePulls} from '${root}/packages/extension-scm/src/pulls/list/use-pulls';
`
}
const profile={id:'owner',name:'Owner',createdAt:'2026-10-27',connection:{address:'http://owner.lan',token:'paired-fixture'}};
window.reads=[];window.wireBytes=0;window.cacheWrites=0;window.sectionWrites=0;window.revision=0;window.pages=[[7,6],[5,4]];
const cache={readEffect:()=>Effect.succeed(null),writeEffect:key=>Effect.sync(()=>{window.cacheWrites++;if(JSON.parse(key)[1]==='detail-section'||JSON.parse(key)[1]==='list-v2'&&JSON.parse(key)[4]!=='identity')window.sectionWrites++}),removeEffect:()=>Effect.void};
const runtimeReadCache=()=>cache;
const pull=number=>({number,title:'PR '+number+' revision '+window.revision,url:'https://github.com/team/project/pull/'+number,state:'open',draft:false,author:'Dominic',viewerIsAuthor:true,updatedAt:'2026-10-27',head:'feature',base:'main',labels:[]});
const readRuntimeEffect=(_profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
  if(path.endsWith('/identity')) return decode(schema,{readerIdentity:'account',destination:'destination'});
  window.reads.push({path,input});
  if(input.page===2&&window.failLaterPage)throw Error('Older page unavailable');
  const pageVersion=JSON.stringify(window.pages[input.page-1]);
  const version=path.endsWith('/overview') ? pageVersion+':'+(input.page===2?window.olderRevision??0:0) : window.revision+':'+window.pending+':'+window.revalidating;
  // Versions are opaque in the hooks; use a deterministic, schema-valid fixture digest.
  let hash=0;for(const char of version)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  const readVersion=hash.toString(16).padStart(64,'0');
  const value=path.endsWith('/overview')
    ? {pulls:(window.pages[input.page-1]??[]).map(number=>({...pull(number),title:'PR '+number+' older '+(input.page===2?window.olderRevision??0:0)})),page:input.page,hasMore:input.page<window.pages.length}
    : {destination:'destination',pull:{...pull(7),body:'Description '+'x'.repeat(16000),headSha:'a'.repeat(40),baseSha:'b'.repeat(40),checksState:window.pending?'PENDING':'SUCCESS',repositoryUrl:'https://github.com/team/project',additions:1,deletions:0,changedFiles:1,mergeable:true,reviewers:[],assignees:[]},files:[],comments:[],checks:window.pending?[{name:'Build',status:'IN_PROGRESS'}]:[],warnings:[]};
  const reply=input.conditional&&input.knownVersion===readVersion ? {unchanged:true,readVersion} : {...value,readVersion,stale:!!window.revalidating};
  window.wireBytes+=JSON.stringify(reply).length;
  return decode(schema,reply);
},catch:error=>error});
const readRuntime=(...args)=>Effect.runPromise(readRuntimeEffect(...args));
const requestEffect=(...args)=>readRuntimeEffect(profile,...args);
function View({id}){const result=usePullDetail('repo',7);window.details??={};window.details[id]=result;return <p>{result.detail?.pull.title??'Loading PR'}</p>}
function List(){const result=${native ? "usePulls(JSON.stringify(['owner','repo']),'open')" : "usePulls('open',JSON.stringify(['owner','repo']))"};window.list=result;return <div>{result.pages.flatMap(page=>page.pulls.map(pull=><p key={pull.number}>{pull.title}</p>))}</div>}
function App(){const[consumers,setConsumers]=useState(1);window.addConsumer=()=>setConsumers(2);
 const workspace={version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main',pullIdentity:'github.com/team/project',gitIdentity:'github.com/team/project'}],tasks:[],agents:[],automations:[]};
 const snapshot=decode(snapshotSchema,{revision:1,owner:false,workspace,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
 const value={activeRuntimeId:profile.id,activeId:profile.id,profile,connection:profile.connection,workspace,snapshot,connected:true,runtimes:[{profile,snapshot,connected:true}],overviews:[{profile,snapshot,connected:true}],profiles:[profile],readRuntime,readRuntimeEffect,runtimeReadCache,cacheForRuntime:runtimeReadCache,readCache:cache,requestEffect,readEffect:requestEffect};
 const children=window.listMode?<List/>:<>{Array.from({length:consumers},(_,id)=><View key={id} id={id}/>)}</>;
 return ${native ? '<RuntimeContext value={value}><NavigationContext value={{focused:true}}>{children}</NavigationContext></RuntimeContext>' : '<WorkspaceContext value={value}>{children}</WorkspaceContext>'};
}
createRoot(document.getElementById('app')).render(<RegistryProvider>${native ? '<App/>' : '<ApplicationStateProvider><App/></ApplicationStateProvider>'}</RegistryProvider>);`,
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
    native
      ? [
          {
            path: mobile + '/runtime/connection/provider',
            contents: `import {createContext,useContext} from 'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);`,
          },
          {
            path: '../runtime/connection/provider',
            importer: mobile + '/scm/source-reader.ts',
            contents: `export {useRuntime} from '${mobile}/runtime/connection/provider';`,
          },
          {
            path: '../../../runtime/connection/provider',
            importer: mobile + '/scm/pulls/',
            contents: `export {useRuntime} from '${mobile}/runtime/connection/provider';`,
          },
          {
            path: 'react-native',
            contents: `export const AppState={currentState:'active',addEventListener:(name,callback)=>{(window.appStateListeners??=new Set()).add(callback);return{remove(){window.appStateListeners.delete(callback)}}}};export const Alert={alert(){throw Error('Unexpected alert')}};`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export {useWorkspace} from '${root}/packages/studio-core/src/workspace/context';export {useRepositorySources} from '${root}/packages/studio-core/src/workspace/repository-sources';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling';export {clientTaskScope} from '${root}/packages/client-runtime/src/effects/task-scope';`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: `export {useApplicationState} from '${root}/packages/studio-core/src/runtime/application-state';`,
          },
          {
            path: './provider',
            importer: root + '/packages/studio-core/src/workspace/repository-sources.ts',
            contents: `export {useWorkspace} from '${root}/packages/studio-core/src/workspace/context';`,
          },
        ],
  )
}
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const built = await fixture(platform)
    const errors = []
    const createPage = async (list = false) => {
      const page = await browser.newPage()
      page.setDefaultTimeout(7000)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.clock.install()
      await page.setContent('<div id="app"></div>')
      await page.evaluate((list) => (window.listMode = list), list)
      await page.addScriptTag({ content: built.outputFiles[0].text })
      return page
    }
    const page = await createPage()
    await page.waitForFunction(
      () => window.details?.[0]?.sections.status.ready && window.details[0].sections.stack.ready,
    )
    const initial = await page.evaluate(() => window.reads.length)
    await page.evaluate(() => window.addConsumer())
    await page.waitForFunction(
      () => window.details?.[1]?.sections.status.ready && window.details[1].sections.stack.ready,
    )
    assert.equal(
      await page.evaluate(() => window.reads.length),
      initial,
      'Opening a second panel shares live reads',
    )
    await page.evaluate(() => {
      window.reads = []
      window.wireBytes = 0
      window.cacheWrites = 0
      window.sectionWrites = 0
    })
    await page.clock.runFor(61000)
    const metrics = await page.evaluate(() => ({
      reads: window.reads.length,
      bytes: window.wireBytes,
      diskWrites: window.cacheWrites,
      sectionWrites: window.sectionWrites,
    }))
    assert.ok(metrics.reads > 0 && metrics.reads <= 8, 'Poll without duplicate section requests')
    assert.ok(
      metrics.bytes > 0 && metrics.bytes <= 800,
      'Unchanged descriptions do not cross the wire',
    )
    assert.equal(metrics.sectionWrites, 0, 'Do not rewrite unchanged section snapshots')
    // An explicit refresh runs immediately, even inside the short reuse window.
    await page.evaluate(() => {
      window.revision = 1
      window.details[0].refresh()
    })
    await page.waitForFunction(
      () =>
        window.details[0].detail?.pull.title === 'PR 7 revision 1' &&
        Object.values(window.details[0].sections).every(
          (section) => !section.busy && !section.refreshing,
        ),
    )
    assert.ok(
      await page.evaluate(() => window.reads.some((read) => read.input.refresh)),
      'Refresh reaches the runtime',
    )
    // A cached description must follow its background refresh promptly.
    await page.evaluate(() => {
      window.revalidating = true
      window.details[0].refresh()
    })
    await page.waitForFunction(
      () => window.details[0].sections.overview.detail?.stale && !window.details[0].busy,
    )
    await page.evaluate(() => {
      window.revalidating = false
      window.revision = 2
    })
    await page.clock.runFor(2001)
    await page.waitForFunction(
      () =>
        window.details[0].detail?.pull.title === 'PR 7 revision 2' &&
        !window.details[0].sections.overview.detail.stale,
    )
    await page.evaluate(() => {
      window.pending = true
      window.details[0].refresh()
    })
    await page.waitForFunction(() => window.details[0].detail?.pull.checksState === 'PENDING')
    const before = await page.evaluate(
      () => window.reads.filter((read) => read.input.section === 'status').length,
    )
    await page.clock.runFor(10001)
    assert.ok(
      await page.evaluate(
        (before) => window.reads.filter((read) => read.input.section === 'status').length > before,
        before,
      ),
      'Running checks retain fast updates',
    )
    await page.close()

    const list = await createPage(true)
    await list.waitForFunction(() => window.list?.pages[0]?.pulls.length === 2)
    await list.evaluate(() =>
      window.list.more(window.list.pages[0].source?.key ?? window.list.pages[0].sourceKey),
    )
    await list.waitForFunction(() => window.list.pages[0].page === 2)
    await list.evaluate(() => {
      window.reads = []
      window.wireBytes = 0
      window.cacheWrites = 0
      window.sectionWrites = 0
    })
    await list.clock.runFor(61000)
    assert.equal(
      await list.evaluate(() => window.reads.filter((read) => read.input.page === 2).length),
      0,
      'Unchanged page one preserves the opened prefix',
    )
    assert.equal(await list.evaluate(() => window.list.pages[0].pulls.length), 4)
    assert.equal(
      await list.evaluate(() => window.sectionWrites),
      0,
      'Unchanged overview polls do not rewrite PR snapshots',
    )
    await list.evaluate(() => (window.olderRevision = 1))
    await list.clock.runFor(61000)
    await list.waitForFunction(() =>
      window.list.pages[0].pulls.some((pull) => pull.title === 'PR 5 older 1'),
    )
    // A shifted boundary cannot publish a mix of old and new pages, even on a failed read.
    await list.evaluate(() => {
      window.pages = [
        [8, 7],
        [6, 5],
      ]
      window.failLaterPage = true
    })
    await list.clock.runFor(31000)
    await list.waitForFunction(() => !!window.list.pages[0].error)
    assert.deepEqual(
      await list.evaluate(() => window.list.pages[0].pulls.map((pull) => pull.number)),
      [7, 6, 5, 4],
    )
    await list.evaluate(() => (window.failLaterPage = false))
    await list.clock.runFor(31000)
    await list.waitForFunction(
      () => !window.list.pages[0].error && window.list.pages[0].pulls[0]?.number === 8,
    )
    assert.deepEqual(
      await list.evaluate(() => window.list.pages[0].pulls.map((pull) => pull.number)),
      [8, 7, 6, 5],
    )
    await list.close()
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        fixture: 'one idle minute, two ' + platform + ' PR consumers, 16 KB description',
        ...metrics,
      }),
    )
  }
} finally {
  await browser.close()
}
