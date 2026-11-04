import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {RepositoryActions} from '../extension-scm/src/connections/repository-actions';
      window.reads=[];window.writes=[];window.connection={id:'runtime'};
      function App(){
        const [taskId,setTaskId]=useState('first'),[connected,setConnected]=useState(true),[connection,setConnection]=useState(window.connection),[revision,setRevision]=useState(0);
        window.configure=changes=>{if('taskId'in changes)setTaskId(changes.taskId);if('connected'in changes)setConnected(changes.connected);if('connection'in changes)setConnection(changes.connection);setRevision(value=>value+1)};
        window.store={connection,connected,request:async(path,input)=>{
          if(path==='/api/scm/inspect')return {path:'/repo/'+(input.taskId??'main'),branch:'feature'};
          if(path==='/api/scm/changes')return new Promise((resolve,reject)=>window.reads.push({resolve,reject,input,connection}));
          if(path==='/api/scm/branches')return {current:'feature',revision:'revision',branches:[]};
          window.writes.push({path,input,connection});
          if(path==='/api/scm/branch')return {current:input.name,revision:'new-revision',branches:[]};
          if(path==='/api/scm/commit'){
            if(window.holdCommit)await new Promise(resolve=>window.releaseCommit=resolve);
            return {commit:'123456789'};
          }
          if(path==='/api/scm/push'&&window.failPush)throw new Error('Push unavailable');
          return {ok:true};
        }};
        return <RepositoryActions repo={{id:'repo',name:'Project',path:'/repo',branch:'main'}} taskId={taskId}/>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'repository-actions-environment',
      setup(builder) {
        const mocks = {
          '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
          '@dovo/studio-core': `export * from '@dovo/protocol';export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:()=>{}});`,
          '@dovo/studio-core/repository-open': `export const useRepositoryOpen=()=>async()=>{};`,
          '@dovo/studio-ui': `export {Button} from '../studio-ui/src/components/ui/button';export {Checkbox} from '../studio-ui/src/components/ui/checkbox';export {Input} from '../studio-ui/src/components/ui/input';export {BranchPicker} from '../studio-ui/src/branch-picker';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const RepositoryOpenItems=()=>null;`,
          './create-github': `export const CreateGithub=()=>null;`,
        }
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const reads = (count) => page.waitForFunction((count) => window.reads.length === count, count)
  const finish = (index, paths) =>
    page.evaluate(
      ({ index, paths }) =>
        window.reads[index].resolve({
          files: paths.map((path) => ({ path, before: 'before', after: 'after', viewed: false })),
        }),
      { index, paths },
    )
  const refresh = page.getByRole('button', { name: 'Refresh Git', exact: true })
  const stage = page.getByRole('button', { name: 'Stage selected', exact: true })
  const all = page.getByRole('checkbox', { name: 'Select all changed files', exact: true })
  const message = page.getByRole('textbox', { name: 'Commit message', exact: true })
  const commitPush = page.getByRole('button', { name: 'Commit & push', exact: true })
  const push = page.getByRole('button', { name: 'Push branch', exact: true })

  // Opening loads changes without a click; a partial selection stages exactly those paths.
  await reads(1)
  await page.getByRole('status').filter({ hasText: 'Loading changes' }).waitFor()
  await finish(0, ['src/one.ts', 'image.png'])
  await all.waitFor()
  assert.equal(await stage.isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Select src/one.ts', exact: true }).check()
  assert.equal(await all.getAttribute('aria-checked'), 'mixed')
  await stage.click()
  await reads(2)
  assert.deepEqual(await page.evaluate(() => window.writes[0]), {
    path: '/api/scm/stage',
    input: { repositoryId: 'repo', taskId: 'first', paths: ['src/one.ts'] },
    connection: { id: 'runtime' },
  })
  await finish(1, ['src/one.ts', 'image.png'])
  await all.waitFor()
  assert.equal(await all.isChecked(), false)
  await all.check()
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select image.png', exact: true }).isChecked(),
    true,
  )
  await all.uncheck()
  assert.equal(await stage.isDisabled(), true)

  // A refresh prunes removed selections and an error never reports a clean checkout.
  await all.check()
  await refresh.click()
  await reads(3)
  await finish(2, ['image.png'])
  await all.waitFor()
  assert.equal(await all.isChecked(), true)
  await refresh.click()
  await reads(4)
  await page.evaluate(() => window.reads[3].reject(new Error('Changes unavailable')))
  await page.getByRole('alert').filter({ hasText: 'Changes unavailable' }).waitFor()
  assert.equal(await stage.count(), 0)
  assert.equal(await page.getByText('No uncommitted changes.', { exact: true }).count(), 0)
  await refresh.click()
  await reads(5)
  await finish(4, [])
  await page.getByText('No uncommitted changes.', { exact: true }).waitFor()

  // Committing preserves push-failure recovery and refreshes the resulting file list.
  await message.fill('Commit selected work')
  await page.evaluate(() => (window.failPush = true))
  await commitPush.click()
  await reads(6)
  await finish(5, [])
  await page
    .getByRole('status')
    .filter({ hasText: 'Use Push branch to retry without committing again' })
    .waitFor()
  assert.equal(await message.inputValue(), '')
  await page.evaluate(() => (window.failPush = false))
  await push.click()
  await page.getByRole('status').filter({ hasText: 'Branch pushed.' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.writes.filter((write) => write.path === '/api/scm/commit').length,
    ),
    1,
  )

  // Offline does not read; reconnect reads again. No old checkout state leaks into another task.
  await page.evaluate(() => window.configure({ connected: false }))
  await page.getByRole('status').filter({ hasText: 'Connect to the runtime' }).waitFor()
  assert.equal(await refresh.isDisabled(), true)
  assert.equal(await page.evaluate(() => window.reads.length), 6)
  await page.evaluate(() => window.configure({ connected: true }))
  await reads(7)
  await page.evaluate(() => window.configure({ taskId: 'second' }))
  await reads(8)
  await finish(7, ['second.ts'])
  await page.getByRole('checkbox', { name: 'Select second.ts', exact: true }).waitFor()
  await finish(6, ['stale.ts'])
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select stale.ts', exact: true }).count(),
    0,
  )

  // Switching checkout during commit keeps its subsequent push scoped to the captured checkout.
  await message.fill('Captured checkout')
  await page.evaluate(() => {
    window.holdCommit = true
  })
  await commitPush.click()
  await page.waitForFunction(() => typeof window.releaseCommit === 'function')
  await page.evaluate(() => window.configure({ taskId: 'third' }))
  await reads(9)
  await finish(8, ['third.ts'])
  await page.evaluate(() => {
    window.holdCommit = false
    window.releaseCommit()
  })
  await page.waitForFunction(() => window.writes.at(-1).path === '/api/scm/push')
  assert.equal(await page.evaluate(() => window.writes.at(-1).input.taskId), 'second')
  assert.equal(await message.inputValue(), '')
  await page.getByRole('checkbox', { name: 'Select third.ts', exact: true }).waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Committed' }).count(), 0)

  // A paired-runtime change also starts with a fresh list and commit draft.
  await message.fill('Draft for third')
  await page.evaluate(() => window.configure({ connection: { id: 'other-runtime' } }))
  await reads(10)
  assert.equal(await message.inputValue(), '')
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select third.ts', exact: true }).count(),
    0,
  )
  await finish(
    9,
    Array.from({ length: 201 }, (_, index) => `file-${index}.ts`),
  )
  await all.waitFor()
  await all.check()
  assert.equal(await stage.isDisabled(), true)
  await page.getByText('Select up to 200 files to stage at a time.', { exact: true }).waitFor()
  await page.getByRole('checkbox', { name: 'Select file-0.ts', exact: true }).uncheck()
  assert.equal(await stage.isDisabled(), false)

  // Branch creation keeps its revision guard and reloads changes in the new branch.
  await page.getByRole('button', { name: 'feature', exact: true }).click()
  await page.getByRole('textbox', { name: 'New branch name', exact: true }).fill('new-branch')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await reads(11)
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
    repositoryId: 'repo',
    taskId: 'third',
    action: 'create',
    name: 'new-branch',
    revision: 'revision',
  })
  await finish(10, [])
  await page.getByText('No uncommitted changes.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'new-branch', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Repository actions browser checks passed')
} finally {
  await browser.close()
}
