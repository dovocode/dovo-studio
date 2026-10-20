import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const resolveDir = root + 'packages/studio-ui/'
const mocks = {
  '@dovo/studio-core/state': `import {useState} from 'react';export const useApplicationState=useState;`,
  '@dovo/studio-core': `
    export * from '@dovo/protocol';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const updateTask=async()=>{};
    export const providers={};
    export const resolveTaskAgent=()=>undefined;
    export const acpHarnessName=()=>'';
    export const formatDateTime=value=>String(value);
    export const useWorkspace=()=>window.store;
    export const useWorkspaceSelector=select=>select(window.store);
    export const sameWorkspaceFields=()=>false;
    export const useStudioHost=()=>window.host;
    export const useAppPreferences=()=>window.preferences;
    export const readAppPreferences=()=>window.preferences;
    export const updateAppPreferences=changes=>{Object.assign(window.preferences,changes);window.render()};
    export const useRuntimeReleaseCheck=()=>({releases:[]});
    export const runtimeUpdate=()=>({available:false});
  `,
  '@dovo/studio-ui': `
    export {Button} from './src/components/ui/button';
    export {Tooltip,TooltipTrigger,TooltipContent} from './src/components/ui/tooltip';
    export {IconButton} from './src/components/icon-button';
    export * from './src/components/ui/dialog';
    export {Input} from './src/components/ui/input';
    export {Checkbox} from './src/components/ui/checkbox';
    export {FormField} from './src/components/form-field';
    export {cn} from './src/lib/utils';
    export * as ContextMenu from '@radix-ui/react-context-menu';
    export * as DropdownMenu from '@radix-ui/react-dropdown-menu';
    import * as Menu from '@radix-ui/react-dropdown-menu';
    export {ProjectIcon} from './src/project-icon';
    export * from './src/sidebar-header';
    export * from './src/pull-request-icon';
    export * as Popover from '@radix-ui/react-popover';
    export const MessageResponse=({children})=><div>{children}</div>;
    export const AgentAvatar=()=>null;
    export const useModelLabel=()=>'';
    export const FileTypeIcon=()=>null;
    export const TaskDefaultSettings=()=> <p>Project defaults</p>;
    export const RepositoryOpenItems=({onSelect,disabled,itemClass})=><Menu.Item className={itemClass} disabled={disabled} onSelect={()=>onSelect('zed','Zed')}>Open in Zed</Menu.Item>;
  `,
  '@dovo/extension-scm/projects': 'export const ProjectSettings=()=> <p>Project defaults</p>;',
  '@dovo/extension-scm/repository-actions':
    'export const RepositoryActions=()=> <p>Advanced Git actions</p>;',
  '../dialogs/task-pull-link-dialog': 'export const TaskPullLinkDialog=()=>null;',
  '../dialogs/task-templates-dialog': 'export const TaskTemplatesDialog=()=>null;',
  '../dialogs/saved-prompts-dialog': 'export const SavedPromptsDialog=()=>null;',
  '../dialogs/project-instructions-dialog': 'export const ProjectInstructionsDialog=()=>null;',
}
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {SidebarHeaderLayout,SidebarHeader,HeaderFallback} from './src/sidebar-header';
    import {TooltipProvider} from './src/components/ui/tooltip';
    import {ActivityBar} from '../studio-shell/src/activity-bar';
    import {TitleBar} from '../studio-shell/src/title-bar';
    import {TaskRow} from '../extension-tasks/src/list/task-row';
    import {TaskHeader} from '../extension-tasks/src/detail/task-header';
    import {TaskProjectPanel} from '../extension-tasks/src/detail/task-project-panel';
    import {TaskProjectPopover} from '../extension-tasks/src/detail/task-project-popover';
    import {Popover} from '@dovo/studio-ui';
    import {TaskTools} from '../extension-tasks/src/detail/task-tools';
    import {TaskLinkedPullPanel} from '../extension-tasks/src/detail/task-linked-pull-panel';
    import {TaskWaitingPanel} from '../extension-tasks/src/detail/task-waiting-panel';
    window.preferences={confirmDelete:true,confirmUnpin:false};window.calls=[];window.host={appInfo:{version:'0.0.9',channel:'nightly'},navigate:target=>window.navigation=target,openExternalLink:url=>window.opened=url,openThread:target=>window.openedThread=target};
    const repo={id:'repo',name:'Project',path:'/project',branch:'main'};
    const root=createRoot(document.getElementById('app'));
    let initial={id:'thread',title:'Fix reconnection',repositoryId:'repo',agentId:'',status:'done',createdAt:'2026-10-14',messages:[],files:[{path:'connection.ts',before:'old connection\\nremove timeout\\n',after:'new connection\\nrestore session\\nhandle network switch\\n'}],draft:'',example:false,execution:'worktree',checkoutBranch:'fix/reconnection',turns:[],linkedPullRequests:[{number:7,url:'https://github.com/test/project/pull/7',repositoryUrl:'https://github.com/test/project',title:'Fix iOS reconnection across Wi-Fi switches'},{number:9,url:'https://github.com/test/project/pull/9',repositoryUrl:'https://github.com/test/project',title:'Preserve the runtime session'}],pullStatus:{number:7,url:'https://github.com/test/project/pull/7',state:'open',checks:'passed',checkedAt:''}};
    function App(){
      const [task,setTask]=useState(initial),[panel,setPanel]=useState(false),[surface,setSurface]=useState('chat'),[hideSidebar,setHideSidebar]=useState(false),[toolsWidth,setToolsWidth]=useState(0);window.generalProject=()=>{repo.kind='scratch';repo.name='No project';setPanel(true)};window.hideSidebar=setHideSidebar;window.setToolsWidth=setToolsWidth;
      window.switchThread=()=>setTask(task=>({...task,id:task.id==='other-thread'?'thread':'other-thread',title:task.id==='other-thread'?'Fix reconnection':'Another thread'}));window.setPullState=(state,draft=false)=>setTask(task=>({...task,pullStatus:{...task.pullStatus,state,draft,checks:'failed'}}));
      window.setParent=spawnParent=>setTask(task=>({...task,spawnParent}));window.clearPulls=()=>setTask(task=>({...task,linkedPullRequests:[],pullRequest:undefined,pullStatus:undefined}));
      const request=async(path,input)=>{
        window.calls.push({path,input});
        if(path==='/api/scm/action-state')return {dirty:true,ahead:0,behind:0,tracking:true,canPush:true};
        if(path==='/api/tasks/waiting')return {dependencies:window.stopped?[]:[{kind:'pipeline',repositoryId:'repo',target:'8',label:'Pipeline run 8',project:'Project',url:'https://github.com/test/project/actions/runs/8',status:'in_progress',checkedAt:''}],related:[{label:'PR #7',project:'Project',url:'https://github.com/test/project/pull/7'}]};
        if(path==='/api/workspace'){const updates=Object.fromEntries(Object.entries(input.changes).map(([key,change])=>[key,change.after??undefined]));setTask(t=>({...t,...updates}));return {revision:2,outcome:'applied'};}
        if(path==='/api/tasks/worktree-thread')return {id:'new-thread'};
        if(path==='/api/tasks/title')return {title:'New title'};
        return {ok:true};
      };
      const activeRequest=async(path,input,...rest)=>{if(path==='/api/tasks/waiting'&&input.unlink)window.stopped=true;return request(path,input,...rest)};
      window.store={workspace:{tasks:[task],repositories:[repo],agents:[]},snapshot:{runtimeHost:'Dominic Mac',questions:[],approvals:[],terminals:[],threadBehaviorSupported:true},connection:{address:'http://runtime',token:'token'},activeRuntimeId:'runtime',runtimes:[],connected:true,request:activeRequest,
        runtimeRegistry:{profiles:[]},readRuntime:activeRequest,refreshRuntime:async()=>{},refreshRuntimes:async()=>{},previewTask:async(_,__,___,apply)=>apply(),setWorkspace:()=>{}};
      if(window.cards)return <div style={{width:320,padding:12,background:'var(--sidebar)'}}>{['Project','Mobile app','Runtime','Draft PR'].map((name,i)=><TaskRow key={name} task={{...task,id:name,turns:[{id:'completed',status:'completed',startedAt:'2026-10-14T08:00:00Z',finishedAt:'2026-10-14T08:01:00Z'}],lastViewedTurnId:i%2?'completed':undefined,pullStatus:{...task.pullStatus,state:['open','merged','closed','open'][i],draft:i===3},title:['Fix reconnection across Wi-Fi switches','Keep sidebar state between restarts','Improve pipeline failure handling','Prepare new project layout'][i]}} nestedThreads={i===0?[{key:'child',runtimeId:'runtime',threadId:'child',title:'Review implementation',computerName:'Dominic Mac',phase:'running',online:true,children:[]}]:[]} subagents={i===1?[{id:'native',name:'Native reviewer',provider:'codex',status:'working'}]:[]} selected={i===0} onSelect={()=>window.selectedRow=name} owner={{name:'Dominic Mac',online:true,agents:[],repositories:[{...repo,name}],acpInstallations:[]}} needsInput={false} terminals={0} editable={false} disabled={false} onOpenSubagent={()=>{}}/>)}</div>;
      return <SidebarHeaderLayout collapsed={hideSidebar} onCollapsedChange={setHideSidebar} brand={<TitleBar sidebar platform={window.mobile ? undefined : 'darwin'} online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>}><div className="studio" data-platform={window.mobile ? undefined : 'darwin'}><HeaderFallback><TitleBar platform={window.mobile ? undefined : 'darwin'} section="Threads" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/></HeaderFallback><div style={{display:'flex',minHeight:0,flex:1}}><ActivityBar views={[{id:'tasks',title:'Threads',icon:'tasks'}]} activeId="tasks" onSelect={id=>window.navigation=id}/>{!window.mobile&&<><aside style={{width:300,flexShrink:0,background:'var(--sidebar)',display:hideSidebar?'none':undefined}}><SidebarHeader/></aside></>}<Popover.Root open={panel} onOpenChange={setPanel}><div data-thread-content style={{minWidth:0,flex:1,display:'flex',flexDirection:'column'}}><TaskHeader task={task} compact={window.mobile} surface={surface} onSurface={next=>{window.surface=next;setSurface(next)}} sidebarVisible={true} hasDiff={false} toolsExpanded={false} onTools={()=>{}} bottomTerminalOpen={false} onBottomTerminal={()=>{}} projectPanelOpen={panel} onProjectPanel={()=>setPanel(p=>!p)} onCreate={()=>{}} onDeselect={()=>{}}/>
        <div data-thread-workspace style={{position:'relative',display:'flex',minHeight:0,flex:1,marginRight:window.mobile?0:56}}>
        <div data-project-panel-frame style={{position:'relative',minWidth:0,minHeight:0,flex:1}}>
        <TaskProjectPopover><TaskProjectPanel task={task} onSurface={next=>{window.surface=next;setPanel(false)}} onTerminal={()=>{}}/></TaskProjectPopover>
        {!panel&&<TaskWaitingPanel taskId={task.id}/>}
        </div>
        {!window.mobile&&<aside data-tools-sidebar style={{width:toolsWidth,flexShrink:0}}/>}
        {!window.mobile&&<TaskTools surface={surface} onSelect={setSurface} hasDiff={false} hasLinkedPulls={!!task.linkedPullRequests?.length}/>}
        {surface==='linked-pulls'&&<TaskLinkedPullPanel task={task} onPullLink={url=>{window.selectedPull=url;return true}} onClose={()=>setSurface('chat')}/>}
        </div></div></Popover.Root></div></div></SidebarHeaderLayout>;
    }
    window.render=()=>root.render(<TooltipProvider><App/></TooltipProvider>);window.render();
  `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'project-panel-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
})
const stylesheet = process.env.DOVO_BROWSER_STYLE_PATH
  ? await readFile(process.env.DOVO_BROWSER_STYLE_PATH, 'utf8')
  : (
      await Promise.all(
        (await readdir(root + 'apps/web/dist/client/assets'))
          .filter((name) => name.endsWith('.css'))
          .map((name) => readFile(root + 'apps/web/dist/client/assets/' + name, 'utf8')),
      )
    ).join('\n')
const browser = await chromium.launch({ headless: true })
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 },
    })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent('<div id="app" class="studio"></div>')
    if (stylesheet)
      await page.addStyleTag({
        content:
          stylesheet +
          '#app{height:100dvh;background:var(--background);color:var(--foreground)} [aria-label="Thread pull requests"]{width:min(360px,100%);height:calc(100% - 48px);margin-left:auto} .studio-tools-navigation{position:absolute;right:0;top:52px}.studio-navigation[aria-label="Main navigation"]{width:44px} @media(min-width:600px){[aria-label="Thread pull requests"]{margin-right:56px}}',
      })
    await page.evaluate((mobile) => {
      window.mobile = mobile
    }, mobile)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    assert.equal(await page.locator('.studio-titlebar').count(), 1)
    if (!mobile) {
      const brand = await page.locator('.studio-titlebar').boundingBox()
      const detail = await page.locator('.studio-task-thread-header').boundingBox()
      assert.equal(brand.y, detail.y, 'Brand and thread controls share one top row')
      assert.equal(await page.locator('.studio-titlebar[data-sidebar-brand=true]').count(), 1)
    }
    assert.equal(
      await page.locator('.studio-titlebar-brand img, .studio-titlebar-brand svg').count(),
      0,
    )
    assert.equal(await page.locator('.studio-titlebar-name').textContent(), 'Dovo Studio')
    await page.locator('.studio-titlebar-brand').getByText('Nightly', { exact: true }).waitFor()
    if (stylesheet)
      await page.screenshot({
        path: `/tmp/dovo-shared-header-thread-${mobile ? 'compact' : 'desktop'}.png`,
      })
    const chatWidth = (await page.locator('[data-thread-content]').boundingBox()).width
    await page.getByRole('button', { name: 'Show project panel', exact: true }).click()
    await page.getByRole('dialog', { name: 'Project information', exact: true }).waitFor()
    const popover = await page
      .getByRole('dialog', { name: 'Project information', exact: true })
      .boundingBox()
    assert.ok(popover && popover.width <= 304 && popover.width > 0)
    const frame = await page.locator('[data-project-panel-frame]').boundingBox()
    assert.ok(Math.abs(popover.y - frame.y - 32) < 1)
    assert.ok(Math.abs(frame.x + frame.width - popover.x - popover.width - 32) < 1)
    assert.ok(popover.y + popover.height <= frame.y + frame.height - 32 + 1)
    assert.equal((await page.locator('[data-thread-content]').boundingBox()).width, chatWidth)
    if (!mobile) {
      for (const width of [280, 380, 0]) {
        await page.evaluate((width) => window.setToolsWidth(width), width)
        await page.waitForFunction((width) => {
          const chat = document.querySelector('[data-project-panel-frame]').getBoundingClientRect()
          const panel = document
            .querySelector('[aria-label="Project information"]')
            .getBoundingClientRect()
          const workspace = document
            .querySelector('[data-thread-workspace]')
            .getBoundingClientRect()
          return (
            Math.abs(chat.right - panel.right - 32) < 1 &&
            Math.round(workspace.width - chat.width) === width
          )
        }, width)
        const chat = await page.locator('[data-project-panel-frame]').boundingBox()
        const workspace = await page.locator('[data-thread-workspace]').boundingBox()
        assert.equal(Math.round(workspace.width - chat.width), width)
      }
    }
    assert.equal(
      await page.getByRole('button', { name: 'Close project panel', exact: true }).count(),
      0,
    )
    await page.getByRole('button', { name: 'Hide project panel', exact: true }).click()
    await page
      .getByRole('region', { name: 'Thread project', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Show project panel', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('region', { name: 'Thread project', exact: true }).waitFor()
    await page.locator('[data-thread-content]').click({ position: { x: 10, y: 100 } })
    await page.getByRole('region', { name: 'Thread project', exact: true }).waitFor()
    await page.evaluate(() => window.switchThread())
    await page.getByText('Another thread', { exact: true }).first().waitFor()
    await page.getByRole('region', { name: 'Thread project', exact: true }).waitFor()
    await page.evaluate(() => window.switchThread())

    await page.getByRole('region', { name: 'Thread project', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Project', exact: true }).waitFor()
    assert.equal(await page.locator('.studio-project-path').getAttribute('title'), '/project')
    await page.getByText('Uncommitted changes · Synced', { exact: true }).waitFor()
    await page.getByRole('button', { name: /^Changes · 1 file/ }).waitFor()
    await page.getByRole('button', { name: 'Git actions and pull requests', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Advanced Git actions…', exact: true }).click()
    await page.getByRole('dialog', { name: 'Git & project actions', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page
      .getByRole('dialog', { name: 'Git & project actions', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('dialog', { name: 'Project information', exact: true }).waitFor()
    assert.equal(
      await page
        .locator('.studio-project-card')
        .getByRole('region', { name: 'Related items and watchers' })
        .count(),
      1,
    )
    await page.getByRole('heading', { name: 'Watching', exact: true }).waitFor()
    for (const [state, draft, tone] of [
      ['open', false, 'text-emerald-600'],
      ['merged', false, 'text-violet-600'],
      ['closed', false, 'text-red-600'],
      ['open', true, 'text-muted-foreground'],
    ]) {
      await page.evaluate(([state, draft]) => window.setPullState(state, draft), [state, draft])
      await page.locator('.studio-project-pull svg').first().waitFor()
      await page.waitForFunction(
        (tone) => document.querySelector('.studio-project-pull svg')?.classList.contains(tone),
        tone,
      )
    }
    await page.evaluate(() => window.setPullState('open'))
    await page.getByRole('link', { name: 'Project · PR #7', exact: true }).click()
    assert.equal(await page.evaluate(() => window.opened), 'https://github.com/test/project/pull/7')
    await page.getByRole('button', { name: /Open in…/ }).click()
    await page.getByRole('menuitem', { name: 'Open in Zed', exact: true }).click()
    await page.getByRole('button', { name: 'Open in Zed', exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.find((call) => call.path === '/api/scm/open-folder').input.taskId,
      ),
      'thread',
    )
    if (stylesheet) {
      await page.mouse.move(0, 0)
      await page.screenshot({
        path: `/tmp/dovo-project-panel-${mobile ? 'compact' : 'desktop'}.png`,
      })
      await page
        .locator('.studio-project-card')
        .screenshot({ path: `/tmp/dovo-project-card-${mobile ? 'compact' : 'desktop'}.png` })
      assert.equal(
        await page
          .locator('.studio-project-card')
          .evaluate((element) => getComputedStyle(element).borderRadius),
        '0px',
      )
      assert.equal(
        await page
          .locator('.studio-project-path')
          .evaluate((element) => getComputedStyle(element).fontSize),
        '12px',
      )
    }
    if (stylesheet) {
      const totals = await page.locator('.studio-project-diff').boundingBox()
      const card = await page.locator('.studio-project-card').boundingBox()
      assert.ok(totals && card && card.x + card.width - (totals.x + totals.width) < 30)
    }
    await page.getByRole('button', { name: 'Show 1 more', exact: true }).click()
    await page.getByRole('button', { name: /Preserve the runtime session/ }).waitFor()
    await page.getByRole('button', { name: 'Show less', exact: true }).click()
    await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).click()
    const stopDialog = page.getByRole('dialog', { name: 'Stop watching?', exact: true })
    await stopDialog.getByRole('button', { name: 'Stop watching', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((call) => call.input.unlink))
    await page.getByRole('button', { name: 'Hide project panel', exact: true }).click()
    await page.getByRole('button', { name: 'Thread actions', exact: true }).first().click()
    const menuItems = await page.getByRole('menu').first().getByRole('menuitem').allTextContents()
    assert.ok(
      menuItems.findIndex((label) => label.includes('Rename')) <
        menuItems.findIndex((label) => label.includes('Advanced')),
    )
    assert.ok(
      menuItems.findIndex((label) => label === 'Pin') <
        menuItems.findIndex((label) => label.includes('New thread')),
    )
    assert.ok(menuItems.at(-1).includes('Delete thread'))
    if (stylesheet)
      await page.screenshot({ path: `/tmp/dovo-thread-menu-${mobile ? 'compact' : 'desktop'}.png` })
    await page.getByRole('menuitem', { name: 'Advanced', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: /Auto-archive after settled/ }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: 'Custom period…', exact: true }).focus()
    await page.keyboard.press('Enter')
    if (stylesheet)
      await page.screenshot({
        path: `/tmp/dovo-auto-archive-${mobile ? 'compact' : 'desktop'}.png`,
      })
    await page.getByRole('spinbutton', { name: 'Days in Settled', exact: true }).fill('12')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() =>
      window.calls.some((call) => call.input.changes?.archiveAfterSettledDays?.after === 12),
    )
    await page.getByRole('button', { name: 'Thread actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Advanced', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: /Auto-settle behavior/ }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: 'Never auto-settle', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      window.calls.some(
        (call) => call.input.changes?.settleBehavior?.after?.settleMerged === false,
      ),
    )
    await page.getByRole('button', { name: 'Thread actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'New thread', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page
      .getByRole('menuitem', { name: 'New thread on fix/reconnection', exact: true })
      .click()
    await page.waitForFunction(() => window.navigation?.entityId === 'new-thread')
    await page.getByRole('button', { name: 'Show project panel', exact: true }).click()
    await page.getByRole('button', { name: /^Changes/ }).click()
    assert.equal(await page.evaluate(() => window.surface), 'changes')
    await page
      .getByRole('region', { name: 'Thread project', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Linked PRs', exact: true }).click()
    const pulls = page.getByRole('region', { name: 'Thread pull requests', exact: true })
    await pulls.waitFor()
    assert.equal(await pulls.getByRole('link').count(), 2)
    await pulls.getByRole('link', { name: /Preserve the runtime session/ }).click()
    assert.equal(
      await page.evaluate(() => window.selectedPull),
      'https://github.com/test/project/pull/9',
    )
    if (stylesheet) {
      await page.mouse.move(0, 0)
      await pulls.screenshot({
        path: `/tmp/dovo-linked-pr-panel-${mobile ? 'compact' : 'desktop'}.png`,
      })
    }
    await page.getByRole('button', { name: 'Close linked pull requests', exact: true }).click()
    assert.equal(await pulls.count(), 0)
    await page.evaluate(() => window.clearPulls())
    await page.getByRole('button', { name: 'Linked PRs', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: 'Linked PRs', exact: true }).count(), 0)
    if (!mobile) {
      await page.getByRole('button', { name: 'Threads', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('.studio-titlebar'))
      assert.equal(
        await page.getByRole('navigation', { name: 'Main navigation', exact: true }).isVisible(),
        true,
      )
      assert.equal(
        await page.getByRole('button', { name: 'Hide left sidebar', exact: true }).count(),
        0,
      )
      if (stylesheet) await page.screenshot({ path: '/tmp/dovo-header-thread-sidebar-hidden.png' })
      await page.getByRole('button', { name: 'Threads', exact: true }).click()
      await page.locator('.studio-titlebar[data-sidebar-brand=true]').waitFor()
    }
    // Parent navigation shares the existing header and retains both ends of long names.
    const parentTitle = 'Improve Dovo Studio’s Website Design and Add New Features'
    await page.evaluate(
      (title) =>
        window.setParent({
          runtimeId: 'parent-identity',
          threadId: 'parent-thread',
          title,
        }),
      parentTitle,
    )
    const breadcrumb = page
      .getByRole('navigation', { name: 'Thread breadcrumb', exact: true })
      .filter({ visible: true })
    const parent = breadcrumb.getByRole('button', {
      name: `Open parent thread ${parentTitle}`,
      exact: true,
    })
    await parent.click()
    assert.deepEqual(await page.evaluate(() => window.openedThread), {
      runtimeId: 'parent-identity',
      runtimeIdentity: 'parent-identity',
      threadId: 'parent-thread',
      title: parentTitle,
    })
    for (const width of mobile ? [390, 320, 390, 320] : [1200, 900, 1200, 900]) {
      await page.setViewportSize({ width, height: 900 })
      // Crossing the compact breakpoint reparents HeaderContent through a portal. Resolve
      // and measure the live header in one browser task so React cannot detach it between calls.
      const measured = await page.waitForFunction(() => {
        const element = [...document.querySelectorAll('nav[aria-label="Thread breadcrumb"]')].find(
          (node) => node.getBoundingClientRect().width > 0,
        )
        if (!element) return null
        const parent = element.querySelector('.studio-titlebar-parent')
        const start = parent.querySelector('.studio-titlebar-parent-start')
        const suffix = parent.querySelector('.studio-titlebar-parent-end')
        const rect = (node) => {
          const b = node.getBoundingClientRect()
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }
        }
        return {
          nav: rect(element),
          parent: rect(parent),
          current: rect(element.querySelector('[aria-current="page"]')),
          suffix: rect(suffix),
          truncated: start.scrollWidth > start.clientWidth,
          ellipsis: getComputedStyle(start).textOverflow,
          end: suffix.textContent,
        }
      })
      const bounds = await measured.jsonValue()
      await measured.dispose()
      assert.equal(bounds.truncated, true, JSON.stringify({ mobile, width, bounds }))
      assert.equal(bounds.ellipsis, 'ellipsis')
      assert.ok(bounds.end.endsWith('New Features'))
      assert.ok(bounds.parent.right <= bounds.nav.right)
      assert.ok(bounds.current.right <= bounds.nav.right + 1)
      assert.ok(bounds.current.left >= bounds.parent.right)
      assert.ok(Math.abs(bounds.current.top - bounds.parent.top) < 4)
      if (stylesheet) await page.screenshot({ path: `/tmp/dovo-thread-breadcrumb-${width}.png` })
    }
    await page.evaluate(() =>
      window.setParent({
        runtimeId: 'parent-identity',
        threadId: 'parent-thread',
        title: 'Parent',
      }),
    )
    await page
      .getByRole('button', { name: 'Open parent thread Parent', exact: true })
      .filter({ visible: true })
      .waitFor()
    assert.equal(await breadcrumb.locator('.studio-titlebar-parent').textContent(), 'Parent')
    assert.equal(
      await breadcrumb
        .locator('.studio-titlebar-parent')
        .evaluate((element) =>
          [...element.children].every((child) => child.scrollWidth <= child.clientWidth),
        ),
      true,
    )
    await page.evaluate(() => window.setParent(undefined))
    assert.equal(await breadcrumb.locator('.studio-titlebar-parent').count(), 0)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 })
    await page.evaluate(() => window.generalProject())
    const generalProject = page.getByRole('region', { name: 'Thread project', exact: true })
    await generalProject.getByRole('heading', { name: 'General', exact: true }).waitFor()
    assert.equal(await generalProject.locator('.studio-project-path').count(), 0)
    await generalProject.getByRole('button', { name: 'Link projects', exact: true }).click()
    await page.waitForFunction(() => window.surface === 'projects')
    await generalProject.waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Compact' : 'Desktop'} thread menu/project panel: custom archive period, settle override, editor, branch reuse, related links and watcher removal passed`,
    )
    await page.close()
  }
  if (stylesheet)
    for (const scheme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 340, height: 380 } })
      await page.setContent('<div id="app" class="studio"></div>')
      await page.addStyleTag({ content: stylesheet + 'body{margin:0;background:var(--sidebar)}' })
      await page.evaluate((scheme) => {
        window.cards = true
        document.documentElement.dataset.theme = scheme
        document.documentElement.classList.toggle('dark', scheme === 'dark')
      }, scheme)
      await page.addScriptTag({ content: built.outputFiles[0].text })
      await page.locator('.studio-thread-card-context').first().waitFor()
      assert.equal(await page.locator('.studio-thread-card-context').count(), 8)
      assert.equal(
        await page.locator('.studio-thread-card-context > span.text-emerald-400').count(),
        4,
      )
      const toggle = page.getByRole('button', {
        name: 'Subthreads for Fix reconnection across Wi-Fi switches',
        exact: true,
      })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(
        await page.getByRole('button', { name: 'Open child thread Review implementation' }).count(),
        0,
      )
      const bottomRow = page.locator('.studio-thread-card-context').nth(1)
      const toggleBounds = await toggle.boundingBox()
      const rowBounds = await bottomRow.boundingBox()
      assert.ok(
        toggleBounds.y >= rowBounds.y - 4 && toggleBounds.y < rowBounds.y + rowBounds.height,
      )
      await page.screenshot({ path: `/tmp/dovo-thread-cards-${scheme}.png` })
      await toggle.click()
      await page.getByRole('button', { name: 'Open child thread Review implementation' }).waitFor()
      assert.equal(await page.evaluate(() => window.selectedRow), undefined)
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
      await page.screenshot({ path: `/tmp/dovo-subthreads-expanded-${scheme}.png` })
      await toggle.click()
      assert.equal(
        await page.getByRole('button', { name: 'Open child thread Review implementation' }).count(),
        0,
      )
      const nativeToggle = page.getByRole('button', {
        name: 'Subthreads for Keep sidebar state between restarts',
        exact: true,
      })
      assert.equal(await page.getByText('Native reviewer · codex', { exact: true }).count(), 0)
      await nativeToggle.click()
      await page.getByText('Native reviewer · codex', { exact: true }).waitFor()
      assert.equal(await page.locator('button button').count(), 0)
      await page.close()
    }
} finally {
  await browser.close()
}
