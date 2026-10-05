import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const mocks = {
  '@dovo/studio-ui': `export {Button} from './src/components/ui/button'; export {Input} from './src/components/ui/input'; export {Dialog,DialogContent,DialogDescription,DialogTitle} from './src/components/ui/dialog'; export * as Popover from '@radix-ui/react-popover';`,
  '@dovo/studio-core': `import {createContext,useContext} from 'react'; export const useAppPreferences=()=>({projectGrouping:'name',projectOrder:'name'}); export const projectActivity=()=>0; export const Context=createContext(null); export const useWorkspace=()=>useContext(Context); export const canChangeTaskCheckout=t=>t.status==='draft'; export const resolveTaskDefaults=()=>({execution:'main'}); export const updateTask=(w,id,fn)=>({...w,tasks:w.tasks.map(t=>t.id===id?fn(t):t)});`,
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=({initialSource,onClose})=><div role="dialog" aria-label="Add repository"><span>{initialSource}</span><button onClick={onClose}>Close</button></div>;`,
}
const built = await build({
  stdin: {
    contents: `
import {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {Context} from '@dovo/studio-core'; import {ComposerProject} from '../extension-tasks/src/chat/composer/composer-project'; import {ProjectSelectionDialog} from '../extension-tasks/src/task-creation/project-selection-dialog';
function MachineTest(){const [open,setOpen]=useState(false);window.showMachines=()=>setOpen(true);return <ProjectSelectionDialog open={open} onOpenChange={setOpen} noProject={false} busy={false} error="" projectQuery="" onProjectQueryChange={()=>{}} suggestedProject="" onSelect={key=>{window.selection=key}} sources={[{runtimeId:'a',name:'Selected machine',online:true,workspace:{tasks:[],repositories:[{id:'a-folder',name:'Local folder',path:'/local'}]}},{runtimeId:'b',name:'Other machine',online:true,workspace:{tasks:[],repositories:[{id:'b-folder',name:'Remote folder',path:'/remote'}]}}]}/>};
function App(){const [workspace,setWorkspace]=useState({repositories:[{id:'chat',kind:'scratch',name:'Temporary',path:'/scratch'},{id:'one',name:'First folder',path:'/one'},{id:'two',name:'Second folder',path:'/two'},{id:'bad',name:'Broken folder',path:'/bad',gitIdentityError:'Invalid identity'}],tasks:[{id:'task',status:'draft',repositoryId:'one',agentId:'old',existingWorktreePath:'/old',worktreeBaseBranch:'old'}]});window.task=workspace.tasks[0];return <Context.Provider value={{workspace,setWorkspace,activeRuntimeId:'a'}}><ComposerProject task={workspace.tasks[0]} disabled={false}/><button onClick={()=>window.showMachines()}>Machines</button><MachineTest/></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
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
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search folders' }).fill('second')
  assert.equal(await page.getByRole('button', { name: 'First folder', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Second folder', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => [
      window.task.repositoryId,
      window.task.agentId,
      window.task.existingWorktreePath,
      window.task.worktreeBaseBranch,
    ]),
    ['two', '', undefined, undefined],
  )
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Search folders' }).inputValue(), '')
  assert.equal(
    await page.getByRole('button', { name: 'Broken folder', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  assert.equal(await page.evaluate(() => window.task.repositoryId), 'chat')
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  await page.getByRole('button', { name: 'Add GitHub repository', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add repository' }).waitFor()
  assert.equal(await page.getByRole('dialog').innerText(), 'githubClose')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Machines', exact: true }).click()
  assert.equal(await page.getByLabel('New thread machine').inputValue(), 'a')
  assert.equal(await page.getByRole('button', { name: /Local folder/ }).count(), 1)
  assert.equal(await page.getByRole('button', { name: /Remote folder/ }).count(), 0)
  await page.getByLabel('New thread machine').selectOption('b')
  assert.equal(await page.getByRole('button', { name: /Local folder/ }).count(), 0)
  await page.getByRole('button', { name: /Remote folder/ }).click()
  assert.equal(await page.evaluate(() => window.selection), JSON.stringify(['b', 'b-folder']))
  assert.deepEqual(errors, [])
  console.log('Thread folder browser checks passed')
} finally {
  await browser.close()
}
