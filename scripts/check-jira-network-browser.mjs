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
import {decode} from '@dovo/protocol';
${
  native
    ? `
import {useIssueDiscussion} from '${mobile}/scm/work/use-issue-discussion';
`
    : `
import {ApplicationStateProvider} from '${root}/packages/studio-core/src/runtime/application-state';
import {useIssueDiscussion} from '${root}/packages/extension-scm/src/work/use-issue-discussion';
`
}
import {jiraReader} from '${root}/packages/studio-core/src/scm/jira-reads';
import {forgeIssueDetailSchema} from '@dovo/protocol';
window.reads=[];window.wireBytes=0;window.cacheWrites=0;window.revision=0;
const issue={id:'TEAM-7',title:'Issue',body:'Description '+'x'.repeat(16000),state:'open',url:'https://team.atlassian.net/browse/TEAM-7',author:'Dominic',assignees:[],labels:[],updatedAt:'2026-11-11',revision:'same'};
const overview={issue,comments:[]};
const cache={read:async()=>{if(!window.holdCache)return null;await new Promise(resolve=>(window.releaseCache??=[]).push(resolve));window.cacheReturned=(window.cacheReturned??0)+1;return{value:{issue,comments:[{id:'old',body:'Old saved comment',author:'Dominic',createdAt:'2026-11-11'}],loadedPages:99},cachedAt:0}},write:async()=>{window.cacheWrites++},remove:async()=>{}};
const request=(input,schema)=>Effect.tryPromise({try:async()=>{
 window.reads.push(input);if(input.cursor&&window.failLaterPage)throw Error('Older comments unavailable');
 const value={issue,comments:[{id:input.cursor?'second':'first',body:'Comment '+window.revision,author:'Dominic',createdAt:'2026-11-11'}],next:input.cursor?undefined:'30',stale:!!window.revalidating};
 const readVersion=(window.revision+':'+window.revalidating).split('').reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0),0).toString(16).replace('-','').padStart(64,'0');
 const reply=input.conditional?(input.knownVersion===readVersion?{unchanged:true,readVersion}:{value,readVersion}):value;
 window.wireBytes+=JSON.stringify(reply).length;return decode(schema,reply);
},catch:error=>error});
const load=async(section,cursor,refresh,revision)=>{
 const input={jiraSourceId:'tracker',id:'TEAM-7',section,cursor,revision,refresh};
 return Effect.runPromise(jiraReader(cache,'fixture',(_path,input,schema)=>request(input,schema))('/api/scm/work/issues/detail',input,forgeIssueDetailSchema));
};
function View({id}){const value=useIssueDiscussion({overview,cacheKey:'jira-detail',readCache:cache,enabled:true,refreshToken:0,load,refreshOverview(){}});window.details??={};window.details[id]=value;return <p>{value.issue?.comments.length??0}</p>}
function App(){const[consumers,setConsumers]=useState(1);window.addConsumer=()=>setConsumers(2);return Array.from({length:consumers},(_,id)=><View key={id} id={id}/>)}
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
            path: 'react-native',
            contents: `export const AppState={currentState:'active',addEventListener:(name,callback)=>{(window.appStateListeners??=new Set()).add(callback);return{remove(){window.appStateListeners.delete(callback)}}}};export const Alert={alert(){throw Error('Unexpected alert')}};`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/client-runtime';`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: `export {useApplicationState} from '${root}/packages/studio-core/src/runtime/application-state';`,
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
    await page.clock.install()
    await page.setContent('<div id="app"></div>')
    await page.evaluate(
      (baseline) => (window.baseline = baseline),
      process.argv.includes('--baseline'),
    )
    await page.addScriptTag({ content: 'window.holdCache=true' })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.details?.[0]?.ready && !window.details[0].busy)
    await page.waitForFunction(() => window.releaseCache?.length > 0)
    await page.evaluate(() => {
      window.holdCache = false
      for (const release of window.releaseCache) release()
    })
    await page.waitForFunction(() => window.cacheReturned > 0)
    assert.equal(
      await page.evaluate(() => window.details[0].issue.comments[0].id),
      'first',
      'Late saved comments cannot replace live comments',
    )
    await page.evaluate(() => window.details[0].more())
    await page.waitForFunction(
      () => window.details[0].issue?.comments.length === 2 && !window.details[0].busy,
    )
    await page.evaluate(() => window.addConsumer())
    await page.waitForFunction(() => window.details[1]?.ready && !window.details[1].busy)
    await page.evaluate(() => {
      window.reads = []
      window.wireBytes = 0
      window.cacheWrites = 0
    })
    await page.clock.runFor(61000)
    const metrics = await page.evaluate(() => ({
      reads: window.reads.length,
      bytes: window.wireBytes,
      diskWrites: window.cacheWrites,
    }))
    console.log(
      JSON.stringify({
        fixture:
          'one idle minute, two ' +
          platform +
          ' Jira discussion consumers, first consumer has two pages, 16 KB description',
        ...metrics,
      }),
    )
    {
      assert.ok(metrics.reads > 0 && metrics.reads <= 4)
      assert.ok(metrics.bytes <= 400)
      assert.equal(metrics.diskWrites, 0)
      await page.evaluate(() => {
        window.revision = 1
        window.failLaterPage = true
        window.details[0].refresh()
      })
      await page.waitForFunction(() => window.details[0].error === 'Older comments unavailable')
      assert.equal(
        await page.evaluate(() => window.details[0].issue.comments.length),
        2,
        'Retain the full prefix on a later-page failure',
      )
      await page.evaluate(() => {
        window.failLaterPage = false
        window.details[0].refresh()
      })
      await page.waitForFunction(
        () =>
          !window.details[0].busy &&
          !window.details[0].error &&
          window.details[0].issue.comments.every((c) => c.body === 'Comment 1'),
      )
      await page.evaluate(() => (window.revision = 2))
      await page.clock.runFor(121000)
      await page.waitForFunction(() =>
        window.details[0].issue.comments.every((c) => c.body === 'Comment 2'),
      )
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
} finally {
  await browser.close()
}
