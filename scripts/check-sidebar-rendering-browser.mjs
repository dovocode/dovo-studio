import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { chromium } from './browser/harness.mjs'

// Real sidebar, rows, context menus, studio-ui and workspace value provider. Only the host,
// the projects menu and two leaves that count renders are replaced.
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `export * from '${root}packages/studio-core/src/index.ts';export const useStudioHost=()=>window.host;`,
  '@dovo/extension-scm/projects':
    'export const ProjectsMenu=()=>null;export const ProjectSettings=()=>null;',
  './section-order-dialog':
    'export const SectionOrderDialog=()=>{window.counts.list++;return null};',
  '@dovo/studio-ui/runtime-icon':
    'export const RuntimeIcon=()=>{window.counts.rows++;return <i data-row-icon=""/>};',
}
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {memo,useState} from 'react';
import {TaskList} from './src/list/task-list.tsx';
import {ApplicationStateProvider} from '@dovo/studio-core/state';
import {TooltipProvider} from '@dovo/studio-ui';
import {WorkspaceValueProvider,useWorkspace,useWorkspaceSelector} from '@dovo/studio-core';
window.counts={list:0,rows:0,broad:0,selected:0,pills:0};
const now=Date.now();
const iso=offset=>new Date(now-offset).toISOString();
const base={repositoryId:'repo',agentId:'',draft:'',files:[],example:false};
const finished=(id,title,age,extra={})=>({...base,id,title,createdAt:iso(age+60000),status:'done',
  messages:[{id:'m-'+id,role:'user',text:'Request '+id}],
  turns:[{id:'turn-'+id,status:'completed',startedAt:iso(age+30000),finishedAt:iso(age)}],...extra});
const running={...base,id:'running',title:'Running thread',createdAt:iso(0),status:'running',
  messages:[{id:'m-running',role:'user',text:'Stream'}],turns:[{id:'turn-running',status:'running',startedAt:iso(0)}]};
const subagent={id:'child',taskId:'child',source:'dovo',name:'Child agent',provider:'codex',status:'working',startedAt:iso(0),updatedAt:iso(0)};
const parent=finished('parent','Parent thread',1000,{subagents:[subagent]});
const child=finished('child','Child thread',1000,{delegation:{parentTaskId:'parent',parentRunId:'run',key:'child'}});
window.initialTasks=[running,parent,child,
  ...Array.from({length:300},(_,i)=>finished('task-'+i,'Thread '+i,(i+2)*60000)),
  ...Array.from({length:120},(_,i)=>finished('settled-'+i,'Settled thread '+i,(i+400)*60000,{archived:true}))];
