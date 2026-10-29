import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

// Real audited components and freshly generated CSS, with runtime data and unrelated panels stubbed.
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const mocks = {
  '@xyflow/react': `export const Handle=()=>null;export const Position={Left:'left',Right:'right'};export const ReactFlowProvider=({children})=>children;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export {isActiveRuntime} from '${root}/packages/studio-core/src/runtime/ownership';export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const providers={codex:{short:'Codex',name:'OpenAI Codex'}};export const repositorySourceKey=(a,b)=>a+b;export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:()=>{}});export const useRuntimeSources=()=>window.sources;export const useConfirmSettingsNavigation=()=>()=>true;export const WorkspaceScope=({children})=>children;export const WorkspaceRuntimeScope=WorkspaceScope;export const useOptionalSettingsTarget=()=>null;export const useSettingsTarget=()=>({target:{projectId:'',environmentId:''},setTarget:()=>{},sources:window.sources,source:window.sources[0],scope:'global'});export const acpHarnessName=()=>'';export const formatDateTime=String;`,
  '@dovo/studio-ui': `export {PageHeader} from '${ui}/page-header';export * from '${ui}/sidebar-header';export {Button} from '${ui}/components/ui/button';export {IconButton} from '${ui}/components/icon-button';export {Input} from '${ui}/components/ui/input';export * from '${ui}/components/ui/dialog';export {ChoicePicker} from '${ui}/choice-picker';export {cn} from '${ui}/lib/utils';export {ProjectIcon} from '${ui}/project-icon';export * from '${ui}/components/ui/tooltip';export * as Popover from '@radix-ui/react-popover';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {EmptyState} from '${ui}/components/empty-state';export {useCompactLayout} from '${ui}/use-compact-layout';export const useModelLabel=()=>'';export const AgentAvatar=({className})=><span data-agent-avatar className={className}/>;export const PullRequestIcon=()=>null;export const pullRequestIconTone=()=>'';`,
  './task-context-menu': `export const TaskContextMenu=({children})=>children;`,
  './task-branch-menu': `export const TaskBranchMenu=({label})=><button className="min-w-0 max-w-48 truncate">{label}</button>;`,
  './task-pull-status': `export const TaskPullStatus=()=>null;`,
  '../list/task-collection': `export const retainTaskOwner=()=>window.owner;`,
  '../detail/task-lifecycle-actions': `export const TaskLifecycleActions=()=>null;`,
  './run-details': `export const StepStatus=()=>null;`,
  './automation-detail': `export const AutomationDetail=()=>null;`,
  './cached-automation': `export const CachedAutomation=()=>null;`,
  './work-sources': `export const workRemoteKey=source=>source.key;export const matchesWorkSource=(source,key)=>!key||source.key===key;export const jiraSourceKey=(a,b)=>a+b;export const useIssueSources=()=>[window.workSource];`,
  './use-work-sources': `export const useWorkSources=()=>({sources:[window.workSource],pages:[{source:window.workSource,reader:window.workSource,items:[],options:{issues:true,pipelineActions:['run']}}],busy:false,refresh:()=>{},more:async()=>{},chooseReader:()=>{}});`,
  './jira-toolbar': `export const JiraToolbar=()=>null;`,
  './content': `export const WorkContent=()=>null;`,
  './work-form': `export const WorkForm=()=>null;`,
  './jira-issue-list': `export const JiraIssueList=()=>null;export const jiraIssueRowKey=()=>'';`,
  './pipeline-state': `export const PipelineState=()=>null;`,
  '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
  '../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TooltipProvider} from '@radix-ui/react-tooltip';import * as Popover from '@radix-ui/react-popover';import {ReactFlowProvider} from '@xyflow/react';
import {SettingSource} from './packages/studio-ui/src/setting-source';import {SettingRow} from './packages/studio-ui/src/settings-layout';import {TaskHeader} from './packages/extension-tasks/src/detail/task-header';import {TaskRow} from './packages/extension-tasks/src/list/task-row';import {HostSettingsPage} from './packages/studio-ui/src/host-settings-page';import {SettingsScopePage} from './packages/studio-ui/src/settings-scope-page';import {AutomationNodeView} from './packages/extension-jobs/src/automation-node';import JobsView from './packages/extension-jobs/src/view';import IssuesView,{JiraView,PipelinesView} from './packages/extension-scm/src/work/work-view';
const repo={id:'repo',name:'Audit project',path:'/repo',branch:'feature/long-branch-name-for-layout'};
const workspace={repositories:[repo],agents:[],tasks:[],automations:[]};const snapshot={workspace,runs:[],questions:[],approvals:[],terminals:[],artifactsEnabled:true};
window.sources=['MacBook Pro','Linux workstation with an unusually long saved computer name'].map((name,index)=>({name,scope:String(index),connected:true,profile:{id:String(index),name,connection:{address:'http://computer'+index,token:'paired'}},snapshot}));
window.store={workspace,snapshot,connected:true,activeRuntimeId:'0',runtimes:window.sources,connection:window.sources[0].profile.connection,refreshRuntime:async()=>{},refreshRuntimes:async()=>{},setWorkspace:()=>{}};
window.owner={name:'MacBook Pro',online:true,repositories:[repo],agents:[{id:'agent',name:'Agent',provider:'codex',model:'',endpoint:''}],acpInstallations:[]};window.workSource={key:'repo',scope:'0',connected:true,repository:repo,name:repo.name,runtimeName:'MacBook Pro',request:async()=>({issues:true,pipelineActions:['run']})};
const baseTask={id:'task',repositoryId:'repo',title:'Short title',status:'draft',files:[],linkedCheckouts:[],turns:[]};
function App(){const[view,setView]=useState('header'),[long,setLong]=useState(false),[panel,setPanel]=useState(false),[wide,setWide]=useState(false),[unread,setUnread]=useState(false),[archived,setArchived]=useState(false);window.show=(next,options={})=>{setView(next);setLong(!!options.long);setPanel(!!options.panel);setWide(!!options.wide);setUnread(!!options.unread);setArchived(!!options.archived)};const task={...baseTask,archived,status:unread?'running':'draft',title:long?'A_very_long_task_title_'.repeat(12):'Short title'};return <TooltipProvider><div id="fixture" style={{width:'100%',height:'100vh',display:'flex',flexDirection:'column',minWidth:0}}>{view==='header'?<Popover.Root><TaskHeader task={task} compact sidebarVisible hasDiff surface="chat" onSurface={value=>window.lastSurface=value} projectPanelOpen={panel} onProjectPanel={()=>{}} onCreate={()=>{}} onDeselect={()=>{}} toolsExpanded={false} onTools={()=>{}} bottomTerminalOpen={false} onBottomTerminal={()=>{}}/></Popover.Root>:view==='rows'?<div style={{background:'var(--sidebar)'}}><TaskRow task={{...task,agentId:'agent',linkedPullRequests:[{number:42,title:'Fixture PR',url:'https://github.com/o/r/pull/42',repositoryUrl:'https://github.com/o/r'}],subagents:[{id:'child',name:'Child',provider:'codex',status:'working',startedAt:'2026-10-24T09:00:00Z',updatedAt:'2026-10-24T09:00:00Z'}]}} owner={window.owner} selected={false} onSelect={()=>{}} needsInput={false} terminals={0} editable={false} disabled={false}/></div>:(view==='host'||view==='mixed')?<HostSettingsPage title="Computer settings" description="Per computer" localSettings={view==='mixed'?<button onClick={()=>window.localChanged=true}>Device default</button>:undefined}><p>Computer body</p></HostSettingsPage>:view==='scope'?<SettingsScopePage title="Settings" description="Scoped settings" wide={wide}>{()=> <div data-testid="body-start"><p>Settings body</p><SettingRow label="Worktree setup" source={<SettingSource label="Worktree setup" origin={{source:'global',overridden:true}} setting={{field:{group:'taskDefaults',key:'setupCommand'},scope:'global',value:'pnpm install',inheritedValue:'a_very_long_setup_command_'.repeat(16)}} onReset={()=>window.inheritanceReset=true}/>}>Custom setup</SettingRow></div>}</SettingsScopePage>:view==='node'?<ReactFlowProvider><AutomationNodeView data={{kind:'task',label:'nightly_dependency_security_review_'.repeat(long?8:1),objective:'Review dependencies'}} selected={false}/></ReactFlowProvider>:view==='jobs'?<JobsView/>:view==='jira'?<JiraView/>:view==='pipelines'?<PipelinesView/>:<IssuesView/>}</div></TooltipProvider>};createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + '/node_modules', root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'audit-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: ui,
        }))
      },
    },
  ],
})
// Transform only the stylesheet; no application build or generated repository files.
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 976, height: 700 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const show = async (view, options = {}) => {
    await page.evaluate(({ view, options }) => window.show(view, options), { view, options })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  const setWidth = async (width) => {
    await page.setViewportSize({ width, height: 700 })
    await page.evaluate(() => (document.getElementById('fixture').style.width = '100%'))
  }
  const contained = async (locator, container) => {
    const box = await locator.boundingBox(),
      outer = await container.boundingBox()
    assert.ok(box && outer)
    assert.ok(
      box.x >= outer.x - 1 && box.x + box.width <= outer.x + outer.width + 1,
      JSON.stringify({ box, outer }),
    )
  }
  for (const width of [240, 320, 390, 512, 976]) {
    await setWidth(width)
    for (const long of [false, true]) {
      await show('header', { long })
      const header = page.locator('#fixture > header')
      const title = page.getByRole('button', { name: 'Thread actions', exact: true })
      const tools = page.getByRole('group', { name: 'Task workspace' })
      await contained(title, header)
      await contained(tools, header)
      const titleBox = await title.boundingBox(),
        toolsBox = await tools.boundingBox()
      assert.ok(
        titleBox.y + titleBox.height <= toolsBox.y || titleBox.x + titleBox.width <= toolsBox.x,
        JSON.stringify({ width, titleBox, toolsBox }),
      )
      if (width < 480) assert.ok(titleBox.y + titleBox.height <= toolsBox.y)
      await page.getByRole('button', { name: 'Files', exact: true }).click()
      assert.equal(await page.evaluate(() => window.lastSurface), 'files')
    }
    await show('header', { long: true, panel: true })
    await contained(
      page.getByRole('button', { name: 'Thread actions', exact: true }),
      page.locator('#fixture > header'),
    )
  }
  // A narrow pane in a wide window must also put tools below the title.
  await setWidth(1280)
  await show('header', { long: true })
  await page.evaluate(() => (document.getElementById('fixture').style.width = '320px'))
  const title = await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .boundingBox()
  const tools = await page.getByRole('group', { name: 'Task workspace' }).boundingBox()
  assert.ok(title.y + title.height <= tools.y)
  await page.screenshot({ path: '/tmp/dovo-desktop-audit-task-pane-320.png' })
  for (const width of [240, 320, 390, 976]) {
    await setWidth(width)
    for (const archived of [false, true]) {
      await show('rows', { archived })
      const row = page.locator('.group\\/task')
      const title = await row.getByText('Short title', { exact: true }).boundingBox()
      if (archived) {
        const button = row
          .getByRole('button')
          .filter({ has: page.getByText('Short title', { exact: true }) })
        await button.getByLabel('Settled', { exact: true }).waitFor()
        const bounds = await button.boundingBox()
        assert.ok(bounds.height <= 38, 'Settled threads retain their compact height')
        await contained(row.getByText('Short title', { exact: true }), button)
        assert.equal(await row.getByText('Audit project', { exact: true }).count(), 0)
        assert.equal(await row.locator('.studio-thread-card-context').count(), 0)
        await page.mouse.move(width - 1, 699)
        await button.hover()
        const details = page.getByRole('tooltip')
        await details.waitFor()
        await details.getByText('Audit project', { exact: true }).waitFor()
        await details.getByText('MacBook Pro', { exact: true }).waitFor()
        await details.getByText('Agent · OpenAI Codex', { exact: true }).waitFor()
        await details.getByText('Settled', { exact: true }).waitFor()
        await page.keyboard.press('Escape')
        await details.waitFor({ state: 'hidden' })
        continue
      }
      const project = await row.getByText('Audit project', { exact: true }).boundingBox()
      const status = await row.getByText('Draft', { exact: true }).boundingBox()
      const provider = row.locator('[data-agent-avatar]')
      assert.equal(await provider.count(), 1)
      assert.equal(
        await provider.evaluate((icon) => !!icon.closest('.studio-thread-card-context')),
        true,
      )
      const providerBox = await provider.boundingBox()
      const runtime = row.locator('[data-runtime-icon]')
      assert.equal(await runtime.count(), 1)
      const runtimeBox = await runtime.boundingBox()
      assert.ok(
        runtimeBox.x + runtimeBox.width <= providerBox.x,
        'Harness follows the runtime machine',
      )
      assert.ok(
        Math.abs(providerBox.y + providerBox.height / 2 - runtimeBox.y - runtimeBox.height / 2) < 1,
        'Runtime and harness share a row',
      )
      assert.ok(
        title.y + title.height <= providerBox.y,
        'Active thread machine and harness appear below its title',
      )
      const toggle = row.getByRole('button', { name: 'Subthreads for Short title', exact: true })
      const icon = await toggle.locator('svg').boundingBox()
      assert.ok(Math.abs(icon.y + icon.height / 2 - runtimeBox.y - runtimeBox.height / 2) <= 1.5)
      assert.ok(icon.x + icon.width <= runtimeBox.x, 'Subthreads precede the runtime machine')
      const pull = await row.getByLabel('1 linked pull request', { exact: true }).boundingBox()
      assert.ok(pull.x + pull.width <= icon.x, 'PRs precede subthreads')
      await contained(toggle, row)
      const bounds = await toggle.boundingBox()
      assert.ok(
        providerBox.x + providerBox.width <= bounds.x ||
          bounds.x + bounds.width <= providerBox.x ||
          providerBox.y + providerBox.height <= bounds.y ||
          bounds.y + bounds.height <= providerBox.y,
        'Provider and subthread controls do not overlap',
      )
      assert.ok(
        project.y + project.height <= title.y,
        JSON.stringify({ width, archived, project, title }),
      )
      assert.ok(
        status.y + status.height <= title.y,
        JSON.stringify({ width, archived, status, title }),
      )
    }
  }
  for (const width of [320, 390, 512, 976]) {
    await setWidth(width)
    await show('host')
    const picker = page.getByRole('button', { name: 'Computer', exact: true })
    const actions = page.locator('.studio-page-actions')
    await contained(picker, actions)
    await contained(picker.locator('svg'), picker)
    assert.equal(
      await actions.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      true,
    )
    await picker.click()
    await page.getByRole('option', { name: /Linux workstation/ }).click()
    assert.match(await picker.textContent(), /Linux workstation/)
    await contained(picker, actions)
    if (width === 390) await page.screenshot({ path: '/tmp/dovo-desktop-audit-computer-390.png' })
    for (const wide of [false, true]) {
      await show('scope', { wide })
      const controls = await page
        .getByLabel('Settings target', { exact: true })
        .locator(':scope > div')
        .boundingBox()
      const body = await page.getByTestId('body-start').boundingBox()
      assert.ok(Math.abs(controls.x - body.x) <= 1, JSON.stringify({ width, wide, controls, body }))
      assert.ok(Math.abs(controls.width - body.width) <= 1)
    }
  }
  await page.evaluate(() => {
    window.savedSources = window.sources
    window.sources = window.sources.map((s) => ({ ...s, connected: false }))
  })
  await show('mixed')
  await page.getByText(/is offline\. Your unsaved edits are kept here\./).waitFor()
  assert.equal(await page.getByText('Computer body', { exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Retry connection', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Device default', exact: true }).click()
  assert.equal(await page.evaluate(() => window.localChanged), true)
  await page.evaluate(() => {
    window.sources = []
    window.localChanged = false
  })
  await show('host')
  await show('mixed')
  await page.getByRole('button', { name: 'Device default', exact: true }).click()
  assert.equal(await page.evaluate(() => window.localChanged), true)
  await page.evaluate(() => {
    window.sources = window.savedSources
  })
  await setWidth(390)
  for (const view of ['issues', 'jira', 'pipelines', 'jobs']) {
    await show(view)
    const name =
      view === 'jobs' ? 'New automation' : view === 'pipelines' ? 'Run pipeline' : 'New issue'
    const create = page.getByRole('button', { name, exact: true }).first()
    await contained(create, page.locator('.studio-page-actions'))
    assert.equal(
      await page
        .locator('.studio-page-actions')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      true,
      view,
    )
    if (view === 'jobs')
      await page.screenshot({ path: '/tmp/dovo-desktop-audit-automations-390.png' })
  }
  for (const long of [false, true]) {
    await show('node', { long })
    const node = page.locator('#fixture > div').first()
    assert.equal(
      await node.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      true,
    )
  }
  for (const mode of ['light', 'dark']) {
    await page.evaluate(
      (mode) => document.documentElement.classList.toggle('dark', mode === 'dark'),
      mode,
    )
    await show('scope')
    for (const width of [320, 390, 976]) {
      await setWidth(width)
      const source = page.getByRole('button', {
        name: 'View inheritance for worktree setup',
        exact: true,
      })
      assert.equal(await source.innerText(), '')
      const reset = page.getByRole('button', { name: /^Use inherited worktree setup:/ })
      await contained(source, page.locator('#fixture'))
      await contained(reset, page.locator('#fixture'))
      assert.equal(
        await reset.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        true,
      )
      const target = page.getByLabel('Settings target', { exact: true })
      const before = await target.boundingBox()
      await source.evaluate((element) => (element.closest('.overflow-y-auto').scrollTop = 10000))
      assert.equal((await target.boundingBox()).y, before.y, 'Settings target must remain fixed')
    }
    await page.screenshot({ path: '/tmp/dovo-inheritance-' + mode + '.png' })
    await page
      .getByRole('button', { name: 'View inheritance for worktree setup', exact: true })
      .click()
    await page.getByText('Worktree setup · inheritance', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Use inherited worktree setup:/ }).click()
    assert.equal(await page.evaluate(() => window.inheritanceReset), true)
  }
  const contrasts = []
  for (const mode of ['light', 'dark']) {
    await page.evaluate((mode) => {
      document.documentElement.className = mode
      document.documentElement.dataset.theme = mode
    }, mode)
    for (const unread of [false, true]) {
      await show('rows', { long: true, unread })
      const contrast = await page.locator('.group\\/task').evaluate((element) => {
        const button = element.querySelector('button')
        if (!button) throw new Error('Contrast checks require the thread row button')
        const title = button.querySelector('[data-thread-title]')
        const context = button.querySelector('.studio-thread-card-context')
        if (!title || !context)
          throw new Error('Contrast checks require the rendered thread title and metadata')
        const background = getComputedStyle(element.parentElement).backgroundColor
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const canvasContext = canvas.getContext('2d')
        if (!canvasContext) throw new Error('Contrast checks require a canvas context')
        // Let Chromium resolve color-mix/oklab and composite translucent read titles.
        const rgba = (color, backdrop, opacity = 1) => {
          canvasContext.clearRect(0, 0, 1, 1)
          if (backdrop) {
            canvasContext.fillStyle = backdrop
            canvasContext.fillRect(0, 0, 1, 1)
          }
          canvasContext.globalAlpha = opacity
          canvasContext.fillStyle = color
          canvasContext.fillRect(0, 0, 1, 1)
          canvasContext.globalAlpha = 1
          return [...canvasContext.getImageData(0, 0, 1, 1).data]
        }
        const luminance = (color) => {
          const rgb = color
            .slice(0, 3)
            .map((value) => value / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
        }
        const ratio = (color, opacity = 1) => {
          const a = luminance(rgba(color, background, opacity)),
            b = luminance(rgba(background))
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }
        return {
          title: ratio(getComputedStyle(title).color),
          titleAlpha: rgba(getComputedStyle(title).color)[3] / 255,
          metadata: ratio(
            getComputedStyle(context).color,
            Number(getComputedStyle(context).opacity),
          ),
          metadataOpacity: [...button.querySelectorAll('.studio-thread-card-context')].map((row) =>
            Number(getComputedStyle(row).opacity),
          ),
          weight: getComputedStyle(title).fontWeight,
        }
      })
      assert.ok(contrast.title >= 4.5, JSON.stringify({ mode, unread, contrast }))
      assert.deepEqual(contrast.metadataOpacity, [1, 1])
      assert.ok(contrast.metadata >= 4.5, JSON.stringify({ mode, unread, contrast }))
      contrasts.push({ mode, unread, ...contrast })
    }
  }
  for (const mode of ['light', 'dark']) {
    const read = contrasts.find((value) => value.mode === mode && !value.unread)
    const unread = contrasts.find((value) => value.mode === mode && value.unread)
    assert.ok(unread.title > read.title, 'Unread titles have stronger contrast than read titles')
    assert.equal(
      unread.metadata,
      read.metadata,
      'Metadata keeps the same secondary contrast for unread threads',
    )
    assert.ok(unread.title > unread.metadata, 'Unread titles lead the visual hierarchy')
  }
  console.log(
    'Task contrast measurements (with root-owned metadata CSS):',
    JSON.stringify(contrasts),
  )
  assert.deepEqual(errors, [])
  console.log(
    'Desktop audit geometry passed: task headers at 240–976px and a 320px pane inside a wide window; computer picker bounds and selection; normal/wide settings alignment; visible narrow creation actions; long automation labels; readable task title tokens in light/dark.',
  )
} finally {
  await browser.close()
}
