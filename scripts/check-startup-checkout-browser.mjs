import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const mocks = {
  '../../list/task-collection': `export const taskSources=store=>[{runtimeId:store.activeRuntimeId,name:'Selected machine',online:true,workspace:store.workspace,snapshot:null},...(store.otherSources??[]).filter(source=>source.runtimeId!==store.activeRuntimeId)];`,
  '@dovo/studio-core': `export const useStudioHost=()=>({navigate:()=>{}});export const WorkspaceScope=({children})=>children;export * from '@dovo/protocol';export {createTask,updateTask} from '../studio-core/src/workspace/actions';export {WorkspaceContext as Context,useWorkspace} from '../studio-core/src/workspace/context';export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export const ComposerWorkspaceBar=({children})=><div>{children}</div>;export {Button} from './src/components/ui/button';export {Input} from './src/components/ui/input';export {Dialog,DialogContent,DialogTitle} from './src/components/ui/dialog';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as Popover from '@radix-ui/react-popover';`,
  '../chat/composer/composer': `import {useWorkspace,updateTask} from '@dovo/studio-core';export const Composer=({task,workspaceControls})=>{const store=useWorkspace();return <><input aria-label="Message" value={task.draft} onChange={e=>store.setWorkspace(w=>updateTask(w,task.id,t=>({...t,draft:e.target.value})))}/>{workspaceControls}</>};`,
  '../list/task-collection': `export const taskSources=store=>[{runtimeId:'machine',name:'Selected machine',online:true,workspace:store.workspace}];`,
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Context} from '@dovo/studio-core';import {StartupDraft} from '../extension-tasks/src/task-creation/startup-draft';
window.requests=[];window.commits=[];window.fleetRefreshes=0;
function App(){const [runtimeId,setRuntimeId]=useState('machine');const [workspace,setWorkspace]=useState({tasks:[],repositories:[{id:'chat',kind:'scratch',name:'Temporary',path:'/scratch',branch:''},{id:'git',name:'Git project',path:'/git',branch:'main'},{id:'folder',kind:'folder',name:'Plain folder',path:'/folder',branch:''}]});window.saved=workspace.tasks;return <Context.Provider value={{workspace,setWorkspace,activeRuntimeId:runtimeId,runtimeRegistry:{profiles:[{id:'machine'},{id:'remote-machine'}]},otherSources:[{runtimeId:'remote-machine',name:'Remote machine',online:true,snapshot:null,workspace:{tasks:[],repositories:[{id:'remote-git',name:'Remote Git project',path:'/remote/git',branch:'main'}]}}],refreshRuntimes:async()=>{window.fleetRefreshes++;await new Promise(()=>{})},switchRuntime:async(id)=>{setRuntimeId(id);setWorkspace({tasks:[],repositories:[{id:'remote-chat',kind:'scratch',name:'Temporary',path:'/remote/scratch',branch:''},{id:'remote-git',name:'Remote Git project',path:'/remote/git',branch:'main'}]})},connected:true,flush:async()=>{},request:async(path,input)=>{window.requests.push({path,input});if(path==='/api/scm/branches')return {current:'main',revision:'one',originDefault:'refs/remotes/origin/main',branches:[{name:'main',ref:'refs/heads/main',remote:false,checkedOut:true},{name:'origin/main',ref:'refs/remotes/origin/main',remote:true,checkedOut:false},{name:'local-only',ref:'refs/heads/local-only',remote:false,checkedOut:false}]};if(path==='/api/scm/worktrees/choices')return {worktrees:[{path:'/git/existing',branch:'feature',dirty:true}]};throw Error('Unexpected request '+path)}}}><StartupDraft onProject={()=>{}} onCommit={task=>window.commits.push(task)}/></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: new URL('../packages/studio-ui/', import.meta.url).pathname,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: new URL('../packages/studio-ui/', import.meta.url).pathname,
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
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.equal(
    await page.getByRole('button', { name: 'Working directory', exact: true }).count(),
    0,
  )
  const chooseFolder = async (name) => {
    await page.getByRole('button', { name: 'Task project', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
  }
  await chooseFolder('Git project')
  await page.getByRole('button', { name: 'Working directory', exact: true }).waitFor()
  assert.match(
    await page.getByRole('button', { name: 'Working directory', exact: true }).innerText(),
    /Local checkout/,
  )
  await page.getByRole('button', { name: 'Working directory', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /New worktree/ }).click()
  assert.match(
    await page.getByRole('button', { name: 'Working directory', exact: true }).innerText(),
    /New worktree/,
  )
  const base = page.getByRole('button', { name: 'Checkout branch', exact: true })
  await page.getByRole('button', { name: 'origin/main', exact: true }).waitFor()
  assert.equal((await base.innerText()).trim(), 'From origin/main')
  const local = page.getByRole('button', { name: 'local-only', exact: true })
  assert.equal(await local.isEnabled(), true)
  await local.click()
  assert.equal((await base.innerText()).trim(), 'From local-only')
  await base.click()
  await page.getByRole('button', { name: 'main', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Checkout branch', exact: true })
      .innerText()
      .then((text) => text.trim()),
    'From main',
  )
  await page.getByRole('button', { name: 'Working directory', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /Local checkout/ }).click()
  assert.match(
    await page.getByRole('button', { name: 'Working directory', exact: true }).innerText(),
    /Local checkout/,
  )
  await page.getByRole('button', { name: 'Working directory', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /Existing worktree/ }).click()
  await page.getByRole('button', { name: /feature.*existing/s }).click()
  assert.match(
    await page.getByRole('button', { name: 'Working directory', exact: true }).innerText(),
    /Existing worktree/,
  )
  assert.deepEqual(await page.evaluate(() => [window.saved.length, window.commits.length]), [0, 0])
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello')
  assert.deepEqual(
    await page.evaluate(() => [
      window.saved[0].execution,
      window.saved[0].existingWorktreePath,
      window.commits.length,
    ]),
    ['worktree', '/git/existing', 1],
  )
  await chooseFolder('Plain folder')
  assert.equal(
    await page.getByRole('button', { name: 'Working directory', exact: true }).count(),
    0,
  )
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  await page.getByRole('button', { name: 'Remote Git project', exact: true }).click()
  await page.getByRole('button', { name: 'Working directory', exact: true }).waitFor()
  assert.deepEqual(
    await page.evaluate(() => [window.saved.length, window.commits.length, window.requests.length]),
    [0, 0, 0],
  )
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Remote draft')
  assert.equal(await page.evaluate(() => window.saved[0].repositoryId), 'remote-git')
  assert.equal(await page.evaluate(() => window.fleetRefreshes), 0)
  assert.deepEqual(errors, [])
  console.log('Startup checkout controls and temporary draft persistence passed')
} finally {
  await browser.close()
}
