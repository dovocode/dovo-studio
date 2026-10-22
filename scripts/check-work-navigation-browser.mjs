import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export * from '@dovo/protocol';export const useStudioHost=()=>({navigate:()=>{}});export const useWorkspace=()=>({activeRuntimeId:'a',runtimes:[],request:async()=>({})});export const WorkspaceRuntimeScope=({runtimeId,children})=><section data-owner={runtimeId}>{children}</section>;export const repositorySourceKey=(a,b)=>JSON.stringify([a,b]);export const formatDateTime=v=>v;`,
  '@dovo/studio-ui': `import {useState} from 'react';export const PageHeader=({title,children})=><header><h1>{title}</h1>{children}</header>;export const SidebarHeader=()=>null;export const useLeftSidebar=()=>[true,()=>{}];export const useCompactLayout=()=>false;export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;`,
  './work-sources': `export {workRemoteKey,matchesWorkSource} from '${root}packages/extension-scm/src/work/work-source-identity';export const jiraSourceKey=(a,b)=>JSON.stringify([a,'jira',b]);export const useIssueSources=()=>window.sources;`,
  './use-work-sources': `export const useWorkSources=()=>({sources:window.sources,pages:[{source:window.sources[0],reader:window.reader,items:[window.issue],options:{provider:'github',issues:true,pipelineActions:[]}}],busy:false,refresh:()=>{},more:async()=>{}});`,
  './jira-toolbar': `export const JiraToolbar=()=>null;`,
  './jira-issue-list': `export const jiraIssueRowKey=(source,id)=>JSON.stringify([source.key,id]);export const JiraIssueList=()=>null;`,
  './pipeline-state': `export const PipelineState=()=>null;`,
  './content': `export const WorkContent=({initialSelected,repositoryName,onBack})=><div><h2>{repositoryName} · {initialSelected}</h2><button onClick={onBack}>Back to issues</button></div>;`,
  './work-form': `import {useState} from 'react';export const WorkForm=({onClose,repositoryId})=>{const[text,setText]=useState('');return <section role="dialog"><p>Creating on {repositoryId}</p><textarea aria-label="Issue draft" value={text} onChange={e=>setText(e.target.value)}/><button onClick={onClose}>Close form</button></section>};`,
  '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
  '../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {createRoot} from 'react-dom/client';import Issues from '${root}packages/extension-scm/src/work/work-view';
const profile=id=>({id,connection:{address:'http://'+id,token:id}});
window.sources=['a','b'].map(id=>({key:JSON.stringify([id,id+'-repo']),scope:id,name:'Project',runtimeId:id,runtimeName:id.toUpperCase(),profile:profile(id),connected:true,repository:{id:id+'-repo',path:'/repo',name:'Project',gitIdentity:'github.com/team/project'},input:{repositoryId:id+'-repo'}}));window.reader=window.sources[0];window.issue={id:'7',title:'Fix issue',state:'open',assignees:[],labels:[],author:'Author',url:'https://github.com/team/project/issues/7',updatedAt:''};
const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<Issues key={window.mount??0} entityId={window.target}/>);window.render();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'New issue', exact: true }).click()
  await page.getByRole('textbox', { name: 'Issue draft' }).fill('Keep offline issue draft')
  await page.evaluate(() => {
    window.sources[0].connected = false
    window.reader = window.sources[1]
    window.render()
  })
  assert.equal(
    await page.getByRole('textbox', { name: 'Issue draft' }).inputValue(),
    'Keep offline issue draft',
  )
  assert.equal(await page.getByRole('dialog').locator('[data-owner]').count(), 0)
  assert.equal(
    await page.locator('[data-owner="a"] [role="dialog"]').count(),
    1,
    'Create owner remains pinned through handoff',
  )
  await page.getByRole('button', { name: 'Close form', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Issue source', exact: true })
    .selectOption(JSON.stringify(['a', 'a-repo']))
  await page.evaluate(() => {
    window.target = JSON.stringify({
      runtimeId: 'a',
      repositoryId: 'a-repo',
      id: '7',
      url: window.issue.url,
    })
    window.render()
  })
  await page.getByRole('heading', { name: 'Project · A · 7', exact: true }).waitFor()
  assert.equal(
    await page.locator('[data-owner="a"] h2').count(),
    1,
    'Deep links resolve raw owners even when another reader is selected',
  )
  await page.getByRole('button', { name: 'Back to issues', exact: true }).click()
  await page.evaluate(() => {
    window.target = undefined
    window.mount = 1
    window.render()
  })
  assert.equal(
    await page.getByRole('combobox', { name: 'Issue source', exact: true }).inputValue(),
    JSON.stringify(['a', 'a-repo']),
    'Filter survives remount',
  )
  await page.getByRole('button', { name: /Fix issue/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Work navigation: owner-qualified deep links, retained source filters and pinned create draft during reader handoff passed.',
  )
} finally {
  await browser.close()
}
