import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root + 'packages/studio-core',
    contents: `import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';
import {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting';
window.calls=[];window.pending=[];
const read=input=>new Promise((resolve,reject)=>{window.calls.push(input);window.pending.push({resolve,reject})});
function Panel(){const waiting=useTaskWaiting(window.task,window.online,read,window.scope);window.waiting=waiting;
return <div><p>{JSON.stringify(waiting.data)}</p><p>{waiting.error}</p><p>{waiting.busy?'Busy':'Ready'}</p></div>}
const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<StrictMode><Panel key={window.mount}/></StrictMode>);window.render();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-core/node_modules/react',
    'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
  },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.evaluate(() => {
    window.task = 'task'
    window.scope = 'owner-account-a'
    window.online = true
    window.mount = 0
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.pending.length === 2)
  await page.evaluate(() => {
    window.pending[0].resolve({ dependencies: [], related: [] })
    window.removal = window.waiting.refresh({
      kind: 'pipeline',
      repositoryId: 'project',
      target: '10',
    })
  })
  assert.equal(await page.evaluate(() => window.calls.filter((call) => call.unlink).length), 0)
  await page.evaluate(() => window.pending[1].resolve({ dependencies: [{ label: 'Cached run' }] }))
  await page.waitForFunction(() => window.calls.filter((call) => call.unlink).length === 1)
  await page.evaluate(() =>
    window.pending[2].resolve({ dependencies: [{ label: 'Remaining watch' }] }),
  )
  await page.getByText('Ready', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.online = false
    window.mount++
    window.render()
  })
  await page.waitForFunction(
    () => window.waiting.data?.dependencies[0]?.label === 'Remaining watch',
  )
  const reads = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => {
    window.scope = 'owner-account-b'
    window.render()
  })
  await page.waitForFunction(() => window.waiting.data === null)
  assert.equal(
    await page.evaluate(() => window.calls.length),
    reads,
    'Offline reads must not dispatch',
  )
  await page.evaluate(() => {
    window.online = true
    window.render()
  })
  await page.waitForFunction((reads) => window.calls.length === reads + 1, reads)
  await page.evaluate(() => {
    window.pending.at(-1).reject(new Error('Read failed'))
    window.syncFailure = true
  })
  await page.getByText('Read failed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.requestAfterFailure = window.waiting.refresh({
      kind: 'pipeline',
      repositoryId: 'project',
      target: '11',
    })
  })
  await page.waitForFunction(() => window.calls.at(-1).unlink?.target === '11')
  await page.evaluate(() => window.pending.at(-1).resolve({ dependencies: [] }))
  await page.getByText('Ready', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Watcher synchronization: StrictMode, serialized removal during reads, offline cache, account isolation and failure recovery passed.',
  )
} finally {
  await browser.close()
}
