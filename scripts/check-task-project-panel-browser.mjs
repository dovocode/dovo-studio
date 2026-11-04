import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const resolveDir = root + 'packages/studio-ui/'
const mocks = {
  '../chat/thread-sharing':
    'export const ThreadSharing=({taskId})=><button data-share-task={taskId}>Share thread</button>;',
  // Snapshot previews have their own browser suite; this fixture exercises thread navigation.
  '../../detail/side-thread-changes': 'export const ReviewSideThreadChangesButton=()=>null;',
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export const useApplicationState=useState;`,
  '@dovo/studio-core': `export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;
    export * from '@dovo/protocol';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const updateTask=async()=>{};
    export const providers={};
    export const resolveTaskAgent=()=>undefined;
    export const acpHarnessName=()=>'';
    export const formatDateTime=value=>String(value);
    export const useWorkspace=()=>window.store;
    export const WorkspaceScope=({children})=>children;
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
  '@dovo/extension-scm/project-transfer': 'export const ProjectTransferDialog=()=>null;',
  '@dovo/extension-scm/projects': 'export const ProjectSettings=()=> <p>Project defaults</p>;',
  '@dovo/extension-scm/repository-actions': `import {useState} from 'react';export function RepositoryActions({onReviewChange}){const [fixture,setFixture]=useState({dirty:true,long:false});window.setGitFixture=changes=>setFixture(previous=>({...previous,...changes}));return <div data-git-changes={fixture.dirty} style={{minHeight:fixture.long?1400:undefined}}><p>Advanced Git actions</p><button onClick={()=>onReviewChange(true)}>Review fixture file</button><button onClick={()=>onReviewChange(false)}>Back to staging fixture</button></div>}`,
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
    import {useState,useRef} from 'react';
    import {SidebarHeaderLayout,SidebarHeader,HeaderFallback} from './src/sidebar-header';
    import {TooltipProvider} from './src/components/ui/tooltip';
    import {ActivityBar} from '../studio-shell/src/activity-bar';
    import {TitleBar} from '../studio-shell/src/title-bar';
    import {TaskRow} from '../extension-tasks/src/list/task-row';
    import {TaskHeader} from '../extension-tasks/src/detail/task-header';
    import {TaskProjectPanel} from '../extension-tasks/src/detail/task-project-panel';
    import {TaskProjectPopover,TaskProjectPanelRoot} from '../extension-tasks/src/detail/task-project-popover';
    import {Popover} from '@dovo/studio-ui';
    import {TaskTools} from '../extension-tasks/src/detail/task-tools';
    import {TaskLinkedPullPanel} from '../extension-tasks/src/detail/task-linked-pull-panel';
    window.gitState={branch:'fix/reconnection',dirty:true,ahead:0,behind:0,tracking:true,canPush:true};window.setGitState=state=>{window.gitState={branch:'fix/reconnection',...state};document.dispatchEvent(new Event('visibilitychange'))};window.preferences={confirmDelete:true,confirmUnpin:false,threadInfoSections:{}};window.calls=[];window.clientOpens=[];window.host={repositoryOpener:{open:async input=>window.clientOpens.push(input)},appInfo:{version:'0.0.9',channel:'nightly'},navigate:target=>window.navigation=target,openExternalLink:url=>window.opened=url,openThread:target=>window.openedThread=target};
    const repo={id:'repo',name:'Project',path:'/project',branch:'main'};
    const root=createRoot(document.getElementById('app'));
    let initial={id:'thread',title:'Fix reconnection',repositoryId:'repo',agentId:'',status:'done',createdAt:'2026-10-14',messages:[],files:[{path:'connection.ts',before:'old connection\\nremove timeout\\n',after:'new connection\\nrestore session\\nhandle network switch\\n'}],draft:'',example:false,execution:'worktree',checkoutBranch:'fix/reconnection',turns:[],linkedPullRequests:[{number:7,url:'https://github.com/test/project/pull/7',repositoryUrl:'https://github.com/test/project',title:'Fix iOS reconnection across Wi-Fi switches'},{number:9,url:'https://github.com/test/project/pull/9',repositoryUrl:'https://github.com/test/project',title:'Preserve the runtime session'}],pullStatus:{number:7,url:'https://github.com/test/project/pull/7',state:'open',checks:'passed',checkedAt:''}};
    window.lineage=[];
    function App(){
      const [task,setTask]=useState(initial),[panel,setPanel]=useState(false),[surface,setSurface]=useState('chat'),[hideSidebar,setHideSidebar]=useState(false),[toolsWidth,setToolsWidth]=useState(0),[bottomTerminal,setBottomTerminal]=useState(false);const lastTool=useRef('files');const selectSurface=next=>{window.surface=next;if(next!=='chat'&&next!=='terminal')lastTool.current=next;setSurface(next)};window.generalProject=()=>{repo.kind='scratch';repo.name='No project';setPanel(true)};window.hideSidebar=setHideSidebar;window.setToolsWidth=setToolsWidth;
      window.setLineage=enabled=>{window.lineage=enabled?[{...task,id:'child-review',title:'Review browser',spawnParent:{runtimeId:'runtime',threadId:task.id},subagents:[{id:'native-review',name:'Native reviewer',provider:'codex',status:'working'}]},{...task,id:'grandchild',title:'Check page menus',spawnParent:{runtimeId:'runtime',threadId:'child-review'}}]:[];setTask(task=>({...task}))};
      window.setToolContent=(subagents,artifacts,watches=[])=>{window.savedArtifacts=artifacts;setTask(task=>({...task,subagents,threadWatches:watches,status:task.status==='done'?'draft':'done'}))};
      window.switchThread=()=>setTask(task=>({...task,id:task.id==='other-thread'?'thread':'other-thread',title:task.id==='other-thread'?'Fix reconnection':'Another thread'}));window.setPullState=(state,draft=false)=>setTask(task=>({...task,pullStatus:{...task.pullStatus,state,draft,checks:'failed'}}));
      window.setParent=spawnParent=>setTask(task=>({...task,spawnParent}));window.setContextUsage=contextUsage=>setTask(task=>({...task,contextUsage}));window.clearPulls=()=>setTask(task=>({...task,linkedPullRequests:[],pullRequest:undefined,pullStatus:undefined}));window.clearFiles=()=>setTask(task=>({...task,files:[]}));window.setProjectActions=actions=>{repo.actions=actions;setTask(task=>({...task}))};
      const request=async(path,input)=>{
        window.calls.push({path,input});
        if(path==='/api/scm/open-location')return {path:'/remote/worktree',runtimeId:'remote',sshAddress:'ssh://dominic@runtime',kind:'folder'};
        if(path==='/api/artifacts/list')return {artifacts:window.savedArtifacts??[],links:[]};
        if(path==='/api/scm/action-state')return window.gitState;
        if(path==='/api/terminals/run')return {id:'project-action-terminal'};
        if(path==='/api/tasks/waiting')return {dependencies:window.stopped?[]:[{kind:'pipeline',repositoryId:'repo',target:'8',label:'Pipeline run 8',project:'Project',url:'https://github.com/test/project/actions/runs/8',status:'in_progress',checkedAt:''}],related:[{label:'PR #7',project:'Project',url:'https://github.com/test/project/pull/7'}]};
        if(path==='/api/workspace'){const updates=Object.fromEntries(Object.entries(input.changes).map(([key,change])=>[key,change.after??undefined]));setTask(t=>({...t,...updates}));return {revision:2,outcome:'applied'};}
        if(path==='/api/tasks/worktree-thread')return {id:'new-thread'};
        if(path==='/api/tasks/title')return {title:'New title'};
        return {ok:true};
      };
      const activeRequest=async(path,input,...rest)=>{if(path==='/api/tasks/waiting'&&input.unlink)window.stopped=true;return request(path,input,...rest)};
      window.store={workspace:{tasks:[task,...window.lineage],repositories:[repo],agents:[]},snapshot:{runtimeHost:'Dominic Mac',questions:[],approvals:[],terminals:[],threadBehaviorSupported:true},connection:{address:'http://runtime',token:'token'},activeRuntimeId:'runtime',runtimes:[],connected:true,request:activeRequest,
        runtimeRegistry:{profiles:[]},readRuntime:activeRequest,refreshRuntime:async()=>{},refreshRuntimes:async()=>{},previewTask:async(_,__,___,apply)=>apply(),setWorkspace:()=>{}};
      if(window.cards)return <div style={{width:320,padding:12,background:'var(--sidebar)'}}>{['Project','Mobile app','Runtime','Draft PR'].map((name,i)=><TaskRow key={name} task={{...task,id:name,turns:[{id:'completed',status:'completed',startedAt:'2026-10-14T08:00:00Z',finishedAt:'2026-10-14T08:01:00Z'}],lastViewedTurnId:i%2?'completed':undefined,pullStatus:{...task.pullStatus,state:['open','merged','closed','open'][i],draft:i===3},subagents:i===1?[{id:'native',name:'Native reviewer',provider:'claude',status:'working'}]:[],title:['Fix reconnection across Wi-Fi switches','Keep sidebar state between restarts','Improve pipeline failure handling','Prepare new project layout'][i]}} thread={i===0?{key:name,runtimeId:'runtime',threadId:name,title:'Fix reconnection across Wi-Fi switches',computerName:'Dominic Mac',phase:'completed',online:true,paused:false,children:[{key:'child',runtimeId:'runtime',threadId:'child',title:'Review implementation',computerName:'Dominic Mac',phase:'running',online:true,paused:false,children:[]}]}:undefined} selected={i===0} onSelect={()=>window.selectedRow=name} owner={{name:'Dominic Mac',online:true,agents:[],repositories:[{...repo,name}],acpInstallations:[]}} needsInput={false} terminals={0} editable={false} disabled={false}/>)}</div>;
      return <SidebarHeaderLayout collapsed={hideSidebar} onCollapsedChange={setHideSidebar} brand={<TitleBar sidebar platform={window.mobile ? undefined : 'darwin'} online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>}><div className="studio" data-platform={window.mobile ? undefined : 'darwin'}><HeaderFallback><TitleBar platform={window.mobile ? undefined : 'darwin'} section="Threads" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/></HeaderFallback><div style={{display:'flex',minHeight:0,flex:1}}><ActivityBar views={[{id:'tasks',title:'Threads',icon:'tasks'}]} activeId="tasks" onSelect={id=>window.navigation=id}/>{!window.mobile&&<><aside style={{width:300,flexShrink:0,background:'var(--sidebar)',display:hideSidebar?'none':undefined}}><SidebarHeader/></aside></>}<TaskProjectPanelRoot open={panel} onOpenChange={setPanel}><div data-thread-content style={{minWidth:0,flex:1,display:'flex',flexDirection:'column'}}><TaskHeader task={task} compact={window.mobile} surface={surface} onSurface={selectSurface} sidebarVisible={true} hasDiff={false} projectPanelOpen={panel} onProjectPanel={()=>setPanel(p=>!p)} onCreate={()=>{}} onDeselect={()=>{}}/>
        <div data-thread-workspace style={{position:'relative',display:'flex',minHeight:0,flex:1,marginRight:window.mobile?0:56}}>
        <div data-project-panel-frame data-info-open={panel||undefined} style={{position:'relative',minWidth:0,minHeight:0,flex:1}}>
        <TaskProjectPopover><TaskProjectPanel task={task} onSurface={next=>{window.surface=next;setPanel(false)}} onTerminal={()=>{}}/></TaskProjectPopover>
        </div>
        {!window.mobile&&<aside data-tools-sidebar style={{width:toolsWidth,flexShrink:0}}/>}
        {!window.mobile&&<TaskTools task={task} artifactsEnabled surface={surface} onSelect={next=>selectSurface(next===surface?'chat':next)} hasDiff={task.files.length>0} hasLinkedPulls={!!task.linkedPullRequests?.length} onTools={()=>selectSurface(surface==='chat'?lastTool.current:'chat')} bottomTerminalOpen={bottomTerminal} onBottomTerminal={()=>setBottomTerminal(value=>!value)}/>}
        {surface==='linked-pulls'&&<TaskLinkedPullPanel task={task} onPullLink={url=>{window.selectedPull=url;return true}} onClose={()=>setSurface('chat')}/>}
        </div></div></TaskProjectPanelRoot></div></div></SidebarHeaderLayout>;
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
          '#app{height:100dvh;background:var(--background);color:var(--foreground)} [aria-label="Thread pull requests"]{width:min(360px,100%);height:calc(100% - 48px);margin-left:auto} .studio-tools-navigation{position:absolute;right:-56px;top:0;bottom:0} @media(min-width:600px){[aria-label="Thread pull requests"]{margin-right:56px}}',
      })
    await page.evaluate((mobile) => {
      window.mobile = mobile
    }, mobile)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (!mobile) {
      const tools = page.getByRole('navigation', { name: 'Thread tools' })
      await page.waitForFunction(() =>
        window.calls.some((call) => call.path === '/api/artifacts/list'),
      )
      assert.equal(await tools.getByRole('button', { name: 'Agents', exact: true }).count(), 0)
      assert.equal(await tools.getByRole('button', { name: 'Artifacts', exact: true }).count(), 0)
      await page.evaluate(() =>
        window.setToolContent(
          [{ id: 'native', name: 'Reviewer', provider: 'codex', status: 'completed' }],
          [{ id: 'saved' }],
        ),
      )
      await tools.getByRole('button', { name: 'Agents', exact: true }).waitFor()
      assert.equal(
        await tools
          .getByRole('button', { name: 'Agents', exact: true })
          .locator('[data-tool-count]')
          .textContent(),
        '1',
      )
      await tools.getByRole('button', { name: 'Artifacts', exact: true }).waitFor()
      await page.evaluate(() =>
        window.setToolContent(
          [],
          [],
          [{ relation: 'spawned', runtimeId: 'remote', threadId: 'child', status: 'watching' }],
        ),
      )
      await tools
        .getByRole('button', { name: 'Artifacts', exact: true })
        .waitFor({ state: 'detached' })
      assert.equal(await tools.getByRole('button', { name: 'Agents', exact: true }).count(), 1)
      await page.evaluate(() => window.setToolContent([], []))
      await tools
        .getByRole('button', { name: 'Agents', exact: true })
        .waitFor({ state: 'detached' })

      const files = tools.getByRole('button', { name: 'Files', exact: true })
      await files.click()
      assert.equal(await files.getAttribute('aria-pressed'), 'true')
      if (stylesheet) {
        await page.evaluate(() => {
          document.documentElement.dataset.theme = 'dark'
          document.documentElement.classList.add('dark')
        })
        const style = await files.evaluate((button) => {
          const style = getComputedStyle(button)
          return {
            radius: style.borderRadius,
            shadow: style.boxShadow,
            fill: style.backgroundColor,
          }
        })
        assert.equal(style.radius, '6px')
        assert.equal(style.shadow, 'none')
        assert.equal(style.fill, 'rgba(0, 0, 0, 0)')
        assert.notEqual(
          await files.evaluate((button) => getComputedStyle(button, '::before').backgroundColor),
          'rgba(0, 0, 0, 0)',
        )
        assert.equal((await tools.boundingBox()).width, 44)
        const previews = await tools.getByRole('group', { name: 'Previews' }).boundingBox()
        const rail = await tools.boundingBox()
        assert.ok(
          rail.y + rail.height - previews.y - previews.height < 16,
          'Previews anchor to the rail footer',
        )
        await page.screenshot({ path: '/tmp/dovo-right-sidebar-dark.png', animations: 'disabled' })
        await page.evaluate(() => {
          document.documentElement.dataset.themeGlow = '0'
          document.documentElement.dataset.themeGradients = 'false'
        })
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector('[aria-label="Files"]')).boxShadow === 'none',
        )
        assert.equal(
          await files.evaluate((button) => getComputedStyle(button).backgroundImage),
          'none',
        )
        await page.evaluate(() => {
          delete document.documentElement.dataset.themeGlow
          delete document.documentElement.dataset.themeGradients
          document.documentElement.classList.remove('dark')
          document.documentElement.dataset.theme = 'light'
        })
        await page.screenshot({ path: '/tmp/dovo-right-sidebar-light.png', animations: 'disabled' })
        await page.evaluate(() => {
          document.documentElement.classList.add('dark')
          document.documentElement.dataset.theme = 'dark'
        })
        // All conditional tools remain usable in a short desktop window.
        await page.evaluate(() =>
          window.setToolContent(
            [{ id: 'native', name: 'Reviewer', provider: 'codex', status: 'completed' }],
            [{ id: 'saved' }],
          ),
        )
        await tools.getByRole('button', { name: 'Artifacts', exact: true }).waitFor()
        await page.setViewportSize({ width: 1200, height: 320 })
        await tools.getByRole('button', { name: 'Devices', exact: true }).click()
        await files.click()
        assert.equal(await files.getAttribute('aria-pressed'), 'true')
        await page.setViewportSize({ width: 1200, height: 900 })
        await tools.evaluate((rail) => {
          rail.scrollTop = 0
        })
        await page.evaluate(() => window.setToolContent([], []))
        await tools
          .getByRole('button', { name: 'Artifacts', exact: true })
          .waitFor({ state: 'detached' })
      }
      await tools.getByRole('button', { name: 'Hide tools pane', exact: true }).click()
      await page.waitForFunction(() => window.surface === 'chat')
    }
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
    assert.ok(
      (
        await page
          .locator('[data-thread-content] header')
          .filter({ visible: true })
          .first()
          .innerText()
      ).includes('Project'),
    )
    // The visible desktop rail owns tool navigation; compact layouts retain the title menu.
    await page.getByRole('button', { name: 'Thread actions', exact: true }).first().click()
    const firstMenu = page.getByRole('menu').first()
    if (mobile) {
      assert.equal(
        await firstMenu
          .getByRole('menuitem', { name: 'Chat', exact: true })
          .getAttribute('aria-current'),
        'page',
      )
      for (const name of ['Files', 'Devices', 'Terminal', 'Side chats'])
        assert.equal(await firstMenu.getByRole('menuitem', { name, exact: true }).count(), 1)
      await firstMenu.getByRole('menuitem', { name: 'Devices', exact: true }).click()
      await page.waitForFunction(() => window.surface === 'devices')
      await page.getByRole('button', { name: 'Thread actions', exact: true }).first().click()
      await page
        .getByRole('menu')
        .first()
        .getByRole('menuitem', { name: 'Chat', exact: true })
        .click()
      await page.waitForFunction(() => window.surface === 'chat')
    } else {
      for (const name of ['Chat', 'Files', 'Devices', 'Terminal', 'Side chats'])
        assert.equal(await firstMenu.getByRole('menuitem', { name, exact: true }).count(), 0)
      await firstMenu.getByRole('menuitem', { name: 'Rename…', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      const header = page.locator('.studio-task-thread-header')
      assert.equal(
        await header.getByRole('button').count(),
        2,
        'Header contains title actions and thread info',
      )
      assert.equal(
        await header.locator('[data-thread-info-branch]').textContent(),
        'fix/reconnection',
      )
      assert.ok((await header.locator('[data-thread-info-state]').textContent()).length > 0)
      assert.equal(await header.getByRole('button', { name: 'Show tools pane' }).count(), 0)
      assert.equal(await header.getByRole('button', { name: 'Show bottom terminal' }).count(), 0)
      const tools = page.getByRole('navigation', { name: 'Thread tools' })
      assert.equal(
        await tools
          .getByRole('button', { name: 'Linked PRs', exact: true })
          .locator('[data-tool-count]')
          .textContent(),
        '2',
      )
      assert.equal(
        await tools
          .getByRole('button', { name: 'Diff', exact: true })
          .locator('[data-tool-count]')
          .textContent(),
        '1',
      )
      await tools.getByRole('button', { name: 'Devices', exact: true }).click()
      await tools.getByRole('button', { name: 'Hide tools pane', exact: true }).click()
      await page.waitForFunction(() => window.surface === 'chat')
      await tools.getByRole('button', { name: 'Show tools pane', exact: true }).click()
      await page.waitForFunction(() => window.surface === 'devices')
      await tools.getByRole('button', { name: 'Hide tools pane', exact: true }).click()
      await tools.getByRole('button', { name: 'Show bottom terminal', exact: true }).click()
      assert.equal(
        await tools
          .getByRole('button', { name: 'Hide bottom terminal', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      )
      await tools.getByRole('button', { name: 'Hide bottom terminal', exact: true }).click()
      await page.waitForFunction(() => window.surface === 'chat')
    }
    const chatWidth = (await page.locator('[data-thread-content]').boundingBox()).width
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.getByRole('dialog', { name: 'Thread info', exact: true }).waitFor()
    const info = page.getByRole('dialog', { name: 'Thread info', exact: true })
    await info.getByRole('button', { name: 'Share thread', exact: true }).waitFor()
    assert.equal(await info.getByRole('region', { name: 'Context usage', exact: true }).count(), 0)
    await page.evaluate(() =>
      window.setContextUsage({ used: 170000, limit: 200000, updatedAt: new Date().toISOString() }),
    )
    await info.getByText('85% used', { exact: true }).waitFor()
    assert.equal(
      await info.getByRole('meter', { name: 'Agent context used' }).getAttribute('aria-valuenow'),
      '85',
    )
    const infoBounds = await info.boundingBox()
    await info.getByRole('button', { name: 'Customize thread info', exact: true }).click()
    const customization = page.getByRole('menu', { name: 'Customize thread info', exact: true })
    await customization.waitFor()
    const customizationBounds = await customization.boundingBox()
    assert.ok(infoBounds && customizationBounds)
    for (const dimension of ['x', 'y', 'width'])
      assert.ok(
        Math.abs(infoBounds[dimension] - customizationBounds[dimension]) <= 1,
        JSON.stringify({ dimension, infoBounds, customizationBounds, mobile }),
      )
    assert.ok(customizationBounds.height >= infoBounds.height - 1)
    assert.equal(await customization.getByRole('menuitemcheckbox').count(), 13)
    await page.getByRole('menuitem', { name: 'Move Context usage up', exact: true }).click()
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('[data-thread-info-section]')).map(
        (node) => node.dataset.threadInfoSection,
      )
      return nodes.indexOf('usage') < nodes.indexOf('lineage')
    })
    const reordered = await page
      .locator('[data-thread-info-section]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.threadInfoSection))
    assert.ok(reordered.indexOf('usage') < reordered.indexOf('lineage'))
    await page.getByRole('menuitem', { name: 'Move Context usage up', exact: true }).click()
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('[data-thread-info-section]')).map(
        (node) => node.dataset.threadInfoSection,
      )
      return nodes.indexOf('usage') < nodes.indexOf('activity')
    })
    const reorderedAgain = await page
      .locator('[data-thread-info-section]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.threadInfoSection))
    assert.ok(reorderedAgain.indexOf('usage') < reorderedAgain.indexOf('activity'))
    const contextChoice = page.getByRole('menuitemcheckbox', { name: 'Context usage', exact: true })
    await contextChoice.click()
    assert.equal(await contextChoice.getAttribute('aria-checked'), 'false')
    await page.keyboard.press('Escape')
    assert.equal(
      await info
        .getByRole('button', { name: 'Customize thread info', exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    )
    await info
      .getByRole('region', { name: 'Context usage', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Hide thread info', exact: true }).click()
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    assert.equal(await info.getByRole('region', { name: 'Context usage', exact: true }).count(), 0)
    await info.getByRole('button', { name: 'Customize thread info', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Reset to default', exact: true }).click()
    await info.getByText('85% used', { exact: true }).waitFor()

    await info.getByRole('button', { name: 'Customize thread info', exact: true }).click()
    const sectionChoices = page.getByRole('menuitemcheckbox')
    for (let index = 0; index < (await sectionChoices.count()); index++)
      await sectionChoices.nth(index).click()
    await page.keyboard.press('Escape')
    assert.equal(
      await info.getByRole('button', { name: 'Customize thread info', exact: true }).isVisible(),
      true,
    )
    assert.equal(await info.getByRole('region', { name: 'Context usage', exact: true }).count(), 0)
    await info.getByRole('button', { name: 'Customize thread info', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Reset to default', exact: true }).click()
    const customizeTrigger = info.getByRole('button', {
      name: 'Customize thread info',
      exact: true,
    })
    await customizeTrigger.focus()
    await page.keyboard.press('Enter')
    await customization.waitFor()
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Done customizing thread info',
    )
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('role') === 'menuitemcheckbox',
    )
    await page.keyboard.press('Escape')
    await customization.waitFor({ state: 'hidden' })
    await customizeTrigger.click()
    await page.getByRole('menuitem', { name: 'Done customizing thread info', exact: true }).click()
    await customization.waitFor({ state: 'hidden' })
    await customizeTrigger.click()
    const threadBounds = await page.locator('[data-thread-content]').boundingBox()
    await page.mouse.click(threadBounds.x + 10, threadBounds.y + 100)
    await customization.waitFor({ state: 'hidden' })
    await info.waitFor()
    await page.evaluate(() => window.setLineage(true))
    const lineage = page.getByRole('region', { name: 'Agent lineage', exact: true })
    await lineage.getByText('Check page menus', { exact: true }).waitFor()
    await lineage.getByText('Native reviewer', { exact: true }).waitFor()
    await lineage.getByRole('button', { name: /Review browser/ }).click()
    assert.equal(await page.evaluate(() => window.openedThread.threadId), 'child-review')
    await page.evaluate(() => window.setLineage(false))
    const popover = await page
      .getByRole('dialog', { name: 'Thread info', exact: true })
      .boundingBox()
    assert.ok(popover && popover.width <= 376 && popover.width > 0)
    const frame = await page.locator('[data-project-panel-frame]').boundingBox()
    const inset = 32
    assert.ok(
      Math.abs(popover.y - frame.y - inset) < 1,
      JSON.stringify({ popover, frame, inset, mobile }),
    )
    assert.ok(Math.abs(frame.x + frame.width - popover.x - popover.width - inset) < 1)
    assert.ok(popover.y + popover.height <= frame.y + frame.height - inset + 1)
    assert.equal((await page.locator('[data-thread-content]').boundingBox()).width, chatWidth)
    if (!mobile) {
      for (const width of [280, 380, 0]) {
        await page.evaluate((width) => window.setToolsWidth(width), width)
        await page
          .waitForFunction((width) => {
            const chat = document
              .querySelector('[data-project-panel-frame]')
              .getBoundingClientRect()
            const panel = document
              .querySelector('[aria-label="Thread info"]')
              .getBoundingClientRect()
            const workspace = document
              .querySelector('[data-thread-workspace]')
              .getBoundingClientRect()
            return (
              Math.abs(chat.right - panel.right - 32) < 1 &&
              Math.round(workspace.width - chat.width) === width
            )
          }, width)
          .catch(async (error) => {
            console.error(
              await page.evaluate(() => {
                const frame = document.querySelector('[data-project-panel-frame]')
                const panel = document.querySelector('[role="dialog"][aria-label="Thread info"]')
                const workspace = document.querySelector('[data-thread-workspace]')
                return {
                  frame: frame.getBoundingClientRect().toJSON(),
                  panel: panel.getBoundingClientRect().toJSON(),
                  workspace: workspace.getBoundingClientRect().toJSON(),
                  docked: frame.dataset.infoDocked,
                }
              }),
            )
            throw error
          })
        const chat = await page.locator('[data-project-panel-frame]').boundingBox()
        const workspace = await page.locator('[data-thread-workspace]').boundingBox()
        assert.equal(Math.round(workspace.width - chat.width), width)
      }
    }
    assert.equal(
      await page.getByRole('button', { name: 'Close project panel', exact: true }).count(),
      0,
    )
    await page.getByRole('button', { name: 'Hide thread info', exact: true }).click()
    await page
      .getByRole('region', { name: 'Thread info', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.keyboard.press('Escape')
    await page
      .getByRole('region', { name: 'Thread info', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.getByRole('button', { name: 'Close thread info', exact: true }).click()
    await page
      .getByRole('region', { name: 'Thread info', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.locator('[data-thread-content]').click({ position: { x: 10, y: 100 } })
    await page.getByRole('region', { name: 'Thread info', exact: true }).waitFor()
    await page.evaluate(() => window.switchThread())
    await page.getByText('Another thread', { exact: true }).first().waitFor()
    await page.getByRole('region', { name: 'Thread info', exact: true }).waitFor()
    await page.evaluate(() => window.switchThread())

    await page.getByRole('region', { name: 'Thread info', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Project', exact: true }).waitFor()
    assert.equal(await page.locator('.studio-project-path').getAttribute('title'), '/project')
    await page.getByText('Uncommitted changes · Synced', { exact: true }).waitFor()
    await info
      .locator('.studio-thread-primary-action')
      .getByText('Commit & push', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: /^Changes · 1 file/ }).waitFor()
    await info.getByRole('button', { name: 'Project actions', exact: true }).click()
    const runActions = page.getByRole('group', { name: 'Run actions', exact: true })
    const projectSetup = page.getByRole('group', { name: 'Project setup', exact: true })
    await runActions.getByText('No actions for Project yet.', { exact: true }).waitFor()
    assert.equal(await projectSetup.getByRole('menuitem').count(), 5)
    await projectSetup.getByRole('menuitem', { name: 'Edit project actions…', exact: true }).click()
    await page.getByRole('dialog', { name: 'Project actions', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.evaluate(() =>
      window.setProjectActions([{ id: 'tests', name: 'Run tests', command: 'pnpm test' }]),
    )
    await info.getByRole('button', { name: 'Project actions', exact: true }).click()
    await runActions.getByRole('menuitem', { name: 'Run tests pnpm test', exact: true }).click()
    await page.waitForFunction(() =>
      window.calls.some(
        (call) =>
          call.path === '/api/terminals/run' &&
          call.input.taskId === 'thread' &&
          call.input.command === 'pnpm test',
      ),
    )
    await page.evaluate(() => window.setProjectActions([]))
    await page.getByRole('button', { name: 'Git actions', exact: true }).click()
    if (stylesheet) {
      const menu = page.getByRole('menu').filter({ hasText: 'Stage, commit & push…' })
      const advanced = menu.getByRole('menuitem', { name: 'Stage, commit & push…', exact: true })
      assert.equal(
        await menu.evaluate((element) => element.classList.contains('studio-menu-surface')),
        true,
      )
      await advanced.hover()
      assert.notEqual(
        await advanced.evaluate((element) => getComputedStyle(element).backgroundImage),
        'none',
      )
      assert.ok(
        (await menu.evaluate((element) => getComputedStyle(element).boxShadow)).includes('18px'),
      )
      if (!mobile) await page.screenshot({ path: '/tmp/dovo-project-git-menu-effects.png' })
      await page.evaluate(() => {
        document.documentElement.dataset.themeGradients = 'false'
        document.documentElement.dataset.themeGlow = '0'
        document.documentElement.style.setProperty('--studio-glow-strength', '0')
      })
      assert.equal(
        await advanced.evaluate((element) => getComputedStyle(element).backgroundImage),
        'none',
      )
      assert.ok(
        !(await menu.evaluate((element) => getComputedStyle(element).boxShadow)).includes('18px'),
      )
      if (!mobile) await page.screenshot({ path: '/tmp/dovo-project-git-menu-flat.png' })
      await page.evaluate(() => {
        delete document.documentElement.dataset.themeGradients
        delete document.documentElement.dataset.themeGlow
        document.documentElement.style.removeProperty('--studio-glow-strength')
      })
    }
    await page.getByRole('menuitem', { name: 'Stage, commit & push…', exact: true }).click()
    await page.getByRole('dialog', { name: 'Git & project actions', exact: true }).waitFor()
    const gitDialog = page.getByRole('dialog', { name: 'Git & project actions', exact: true })
    const stagingBounds = await gitDialog.boundingBox()
    const continuation = gitDialog.locator('[data-git-scroll-continuation]')
    const gitScroll = gitDialog.locator('[data-git-actions-scroll]')
    assert.equal(await continuation.count(), 0, 'Fitting content needs no continuation cue')
    await page.evaluate(() => window.setGitFixture({ long: true }))
    await continuation.waitFor()
    for (const scheme of ['light', 'dark']) {
      const colors = await continuation.evaluate((element, scheme) => {
        const html = document.documentElement
        const previousClass = html.className
        const previousTheme = html.dataset.theme
        const probe = document.createElement('span')
        try {
          html.classList.toggle('dark', scheme === 'dark')
          html.dataset.theme = scheme
          const dialog = element.closest('[role="dialog"]')
          probe.style.backgroundColor =
            getComputedStyle(element).getPropertyValue('--tw-gradient-from')
          element.append(probe)
          return {
            fade: getComputedStyle(probe).backgroundColor,
            surface: getComputedStyle(dialog).backgroundColor,
          }
        } finally {
          probe.remove()
          html.className = previousClass
          if (previousTheme === undefined) delete html.dataset.theme
          else html.dataset.theme = previousTheme
        }
      }, scheme)
      assert.equal(
        colors.fade,
        colors.surface,
        `${scheme} Git continuation matches its dialog surface`,
      )
    }
    await gitScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await continuation.waitFor({ state: 'detached' })
    await gitScroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await continuation.waitFor()
    await page.evaluate(() => window.setGitFixture({ long: false, dirty: false }))
    await continuation.waitFor({ state: 'detached' })
    assert.ok(
      (await gitDialog.boundingBox()).height < stagingBounds.height,
      'Clean Git stays compact',
    )
    await page.evaluate(() => window.setGitFixture({ dirty: true }))
    assert.deepEqual(await gitDialog.boundingBox(), stagingBounds)
    await gitDialog.getByRole('button', { name: 'Review fixture file', exact: true }).click()
    const reviewBounds = await gitDialog.boundingBox()
    assert.equal(reviewBounds.height, stagingBounds.height, 'Review keeps the Git workspace height')
    if (!mobile) assert.ok(reviewBounds.width > stagingBounds.width + 300)
    await page.evaluate(() => window.setGitFixture({ long: true }))
    assert.equal(
      await continuation.count(),
      0,
      'Review uses its own scrolling without the staging cue',
    )
    await page.evaluate(() => window.setGitFixture({ long: false }))
    assert.ok(
      reviewBounds.x >= 0 && reviewBounds.x + reviewBounds.width <= page.viewportSize().width,
    )
    await gitDialog.getByRole('button', { name: 'Back to staging fixture', exact: true }).click()
    assert.deepEqual(await gitDialog.boundingBox(), stagingBounds)
    await page.keyboard.press('Escape')
    await page
      .getByRole('dialog', { name: 'Git & project actions', exact: true })
      .waitFor({ state: 'hidden' })
    await page.getByRole('dialog', { name: 'Thread info', exact: true }).waitFor()
    assert.equal(
      await page
        .locator('.studio-thread-info-content')
        .getByRole('region', { name: 'Related items and watchers' })
        .count(),
      1,
    )
    await page.getByRole('button', { name: /Watching/ }).waitFor()
    for (const [state, draft, tone] of [
      ['open', false, 'text-status-success'],
      ['merged', false, 'text-status-done'],
      ['closed', false, 'text-status-error'],
      ['open', true, 'text-muted-foreground'],
    ]) {
      await page.evaluate(([state, draft]) => window.setPullState(state, draft), [state, draft])
      await page
        .getByLabel('Linked pull requests', { exact: true })
        .locator('svg')
        .first()
        .waitFor()
      await page.waitForFunction(
        (tone) =>
          document
            .querySelector('[aria-label="Linked pull requests"] svg')
            ?.classList.contains(tone),
        tone,
      )
    }
    await page.evaluate(() => window.setPullState('open'))
    await page.getByRole('button', { name: /Watching/ }).click()
    await page.getByRole('link', { name: 'Project · PR #7', exact: true }).click()
    assert.equal(await page.evaluate(() => window.opened), 'https://github.com/test/project/pull/7')
    await page.getByRole('button', { name: /Open in…/ }).click()
    await page.getByRole('menuitem', { name: 'Open in Zed', exact: true }).click()
    await page.getByRole('button', { name: 'Open in Zed', exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.find((call) => call.path === '/api/scm/open-location').input.taskId,
      ),
      'thread',
    )
    assert.equal(await page.evaluate(() => window.clientOpens.at(-1).target), 'zed')
    assert.equal(
      await page.evaluate(() => window.calls.some((call) => call.path === '/api/scm/open-folder')),
      false,
    )
    if (stylesheet) {
      await page.mouse.move(0, 0)
      await page.screenshot({
        path: `/tmp/dovo-project-panel-${mobile ? 'compact' : 'desktop'}.png`,
      })
      await page
        .locator('.studio-thread-info-content')
        .screenshot({ path: `/tmp/dovo-project-card-${mobile ? 'compact' : 'desktop'}.png` })
      assert.equal(
        await page
          .locator('.studio-thread-info-content')
          .evaluate((element) => getComputedStyle(element).borderRadius),
        '0px',
      )
      assert.equal(
        await page
          .locator('.studio-project-path')
          .evaluate((element) => getComputedStyle(element).fontSize),
        '11px',
      )
    }
    if (stylesheet) {
      const totals = await page.locator('.studio-project-diff').boundingBox()
      const card = await page.locator('.studio-project-diff').evaluate((node) => {
        const bounds = node.closest('.studio-thread-info-links').getBoundingClientRect()
        return { x: bounds.x, width: bounds.width }
      })
      assert.ok(totals && card && card.x + card.width - (totals.x + totals.width) <= 16)
    }
    const linkedRow = page.getByLabel('Linked pull requests', { exact: true })
    await linkedRow.getByRole('link', { name: /Open PR #7/ }).waitFor()
    await linkedRow
      .getByRole('button', { name: 'Open PR #9: Preserve the runtime session', exact: true })
      .waitFor()
    const linkedBox = await linkedRow.boundingBox()
    const editorBox = await page
      .getByRole('button', { name: 'Open in Zed', exact: true })
      .boundingBox()
    assert.ok(linkedBox && editorBox && linkedBox.y > editorBox.y)
    assert.equal(
      await linkedRow.locator('xpath=ancestor::section[@aria-label="Pull requests"]').count(),
      1,
    )
    assert.equal(await page.getByRole('button', { name: 'Show 1 more', exact: true }).count(), 0)
    await linkedRow
      .getByRole('button', { name: 'Open PR #9: Preserve the runtime session', exact: true })
      .click()
    assert.equal(await page.evaluate(() => window.opened), 'https://github.com/test/project/pull/9')
    await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).click()
    const stopDialog = page.getByRole('dialog', { name: 'Stop watching?', exact: true })
    await stopDialog.getByRole('button', { name: 'Stop watching', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((call) => call.input.unlink))
    await page.getByRole('button', { name: 'Hide thread info', exact: true }).click()
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
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.getByRole('button', { name: /^Changes/ }).click()
    assert.equal(await page.evaluate(() => window.surface), 'changes')
    await page
      .getByRole('region', { name: 'Thread info', exact: true })
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
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.evaluate(() =>
      window.setGitState({ dirty: false, ahead: 0, behind: 0, tracking: true, canPush: true }),
    )
    await info
      .locator('.studio-thread-primary-action')
      .getByText('Open PR', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Hide thread info', exact: true }).click()
    await page.evaluate(() => window.clearPulls())
    await page.getByRole('button', { name: 'Linked PRs', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: 'Linked PRs', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Show thread info', exact: true }).click()
    await page.evaluate(() =>
      window.setGitState({ dirty: false, ahead: 0, behind: 0, tracking: true, canPush: true }),
    )
    await info.getByText('Clean · Synced', { exact: true }).waitFor()
    await info.getByRole('button', { name: 'Git actions', exact: true }).waitFor()
    assert.equal(await info.getByText('No changes to commit', { exact: true }).count(), 0)
    await page.evaluate(() => window.clearFiles())
    await info.getByRole('button', { name: 'Changes', exact: true }).waitFor()
    assert.equal(await info.getByText('No changes', { exact: true }).count(), 0)
    assert.equal(
      await info.locator('.studio-thread-primary-action').count(),
      0,
      'Clean checkout has no disabled commit action',
    )
    await page.evaluate(() =>
      window.setGitState({ dirty: false, ahead: 2, behind: 0, tracking: true, canPush: true }),
    )
    await info
      .locator('.studio-thread-primary-action')
      .getByText('Push branch', { exact: true })
      .waitFor()
    await page.evaluate(() =>
      window.setGitState({ dirty: true, ahead: 0, behind: 0, tracking: true, canPush: true }),
    )
    await info
      .locator('.studio-thread-primary-action')
      .getByText('Commit & push', { exact: true })
      .waitFor()
    await info
      .locator('.studio-thread-info-actions')
      .getByRole('button', { name: 'Terminal', exact: true })
      .click()
    await page.waitForFunction(() => window.surface === 'terminal')
    await info.waitFor({ state: 'hidden' })
    if (!mobile) {
      const brandBeforeCollapse = await page.locator('.studio-titlebar-brand').boundingBox()
      await page.getByRole('button', { name: 'Threads', exact: true }).click()
      await page.locator('.studio-titlebar:not([data-sidebar-brand=true])').waitFor()
      const brandAfterCollapse = await page.locator('.studio-titlebar-brand').boundingBox()
      assert.equal(
        brandBeforeCollapse.x,
        brandAfterCollapse.x,
        'Brand does not move when the sidebar collapses',
      )
      assert.equal(brandBeforeCollapse.y, brandAfterCollapse.y)
      assert.equal(await page.locator('.studio-titlebar').count(), 1)
      const pageHeader = await page.locator('.studio-task-thread-header').boundingBox()
      assert.equal(
        pageHeader.y + pageHeader.height / 2,
        brandBeforeCollapse.y + brandBeforeCollapse.height / 2,
        'Right controls remain in the same row',
      )
      assert.equal(await page.locator('.studio-titlebar-name').textContent(), 'Dovo Studio')
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
    const generalProject = page.getByRole('region', { name: 'Thread info', exact: true })
    await generalProject.getByRole('heading', { name: 'No Project', exact: true }).waitFor()
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
        await page.locator('.studio-thread-card-context > span.flex[data-tone="success"]').count(),
        4,
      )
      // Unread completions say Done; read completions remain explicit as Finished.
      // Both retain a quiet success icon, with age available in the tooltip.
      for (const [project, unread] of [
        ['Project', true],
        ['Mobile app', false],
        ['Runtime', true],
        ['Draft PR', false],
      ]) {
        const context = page.locator('.studio-thread-card-context').filter({
          has: page.getByText(project, { exact: true }),
        })
        const status = context.locator(':scope > span.flex')
        assert.equal(await status.count(), 1)
        assert.equal(await status.getByText('Done', { exact: true }).count(), Number(unread))
        assert.equal(await status.getByText('Finished', { exact: true }).count(), Number(!unread))
        assert.equal(await status.locator('svg').count(), 1)
        assert.equal(await status.getAttribute('data-tone'), 'success')
      }
      const toggle = page.getByRole('button', {
        name: 'Subthreads for Fix reconnection across Wi-Fi switches',
        exact: true,
      })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(
        await page.getByRole('button', { name: 'Open child thread Review implementation' }).count(),
        0,
      )
      const executionRow = page.locator('[data-thread-execution]').first()
      const toggleBounds = await toggle.boundingBox()
      const rowBounds = await executionRow.boundingBox()
      assert.ok(
        Math.abs(toggleBounds.y + toggleBounds.height / 2 - rowBounds.y - rowBounds.height / 2) < 1,
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
      assert.equal(await page.getByText('Native reviewer', { exact: true }).count(), 0)
      await nativeToggle.click()
      await page.getByText('Native reviewer', { exact: true }).waitFor()
      await page.screenshot({ path: `/tmp/dovo-native-subagents-${scheme}.png` })
      assert.equal(await page.locator('button button').count(), 0)
      await page.close()
    }
} finally {
  await browser.close()
}
