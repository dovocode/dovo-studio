import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export const useWorkspace=()=>({activeRuntimeId:window.currentRuntime,connected:true,switchRuntime:async id=>{if(window.delaySwitch)await new Promise(resolve=>window.releaseSwitch=resolve);window.currentRuntime=id},request:async()=>({})});export const decodeWorkTarget=()=>undefined;export const repositorySourceKey=(a,b)=>a+b;export const issueLabel=id=>id;export const forgeLabels={};export const matchesWorkItem=(item,query)=>JSON.stringify(item).toLowerCase().includes(query.toLowerCase());export const formatDateTime=value=>value;`,
  '@dovo/studio-ui':
    ['button', 'input', 'dialog']
      .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
      .join('\n') +
    `export * from '${ui}/choice-picker.tsx';export * from '${ui}/page-header.tsx';export * as Popover from '@radix-ui/react-popover';import {useState,useEffect} from 'react';export const useCompactLayout=()=>{const [compact,setCompact]=useState(innerWidth<1024);useEffect(()=>{const update=()=>setCompact(innerWidth<1024);addEventListener('resize',update);return()=>removeEventListener('resize',update)},[]);return compact};`,
  './use-work-sources': `export const useWorkSources=(mode,query,kind,key,state,filters)=>{window.lastQuery={state,filters};const source=window.source;const items=window.issues.filter(item=>(state==='all'||state==='open'&&item.state!=='Released'||state==='closed'&&item.state==='Released'||item.state===state)&&(!filters?.priority||item.priority===filters.priority)&&(!filters?.label||item.labels.includes(filters.label))&&(!filters?.assignee||filters.assignee==='all'||filters.assignee==='unassigned'&&!item.assignees.length||filters.assignee==='mine'&&item.assignees.includes('me')));return {sources:[source],pages:[{source,items,options:{issues:true},next:'30'}],busy:false,refresh:()=>{},more:async()=>{window.moreCount++}}};`,
  './work-sources': `export const jiraSourceKey=(a,b)=>a+b;`,
  '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
  './pipeline-detail': `export const PipelineState=()=>null;`,
  './content': `export const WorkContent=({initialSelected,onBack})=><div><h2>Preview {initialSelected}</h2><button onClick={onBack}>Close preview</button></div>;`,
  './work-form': `export const WorkForm=()=>null;`,
  '../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {JiraView} from '${root}/packages/extension-scm/src/work/work-view.tsx';window.currentRuntime='remote';window.delaySwitch=false;window.moreCount=0;window.source={key:'remote-team',scope:'remote-team',name:'Team',runtimeId:'remote',runtimeName:'Mac',connected:true,jira:{id:'team',project:'TEAM'},input:{jiraSourceId:'team'}};window.issues=[{id:'TEAM-1',title:'Fix login',state:'In progress',priority:'High',type:'Bug',assignees:[],labels:['all'],url:'https://team.atlassian.net/browse/TEAM-1',updatedAt:''},{id:'TEAM-2',title:'Ship feature',state:'Released',priority:'Low',type:'Story',assignees:['me'],labels:[],url:'https://team.atlassian.net/browse/TEAM-2',updatedAt:''}];createRoot(document.getElementById('app')).render(<JiraView/>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: `${root}/packages/studio-ui/node_modules/react`,
    '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
  },
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
const assets = `${root}/apps/web/dist/client/assets`
const css = await readFile(
  `${assets}/${(await readdir(assets)).find((name) => /^index-.*\.css$/.test(name))}`,
  'utf8',
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent(
    '<style>body{margin:0}#app{height:100vh;display:flex;overflow:hidden}</style><div id="app"></div>',
  )
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  assert.equal(await page.getByRole('complementary', { name: 'Jira issue preview' }).count(), 0)
  await page.getByRole('button', { name: /TEAM-1 · Fix login/ }).click()
  await page.getByRole('heading', { name: 'Preview TEAM-1' }).waitFor()
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  assert.equal(await page.getByRole('complementary', { name: 'Jira issue preview' }).count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('button', { name: /TEAM-1 · Fix login/ }).click()
  await page.getByRole('heading', { name: 'Preview TEAM-1' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).isVisible(), false)
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.getByRole('button', { name: 'Filters', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-work-item')),
    JSON.stringify(['remote-team', 'TEAM-1']),
  )
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Jira filters', exact: true })
  const box = await panel.boundingBox()
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391)
  await page
    .getByRole('region', { name: 'Label', exact: true })
    .getByRole('button', { name: 'all', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.currentRuntime = 'local'
    window.delaySwitch = true
  })
  await page.getByRole('button', { name: 'Remove Label: all filter', exact: true }).click()
  await page.getByRole('button', { name: /TEAM-1 · Fix login/ }).click()
  await page.getByRole('button', { name: 'My issues', exact: true }).click()
  await page.evaluate(() => window.releaseSwitch())
  await page.getByText('No matching issues', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Preview TEAM-1' }).count(), 0)
  await page.getByRole('button', { name: 'Load more · Team · Mac', exact: true }).click()
  assert.equal(await page.evaluate(() => window.moreCount), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log(
    'Styled Jira workspace: board width, narrow preview/focus restoration, filter panel bounds, literal-all chip, stale runtime open cancellation and filtered pagination controls passed.',
  )
} finally {
  await browser.close()
}
