import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const built = await build({
  stdin: {
    contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TemporaryTaskWorkspace } from '../studio-core/src/workspace/temporary-task';
import { WorkspaceContext, useWorkspace } from '../studio-core/src/workspace/context';
const task = { id:'temp', draft:'', status:'draft', messages:[], files:[] };
window.commits = 0; window.flushes = 0; window.requests = 0;
function Controls() {
 const store = useWorkspace();
 return <><button id="settings" onClick={() => store.setWorkspace(w => ({...w,tasks:w.tasks.map(t => ({...t,title:'Configured'}))}))}>Settings</button>
 <button id="text" onClick={() => store.setWorkspace(w => ({...w,tasks:w.tasks.map(t => ({...t,draft:'Hello'}))}))}>Text</button>
 <button id="attachment" onClick={() => store.request('/api/attachments/upload', {}, {})}>Attachment</button>
 <button id="flush" onClick={() => store.flush()}>Flush</button></>;
}
function App() {
 const [workspace,setWorkspace] = useState({tasks:[],repositories:[]});
 window.saved = workspace.tasks;
 return <WorkspaceContext.Provider value={{workspace,setWorkspace,flush:async()=>{window.flushes++},request:async()=>{window.requests++;return {}}}}>
 <TemporaryTaskWorkspace task={task} onCommit={()=>{window.commits++}}><Controls/></TemporaryTaskWorkspace>
 </WorkspaceContext.Provider>;
}
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: new URL('../packages/studio-ui/', import.meta.url).pathname,
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.locator('#settings').click()
  await page.locator('#flush').click()
  assert.deepEqual(
    await page.evaluate(() => [window.saved.length, window.commits, window.flushes]),
    [0, 0, 0],
  )
  await page.locator('#text').click()
  await page.waitForFunction(() => window.saved.length === 1)
  assert.deepEqual(
    await page.evaluate(() => [window.saved[0].draft, window.saved[0].title, window.commits]),
    ['Hello', 'Configured', 1],
  )
  await page.locator('#text').click()
  await page.locator('#flush').click()
  assert.deepEqual(
    await page.evaluate(() => [window.saved.length, window.commits, window.flushes]),
    [1, 1, 1],
  )
  await page.reload()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.locator('#attachment').click()
  await page.waitForFunction(() => window.requests === 1)
  assert.deepEqual(
    await page.evaluate(() => [window.saved.length, window.commits, window.flushes]),
    [1, 1, 1],
  )
  assert.deepEqual(errors, [])
  console.log(
    'Startup draft stays temporary through settings changes and commits once on text input.',
  )
} finally {
  await browser.close()
}
