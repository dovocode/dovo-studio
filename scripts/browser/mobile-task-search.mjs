import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser } from './harness.mjs'

/** Exercise the real hook with scoped computers and controllable replies, without native UI. */
export async function checkMobileTaskSearch(browser) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root + 'packages/studio-ui',
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {useTaskSearch} from '${root}apps/mobile/src/tasks/list/use-task-search.ts';
// Computer one supports scoped search. Computer two is an older runtime without the flag.
const entry=id=>({profile:{id,name:'Computer '+id,connection:{address:'http://'+id+'.lan',token:id+'-token'}},connected:true,snapshot:{...(id==='one'?{taskSearchScopeSupported:true}:{}),workspace:{tasks:[{id:'same',status:'done',updatedAt:'0',messages:[],historyRevision:0}]}}});
window.entries=[entry('one'),entry('two')];window.matches={one:['same'],two:['same']};window.requests=[];window.releases=[];window.aborted=[];window.hitCount=0;window.searchForeground=true;
window.readSearch=async(profile,path,input,signal)=>{
 const ids=[...window.matches[profile.id]];window.requests.push({profile,path,input});
 signal?.addEventListener('abort',()=>window.aborted.push(profile.id));
 if(window.holdSearch)await new Promise(resolve=>window.releases.push(resolve));
 return {taskIds:ids,hits:Array.from({length:window.hitCount},(_,index)=>({taskId:ids[0],messageId:'m'+index,role:'user',snippet:'needle'}))};
};
function App(){const [entries,setEntries]=useState(window.entries),[query,setQuery]=useState('needle'),[enabled,setEnabled]=useState(true),[scopes,setScopes]=useState();
 window.setSearchScopes=scopes=>flushSync(()=>setScopes(scopes));
 window.enableSearch=enabled=>flushSync(()=>setEnabled(enabled));
 window.patchSearch=(id,changes)=>flushSync(()=>setEntries(entries=>entries.map(entry=>entry.profile.id!==id?entry:{...entry,snapshot:{...entry.snapshot,workspace:{tasks:entry.snapshot.workspace.tasks.map(task=>({...task,...changes}))}}})));
 window.changeSearchConnection=()=>flushSync(()=>setEntries(entries=>entries.map(entry=>entry.profile.id!=='one'?entry:{...entry,profile:{...entry.profile,connection:{address:'http://replacement.lan',token:'replacement-token'}}})));
 window.setSearchQuery=query=>flushSync(()=>setQuery(query));
 const value=useTaskSearch(entries,query,enabled,scopes);window.searchState=value;
 return <><div data-search-keys>{[...value.keys].sort().join('|')}</div><div data-search-loading>{String(value.loading)}</div></>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      platform: 'browser',
      format: 'iife',
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
    },
    [
      {
        path: '../../runtime/connection/provider',
        importer: root + 'apps/mobile/src/tasks/list/',
        contents: `import {Effect} from 'effect';export const useRuntime=()=>({readRuntimeEffect:(profile,path,input)=>Effect.tryPromise({try:signal=>window.readSearch(profile,path,input,signal),catch:error=>error})});`,
      },
      {
        path: '../../runtime/state/app-active',
        importer: root + 'apps/mobile/src/tasks/list/',
        contents: 'export const useAppActive=()=>window.searchForeground;',
      },
    ],
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.clock.install()
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => !!window.searchState)
    const settle = async () => {
      await page.clock.runFor(250)
      await page.waitForFunction(() => !window.searchState.loading)
    }
    const keys = () =>
      page.evaluate(() => [...window.searchState.keys].sort((a, b) => a.localeCompare(b)))
    await settle()
    assert.deepEqual(await keys(), ['["one","same"]', '["two","same"]'])
    const requestedSince = (before) =>
      page.evaluate(
        (before) => window.requests.slice(before).map((request) => request.profile.id),
        before,
      )

    // A history change on one computer refreshes only that computer.
    const beforeSingle = await page.evaluate(() => window.requests.length)
    await page.evaluate(() => window.patchSearch('one', { historyRevision: 5 }))
    await settle()
    assert.deepEqual(await requestedSince(beforeSingle), ['one'])

    // A history change on one computer leaves the other computer's read running.
    const beforeOverlap = await page.evaluate(() => window.requests.length)
    await page.evaluate(() => {
      window.holdSearch = true
      window.patchSearch('two', { historyRevision: 6 })
    })
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => window.patchSearch('one', { historyRevision: 6 }))
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 2)
    assert.deepEqual(await page.evaluate(() => window.aborted), [])
    await page.evaluate(() => {
      window.holdSearch = false
      for (const release of window.releases.splice(0)) release()
    })
    await settle()
    assert.deepEqual(await requestedSince(beforeOverlap), ['two', 'one'])
    assert.deepEqual(await page.evaluate(() => window.aborted), [])

    // A scope that lists only computer one does not read computer two, and hides its matches.
    const beforeScope = await page.evaluate(() => window.requests.length)
    await page.evaluate(() =>
      window.setSearchScopes({ one: { archived: false, repositoryIds: ['project'] } }),
    )
    await settle()
    assert.deepEqual(await requestedSince(beforeScope), ['one'])
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1).input), {
      query: 'needle',
      scope: { archived: false, repositoryIds: ['project'] },
    })
    assert.deepEqual(await keys(), ['["one","same"]'])

    // An older runtime receives no scope. A full page from it reports possibly missing matches.
    const beforeOlder = await page.evaluate(() => window.requests.length)
    await page.evaluate(() => {
      window.hitCount = 50
      window.setSearchScopes({ one: { archived: true }, two: { archived: true } })
      // Computer two's unscoped request is unchanged, so read it again through new history.
      window.patchSearch('two', { historyRevision: 7 })
    })
    await settle()
    assert.deepEqual(
      await page.evaluate(
        (before) => window.requests.slice(before).map(({ profile, input }) => [profile.id, input]),
        beforeOlder,
      ),
      [
        ['one', { query: 'needle', scope: { archived: true } }],
        ['two', { query: 'needle' }],
      ],
    )
    assert.deepEqual(await page.evaluate(() => window.searchState.unscopedFull), ['Computer two'])
    await page.evaluate(() => {
      window.hitCount = 0
      window.setSearchScopes(undefined)
    })
    await settle()
    assert.deepEqual(await page.evaluate(() => window.searchState.unscopedFull), [])

    // New committed input and idle edits refresh the same query without clearing retained matches.
    await page.evaluate(() => {
      window.matches.one = ['new']
      window.holdSearch = true
      window.patchSearch('one', { lastPromptAt: 'new-input' })
    })
    assert.deepEqual(await keys(), ['["one","same"]', '["two","same"]'])
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => {
      window.matches.one = ['edited']
      window.holdSearch = false
      window.patchSearch('one', { updatedAt: 'edited-message' })
    })
    await settle()
    assert.deepEqual(await keys(), ['["one","edited"]', '["two","same"]'])
    await page.evaluate(() => window.releases.splice(0).forEach((release) => release()))
    await page.clock.runFor(1)
    assert.deepEqual(await keys(), ['["one","edited"]', '["two","same"]'])
    await page.evaluate(() => {
      window.matches.one = []
      window.patchSearch('one', { historyRevision: 1 })
    })
    await settle()
    assert.deepEqual(await keys(), ['["two","same"]'])

    // Running text/tokens change each frame; committed input and turn completion do not.
    await page.evaluate(() => window.patchSearch('one', { status: 'running' }))
    await settle()
    const beforeStream = await page.evaluate(() => window.requests.length)
    await page.evaluate(() => {
      for (let index = 0; index < 30; index++)
        window.patchSearch('one', { updatedAt: String(index), contextUsage: { used: index } })
    })
    await page.clock.runFor(1000)
    assert.equal(await page.evaluate(() => window.requests.length), beforeStream)
    await page.evaluate(() => {
      window.matches.one = ['completed']
      window.patchSearch('one', {
        status: 'review',
        turns: [{ id: 'turn', status: 'completed', finishedAt: 'finished' }],
      })
    })
    await settle()
    assert.deepEqual(await keys(), ['["one","completed"]', '["two","same"]'])

    for (const pause of ['hidden', 'background']) {
      const beforePause = await page.evaluate(() => window.requests.length)
      await page.evaluate((pause) => {
        window.searchForeground = pause !== 'background'
        window.enableSearch(pause !== 'hidden')
        window.patchSearch('two', { updatedAt: pause })
      }, pause)
      await page.clock.runFor(1000)
      assert.equal(await page.evaluate(() => window.requests.length), beforePause)
      await page.evaluate((pause) => {
        window.searchForeground = true
        window.enableSearch(true)
        window.patchSearch('two', { updatedAt: `resumed-${pause}` })
      }, pause)
      await settle()
      // Only the computer whose history changed is read again.
      assert.equal(await page.evaluate(() => window.requests.length), beforePause + 1)
    }

    // A new credential hides that computer's old matches and ignores its in-flight reply.
    // The other computer keeps its matches.
    await page.evaluate(() => {
      window.holdSearch = true
      window.patchSearch('one', { updatedAt: 'delayed-old-scope' })
    })
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => {
      window.holdSearch = false
      window.matches.one = ['replacement']
      window.changeSearchConnection()
    })
    assert.deepEqual(await keys(), ['["two","same"]'])
    await settle()
    assert.deepEqual(await keys(), ['["one","replacement"]', '["two","same"]'])
    assert.equal(
      await page.evaluate(() => window.requests.at(-1).profile.connection.token),
      'replacement-token',
    )
    await page.evaluate(() =>
      window.releases
        .splice(0)
        .reverse()
        .forEach((release) => release()),
    )
    await page.clock.runFor(1)
    assert.deepEqual(await keys(), ['["one","replacement"]', '["two","same"]'])
    assert.deepEqual(errors, [])
    console.log(
      'Mobile history search: per-computer refresh and scope, committed input/edit/delete refresh, retained matches, stream isolation, out-of-order replies and credential replacement passed.',
    )
  } finally {
    await page.close()
  }
}
