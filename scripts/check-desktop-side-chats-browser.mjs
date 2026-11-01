import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/extension-scm/pull-detail': `export const PullDetail=({number,initialTab,linkedThread})=>{window.askInThread=linkedThread?.onAsk;return <aside aria-label="Pull request details" data-pull-preview={number} data-tab={initialTab}>PR {number} {linkedThread?.task.title}</aside>};`,
  './detail/side-thread-changes': `export const ReviewSideThreadChangesButton=({task})=><button data-review-side-changes={task.id}>Review changes</button>;`,
  '../../detail/side-thread-changes': `export const ReviewSideThreadChangesButton=({task})=><button data-review-side-changes={task.id}>Review changes</button>;`,
  './chat/thread/side-question': `export const SideQuestion=({task})=><div data-read-only-side-chats={task.id}>{(task.sideChats??[]).map(chat=><p key={chat.id}>{chat.messages[0]?.answer}</p>)}</div>;`,
  // The real TasksView, side chat panel, split view and composers with lightweight shells.
  '@dovo/extension-scm/repository-dialog': 'export const RepositoryDialog=()=>null;',
  '../chat/thread-sharing':
    'export const ThreadSharing=()=>null;export const InlineThreadSuggestions=()=>null;',
  '@dovo/protocol': `export * from '../protocol/src/index';export const watchRuntimeTask=()=>()=>{};`,
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref]}`,
  '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    export * from '@dovo/protocol';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceValueProvider,useWorkspaceSelector,sameWorkspaceFields} from '../studio-core/src/workspace/selector';
    export {useCachedTask} from '../studio-core/src/workspace/use-cached-task';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const useStudioHost=()=>window.host;
    export const WorkspaceScope=({children})=>children;
    export const readAppPreferences=()=>({taskSort:'priority',taskGrouping:'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled'],threadInfoSections:{},followUp:'queue'});
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=()=>{};
    export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});
    export const formatDateTime=value=>value;
  `,
  '@dovo/studio-ui': `
export {permissionPolicyUIIssue} from './src/permission-policy-fields';
export * as Popover from '@radix-ui/react-popover';
export * as DropdownMenu from '@radix-ui/react-dropdown-menu';
export const SidebarHeader=()=>null;
export {PullRequestIcon,pullRequestIconTone} from '${new URL('../packages/studio-ui/src/pull-request-icon.tsx', import.meta.url).pathname}';
import {useState as useSidebarState} from 'react';export const useLeftSidebar=initial=>useSidebarState(initial);export const useNavigationSidebar=()=>null;export const HeaderContent=({children})=>children;

    export {FileTypeIcon} from './src/file-tree';
    export const Conversation=({children,...props})=><div role="log" {...props}>{children}</div>;export const ConversationContent=({children,...props})=><div {...props}>{children}</div>;export const ConversationScrollButton=()=>null;
    export const Message=({children,from})=><div data-native-role={from}>{children}</div>;export const MessageContent=({children})=><div>{children}</div>;export const MessageResponse=({children})=><div>{children}</div>;
    export const cn=(...values)=>values.filter(Boolean).join(' ');
    export const useCompactLayout=()=>false;
    const Box=({children})=><div>{children}</div>;
    export const ResizablePanel=Box,ResizablePanelGroup=Box,ResizableHandle=()=>null;
    export const Dialog=({open,children})=>open?<div>{children}</div>:null;
    export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box;
    export const ProjectIcon=()=>null;
    export const Button=({children,onClick,disabled,type,variant,size,...props})=><button {...props} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
    export const IconButton=({children,label,className,...props})=><button aria-label={label} title={label} {...props}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const ComposerSurface=({children,controls,leadingActions,actions,onSubmit})=><form onSubmit={onSubmit}>{children}{leadingActions}{controls}{actions}</form>;
    export const ComposerSubmit=props=><button {...props}/>;
    export const ComposerTextarea=props=><textarea {...props}/>;
    export const ContextMenu={Label:Box,Sub:Box,SubTrigger:Box,Portal:Box,SubContent:Box,Item:Box};
  `,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:()=>{},remove:()=>{}});`,
  './task-row': `export const TaskRow=({task,selected,onSelect})=><button data-row-id={task.id} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './detail/resizable-sidebar':
    'export const ResizableSidebar=({children,className})=><div className={className}>{children}</div>;',
  './detail/task-project-panel': 'export const TaskProjectPanel=()=>null;',
  './detail/task-header': `export const TaskHeader=({task,onSurface})=><header data-thread-header={task.id}>{task.title}<button onClick={()=>onSurface('side-chats')}>Open side chats</button></header>;`,
  './detail/task-agents': `export const TaskAgents=({task,onOpenThread})=><button onClick={()=>onOpenThread({taskId:task.id,agent:task.subagents[0]})}>Open native Claude thread</button>;`,
  '../chat/thread/chat-thread': `export const ChatThread=({task,emptyState})=>task.status==='draft'&&!task.messages.length&&emptyState?emptyState:<div data-chat-id={task.id}>{task.messages.map(message=><p key={message.id}>{message.text}</p>)}</div>;`,
  '../chat/artifact-open-context': 'export const ArtifactOpenContext=({children})=>children;',
  '../chat/thread/use-task-viewed': 'export const useTaskViewed=()=>({error:null});',
  './detail/live-refresh': 'export const useLiveRefresh=()=>null;',
}
for (const [path, names] of [
  ['@dovo/extension-scm/project-transfer', ['ProjectTransferDialog']],
  ['@dovo/extension-scm/projects', ['ProjectsMenu']],
  ['./detail/task-tools', ['TaskTools']],
  ['./detail/linked-projects', ['LinkedProjects']],
  ['./chat/artifacts', ['ThreadArtifacts']],
  ['./browser/browser-pane', ['BrowserPane', 'DevicesPane']],
  ['./review/review-pane', ['ReviewPane']],
  ['./detail/task-files', ['TaskFiles']],
  ['./terminal/terminal-pane', ['TerminalPane']],
  ['./dialogs/task-search-dialog', ['TaskSearchDialog']],
  ['./task-creation/project-selection-dialog', ['ProjectSelectionDialog']],
  ['../chat/composer/composer-activity', ['ComposerActivity']],
  ['../chat/thread/preparation-progress', ['PreparationProgress']],
  ['../chat/thread/review-comments-tray', ['ReviewCommentsTray']],
  ['../chat/thread/plan-approval', ['PlanApproval']],
  ['../chat/thread/review-findings', ['ReviewFindings']],
  ['../review/code-review-card', ['CodeReviewCard']],
  ['../dialogs/task-pull-link-dialog', ['TaskPullLinkDialog']],
  ['./attachment-picker', ['AttachmentPicker']],
  ['./message-attachments', ['MessageAttachments']],
  ['./composer-command-dialog', ['ComposerCommandDialog']],
  ['../../dialogs/saved-prompts-dialog', ['SavedPromptsDialog']],
  ['../thread/context-meter', ['ContextMeter']],
  ['./composer-harness-controls', ['ComposerHarnessControls']],
  ['./turn-model-controls', ['TurnModelControls']],
  ['./composer-workspace', ['ComposerWorkspace']],
  ['../chat/composer/composer-workspace', ['ComposerWorkspace']],
])
  mocks[path] = names.map((name) => `export const ${name}=()=>null;`).join('\n')

