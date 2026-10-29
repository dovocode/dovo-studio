import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { chromium } from './browser/harness.mjs'

// Real sidebar, rows, context menus, studio-ui and workspace value provider. Only the host,
// the projects menu and two leaves that count renders are replaced.
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `export * from '${root}packages/studio-core/src/index.ts';export const useStudioHost=()=>window.host;`,
  '@dovo/extension-scm/project-transfer': 'export const ProjectTransferDialog=()=>null;',
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
import {WorkspaceValueProvider,useWorkspace,useWorkspaceSelector,updateAppPreferences} from '@dovo/studio-core';
import {runtimeSnapshotPath} from '@dovo/protocol';
window.setListPreferences=updateAppPreferences;window.settledPath=()=>runtimeSnapshotPath({address:'http://local',token:'token'});
window.counts={list:0,rows:0,broad:0,selected:0,trees:0};
const now=Date.now();
const iso=offset=>new Date(now-offset).toISOString();
const base={repositoryId:'repo',agentId:'',draft:'',files:[],example:false};
const finished=(id,title,age,extra={})=>({...base,id,title,createdAt:iso(age+60000),status:'done',
  messages:[{id:'m-'+id,role:'user',text:'Request '+id}],
  turns:[{id:'turn-'+id,status:'completed',startedAt:iso(age+30000),finishedAt:iso(age)}],...extra});
const running={...base,id:'running',title:'Running thread',createdAt:iso(0),status:'running',
  messages:[{id:'m-running',role:'user',text:'Stream'}],turns:[{id:'turn-running',status:'running',startedAt:iso(0)}]};
const subagent={id:'child',taskId:'child',source:'dovo',name:'Child agent',provider:'codex',status:'working',startedAt:iso(0),updatedAt:iso(0)};
const native={id:'native',name:'Native child',provider:'claude',status:'completed',startedAt:iso(2000),updatedAt:iso(1000),finishedAt:iso(1000)};
const parent=finished('parent','Parent thread',1000,{subagents:[subagent,native]});
const child=finished('child','Child thread',1000,{delegation:{parentTaskId:'parent',parentRunId:'run',key:'child'}});
window.initialTasks=[running,parent,child,
  ...Array.from({length:300},(_,i)=>finished('task-'+i,'Thread '+i,(i+2)*60000)),
  ...Array.from({length:120},(_,i)=>finished('settled-'+i,'Settled thread '+i,(i+400)*60000,{archived:true}))];
