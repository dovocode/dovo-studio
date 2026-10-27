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
const profile={id:'owner',name:'Owner',connection:{address:'http://owner.local',token:'paired-fixture'}};
window.reads=[];window.releaseReads=[];window.rendered=0;
const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void,removeEffect:()=>Effect.void};
const runtimeReadCache=()=>cache;
const readRuntimeEffect=(_profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
  if(path==='/api/scm/source/identity')return decode(schema,{readerIdentity:'account',destination:'destination'});
  window.reads.push({path,input});
  if(input.section==='overview')await new Promise(resolve=>window.releaseReads.push(resolve));
  return decode(schema,{destination:'destination',pull:{number:7,title:'Loaded PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-27',head:'feature',base:'main',labels:[],body:'Description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',additions:1,deletions:0,changedFiles:1,mergeable:true,reviewers:[],assignees:[]},files:[],comments:[],checks:[],warnings:[]});
},catch:error=>error});
const readRuntime=(...args)=>Effect.runPromise(readRuntimeEffect(...args));
const requestEffect=(...args)=>readRuntimeEffect(profile,...args);
function View(){const result=usePullDetail('repo',7);window.detail=result;window.rendered++;return <p>{result.detail?.pull.title??'Loading PR'}</p>}
function App(){const[revision,setRevision]=useState(0);window.changeUnrelatedProject=()=>setRevision(value=>value+1);
 const workspace={version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project',path:'/project',branch:'main',gitIdentity:'github.com/team/project'}, {id:'other',name:'Other project',path:'/other',branch:'feature-'+revision}],tasks:[],agents:[],automations:[]};
 const snapshot={revision,workspace};
 const value={activeRuntimeId:profile.id,connection:profile.connection,workspace,snapshot,connected:true,runtimes:[{profile,snapshot,connected:true}],readRuntime,readRuntimeEffect,runtimeReadCache,readCache:cache,requestEffect};
 return <WorkspaceContext value={value}><View/></WorkspaceContext>;
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
      contents: `export {useWorkspace} from '${root}/packages/studio-core/src/workspace/context';export {useRepositorySources} from '${root}/packages/studio-core/src/workspace/repository-sources';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling';`,
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
  assert.deepEqual(errors, [])
  console.log('PR reads survive unrelated project updates while the provider reply is delayed.')
} finally {
  await browser.close()
}
