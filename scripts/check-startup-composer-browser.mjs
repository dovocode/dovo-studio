import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/protocol': `export * from '../protocol/src/index';export const watchRuntimeTask=()=>()=>{};`,
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref]}`,
  '@dovo/studio-core': `
    export * from '@dovo/protocol';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceValueProvider,useWorkspaceSelector,sameWorkspaceFields} from '../studio-core/src/workspace/selector';
    export {useCachedTask} from '../studio-core/src/workspace/use-cached-task';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const useStudioHost=()=>window.host;
    export const readAppPreferences=()=>({taskSort:'priority',taskGrouping:'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled'],followUp:'queue'});
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
    export const Button=({children,onClick,disabled,type,...props})=><button aria-label={props['aria-label']} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
    export const IconButton=({children,label,onClick})=><button aria-label={label} onClick={onClick}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const ComposerSurface=({children,toolbar,actions,footer,onSubmit})=><form onSubmit={onSubmit}>{toolbar}{children}{actions}{footer}</form>;
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
  './detail/task-header': `export const TaskHeader=({task,onSurface})=><header data-thread-header={task.id}>{task.title}<button onClick={()=>onSurface('agents')}>Agents</button><button onClick={()=>onSurface('changes')}>Show diff fixture</button><button onClick={()=>onSurface('files')}>Show file fixture</button></header>;`,
  './detail/task-agents': `export const TaskAgents=({task,onOpenThread})=><button onClick={()=>onOpenThread({taskId:task.id,agent:task.subagents[0]})}>Open native Claude thread</button>;`,
  '../chat/thread/chat-thread': `export const ChatThread=({task})=><div data-chat-id={task.id}>{task.messages.map(message=><p key={message.id}>{message.text}</p>)}</div>;`,
  '../chat/artifact-open-context': 'export const ArtifactOpenContext=({children})=>children;',
  '../chat/thread/use-task-viewed': 'export const useTaskViewed=()=>({error:null});',
  './detail/live-refresh': 'export const useLiveRefresh=()=>null;',
}
for (const [path, names] of [
  ['@dovo/extension-scm/pull-detail', ['PullDetail']],
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
  ['./chat/thread/side-question', ['SideQuestion']],
  ['../chat/thread/message-queue', ['MessageQueue']],
  ['../chat/thread/task-questions', ['TaskQuestions']],
  ['../chat/actions/run-controls', ['RunControls']],
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
  ['./composer-workspace', ['ComposerWorkspace']],
  ['../chat/composer/composer-workspace', ['ComposerWorkspace']],
])
  mocks[path] = names.map((name) => `export const ${name}=()=>null;`).join('\n')

mocks['./review/review-pane'] =
  `export const ReviewPane=({onReference})=><button onClick={()=>onReference('Selected diff reference')}>Add diff reference to composer</button>;`
mocks['./detail/task-files'] =
  `export const TaskFiles=({onReference})=><button onClick={()=>onReference('Selected file reference')}>Add file reference to composer</button>;`

mocks['./chat/thread/side-question'] =
  `export const SideQuestion=({task,selectedChatId})=><div data-side-chat={selectedChatId??''} data-side-task={task.id}>Side question panel</div>;`

// Exercise remote selection through the real TasksView/StartupDraft boundary.
mocks['../chat/composer/composer-workspace'] = `
  import {useWorkspace} from '@dovo/studio-core';
  export const ComposerWorkspace=({task,onSelectRemote})=>{
    const store=useWorkspace();
    return <div data-composer-project={task.repositoryId}><button onClick={()=>onSelectRemote({runtimeId:store.activeRuntimeId==='mac'?'remote':'mac'}, {id:store.activeRuntimeId==='mac'?'remote-project':'local-project'})}>Switch project server</button></div>;
  };
`