// Snapshot retention keeps unchanged collections identical; the fixture does the same.
const repositories=[{id:'repo',name:'Project',path:'/project',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:'stale-branch'}],agents=[],automations=[];
const baseSnapshot={revision:1,questions:[],approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],acpInstallations:[]};
const fail=async()=>{throw new Error('The sidebar check does not send runtime requests')};
const actions={request:fail,readRuntime:fail,refreshRuntime:async()=>{},refreshRuntimes:async()=>{},previewTask:fail,setWorkspace:()=>{},activeRuntimeId:'local',connection:{address:'http://local',token:'token'},runtimeRegistry:{version:1,activeId:'local',profiles:[]}};
const BroadProbe=memo(function BroadProbe(){useWorkspace();window.counts.broad++;return null});
const selectRequest=value=>value.request;
const SelectedProbe=memo(function SelectedProbe(){useWorkspaceSelector(selectRequest);window.counts.selected++;return null});
function App(){
  const [tasks,setTasks]=useState(window.initialTasks);
  const [mounted,setMounted]=useState(true);
  const [selectedId,setSelectedId]=useState('');
  const [revision,setRevision]=useState(1);
  window.publish=next=>flushSync(()=>{setTasks(next);setRevision(value=>value+1)});
  window.setMounted=value=>flushSync(()=>setMounted(value));
  window.tasks=tasks;
  const workspace={version:1,runtimeAddress:'',repositories,agents,automations,tasks};
  const snapshot={...baseSnapshot,revision,workspace};
  const source={runtimeId:'local',address:'http://local',name:'Local',workspace,snapshot,online:true};
  return <WorkspaceValueProvider value={{...actions,workspace,snapshot,connected:true,runtimes:[]}}>
    <BroadProbe/><SelectedProbe/>
    <div style={{height:'600px',display:'flex'}}>
      {mounted&&<TaskList projectId="" onProjectChange={()=>{}} selectedId={selectedId} onSelect={entry=>{window.selected=entry;setSelectedId(entry.key)}}
        onCreate={()=>{}} onNewThread={()=>{}} onDeselect={()=>{}} onOrderChange={entries=>{window.order=entries.map(entry=>entry.task.id)}}
        sources={[source]} activeRuntimeId="local" busy={false} error=""/>}
    </div>
  </WorkspaceValueProvider>;
}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><TooltipProvider><App/></TooltipProvider></ApplicationStateProvider>);
`,
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
      name: 'sidebar-rendering-fixtures',
      setup(builder) {
        builder.onLoad({ filter: /\/working-subagents\.tsx$/ }, ({ path }) => ({
          contents: readFileSync(path, 'utf8').replace(
            'if (!subagents.length) return null',
            'window.counts.pills++; if (!subagents.length) return null',
          ),
          loader: 'tsx',
        }))
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
// Tailwind is compiled by the apps; the layout classes the sidebar scrolls with are enough here.
const layout = `.flex{display:flex}.flex-col{flex-direction:column}.h-full{height:100%}.w-full{width:100%}
.min-h-0{min-height:0}.flex-1{flex:1 1 0%}.overflow-y-auto{overflow-y:auto}.min-h-\\[72px\\]{min-height:72px}
.mb-1{margin-bottom:4px}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 700 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<style>${layout}</style><div id="app"></div>`,
    }),
  )
  await page.goto('https://dovo.test')
  await page.evaluate(() => {
    localStorage.setItem(
      'dovo.app-preferences.v1',
      JSON.stringify({ taskGrouping: 'status', taskSort: 'newest', workingSection: false }),
    )
    window.host = {}
    const Observer = window.IntersectionObserver
    window.IntersectionObserver = class extends Observer {
      constructor(callback, options) {
        super((entries, observer) => {
          if (!window.freezeWindows) callback(entries, observer)
        }, options)
      }
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Running thread', { exact: true }).waitFor()
  const scroller = page.locator('[aria-label="Task sidebar"] [aria-busy]')
  const mountedRows = () => page.locator('[data-row-icon]').count()

  // A large open section mounts rows near the viewport; collapsed sections build no rows.
  const initial = await mountedRows()
  assert.ok(initial > 0 && initial <= 40, `${initial} rows mounted for 302 open threads`)
  assert.equal(await page.getByText('Settled thread 0', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.order.length), 302)

  // Streaming one thread re-renders that row, not every row or selector-only consumers.
  await page.evaluate(() => {
    window.counts.rows = 0
    window.counts.broad = 0
    window.counts.selected = 0
    for (let frame = 0; frame < 30; frame++) {
      const [running, ...rest] = window.tasks
      window.publish([
        {
          ...running,
          messages: [
            ...running.messages,
            { id: 'stream-' + frame, role: 'assistant', text: 'chunk ' + frame },
          ],
        },
        ...rest,
      ])
    }
  })
  const streaming = await page.evaluate(() => ({ ...window.counts }))
  assert.ok(streaming.broad >= 30, `broad consumer rendered ${streaming.broad} times`)
  assert.equal(streaming.selected, 0, 'an action selector re-rendered for streamed content')
  assert.ok(
    streaming.rows <= 35,
    `${streaming.rows} row renders for 30 frames of one thread (${initial} rows mounted)`,
  )

  // Large child payloads do not repaint the parent's pills. Visible activity still updates.
  await page.evaluate(() => {
    window.counts.pills = 0
    for (let frame = 0; frame < 30; frame++) {
      window.publish(
        window.tasks.map((task) =>
          task.id === 'parent'
            ? {
                ...task,
                subagents: task.subagents.map((agent) => ({
                  ...agent,
                  updatedAt: String(frame),
                  prompt: 'Prompt '.repeat(10000),
                  result: 'Result '.repeat(10000),
                })),
              }
            : task.id === 'child'
              ? {
                  ...task,
                  messages: [{ id: 'child-stream', role: 'assistant', text: 'chunk ' + frame }],
                }
              : task,
        ),
      )
    }
  })
  assert.equal(
    await page.evaluate(() => window.counts.pills),
    0,
    'transcript-only child updates repainted sidebar pills',
  )
  await page.evaluate(() =>
    window.publish(
      window.tasks.map((task) =>
        task.id === 'parent'
          ? {
              ...task,
              subagents: task.subagents.map((agent) => ({
                ...agent,
                activity: 'Running targeted tests',
                tokens: 42,
              })),
            }
          : task,
      ),
    ),
  )
  await page.getByRole('button', { name: /Open subagent.*Running targeted tests/ }).waitFor()
  assert.equal(
    await page.evaluate(() => window.counts.pills),
    1,
    'visible child activity should repaint only its parent pills',
  )

  // The running row owns its one-second clock; the list itself does not re-render.
  await page.evaluate(() => {
    window.counts.rows = 0
    window.counts.list = 0
  })
  await page.waitForTimeout(3200)
  const ticking = await page.evaluate(() => ({ ...window.counts }))
  assert.equal(ticking.list, 0, `list re-rendered ${ticking.list} times for a running clock`)
  assert.ok(ticking.rows >= 2 && ticking.rows <= 5, `${ticking.rows} row renders in 3.2 seconds`)

  // Commands resolve the latest entry, including after a task changes underneath its row.
  await page.evaluate(() =>
    window.publish(
      window.tasks.map((task) => (task.id === 'task-0' ? { ...task, title: 'Renamed' } : task)),
    ),
  )
  await page.getByRole('button', { name: /Renamed/ }).click()
  assert.equal(await page.evaluate(() => window.selected.task.title), 'Renamed')
  await page.getByRole('button', { name: /Open subagent Child agent/ }).click()
  assert.equal(await page.evaluate(() => window.selected.task.id), 'child')

  // Modifier selection and the shared selection menu still work on real rows.
  await page.getByRole('button', { name: /Thread 1\b/ }).click()
  await page.getByRole('button', { name: /Thread 2\b/ }).click({ modifiers: ['ControlOrMeta'] })
  await page.getByRole('button', { name: /Thread 2\b/ }).click({ button: 'right' })
  await page.getByText('2 threads selected', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Thread 3\b/ }).click()

  // Pause visibility delivery so real Tab events must cross unloaded placeholders.
  // Production may scroll them into view sooner; focus handoff must work without that race.
  await page.evaluate(() => {
    window.freezeWindows = true
  })
  await page.getByRole('button', { name: /Thread 3\b/ }).focus()
  const forward = []
  for (let step = 0; step < 1000 && forward.at(-1) !== 'task-90'; step++) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => {
      const active = document.activeElement
      const row = active?.closest('[data-task-row-key]')
      return { key: row?.dataset.taskRowKey, placeholder: active === row }
    })
    assert.equal(
      focus.placeholder,
      false,
      'Tab remained on a placeholder instead of its mounted control',
    )
    if (focus.key) {
      const id = JSON.parse(focus.key)[1]
      if (id.startsWith('task-') && forward.at(-1) !== id) forward.push(id)
    }
  }
  assert.deepEqual(
    forward.filter((id) => id !== 'task-3'),
    Array.from({ length: 87 }, (_, index) => 'task-' + (index + 4)),
  )
  const reverse = []
  for (let step = 0; step < 1000 && reverse.at(-1) !== 'task-3'; step++) {
    await page.keyboard.press('Shift+Tab')
    const focus = await page.evaluate(() => {
      const active = document.activeElement
      const row = active?.closest('[data-task-row-key]')
      return { key: row?.dataset.taskRowKey, placeholder: active === row }
    })
    assert.equal(focus.placeholder, false, 'Shift+Tab remained on an unloaded placeholder')
    if (focus.key) {
      const id = JSON.parse(focus.key)[1]
      if (id.startsWith('task-') && reverse.at(-1) !== id) reverse.push(id)
    }
  }
  // The first backwards step may still be another control on task-90.
  assert.deepEqual(
    reverse.filter((id) => id !== 'task-90'),
    Array.from({ length: 87 }, (_, index) => 'task-' + (89 - index)),
  )
  await page.evaluate(() => {
    window.freezeWindows = false
    document.activeElement?.blur()
  })
  await scroller.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await page.getByText('Running thread', { exact: true }).waitFor()

  // Opening a collapsed section renders its rows on demand, still windowed.
  await page.locator('summary').filter({ hasText: 'Settled' }).click()
  await page.getByText('Settled thread 0', { exact: true }).waitFor({ state: 'attached' })
  const settledRow = page.getByRole('button', { name: /Settled thread 0/, exact: true })
  // The project badge falls back to its initial; no status, branch or device text remains.
  assert.equal(await settledRow.textContent(), 'PRSettled thread 0')
  assert.equal(await settledRow.locator('[aria-hidden="true"]').count(), 1)
  assert.equal(await settledRow.locator('[data-row-icon]').count(), 0)
  await settledRow.click()
  assert.equal(await page.evaluate(() => window.selected.task.id), 'settled-0')
  await page.locator('summary').filter({ hasText: 'Settled' }).click()
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].some((button) =>
        button.textContent?.includes('Settled thread'),
      ),
  )

  // Scrolling swaps the mounted window and keeps the DOM bounded.
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.getByText('Thread 299', { exact: true }).waitFor()
  await page.waitForFunction(() => !document.body.textContent.includes('Running thread'))
  const scrolled = await mountedRows()
  assert.ok(scrolled <= 40, `${scrolled} rows mounted after scrolling`)

  // Remounting restores the same position with measured placeholder heights.
  await scroller.evaluate((element) => {
    element.scrollTop = 9000
    element.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(100)
  const firstVisible = () =>
    scroller.evaluate((element) => {
      const top = element.getBoundingClientRect().top
      return [...element.querySelectorAll('[data-row-icon]')]
        .map((icon) => icon.closest('button'))
        .find((button) => button.getBoundingClientRect().bottom > top)
        ?.textContent.match(/Thread \d+/)?.[0]
    })
  const position = async () => ({
    top: await scroller.evaluate((element) => element.scrollTop),
    row: await firstVisible(),
  })
  const before = await position()
  await page.evaluate(() => window.setMounted(false))
  await page.evaluate(() => window.setMounted(true))
  await page.waitForTimeout(100)
  assert.deepEqual(await position(), before)

  // Removed tasks are not retained by row commands, measured heights or selectors.
  await page.evaluate(() => {
    const removed = (task) => task.id.startsWith('task-2')
    const large = window.tasks.filter(removed).map((task) => ({
      ...task,
      messages: [...task.messages, { id: 'large', role: 'user', text: 'x'.repeat(200000) }],
    }))
    window.publish([...window.tasks.filter((task) => !removed(task)), ...large])
    window.references = large.map((task) => new WeakRef(task))
    window.publish(window.tasks.filter((task) => !removed(task)))
    window.publish([...window.tasks])
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const retained = await page.evaluate(
    () => window.references.filter((reference) => reference.deref() !== undefined).length,
  )
  assert.ok(retained <= 2, `${retained} removed tasks survived garbage collection`)
  // General conversations never imply a Git checkout, even with stale branch metadata.
  await page.evaluate(() =>
    window.publish([
      {
        ...window.tasks[0],
        id: 'general',
        repositoryId: 'scratch',
        title: 'General conversation',
        execution: 'worktree',
        checkoutBranch: 'stale-branch',
        archived: false,
        archivedAt: undefined,
      },
    ]),
  )
  const general = page.getByRole('button', { name: /General conversation/ }).first()
  await general.waitFor()
  assert.ok((await general.textContent()).includes('General'))
  assert.equal(await general.locator('svg.lucide-message-circle').count(), 1)
  assert.equal(await general.locator('svg.lucide-git-branch, svg.lucide-git-fork').count(), 0)
  assert.ok(!/stale-branch|Local checkout|No project/.test(await general.textContent()))
  await general.hover()
  const tooltip = page.getByRole('tooltip')
  await tooltip.waitFor()
  assert.ok(!/stale-branch|Unknown branch|No project/.test(await tooltip.textContent()))
  assert.deepEqual(errors, [])
  console.log(
    `Sidebar rendering: ${initial}/302 rows mounted, ${streaming.rows} row renders for 30 streamed frames, ${ticking.rows} clock renders in 3.2s with no list renders; zero pill renders for 30 large child-payload updates and one render for visible activity; selector isolation, latest-entry commands, subagent navigation, selection menu, Tab/Shift+Tab across 87 windowed tasks with focus handoff, collapsed sections, windowed scrolling, scroll restoration and removed-task release verified.`,
  )
} finally {
  await browser.close()
}
