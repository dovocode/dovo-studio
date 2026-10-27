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
const entry=id=>({profile:{id,connection:{address:'http://'+id+'.lan',token:id+'-token'}},connected:true,snapshot:{workspace:{tasks:[{id:'same',status:'done',updatedAt:'0',messages:[],historyRevision:0}]}}});
window.entries=[entry('one'),entry('two')];window.matches={one:['same'],two:['same']};window.requests=[];window.releases=[];window.searchForeground=true;
window.readSearch=async(profile,path,input)=>{
 const ids=[...window.matches[profile.id]];window.requests.push({profile,path,input});
 if(window.holdSearch)await new Promise(resolve=>window.releases.push(resolve));
 return {taskIds:ids,hits:[]};
};
function App(){const [entries,setEntries]=useState(window.entries),[query,setQuery]=useState('needle'),[enabled,setEnabled]=useState(true);
 window.enableSearch=enabled=>flushSync(()=>setEnabled(enabled));
 window.patchSearch=(id,changes)=>flushSync(()=>setEntries(entries=>entries.map(entry=>entry.profile.id!==id?entry:{...entry,snapshot:{workspace:{tasks:entry.snapshot.workspace.tasks.map(task=>({...task,...changes}))}}})));
 window.changeSearchConnection=()=>flushSync(()=>setEntries(entries=>entries.map(entry=>entry.profile.id!=='one'?entry:{...entry,profile:{...entry.profile,connection:{address:'http://replacement.lan',token:'replacement-token'}}})));
 window.setSearchQuery=query=>flushSync(()=>setQuery(query));
 const value=useTaskSearch(entries,query,enabled);window.searchState=value;
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
        contents: 'export const useRuntime=()=>({readRuntime:window.readSearch});',
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

    // New committed input and idle edits refresh the same query without clearing retained matches.
    await page.evaluate(() => {
      window.matches.one = ['new']
      window.holdSearch = true
      window.patchSearch('one', { lastPromptAt: 'new-input' })
    })
    assert.deepEqual(await keys(), ['["one","same"]', '["two","same"]'])
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 2)
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
      await page.evaluate(() => {
        window.searchForeground = true
        window.enableSearch(true)
        window.patchSearch('two', { updatedAt: 'resumed' })
      })
      await settle()
      assert.equal(await page.evaluate(() => window.requests.length), beforePause + 2)
    }

    // A new credential scope must hide old matches and reject in-flight replies from both hosts.
    await page.evaluate(() => {
      window.holdSearch = true
      window.patchSearch('two', { updatedAt: 'delayed-old-scope' })
    })
    await page.clock.runFor(250)
    await page.waitForFunction(() => window.releases.length === 2)
    await page.evaluate(() => {
      window.holdSearch = false
      window.matches.one = ['replacement']
      window.changeSearchConnection()
    })
    assert.deepEqual(await keys(), [])
    await settle()
    assert.deepEqual(await keys(), ['["one","replacement"]', '["two","same"]'])
    assert.equal(
      await page.evaluate(() => window.requests.at(-2).profile.connection.token),
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
      'Mobile history search: committed input/edit/delete refresh, retained matches, stream isolation, out-of-order multi-computer replies and credential replacement passed.',
    )
  } finally {
    await page.close()
  }
}