// Snapshot retention keeps unchanged collections identical; the fixture does the same.
const repositories=[{id:'repo',name:'Project',path:'/project',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:'stale-branch'}],agents=[{id:'agent',name:'Agent',provider:'codex',model:'fixture',instructions:'',permission:'ask',endpoint:''}],automations=[];
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
  const [project,setProject]=useState('');window.setProject=setProject;
  const [remoteTasks,setRemoteTasks]=useState([]);window.setRemoteTasks=setRemoteTasks;
  window.publish=next=>flushSync(()=>{setTasks(next);setRevision(value=>value+1)});
  window.setMounted=value=>flushSync(()=>setMounted(value));
  window.tasks=tasks;
  const workspace={version:1,runtimeAddress:'',repositories,agents,automations,tasks};
  const snapshot={...baseSnapshot,revision,workspace};
  const source={runtimeId:'local',address:'http://local',connection:actions.connection,name:'Local',workspace,snapshot,online:true};
  return <WorkspaceValueProvider value={{...actions,workspace,snapshot,connected:true,runtimes:[]}}>
    <BroadProbe/><SelectedProbe/>
    <div style={{height:'600px',display:'flex'}}>
      {mounted&&<TaskList projectId={project} onProjectChange={setProject} selectedId={selectedId} onSelect={entry=>{window.selected=entry;setSelectedId(entry.key)}}
        onCreate={()=>{}} onNewThread={()=>{}} onDeselect={()=>{}} onOrderChange={entries=>{window.order=entries.map(entry=>entry.task.id)}}
        sources={[source,...(remoteTasks.length?[{...source,runtimeId:'remote',name:'Remote',workspace:{...workspace,tasks:remoteTasks,repositories:[{id:'remote-scratch',kind:'scratch',name:'Private folder',path:'/remote/private',branch:''}]}}]:[])]} activeRuntimeId="local" busy={false} error=""/>}
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
        builder.onLoad({ filter: /\/nested-threads\.tsx$/ }, ({ path }) => ({
          contents: readFileSync(path, 'utf8').replace(
            'if (!threads.length) return null',
            'if (!threads.length) return null; window.counts.trees++;',
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
.min-h-0{min-height:0}.flex-1{flex:1 1 0%}.overflow-y-auto{overflow-y:auto}.min-h-\\[68px\\]{min-height:68px}
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
    window.host = {
      openThread: (target) => {
        window.openedThread = target
      },
    }
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

  const childToggle = page.getByRole('button', {
    name: 'Subthreads for Parent thread',
    exact: true,
  })
  assert.equal(await childToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child thread' }).count(),
    0,
  )
  await childToggle.press('Enter')
  assert.equal(await page.evaluate(() => window.selected), undefined)
  await page.evaluate(() => window.setMounted(false))
  await page.evaluate(() => window.setMounted(true))
  assert.equal(await childToggle.getAttribute('aria-expanded'), 'true')
  await childToggle.click()
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child thread' }).count(),
    0,
  )
  await childToggle.click()

  // The authoritative child is finished, so its activity is visible only after disclosure.
  const finishedToggle = page.getByRole('button', {
    name: 'Finished threads for Parent thread',
    exact: true,
  })
  assert.equal(await finishedToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(
    await page.getByRole('button', { name: 'Open child thread Child thread' }).count(),
    0,
  )
  await finishedToggle.click()
  await page.getByRole('button', { name: 'Open child thread Child thread' }).waitFor()

  // Studio and native transcript payloads do not repaint the tree. Visible facts still update.
  await page.evaluate(() => {
    window.counts.trees = 0
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
    await page.evaluate(() => window.counts.trees),
    0,
    'transcript-only updates repainted a thread tree',
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
  await page.getByText('Running targeted tests', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.counts.trees),
    1,
    'visible child activity should repaint only its parent tree',
  )
  await page.evaluate(() => {
    window.counts.trees = 0
    window.publish(
      window.tasks.map((task) =>
        task.id === 'parent'
          ? {
              ...task,
              subagents: task.subagents.map((agent) =>
                agent.id === 'native' ? { ...agent, name: 'Native child updated' } : agent,
              ),
            }
          : task,
      ),
    )
  })
  await page.getByRole('button', { name: 'Open child thread Native child updated' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.counts.trees),
    1,
    'visible native agent changes should repaint only their parent tree',
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
  await page.getByRole('button', { name: 'Open child thread Child thread', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.openedThread), {
    runtimeId: 'local',
    threadId: 'child',
    title: 'Child thread',
    parent: { runtimeId: 'local', threadId: 'parent', title: 'Parent thread' },
  })

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
  const settledSection = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Settled' }) })
  await page.getByRole('button', { name: 'Show all 120 settled threads', exact: true }).waitFor()
  assert.equal(await settledSection.getByRole('button', { name: /Settled thread/ }).count(), 5)
  await page.getByRole('button', { name: 'Show all 120 settled threads', exact: true }).click()
  await page.getByText('Settled thread 0', { exact: true }).waitFor({ state: 'attached' })
  const settledRow = page.getByRole('button', { name: /Settled thread 0/, exact: true })
  // Settled rows keep the original single-line project icon and title.
  assert.equal(await settledRow.getByText('Settled thread 0', { exact: true }).count(), 1)
  assert.equal(await settledRow.locator('.studio-thread-card-context').count(), 0)
  await settledRow.click()
  assert.equal(await page.evaluate(() => window.selected.task.id), 'settled-0')
  await page.getByRole('button', { name: 'Show fewer settled threads', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Search threads', exact: true })
    .fill('Settled thread 110')
  await page.getByText('Settled thread 110', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Show all \d+ settled threads/ }).count(), 0)
  await page.getByRole('textbox', { name: 'Search threads', exact: true }).fill('')
  await page.getByRole('button', { name: 'Show all 120 settled threads', exact: true }).waitFor()
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
  const waitForVisibleRows = () =>
    page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="Task sidebar"] [aria-busy]')
      const bounds = element.getBoundingClientRect()
      return [...element.querySelectorAll('[data-row-icon]')].some((icon) => {
        const row = icon.closest('button').getBoundingClientRect()
        return row.bottom > bounds.top && row.top < bounds.bottom
      })
    })
  await waitForVisibleRows()
  const before = await position()
  await page.evaluate(() => window.setMounted(false))
  await page.evaluate(() => window.setMounted(true))
  await waitForVisibleRows()
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
  assert.ok((await general.textContent()).includes('No Project'))
  assert.equal(await general.locator('svg.lucide-message-circle-dashed').count(), 1)
  assert.equal(await general.locator('svg.lucide-git-branch, svg.lucide-git-fork').count(), 0)
  assert.ok(!/stale-branch|Local checkout/.test(await general.textContent()))
  await general.hover()
  const tooltip = page.getByRole('tooltip')
  await tooltip.waitFor()
  assert.ok(!/stale-branch|Unknown branch/.test(await tooltip.textContent()))
  // The General filter includes scratch threads on every computer, with distinct IDs.
  await page.evaluate(() => {
    window.setRemoteTasks([
      {
        ...window.tasks[0],
        id: 'remote-general',
        title: 'Remote General conversation',
        repositoryId: 'remote-scratch',
      },
    ])
    window.publish([
      ...window.tasks,
      {
        ...window.tasks[0],
        id: 'regular',
        title: 'Regular project conversation',
        repositoryId: 'repo',
      },
    ])
    window.setProject('scratch')
  })
  await page
    .getByRole('button', { name: /Remote General conversation/ })
    .first()
    .waitFor()
  await general.waitFor()
  assert.deepEqual(
    await page.evaluate(() => [...window.order].sort((a, b) => a.localeCompare(b))),
    ['general', 'remote-general'],
  )
  await page.evaluate(() => window.setProject(JSON.stringify(['local', 'scratch'])))
  await page
    .getByRole('button', { name: /Remote General conversation/ })
    .first()
    .waitFor({ state: 'detached' })
  await general.waitFor()
  // Linked General chats use the project's identity without implying a checkout switch.
  await page.evaluate(() =>
    window.publish(
      window.tasks.map((task) =>
        task.id === 'general'
          ? {
              ...task,
              linkedCheckouts: [
                { id: 'link', repositoryId: 'repo', execution: 'main', access: 'read-only' },
              ],
            }
          : task,
      ),
    ),
  )
  assert.ok((await general.textContent()).includes('Project'))
  assert.equal(await general.locator('svg.lucide-message-circle-dashed').count(), 0)
  assert.equal(await general.locator('svg.lucide-git-branch, svg.lucide-git-fork').count(), 0)
  assert.ok(!/stale-branch|Local checkout/.test(await general.textContent()))
  await page.evaluate(() => window.setProject(''))
  for (const sort of ['newest', 'oldest', 'title', 'project', 'status']) {
    await page.evaluate((taskSort) => window.setListPreferences({ taskSort }), sort)
    await page.waitForFunction(() => !window.settledPath().includes('settled='))
  }
  for (const sort of ['priority', 'activity']) {
    await page.evaluate((taskSort) => window.setListPreferences({ taskSort }), sort)
    await page.waitForFunction(() => window.settledPath().includes('settled=25'))
  }
  // Verify the actual app CSS after the render/windowing checks above.
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.evaluate(() => {
    const turn = {
      id: 'appearance-turn',
      status: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }
    const base = {
      ...window.tasks[0],
      repositoryId: 'repo',
      status: 'done',
      archived: false,
      archivedAt: undefined,
      linkedCheckouts: undefined,
      turns: [turn],
    }
    window.publish([
      { ...base, id: 'read-style', title: 'Read appearance', lastViewedTurnId: turn.id },
      { ...base, id: 'unread-style', title: 'Unread appearance', lastViewedTurnId: undefined },
      { ...base, id: 'settled-style', title: 'Compact settled appearance', archived: true },
    ])
  })
  const readTitle = page.getByRole('button').getByText('Read appearance', { exact: true })
  const unreadTitle = page.getByRole('button').getByText('Unread appearance', { exact: true })
  await readTitle.waitFor()
  await unreadTitle.waitFor()
  await page.mouse.move(1100, 650)
  assert.notEqual(
    await readTitle.evaluate((el) => getComputedStyle(el).color),
    await unreadTitle.evaluate((el) => getComputedStyle(el).color),
    'Read titles are visibly dimmer than unread titles',
  )
  assert.equal(
    await unreadTitle.locator('xpath=ancestor::button[1]').getAttribute('data-unread'),
    'true',
  )
  assert.equal(
    await readTitle.locator('xpath=ancestor::button[1]').getAttribute('data-unread'),
    null,
  )
  const metadataColor = await readTitle
    .locator('xpath=ancestor::button[1]')
    .locator('.studio-thread-card-context')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  assert.equal(
    await unreadTitle
      .locator('xpath=ancestor::button[1]')
      .locator('.studio-thread-card-context')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    metadataColor,
    'Unread metadata stays secondary',
  )
  await readTitle.click()
  await page.mouse.move(800, 600)
  assert.equal(
    await readTitle.locator('xpath=ancestor::button[1]').getAttribute('aria-current'),
    'true',
  )
  assert.match(
    await readTitle
      .locator('xpath=ancestor::button[1]')
      .evaluate((el) => getComputedStyle(el).backgroundImage),
    /linear-gradient/,
    'Selected threads retain their gradient highlight',
  )
  assert.equal(
    await readTitle.evaluate((el) => getComputedStyle(el).color),
    await unreadTitle.evaluate((el) => getComputedStyle(el).color),
    'Selected read titles have full emphasis',
  )
  const settledDetails = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Settled' }) })
  if (!(await settledDetails.evaluate((el) => el.open)))
    await settledDetails.locator('summary').click()
  const compactTitle = page.getByText('Compact settled appearance', { exact: true })
  await compactTitle.waitFor()
  await compactTitle
    .locator('xpath=ancestor::button[1]')
    .getByLabel('Settled', { exact: true })
    .waitFor()
  assert.equal(
    await compactTitle
      .locator('xpath=ancestor::button[1]')
      .getByLabel('Settled', { exact: true })
      .evaluate((el) => el.classList.contains('text-status-success')),
    true,
  )
  const compactBox = await compactTitle.locator('xpath=ancestor::button[1]').boundingBox()
  assert.ok(
    compactBox && compactBox.height <= 38,
    'Settled rows retain the original compact height',
  )
  await page.evaluate(() =>
    window.publish([
      {
        ...window.tasks[0],
        id: 'projectless-layout',
        status: 'draft',
        turns: [],
        repositoryId: 'scratch',
        linkedCheckouts: undefined,
        title: 'Projectless layout',
        archived: false,
        archivedAt: undefined,
        agentId: 'agent',
      },
    ]),
  )
  const projectless = page.getByRole('button', { name: /Projectless layout/ }).first()
  await projectless.waitFor()
  const draftGlyph = projectless.getByLabel('Draft', { exact: true })
  await draftGlyph.waitFor()
  assert.ok(
    (await draftGlyph.boundingBox()).x <
      (await projectless.getByText('No Project', { exact: true }).boundingBox()).x,
  )
  assert.notEqual(
    await projectless.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  )
  assert.equal(await projectless.locator('[data-thread-execution] > *').count(), 2)
  const titleLine = await projectless.locator('[data-thread-title]').boundingBox()
  const executionLine = await projectless.locator('[data-thread-execution]').boundingBox()
  assert.ok(
    Math.abs(titleLine.y + titleLine.height / 2 - executionLine.y - executionLine.height / 2) < 1,
    'Projectless runtime and agent share the title line',
  )
  assert.equal(await projectless.locator('.lucide-git-fork').count(), 0)
  const stateColors = []
  for (const [state, draft] of [
    ['open', false],
    ['closed', false],
    ['merged', false],
    ['open', true],
  ]) {
    await page.evaluate(
      ({ state, draft }) =>
        window.publish([
          {
            ...window.tasks[0],
            linkedPullRequests: [
              {
                number: 42,
                url: 'https://github.com/o/r/pull/42',
                repositoryUrl: 'https://github.com/o/r',
                title: 'PR',
              },
            ],
            pullStatus: {
              number: 42,
              url: 'https://github.com/o/r/pull/42',
              state,
              draft,
              checkedAt: new Date().toISOString(),
            },
          },
        ]),
      { state, draft },
    )
    const badge = projectless.getByLabel('1 linked pull request', { exact: true })
    await badge.waitFor()
    const numberColor = await badge.evaluate((el) => getComputedStyle(el).color)
    assert.equal(
      await badge.locator('svg').evaluate((el) => getComputedStyle(el).color),
      numberColor,
    )
    stateColors.push(numberColor)
  }
  assert.equal(
    new Set(stateColors).size,
    4,
    'Open, closed, merged and draft PRs have distinct state colors',
  )
  await page.evaluate(() => {
    window.setRemoteTasks([])
    window.setListPreferences({ workingSection: true, collapsedThreadSections: [] })
    window.publish([
      window.initialTasks[0],
      {
        ...window.initialTasks[0],
        id: 'pinned-working',
        title: 'Pinned working thread',
        pinned: true,
      },
      {
        ...window.initialTasks[1],
        id: 'waiting',
        title: 'Waiting thread',
        waitingForFeedback: true,
        subagents: [],
      },
      { ...window.initialTasks[0], id: 'saving', title: 'Saving thread', runPhase: 'finalizing' },
    ])
  })
  const workingRow = page.getByRole('button', { name: /Running thread/ }).first()
  const waitingRow = page.getByRole('button', { name: /Waiting thread/ }).first()
  for (const { row, state } of [
    { row: workingRow, state: 'Working' },
    { row: waitingRow, state: 'Waiting' },
  ]) {
    const indicator = row.getByLabel(new RegExp('^' + state))
    await indicator.waitFor()
    const text = await indicator.innerText()
    if (state === 'Working')
      assert.match(text, /^\d+[smh]/, 'Grouped working rows keep their elapsed time')
    else assert.equal(text, '', 'Waiting sections use an icon without a repeated label')
    assert.ok(!text.includes(state), `${state} sections omit the repeated label`)
    assert.equal(await indicator.locator('svg').count(), 1)
  }
  assert.match(
    await page
      .getByRole('button', { name: /Pinned working thread/ })
      .first()
      .innerText(),
    /Working/,
  )
  assert.match(
    await page
      .getByRole('button', { name: /Saving thread/ })
      .first()
      .innerText(),
    /Saving changes/,
  )
  await page.evaluate(() => window.setListPreferences({ workingSection: false }))
  assert.match(await workingRow.innerText(), /Working/, 'Ungrouped working rows keep their label')
  assert.equal(await waitingRow.getByLabel(/^Waiting/).innerText(), '')

  // A provider shell is activity, but is not an agent. Keep it in Open and expose its icon.
  await page.evaluate(() => {
    const task = {
      ...window.initialTasks[0],
      id: 'terminal-only',
      title: 'Terminal-only thread',
      status: 'review',
      subagents: [
        {
          id: 'shell',
          provider: 'claude',
          name: 'Background server',
          kind: 'background',
          status: 'working',
          sessionLive: true,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }
    window.terminalTask = task
    window.setListPreferences({
      taskGrouping: 'none',
      workingSection: true,
      collapsedThreadSections: ['working'],
    })
    window.publish([task])
  })
  const terminalRow = page
    .getByRole('button')
    .filter({
      has: page.locator('[data-thread-title]').filter({ hasText: 'Terminal-only thread' }),
    })
    .first()
  await terminalRow.waitFor()
  assert.equal(await terminalRow.getByLabel('1 active terminal', { exact: true }).count(), 1)
  assert.equal(
    await terminalRow.locator('xpath=ancestor::details').count(),
    0,
    'Terminal-only work stays Open',
  )
  await page.evaluate(() => window.publish([{ ...window.terminalTask, status: 'running' }]))
  assert.equal(
    await page.getByText('Terminal-only thread', { exact: true }).count(),
    0,
    'An agent waiting on the shell stays in the collapsed Working section',
  )
  await page.evaluate(() =>
    window.publish([
      {
        ...window.terminalTask,
        subagents: window.terminalTask.subagents.map((shell) => ({ ...shell, sessionLive: false })),
      },
    ]),
  )
  await terminalRow.waitFor()
  assert.equal(await terminalRow.getByLabel('1 active terminal', { exact: true }).count(), 0)

  if (process.env.DOVO_UI_SCREENSHOT) {
    await page.evaluate(() => {
      window.setRemoteTasks([])
      window.setListPreferences({
        taskGrouping: 'status',
        taskSort: 'newest',
        workingSection: true,
      })
      window.publish([...window.initialTasks.slice(0, 5), window.initialTasks[303]])
    })
    await page.getByText('Parent thread', { exact: true }).click()
    const subthreads = page.getByRole('button', {
      name: 'Subthreads for Parent thread',
      exact: true,
    })
    if ((await subthreads.getAttribute('aria-expanded')) !== 'true') await subthreads.click()
    const finished = page.getByRole('button', {
      name: 'Finished threads for Parent thread',
      exact: true,
    })
    if ((await finished.getAttribute('aria-expanded')) !== 'true') await finished.click()
    await page.getByRole('button', { name: 'Open child thread Child thread' }).click()
    await page.mouse.move(800, 650)
    await page.screenshot({ path: process.env.DOVO_UI_SCREENSHOT })
  }
  assert.deepEqual(errors, [])
  console.log(
    `Sidebar rendering: ${initial}/302 rows mounted, ${streaming.rows} row renders for 30 streamed frames, ${ticking.rows} clock renders in 3.2s with no list renders; zero tree renders for 30 large Studio/native child-payload updates and one tree render per visible activity/name change; selector isolation, latest-entry commands, nested thread navigation, selection menu, Tab/Shift+Tab across 87 windowed tasks with focus handoff, collapsed sections, windowed scrolling, scroll restoration and removed-task release verified.`,
  )
} finally {
  await browser.close()
}
