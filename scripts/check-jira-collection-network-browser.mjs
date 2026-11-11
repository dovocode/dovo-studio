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
import {useWorkCollection} from '${mobile}/scm/work/use-work-collection';
`
    : `
import {WorkspaceContext} from '${root}/packages/studio-core/src/workspace/context';
import {ApplicationStateProvider} from '${root}/packages/studio-core/src/runtime/application-state';
import {useWorkSources} from '${root}/packages/extension-scm/src/work/use-work-sources';
`
}
const profile={id:'owner',name:'Owner',createdAt:'2026-11-11',connection:{address:'http://owner.lan',token:'paired-fixture'}};
window.reads=[];window.wireBytes=0;window.sectionWrites=0;window.pages=[[7,6],[5,4]];
const cache={readEffect:()=>Effect.succeed(null),writeEffect:key=>Effect.sync(()=>{if(['work','jira-work'].includes(JSON.parse(key)[0]))window.sectionWrites++}),removeEffect:()=>Effect.void};
cache.read=(...args)=>Effect.runPromise(cache.readEffect(...args));cache.write=(...args)=>Effect.runPromise(cache.writeEffect(...args));cache.remove=(...args)=>Effect.runPromise(cache.removeEffect(...args));
const runtimeReadCache=()=>cache;
const issue=number=>({id:'TEAM-'+number,title:'Issue '+number+' older '+(window.olderRevision??0),body:'Description '+'x'.repeat(16000),state:'open',url:'https://team.atlassian.net/browse/TEAM-'+number,author:'Dominic',assignees:[],labels:[],updatedAt:'2026-11-11',revision:'same'});
const readRuntimeEffect=(_profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
 if(path.endsWith('/identity'))return decode(schema,{readerIdentity:'account',destination:'destination'});
 window.reads.push({path,input});if(input.cursor&&window.failLaterPage)throw Error('Older issue page unavailable');
 const index=input.cursor?1:0;
 const value=path.endsWith('/options')?{provider:'jira',issues:true,pipelines:false,pipelineActions:[],issueSearch:true}: {items:window.pages[index].map(number=>({...issue(number),title:'Issue '+number+' older '+(index?window.olderRevision??0:0)})),next:index?undefined:'30'};
 const version=JSON.stringify(value);let hash=0;for(const c of version)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;const readVersion=hash.toString(16).padStart(64,'0');
 const reply=input.conditional?(input.knownVersion===readVersion?{unchanged:true,readVersion}:{value,readVersion}):value;
 window.wireBytes+=JSON.stringify(reply).length;return decode(schema,reply);
},catch:error=>error});
const requestEffect=(...args)=>readRuntimeEffect(profile,...args);
const request=(...args)=>Effect.runPromise(requestEffect(...args));
const jira={id:'tracker',site:'https://team.atlassian.net',project:'TEAM',name:'Team'};
window.sources=[{key:'owner-jira',scope:'paired-jira',name:'Team',runtimeId:'owner',runtimeName:'Owner',profile,jira,input:{jiraSourceId:'tracker'},connected:true,readCache:cache,requestEffect,request}];
const workspace={version:1,runtimeAddress:'',repositories:[],jiraSources:[jira],tasks:[],agents:[],automations:[]};
const snapshot=decode(snapshotSchema,{revision:1,owner:false,workspace,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
window.store={activeRuntimeId:'owner',connection:profile.connection,snapshot,overviews:[{profile,snapshot,connected:true}],readRuntimeEffect,cacheForRuntime:runtimeReadCache};
function List(){const result=${native ? "useWorkCollection('issues','','all')" : "useWorkSources('issues','','jira')"};window.list=result;return <pre>{JSON.stringify(result.pages.map(p=>p.items.map(item=>item.title)))}</pre>}
function App(){return ${native ? '<RuntimeContext value={window.store}><NavigationContext value={{focused:true}}><List/></NavigationContext></RuntimeContext>' : '<List/>'}}
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
            path: '../../runtime/connection/provider',
            importer: mobile + '/scm/work/',
            contents: `export {useRuntime} from '${mobile}/runtime/connection/provider';`,
          },
          {
            path: '../../shell/navigation',
            importer: mobile + '/scm/work/',
            contents: `export {useNavigation} from '${mobile}/shell/navigation';`,
          },
          {
            path: 'react-native',
            contents: `export const AppState={currentState:'active',addEventListener:(name,callback)=>{(window.appStateListeners??=new Set()).add(callback);return{remove(){window.appStateListeners.delete(callback)}}}};export const Alert={alert(){throw Error('Unexpected alert')}};`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useWorkspace=()=>window.store;`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: `export {useApplicationState} from '${root}/packages/studio-core/src/runtime/application-state';`,
          },
          {
            path: './work-sources',
            importer: root + '/packages/extension-scm/src/work/use-work-sources.ts',
            contents: `export {workRemoteKey,matchesWorkSource} from '${root}/packages/extension-scm/src/work/work-source-identity';export const useIssueSources=()=>window.sources;`,
          },
        ],
  )
}
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const built = await fixture(platform)
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(7000)
    await page.clock.install()
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.list?.pages[0]?.items.length === 2 && !window.list.busy)
    await page.evaluate(() => window.list.more(window.list.pages[0].source.key))
    await page.waitForFunction(() => window.list.pages[0].items.length === 4 && !window.list.busy)
    await page.evaluate(() => {
      window.reads = []
      window.wireBytes = 0
      window.sectionWrites = 0
    })
    await page.clock.runFor(61000)
    const metrics = await page.evaluate(() => ({
      reads: window.reads.length,
      bytes: window.wireBytes,
      sectionWrites: window.sectionWrites,
    }))
    assert.ok(metrics.reads > 0 && metrics.reads <= 2)
    assert.equal(metrics.sectionWrites, 0)
    assert.ok(metrics.bytes <= 200)
    assert.equal(
      await page.evaluate(() => window.reads.filter((read) => read.input.cursor).length),
      0,
    )
    await page.evaluate(() => (window.olderRevision = 1))
    await page.clock.runFor(91000)
    await page.waitForFunction(() =>
      window.list.pages[0].items.some((item) => item.title === 'Issue 5 older 1'),
    )
    await page.evaluate(() => {
      window.pages = [
        [8, 7],
        [6, 5],
      ]
      window.failLaterPage = true
    })
    await page.clock.runFor(31000)
    await page.waitForFunction(() => window.list.pages[0].error === 'Older issue page unavailable')
    assert.deepEqual(await page.evaluate(() => window.list.pages[0].items.map((item) => item.id)), [
      'TEAM-7',
      'TEAM-6',
      'TEAM-5',
      'TEAM-4',
    ])
    await page.evaluate(() => {
      window.failLaterPage = false
      window.list.refresh()
    })
    await page.waitForFunction(
      () =>
        !window.list.busy &&
        !window.list.pages[0].error &&
        window.list.pages[0].items[0]?.id === 'TEAM-8',
    )
    assert.deepEqual(await page.evaluate(() => window.list.pages[0].items.map((item) => item.id)), [
      'TEAM-8',
      'TEAM-7',
      'TEAM-6',
      'TEAM-5',
    ])
    console.log(
      JSON.stringify({
        fixture:
          'one idle minute, ' + platform + ' Jira collection, two opened pages, 16 KB descriptions',
        ...metrics,
      }),
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
} finally {
  await browser.close()
}
