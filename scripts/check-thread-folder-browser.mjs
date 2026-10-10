import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const mocks = {
  '../../list/task-collection': `export const taskSources=store=>[{runtimeId:store.activeRuntimeId,name:'Selected machine',workspace:store.workspace,snapshot:null,online:true},...(store.otherSources??[])];`,
  '@dovo/studio-ui': `export {Button} from './src/components/ui/button'; export {Input} from './src/components/ui/input'; export {Dialog,DialogContent,DialogDescription,DialogTitle} from './src/components/ui/dialog'; export * as Popover from '@radix-ui/react-popover';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
  '@dovo/studio-core': `import {createContext,useContext} from 'react'; export const useAppPreferences=()=>({projectGrouping:'name',projectOrder:'name'}); export const projectActivity=()=>0;export const useStudioHost=()=>({navigate:value=>window.navigation=value});export const WorkspaceScope=({profile,children})=>{window.addScope=profile.id;return children}; export const Context=createContext(null); export const useWorkspace=()=>useContext(Context); export const canChangeTaskCheckout=t=>t.status==='draft'; export const resolveTaskDefaults=()=>({execution:'main'}); export const updateTask=(w,id,fn)=>({...w,tasks:w.tasks.map(t=>t.id===id?fn(t):t)});`,
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=({initialSource,onClose,onAdded})=><div role="dialog" aria-label="Add repository"><span>{String(initialSource)}</span><button onClick={()=>{onAdded?.({id:'added',name:'Added folder',path:'/added',kind:'folder'});onClose()}}>Add folder</button><button onClick={onClose}>Close</button></div>;`,
}
const built = await build({
  stdin: {
    contents: `
import {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {Context} from '@dovo/studio-core'; import {ComposerProject} from '../extension-tasks/src/chat/composer/composer-project'; import {ProjectSelectionDialog} from '../extension-tasks/src/task-creation/project-selection-dialog';
function MachineTest(){const [open,setOpen]=useState(false);window.showMachines=()=>setOpen(true);return <ProjectSelectionDialog open={open} onOpenChange={setOpen} noProject={false} busy={false} error="" projectQuery="" onProjectQueryChange={()=>{}} suggestedProject="" onSelect={key=>{window.selection=key}} sources={[{runtimeId:'a',name:'Selected machine',online:true,workspace:{tasks:[],repositories:[{id:'a-folder',name:'Local folder',path:'/local'}]}},{runtimeId:'b',name:'Other machine',online:true,workspace:{tasks:[],repositories:[{id:'b-folder',name:'Remote folder',path:'/remote'}]}}]}/>};
function App(){const [workspace,setWorkspace]=useState({repositories:[{id:'chat',kind:'scratch',name:'Temporary',path:'/scratch'},{id:'one',name:'First folder',path:'/one',gitIdentity:'github.com/test/one'},{id:'two',name:'Second folder',path:'/two'},{id:'bad',name:'Broken folder',path:'/bad',gitIdentityError:'Invalid identity'}],tasks:[{id:'task',title:'Draft',createdAt:'2026-10-05T00:00:00Z',draft:'Keep draft',messages:[],files:[],status:'draft',repositoryId:'one',agentId:'old',existingWorktreePath:'/old',worktreeBaseBranch:'old'}]});window.task=workspace.tasks[0];return <Context.Provider value={{workspace,setWorkspace,activeRuntimeId:'a',runtimeRegistry:{profiles:[{id:'a'},{id:'b'}]},otherSources:[{runtimeId:'b',name:'Other machine',online:true,snapshot:null,workspace:{tasks:[],repositories:[{id:'remote',name:'Remote folder',kind:'folder',path:'/remote'},{id:'remote-chat',name:'Temporary',kind:'scratch',path:'/scratch'}]}}],flush:async()=>{},readRuntime:async(profile,path,input)=>{window.requests.push({runtimeId:profile.id,path,input});return input.task??{ok:true}},refreshRuntimes:async()=>{},refreshRuntime:async()=>{},switchRuntime:async id=>{window.switched=id}}}><ComposerProject task={workspace.tasks[0]} disabled={false}/><button onClick={()=>window.showMachines()}>Machines</button><MachineTest/></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
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
  await page.getByRole('textbox', { name: 'Search projects' }).fill('second')
  assert.equal(await page.getByRole('button', { name: 'First folder', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Second folder', exact: true }).focus()
  await page.keyboard.press('Enter')
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
  assert.equal(await page.getByRole('textbox', { name: 'Search projects' }).inputValue(), '')
  assert.equal(
    await page.getByRole('button', { name: 'Broken folder', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'No project', exact: true }).click()
  assert.equal(await page.evaluate(() => window.task.repositoryId), 'chat')
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  await page.getByRole('button', { name: 'Add project on Selected machine', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add repository' }).waitFor()
  assert.equal(await page.getByRole('dialog').innerText(), 'undefinedAdd folderClose')
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
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.requests = []
  })
  await page.getByRole('button', { name: 'Task project', exact: true }).click()
  await page.getByRole('button', { name: 'Remote folder', exact: true }).click()
  await page.waitForFunction(() => window.switched === 'b')
  assert.deepEqual(
    await page.evaluate(() =>
      window.requests.map(({ runtimeId, path, input }) => [
        runtimeId,
        path,
        input.gitIdentity,
        input.projectKind,
      ]),
    ),
    [
      ['b', '/api/tasks/draft-receive', '', 'folder'],
      ['a', '/api/tasks/draft-moved', '', 'scratch'],
    ],
  )
  assert.equal(await page.evaluate(() => window.requests[0].input.task.repositoryId), 'remote')
  assert.equal(await page.evaluate(() => window.requests[0].input.task.draft), 'Keep draft')
  assert.deepEqual(errors, [])
  console.log('Thread folder browser checks passed')
} finally {
  await browser.close()
}
