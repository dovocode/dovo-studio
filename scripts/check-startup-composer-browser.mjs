import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  './bot-create-dialog': 'export const BotCreateDialog=()=>null;',
  // Bot settings have their own browser coverage; this fixture checks normal-thread startup.
  './bots/bot-settings': 'export const BotSettings=()=>null;',
  './detail/side-thread-changes': 'export const ReviewSideThreadChangesButton=()=>null;',
  '../../detail/side-thread-changes': 'export const ReviewSideThreadChangesButton=()=>null;',
  // Session import has its own browser regression; this fixture exercises startup continuity.
  // Sharing is verified separately from draft, selection and route continuity.
  '@dovo/extension-scm/repository-dialog': 'export const RepositoryDialog=()=>null;',
  '../chat/thread-sharing':
    'export const ThreadSharing=()=>null;export const InlineThreadSuggestions=()=>null;',
  '@dovo/protocol': `export * from '../protocol/src/index';export const watchRuntimeTask=()=>()=>{};`,
  '@dovo/studio-core/state': `export {useApplicationState} from '../studio-core/src/runtime/application-state';`,
  '@dovo/studio-core': `export * from '../studio-core/src/shortcuts';export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    export * from '@dovo/protocol';
    export {composerRecoveryKey,createComposerRecovery,composerCaretRecoveryKey,recoverStartupComposer} from '../studio-core/src/workspace/composer-recovery';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {imageEditorDocument,parseImageEditorResult} from '../client-runtime/src/images/image-editor';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceValueProvider,useWorkspaceSelector,sameWorkspaceFields} from '../studio-core/src/workspace/selector';
    export {useCachedTask} from '../studio-core/src/workspace/use-cached-task';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const useStudioHost=()=>window.host;
    export const WorkspaceScope=({children})=>children;
    export const readAppPreferences=()=>({shortcutOverrides:{},savedFilterViews:[],taskSort:'priority',taskGrouping:'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled'],threadInfoSections:{},followUp:'queue'});
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=()=>{};
    export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});
    export const formatDateTime=value=>value;
  `,
  '@dovo/studio-ui': `export {BotAvatar} from '../studio-ui/src/bot-avatar';
export {Card} from '@dovo/web-ui/card';
export {ConversationHistory,useConversationHistory} from '../studio-ui/src/components/ai-elements/conversation';
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
    export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box,DialogFooter=Box;
    export const SearchField=({onValueChange,...props})=><input {...props} onChange={event=>onValueChange?.(event.target.value)}/>;
    export const ProjectIcon=()=>null;
    export const Button=({children,onClick,disabled,type,variant,size,...props})=><button {...props} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
    export const IconButton=({children,label,onClick})=><button aria-label={label} onClick={onClick}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const ComposerSurface=({children,controls,leadingActions,actions,onSubmit,error})=><form onSubmit={onSubmit}>{children}{leadingActions}{controls}{actions}{error&&<p role="alert">{error}</p>}</form>;
    export const ComposerSubmit=props=><button {...props}/>;
    export const ComposerTextarea=props=><textarea {...props}/>;
    export const ContextMenu={Root:Box,Trigger:Box,Content:Box,Label:Box,Sub:Box,SubTrigger:Box,Portal:Box,SubContent:Box,Item:Box};
  `,
  './task-row': `export const TaskRow=({task,selected,onSelect})=><button data-row-id={task.id} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './detail/resizable-sidebar':
    'export const ResizableSidebar=({children,className})=><div className={className}>{children}</div>;',
  './detail/task-project-panel': 'export const TaskProjectPanel=()=>null;',
  './detail/task-header': `export const TaskHeader=({task,onSurface})=><header data-thread-header={task.id}>{task.title}<button onClick={()=>onSurface('agents')}>Agents</button><button onClick={()=>onSurface('changes')}>Show diff fixture</button><button onClick={()=>onSurface('files')}>Show file fixture</button></header>;`,
  './detail/task-agents': `export const TaskAgents=({task,onOpenThread})=><button onClick={()=>onOpenThread({taskId:task.id,agent:task.subagents[0]})}>Open native Claude thread</button>;`,
  '../chat/thread/chat-thread': `export const ChatThread=({task,emptyState})=>task.status==='draft'&&!task.messages.length&&emptyState?emptyState:<div data-chat-id={task.id}>{task.messages.map(message=><p key={message.id}>{message.text}</p>)}</div>;`,
  '../chat/artifact-open-context': 'export const ArtifactOpenContext=({children})=>children;',
  '../chat/thread/use-task-viewed': 'export const useTaskViewed=()=>({error:null});',
}
for (const [path, names] of [
  ['@dovo/extension-scm/pull-detail', ['PullDetail']],
  ['@dovo/extension-scm/project-transfer', ['ProjectTransferDialog']],
  ['@dovo/extension-scm/projects', ['ProjectsMenu']],
  ['./detail/task-tools', ['TaskTools']],
  ['./detail/linked-projects', ['LinkedProjects']],
  ['./chat/artifacts', ['ThreadArtifacts']],
  ['./browser/browser-pane', ['BrowserPane', 'DevicesPane']],
  ['./review/review-pane', ['ReviewPane']],
  ['./detail/task-files', ['TaskFiles']],
  ['./terminal/terminal-dock', ['TerminalDock']],
  ['./dialogs/task-search-dialog', ['TaskSearchDialog']],
  ['./task-creation/project-selection-dialog', ['ProjectSelectionDialog']],
  ['./chat/thread/side-question', ['SideQuestion']],
  ['../chat/composer/composer-activity', ['ComposerActivity']],
  ['../chat/thread/task-questions', ['TaskQuestions']],
  ['../chat/actions/run-controls', ['RunControls']],
  ['../chat/thread/preparation-progress', ['PreparationProgress']],
  ['../chat/thread/review-comments-tray', ['ReviewCommentsTray']],
  ['../chat/thread/plan-approval', ['PlanApproval']],
  ['../chat/thread/review-findings', ['ReviewFindings']],
  ['../review/code-review-card', ['CodeReviewCard']],
  ['../dialogs/task-pull-link-dialog', ['TaskPullLinkDialog']],
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

for (const name of ['ComposerHarnessControls', 'TurnModelControls'])
  mocks[
    name === 'ComposerHarnessControls' ? './composer-harness-controls' : './turn-model-controls'
  ] = `export const ${name}=({renderControls})=>renderControls?.({model:null,access:null});`

mocks['./review/review-pane'] =
  `export const ReviewPane=({onReference})=><button onClick={()=>onReference('Selected diff reference')}>Add diff reference to composer</button>;`
mocks['./detail/task-files'] =
  `export const TaskFiles=({onReference})=><button onClick={()=>onReference('Selected file reference')}>Add file reference to composer</button>;`

mocks['./chat/thread/side-question'] =
  `export const SideQuestion=({task,selectedChatId})=><div data-side-chat={selectedChatId??''} data-side-task={task.id}>Side question panel</div>;`

// Exercise remote selection through the real TasksView/StartupDraft boundary.
mocks['../chat/composer/composer-workspace'] = mocks['./composer-workspace'] = `
  import {useWorkspace} from '@dovo/studio-core';
  export const ComposerWorkspace=({task,onSelectRemote})=>{
    const store=useWorkspace();
    return <div data-composer-project={task.repositoryId} data-auto-project={!!task.autoProject} data-model-selection={task.modelSelection}><button onClick={()=>onSelectRemote({runtimeId:store.activeRuntimeId==='mac'?'remote':'mac'}, {id:store.activeRuntimeId==='mac'?'remote-project':'local-project'})}>Switch project server</button></div>;
  };
