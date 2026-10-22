import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `export * from '${root}packages/studio-core/src/index.ts';export const useWorkspace=()=>window.store;export const useWorkspaceSelector=select=>select(window.store);export const useStudioHost=()=>window.host;`,
  '@dovo/extension-scm/project-transfer': 'export const ProjectTransferDialog=()=>null;',
  '@dovo/extension-scm/projects': 'export const ProjectsMenu=()=>null;',
  './use-task-search': 'export const useTaskSearch=()=>({keys:new Set(),error:""});',
  '../detail/task-context-menu': 'export const TaskContextMenu=({children})=>children;',
  './task-row':
    'export const TaskRow=({task,onSelect})=><button onClick={onSelect}>{task.title}</button>;',
}
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {TaskList} from './src/list/task-list.tsx';import {ApplicationStateProvider} from '@dovo/studio-core/state';import {TooltipProvider} from '@dovo/studio-ui';import {readAppPreferences,updateAppPreferences} from '@dovo/studio-core';window.savedOrder=()=>readAppPreferences().threadSectionOrder;window.collapsedSections=()=>readAppPreferences().collapsedThreadSections;window.groupBy=taskGrouping=>updateAppPreferences({taskGrouping});const render=()=>root.render(<ApplicationStateProvider><TooltipProvider><TaskList projectId="" onProjectChange={()=>{}} selectedId="" temporaryEntry={window.temporary} onSelect={()=>{}} onCreate={()=>{}} onNewThread={()=>{}} onDeselect={()=>{}} onOrderChange={entries=>window.keyboardOrder=entries.map(entry=>entry.task.id)} sources={[window.source]} activeRuntimeId="runtime" busy={false} error=""/></TooltipProvider></ApplicationStateProvider>);const root=createRoot(document.getElementById('app'));window.render=render;window.remount=async()=>{root.render(null);await new Promise(resolve=>requestAnimationFrame(resolve));render()};render();`,
    loader: 'tsx',
    resolveDir: root + 'packages/extension-tasks/',
  },
  conditions: ['development'],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'section-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui/',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test')
  await page.evaluate(() => {
    localStorage.setItem(
      'dovo.app-preferences.v1',
      JSON.stringify({ taskGrouping: 'status', workingSection: true }),
    )
    const base = {
      repositoryId: 'repo',
      agentId: '',
      createdAt: new Date().toISOString(),
      draft: '',
      files: [],
      messages: [],
      turns: [],
      status: 'completed',
    }
    window.source = {
      runtimeId: 'runtime',
      name: 'Runtime',
      online: true,
      workspace: {
        tasks: [
          { ...base, id: 'active', title: 'Active thread' },
          { ...base, id: 'working', title: 'Working thread', status: 'running' },
          { ...base, id: 'waiting', title: 'Waiting thread', waitingForFeedback: true },
        ],
        repositories: [{ id: 'repo', name: 'Project', path: '/project' }],
        agents: [],
      },
    }
    window.host = {}
    window.store = {
      request: async () => {
        throw Error('Reordering must not send runtime mutations')
      },
      refreshRuntimes: async () => {},
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const headings = () => page.locator('summary').allTextContents()
  const names = async () => (await headings()).map((text) => text.replace(/\d+$/, '').trim())
  await page.getByText('Active thread', { exact: true }).waitFor()
  assert.deepEqual(await names(), ['Working', 'Waiting'])
  const savedCollapse = await page.evaluate(() => window.collapsedSections())
  await page.evaluate(() => {
    window.temporary = {
      key: JSON.stringify(['runtime', 'working']),
      task: window.source.workspace.tasks.find((task) => task.id === 'working'),
      source: window.source,
      needsInput: false,
      projectKey: JSON.stringify(['runtime', 'repo']),
      projectName: 'Project',
    }
    window.render()
  })
  await page.getByText('Working thread', { exact: true }).waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.collapsedSections()),
    savedCollapse,
    'Automatic reveal must not persist section state',
  )
  await page.evaluate(() => {
    window.temporary = undefined
    window.render()
  })
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('details')].find((element) =>
        element.querySelector('summary').textContent.includes('Working'),
      ).open,
  )
  assert.deepEqual(await page.evaluate(() => window.collapsedSections()), savedCollapse)
  // Keyboard activation is a user toggle and must persist, just like a pointer click.
  const workingSummary = page.locator('summary').filter({ hasText: 'Working' })
  await workingSummary.focus()
  await page.keyboard.press('Enter')
  await page.getByText('Working thread', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.collapsedSections().includes('working')), false)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.collapsedSections().includes('working'))
  await page.getByRole('button', { name: 'Organize sections', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Move waiting up', exact: true }).click()
  await dialog.getByRole('button', { name: 'Move waiting up', exact: true }).click()
  assert.deepEqual(await names(), ['Waiting', 'Open', 'Working'])
  assert.equal(
    await page
      .locator('details')
      .filter({ has: page.getByText('Waiting', { exact: true }) })
      .getAttribute('open'),
    null,
    'Reordering must preserve collapsed state',
  )
  await page.keyboard.press('Escape')
  await page.locator('summary').filter({ hasText: 'Waiting' }).click()
  await page.getByText('Waiting thread', { exact: true }).waitFor()
  await page.waitForFunction(() => window.keyboardOrder[0] === 'waiting')
  const savedTasks = await page.evaluate(() => window.source.workspace.tasks)
  await page.evaluate(async () => {
    window.source.workspace.tasks = []
    await window.remount()
  })
  await page.waitForFunction(() => !document.querySelector('summary'))
  await page.reload()
  // Preferences survive a cold page reload; reconstruct only the UI fixture.
  await page.evaluate(() => {
    window.source = {
      runtimeId: 'runtime',
      name: 'Runtime',
      online: true,
      workspace: { tasks: [], repositories: [], agents: [] },
    }
    window.host = {}
    window.store = {}
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.deepEqual(await page.evaluate(() => window.savedOrder()), [
    'pinned',
    'waiting',
    'active',
    'working',
    'snoozed',
    'settled',
  ])
  await page.evaluate(async (tasks) => {
    window.source.workspace.tasks = tasks
    window.source.workspace.repositories = [{ id: 'repo', name: 'Project', path: '/project' }]
    await window.remount()
  }, savedTasks)
  await page.getByText('Waiting thread', { exact: true }).waitFor()
  assert.equal(
    await page
      .locator('details')
      .filter({ has: page.getByText('Waiting', { exact: true }) })
      .evaluate((element) => element.open),
    true,
    'Empty sections retain their expanded state across cold starts',
  )
  assert.equal(
    await page
      .locator('details')
      .filter({ has: page.getByText('Working', { exact: true }) })
      .evaluate((element) => element.open),
    false,
    'Collapsed sections retain their state across cold starts',
  )
  await page.getByRole('button', { name: 'Organize sections', exact: true }).click()
  await dialog.getByRole('button', { name: 'Move pinned up', exact: true }).waitFor()
  assert.equal(
    await dialog.getByRole('button', { name: 'Move pinned up', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await dialog.getByRole('button', { name: 'Move settled down', exact: true }).isDisabled(),
    true,
  )
  await dialog.getByRole('button', { name: 'Reset section order', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.savedOrder()), [
    'pinned',
    'active',
    'working',
    'waiting',
    'snoozed',
    'settled',
  ])
  assert.deepEqual(errors, [])
  console.log(
    'Thread categories: overview organizer, live reordering, collapse state, keyboard task order, cold-start persistence, hidden/empty sections, boundaries and reset verified.',
  )
} finally {
  await browser.close()
}
