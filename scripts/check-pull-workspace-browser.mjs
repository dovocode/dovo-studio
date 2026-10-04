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
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,pulls:window.pulls}],connected:true,busy:false,refresh:()=>{},more:()=>{}});`,
  './use-pull-detail': `export const usePullDetail=()=>({detail:window.detail,error:'',busy:false,refresh:()=>{},invalidate:()=>{}});`,
  './patch': `export const PullPatch=({file})=><pre>{file.patch}</pre>;`,
  './stack': `export const PullStack=()=>null;`,
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
    contents: `import {createRoot} from 'react-dom/client';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,title:'Other author',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'}],checks:[],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.store={connected:true,activeRuntimeId:'mac',workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};createRoot(document.getElementById('app')).render(<div className="studio dark flex h-screen"><View/></div>);`,
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
  await page.getByRole('button', { name: 'Authored by me', exact: true }).click()
  assert.equal(await page.getByRole('button').filter({ hasText: 'Other author' }).count(), 0)
  await page.getByRole('button').filter({ hasText: 'Improve pull request reviews' }).first().click()
  await page.getByText('Review workflow description', { exact: true }).waitFor()
  await page.getByText('Please add a test', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'PR state' }).waitFor()
  await page.getByRole('tab', { name: /Changes/ }).click()
  assert.equal(await page.locator('[aria-label="Code changes"] article').count(), 2)
  await page.getByRole('checkbox').first().check()
  await page.getByText('1 of 2 reviewed', { exact: true }).waitFor()
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
  const form = page.getByRole('form', { name: 'Add a pull request comment' })
  await form.getByRole('textbox').fill('Feedback')
  await form.getByRole('button', { name: 'Bold', exact: true }).click()
  await form.getByRole('button', { name: 'Preview', exact: true }).click()
  await form.getByText(/\*\*text\*\*/).waitFor()
  await form.getByRole('button', { name: 'Comment', exact: true }).click()
  assert.equal((await page.evaluate(() => window.writes.at(-1))).input.action, 'comment')
  await page.screenshot({ path: '/tmp/dovo-pull-workspace.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log(
    'PR workspace: persistent filters, personal views, overview activity, stacked diffs, review progress, review submission, Markdown comments and narrow layout passed.',
  )
} finally {
  await browser.close()
}
