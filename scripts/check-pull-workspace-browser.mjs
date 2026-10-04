import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const uiDir = root + '/packages/studio-ui/src'
const controls =
  ['button', 'input', 'textarea', 'checkbox', 'badge', 'dialog']
    .map((name) => `export * from '${uiDir}/components/ui/${name}.tsx';`)
    .join('') +
  `export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const FormField=({label,children})=><label>{label}{children}</label>;export const MessageResponse=({children})=><div>{children}</div>;`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useAppPreferences=()=>({hideWhitespaceChanges:false});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto'});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,pulls:window.pulls}],connected:window.store.connected,busy:false,refresh:()=>{},more:()=>{}});`,
  './use-pull-detail': `export const usePullDetail=()=>({detail:window.detail,error:'',busy:false,refresh:()=>{},invalidate:()=>{}});`,
  './patch': `export const PullPatch=({file})=><pre>{file.patch}</pre>;`,
  './pipeline-runs': `export const PullPipelineRuns=()=>null;`,
  '../list/start-task': `export const StartPullTask=()=> <div role="dialog">Start PR task</div>;`,
  './create': `export const CreatePull=()=>null;`,
  '../../connections/forge-connections': `export const ForgeConnections=()=>null;`,
  '../../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {createRoot} from 'react-dom/client';import {PullDetail} from '${root}/packages/extension-scm/src/pulls/detail/detail.tsx';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],checksState:'SUCCESS',reviewDecision:'REVIEW_REQUIRED',additions:24,deletions:8,commentCount:3,viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,title:'Other author',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false},{...pull,number:9,title:'Draft feature',draft:true,viewerIsAuthor:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',mergeable:true,reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'},{id:'review',kind:'review',author:'teammate',state:'APPROVED',body:'Looks good to me',url:pull.url,date:'2026-10-04'}],checks:[{name:'Tests',status:'SUCCESS',summary:'All tests passed',details:'2 tests completed'}],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>window.copied.push(value)}});window.store={connected:true,activeRuntimeId:'mac',workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};const rootView=createRoot(document.getElementById('app'));window.showEmbedded=()=>rootView.render(<main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main>);rootView.render(<div className="studio dark flex h-screen"><View/></div>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  const assets = root + '/apps/web/dist/client/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const list = page.getByRole('navigation', { name: 'Pull request sidebar' })
  const row = (title) => list.getByRole('button').filter({ hasText: title }).first()
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
  const fullWidthList = async () =>
    assert.equal(
      await list.evaluate(
        (element) =>
          Math.abs(
            element.getBoundingClientRect().width -
              element.parentElement.getBoundingClientRect().width,
          ) < 2,
      ),
      true,
    )
  await page.getByRole('textbox', { name: 'Search pull requests' }).waitFor()
  for (const name of [
    'PR repository',
    'PR state',
    'PR sort',
    'Refresh pull requests',
    'Create pull request',
  ])
    assert.equal(await list.getByRole('button', { name, exact: true }).isVisible(), true)
  await fullWidthList()
  await noOverflow()
  assert.equal(
    await row('Improve pull request reviews').evaluate((element) => element.clientHeight < 90),
    true,
  )
  await page.screenshot({ path: '/tmp/dovo-pull-list.png' })
  await list.getByRole('button', { name: 'Actions for PR #7', exact: true }).click()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Open in browser', exact: true }).getAttribute('href'),
    'https://github.com/team/project/pull/7',
  )
  await page.getByRole('menuitem', { name: 'Copy PR link', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.copied), [
    'https://github.com/team/project/pull/7',
  ])
  assert.equal(await page.locator('[aria-label="Pull request details"]').count(), 0)
  await row('Improve pull request reviews').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open PR details', exact: true }).waitFor()
  assert.equal(await page.locator('[aria-label="Pull request details"]').count(), 0)
  await page.keyboard.press('Escape')
  await row('Improve pull request reviews').click({ modifiers: ['ControlOrMeta'] })
  await row('Other author').click({ modifiers: ['Shift'] })
  await page.getByText('2 PRs selected', { exact: true }).waitFor()
  await list.getByRole('button', { name: 'Actions for PR #7', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add to thread (2 PRs)', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await row('Improve pull request reviews').focus()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByText('2 PRs selected', { exact: true }).count(), 0)
  const search = list.getByRole('textbox', { name: 'Search pull requests' })
  await search.fill('Other author')
  assert.equal(await row('Improve pull request reviews').count(), 0)
  await row('Other author').waitFor()
  await search.fill('')
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  await list.getByRole('button', { name: 'PR draft status', exact: true }).click()
  await page.getByRole('option', { name: 'Drafts', exact: true }).click()
  assert.equal(await row('Other author').count(), 0)
  await row('Draft feature').waitFor()
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  assert.match(await list.getByRole('button', { name: 'Filters', exact: true }).innerText(), /1/)
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  await list.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Authored by me', exact: true }).click()
  assert.equal(await page.getByRole('button').filter({ hasText: 'Other author' }).count(), 0)
  await page.getByRole('button').filter({ hasText: 'Improve pull request reviews' }).first().click()
  await page.getByText('Review workflow description', { exact: true }).waitFor()
  await page.getByText('Please add a test', { exact: true }).waitFor()
  const detail = page.locator('[aria-label="Pull request details"]')
  const content = detail.locator('[aria-label="Pull request content"]')
  const heading = detail.getByRole('heading', { name: 'Improve pull request reviews', exact: true })
  assert.equal(await list.evaluate((element) => element.clientWidth <= 416), true)
  await detail
    .locator('[aria-label="Pull request status"]')
    .getByText('No merge conflicts', { exact: true })
    .waitFor()
  await page.screenshot({ path: '/tmp/dovo-pull-overview.png' })
  await detail.getByRole('button', { name: 'Reviews 1', exact: true }).click()
  assert.equal(await detail.getByText('Please add a test', { exact: true }).isVisible(), false)
  await detail.getByText('Looks good to me', { exact: true }).waitFor()
  await detail.getByRole('button', { name: 'All activity 2', exact: true }).click()
  const form = page.getByRole('form', { name: 'Add a pull request comment' })
  await form.getByRole('textbox').fill('Draft feedback')
  const headingTop = await heading.evaluate((element) => element.getBoundingClientRect().top)
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  assert.equal(await heading.evaluate((element) => element.getBoundingClientRect().top), headingTop)
  await detail.getByRole('button', { name: 'View pull request checks', exact: true }).click()
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).waitFor()
  assert.equal(
    await detail
      .getByRole('tab', { name: 'Checks (1)', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await detail.getByText('All tests passed', { exact: true }).waitFor()
  await detail.getByText('Check output', { exact: true }).click()
  await detail.getByText('2 tests completed', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-pull-checks.png' })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).press('Home')
  assert.equal(
    await detail.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  assert.equal(await form.getByRole('textbox').inputValue(), 'Draft feedback')
  await page.getByRole('tab', { name: /Changes/ }).click()
  assert.equal(await page.locator('[aria-label="Code changes"] article').count(), 2)
  await page.getByRole('checkbox').first().check()
  await page.getByText('1 of 2 reviewed', { exact: true }).waitFor()
  assert.equal(await heading.isVisible(), true)
  await page
    .getByRole('navigation', { name: 'Changed files' })
    .getByRole('button', { name: /second.ts/ })
    .click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('radio', { name: /Approve merging/ }).check()
  await page.getByRole('dialog').getByRole('textbox', { name: 'PR action body' }).fill('Looks good')
  await page.getByRole('dialog').getByRole('button', { name: 'Submit review', exact: true }).click()
  assert.equal((await page.evaluate(() => window.writes[0])).input.event, 'approve')
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  await form.getByRole('textbox').fill('Feedback')
  await form.getByRole('button', { name: 'Bold', exact: true }).click()
  await form.getByRole('button', { name: 'Preview', exact: true }).click()
  await form.getByText(/\*\*text\*\*/).waitFor()
  await form.getByRole('button', { name: 'Comment', exact: true }).click()
  assert.equal((await page.evaluate(() => window.writes.at(-1))).input.action, 'comment')
  await page.screenshot({ path: '/tmp/dovo-pull-workspace.png' })
  await page.getByRole('tab', { name: /Changes/ }).click()
  await page.getByText('1 of 2 reviewed', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-pull-changes.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const name of ['Overview', 'Changes (2)', 'Checks (1)']) {
    await detail.getByRole('tab', { name, exact: true }).click()
    await noOverflow()
    assert.equal(await heading.isVisible(), true)
    assert.equal(await content.evaluate((element) => element.clientHeight > 100), true)
  }
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await content.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: '/tmp/dovo-pull-overview-narrow.png' })
  await page.evaluate(() => {
    window.detail.pull.title = 'A very long pull request title '.repeat(12)
    window.detail.pull.head = 'feature/' + 'long-branch-name'.repeat(12)
  })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await noOverflow()
  assert.equal(await content.evaluate((element) => element.clientHeight > 100), true)
  await page.evaluate(() => {
    window.store.connected = false
    window.source.connected = false
  })
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await detail.getByText('Offline · showing last loaded details.', { exact: true }).waitFor()
  assert.equal(await detail.getByRole('button', { name: 'Review', exact: true }).isDisabled(), true)
  assert.equal(await form.getByRole('button', { name: 'Comment', exact: true }).isDisabled(), true)
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await fullWidthList()
  await noOverflow()
  assert.equal(await list.getByRole('textbox', { name: 'Search pull requests' }).isVisible(), true)
  await page.screenshot({ path: '/tmp/dovo-pull-list-narrow.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.store.connected = true
    window.source.connected = true
    window.detail.pull.title = 'Improve pull request reviews'
    window.detail.pull.head = 'feature'
    window.detail.checks[0] = { name: 'Tests', status: 'FAILURE', summary: 'One test failed' }
    window.showEmbedded()
  })
  const embedded = page.locator('[aria-label="Pull request details"]')
  await embedded.getByRole('button', { name: 'Close preview', exact: true }).waitFor()
  await embedded.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await embedded.getByText('One test failed', { exact: true }).waitFor()
  assert.equal(
    await embedded
      .getByRole('tabpanel')
      .filter({ visible: true })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  )
  await noOverflow()
  await embedded.getByRole('tab', { name: 'Changes (2)', exact: true }).click()
  await noOverflow()
  await embedded.getByRole('button', { name: 'Close preview', exact: true }).click()
  assert.equal(await page.evaluate(() => window.embeddedClosed), true)
  assert.deepEqual(errors, [])
  console.log(
    'PR workspace: full-width and compact lists, visible controls, row actions, multi-selection, filters, overview activity, persistent title, checks, tab keyboard navigation, draft and review preservation, review submission, Markdown comments, offline state, narrow layouts and embedded previews passed.',
  )
} finally {
  await browser.close()
}
