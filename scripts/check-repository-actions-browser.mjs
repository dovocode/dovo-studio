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
      import {RuntimeRequestError} from '@dovo/protocol';
      window.reads=[];window.writes=[];window.previews=[];window.connection={id:'runtime'};
      window.gitState={dirty:true,branch:'feature',ahead:0,behind:0,tracking:true,canPush:true};
      function App(){
        const [taskId,setTaskId]=useState('first'),[connected,setConnected]=useState(true),[connection,setConnection]=useState(window.connection),[revision,setRevision]=useState(0);
        window.configure=changes=>{if('taskId'in changes)setTaskId(changes.taskId);if('connected'in changes)setConnected(changes.connected);if('connection'in changes)setConnection(changes.connection);setRevision(value=>value+1)};
        window.store={connection,connected,request:async(path,input)=>{
          if(path==='/api/scm/action-state'){
            const state={...window.gitState};
            if(window.holdActionState)await new Promise(resolve=>window.releaseActionState=resolve);
            if(window.unsupportedState)throw new RuntimeRequestError({kind:'request',status:window.unsupportedState,message:'Endpoint not found'});
            if(window.failActionState)throw new Error('Branch status unavailable');
            return state;
          }
          if(path==='/api/scm/inspect')return {path:'/repo/'+(input.taskId??'main'),branch:'feature'};
          if(path==='/api/scm/changes')return new Promise((resolve,reject)=>window.reads.push({resolve,reject,input,connection}));
          if(path==='/api/scm/file-preview'){
            window.previews.push(input);
            if(window.unsupportedPreview)throw new RuntimeRequestError({kind:'request',status:window.unsupportedPreview,message:'Endpoint not found'});
            if(window.failPreview)throw new Error('Git changed while loading this comparison');
            if(window.holdPreview)await new Promise(resolve=>window.releasePreview=resolve);
            const before=input.comparison==='staged'?'HEAD contents':'INDEX contents';
            const after=input.comparison==='staged'?'INDEX contents':'WORKING contents';
            return {before:{kind:'text',text:before,size:before.length,truncated:false},after:{kind:'text',text:after,size:after.length,truncated:false},patch:'--- a/'+input.path+'\\n+++ b/'+input.path+'\\n@@ -1 +1 @@\\n-'+before+'\\n+'+after+'\\n'};
          }
          if(path==='/api/scm/branches')return {current:'feature',revision:'revision',branches:[]};
          window.writes.push({path,input,connection});
          if(path==='/api/scm/branch')return {current:input.name,revision:'new-revision',branches:[]};
          if(path==='/api/scm/commit'){
            if(window.holdCommit)await new Promise(resolve=>window.releaseCommit=resolve);
            window.gitState.ahead++;
            return {commit:'123456789'};
          }
          if(path==='/api/scm/push'){if(window.failPush)throw new Error('Push unavailable');window.gitState.ahead=0;window.gitState.tracking=true;}
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
          '@dovo/studio-core': `export * from '@dovo/protocol';export {studioSyntaxTheme,studioThemeIds} from '../studio-core/src/themes';export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:()=>{}});export const useAppPreferences=()=>({importedCodeThemes:[]});export const readAppPreferences=()=>({theme:'dark',themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});export const useDiffOptions=()=>({defaultSplit:false,options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'scroll'}});`,
          '@dovo/studio-core/repository-open': `export const useRepositoryOpen=()=>async()=>{};`,
          '@dovo/studio-ui': `export {Button} from '../studio-ui/src/components/ui/button';export {Checkbox} from '../studio-ui/src/components/ui/checkbox';export {Input} from '../studio-ui/src/components/ui/input';export {BranchPicker} from '../studio-ui/src/branch-picker';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const RepositoryOpenItems=()=>null;export const ChoicePicker=()=>null;export const LineCommentForm=()=>null;`,
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
          files: paths.map((file) => ({
            before: 'before',
            after: 'after',
            viewed: false,
            ...(typeof file === 'string' ? { path: file } : file),
          })),
        }),
      { index, paths },
    )
  const refresh = page.getByRole('button', { name: 'Refresh Git', exact: true })
  const stage = page.getByRole('button', { name: 'Stage selected', exact: true })
  const all = page.getByRole('checkbox', { name: /^Select all / }).and(page.locator(':enabled'))
  const message = page.getByRole('textbox', { name: 'Commit message', exact: true })
  const commitPush = page.getByRole('button', { name: 'Commit & push', exact: true })
  const push = page.getByRole('button', { name: 'Push branch', exact: true })

  // Opening loads changes without a click; a partial selection stages exactly those paths.
  await reads(1)
  await page.getByRole('status').filter({ hasText: 'Loading changes' }).waitFor()
  assert.equal(await push.isDisabled(), true)
  await page.getByLabel('Push status').filter({ hasText: 'Checking branch status' }).waitFor()
  await finish(0, [
    { path: 'src/one.ts', gitStatus: { index: 'modified', workingTree: 'modified' } },
    { path: 'image.png', gitStatus: { index: 'unchanged', workingTree: 'untracked' } },
  ])
  await all.waitFor()
  assert.equal(await push.isDisabled(), true)
  await page.getByLabel('Push status').filter({ hasText: 'Branch is up to date.' }).waitFor()
  assert.equal(
    await stage.evaluate(
      (button) =>
        !!(
          document.querySelector('[aria-label="Unstaged"]').compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
    true,
  )
  await page
    .getByRole('region', { name: 'Staged', exact: true })
    .getByText('Modified · Partially staged', { exact: true })
    .waitFor()
  await page
    .getByRole('region', { name: 'Unstaged', exact: true })
    .getByText('Modified · Partially staged', { exact: true })
    .waitFor()
  assert.equal(
    await page.getByRole('region', { name: 'Staged', exact: true }).getByRole('checkbox').count(),
    0,
  )
  assert.equal(await page.getByText('src/one.ts', { exact: true }).count(), 2)
  await page.getByText('Untracked', { exact: true }).waitFor()
  await page
    .getByLabel('Staging summary')
    .filter({ hasText: '1 staged file · 2 with unstaged changes' })
    .waitFor()
  assert.equal(await stage.isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Select src/one.ts', exact: true }).check()
  assert.equal(await all.getAttribute('aria-checked'), 'mixed')
  assert.deepEqual(await page.evaluate(() => window.writes), [])

  // Reviewing each side preserves the commit draft and staging selection. The real diff renderer
  // displays HEAD→index separately from index→disk even when a path is in both groups.
  await message.fill('Keep this commit draft')
  const back = page.getByRole('button', { name: '← Back to staging', exact: true })
  await page.getByRole('button', { name: 'Review staged src/one.ts', exact: true }).click()
  await page.getByRole('region', { name: 'Staged file review' }).waitFor()
  await page.getByText('HEAD contents', { exact: true }).waitFor()
  await page.getByText('INDEX contents', { exact: true }).waitFor()
  assert.equal(await page.getByText('WORKING contents', { exact: true }).count(), 0)
  assert.equal(await message.isVisible(), false)
  await back.click()
  assert.equal(await message.inputValue(), 'Keep this commit draft')
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Review staged src/one.ts',
  )
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select src/one.ts', exact: true }).isChecked(),
    true,
  )
  await page.getByRole('button', { name: 'Review unstaged src/one.ts', exact: true }).click()
  await page.getByText('INDEX contents', { exact: true }).waitFor()
  await page.getByText('WORKING contents', { exact: true }).waitFor()
  assert.equal(await page.getByText('HEAD contents', { exact: true }).count(), 0)
  await back.click()
  assert.equal(await message.inputValue(), 'Keep this commit draft')
  assert.deepEqual(await page.evaluate(() => window.previews), [
    { repositoryId: 'repo', taskId: 'first', path: 'src/one.ts', comparison: 'staged' },
    { repositoryId: 'repo', taskId: 'first', path: 'src/one.ts', comparison: 'unstaged' },
  ])
  assert.deepEqual(await page.evaluate(() => window.writes), [])
  // Older computers keep the draft and staging selection while explaining the required update.
  for (const status of [404, 405]) {
    await page.evaluate((status) => {
      window.unsupportedPreview = status
    }, status)
    const comparison = status === 404 ? 'staged' : 'unstaged'
    const reviewLabel = `Review ${comparison} src/one.ts`
    await page.getByRole('button', { name: reviewLabel, exact: true }).click()
    await page
      .getByRole('status')
      .filter({
        hasText:
          'Update Dovo on this computer to review staged and unstaged changes. Your commit draft and selections are kept.',
      })
      .waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retry preview', exact: true }).count(), 0)
    assert.equal(await page.getByRole('alert').count(), 0)
    await back.click()
    assert.equal(await message.inputValue(), 'Keep this commit draft')
    assert.equal(
      await page.getByRole('checkbox', { name: 'Select src/one.ts', exact: true }).isChecked(),
      true,
    )
    await page.waitForFunction(
      (label) => document.activeElement?.getAttribute('aria-label') === label,
      reviewLabel,
    )
    assert.deepEqual(await page.evaluate(() => window.writes), [])
  }
  await page.evaluate(() => {
    window.unsupportedPreview = false
  })
  await page.evaluate(() => {
    window.failPreview = true
  })
  await page.getByRole('button', { name: 'Review staged src/one.ts', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Git changed while loading' }).waitFor()
  await page.evaluate(() => {
    window.failPreview = false
  })
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await page.getByText('HEAD contents', { exact: true }).waitFor()
  await page.evaluate(() => window.configure({ connected: false }))
  await page.getByRole('status').filter({ hasText: 'Connect to the runtime to review' }).waitFor()
  assert.equal(await page.getByText('HEAD contents', { exact: true }).count(), 0)
  await back.click()
  assert.equal(await message.inputValue(), 'Keep this commit draft')
  await page.evaluate(() => window.configure({ connected: true }))
  await reads(2)
  await finish(1, [
    { path: 'src/one.ts', gitStatus: { index: 'modified', workingTree: 'modified' } },
    { path: 'image.png', gitStatus: { index: 'unchanged', workingTree: 'untracked' } },
  ])
  // Keep the original read-count assertions below stable after the reconnect check.
  await page.evaluate(() => window.reads.splice(1, 1))
  await stage.and(page.locator(':enabled')).waitFor()
  await stage.click()
  await reads(2)
  assert.deepEqual(await page.evaluate(() => window.writes[0]), {
    path: '/api/scm/stage',
    input: { repositoryId: 'repo', taskId: 'first', paths: ['src/one.ts'] },
    connection: { id: 'runtime' },
  })
  await finish(1, [
    { path: 'src/one.ts', gitStatus: { index: 'modified', workingTree: 'unchanged' } },
    { path: 'image.png', gitStatus: { index: 'unchanged', workingTree: 'untracked' } },
  ])
  await all.waitFor()
  await page.getByText('Modified', { exact: true }).waitFor()
  await page
    .getByLabel('Staging summary')
    .filter({ hasText: '1 staged file · 1 with unstaged changes' })
    .waitFor()
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
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  assert.equal(await page.getByText('No uncommitted changes.', { exact: true }).count(), 0)
  await refresh.click()
  await reads(5)
  await finish(4, ['legacy.ts'])
  await page
    .getByRole('region', { name: 'Staging status unavailable', exact: true })
    .getByText('legacy.ts', { exact: true })
    .waitFor()
  await page.getByRole('heading', { name: 'Staged · 0 known', exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('region', { name: 'Unstaged', exact: true })
      .getByText('legacy.ts', { exact: true })
      .count(),
    0,
  )
  await page
    .getByLabel('Staging summary')
    .filter({ hasText: 'Staged contents unavailable' })
    .waitFor()

  // Committing preserves push-failure recovery and refreshes the resulting file list.
  await message.fill('Commit selected work')
  await page.evaluate(() => (window.failPush = true))
  await commitPush.click()
  await reads(6)
  await finish(5, [])
  await message.waitFor({ state: 'detached' })
  await page
    .getByRole('status')
    .filter({ hasText: 'Use Push branch to retry without committing again' })
    .waitFor()
  assert.equal(await message.count(), 0)
  await page.evaluate(() => (window.failPush = false))
  await push.click()
  await page.getByRole('status').filter({ hasText: 'Branch pushed.' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.writes.filter((write) => write.path === '/api/scm/commit').length,
    ),
    1,
  )

  await reads(7)
  await finish(6, [])
  await page.getByLabel('Push status').filter({ hasText: 'Branch is up to date.' }).waitFor()
  // Offline does not read; reconnect reads again. No old checkout state leaks into another task.
  await page.evaluate(() => window.configure({ connected: false }))
  await page.getByRole('status').filter({ hasText: 'Connect to the runtime' }).waitFor()
  assert.equal(await refresh.isDisabled(), true)
  assert.equal(await page.evaluate(() => window.reads.length), 7)
  await page.evaluate(() => window.configure({ connected: true }))
  await reads(8)
  await page.evaluate(() => window.configure({ taskId: 'second' }))
  await reads(9)
  await finish(8, ['second.ts'])
  await page.getByRole('checkbox', { name: 'Select second.ts', exact: true }).waitFor()
  await finish(7, ['stale.ts'])
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
  await reads(10)
  await finish(9, ['third.ts'])
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
  await reads(11)
  assert.equal(await message.count(), 0)
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select third.ts', exact: true }).count(),
    0,
  )
  await finish(
    10,
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
  await reads(12)
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
    repositoryId: 'repo',
    taskId: 'third',
    action: 'create',
    name: 'new-branch',
    revision: 'revision',
  })
  await finish(11, [])
  await page.getByText('No uncommitted changes.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'new-branch', exact: true }).waitFor()

  // A clean checkout hides the commit form and gives focus to an available control or heading.
  assert.equal(await message.count(), 0)
  assert.equal(await page.getByLabel('Staging summary').count(), 0)
  assert.equal(
    await page.getByText('Commits include all staged files', { exact: false }).count(),
    0,
  )
  assert.equal(
    await page.evaluate(
      () =>
        document.activeElement?.tagName === 'H3' || document.activeElement?.tagName === 'BUTTON',
    ),
    true,
  )
  const commit = page.getByRole('button', { name: 'Commit staged', exact: true })
  await refresh.click()
  await reads(13)
  await finish(12, [
    { path: 'unstaged.ts', gitStatus: { index: 'unchanged', workingTree: 'modified' } },
  ])
  await page.getByText('Modified', { exact: true }).waitFor()
  await message.fill('All staged membership')
  assert.equal(await commit.isDisabled(), true)
  await all.check()
  assert.equal(await commitPush.isDisabled(), true)

  // Commit membership is all staged files, independently of checkbox selection.
  await refresh.click()
  await reads(14)
  await finish(13, [
    { path: 'partial.ts', gitStatus: { index: 'modified', workingTree: 'modified' } },
    { path: 'added.ts', gitStatus: { index: 'added', workingTree: 'unchanged' } },
    { path: 'deleted.ts', gitStatus: { index: 'deleted', workingTree: 'unchanged' } },
    { path: 'new.ts', gitStatus: { index: 'unchanged', workingTree: 'untracked' } },
    { path: 'mode.sh', gitStatus: { index: 'unchanged', workingTree: 'modified' } },
  ])
  await page
    .getByLabel('Staging summary')
    .filter({ hasText: '3 staged files · 3 with unstaged changes' })
    .waitFor()
  await page.getByText('Added', { exact: true }).waitFor()
  await page.getByText('Deleted', { exact: true }).waitFor()
  await page.getByRole('checkbox', { name: 'Select mode.sh', exact: true }).check()
  const stagesBeforeCommit = await page.evaluate(
    () => window.writes.filter((write) => write.path === '/api/scm/stage').length,
  )
  assert.equal(await commit.isDisabled(), false)
  await commit.click()
  await reads(15)
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
    repositoryId: 'repo',
    taskId: 'third',
    message: 'All staged membership',
  })
  assert.equal(
    await page.evaluate(
      () => window.writes.filter((write) => write.path === '/api/scm/stage').length,
    ),
    stagesBeforeCommit,
  )
  await finish(14, [])
  await page.getByText('No uncommitted changes.', { exact: true }).waitFor()

  // Conflicts are explicit and cannot be mistaken for committable staged additions/deletions.
  await refresh.click()
  await reads(16)
  await finish(15, [
    { path: 'conflict.ts', gitStatus: { index: 'unmerged', workingTree: 'unmerged' } },
  ])
  await page.getByText('Conflict: resolve before committing', { exact: true }).waitFor()
  await message.fill('Resolve first')
  await page.getByLabel('Staging summary').filter({ hasText: '0 staged files' }).waitFor()
  assert.equal(await commit.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  // Unstaging only the requested staged path preserves the other commit members.
  await refresh.click()
  await reads(17)
  await finish(16, [
    { path: 'partial.ts', gitStatus: { index: 'modified', workingTree: 'modified' } },
    { path: 'other.ts', gitStatus: { index: 'added', workingTree: 'unchanged' } },
  ])
  await page.getByRole('button', { name: 'Unstage partial.ts', exact: true }).click()
  await reads(18)
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1)), {
    path: '/api/scm/unstage',
    input: { repositoryId: 'repo', taskId: 'third', paths: ['partial.ts'] },
    connection: { id: 'other-runtime' },
  })
  await finish(17, [
    { path: 'partial.ts', gitStatus: { index: 'unchanged', workingTree: 'modified' } },
    { path: 'other.ts', gitStatus: { index: 'added', workingTree: 'unchanged' } },
  ])
  await page.getByRole('button', { name: 'Unstage other.ts', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Unstage partial.ts', exact: true }).count(),
    0,
  )
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select other.ts', exact: true }).count(),
    0,
  )
  await page.getByRole('status').filter({ hasText: 'Working file contents kept' }).waitFor()
  // Push availability comes from the runtime, independently of staged membership.
  let nextRead = 18
  const state = async (patch, paths = ['legacy.ts']) => {
    await page.evaluate((patch) => Object.assign(window.gitState, patch), patch)
    await refresh.click()
    await reads(++nextRead)
    await finish(nextRead - 1, paths)
    await refresh.and(page.locator(':enabled')).waitFor()
  }
  await state({ ahead: 2 })
  assert.equal(await push.isDisabled(), false)
  assert.equal(await push.textContent(), 'Push branch (2)')
  await page.getByLabel('Push status').filter({ hasText: '2 commits ready to push.' }).waitFor()
  await message.fill('Check commit and push')
  assert.equal(await commitPush.isDisabled(), false)

  await state({ behind: 3 })
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  assert.equal(await commit.isDisabled(), false)
  await page.getByLabel('Push status').filter({ hasText: '3 commits behind upstream' }).waitFor()

  await state({ ahead: 0, behind: 0, tracking: false, canPush: false })
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  await page
    .getByLabel('Push status')
    .filter({ hasText: 'No push destination available' })
    .waitFor()
  await state({ canPush: true })
  assert.equal(await push.isDisabled(), false)
  await page.getByLabel('Push status').filter({ hasText: 'Publish this branch' }).waitFor()
  await state({ branch: '', canPush: false })
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  await page.getByLabel('Push status').filter({ hasText: 'Check out a branch' }).waitFor()

  // A failed capability read preserves staging/commit but cannot silently enable Push.
  await page.evaluate(() => (window.failActionState = true))
  await state({ branch: 'feature', canPush: true })
  await page.getByLabel('Push status').filter({ hasText: 'Branch status unavailable' }).waitFor()
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  assert.equal(await commit.isDisabled(), false)
  await page.evaluate(() => {
    window.failActionState = false
    window.unsupportedState = 404
  })
  await state({})
  await page.getByLabel('Push status').filter({ hasText: 'Update this runtime' }).waitFor()
  assert.equal(await push.isDisabled(), true)
  assert.equal(await commitPush.isDisabled(), true)
  assert.equal(await commit.isDisabled(), false)
  await page.getByRole('checkbox', { name: 'Select legacy.ts', exact: true }).check()
  assert.equal(await stage.isDisabled(), false)
  await page.evaluate(() => (window.unsupportedState = 405))
  await state({})
  await page.getByLabel('Push status').filter({ hasText: 'Update this runtime' }).waitFor()

  // Refresh waits for branch state too, and does not expose stale enabled actions.
  await page.evaluate(() => {
    window.unsupportedState = false
    window.holdActionState = true
  })
  await refresh.click()
  await reads(++nextRead)
  await finish(nextRead - 1, [])
  assert.equal(await push.isDisabled(), true)
  await page.getByLabel('Push status').filter({ hasText: 'Checking branch status' }).waitFor()
  await page.evaluate(() => {
    window.holdActionState = false
    window.releaseActionState()
  })
  await page.getByLabel('Push status').filter({ hasText: 'Publish this branch' }).waitFor()
  assert.equal(await push.isDisabled(), false)
  assert.deepEqual(errors, [])
  console.log('Repository actions browser checks passed')
} finally {
  await browser.close()
}