const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {WorkspaceValueProvider,createTask} from '@dovo/studio-core';
      import TasksView from '../extension-tasks/src/view';
      window.requests=[];window.navigations=[];window.commands=new Map();
      window.host={navigate:target=>{window.navigations.push(target);window.setEntity(target.entityId)},registerCommand:command=>{window.commands.set(command.id,command.run);return ()=>window.commands.delete(command.id)}};
      const other=createTask({title:'Existing',objective:'',agentId:'',repositoryId:'scratch'});
      function App(){
        const [entity,setEntity]=useState(),[revision,setRevision]=useState(0),[active,setActive]=useState('mac');
        const repositories=id=>[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''},{id:id==='mac'?'local-project':'remote-project',name:'Shared project',path:'/project',branch:'main'}];
        const [workspace,setWorkspace]=useState({tasks:[other],agents:[],skills:[],mcpServers:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]});
        window.setEntity=setEntity;window.saved=workspace.tasks;window.setWorkspace=setWorkspace;
        const snapshot={questions:[],approvals:[],defaults:{},detailTaskIds:revision?workspace.tasks.map(task=>task.id):[]};
        window.hydrate=()=>setRevision(value=>value+1);
        const request=async(path,input)=>{
          if(path==='/api/tasks/waiting')return {dependencies:window.watchedItems??[]};
          window.requests.push({path,input});
          if(path==='/api/tasks/native-thread')return {entries:[{id:'native-prompt',role:'user',text:'Claude native prompt'},{id:'native-answer',role:'assistant',text:'Claude native answer'}]};
          if(path==='/api/tasks/title')return {title:'New task'};
          if(path==='/api/tasks/side-chat/save'){if(window.delaySideSave)return new Promise(resolve=>{window.finishSideSave=()=>resolve({id:'side-'+input.id})});return {id:'side-'+input.id}};
          if(path==='/api/tasks/side-chat/ask')return {answer:'Side answer'};
          if(path==='/api/tasks/message')return new Promise(resolve=>{window.finishSend=()=>{setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===input.id?{...task,status:'running',messages:[{id:'message',role:'user',text:input.text}]}:task)}));resolve({ok:true})}});
          return {ok:true};
        };
        return <WorkspaceValueProvider value={{workspace,setWorkspace,snapshot,activeRuntimeId:active,switchRuntime:async id=>{setWorkspace(current=>({...current,tasks:id==='mac'?[other]:[],repositories:repositories(id)}));setActive(id)},runtimes:[],runtimeRegistry:{profiles:[]},connected:true,connection:{address:'http://runtime',token:'token'},request,flush:async()=>{},readCache:{read:async()=>null},refreshRuntimes:async()=>{}}}><TasksView entityId={entity}/></WorkspaceValueProvider>
      }
      createRoot(document.getElementById('app')).render(<App/>);
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
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<style>.hidden{display:none}</style><div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const editor = page.getByLabel('Message task', { exact: true })
  await editor.waitFor()
  assert.equal(await page.evaluate(() => window.saved.length), 1)
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
  await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).waitFor()
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
  await page.keyboard.press('Control+;')
  await page.waitForFunction(() =>
    window.requests.some((request) => request.path === '/api/tasks/side-chat/ask'),
  )
  const sideRequest = await page.evaluate(() =>
    window.requests.findLast((request) => request.path === '/api/tasks/side-chat/ask'),
  )
  assert.deepEqual(sideRequest.input, {
    id: sideTask,
    chatId: 'side-' + sideTask,
    question: 'Shortcut from the current thread',
  })
  await page.locator('[data-side-chat="side-' + sideTask + '"]').waitFor()
  assert.equal(await editor.inputValue(), '')
  // A late save must not open the panel for a different thread after navigation.
  await editor.fill('Question before switching threads')
  await page.evaluate(() => {
    window.delaySideSave = true
  })
  await page.keyboard.press('Control+;')
  await page.waitForFunction(() => typeof window.finishSideSave === 'function')
  await page.getByRole('button', { name: 'Existing · draft', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('[data-thread-header]')?.textContent.startsWith('Existing'),
  )
  await page.evaluate(() => window.finishSideSave())
  await page.waitForFunction(
    () =>
      window.requests.filter((request) => request.path === '/api/tasks/side-chat/ask').length === 2,
  )
  assert.equal(await page.locator('[data-side-task]').count(), 0)
  assert.ok((await page.locator('[data-thread-header]').textContent()).startsWith('Existing'))
  // Leaving an untouched new thread discards it without creating another persisted task.
  await page.evaluate(() => window.commands.get('tasks.new')())
  await page.waitForFunction(() => document.querySelector('textarea') !== window.originalEditor)
  const count = await page.evaluate(() => window.saved.length)
  await page.getByRole('button', { name: 'Existing · draft', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('[aria-current=true]')?.textContent.includes('New task'),
  )
  assert.equal(await page.evaluate(() => window.saved.length), count)
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
  assert.deepEqual(errors, [])
  console.log(
    'Actual TasksView, StartupDraft, TaskConversation, Composer and ComposerEditor retain the textarea, focus and backward selection through persistence, routing, delayed hydration, sending and continued typing; side-chat shortcuts target the current thread and late saves respect navigation; untouched drafts still discard; diff and file references are inserted once and stay deleted across thread switches.',
  )
} finally {
  await browser.close()
}