`

const built = await build({
  conditions: ['development'],
  stdin: {
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {useApplicationState} from '@dovo/studio-core/state';
      import {WorkspaceValueProvider,createTask} from '@dovo/studio-core';
      import TasksView from '../extension-tasks/src/view';
      window.requests=[];window.navigations=[];window.commands=new Map();window.commandRegistrations=0;window.commandDisposals=0;
      // Workbench invalidates its palette on register/dispose. Unified may recreate the host
      // object on that render while preserving registerCommand itself.
      window.host={navigate:target=>{window.navigations.push(target);window.setEntity(target.entityId)},registerCommand:command=>{if(window.commands.has(command.id))throw Error('Duplicate command: '+command.id);window.commands.set(command.id,command.run);window.commandRegistrations++;window.refreshCommands(value=>value+1);return ()=>{window.commands.delete(command.id);window.commandDisposals++;window.refreshCommands(value=>value+1)}}};
      const other=createTask({title:'Existing',objective:'',agentId:'',repositoryId:'scratch'});
      function App(){
        const [commandVersion,refreshCommands]=useApplicationState(0);window.refreshCommands=refreshCommands;window.commandVersion=commandVersion;
        window.host={...window.host};
        const [entity,setEntity]=useState(),[revision,setRevision]=useState(0),[active,setActive]=useState('mac');
        const repositories=id=>[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''},{id:id==='mac'?'local-project':'remote-project',name:'Shared project',path:'/project',branch:'main'}];
        const [workspace,setWorkspace]=useState({tasks:[other],agents:[],skills:[],mcpServers:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]});
        window.setEntity=setEntity;window.saved=workspace.tasks;window.setWorkspace=setWorkspace;
        const snapshot={workspace,revision,autoProjectSelectionEnabled:true,autoProjectModelSelection:"smart",questions:[],approvals:[],defaults:{},detailTaskIds:revision?workspace.tasks.map(task=>task.id):[]};
        window.hydrate=()=>setRevision(value=>value+1);
        window.replaceCommandRegistry=()=>{const previous=window.host.registerCommand;window.host={...window.host,registerCommand:command=>previous(command)};setRevision(value=>value+1)};
        const request=async(path,input)=>{
          if(path==='/api/tasks/waiting')return {dependencies:window.watchedItems??[]};
          window.requests.push({path,input});
          if(path==='/api/tasks/native-thread')return {entries:[{id:'native-prompt',role:'user',text:'Claude native prompt'},{id:'native-answer',role:'assistant',text:'Claude native answer'}]};
          if(path==='/api/tasks/title')return {title:'New thread'};
          if(path.startsWith('/api/attachments/')){
            // The real workspace request flushes pending task edits before the API reads the guard.
            await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
            const task=window.saved.find(task=>task.id===input.taskId);
            if(!task)throw Error('Thread not found');
            const guard=JSON.stringify([task.draft,(task.draftAttachments??[]).map(file=>file.id)]);
            if(path==='/api/attachments/draft-guard')return {guard,guardedUploads:1};
            if(path==='/api/attachments/upload'){
              if(input.draftGuard!==guard)throw Error('The draft changed. Review the draft before attaching the file again.');
              const attachment={id:input.id,name:input.name,mime:'image/png',size:atob(input.data).length};
              const files=[...(task.draftAttachments??[]),attachment];
              setWorkspace(current=>({...current,tasks:current.tasks.map(item=>item.id===task.id?{...item,draftAttachments:files}:item)}));
              setRevision(value=>value+1);
              return {attachment,revision:revision+1,nextGuard:JSON.stringify([task.draft,files.map(file=>file.id)])};
            }
          }
          if(path==='/api/tasks/side-thread/create'){const create=()=>{const child={...createTask({title:'Side chat '+input.childId.slice(0,4),objective:input.objective,agentId:'',repositoryId:'scratch'}),id:'side-'+input.childId,draft:input.objective,sideThread:{parentTaskId:input.id,objective:input.objective,contextMessageCount:0,source:'head',permissionCeiling:{permission:'workspace-write'}}};setWorkspace(current=>({...current,tasks:[...current.tasks,child]}));return {id:child.id}};if(window.delaySideSave)return new Promise(resolve=>{window.finishSideSave=()=>resolve(create())});return create()};
          if(path==='/api/tasks/message')return new Promise(resolve=>{window.finishSend=()=>{setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===input.id?{...task,status:'running',messages:[{id:'message',role:'user',text:input.text}]}:task)}));resolve({ok:true})}});
          return {ok:true};
        };
        return <WorkspaceValueProvider value={{workspace,setWorkspace,snapshot,activeRuntimeId:active,switchRuntime:async id=>{setWorkspace(current=>({...current,tasks:id==='mac'?[other]:[],repositories:repositories(id)}));setActive(id)},runtimes:[],runtimeRegistry:{profiles:[]},connected:true,connection:{address:'http://runtime',token:'token'},request,flush:()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())),readCache:{read:async()=>null},refreshRuntimes:async()=>{}}}><TasksView entityId={entity}/></WorkspaceValueProvider>
      }
      const root=createRoot(document.getElementById('app'));window.unmount=()=>root.unmount();root.render(<App/>);
    `,
    resolveDir,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'startup-focus-environment',
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
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('same key'))
      errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.route('http://startup-composer.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>.hidden{display:none}iframe{width:100%;height:560px}</style><div id="app"></div>',
    }),
  )
  await page.goto('http://startup-composer.test')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const draftHeader = page.locator('.studio-thread-pane-frame > .studio-task-thread-header')
  await draftHeader.filter({ hasText: 'New thread' }).waitFor()
  assert.equal(await draftHeader.locator('.studio-pane-shoulder').count(), 1)
  const editor = page.getByLabel('Message thread', { exact: true })
  await editor.waitFor()
  await page.waitForFunction(() => window.commandVersion === 4)
  assert.deepEqual(
    await page.evaluate(() => [window.commandRegistrations, window.commandDisposals]),
    [4, 0],
    'Palette invalidation and a recreated host settle after the four thread commands register',
  )
  assert.equal(
    await page.locator('[data-composer-project]').getAttribute('data-auto-project'),
    'true',
  )
  assert.equal(
    await page.locator('[data-composer-project]').getAttribute('data-model-selection'),
    'smart',
  )
  assert.equal(await page.evaluate(() => window.saved.length), 1)
  // Visible start modes switch the temporary draft directly, without opening a picker or sending.
  const general = page.getByRole('button', { name: 'Start without a project', exact: true })
  const scope = page.getByRole('button', { name: 'Start in Scope', exact: true })
  assert.equal(await scope.getAttribute('aria-pressed'), 'true')
  await general.click()
  assert.equal(await general.getAttribute('aria-pressed'), 'true')
  assert.equal(
    await page.locator('[data-composer-project]').getAttribute('data-auto-project'),
    'false',
  )
  await scope.click()
  assert.equal(await scope.getAttribute('aria-pressed'), 'true')
  assert.equal(
    await page.locator('[data-composer-project]').getAttribute('data-model-selection'),
    'smart',
  )
  assert.equal(await page.evaluate(() => window.saved.length), 1)
  assert.equal(await editor.inputValue(), '')

  await page.getByRole('button', { name: 'Switch project server' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-composer-project]')?.dataset.composerProject ===
      'remote-project',
  )
  await page.getByRole('button', { name: 'Switch project server' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-composer-project]')?.dataset.composerProject ===
      'local-project',
  )
  assert.equal(
    await page.locator('[data-composer-project]').getAttribute('data-auto-project'),
    'false',
  )
  // Typing commits the existing draft, keeps the welcome and focuses the same editor.
  await editor.evaluate((element) => {
    window.draftEditor = element
  })
  await page.getByRole('button', { name: 'More composer actions', exact: true }).click()
  assert.equal(await page.getByRole('navigation', { name: 'Start with a prompt' }).count(), 0)
  await page.keyboard.press('Escape')
  await editor.fill('Help me investigate and fix this issue: ')
  await page.waitForFunction(() => window.saved.length === 2)
  assert.equal(await editor.inputValue(), 'Help me investigate and fix this issue: ')
  assert(
    await editor.evaluate(
      (element) => element === window.draftEditor && document.activeElement === element,
    ),
  )
  assert.equal(
    await page.getByRole('heading', { name: 'What would you like to work on?' }).count(),
    1,
  )
  assert.equal(await page.getByRole('navigation', { name: 'Start with a prompt' }).count(), 0)
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((r) => r.path === '/api/tasks/message').length,
    ),
    0,
  )
  await editor.fill('abcdef')
  await editor.evaluate((element) => {
    window.originalEditor = element
    window.blurs = 0
    element.addEventListener('blur', () => window.blurs++)
    element.setSelectionRange(2, 4, 'backward')
  })
  await page.waitForFunction(
    () => window.saved.length === 2 && window.navigations.some((target) => target.entityId),
  )
  const preserved = await editor.evaluate((element) => ({
    same: element === window.originalEditor,
    focused: document.activeElement === element,
    start: element.selectionStart,
    end: element.selectionEnd,
    direction: element.selectionDirection,
    blurs: window.blurs,
  }))
  assert.deepEqual(preserved, {
    same: true,
    focused: true,
    start: 2,
    end: 4,
    direction: 'backward',
    blurs: 0,
  })
  assert.equal(await page.locator('[data-thread-header]').count(), 1)
  // The runtime detail subscription can arrive after local persistence and routing.
  await page.evaluate(() => window.hydrate())
  await page.waitForTimeout(350)
  assert.equal(
    await editor.evaluate(
      (element) =>
        element === window.originalEditor &&
        document.activeElement === element &&
        element.selectionStart === 2 &&
        element.selectionEnd === 4,
    ),
    true,
  )
  await page.keyboard.type('XY')
  assert.equal(await editor.inputValue(), 'abXYef')
  await page.waitForFunction(() => window.saved.some((task) => task.draft === 'abXYef'))
  // Sending and runtime state changes keep the same composer too.
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.waitForFunction(() => typeof window.finishSend === 'function')
  await page.evaluate(() => {
    window.watchedItems = [
      {
        kind: 'pipeline',
        repositoryId: 'scratch',
        target: '8',
        label: 'Pipeline run 8',
        project: 'Project',
        url: 'https://github.com/team/project/actions/runs/8',
        status: 'running',
      },
    ]
    window.finishSend()
  })
  await page.waitForFunction(() => window.saved.some((task) => task.status === 'running'))
  // Watch controls live in Thread info; runtime updates must not restore the old chat bar.
  assert.equal(
    await page.getByRole('region', { name: 'Related items and watchers', exact: true }).count(),
    0,
  )
  assert.equal(await editor.evaluate((element) => element === window.originalEditor), true)
  await editor.fill('Next input')
  await page.waitForFunction(() => window.saved.some((task) => task.draft === 'Next input'))
  await page.evaluate(() =>
    window.setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === window.navigations.at(-1).entityId
          ? {
              ...task,
              subagents: [
                {
                  id: 'native-claude',
                  sessionId: 'claude-session',
                  provider: 'claude',
                  name: 'Claude reviewer',
                  status: 'completed',
                },
              ],
            }
          : task,
      ),
    })),
  )
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('button', { name: 'Open native Claude thread', exact: true }).click()
  await page.getByText('Claude native answer', { exact: true }).waitFor()
  assert.equal(
    await page.locator('[aria-label="Workspace tools"] [data-native-thread-main]').count(),
    0,
  )
  assert.equal(await page.locator('[data-native-thread-main] [data-native-role="user"]').count(), 1)
  assert.equal(await editor.isVisible(), false)
  const nativeRead = await page.evaluate(() =>
    window.requests.findLast((request) => request.path === '/api/tasks/native-thread'),
  )
  assert.equal(nativeRead.input.provider, 'claude')
  assert.equal(nativeRead.input.sessionId, 'claude-session')
  assert.equal(nativeRead.input.id, 'native-claude')
  await page.getByRole('button', { name: 'Back to agents', exact: true }).click()
  await editor.waitFor()
  assert.equal(await editor.inputValue(), 'Next input')
  assert.equal(await editor.evaluate((element) => element === window.originalEditor), true)
  // The shortcut was registered before this thread existed; it must use the current thread.
  const sideTask = await page.locator('[data-thread-header]').getAttribute('data-thread-header')
  await editor.fill('Shortcut from the current thread')
  await page.keyboard.press('ControlOrMeta+;')
  await page.waitForFunction(() =>
    window.requests.some((request) => request.path === '/api/tasks/side-thread/create'),
  )
  const sideRequest = await page.evaluate(() =>
    window.requests.findLast((request) => request.path === '/api/tasks/side-thread/create'),
  )
  assert.equal(sideRequest.input.id, sideTask)
  assert.equal(sideRequest.input.objective, 'Shortcut from the current thread')
  // The draft side chat opens beside its parent as a normal, unsent thread.
  const besideParent = page.locator('section[aria-label^="Side by side: Side chat"]')
  await besideParent.waitFor()
  assert.equal(await besideParent.getByText('Side chat ·', { exact: true }).count(), 1)
  // Its own composer holds the question for review; the parent composer is cleared.
  assert.equal(
    await besideParent.getByLabel('Message thread', { exact: true }).inputValue(),
    'Shortcut from the current thread',
  )
  assert.equal(await page.locator(`textarea[data-task-id="${sideTask}"]`).inputValue(), '')
  assert.equal(
    await page.evaluate(() =>
      window.requests.some(
        (request) => request.path === '/api/tasks/message' && request.input.id.startsWith('side-'),
      ),
    ),
    false,
  )
  await besideParent.getByRole('button', { name: /Close side-by-side thread/ }).click()
  // A late save must not open the panel for a different thread after navigation.
  await editor.fill('Question before switching threads')
  await page.evaluate(() => {
    window.delaySideSave = true
  })
  await page.keyboard.press('ControlOrMeta+;')
  await page.waitForFunction(() => typeof window.finishSideSave === 'function')
  await page.getByRole('button', { name: 'Existing · draft', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('[data-thread-header]')?.textContent.startsWith('Existing'),
  )
  await page.evaluate(() => window.finishSideSave())
  await page.waitForFunction(() =>
    window.saved.some(
      (task) => task.sideThread && task.draft === 'Question before switching threads',
    ),
  )
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  assert.equal(await page.locator('section[aria-label^="Side by side"]').count(), 0)
  assert.equal(await page.locator('[data-side-task]').count(), 0)
  assert.ok((await page.locator('[data-thread-header]').textContent()).startsWith('Existing'))
  // Leaving an untouched new thread discards it without creating another persisted task.
  await page.evaluate(() => window.commands.get('tasks.new')())
  await page.waitForFunction(() => document.querySelector('textarea') !== window.originalEditor)
  const count = await page.evaluate(() => window.saved.length)
  await page.getByRole('button', { name: 'Existing · draft', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('[aria-current=true]')?.textContent.includes('New thread'),
  )
  assert.equal(await page.evaluate(() => window.saved.length), count)
  const image = {
    name: 'first-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJc0AAAAASUVORK5CYII=',
      'base64',
    ),
  }
  const imageEditor = page.frameLocator('iframe[title="Image editor"]')
  const attachments = page.locator('input[aria-label="Choose attachments"]:not(.hidden *)')
  // Start a task from the first attachment, with no text to commit it first.
  await page.evaluate(() => window.commands.get('tasks.new')())
  await page.waitForFunction(
    () =>
      !window.saved.some((task) => task.id === document.querySelector('textarea')?.dataset.taskId),
  )
  const startupId = await page.locator('textarea').getAttribute('data-task-id')
  await attachments.setInputFiles(image)
  await imageEditor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(
    (id) => window.saved.find((task) => task.id === id)?.draftAttachments?.length === 1,
    startupId,
  )
  await page.getByRole('button', { name: 'Existing · draft', exact: true }).click()
  // The guard must include text typed before opening the editor, even if the draft debounce
  // would otherwise send that text while the editor is open.
  await page.locator('textarea').fill('Add this to the first image')
  await attachments.setInputFiles(image)
  await imageEditor.getByRole('button', { name: 'Use original', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      window.saved.find((task) => task.title === 'Existing')?.draft ===
      'Add this to the first image',
  )
  await imageEditor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(
    () => window.saved.find((task) => task.title === 'Existing')?.draftAttachments?.length === 1,
  )
  // A change from another device while the editor is open still invalidates the guard.
  await attachments.setInputFiles(image)
  await imageEditor.getByRole('button', { name: 'Use original', exact: true }).waitFor()
  await page.evaluate(() =>
    window.setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.title === 'Existing' ? { ...task, draft: 'Edited on another device' } : task,
      ),
    })),
  )
  await page.waitForFunction(
    () =>
      window.saved.find((task) => task.title === 'Existing')?.draft === 'Edited on another device',
  )
  await imageEditor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'The draft changed' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.saved.find((task) => task.title === 'Existing').draftAttachments.length,
    ),
    1,
  )
  await page.locator('textarea').fill('')
  // Exercise both reference producers through the actual TasksView → conversation → composer.
  const existingId = await page.locator('[data-thread-header]').getAttribute('data-thread-header')
  const switchThread = async (id) => {
    await page.evaluate((id) => window.setEntity(id), id)
    await page.waitForFunction(
      (id) => document.querySelector('[data-thread-header]')?.dataset.threadHeader === id,
      id,
    )
  }
  await page.evaluate(
    (id) =>
      window.setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === id
            ? { ...task, files: [{ path: 'src/example.ts', before: 'old', after: 'new' }] }
            : task,
        ),
      })),
    existingId,
  )
  for (const kind of ['diff', 'file']) {
    await editor.fill('Review selected code')
    await page.getByRole('button', { name: `Show ${kind} fixture`, exact: true }).click()
    await page
      .getByRole('button', { name: `Add ${kind} reference to composer`, exact: true })
      .click()
    const expected = `Review selected code\n\nSelected ${kind} reference`
    await page.waitForFunction(
      (expected) => document.querySelector('textarea')?.value === expected,
      expected,
    )
    await switchThread(sideTask)
    assert.ok(
      !(await editor.inputValue()).includes(`Selected ${kind} reference`),
      'Reference leaked into another thread',
    )
    await switchThread(existingId)
    assert.equal(
      await editor.inputValue(),
      expected,
      'Reference was added again on returning to the thread',
    )
    await editor.fill('')
    await switchThread(sideTask)
    await switchThread(existingId)
    assert.equal(
      await editor.inputValue(),
      '',
      'Deleted code reference came back after switching threads',
    )
  }
  assert.deepEqual(
    await page.evaluate(() => [window.commandRegistrations, window.commandDisposals]),
    [4, 0],
    'Navigation, hydration and continued typing do not churn command subscriptions',
  )
  await page.evaluate(() => window.replaceCommandRegistry())
  await page.waitForFunction(() => window.commandRegistrations === 8)
  assert.equal(await page.evaluate(() => window.commandDisposals), 4)
  await page.evaluate(() => window.unmount())
  assert.deepEqual(
    await page.evaluate(() => [window.commands.size, window.commandDisposals]),
    [0, 8],
    'Replacing the registry and unmounting both release their command subscriptions',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Actual startup composer retains focus and selection through persistence, routing, hydration and sending. First images attach to empty and recently edited drafts through the image editor. Changes from another device invalidate the guard. Side chats respect navigation, untouched drafts discard, and inserted references stay deleted across thread switches.',
  )
} finally {
  await browser.close()
}
