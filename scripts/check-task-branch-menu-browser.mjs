import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/studio-ui',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {TaskBranchMenu} from '../extension-tasks/src/detail/task-branch-menu';
const root=createRoot(document.getElementById('app'));
window.calls=[];window.opened=[];window.copied=[];window.connected=true;
window.task={id:'thread',repositoryId:'repo',status:'done',execution:'main',messages:[{role:'user',content:'Fix it'}]};
window.store={workspace:{repositories:[{id:'repo',path:'/project',branch:'main'}]},snapshot:{runtimeId:'runtime'},connected:true,request:async(path,input)=>{window.calls.push({path,input});return {path:'/task-checkout',runtimeId:'runtime',kind:'folder'}}};
window.host={repositoryOpener:{list:async()=>({targets:['zed'],localRuntimeId:'runtime'}),open:async input=>window.opened.push(input)}};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}});
let revision=0;
window.configure=(task={},verifiedBranch=undefined,connected=true)=>{
  window.store.connected=connected;
  window.task={id:'thread',repositoryId:'repo',status:'done',execution:'main',messages:[{role:'user',content:'Fix it'}],...task};
  root.render(<TaskBranchMenu key={++revision} task={window.task} label="main" verifiedBranch={verifiedBranch}/>);
};
window.configure();
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useWorkspaceSelector=select=>select(window.store);export const useStudioHost=()=>window.host;`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {Button} from './src/components/ui/button';export * from './src/components/ui/dialog';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {RepositoryOpenItems} from './src/repository-open-items';`,
    },
  ],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const show = async (label) => {
    const trigger = page.getByRole('button', { name: label, exact: true })
    assert.equal(await trigger.getAttribute('title'), `${label} · Branch actions`)
    await trigger.click()
    await page.getByRole('menu').waitFor()
  }
  const copy = page.getByRole('menuitem', { name: 'Copy branch name', exact: true })
  const open = page.getByRole('menuitem', { name: 'Open in Zed', exact: true })
  const configure = async (task, verifiedBranch, connected = true) => {
    await page.keyboard.press('Escape')
    await page.evaluate(
      ({ task, verifiedBranch, connected }) => window.configure(task, verifiedBranch, connected),
      { task, verifiedBranch, connected },
    )
  }

  // Local checkouts exist before a branch is recorded on the thread.
  await show('main')
  assert.equal(await copy.isEnabled(), true)
  await copy.click()
  assert.deepEqual(await page.evaluate(() => window.copied), ['main'])

  // Current task-scoped Git information overrides a historical checkout branch.
  await configure({ execution: 'worktree', checkoutBranch: 'old-branch' }, 'current-branch')
  await show('current-branch')
  await copy.click()
  assert.deepEqual(await page.evaluate(() => window.copied), ['main', 'current-branch'])

  for (const status of ['draft', 'done']) {
    await configure({ execution: 'worktree', status })
    await show('Worktree pending')
    assert.equal(await copy.isDisabled(), true)
    assert.equal(await open.isDisabled(), true)
    await page.getByText('The worktree is not available yet.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Available after the first message.').count(), 0)
  }
  assert.deepEqual(await page.evaluate(() => window.calls), [])

  // A selected existing worktree can open without borrowing the project's branch name.
  await configure({ execution: 'worktree', existingWorktreePath: '/existing-worktree' })
  await show('Worktree')
  assert.equal(await copy.isDisabled(), true)
  assert.equal(await open.isEnabled(), true)
  await open.click()
  await page.waitForFunction(() => window.opened.length === 1)
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { path: '/api/scm/open-location', input: { repositoryId: 'repo', taskId: 'thread' } },
  ])
  assert.deepEqual(await page.evaluate(() => window.opened[0]), {
    path: '/task-checkout',
    runtimeId: 'runtime',
    kind: 'folder',
    target: 'zed',
  })

  await configure({ execution: 'worktree', checkoutBranch: 'thread-branch' })
  await show('thread-branch')
  assert.equal(await copy.isEnabled(), true)
  assert.equal(await open.isEnabled(), true)

  await configure({ execution: 'worktree', checkoutBranch: 'old-branch' }, null)
  await show('Detached HEAD')
  assert.equal(await copy.isDisabled(), true)
  assert.equal(await open.isEnabled(), true)
  await page
    .getByText('This checkout has no branch name (detached HEAD).', { exact: true })
    .waitFor()

  await configure({}, undefined, false)
  await show('main')
  assert.equal(await copy.isEnabled(), true)
  await page.getByText('Connect to the runtime to open applications.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Branch menu: checkout scope, copy/open availability, pending worktrees and detached HEAD passed.',
  )
} finally {
  await browser.close()
}
