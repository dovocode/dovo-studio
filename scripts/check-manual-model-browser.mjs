import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/protocol': `export * from '../protocol/src/index';export const watchRuntimeTask=()=>()=>{};`,
  '@dovo/studio-core/state': `export * from '../studio-core/src/runtime/application-state';`,
  '@dovo/studio-core': `
    export * from '@dovo/protocol';export {providers} from '../studio-core/src/providers';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {useCachedTask} from '../studio-core/src/workspace/use-cached-task';
    export const WorkspaceScope=({children})=>children;
    export const useStudioHost=()=>window.host;
    export const readAppPreferences=()=>({taskSort:'priority',taskGrouping:'status',workingSection:true,followUp:'queue'});
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=()=>{};
    export const useResolvedTheme=()=> 'dark';
    export {studioSyntaxTheme} from '../studio-core/src/themes';

    export const formatDateTime=value=>value;
  `,
  '../../dialogs/harness-dialog': 'export const HarnessDialog=()=>null;',
  '@dovo/studio-ui': `
    export {ComposerSettingsControls} from '../studio-ui/src/composer-settings-controls';
    export const cn=(...values)=>values.filter(Boolean).join(' ');
    export const useCompactLayout=()=>false;
    const Box=({children})=><div>{children}</div>;
    export const ResizablePanel=Box,ResizablePanelGroup=Box,ResizableHandle=()=>null;
    export const Dialog=({open,children})=>open?<div>{children}</div>:null;
    export const DialogContent=Box,DialogTitle=Box,DialogDescription=Box,DialogHeader=Box,ComposerWorkspaceBar=Box;
    export const ModelSettings=()=>null;
    export const ProjectIcon=()=>null;
    export {Button} from '../studio-ui/src/components/ui/button';
    export const IconButton=({children,label,onClick})=><button aria-label={label} onClick={onClick}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export {ComposerSurface,ComposerSubmit,ComposerTextarea} from '../studio-ui/src/composer-surface';
    export const ContextMenu={Label:Box,Sub:Box,SubTrigger:Box,Portal:Box,SubContent:Box,Item:Box};
    export * as DropdownMenu from '@radix-ui/react-dropdown-menu';
    export * as Popover from '@radix-ui/react-popover';
  `,
  './use-attachments': `export const useAttachments=task=>({files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:()=>{},remove:()=>{}});`,
  './task-row': `export const TaskRow=({task,selected,onSelect})=><button data-row-id={task.id} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './detail/resizable-sidebar':
    'export const ResizableSidebar=({children,className})=><div className={className}>{children}</div>;',
  './detail/task-header': `export const TaskHeader=({task})=><header data-thread-header={task.id}>{task.title}</header>;`,
  '../chat/thread/chat-thread': `export const ChatThread=({task})=><div data-chat-id={task.id}>{task.messages.map(message=><p key={message.id}>{message.text}</p>)}</div>;`,
  '../chat/artifact-open-context': 'export const ArtifactOpenContext=({children})=>children;',
  '../chat/thread/use-task-viewed': 'export const useTaskViewed=()=>({error:null});',
  './detail/live-refresh': 'export const useLiveRefresh=()=>null;',
}
for (const [path, names] of [
  ['@dovo/extension-scm/pull-detail', ['PullDetail']],
  ['@dovo/extension-scm/projects', ['ProjectsMenu']],
  ['./detail/task-tools', ['TaskTools']],
  ['./detail/task-agents', ['TaskAgents']],
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
  ['../dialogs/task-pull-link-dialog', ['TaskPullLinkDialog']],
  ['./attachment-picker', ['AttachmentPicker']],
  ['./message-attachments', ['MessageAttachments']],
  ['./composer-command-dialog', ['ComposerCommandDialog']],
  ['../../dialogs/saved-prompts-dialog', ['SavedPromptsDialog']],
  ['../thread/context-meter', ['ContextMeter']],
  ['@dovo/extension-scm/repository-dialog', ['RepositoryDialog']],
])
  mocks[path] = names.map((name) => `export const ${name}=()=>null;`).join('\n')
for (const path of ['./composer-workspace', '../chat/composer/composer-workspace'])
  mocks[path] =
    `import {ComposerProject} from '../extension-tasks/src/chat/composer/composer-project';export const ComposerWorkspace=props=><ComposerProject {...props} onMoving={props.onMachineMoving}/>;`

const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';import {useApplicationState,ApplicationStateProvider} from '@dovo/studio-core/state';import {createRoot} from 'react-dom/client';
      import {WorkspaceContext,createTask} from '@dovo/studio-core';
      import TasksView from '../extension-tasks/src/view';
      import {TaskLauncherForm} from '../studio-shell/src/task-launcher';
      window.requests=[];window.navigations=[];window.commands=new Map();
      window.host={navigate:target=>{window.navigations.push(target);window.setEntity(target.entityId)},registerCommand:command=>{window.commands.set(command.id,command.run);return ()=>window.commands.delete(command.id)}};
      const other=createTask({title:'Existing',objective:'',agentId:'',repositoryId:'scratch'});
      function App(){
        const [entity,setEntity]=useState(),[revision,setRevision]=useState(0);
        const [workspace,setWorkspace]=useApplicationState({tasks:[other],agents:[],skills:[],mcpServers:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''},{id:'project',name:'Project with Sonnet default',path:'/project',branch:'main',taskDefaults:{harness:{provider:'claude',model:'sonnet',permission:'full-access',endpoint:'',instructions:''}}}]});
        window.setEntity=setEntity;window.saved=workspace.tasks;window.setWorkspace=setWorkspace;
        const snapshot={workspace,questions:[],approvals:[],defaults:{harness:{provider:window.defaultProvider,model:'default',permission:'full-access',endpoint:'',instructions:''}},detailTaskIds:revision?workspace.tasks.map(task=>task.id):[]};
        window.hydrate=()=>setRevision(value=>value+1);
        const request=async(path,input)=>{
          window.requests.push({path,input});
          if(path==='/api/agents/availability')return [{id:'harness:codex',available:true},{id:'harness:claude',available:true}];
          if(path==='/api/agents/models')return {models:[{id:'default',name:'Default (recommended)',isDefault:true},{id:'opus',name:'Opus 5.5'},{id:'sonnet',name:'Sonnet 5.5'}],reasoning:[]};
          if(path==='/api/tasks/title')return {title:'New task'};
          if(path==='/api/workspace'){setWorkspace(current=>({...current,tasks:[input.create,...current.tasks]}));return {revision:1};}
          if(path==='/api/tasks/message')return new Promise(resolve=>{window.finishSend=()=>{setWorkspace(current=>({...current,tasks:current.tasks.map(task=>task.id===input.id?{...task,status:'running',draft:'',providerLock:'claude',messages:[{id:input.messageId,role:'user',text:input.text}]}:task)}));resolve({ok:true})}});
          return {ok:true};
        };
        const readRuntime=async(_profile,path,input)=>path==='/api/snapshot'?snapshot:request(path,input);
        return <WorkspaceContext.Provider value={{workspace,setWorkspace,snapshot,activeRuntimeId:window.invalidRuntime?'removed':'mac',runtimes:[],runtimeRegistry:{profiles:[{id:'mac',name:'This computer',connection:{address:'http://runtime',token:'token'}}]},readRuntime,connected:true,connection:{address:'http://runtime',token:'token'},request,flush:async()=>{},readCache:{read:async()=>null},refreshRuntimes:async()=>{}}}>{window.launcher?<TaskLauncherForm bridge={{subscribe:()=>()=>{},dismiss:async()=>{}}}/>:<TasksView entityId={entity}/>}</WorkspaceContext.Provider>
      }
      createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);
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
  for (const fixture of [
    { defaultProvider: 'claude', selectBeforeTyping: true },
    { defaultProvider: 'claude', selectBeforeTyping: false },
    { defaultProvider: 'codex', selectBeforeTyping: true },
    { defaultProvider: 'claude', selectBeforeTyping: true, selectProject: true },
    { defaultProvider: 'claude', selectBeforeTyping: true, selectProject: true, launcher: true },
    { defaultProvider: 'claude', selectBeforeTyping: true, launcher: true, invalidRuntime: true },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    const assets = new URL('../apps/desktop/dist/assets/', import.meta.url)
    for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
      await page.addStyleTag({ content: await readFile(new URL(file, assets), 'utf8') })
    await page.evaluate((fixture) => {
      window.defaultProvider = fixture.defaultProvider
      window.launcher = fixture.launcher
      window.invalidRuntime = fixture.invalidRuntime
    }, fixture)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const editor = page.getByLabel(fixture.launcher ? 'Task prompt' : 'Message task', {
      exact: true,
    })
    if (!fixture.selectBeforeTyping) await editor.fill('Use my chosen Claude model')
    if (fixture.launcher)
      assert.equal(await page.getByRole('combobox', { name: 'Server', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Choose agent and model' }).click()
    if (fixture.defaultProvider !== 'claude')
      await page.getByRole('button', { name: 'Claude models', exact: true }).click()
    await page.getByRole('option', { name: /Opus 5.5/ }).click()
    const picker = page.getByRole('button', { name: 'Choose agent and model' })
    await page.waitForFunction(() =>
      document
        .querySelector('button[aria-label="Choose agent and model"]')
        .textContent.includes('Opus 5.5'),
    )
    if (fixture.selectBeforeTyping) await editor.fill('Use my chosen Claude model')
    if (!fixture.launcher) await page.waitForFunction(() => window.saved.length === 2)
    if (fixture.selectProject) {
      if (fixture.launcher)
        await page
          .getByRole('combobox', { name: 'Project', exact: true })
          .selectOption({ label: 'Project with Sonnet default' })
      else {
        await page.getByRole('button', { name: 'Task project' }).click()
        await page.getByRole('button', { name: 'Project with Sonnet default' }).click()
        await page.waitForFunction(() =>
          window.saved.some((task) => task.repositoryId === 'project'),
        )
      }
      assert.match(await picker.textContent(), /Opus 5.5/)
    }
    if (fixture.launcher)
      await page.getByRole('button', { name: 'Start task', exact: true }).click()
    else await editor.press('Enter')
    await page.waitForFunction(() => typeof window.finishSend === 'function')
    assert.equal(
      await page.evaluate(() => window.saved.find((task) => task.harness)?.harness?.model),
      'opus',
    )
    await page.evaluate(() => window.finishSend())
    await page.waitForFunction(() => window.saved.some((task) => task.status === 'running'))
    if (!fixture.launcher) assert.match(await picker.textContent(), /Opus 5.5/)
    assert.equal(
      await page.evaluate(
        () => window.saved.find((task) => task.status === 'running')?.harness?.model,
      ),
      'opus',
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Actual desktop Claude picker and quick launcher keep Opus 5.5 through project selection and the first send, whether selected before/after typing or after switching from Codex.',
  )
} finally {
  await browser.close()
}
