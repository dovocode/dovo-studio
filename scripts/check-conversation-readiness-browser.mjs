import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Real cache hook and context; isolated disk/network adapters. No user storage or runtime.
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceContext} from './packages/studio-core/src/workspace/context';
import {useCachedTask} from './packages/studio-core/src/workspace/use-cached-task';
const task={id:'thread',title:'Thread',repositoryId:'repo',status:'done',files:[],messages:[],turns:[]};
const profiles=['one','two'].map(id=>({id,name:id,connection:{address:'http://'+id+'.lan:8787/',token:'fixture-token'}}));
const cache={read:async()=>{window.cacheReads++;if(window.cacheFailure)throw Error('Cache unavailable');return window.cached?{value:{snapshot:{workspace:{tasks:[{...task,historyRevision:window.historyRevision??0,messages:[{id:'saved',role:'user',text:'Cached request'}]}]},detailTaskIds:['thread']}}}:null}};
function Reader(){const state=useCachedTask({...task,historyRevision:window.historyRevision??0});window.cacheState=state;return <p>{state.loaded?'Ready':state.error||'Waiting'}</p>}
function App(){const [version,setVersion]=useState(0);window.publish=()=>setVersion(v=>v+1);const profile=profiles[window.owner??0];return <WorkspaceContext.Provider value={{connection:profile.connection,connected:!!window.connected,snapshot:{detailTaskIds:window.live?['thread']:[]},readCache:cache,activeRuntimeId:profile.id,runtimeRegistry:{profiles},runtimes:[],refreshRuntime:async target=>{window.refreshOwners.push(target.id);if(window.holdRefresh)await new Promise((resolve,reject)=>window.finishRefresh={resolve,reject});if(window.networkFailure)throw Error('Computer unavailable')}}}><Reader/></WorkspaceContext.Provider>}
window.cacheReads=0;window.refreshOwners=[];createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    nodePaths: [root + 'packages/extension-tasks/node_modules'],
  },
  [],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.evaluate(() => {
    window.cacheFailure = true
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.cacheState?.error === 'Cache unavailable')
  await page.evaluate(() => {
    window.cacheFailure = false
    window.networkFailure = true
    window.cacheState.retry()
  })
  await page.waitForFunction(() => window.cacheState.retryError === 'Computer unavailable')
  assert.equal(
    await page.evaluate(() => window.cacheState.error),
    '',
    'A network failure is not a cache failure',
  )
  assert.equal(await page.evaluate(() => window.cacheState.retrying), false)
  assert.deepEqual(await page.evaluate(() => window.refreshOwners), ['one'])
  await page.evaluate(() => {
    window.connected = true
    window.publish()
  })
  await page.waitForFunction(() => window.cacheState.retryError === '')
  await page.evaluate(() => {
    window.connected = false
    window.networkFailure = false
    window.holdRefresh = true
    window.publish()
  })
  await page.evaluate(() => window.cacheState.retry())
  await page.waitForFunction(() => window.cacheState.retrying && window.finishRefresh)
  await page.evaluate(() => {
    window.owner = 1
    window.publish()
  })
  await page.waitForFunction(() => !window.cacheState.retrying)
  await page.evaluate(() => window.finishRefresh.reject(new Error('Old computer failure')))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  assert.equal(
    await page.evaluate(() => window.cacheState.retryError),
    '',
    'Old-computer recovery must not affect the selected computer',
  )
  await page.evaluate(() => {
    window.holdRefresh = false
    window.cached = true
    window.cacheState.retry()
  })
  await page.waitForFunction(() => window.cacheState.loaded)
  assert.equal(await page.evaluate(() => window.cacheState.task.messages[0].text), 'Cached request')
  assert.deepEqual(await page.evaluate(() => window.refreshOwners), ['one', 'one', 'two'])
  const reads = await page.evaluate(() => window.cacheReads)
  await page.evaluate(() => {
    window.historyRevision = 1
    window.publish()
  })
  await page.waitForFunction(
    () => window.cacheState.loaded && window.cacheState.task.historyRevision === 1,
  )
  assert.equal(await page.evaluate(() => window.cacheReads), reads + 1)
  assert.deepEqual(errors, [])
  console.log(
    'Conversation readiness: cache retry, separate network feedback, scoped recovery, busy state and offline cache restoration passed.',
  )
} finally {
  await browser.close()
}