// The normal approval and question controls, reduced to what attention navigation focuses.
mocks['../chat/actions/run-controls'] =
  `import {useWorkspace,taskInputVisible} from '@dovo/studio-core';export const RunControls=({task})=>{const {snapshot,workspace}=useWorkspace();return snapshot.approvals.some(a=>taskInputVisible(workspace.tasks,task.id,a))?<div data-human-input="approval" data-human-input-task={task.id}><button>Approve in {task.id}</button></div>:null};`
mocks['../chat/thread/task-questions'] =
  `import {useWorkspace,taskInputVisible} from '@dovo/studio-core';export const TaskQuestions=({taskId})=>{const {snapshot,workspace}=useWorkspace();return snapshot.questions.some(q=>taskInputVisible(workspace.tasks,taskId,q))?<div data-human-input="question" data-human-input-task={taskId}><textarea aria-label={'Answer in '+taskId}/></div>:null};`
for (const name of ['ComposerHarnessControls', 'TurnModelControls'])
  mocks[
    name === 'ComposerHarnessControls' ? './composer-harness-controls' : './turn-model-controls'
  ] = `export const ${name}=({renderControls})=>renderControls?.({model:null,access:null});`

const built = await build({
  conditions: ['development'],
  stdin: {
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {WorkspaceValueProvider,createTask} from '@dovo/studio-core';
      import TasksView from '../extension-tasks/src/view';
      window.requests=[];window.navigations=[];window.serverDrafts=new Map();window.markBroughtBack=true;window.commands=new Map();
      window.host={navigate:target=>{window.navigations.push(target);window.setRoute(route=>({entity:target.entityId,pullTarget:target.pullTarget,key:route.key+1}))},registerCommand:command=>{window.commands.set(command.id,command.run);return ()=>window.commands.delete(command.id)}};
      const thread=(id,title,fields={})=>({...createTask({title,objective:'',agentId:'',repositoryId:'scratch'}),id,status:'review',...fields});
      const link=parentTaskId=>({parentTaskId,objective:'',contextMessageCount:2,source:'snapshot',permissionCeiling:{permission:'workspace-write'}});
      const parent=thread('parent','Parent thread',{createdAt:'2026-10-31T09:00:00Z',draft:'Parent draft',messages:[{id:'p1',role:'user',text:'Build the cache'},{id:'p2',role:'assistant',text:'Cache built'}],sideChats:[{id:'legacy',title:'Earlier question',draft:'',messages:[{id:'q',question:'Why?',answer:'Legacy answer',status:'completed',createdAt:'2026-10-30T00:00:00Z'}]}]});
      const child=thread('child','Investigate cache',{createdAt:'2026-10-31T10:00:00Z',sideThread:link('parent'),messages:[{id:'p1',role:'user',text:'Build the cache'},{id:'p2',role:'assistant',text:'Cache built'},{id:'c1',role:'user',text:'Look at the cache'},{id:'c2',role:'assistant',text:'Cache is fine'}],turns:[{id:'turn-1',status:'completed',assistantId:'c2',startedAt:'2026-10-31T10:00:00Z'}]});
      const other=thread('other','Other thread',{createdAt:'2026-10-31T08:00:00Z'});
      function App(){
        const [route,setRoute]=useState({entity:'parent',key:0});const [mount,setMount]=useState(0);window.remount=()=>setMount(value=>value+1);window.setRoute=setRoute;const setEntity=entity=>setRoute(current=>({...current,entity,pullTarget:undefined}));
        const [workspace,setWorkspace]=useState({tasks:[parent,child,other],agents:[],skills:[],mcpServers:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]});
        window.setEntity=setEntity;window.saved=workspace.tasks;window.setWorkspace=setWorkspace;
        window.setTask=(id,update)=>setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===id?update(task):task)}));
        const [requests,setRequests]=useState({questions:[],approvals:[]});window.setRequests=setRequests;
        const snapshot={...requests,defaults:{},runtimeId:'runtime-mac',workspace};
        const request=async(path,input)=>{
          if(path==='/api/tasks/waiting')return {dependencies:[]};
          window.requests.push({path,input});
          if(path==='/api/tasks/side-thread/create'){if(window.saved.some(task=>task.id===input.id&&task.sideThread))throw Error('Side chats cannot start side chats');const created=thread('side-'+input.childId,'New side chat',{status:'draft',createdAt:'2026-10-31T11:00:00Z',draft:input.objective??'',sideThread:link(input.id)});setWorkspace(current=>({...current,tasks:[...current.tasks,created]}));return {id:created.id}};
          if(path==='/api/tasks/side-thread/discard'){setWorkspace(current=>({...current,tasks:current.tasks.filter(task=>task.id!==input.id)}));return {ok:true}};
          if(path==='/api/tasks/side-thread/bring-back'){const source=window.saved.find(task=>task.id===input.id);const turn=source.turns.at(-1);const receiptId=source.id+':'+turn.id;const text='[Side thread: '+source.title+' ('+source.id+'), completed turn '+turn.id+']\\n'+source.messages.at(-1).text;const target=source.sideThread.parentTaskId;if(!window.serverDrafts.has(receiptId)){if(input.expectedDraft!==window.saved.find(task=>task.id===target).draft)throw Error('The parent draft changed');window.serverDrafts.set(receiptId,text)}if(window.loseHandoff){window.loseHandoff=false;setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===source.id?{...task,sideThread:{...task.sideThread,broughtBackThrough:turn.id}}:task)}));throw Error('Connection lost')}if(window.markBroughtBack)setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===source.id?{...task,sideThread:{...task.sideThread,broughtBackThrough:turn.id}}:task)}));return {id:target,receiptId,text}};
          return {ok:true};
        };
        return <WorkspaceValueProvider value={{workspace,setWorkspace,snapshot,activeRuntimeId:'mac',switchRuntime:async()=>{},runtimes:[],runtimeRegistry:{profiles:[]},connected:true,connection:{address:'http://runtime',token:'token'},request,flush:async()=>{},readCache:{read:async()=>null},refreshRuntimes:async()=>{}}}><TasksView key={mount} entityId={route.entity} pullTarget={route.pullTarget} navigationKey={route.key}/></WorkspaceValueProvider>
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'desktop-side-chats-environment',
      setup(builder) {
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
  define: { 'process.env.NODE_ENV': '"development"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  // A real origin, so the durable handoff receipts can use storage.
  await page.route('http://dovo.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>.hidden{display:none}</style><div id="app"></div>',
    }),
  )
  await page.goto('http://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const header = page.locator('[data-thread-header]').first()
  const requests = (path) =>
    page.evaluate((path) => window.requests.filter((request) => request.path === path), path)
  const composer = (id) => page.locator(`textarea[data-task-id="${id}"]`)
  await composer('parent').waitFor()
  assert.equal(await composer('parent').inputValue(), 'Parent draft')

  // Side chats list full-agent children; earlier read-only questions stay explicitly reachable.
  await page.getByRole('button', { name: 'Open side chats', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Agent side chats' })
  await panel.getByRole('button', { name: 'Investigate cache', exact: true }).waitFor()
  await panel.getByText('Ready', { exact: true }).waitFor()
  await panel.getByRole('tab', { name: 'Read-only (1)', exact: true }).click()
  await page.locator('[data-read-only-side-chats="parent"]').getByText('Legacy answer').waitFor()
  await panel.getByRole('tab', { name: 'Agents (1)', exact: true }).click()

  // A thread with no saved questions must still expose read-only chat.
  await page.evaluate(() => window.setTask('parent', (task) => ({ ...task, sideChats: [] })))
  await panel.getByRole('tab', { name: 'Read-only (0)', exact: true }).click()
  await page.locator('[data-read-only-side-chats="parent"]').waitFor({ state: 'attached' })
  assert.equal(await panel.getByRole('button', { name: 'New side chat', exact: true }).count(), 0)
  await panel.getByRole('tab', { name: 'Agents (1)', exact: true }).click()

  // A side chat embeds the normal thread UI beside its parent.
  await panel.getByRole('button', { name: 'Show beside this thread', exact: true }).click()
  const beside = page.locator('section[aria-label="Side by side: Investigate cache"]')
  await beside.waitFor()
  await beside.getByText('Side chat ·', { exact: true }).waitFor()
  await composer('child').waitFor()
  await page.locator('[data-chat-id="child"]').getByText('Cache is fine').waitFor()
  assert.equal(
    await panel
      .getByRole('button', { name: 'Show beside this thread', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  const bringBackSelector =
    'section[aria-label="Side by side: Investigate cache"] button[aria-label^="Bring back"]'
  const bringBack = beside.getByRole('button', {
    name: 'Bring back results from Investigate cache',
    exact: true,
  })

  // The usual full snapshot is explained once, in the empty list, rather than beside every view.
  // A committed-only start gets a short note, with its details on request.
  assert.equal(await page.locator('[data-side-chat-source]').count(), 0)
  assert.equal(await panel.getByText(/A side chat is a full agent/).count(), 0)
  await page.evaluate(() =>
    window.setTask('child', (task) => ({
      ...task,
      sideThread: { ...task.sideThread, source: 'head' },
    })),
  )
  const note = beside.locator('[data-side-chat-source="head"]')
  await note.getByText('Committed files only', { exact: true }).waitFor()
  assert.equal(await note.getByText(/uncommitted changes are not included/).isVisible(), false)
  await note.getByText('Committed files only', { exact: true }).click()
  await note.getByText(/uncommitted changes are not included/).waitFor()
  assert.match(await note.textContent(), /copy of 2 parent messages/)
  assert.equal(await panel.locator('[data-side-chat-source="head"]').count(), 1)
  await beside.locator('[data-review-side-changes="child"]').waitFor()

  // Copied parent answers are never a result; only the side chat's own completed turn is.
  const ownTurns = await page.evaluate(() => window.saved.find((task) => task.id === 'child').turns)
  await page.evaluate(() =>
    window.setTask('child', (task) => ({
      ...task,
      turns: [{ id: 'inherited', status: 'completed', assistantId: 'p2' }],
    })),
  )
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute('aria-disabled') === 'true',
    bringBackSelector,
  )
  assert.match(await bringBack.getAttribute('title'), /Complete a turn in the side chat/)
  // The reason stays reachable: the button keeps focus and describes why, and pressing it says so.
  assert.match(
    await page.evaluate(
      (selector) =>
        document.getElementById(document.querySelector(selector).getAttribute('aria-describedby'))
          ?.textContent,
      bringBackSelector,
    ),
    /Complete a turn in the side chat/,
  )
  await bringBack.focus()
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    'Bring back results from Investigate cache',
  )
  // Playwright treats aria-disabled as not clickable; a pointer user can still press it.
  await bringBack.click({ force: true })
  await beside
    .getByRole('alert')
    .getByText(/Complete a turn in the side chat/)
    .waitFor()
  assert.equal((await requests('/api/tasks/side-thread/bring-back')).length, 0)
  await page.evaluate((turns) => window.setTask('child', (task) => ({ ...task, turns })), ownTurns)
  await page.waitForFunction((selector) => {
    const button = document.querySelector(selector)
    return !!button && !button.hasAttribute('aria-disabled')
  }, bringBackSelector)

  // Results only come back when both threads are settled.
  await page.evaluate(() => window.setTask('parent', (task) => ({ ...task, status: 'running' })))
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute('aria-disabled') === 'true',
    bringBackSelector,
  )
  assert.match(await bringBack.getAttribute('title'), /parent thread to finish/)
  await page.evaluate(() => window.setTask('parent', (task) => ({ ...task, status: 'review' })))

  // The runtime's draft change never reaches this composer here, so the result must be appended
  // locally, on top of unsaved typing. A lost response is retried without a duplicate.
  const handoff = '[Side thread: Investigate cache (child), completed turn turn-1]\nCache is fine'
  await composer('parent').fill('Parent draft with local edit')
  await page.evaluate(() => {
    window.loseHandoff = true
  })
  await bringBack.click()
  await beside.getByText('Connection lost', { exact: true }).waitFor()
  assert.equal(await composer('parent').inputValue(), 'Parent draft with local edit')
  // Typing within the save delay, so the composer still holds an edit the store has not seen.
  await composer('parent').fill('Parent draft with unsaved local edit')
  await bringBack.click()
  await page.waitForFunction(
    (text) => document.querySelector('textarea[data-task-id="parent"]')?.value.includes(text),
    handoff,
  )
  assert.equal(
    await composer('parent').inputValue(),
    `Parent draft with unsaved local edit\n\n${handoff}`,
  )
  const returned = await requests('/api/tasks/side-thread/bring-back')
  assert.equal(returned.length, 2)
  for (const request of returned) assert.equal(request.input.id, 'child')
  assert.equal(await page.evaluate(() => window.serverDrafts.size), 1)
  // The parent's saved draft now holds both the local edit and the handoff.
  await page.waitForFunction(
    (text) =>
      window.saved.find((task) => task.id === 'parent')?.draft ===
      `Parent draft with unsaved local edit\n\n${text}`,
    handoff,
  )
  assert.equal((await requests('/api/tasks/message')).length, 0, 'Bring back sent a message')
  assert.equal(
    await bringBack.getAttribute('aria-disabled'),
    null,
    'Saved server results remain recoverable after a lost response',
  )
  await page
    .getByRole('status')
    .getByText('Added results from “Investigate cache” to this draft. Review them before sending.')
    .waitFor()

  // A repeated response carries the same receipt, which stays applied even after the user
  // removes the text.
  await composer('parent').fill('Edited without the handoff')
  await page.evaluate(() => {
    window.markBroughtBack = false
    window.setTask('child', (task) => ({
      ...task,
      sideThread: { ...task.sideThread, broughtBackThrough: undefined },
    }))
  })
  await page.waitForFunction((selector) => {
    const button = document.querySelector(selector)
    return !!button && !button.hasAttribute('aria-disabled')
  }, bringBackSelector)
  await page.waitForFunction(
    () => window.saved.find((task) => task.id === 'parent')?.draft === 'Edited without the handoff',
  )
  await bringBack.click()
  await page.waitForFunction(
    () =>
      window.requests.filter((r) => r.path === '/api/tasks/side-thread/bring-back').length === 3,
  )
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))
  assert.equal(await composer('parent').inputValue(), 'Edited without the handoff')
  await page
    .getByRole('status')
    .getByText('Results from “Investigate cache” were already brought back to this draft.')
    .waitFor()
  assert.ok(
    (await page.evaluate(() => localStorage.getItem('dovo.sideChatHandoffReceipts'))).includes(
      'child:turn-1',
    ),
  )

  // New side chats are unsent drafts with a stable child id, shown beside the parent.
  await page.getByRole('button', { name: 'Open side chats', exact: true }).click()
  await panel.getByRole('button', { name: 'New side chat', exact: true }).click()
  await page.locator('section[aria-label="Side by side: New side chat"]').waitFor()
  const [created] = await requests('/api/tasks/side-thread/create')
  assert.equal(created.input.id, 'parent')
  assert.match(created.input.childId, /^[0-9a-f-]{36}$/)
  assert.equal('objective' in created.input, false)
  await panel.getByRole('button', { name: 'Investigate cache', exact: true }).waitFor()
  assert.equal(await panel.locator('li').count(), 2)

  // Opening a side chat as a normal thread offers a way back, and cannot nest side chats.
  await panel
    .locator('li')
    .filter({ hasText: 'Investigate cache' })
    .getByRole('button', { name: 'Open side chat as a thread', exact: true })
    .click()
  await page.waitForFunction(
    () => document.querySelector('[data-thread-header]')?.dataset.threadHeader === 'child',
  )
  const bar = page.getByRole('region', { name: 'Side chat', exact: true })
  await bar.getByText('Parent thread', { exact: true }).waitFor()
  await page.locator('section[aria-label="Side by side: Parent thread"]').waitFor()
  await composer('child').fill('Nested question')
  await composer('child').press('ControlOrMeta+;')
  const nested = page.getByRole('region', { name: 'Agent side chats' })
  await nested.getByText('This is a side chat.', { exact: false }).waitFor()
  assert.equal(
    await nested.getByRole('button', { name: 'New side chat', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await composer('child').inputValue(), 'Nested question')
  assert.equal((await requests('/api/tasks/side-thread/create')).length, 1)
  await bar.getByRole('button', { name: 'Return to parent', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-thread-header]')?.dataset.threadHeader === 'parent',
  )
  await page.locator('section[aria-label="Side by side: Investigate cache"]').waitFor()
  assert.equal(await header.getAttribute('data-thread-header'), 'parent')

  // A PR page handoff opens its task with that PR beside the task's full, working chat.
  await page.evaluate(() =>
    window.host.navigate({
      viewId: 'tasks',
      entityId: 'child',
      pullTarget: {
        runtimeId: 'mac',
        repositoryId: 'scratch',
        number: 7,
        url: 'https://github.com/team/project/pull/7',
        tab: 'changes',
      },
    }),
  )
  const preview = page.locator('[data-pull-preview="7"]')
  await preview.waitFor()
  assert.equal(await preview.getAttribute('data-tab'), 'changes')
  assert.equal(await header.getAttribute('data-thread-header'), 'child')
  assert.ok(await composer('child').isVisible(), 'The PR replaced the task chat')
  assert.ok(await preview.isVisible())

  // Asking about the same PR again neither duplicates its context nor removes typed text. An
  // untouched earlier contribution is replaced; an edited one is kept.
  const typed = await composer('child').inputValue()
  const askInThread = async (text, expected) => {
    await page.evaluate((text) => window.askInThread(text), text)
    await page.waitForFunction(
      (expected) => document.querySelector('textarea[data-task-id="child"]')?.value === expected,
      expected,
    )
  }
  await askInThread('PR context A', `${typed}\n\nPR context A`)
  await askInThread('PR context A', `${typed}\n\nPR context A`)
  await askInThread('PR context B', `${typed}\n\nPR context B`)
  await composer('child').fill(`${typed}\n\nPR context B, and check the tests`)
  await askInThread('PR context C', `${typed}\n\nPR context B, and check the tests\n\nPR context C`)
  await composer('child').fill(typed)
  // Navigating with the same target again does not reopen a preview the user closed.
  await page.getByRole('button', { name: 'Open side chats', exact: true }).click()
  await preview.waitFor({ state: 'detached' })
  await page.evaluate(() => window.setRoute((route) => ({ ...route })))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  assert.equal(await preview.count(), 0)

  // A side chat shown beside its parent returns with that parent only, including after a remount.
  const besideChild = page.locator('section[aria-label="Side by side: Investigate cache"]')
  const select = async (id) => {
    await page.evaluate((id) => window.setEntity(id), id)
    await page.waitForFunction(
      (id) => document.querySelector('[data-thread-header]')?.dataset.threadHeader === id,
      id,
    )
  }
  await select('parent')
  await besideChild.waitFor()
  await select('other')
  await besideChild.waitFor({ state: 'detached' })
  await select('parent')
  await besideChild.waitFor()
  await page.evaluate(() => window.remount())
  await besideChild.waitFor()
  assert.equal(await header.getAttribute('data-thread-header'), 'parent')
  // Closing the pair ends it; the parent opens alone afterwards.
  await besideChild.getByRole('button', { name: /^Close side-by-side task/ }).click()
  await besideChild.waitFor({ state: 'detached' })
  await select('other')
  await select('parent')
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))
  assert.equal(await besideChild.count(), 0)

  // Approvals in a side chat surface on the parent, its list and the split header, and open the
  // side chat's normal controls.
  await page.evaluate(() =>
    window.setRequests({ approvals: [{ id: 'approval', taskId: 'child' }], questions: [] }),
  )
  const banner = page.locator('[data-side-chat-attention-banner="approval"]')
  await banner.getByText(/Investigate cache.*is waiting for approval/).waitFor()
  await banner.getByRole('button', { name: 'Open approval', exact: true }).click()
  await besideChild.waitFor()
  await besideChild.locator('[data-side-chat-attention="approval"]').waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent === 'Approve in child')
  await page.getByRole('button', { name: 'Open side chats', exact: true }).click()
  const childRow = panel.locator('li').filter({ hasText: 'Investigate cache' })
  await childRow.locator('[data-side-chat-attention="approval"]').waitFor()
  // A question for an agent the side chat delegated to still rolls up to it.
  await page.evaluate(() => {
    window.setWorkspace((current) => ({
      ...current,
      tasks: [
        ...current.tasks,
        {
          ...current.tasks.find((task) => task.id === 'other'),
          id: 'helper',
          title: 'Delegated helper',
          delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'helper' },
        },
      ],
    }))
    window.setRequests({ approvals: [], questions: [{ id: 'question', taskId: 'helper' }] })
  })
  await childRow.locator('[data-side-chat-attention="input"]').waitFor()
  await besideChild.locator('[data-side-chat-attention="input"]').waitFor()
  await childRow.getByRole('button', { name: 'Answer in Investigate cache', exact: true }).click()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Answer in child',
  )
  await page.evaluate(() => window.setRequests({ approvals: [], questions: [] }))
  await banner.waitFor({ state: 'detached' })

  // A never-started side chat draft stays out of the thread list and is only discarded on an
  // explicit, confirmed request; closing it does not discard it.
  const draftId = (await requests('/api/tasks/side-thread/create'))[0].input.childId
  assert.equal(await page.locator('[data-row-id="parent"]').count(), 1)
  assert.equal(await page.locator(`[data-row-id="side-${draftId}"]`).count(), 0)
  const draftRow = panel.locator('li').filter({ hasText: 'New side chat' })
  await draftRow.getByText('Unsent draft', { exact: true }).waitFor()
  assert.equal(await draftRow.getByRole('button', { name: /^Bring back/ }).count(), 0)
  await draftRow.getByRole('button', { name: 'Show beside this thread', exact: true }).click()
  const besideDraft = page.locator('section[aria-label="Side by side: New side chat"]')
  await besideDraft.waitFor()
  assert.equal(await besideDraft.locator('[data-review-side-changes]').count(), 0)
  await besideDraft.getByRole('button', { name: /^Close side-by-side task/ }).click()
  await besideDraft.waitFor({ state: 'detached' })
  assert.equal((await requests('/api/tasks/side-thread/discard')).length, 0)
  await draftRow.getByRole('button', { name: 'Discard unused draft New side chat' }).click()
  await draftRow.getByText('Discard this unused draft?').waitFor()
  await draftRow.getByRole('button', { name: 'Discard', exact: true }).click()
  await draftRow.waitFor({ state: 'detached' })
  assert.deepEqual(
    (await requests('/api/tasks/side-thread/discard')).map((request) => request.input),
    [{ id: `side-${draftId}` }],
  )
  // Started side chats offer no discard; normal deletion remains their way out.
  assert.equal(await childRow.getByRole('button', { name: /^Discard/ }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop agent side chats: real TasksView lists and embeds full child threads beside the parent, keeps legacy questions reachable, notes committed-only provenance compactly, ignores inherited history, creates unsent drafts, gates Bring back and appends its exact handoff once through the parent composer, keeping unsaved edits across a lost response, retry and repeated receipt, returns from a standalone side chat, blocks nested side chats, opens a PR handoff task with the PR beside its full chat, replaces only untouched repeated PR context, restores a side chat only with its parent across selection and remount, surfaces and focuses side chat and delegated approvals and questions, explains unavailable Bring back and confirms its result, and discards never-started drafts only on request.',
  )
} finally {
  await browser.close()
}
