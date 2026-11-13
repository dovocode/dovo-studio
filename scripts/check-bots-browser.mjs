import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/studio-ui/resource-editors': `export const McpEditor=()=>null;export const SkillEditor=({onSave})=><button onClick={()=>onSave({name:'bot-skill',description:'Test',content:'Test body',enabled:true})}>Save fixture Bot skill</button>;`,
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
  '@dovo/studio-core': `export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    export * from '@dovo/protocol';
    export {composerRecoveryKey,createComposerRecovery,composerCaretRecoveryKey} from '../studio-core/src/workspace/composer-recovery';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceValueProvider,useWorkspaceSelector,sameWorkspaceFields} from '../studio-core/src/workspace/selector';
    export {useCachedTask} from '../studio-core/src/workspace/use-cached-task';
    export {useTaskWaiting} from '../studio-core/src/use-task-waiting';
    export const useStudioHost=()=>window.host;
    export const WorkspaceScope=({children})=>children;
    export const readAppPreferences=()=>({projectPanelOpen:false,runtimeDictationIds:[],taskSort:'priority',taskGrouping:'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled'],threadInfoSections:{},followUp:'queue'});
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=()=>{};
    export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});
    export const formatDateTime=value=>value;
  `,
  '@dovo/studio-ui': `
export {Card} from '@dovo/web-ui/card';
export {ConversationHistory,useConversationHistory} from '../studio-ui/src/components/ai-elements/conversation';
export {SearchField} from './src/search-field';
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
    export const ResizablePanel=({children})=><div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>,ResizablePanelGroup=({children,className})=><div className={"flex min-h-0 "+(className??"")}>{children}</div>,ResizableHandle=()=>null;
    export const Dialog=({open,children})=>open?<div>{children}</div>:null;
    export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box,DialogFooter=Box;
    export const ProjectIcon=()=>null;
    export {Button} from '@dovo/web-ui/button';
    export const IconButton=({children,label,className,...props})=><button aria-label={label} title={label} {...props}>{children}</button>;
    export {Input} from '@dovo/web-ui/input';
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const ComposerSurface=({children,controls,leadingActions,actions,onSubmit})=><form onSubmit={onSubmit}>{children}{leadingActions}{controls}{actions}</form>;
    export const ComposerSubmit=props=><button {...props}/>;
    export const ComposerTextarea=props=><textarea {...props}/>;
    export const ContextMenu={Label:Box,Sub:Box,SubTrigger:Box,Portal:Box,SubContent:Box,Item:Box};
  `,
  './use-attachments': `export const useAttachments=task=>({submissionFiles:task.draftAttachments??[],failedUploads:[],canSubmitWhileUploading:false,waitForUploads:async()=>{},files:task.draftAttachments??[],previews:[],uploading:[],busy:false,error:'',upload:()=>{},remove:()=>{}});`,
  './task-row': `export const TaskRow=({task,selected,onSelect})=><button data-row-id={task.id} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './detail/resizable-sidebar':
    'export const ResizableSidebar=({children,className,resizable=true,side})=><div style={resizable?{width:side==="right"?360:260,maxWidth:side==="right"?"45%":"30%",flexShrink:0}:undefined} className={className}>{children}</div>;',
  './detail/task-project-panel': 'export const TaskProjectPanel=()=>null;',
  './detail/task-tools': `export const TaskTools=({task,surface,onSelect})=>task.bot?<button onClick={()=>onSelect(surface==='bot-settings'?'chat':'bot-settings')}>Bot settings</button>:null;`,
  './detail/task-header': `export const TaskHeader=({task,onSurface})=><header data-thread-header={task.id}>{task.title}<button onClick={()=>onSurface('side-chats')}>Open side chats</button></header>;`,
  './detail/task-agents': `export const TaskAgents=({task,onOpenThread})=><button onClick={()=>onOpenThread({taskId:task.id,agent:task.subagents[0]})}>Open native Claude thread</button>;`,
  '../chat/thread/chat-thread': `import {TaskEmptyState} from '../extension-tasks/src/task-creation/task-empty-state';export const ChatThread=({task,emptyState})=>task.status==='draft'&&!task.messages.length?(emptyState??<TaskEmptyState task={task}/>):<div className="min-h-0 flex-1 overflow-auto p-4" data-chat-id={task.id}>{task.messages.map(message=><p key={message.id}>{message.text}</p>)}</div>;`,
  '../chat/artifact-open-context': 'export const ArtifactOpenContext=({children})=>children;',
  '../chat/thread/use-task-viewed': 'export const useTaskViewed=()=>({error:null});',
}
for (const [path, names] of [
  ['@dovo/extension-scm/project-transfer', ['ProjectTransferDialog']],
  ['@dovo/extension-scm/projects', ['ProjectsMenu']],
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

// Retain the real TasksView, TaskRow, composer, harness persistence and Bot panels.
// Mock transport, native previews and visual shells only.
delete mocks['./task-row']
mocks['../detail/task-lifecycle-actions'] = 'export const TaskLifecycleActions=()=>null;'
mocks['./nested-threads'] = 'export const NestedThreads=()=>null;'
mocks['./thread-watch-summary'] = 'export const ThreadWatchSummary=()=>null;'
mocks['../detail/resizable-sidebar'] =
  'export const ResizableSidebar=({children})=><aside>{children}</aside>;'
mocks['@dovo/studio-core'] += `
export {providers} from '../studio-core/src/providers';export const useModelCatalog=()=>({models:[]});
export const resolveTaskDefaults=()=>({harness:{provider:'codex',model:'model',permission:'workspace-write',endpoint:'',args:[],instructions:'',skills:[],mcpServers:[],reasoning:''}});
export const defaultAppPreferences={};
`
mocks['@dovo/studio-core'] = mocks['@dovo/studio-core'].replace(
  "export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});",
  "export const resolveTaskAgent=task=>task.harness??({provider:'codex',model:'model',permission:'workspace-write',instructions:'',reasoning:'',args:[],endpoint:'',skills:[],mcpServers:[]});",
)
mocks['@dovo/studio-ui'] += `
export const Checkbox=props=><input type="checkbox" {...props}/>;export const LinkedCheckoutEditor=()=>null;export {Textarea} from '@dovo/web-ui/textarea';
export const Switch=({checked,onCheckedChange,...props})=><input {...props} type="checkbox" checked={checked} onChange={event=>onCheckedChange(event.target.checked)}/>;
export {FormField} from './src/components/form-field';
export const AgentAvatar=()=>null;export const useModelLabel=(_provider,model)=>model;
export const Tooltip=({children})=>children;export const TooltipTrigger=({children})=>children;export const TooltipContent=()=>null;
export const HarnessFields=({value,onChange})=><label>Harness<select aria-label="Harness" value={value.provider} onChange={event=>onChange({...value,provider:event.target.value})}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>;
export const ComposerSettingsControls=({value,onChange,renderControls})=>renderControls?.({model:<button type="button" onClick={()=>onChange({...value,model:'next-model'})}>Change Bot model</button>,access:<button type="button" onClick={()=>onChange({...value,permission:'read-only'})}>Set Bot read-only</button>});
`
// Exercise the real mutation controls; only model menus and native handoff discovery are shells.
delete mocks['./composer-harness-controls']
mocks['./inline-harness-handoff'] =
  'export const useInlineHarnessHandoff=()=>({available:false,busy:false,notice:null});'
mocks['../../dialogs/harness-dialog'] = 'export const HarnessDialog=()=>null;'

const built = await build({
  conditions: ['development'],
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceValueProvider,createTask} from '@dovo/studio-core';
import {botCreateSchema,botUpdateSchema,botLifecycleSchema,memoryListRequestSchema,decode,randomUUID} from '@dovo/protocol';
import BotsView from '../extension-tasks/src/bots/view';
import TasksView from '../extension-tasks/src/view';
import {NodeInspector} from '../extension-jobs/src/node-inspector';
import {ContinueElsewhereDialog} from '../extension-tasks/src/dialogs/continue-elsewhere-dialog';
import {TaskEmptyState} from '../extension-tasks/src/task-creation/task-empty-state';
window.calls=[];window.failCreate=false;window.failUpdate=false;window.commands=new Map();window.notes={};
const harness={provider:'codex',model:'model',permission:'workspace-write',endpoint:'',args:[],instructions:'',skills:[],mcpServers:[],reasoning:''};
const metadata=()=>({role:'Release assistant',responsibilities:'Review releases',state:'active',revision:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const task=(id,title,bot)=>({...createTask({title,objective:'',agentId:'',repositoryId:'scratch',harness}),id,status:'review',draft:'',...(bot?{bot:metadata()}:{})});
const workspace=owner=>({version:1,runtimeAddress:'http://'+owner+'.lan',tasks:[task('bot','Release Bot '+owner,true),task('chat','Normal chat '+owner,false),{...task('child','Delegated work '+owner,false),delegation:{parentTaskId:'bot',parentRunId:'run',key:'child',fingerprint:'x'}}],agents:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}],automations:[]});
const initial={one:workspace('one'),two:workspace('two')};
function App(){
 const [all,setAll]=useState(initial),[owner,setOwner]=useState('one'),[route,setRoute]=useState({viewId:'bots'}),[offline,setOffline]=useState(false),[supported,setSupported]=useState(true),[version,setVersion]=useState(0),[inspector,setInspector]=useState(false),[move,setMove]=useState(false);window.inspectMove=setMove;
 window.host={navigate:target=>setRoute(target),registerCommand:command=>{window.commands.set(command.id,command.run);return ()=>window.commands.delete(command.id)}};
 window.externalRole=()=>setAll(before=>({...before,[owner]:{...before[owner],tasks:before[owner].tasks.map(t=>t.id==='bot'?{...t,bot:{...t.bot,role:'External role',revision:randomUUID()}}:t)}}));window.fresh=(scratch=true)=>{window.pairVersion=(window.pairVersion??0)+1;setInspector(false);setRoute({viewId:'bots'});setAll(before=>({...before,[owner]:{...before[owner],tasks:[],repositories:scratch?[{id:'dovo:scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]:[]}}));setVersion(v=>v+1)};window.setOwner=setOwner;window.setOffline=setOffline;window.setSupported=setSupported;window.route=setRoute;window.remount=()=>setVersion(v=>v+1);window.inspect=setInspector;
 const current=all[owner];window.all=all;window.owner=owner;
 const setWorkspace=useCallback(update=>setAll(before=>({...before,[owner]:typeof update==='function'?update(before[owner]):update})),[owner]);
 const rpc=useCallback(async(target,path,input,schema)=>{
  window.calls.push({owner:target,path,input:JSON.parse(JSON.stringify(input??{}))});
  const current=all[target];const found=current.tasks.find(t=>t.id===input?.id);const bot=found?.bot;
  if(path==='/api/tasks/waiting')return {dependencies:[]};
  if(path==='/api/tasks/message'){setAll(before=>({...before,[target]:{...before[target],tasks:before[target].tasks.map(t=>t.id===input.id?{...t,status:'review',draft:'',messages:[...t.messages,{id:input.messageId,role:'user',text:input.text,createdAt:new Date().toISOString()}]}:t)}}));return {ok:true}};
  if(path==='/api/bots/create'){
   decode(botCreateSchema,input);const present=current.tasks.find(t=>t.id===input.createTask.id);
   const created=present??{...input.createTask,draftPlan:true,draftTurnSettings:{provider:'codex',model:'hidden-stale-model',reasoning:''},bot:{...metadata(),role:input.role,responsibilities:input.responsibilities}};
   if(!present)setAll(before=>({...before,[target]:{...before[target],tasks:[...before[target].tasks,created]}}));
   if(window.failCreate){window.failCreate=false;throw Error('Response lost. Retry creation.')}return {id:created.id,bot:created.bot,revision:1,runtimeInstanceId:target};
  }
  if(path==='/api/bots/update'||path==='/api/bots/lifecycle'){
   decode(path.endsWith('update')?botUpdateSchema:botLifecycleSchema,input);
   if(window.failUpdate){window.failUpdate=false;throw Error('Settings conflict. Draft kept.')}
   if(window.noopResource && input.resources){window.noopResource=false;return {id:found.id,bot,revision:1,runtimeInstanceId:target}}
   if(input.expectedRevision!==bot.revision)throw Error('Bot revision changed. Draft kept.');
   const next={...bot,...(path.endsWith('update')?{...('role' in input?{role:input.role}:{}),...('responsibilities' in input?{responsibilities:input.responsibilities}:{}),...('resources' in input?{resources:input.resources}:{})}:{state:input.action==='pause'?'paused':'active'}),revision:randomUUID()};
   setAll(before=>({...before,[target]:{...before[target],tasks:before[target].tasks.map(t=>t.id===found.id?{...t,bot:next}:t)}}));return {id:found.id,bot:next,revision:1,runtimeInstanceId:target};
  }
  if(path==='/api/workspace'){
   if(Object.hasOwn(input.changes,'bot'))throw Error('Bot metadata cannot use workspace PATCH');
   setAll(before=>({...before,[target]:{...before[target],tasks:before[target].tasks.map(t=>t.id===input.id?{...t,...Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]))}:t)}}));return {applied:true,outcome:'applied',conflicts:[],revision:1};
  }
  if(path==='/api/memory/list'){decode(memoryListRequestSchema,input);if(input.scope!=='bot'||input.botId!=='bot')throw Error('Wrong memory scope');return {entries:Object.values(window.notes[target]??{}),total:Object.keys(window.notes[target]??{}).length}}
  if(path==='/api/memory/write'){if(input.scope!=='bot'||input.botId!=='bot')throw Error('Wrong memory scope');window.notes[target]??={};const previous=window.notes[target][input.key];if(previous?.revision!==input.expectedRevision)throw Error('Note conflict');const note={scope:'bot',botId:'bot',key:input.key,content:input.content,revision:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};window.notes[target][input.key]=note;return {memory:note}}
  if(path==='/api/memory/delete'){delete window.notes[target][input.key];return {ok:true}}
  return {ok:true};
 },[all]);
 const request=useCallback((...args)=>rpc(owner,...args),[rpc,owner]);
 const profiles=['one','two'].map(id=>({id,name:id,connection:{address:'http://'+id+'.lan',token:'paired'+(window.pairVersion??''),runtimeId:id}}));
 const snapshot={runtimeId:owner,messageSetupSupported:window.messageSetupSupported,planModeSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,botsSupported:supported?true:undefined,botResourcesSupported:true,permissionPolicySupported:true,questions:[],approvals:[],defaults:{},workspace:current};
 const runtimes=profiles.map(profile=>({profile,connected:!offline,snapshot:{...snapshot,runtimeId:profile.id,workspace:all[profile.id]}}));
 const store={workspace:current,setWorkspace,snapshot,activeRuntimeId:owner,connection:profiles.find(p=>p.id===owner).connection,connected:!offline,runtimes,runtimeRegistry:{profiles},switchRuntime:async id=>setOwner(id),request,readRuntime:(profile,...args)=>rpc(profile.id,...args),flush:async()=>{window.calls.push({owner,path:'flush'})},readCache:{read:async()=>null},refreshRuntime:async()=>{},refreshRuntimes:async()=>{},previewTask:(_connection,_id,_updates,action)=>action()};
 const [node,setNode]=useState({id:'routine-task',data:{kind:'task',label:'Routine',objective:'Review release',repositoryId:'scratch',agentId:'',trigger:'manual',schedule:'',timezone:''}});
 return <WorkspaceValueProvider value={store}>{move?<ContinueElsewhereDialog task={current.tasks.find(task=>task.bot)} repository={{id:'project',name:'Project',path:'/project',branch:'main'}} onMachine={()=>window.machineInvoked=true} onClose={()=>setMove(false)}/>:inspector?<NodeInspector node={node} workspace={current} onChange={data=>{window.node=data;setNode(n=>({...n,data}))}} onDelete={()=>{}}/>:route.viewId==='bots'?<BotsView key={'bots:'+version} entityId={route.entityId}/>:<TasksView key={'tasks:'+version} entityId={route.entityId}/>}</WorkspaceValueProvider>
}
createRoot(document.getElementById('app')).render(<App/>);
`,
  },
  plugins: [
    {
      name: 'bots-fixture',
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.route('http://dovo.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>.hidden,[hidden]{display:none!important}</style><main id="app"></main>',
    }),
  )
  await page.goto('http://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  if (process.env.DOVO_BOT_STYLES) {
    await page.addStyleTag({ content: readFileSync(process.env.DOVO_BOT_STYLES, 'utf8') })
    await page.addStyleTag({
      content: 'html,body,#app{height:100%;margin:0;overflow:hidden}#app{display:flex;width:100%}',
    })
  }
  await page.getByRole('heading', { name: 'Select a Bot', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Create your first Bot', exact: true }).count(),
    0,
  )
  const composer = () => page.locator('textarea[data-task-id="bot"]')
  assert.equal(
    await page.locator('[data-bot-row="bot"]').count(),
    2,
    'One persistent row per computer, no run or delegation rows',
  )
  assert.equal(await page.locator('[data-bot-row="child"]').count(), 0)
  await page.locator('[data-bot-row="bot"]').first().getByRole('button').first().click()
  await composer().waitFor()
  await composer().fill('Unsent Bot message')
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  assert.equal(await page.getByLabel('Bot project', { exact: true }).count(), 0)
  if (process.env.DOVO_BOT_STYLES) {
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 900 })
      const composerBox = await composer().boundingBox()
      const settingsBox = await page.getByLabel('Bot settings panel', { exact: true }).boundingBox()
      await page.screenshot({ path: '/tmp/dovo-bots-desktop-' + width + '.png' })
      assert.ok(
        composerBox && settingsBox && composerBox.x + composerBox.width <= settingsBox.x + 1,
        'Settings must not cover the composer',
      )
      await page.screenshot({ path: '/tmp/dovo-bots-desktop-' + width + '.png' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.getByLabel('Bot role', { exact: true }).fill('Unsaved role')
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  assert.equal(await composer().inputValue(), 'Unsent Bot message')
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  assert.equal(await page.getByLabel('Bot role', { exact: true }).inputValue(), 'Unsaved role')
  await page.getByRole('button', { name: 'Add Bot skill', exact: true }).click()
  await page.getByRole('button', { name: 'Save fixture Bot skill', exact: true }).click()
  await page.waitForFunction(() =>
    window.all.one.tasks
      .find((t) => t.id === 'bot')
      .bot.resources?.skills.some((s) => s.name === 'bot-skill'),
  )
  await page.evaluate(() => (window.failUpdate = true))
  await page.getByRole('button', { name: 'Save Bot settings', exact: true }).click()
  await page.getByText('Settings conflict. Draft kept.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Bot role', { exact: true }).inputValue(), 'Unsaved role')
  await page.getByRole('button', { name: 'Save Bot settings', exact: true }).click()
  await page.getByText('Bot settings saved.', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.all.one.tasks.find((t) => t.id === 'bot').bot.role),
    'Unsaved role',
    'Own resource save advances only the local draft revision',
  )
  await page.getByLabel('Bot role', { exact: true }).fill('Stale role draft')
  await page.evaluate(() => window.externalRole())
  await page.evaluate(() => window.remount())
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.evaluate(() => (window.noopResource = true))
  await page.getByRole('button', { name: 'Edit skill bot-skill', exact: true }).click()
  await page.getByRole('button', { name: 'Save fixture Bot skill', exact: true }).click()
  await page
    .getByRole('button', { name: 'Save fixture Bot skill', exact: true })
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Save Bot settings', exact: true }).click()
  await page.getByText('Bot revision changed. Draft kept.', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.all.one.tasks.find((t) => t.id === 'bot').bot.role),
    'External role',
  )
  assert.equal(await page.getByLabel('Bot role', { exact: true }).inputValue(), 'Stale role draft')
  await page.getByRole('button', { name: 'Discard settings draft', exact: true }).click()
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).waitFor()
  assert.equal(await composer().inputValue(), 'Unsent Bot message')
  await page.getByRole('button', { name: 'Resume Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Pause Bot', exact: true }).waitFor()
  await page.getByLabel('Bot memory key', { exact: true }).fill('release')
  await page.getByLabel('Bot memory note', { exact: true }).fill('Ship after checks pass')
  await page.getByRole('button', { name: 'Save memory note', exact: true }).click()
  await page.getByRole('button', { name: 'release', exact: true }).waitFor()
  await page
    .getByLabel('Bot settings panel', { exact: true })
    .getByRole('button', { name: 'Change Bot model', exact: true })
    .click()
  await page.waitForFunction(
    () => window.all.one.tasks.find((t) => t.id === 'bot').harness.model === 'next-model',
  )
  await page.getByRole('button', { name: 'Set Bot read-only', exact: true }).click()
  await page.waitForFunction(
    () => window.all.one.tasks.find((t) => t.id === 'bot').harness.permission === 'read-only',
  )
  assert.equal(
    await page.evaluate(
      () => window.all.one.tasks.find((t) => t.id === 'bot').bot.resources.skills[0].name,
    ),
    'bot-skill',
    'Harness changes retain Bot resources',
  )
  assert.equal(
    await page.evaluate(() => window.all.two.tasks.find((t) => t.id === 'bot').bot.resources),
    undefined,
    'Another Bot keeps its own resources',
  )
  await page.getByLabel('Bot role', { exact: true }).fill('Owner one draft')
  await page.evaluate(() => window.setOwner('two'))
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.getByLabel('Bot role', { exact: true }).fill('Owner two role')
  await page.getByRole('button', { name: 'Save Bot settings', exact: true }).click()
  await page.waitForFunction(
    () => window.all.two.tasks.find((t) => t.id === 'bot').bot.role === 'Owner two role',
  )
  await page.evaluate(() => window.setOwner('one'))
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="Bot role"]')?.value === 'Owner one draft',
  )
  assert.equal(await page.getByLabel('Bot role', { exact: true }).inputValue(), 'Owner one draft')
  await page.evaluate(() => window.setOffline(true))
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.trim() === 'Save Bot settings' && button.matches(':disabled'),
    ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Save Bot settings', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.setOffline(false)
    window.setSupported(false)
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.trim() === 'Save Bot settings' && button.matches(':disabled'),
    ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Save Bot settings', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.setSupported(true)
    window.route({ viewId: 'tasks', entityId: 'chat' })
  })
  await page.locator('textarea[data-task-id="chat"]').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Bot settings', exact: true }).count(),
    0,
    'Normal chats have no Bot controls',
  )
  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByLabel('Bot name', { exact: true }).fill('Build assistant')
  await page.getByLabel('Bot role', { exact: true }).fill('Keep builds green')
  await page.evaluate(() => (window.failCreate = true))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Retry creation', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Assistant', exact: true }).waitFor()
  const creates = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/bots/create'),
  )
  assert.equal(creates.length, 2)
  assert.deepEqual(
    creates[0].input,
    creates[1].input,
    'Retry keeps the exact request and thread identity',
  )
  assert.equal(
    await page.evaluate(
      () => window.all.one.tasks.filter((t) => t.title === 'Build assistant').length,
    ),
    1,
  )
  const fallbackBotId = creates[0].input.createTask.id
  await page
    .locator('textarea[data-task-id="' + fallbackBotId + '"]')
    .fill('Keep the assistant name')
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.waitForFunction(
    (id) => window.calls.some((call) => call.path === '/api/tasks/message' && call.input.id === id),
    fallbackBotId,
  )
  assert.equal(
    await page.evaluate(
      (id) => window.all.one.tasks.find((task) => task.id === id).title,
      fallbackBotId,
    ),
    'Build assistant',
  )
  assert.equal(
    await page.evaluate(
      (id) =>
        window.calls.some((call) => call.path === '/api/tasks/title' && call.input.taskId === id),
      fallbackBotId,
    ),
    false,
  )
  await page.evaluate(() => window.inspect(true))
  await page.getByLabel('Routine thread target', { exact: true }).selectOption('bot')
  assert.equal(await page.evaluate(() => window.node.botId), 'bot')
  assert.equal(
    await page.getByLabel('Harness', { exact: true }).count(),
    0,
    'Routine uses Bot settings',
  )
  await page.evaluate(() => window.fresh(false))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByLabel('Bot name', { exact: true }).fill('Unavailable scratch')
  await page.getByLabel('Bot role', { exact: true }).fill('Test unavailable project')
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click()
  await page.evaluate(() => {
    window.messageSetupSupported = true
    window.fresh(true)
  })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByLabel('Bot name', { exact: true }).fill('First run Bot')
  await page.getByLabel('Bot role', { exact: true }).fill('First assistant')
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Assistant', exact: true }).waitFor()
  const firstRun = await page.evaluate(
    () => window.calls.filter((call) => call.path === '/api/bots/create').at(-1).input.createTask,
  )
  assert.equal(firstRun.repositoryId, 'dovo:scratch')
  assert.equal(firstRun.execution, 'main')
  assert.equal(firstRun.setupCommand, undefined)
  assert.equal(await page.getByLabel('Bot introduction', { exact: true }).count(), 1)
  assert.equal(await page.getByText('What would you like to work on?', { exact: true }).count(), 0)
  const botId = firstRun.id
  await page
    .locator('textarea[data-task-id="' + botId + '"]')
    .fill('Review a different release title')
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.waitForFunction(
    (id) => window.calls.some((call) => call.path === '/api/tasks/message' && call.input.id === id),
    botId,
  )
  assert.equal(
    await page.evaluate((id) => window.all.one.tasks.find((task) => task.id === id).title, botId),
    'First run Bot',
  )
  const firstSend = await page.evaluate(
    (id) => window.calls.find((call) => call.path === '/api/tasks/message' && call.input.id === id),
    botId,
  )
  assert.equal(firstSend.input.initialTitle, undefined)
  assert.equal(firstSend.input.turnSettings, undefined)
  assert.equal(firstSend.input.plan, undefined)
  assert.equal(await page.getByRole('button', { name: 'Plan', exact: true }).count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'More composer actions', exact: true }).count(),
    0,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Change Bot model', exact: true }).count(),
    1,
    'Persistent settings have the only model control',
  )
  assert.equal(
    await page.evaluate(
      (id) =>
        window.calls.some((call) => call.path === '/api/tasks/title' && call.input.taskId === id),
      botId,
    ),
    false,
  )

  await page.evaluate(() => window.inspectMove(true))
  assert.equal(await page.getByRole('button', { name: /Another computer/ }).isDisabled(), true)
  assert.equal(
    await page.getByRole('button', { name: /Another harness on this computer/ }).isEnabled(),
    true,
  )
  assert.equal(await page.evaluate(() => window.machineInvoked ?? false), false)
  assert.deepEqual(errors, [])
  console.log(
    'Bots: real TasksView/TaskRow/composer integration, owner-scoped settings and memory, hold/resume UI, draft recovery, old/offline runtime, normal-chat regression, idempotent creation, and routine targeting passed. Transport and visual shells are fixtures; native harness execution is not tested.',
  )
} finally {
  await browser.close()
}
