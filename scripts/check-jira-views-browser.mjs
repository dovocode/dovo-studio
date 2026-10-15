import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export * from '${root}/packages/client-runtime/src/index.ts';export const useWorkspace=()=>({});export const issueLabel=id=>id;export const formatDateTime=value=>value;`,
  '@dovo/studio-ui':
    ['button', 'input', 'dialog']
      .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
      .join('\n') +
    `export * from '${ui}/choice-picker.tsx';export * as Popover from '@radix-ui/react-popover';`,
}
const built = await build({
  stdin: {
    contents: `import React,{useState} from 'react';import {Effect} from 'effect';import {decode} from '@dovo/protocol';import {createRoot} from 'react-dom/client';import {JiraToolbar} from '${root}/packages/extension-scm/src/work/jira-toolbar.tsx';import {JiraIssueList} from '${root}/packages/extension-scm/src/work/jira-issue-list.tsx';window.metadataReads=[];const source={readCache:{readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void},input:{jiraSourceId:'team'},requestEffect:(path,input,schema)=>Effect.tryPromise({try:async()=>{window.metadataReads.push({path,input});if(path==='/api/scm/source/identity')return decode(schema,{readerIdentity:'account',destination:'dest'});if(window.failMetadata)throw Error('Metadata unavailable');return decode(schema,path.endsWith('/boards')?{boards:[{id:'104',name:'Delivery',type:'scrum'},{id:'105',name:'Support',type:'kanban'}],truncated:false}:{board:input.id,sprints:input.id==='104'?[{id:'176',name:input.state==='closed'?'Last sprint':'Sprint 2',state:input.state==='closed'?'closed':'active'}]:[],truncated:false})},catch:error=>error}),key:'team',scope:'team',name:'Team',runtimeName:'Mac',connected:true,jira:{id:'team',site:'https://team.atlassian.net',project:'TEAM'}};const issues=[{id:'TEAM-1',title:'Fix login',state:'In progress',priority:'High',type:'Bug',assignees:[],labels:['needs-review'],url:'https://team.atlassian.net/browse/TEAM-1'},{id:'TEAM-2',title:'Ship feature',state:'Released',priority:'Low',type:'Story',assignees:['a'],assigneeNames:['Dominic'],labels:[],url:'https://team.atlassian.net/browse/TEAM-2'}];function App(){const [state,setState]=useState('open'),[filters,setFilters]=useState({}),[view,setView]=useState('list'),[project,setProject]=useState('team'),[linked,setLinked]=useState('all'),[sort,setSort]=useState('updated'),[selected,setSelected]=useState(null);window.state={state,filters,view,project,linked,selected};return <><JiraToolbar state={state} onState={setState} filters={filters} onFilters={setFilters} view={view} onView={setView} issues={issues} sources={[source]} source={project} onSource={setProject} linked={linked} onLinked={setLinked} sort={sort} onSort={setSort} onClear={()=>{setFilters({});setState('open');setProject('');setLinked('all')}}/><JiraIssueList layout={view} rows={issues.map(item=>({source,item}))} selected={selected} opening={false} onOpen={async(source,id)=>setSelected({source,id})}/></>}createRoot(document.getElementById('app')).render(<App/>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { react: `${root}/packages/studio-ui/node_modules/react` },
  nodePaths: [`${root}/packages/studio-ui/node_modules`],
  plugins: [
    {
      name: 'context',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'My issues', exact: true }).click()
  assert.equal(await page.evaluate(() => window.state.filters.assignee), 'mine')
  await page.getByRole('button', { name: 'Remove Assigned to me filter', exact: true }).click()
  assert.equal(await page.evaluate(() => window.state.filters.assignee), undefined)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const choose = async (name, value) => {
    await page.getByRole('button', { name, exact: true }).click()
    await page.locator(`[role="option"][data-value="${value}"]`).click()
  }
  await choose('Saved Jira board', '104')
  await choose('Jira sprint', '176')
  assert.equal(await page.evaluate(() => window.state.filters.board), '104')
  assert.equal(await page.evaluate(() => window.state.filters.sprint), '176')
  await page.getByRole('button', { name: 'Show closed sprints', exact: true }).click()
  await choose('Jira sprint', '176')
  await choose('Saved Jira board', '105')
  assert.equal(await page.evaluate(() => window.state.filters.sprint), undefined)
  await choose('Saved Jira board', '')
  await choose('Jira sprint', 'active')
  assert.equal(await page.evaluate(() => window.state.filters.sprint), 'active')
  await choose('Jira sprint', '')
  await page.evaluate(() => (window.failMetadata = true))
  await page.getByRole('button', { name: 'Refresh board choices', exact: true }).click()
  await page.getByRole('button', { name: 'Retry boards', exact: true }).waitFor()
  await page.evaluate(() => (window.failMetadata = false))
  await page.getByRole('button', { name: 'Retry boards', exact: true }).click()
  await page.getByRole('button', { name: 'Retry boards', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(() =>
      window.metadataReads.some(
        (read) =>
          read.path.endsWith('/boards') &&
          read.input.refresh &&
          read.input.expectedDestination === 'dest',
      ),
    ),
    true,
  )
  await page.getByRole('button', { name: 'High', exact: true }).click()
  await page.getByRole('button', { name: 'In progress', exact: true }).last().click()
  assert.equal(await page.evaluate(() => window.state.state), 'In progress')
  await page.getByRole('textbox', { name: 'Find filter values' }).fill('needs-review')
  await page.getByRole('button', { name: 'needs-review', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.state.filters))), {
    priority: 'High',
    label: 'needs-review',
  })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Remove Priority: High filter', exact: true }).click()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await page.getByRole('region', { name: 'In progress column', exact: true }).waitFor()
  await page.getByRole('region', { name: 'Released column', exact: true }).waitFor()
  await page.getByRole('button', { name: /TEAM-1 · Fix login/ }).click()
  assert.equal(await page.evaluate(() => window.state.selected.id), 'TEAM-1')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('button', { name: /TEAM-1 · Fix login/ }).focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => window.state.selected.id), 'TEAM-2')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find filter values' }).fill('custom-label')
  await page
    .getByRole('region', { name: 'Label', exact: true })
    .getByRole('button', { name: 'Use “custom-label”', exact: true })
    .click()
  assert.equal(await page.evaluate(() => window.state.filters.label), 'custom-label')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.state.filters), {})
  assert.deepEqual(errors, [])
  console.log(
    'Jira desktop/narrow UI: quick views, removable filters, searchable/custom values, list/board switching, issue preview and keyboard navigation passed.',
  )
} finally {
  await browser.close()
}
