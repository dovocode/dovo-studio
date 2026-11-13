import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const files = root + '/packages/extension-tasks/src/files'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useCallback,useState} from 'react';import {createRoot} from 'react-dom/client';
import {Effect} from 'effect';
import {requestNeedsWorkspaceSync,requestWorkspaceTask} from '@dovo/protocol';
import {runClientEffect} from '${root}/packages/client-runtime/src/effects/effect-boundary.ts';
import {WorkspaceSynchronization} from '${root}/packages/studio-core/src/runtime/synchronization.ts';
import {useApplicationState} from '${root}/packages/studio-core/src/runtime/application-state.ts';
import {SavedFilePreview} from '${files}/saved-file-preview.tsx';
const size=3*1024*1024;const text='large snapshot\\n'.repeat(Math.ceil(size/15)).slice(0,size);
const connection={address:'http://lan.test',token:'fixture-paired-token'};
window.calls=[];window.syncChanges=0;window.renders=0;window.pending=[];window.delay=false;
window.workspace={activeRuntimeId:'runtime',connection};
function App(){
  const[version,setVersion]=useApplicationState(0);
  const[file,setFile]=useState({path:'large.txt',before:'',after:'',viewed:false,preview:{kind:'large',before:{hash:'old',size,mode:'100644'},after:{hash:'new',size,mode:'100644'}}});
  const[owner,setOwner]=useState({taskId:'task',checkoutId:'checkout'});
  const[synchronization]=useState(()=>{const sync=new WorkspaceSynchronization(()=>{},undefined,undefined,()=>{window.syncChanges++;setVersion(v=>v+1)});sync.bind(connection);return sync});
  const request=useCallback((path,input)=>runClientEffect(Effect.gen(function*(){
    window.calls.push({path,input});
    // Bound the broken baseline so its microtask loop cannot hang the browser.
    if(window.calls.length<64&&requestNeedsWorkspaceSync(path)){const taskId=requestWorkspaceTask(path,input);yield* taskId?synchronization.flushTaskEffect(taskId):synchronization.flushEffect()}
    if(window.fail)return yield* Effect.fail(new Error('Preview unavailable'));
    const complete=input.full&&!window.compactOnly;
    const side={kind:'text',size,text:complete?text+'FULL '+input.path:text.slice(0,65536)+' COMPACT '+input.path,truncated:!complete};
    const preview={before:{...side,text:side.text+' BEFORE'},after:{...side,text:side.text+' AFTER'}};
    if(window.delay)return yield* Effect.promise(()=>new Promise(resolve=>window.pending.push(()=>resolve(preview))));
    return preview;
  })),[synchronization]);
  window.workspace={...window.workspace,request};
  window.refresh=()=>setVersion(v=>v+1);
  window.changeFile=update=>setFile(f=>({...f,...update}));window.changeOwner=update=>setOwner(o=>({...o,...update}));
  window.patchPreview=(side,update)=>setFile(f=>({...f,preview:{...f.preview,[side]:{...f.preview[side],...update}}}));
  window.changeRuntime=update=>{window.workspace={...window.workspace,...update};setVersion(v=>v+1)};
  window.renders++;return <SavedFilePreview file={{...file,preview:{...file.preview,before:{...file.preview.before},after:{...file.preview.after}}}} {...owner}/>;
};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.workspace;' },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;',
    },
    {
      path: './saved-file-diff',
      importer: files,
      // The checkpoint renderer has its own real-worker suite. Expose both complete inputs here.
      contents:
        'export const CheckpointDiff=({file})=><article aria-label="Complete diff"><pre aria-label="Before">{file.before}</pre><pre aria-label="After">{file.after}</pre></article>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(
    () => window.calls.length > 1 || document.body.textContent.includes('Load full diff'),
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const baseline = await page.evaluate(() => ({
    calls: window.calls.length,
    renders: window.renders,
    syncChanges: window.syncChanges,
  }))
  console.log('Preview synchronization boundary', baseline, errors)
  assert.equal(
    baseline.calls,
    1,
    'One compact read must settle despite synchronization publishing a workspace update',
  )
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  const count = () => page.evaluate(() => window.calls.length)
  const expectRead = async (change) => {
    const previous = await count()
    await page.evaluate(change)
    await page.waitForFunction((expected) => window.calls.length >= expected, previous + 1)
    await settle()
    assert.equal(await count(), previous + 1, 'A new content or owner key needs exactly one read')
  }
  // Equal progress projections and unrelated UI flags must retain the loaded preview.
  await page.evaluate(() => {
    window.refresh()
    window.changeFile({ viewed: true, diskContents: 'unsaved draft' })
  })
  await settle()
  assert.equal(await count(), 1)
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page.getByRole('article', { name: 'Complete diff' }).waitFor()
  assert.equal(await count(), 2)
  for (const side of ['Before', 'After']) {
    const value = await page.getByLabel(side, { exact: true }).textContent()
    assert.equal(value.length, 3 * 1024 * 1024 + 'FULL large.txt '.length + side.length)
    assert.ok(value.endsWith('FULL large.txt ' + side.toUpperCase()))
  }
  // Content fields and every saved-blob identity field invalidate an equal-path preview.
  await expectRead(() => window.changeFile({ before: 'changed before' }))
  await expectRead(() => window.changeFile({ after: 'changed after' }))
  await expectRead(() => window.patchPreview('before', { hash: 'old-next' }))
  await expectRead(() => window.patchPreview('after', { hash: 'new-next' }))
  await expectRead(() => window.patchPreview('after', { size: 3145729 }))
  await expectRead(() => window.patchPreview('before', { mode: '100755' }))
  await expectRead(() =>
    window.changeFile({
      preview: {
        kind: 'deferred',
        before: { hash: 'old-next', size: 3145728, mode: '100755' },
        after: { hash: 'new-next', size: 3145729, mode: '100644' },
      },
    }),
  )
  await expectRead(() => window.changeOwner({ checkoutId: 'other-checkout' }))
  await expectRead(() => window.changeOwner({ turnId: 'next-turn' }))
  await expectRead(() => window.changeOwner({ commitSha: 'next-commit' }))
  await expectRead(() => window.changeOwner({ working: true }))
  await expectRead(() => window.changeOwner({ taskId: 'other-task' }))
  await expectRead(() =>
    window.changeOwner({ sideThreadSnapshot: { before: 'side-old', after: 'side-new' } }),
  )
  assert.equal(
    await page.evaluate(() => window.calls.at(-1).path),
    '/api/tasks/side-thread/file-preview',
  )
  await expectRead(() =>
    window.changeOwner({ sideThreadSnapshot: { before: 'side-old', after: 'side-newer' } }),
  )
  await expectRead(() => window.changeRuntime({ activeRuntimeId: 'other-runtime' }))
  await expectRead(() =>
    window.changeRuntime({
      connection: { address: 'http://other-lan.test', token: 'other-paired-token' },
    }),
  )
  // A late old-file reply must not replace the current file, including while the new read waits.
  await page.evaluate(() => {
    window.delay = true
    window.changeFile({ path: 'stale.txt' })
  })
  await page.waitForFunction(() => window.pending.length === 1)
  await page.evaluate(() => window.changeFile({ path: 'current.txt' }))
  await page.waitForFunction(() => window.pending.length === 2)
  await page.evaluate(() => window.pending.shift()())
  await settle()
  assert.equal(await page.getByRole('status').textContent(), 'Loading compact preview…')
  assert.equal((await page.locator('body').textContent()).includes('COMPACT stale.txt'), false)
  await page.evaluate(() => {
    window.delay = false
    window.pending.shift()()
  })
  await page.getByRole('button', { name: 'Load full diff', exact: true }).waitFor()
  assert.ok((await page.locator('body').textContent()).includes('COMPACT current.txt'))
  await page.evaluate(() => {
    window.compactOnly = true
  })
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page.getByRole('button', { name: 'Show compact preview', exact: true }).click()
  await page.getByRole('button', { name: 'Load full diff', exact: true }).waitFor()
  assert.ok((await page.locator('body').textContent()).includes('COMPACT current.txt'))
  await page.evaluate(() => {
    window.compactOnly = false
    window.fail = true
  })
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').textContent(), 'Preview unavailable')
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Retry full diff', exact: true }).click()
  await page.getByRole('article', { name: 'Complete diff' }).waitFor()
  assert.ok(
    (await page.getByLabel('After', { exact: true }).textContent()).endsWith(
      'FULL current.txt AFTER',
    ),
  )
  assert.deepEqual(errors, [])
  console.log(
    'Saved preview reads settle; content/owner changes reload; full 3MB sides and stale reply cancellation survive.',
  )
} finally {
  await browser.close()
}
