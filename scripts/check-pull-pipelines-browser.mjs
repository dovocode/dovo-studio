import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const built = await bundleBrowser(
  {
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `import {createRoot} from 'react-dom/client';
import {PullPipelineRuns} from '${root}/packages/extension-scm/src/pulls/detail/pipeline-runs.tsx';
const run={id:'run-1',number:1,title:'PR build',url:'https://github.com/team/project/actions/runs/1',status:'success',sha:'commit',ref:'feature',workflow:'Build',updatedAt:'2026-10-14',createdAt:'2026-10-14',actor:'Dominic'};
const job={id:'job-1',name:'Build job',status:'success',url:run.url+'/job/1',steps:[{id:'step-1',name:'Compile source',status:'success'}]};
window.reads=[];window.store={connected:true,activeRuntimeId:'owner',runtimes:[],connection:{address:'http://owner.local'},workspace:{repositories:[{id:'repo',name:'Project',forge:{connectionId:'account-1',repository:'team/project'}}]},request:async(path,input)=>{
window.reads.push({path,input});
if(path==='/api/scm/source/identity')return {readerIdentity:'fixture-account',destination:'fixture-destination'};
if(path.endsWith('/options'))return {provider:'github',pipelines:true,issues:false,pipelineActions:[],pipelineDefinitions:[]};
if(path.endsWith('/pipelines/list'))return {items:[run]};
if(path.endsWith('/pipelines/detail'))return {run,jobs:[job]};
throw new Error('Unexpected request '+path);
}};
const app=createRoot(document.getElementById('app'));window.active=true;window.mount=()=>app.render(<div hidden={!window.active}><PullPipelineRuns repositoryId="repo" sha="commit" active={window.active}/></div>);window.remount=()=>{app.render(null);setTimeout(window.mount,0)};window.mount();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export {appendUniqueRows,RequestScope} from '${root}/packages/client-runtime/src/effects/request-scope.ts';const sources=[];export const useRepositorySources=()=>sources;export const useWorkspace=()=>window.store;export const formatDateTime=x=>String(x);`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents:
        ['button', 'input', 'dialog']
          .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
          .join('') +
        `export {PageHeader} from '${ui}/page-header.tsx';export {ChoicePicker} from '${ui}/choice-picker.tsx';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
    },
    {
      path: './work-form',
      importer: root + '/packages/extension-scm/src/work/content.tsx',
      contents: 'export const WorkForm=()=>null;',
    },
    {
      path: './issue-detail',
      importer: root + '/packages/extension-scm/src/work/content.tsx',
      contents: 'export const IssueDetail=()=>null;',
    },
    {
      path: './work-task-links',
      importer: root + '/packages/extension-scm/src/work/pipeline-detail.tsx',
      contents: 'export const WorkTaskLinks=()=>null;',
    },
  ],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button').filter({ hasText: 'PR build' }).click()
  const job = page.getByRole('button').filter({ hasText: 'Build job' }).last()
  await job.click()
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Back to pipelines' }).count(), 0)
  await page.getByRole('button', { name: 'Back to runs', exact: true }).waitFor()
  assert.equal(await page.locator('.studio-page-header[data-embedded=true]').count(), 1)
  assert.equal(await page.locator('[data-window-edge]').count(), 0)

  await page.evaluate(() => {
    window.active = false
    window.mount()
  })
  const readsWhileHidden = await page.evaluate(() => window.reads.length)
  await page.clock.runFor(31000)
  assert.equal(
    await page.evaluate(() => window.reads.length),
    readsWhileHidden,
    'hidden Checks kept polling',
  )
  await page.evaluate(() => {
    window.active = true
    window.mount()
  })
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(
    await job.getAttribute('aria-expanded'),
    'true',
    'returning to Checks reset job expansion',
  )
  const listReads = await page.evaluate(
    () => window.reads.filter((read) => read.path.endsWith('/pipelines/list')).length,
  )
  await page.clock.runFor(10010)
  await page.waitForFunction(
    (before) =>
      window.reads.filter((read) => read.path.endsWith('/pipelines/list')).length > before,
    listReads,
  )
  assert.equal(await job.getAttribute('aria-expanded'), 'true', 'summary polling reset job context')
  await page.evaluate(() => {
    window.store.request = window.store.request.bind(null)
    window.mount()
  })
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(
    await job.getAttribute('aria-expanded'),
    'true',
    'request identity change reset the preview',
  )
  assert.deepEqual(errors, [])
  console.log(
    'PR pipeline preview: embedded header, retained run/job context, active-only reads, and summary refresh passed.',
  )
} finally {
  await browser.close()
}
