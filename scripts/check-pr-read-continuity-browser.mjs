import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {Effect} from 'effect';
import {decode,pullDetailSchema} from '@dovo/protocol';
import {WorkspaceContext} from '${root}/packages/studio-core/src/workspace/context';
import {ApplicationStateProvider} from '${root}/packages/studio-core/src/runtime/application-state';
import {usePullDetail} from '${root}/packages/extension-scm/src/pulls/detail/use-pull-detail';
import {usePulls} from '${root}/packages/extension-scm/src/pulls/list/use-pulls';
const profile={id:'owner',name:'Owner',connection:{address:'http://owner.local',token:'paired-fixture'}};
window.reads=[];window.releaseReads=[];window.rendered=0;
const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void,removeEffect:()=>Effect.void};
const runtimeReadCache=()=>cache;
const readRuntimeEffect=(_profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
  if(path==='/api/scm/source/identity'){
    if(window.identityFailure){window.identityErrors=(window.identityErrors??0)+1;throw new Error('Identity temporarily unavailable')}
    return decode(schema,{readerIdentity:'account',destination:'destination'});
  }
  window.reads.push({path,input});
  if(path==='/api/scm/pulls/overview'){
    if(input.page===2)await new Promise(resolve=>window.releaseReads.push(resolve));
    return decode(schema,{pulls:[{number:input.page,title:'PR '+input.page,url:'https://github.com/team/project/pull/'+input.page,state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-27',head:'feature',base:'main',labels:[]}],page:input.page,hasMore:input.page===1});
  }
  if(input.section==='overview')await new Promise(resolve=>window.releaseReads.push(resolve));
  return decode(schema,{destination:'destination',pull:{number:7,title:'Loaded PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-27',head:'feature',base:'main',labels:[],body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:1,deletions:0,changedFiles:1,mergeable:true,reviewers:[],assignees:[]},files:[],comments:[],checks:[],warnings:[]});
},catch:error=>error});
const readRuntime=(...args)=>Effect.runPromise(readRuntimeEffect(...args));
const requestEffect=(...args)=>readRuntimeEffect(profile,...args);
function View(){const result=usePullDetail('repo',7);window.detail=result;window.rendered++;return <p>{result.detail?.pull.title??'Loading PR'}</p>}
function List(){const result=usePulls('open');window.list=result;window.rendered++;return <div>{result.pages.flatMap(page=>page.pulls.map(pull=><p key={page.source.key+pull.number}>{pull.title}</p>))}</div>}
function App(){const[revision,setRevision]=useState(0);window.changeUnrelatedProject=()=>setRevision(value=>value+1);
 const workspace={version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main',gitIdentity:'github.com/team/project'}, {id:'other',name:'Other project',path:'/other',branch:'feature-'+revision}],tasks:[],agents:[],automations:[]};
 const snapshot={revision,workspace};
 const value={activeRuntimeId:profile.id,connection:profile.connection,workspace,snapshot,connected:true,runtimes:[{profile,snapshot,connected:true}],readRuntime,readRuntimeEffect,runtimeReadCache,readCache:cache,requestEffect};
 return <WorkspaceContext value={value}>{window.listMode?<List/>:<View/>}</WorkspaceContext>;
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
    nodePaths: [root + '/node_modules'],
  },
  [
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.releaseReads.length > 0)
  // First identity discovery may legitimately restart the read to pin its account.
  const before = await page.evaluate(() => window.reads.length)
  for (let index = 0; index < 4; index++) {
    const renders = await page.evaluate(() => window.rendered)
    await page.evaluate(() => window.changeUnrelatedProject())
    await page.waitForFunction((count) => window.rendered > count, renders)
  }
  assert.equal(
    await page.evaluate(() => window.reads.length),
    before,
    'An unrelated project update restarted the in-flight PR read',
  )
  await page.evaluate(() => {
    for (const release of window.releaseReads) release()
  })
  await page.getByText('Loaded PR', { exact: true }).waitFor()
  const readsBeforeFailure = await page.evaluate(() => window.reads.length)
  await page.evaluate(() => {
    window.identityFailure = true
    window.detail.refresh()
  })
  await page.waitForFunction(() => window.identityErrors > 0)
  await page.evaluate(() => {
    window.identityFailure = false
    window.detail.refresh()
  })
  await page.waitForFunction((before) => window.reads.length > before, readsBeforeFailure, {
    timeout: 5000,
  })
  await page.evaluate(() => {
    for (const release of window.releaseReads) release()
  })
  await page.waitForFunction(
    () => window.detail.readConnected && !window.detail.busy && !window.detail.error,
  )
  const listPage = await browser.newPage()
  listPage.setDefaultTimeout(10000)
  listPage.on('pageerror', (error) => errors.push(error.message))
  await listPage.clock.install()
  await listPage.setContent('<div id="app"></div>')
  await listPage.addScriptTag({ content: 'window.listMode=true' })
  await listPage.addScriptTag({ content: built.outputFiles[0].text })
  await listPage.getByText('PR 1', { exact: true }).first().waitFor()
  await listPage.evaluate(() => {
    void window.list.more(window.list.pages[0].source.key)
  })
  await listPage.waitForFunction(() => window.releaseReads.length > 0)
  const listRenders = await listPage.evaluate(() => window.rendered)
  await listPage.evaluate(() => window.changeUnrelatedProject())
  await listPage.waitForFunction((before) => window.rendered > before, listRenders)
  await listPage.evaluate(() => {
    for (const release of window.releaseReads) release()
  })
  await listPage.getByText('PR 2', { exact: true }).first().waitFor()
  await listPage.close()
  assert.deepEqual(errors, [])
  console.log(
    'PR detail and Load more survive unrelated updates; immediate verified Retry recovers after an identity outage.',
  )
} finally {
  await browser.close()
}
