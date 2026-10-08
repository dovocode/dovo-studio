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
      import {createTask} from '@dovo/studio-core';
      import {TaskBranchMenu} from '../extension-tasks/src/detail/task-branch-menu';
      import {TaskHeader} from '../extension-tasks/src/detail/task-header';
      const initial=createTask({title:'Task',objective:'',agentId:'',repositoryId:'repo',execution:'local'});
      window.reads=[];window.writes=[];window.opens=[];window.folderOpener=undefined;window.installed=['finder','vscode'];window.holdDetection=false;window.failDetection=false;
      function App(){
        const [revision,setRevision]=useState(0),[task,setTask]=useState(initial);
        window.switchRuntime=folderOpener=>{window.folderOpener=folderOpener;window.installed=[folderOpener,'vscode'].filter(Boolean);setRevision(value=>value+1)};
        window.rerender=()=>setRevision(value=>value+1);
        window.switchTask=()=>setTask({...initial,id:'second'});
        window.store={workspace:{repositories:[{id:'repo',name:'Project',path:'/repo',branch:'feature'}]},snapshot:{folderOpener:window.folderOpener,questions:[],approvals:[],terminals:[]},connected:true,runtimes:[],activeRuntimeId:'local',
          request:async(path,input)=>{
            if(path==='/api/scm/action-state')return new Promise(resolve=>window.reads.push({resolve,input,revision}));
            if(path==='/api/scm/open-targets'){if(window.failDetection)throw new Error('Detection unavailable');if(window.holdDetection)await new Promise(resolve=>window.releaseDetection=resolve);return {targets:window.installed}}
            if(path==='/api/scm/open-folder'){window.opens.push(input);return {ok:true}}
            window.writes.push(path);
            if(path==='/api/tasks/commit-message')return {message:'Commit'};
            if(path==='/api/tasks/commit')return {commit:'123456789'};
            return {ok:true};
          }};
        return <><TaskHeader task={task} onSidebar={()=>{}} surface="chat" onSurface={()=>{}} compact={false} sidebarVisible={true} hasDiff={false} toolsExpanded={false} onTools={()=>{}} bottomTerminalOpen={false} onBottomTerminal={()=>{}}/><div data-testid="branch"><TaskBranchMenu task={{...task,checkoutBranch:"feature"}} label="Branch actions"/></div></>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'git-header-environment',
      setup(builder) {
        const mocks = {
          '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
          '@dovo/studio-core': `export * from '@dovo/protocol';export {createTask} from '../studio-core/src/workspace/actions';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({});export const useRuntimeReleaseCheck=()=>({releases:[]});export const runtimeUpdate=()=>({available:false});`,
          '@dovo/studio-ui': `export {RepositoryOpenItems} from '../studio-ui/src/repository-open-items';export {Button} from '../studio-ui/src/components/ui/button';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const cn=(...values)=>values.filter(Boolean).join(' ');export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;export const ProjectIcon=()=>null;export const Dialog=({children})=><div>{children}</div>;export const DialogContent=Dialog,DialogTitle=Dialog,DialogDescription=Dialog;`,
          '@dovo/extension-scm/repository-actions': 'export const RepositoryActions=()=>null;',
          './task-actions': 'export const TaskActions=()=>null;',
          './task-branch-menu': 'export const TaskBranchMenu=()=>null;',
          './task-pull-status': 'export const TaskPullStatus=()=>null;',
          './task-project-actions': 'export const TaskProjectActions=()=>null;',
          '../dialogs/task-pull-link-dialog': 'export const TaskPullLinkDialog=()=>null;',
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
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: 'svg{width:16px;height:16px}.hidden{display:none}' })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const action = page.getByRole('button', { name: 'Commit & push', exact: true })
  await action.waitFor()
  assert.equal(await action.isDisabled(), true)
  const clean = {
    dirty: false,
    canPush: true,
    branch: 'feature',
    ahead: 0,
    behind: 0,
    tracking: true,
  }
  const finish = async (index, state) =>
    page.evaluate(({ index, state }) => window.reads[index].resolve(state), { index, state })
  await page.waitForFunction(() => window.reads.length === 1)
  await finish(0, { ...clean, dirty: true })
  await page.waitForFunction(
    () => !document.querySelector('button[title="Commit & push"]').disabled,
  )
  // A new request function must preserve the last status, even with a slow refresh.
  await page.evaluate(() => window.rerender())
  await page.waitForFunction(() => window.reads.length === 2)
  assert.equal(await action.isDisabled(), false)
  assert.equal(await page.getByRole('button', { name: 'Git actions', exact: true }).count(), 0)
  await finish(1, clean)
  await page.waitForFunction(
    () => document.querySelector('button[title="No changes to commit or push"]')?.disabled,
  )
  // Overlapping older reads must not overwrite a newer dirty status.
  await page.evaluate(() => window.rerender())
  await page.waitForFunction(() => window.reads.length === 3)
  await page.evaluate(() => window.rerender())
  await page.waitForFunction(() => window.reads.length === 4)
  await finish(3, { ...clean, dirty: true })
  await page.waitForFunction(
    () => !document.querySelector('button[title="Commit & push"]').disabled,
  )
  await finish(2, clean)
  assert.equal(await action.isDisabled(), false)
  // Keep the mutation busy until the resulting status is known.
  await action.click()
  const working = page.getByRole('button', { name: 'Working…', exact: true })
  await working.waitFor()
  await page.waitForFunction(() => window.reads.length === 5)
  assert.equal(await working.isDisabled(), true)
  await finish(4, { ...clean, ahead: 1 })
  const push = page.getByRole('button', { name: 'Push branch', exact: true })
  await push.waitFor()
  assert.equal(await push.isDisabled(), false)
  // A different thread cannot inherit the previous thread's action state.
  await page.evaluate(() => window.switchTask())
  await action.waitFor()
  assert.equal(await action.isDisabled(), true)
  await page.waitForFunction(() => window.reads.length === 6)
  await finish(5, clean)
  assert.equal(await action.isDisabled(), true)
  assert.deepEqual(await page.evaluate(() => window.writes), [
    '/api/tasks/commit-message',
    '/api/tasks/commit',
  ])
  // Both menus follow the remote runtime, even when this client runs on a Mac.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }),
  )
  const open = page.getByRole('button', { name: 'Open', exact: true })
  const branch = page.getByTestId('branch').getByRole('button').first()
  for (const folderOpener of ['explorer', 'finder', 'file-manager']) {
    await page.evaluate((folderOpener) => window.switchRuntime(folderOpener), folderOpener)
    const name =
      folderOpener === 'explorer'
        ? 'File Explorer'
        : folderOpener === 'file-manager'
          ? 'File manager'
          : 'Finder'
    for (const trigger of [open, branch]) {
      await trigger.click()
      await page.getByRole('menuitem', { name: 'Open in ' + name, exact: true }).click()
      await trigger.click()
      await page.getByRole('menuitem', { name: 'Open in VS Code', exact: true }).click()
    }
  }
  const opens = await page.evaluate(() => window.opens)
  assert.deepEqual(
    opens.map((input) => input.target),
    [
      'explorer',
      'vscode',
      'explorer',
      'vscode',
      'finder',
      'vscode',
      'finder',
      'vscode',
      'file-manager',
      'vscode',
      'file-manager',
      'vscode',
    ],
  )
  assert.ok(
    opens.every((input) => input.repositoryId === 'repo' && input.taskId === 'second'),
    'Open actions use the selected task checkout',
  )
  // No speculative choices while detection is pending, and only installed JetBrains IDEs.
  await page.evaluate(() => {
    window.installed = ['file-manager', 'zed', 'webstorm']
    window.holdDetection = true
  })
  await open.click()
  await page.getByRole('status').filter({ hasText: 'Checking installed applications' }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Open in Zed', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.holdDetection = false
    window.releaseDetection()
  })
  await page.getByRole('menuitem', { name: 'JetBrains', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Open in WebStorm', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Open in PyCharm', exact: true }).count(),
    0,
  )
  assert.equal(
    await page.getByRole('menuitem', { name: 'Open in VS Code', exact: true }).count(),
    0,
  )
  await page.getByRole('menuitem', { name: 'Open in WebStorm', exact: true }).click()
  await open.click()
  await page.getByRole('menuitem', { name: 'Open in Zed', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.opens.slice(-2).map((input) => input.target)), [
    'webstorm',
    'zed',
  ])
  // Reopening discovers uninstalls and retry never falls back to assumed applications.
  await page.evaluate(() => {
    window.installed = []
  })
  await open.click()
  await page.getByRole('status').filter({ hasText: 'No supported applications' }).waitFor()
  assert.equal(await page.getByRole('menuitem').count(), 0)
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.failDetection = true
  })
  await open.click()
  await page.getByRole('status').filter({ hasText: 'Detection unavailable' }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: /Open in/ }).count(), 0)
  await page.evaluate(() => {
    window.failDetection = false
    window.installed = ['zed']
  })
  await page.getByRole('menuitem', { name: 'Retry detection', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open in Zed', exact: true }).click()
  const addedEditors = [
    ['vscode-insiders', 'VS Code Insiders'],
    ['vscodium', 'VSCodium'],
    ['cursor', 'Cursor'],
    ['antigravity', 'Antigravity'],
    ['devin', 'Devin Desktop'],
    ['windsurf', 'Windsurf'],
  ]
  await page.evaluate((editors) => {
    window.installed = editors.map(([target]) => target)
  }, addedEditors)
  for (const [target, label] of addedEditors) {
    await open.click()
    await page.getByRole('menuitem', { name: 'Open in ' + label, exact: true }).click()
    assert.equal(await page.evaluate(() => window.opens.at(-1).target), target)
  }
  await page.evaluate(() => {
    window.installed = ['vscodium']
  })
  await open.click()
  await page.getByRole('menuitem', { name: 'Open in VSCodium', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Open in VS Code Insiders', exact: true }).count(),
    0,
  )
  assert.equal(await page.getByRole('menuitem', { name: 'JetBrains', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  console.log(
    'Git primary action stays consistent during loading, clean status and refreshes; ignores stale reads, waits for post-commit status and isolates threads; both Open menus detect installed tools on Windows/Mac/Linux, hide missing apps, group JetBrains and refresh/retry detection.',
  )
} finally {
  await browser.close()
}
