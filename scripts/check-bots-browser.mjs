import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/studio-ui/resource-editors': `export const CatalogPicker=()=>null;export const McpEditor=()=>null;export const SkillEditor=({onSave})=><button onClick={()=>onSave({name:'bot-skill',description:'Test',content:'Test body',enabled:true})}>Save fixture Bot skill</button>;`,
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
    export {WorkspaceScope} from '../studio-core/src/workspace/scope';
    export {WorkspaceRuntimeScope} from '../studio-core/src/workspace/runtime-scope';
    export const readAppPreferences=()=>({projectPanelOpen:false,runtimeDictationIds:[],taskSort:'priority',taskGrouping:'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled'],threadInfoSections:{},followUp:'queue'});
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=()=>{};
    export const resolveTaskAgent=()=>({provider:'codex',model:'model',args:[],endpoint:'',skills:[],mcpServers:[]});
    export const formatDateTime=value=>value;
  `,
  '@dovo/studio-ui': `
export {BotAvatar} from '../studio-ui/src/bot-avatar';
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
    import {ChoicePicker as NativeChoicePicker} from './src/choice-picker';export const ChoicePicker=props=>props['aria-label']==='Bot computer'?<NativeChoicePicker {...props}/>:<select {...props} onChange={event=>props.onValueChange(event.target.value)}>{props.children}</select>;
    export const ComposerSurface=({children,controls,leadingActions,actions,onSubmit})=><form className="relative z-10" onSubmit={onSubmit}>{children}{leadingActions}{controls}{actions}</form>;
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
  './detail/task-tools': `export const TaskTools=({task,surface,onSelect})=>task.bot?<nav>{[['bot-settings','Bot settings'],['bot-mcp','Bot MCP servers'],['bot-skills','Bot skills'],['bot-memory','Bot memory'],['bot-routines','Bot routines']].map(([id,label])=><button key={id} onClick={()=>onSelect(surface===id?'chat':id)}>{label}</button>)}</nav>:null;`,
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
  'export const ResizableSidebar=({children,className})=><aside className={className} style={{width:260,maxWidth:"40%",flexShrink:0}}>{children}</aside>;'
mocks['@dovo/studio-core'] += `
export {providers} from '../studio-core/src/providers';export const useModelCatalog=()=>({models:[]});
export const resolveTaskDefaults=defaults=>({harness:{provider:'codex',model:defaults?.fixtureModel??'model',permission:'workspace-write',endpoint:'',args:[],instructions:'',skills:[],mcpServers:[],reasoning:''}});
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
import {useWorkspace as useHarnessWorkspace} from '@dovo/studio-core';
import {Schema} from 'effect';
export const HarnessFields=({value,onChange})=>{const scope=useHarnessWorkspace();window.harnessScope={id:scope.activeRuntimeId,connection:scope.connection,read:()=>scope.request('/api/fixture/agent',{},Schema.Unknown)};return <label>Harness<select aria-label="Harness" value={value.provider} onChange={event=>onChange({...value,provider:event.target.value})}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>};
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
import {useState,useCallback,useEffect,Suspense} from 'react';import {createRoot} from 'react-dom/client';
import {Effect,Schema} from 'effect';
import {WorkspaceValueProvider,WorkspaceRuntimeScope,useWorkspace,createTask} from '@dovo/studio-core';
import {botCreateSchema,botUpdateSchema,botLifecycleSchema,memoryListRequestSchema,decode,randomUUID,resolveRuntimeTarget,RuntimeRequestError} from '@dovo/protocol';
import BotsView from '../extension-tasks/src/bots/view';
import {SavedActions} from '../extension-runtime/src/saved-actions';
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
function OwnerProbe(){const scope=useWorkspace();window.ownerProbe={id:scope.activeRuntimeId,read:()=>scope.request('/api/fixture/agent',{},Schema.Unknown)};return null}
// Hold the context commit separately from switchRuntime's promise, as React can do.
function OwnerCommit({owner,children}){useEffect(()=>{window.committedOwner=owner},[owner]);if(window.ownerRenderGate?.owner===owner)throw window.ownerRenderGate.promise;return children}
window.holdOwnerRender=owner=>{let release;const promise=new Promise(resolve=>release=resolve);window.ownerRenderGate={owner,promise};window.releaseOwnerRender=()=>{window.ownerRenderGate=undefined;release()}};
function App(){
 const [all,setAll]=useState(initial),[owner,setOwner]=useState('one'),[route,setRoute]=useState({viewId:'bots'}),[offline,setOffline]=useState(false),[supported,setSupported]=useState(true),[version,setVersion]=useState(0),[inspector,setInspector]=useState(false),[move,setMove]=useState(false);window.inspectMove=setMove;
 window.host={navigate:target=>{window.navigations??=[];window.navigations.push(target);setRoute(target)},registerCommand:command=>{window.commands.set(command.id,command.run);return ()=>window.commands.delete(command.id)}};
 window.externalRole=()=>setAll(before=>({...before,[owner]:{...before[owner],tasks:before[owner].tasks.map(t=>t.id==='bot'?{...t,bot:{...t.bot,role:'External role',revision:randomUUID()}}:t)}}));window.fresh=(scratch=true)=>{window.pairVersion=(window.pairVersion??0)+1;setInspector(false);setRoute({viewId:'bots'});setAll(before=>({...before,[owner]:{...before[owner],tasks:[],repositories:scratch?[{id:'dovo:scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]:[]}}));setVersion(v=>v+1)};window.setOwner=setOwner;window.setOffline=setOffline;window.setSupported=setSupported;window.route=setRoute;window.remount=()=>setVersion(v=>v+1);window.inspect=setInspector;
 const current=all[owner];window.all=all;window.owner=owner;window.currentRoute=route;
 window.cloneBot=(from,to,id)=>setAll(before=>({...before,[to]:{...before[to],tasks:[...before[to].tasks.filter(task=>task.id!==id),{...before[from].tasks.find(task=>task.id===id),title:'Remote same-ID Bot'}]}}));
 window.setScratch=(id,enabled)=>setAll(before=>({...before,[id]:{...before[id],repositories:enabled?[{id:id+'-scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]:[]}}));
 const setWorkspace=useCallback(update=>setAll(before=>({...before,[owner]:typeof update==='function'?update(before[owner]):update})),[owner]);
 const rpc=useCallback(async(target,path,input,schema)=>{
  window.calls.push({owner:target,path,input:JSON.parse(JSON.stringify(input??{}))});
  const current=all[target];const found=current.tasks.find(t=>t.id===input?.id);const bot=found?.bot;
  if(path==='/api/fixture/agent'){if(window.deferAgentRead)await new Promise(resolve=>window.releaseAgentRead=resolve);return {ok:true}};
  if(path==='/api/tasks/files')return {files:[]};
  if(path==='/api/tasks/waiting')return {dependencies:[]};
  if(path==='/api/tasks/message'){setAll(before=>({...before,[target]:{...before[target],tasks:before[target].tasks.map(t=>t.id===input.id?{...t,status:'review',draft:'',messages:[...t.messages,{id:input.messageId,role:'user',text:input.text,createdAt:new Date().toISOString()}]}:t)}}));return {ok:true}};
  if(path==='/api/bots/create'){
   decode(botCreateSchema,input);
   if(window.rejectCreate){window.rejectCreate=false;window.savedActions??={};window.savedActions[target]=[{id:'rejected-bot-command',label:'Saved action',blocked:true,reviewRequired:false},{id:'unrelated-command',label:'Save agent settings',blocked:false,reviewRequired:false}];setAll(before=>({...before}));throw new RuntimeRequestError({kind:'response',status:422,mutationRejected:true,message:'The runtime rejected this Bot role.'})}
   if(window.savedActions?.[target]?.some(action=>action.blocked))throw Error('A saved action needs review. Retry or discard pending actions before sending another.');
   const present=current.tasks.find(t=>t.id===input.createTask.id);
   const created=present??{...input.createTask,draftPlan:true,draftTurnSettings:{provider:'codex',model:'hidden-stale-model',reasoning:''},bot:{...metadata(),role:input.role,responsibilities:input.responsibilities}};
   if(!present)setAll(before=>({...before,[target]:{...before[target],tasks:[...before[target].tasks,created]}}));
   if(window.deferCreate)await new Promise(resolve=>{window.releaseCreate=resolve;window.createReplies??={};window.createReplies[input.requestId]=resolve});if(window.failCreate){window.failCreate=false;throw Error('Response lost. Retry creation.')}return {id:created.id,bot:created.bot,revision:1,runtimeInstanceId:target};
  }
  if(path==='/api/bots/avatar/generate'){window.avatarCalls??=[];window.avatarCalls.push(input);if(window.failAvatar){window.failAvatar=false;throw Error('Avatar response lost')}return {avatar:'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'}}
  if(path==='/api/bots/avatar/cancel')return {ok:true};
  if(path==='/api/bots/update'||path==='/api/bots/lifecycle'){
   decode(path.endsWith('update')?botUpdateSchema:botLifecycleSchema,input);
   if(window.failUpdate){window.failUpdate=false;throw Error('Settings conflict. Draft kept.')}
   if(window.noopResource && input.resources){window.noopResource=false;return {id:found.id,bot,revision:1,runtimeInstanceId:target}}
   if(input.expectedRevision!==bot.revision)throw Error('Bot revision changed. Draft kept.');
   const next={...bot,...(path.endsWith('update')?{...('avatar' in input?{avatar:input.avatar??undefined}:{}),...('role' in input?{role:input.role}:{}),...('responsibilities' in input?{responsibilities:input.responsibilities}:{}),...('resources' in input?{resources:input.resources}:{})}:{state:input.action==='pause'?'paused':'active'}),revision:randomUUID()};
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
 window.updateHost=(id,changes)=>{window.hostOptions??={};window.hostOptions[id]={...window.hostOptions[id],...changes};setAll(before=>({...before}))};
 const profiles=['one','two'].filter(id=>!window.hostOptions?.[id]?.removed).map(id=>({id,name:id,connection:{address:window.hostOptions?.[id]?.address??'http://'+id+'.lan',token:'paired'+(window.pairVersion??'')+(window.hostOptions?.[id]?.credential??''),runtimeId:id,...window.hostOptions?.[id]?.routes}}));
 const snapshot={runtimeId:owner,messageSetupSupported:window.messageSetupSupported,planModeSupported:true,queuedTurnSettingsSupported:true,fullTurnSettingsSupported:true,botsSupported:supported?true:undefined,botResourcesSupported:true,botAvatarsSupported:true,botAvatarHarnessSelectionSupported:true,permissionPolicySupported:true,questions:[],approvals:[],defaults:{},workspace:current};
 const runtimes=profiles.map(profile=>({profile,connected:!(window.hostOptions?.[profile.id]?.offline??offline),snapshot:{...snapshot,botsSupported:window.hostOptions?.[profile.id]?.unsupported?undefined:snapshot.botsSupported,runtimeId:profile.id,defaults:{fixtureModel:profile.id+'-model'},workspace:all[profile.id]}}));
 const readRuntime=async(profile,...args)=>{if(!resolveRuntimeTarget(window.latestProfiles,profile))throw Error('Runtime pairing changed');window.explicitOwners??=[];window.explicitOwners.push({id:profile.id,address:profile.connection.address,token:profile.connection.token});const result=await rpc(profile.id,...args);if(!resolveRuntimeTarget(window.latestProfiles,profile))throw Error('Runtime pairing changed');if(args[0]==='/api/bots/create'){window.createReturned??=[];window.createReturned.push(args[1].requestId)}return result};
 const store={workspace:current,setWorkspace,snapshot:{...snapshot,...runtimes.find(r=>r.profile.id===owner)?.snapshot},activeRuntimeId:owner,localRuntimeId:'one',connection:profiles.find(p=>p.id===owner)?.connection,connected:runtimes.find(r=>r.profile.id===owner)?.connected??false,runtimes,runtimeRegistry:{profiles},switchRuntime:async id=>{if(window.deferSwitch)await new Promise(resolve=>window.releaseSwitch=resolve);setOwner(id);window.switchBeforeRender=window.owner!==id},mutationStatus:profile=>({pending:window.savedActions?.[profile.id]?.length??0,error:null,actions:window.savedActions?.[profile.id]??[]}),discardMutations:async(profile,id)=>{if(!id)throw Error("Fixture requires review of a single action");window.discardedActions??=[];window.discardedActions.push(id);window.savedActions[profile.id]=window.savedActions[profile.id].filter(action=>action.id!==id);setAll(before=>({...before}))},retryMutations:async()=>{throw Error("Fixture saved actions require explicit review")},request,readRuntime,readRuntimeEffect:(profile,...args)=>Effect.tryPromise({try:()=>readRuntime(profile,...args),catch:cause=>cause}),runtimeReadCache:()=>({read:async()=>null}),flush:async()=>{window.calls.push({owner,path:'flush'})},readCache:{read:async()=>null},refreshRuntime:async()=>{if(window.failRefresh){window.failRefresh=false;throw Error('Refresh unavailable')}},refreshRuntimes:async()=>{},previewTask:(_connection,_id,_updates,action)=>action()};
 window.latestProfiles=profiles;
 const [node,setNode]=useState({id:'routine-task',data:{kind:'task',label:'Routine',objective:'Review release',repositoryId:'scratch',agentId:'',trigger:'manual',schedule:'',timezone:''}});
 return <OwnerCommit owner={owner}><WorkspaceValueProvider value={store}><div hidden><WorkspaceRuntimeScope runtimeId="two"><OwnerProbe/></WorkspaceRuntimeScope></div>{move?<ContinueElsewhereDialog task={current.tasks.find(task=>task.bot)} repository={{id:'project',name:'Project',path:'/project',branch:'main'}} onMachine={()=>window.machineInvoked=true} onClose={()=>setMove(false)}/>:inspector?<NodeInspector node={node} workspace={current} onChange={data=>{window.node=data;setNode(n=>({...n,data}))}} onDelete={()=>{}}/>:route.viewId==='runtime'?<section aria-label="Computers fixture">{profiles.map(profile=><SavedActions key={profile.id} profile={profile} connected={true}/>)}</section>:route.viewId==='bots'?<BotsView key={'bots:'+version} entityId={route.entityId}/>:<TasksView key={'tasks:'+version} entityId={route.entityId}/>}</WorkspaceValueProvider></OwnerCommit>
}
createRoot(document.getElementById('app')).render(<Suspense fallback={<div>Loading fixture computer</div>}><App/></Suspense>);
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
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.url': '"http://dovo.test/bot-create.tsx"',
  },
})
const styleServer = await createServer({
  configFile: false,
  root: new URL('../', import.meta.url).pathname,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let nativeStyles
try {
  nativeStyles = (await styleServer.transformRequest('/packages/studio-ui/src/styles.css?direct'))
    .code
} finally {
  await styleServer.close()
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
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
  await page.route('http://dovo.test/packages/**', (route) => {
    const file = new URL('..' + new URL(route.request().url()).pathname, import.meta.url)
    return existsSync(file)
      ? route.fulfill({ body: readFileSync(file) })
      : route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  {
    await page.addStyleTag({
      content: process.env.DOVO_BOT_STYLES
        ? readFileSync(process.env.DOVO_BOT_STYLES, 'utf8')
        : nativeStyles,
    })
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
  await composer().pressSequentially('@Release')
  const botMention = page.getByRole('option').filter({ hasText: 'Release Bot two' })
  await botMention.waitFor()
  await botMention.click()
  assert.match(await composer().inputValue(), /@Release Bot two \(`studio:two:thread:bot`\)/)
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea[data-task-id="bot"]')
    return document.activeElement === input && input.selectionStart === input.value.length
  })
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
  await page.getByLabel('Avatar generation harness', { exact: true }).selectOption('harness:claude')
  await page.evaluate(() => (window.failAvatar = true))
  await page.getByRole('button', { name: 'Generate avatar', exact: true }).click()
  await page.getByText('Avatar response lost', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Avatar generation harness', { exact: true }).isDisabled(),
    true,
  )
  assert.equal(await page.evaluate(() => window.avatarCalls[0].harnessId), 'harness:claude')
  await page.getByRole('button', { name: 'Retry generation', exact: true }).click()
  await page.getByRole('button', { name: 'Use avatar', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.all.one.tasks.find((t) => t.id === 'bot').bot.avatar),
    undefined,
  )
  assert.deepEqual(
    await page.evaluate(() => window.avatarCalls[0]),
    await page.evaluate(() => window.avatarCalls[1]),
  )
  await page.getByRole('button', { name: 'Use avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Remove avatar', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Remove avatar', exact: true }).click()
  await page
    .getByRole('button', { name: 'Remove avatar', exact: true })
    .waitFor({ state: 'hidden' })
  await page.getByLabel('Bot role', { exact: true }).fill('Unsaved role')
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  assert.equal(await composer().inputValue(), 'Unsent Bot message')
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  assert.equal(await page.getByLabel('Bot role', { exact: true }).inputValue(), 'Unsaved role')
  await page.getByRole('button', { name: 'Bot skills', exact: true }).click()
  await page.getByRole('button', { name: 'Add Bot skill', exact: true }).click()
  await page.getByRole('button', { name: 'Save fixture Bot skill', exact: true }).click()
  await page.waitForFunction(() =>
    window.all.one.tasks
      .find((t) => t.id === 'bot')
      .bot.resources?.skills.some((s) => s.name === 'bot-skill'),
  )
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
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
  await page.getByRole('button', { name: 'Bot skills', exact: true }).click()
  await page.getByRole('button', { name: 'Edit skill bot-skill', exact: true }).click()
  await page.getByRole('button', { name: 'Save fixture Bot skill', exact: true }).click()
  await page
    .getByRole('button', { name: 'Save fixture Bot skill', exact: true })
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
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
  await page.getByRole('button', { name: 'Bot memory', exact: true }).click()
  await page.getByLabel('Bot memory key', { exact: true }).fill('release')
  await page.getByLabel('Bot memory note', { exact: true }).fill('Ship after checks pass')
  await page.getByRole('button', { name: 'Save memory note', exact: true }).click()
  await page.getByRole('button', { name: 'release', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
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
  const originalOwnerRow = page
    .locator('[data-bot-row="bot"]')
    .filter({ hasText: 'Release Bot one' })
  assert.equal(
    await originalOwnerRow.locator('button[aria-current="true"]').count(),
    1,
    'A computer-only change keeps the selected owner even when both computers have the same Bot ID',
  )
  assert.equal(await composer().count(), 0, 'Do not render the same ID from a different computer')
  await page
    .locator('[data-bot-row="bot"]')
    .filter({ hasText: 'Release Bot two' })
    .getByRole('button')
    .first()
    .click()
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click()
  await page.getByLabel('Bot role', { exact: true }).fill('Owner two role')
  await page.getByRole('button', { name: 'Save Bot settings', exact: true }).click()
  await page.waitForFunction(
    () => window.all.two.tasks.find((t) => t.id === 'bot').bot.role === 'Owner two role',
  )
  await page.evaluate(() => window.setOwner('one'))
  await page
    .locator('[data-bot-row="bot"]')
    .filter({ hasText: 'Release Bot one' })
    .getByRole('button')
    .first()
    .click()
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
  // Use both real scopes. An old request must retain its original owner holder.
  assert.equal(await page.evaluate(() => window.ownerProbe.id), 'two')
  await page.evaluate(async () => {
    window.retainedOwnerRead = window.ownerProbe.read
    await window.retainedOwnerRead()
    window.setOwner('one')
  })
  await page.evaluate(() => window.retainedOwnerRead())
  assert.equal(await page.evaluate(() => window.calls.at(-1).owner), 'two')
  await page.evaluate(() => window.updateHost('two', { routes: { runtimeId: 'learned-two' } }))
  await page.evaluate(() => window.retainedOwnerRead())
  assert.equal(await page.evaluate(() => window.calls.at(-1).owner), 'two')
  for (const replacement of [
    { credential: '-scope-replacement' },
    { credential: '', address: 'http://two-replaced.lan' },
  ]) {
    await page.evaluate((replacement) => window.updateHost('two', replacement), replacement)
    const count = await page.evaluate(() => window.calls.length)
    assert.equal(
      await page.evaluate(() => window.retainedOwnerRead().catch((error) => error.message)),
      'Runtime pairing changed',
    )
    assert.equal(await page.evaluate(() => window.calls.length), count)
    await page.evaluate(() => window.ownerProbe.read())
    assert.equal(await page.evaluate(() => window.calls.at(-1).owner), 'two')
    const target = await page.evaluate(() => window.explicitOwners.at(-1))
    assert.equal(target.address, replacement.address ?? 'http://two.lan')
    assert.equal(target.token.endsWith('-scope-replacement'), !!replacement.credential)
  }
  await page.evaluate(() => {
    window.updateHost('two', { credential: '', address: 'http://two.lan' })
  })
  await page.evaluate(() => {
    window.deferAgentRead = true
    window.inFlightOwnerRead = window.ownerProbe.read().catch((error) => error.message)
  })
  await page.waitForFunction(() => !!window.releaseAgentRead)
  await page.evaluate(() => window.updateHost('two', { credential: '-during-scope-read' }))
  await page.evaluate(() => {
    window.deferAgentRead = false
    window.releaseAgentRead()
  })
  assert.equal(await page.evaluate(() => window.inFlightOwnerRead), 'Runtime pairing changed')
  await page.evaluate(() => window.updateHost('two', { credential: '', routes: undefined }))
  // Desktop creation is independent of global selection. Each pairing owns its agent choices.
  await page.evaluate(() => {
    window.inspectMove(false)
    window.setOwner('one')
    window.route({ viewId: 'bots' })
    window.updateHost('one', { offline: true, unsupported: true })
    window.updateHost('two', { offline: false, unsupported: false })
  })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('heading', { name: 'Create your Bot', exact: true }).waitFor()
  const computer = () => page.getByRole('button', { name: 'Bot computer', exact: true })
  const chooseComputer = async (name) => {
    await computer().click()
    await page.getByRole('option', { name: new RegExp('^' + name + ' ·') }).click()
    await page
      .getByRole('dialog', { name: 'Bot computer', exact: true })
      .waitFor({ state: 'detached' })
  }
  assert.match(await computer().textContent(), /^two · Online/)
  assert.equal(await page.evaluate(() => window.harnessScope.id), 'two')
  await page.evaluate(() => window.harnessScope.read())
  assert.equal(await page.evaluate(() => window.calls.at(-1).owner), 'two')
  const beforePick = await page.evaluate(
    () => window.calls.filter((call) => call.path === '/api/bots/create').length,
  )
  await page.getByLabel('Bot role', { exact: true }).fill('Keep the release process clear')
  await page.getByLabel('Bot name', { exact: true }).fill('Desktop release assistant')
  await page
    .getByLabel('Bot responsibilities', { exact: true })
    .fill('Review blockers and prepare release notes.')
  await page.getByText('Agent settings', { exact: true }).click()
  await page.getByLabel('Harness', { exact: true }).selectOption('claude')
  await chooseComputer('one')
  assert.equal(
    await page.getByLabel('Bot role', { exact: true }).inputValue(),
    'Keep the release process clear',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await page.getByLabel('Harness', { exact: true }).inputValue(), 'codex')
  assert.equal(await page.evaluate(() => window.harnessScope.id), 'one')
  await page.evaluate(() => window.updateHost('one', { offline: false, unsupported: false }))
  await chooseComputer('two')
  assert.equal(await page.getByLabel('Harness', { exact: true }).inputValue(), 'claude')
  assert.equal(
    await page.evaluate(() => window.owner),
    'one',
    'Picking a machine must not switch the global computer',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/bots/create').length,
    ),
    beforePick,
  )
  assert.equal(await page.getByLabel('Bot project', { exact: true }).count(), 0)
  await page.getByText('Agent settings', { exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'light'
    window.failRefresh = true
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByText(/Bot created. Waiting for its computer to refresh:/).waitFor()
  const remoteCreate = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/bots/create').at(-1),
  )
  assert.equal(remoteCreate.owner, 'two')
  assert.equal(remoteCreate.input.createTask.harness.model, 'two-model')
  assert.equal(remoteCreate.input.createTask.harness.provider, 'claude')
  assert.equal(remoteCreate.input.createTask.execution, 'main')
  assert.equal(await page.evaluate(() => window.owner), 'two')
  await page.locator('textarea[data-task-id="' + remoteCreate.input.createTask.id + '"]').waitFor()

  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await chooseComputer('one')
  await page.getByLabel('Bot name', { exact: true }).fill('Uncertain desktop Bot')
  await page.getByLabel('Bot role', { exact: true }).fill('Track the original request')
  await page.evaluate(() => (window.failCreate = true))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Retry creation', exact: true }).waitFor()
  const uncertain = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/bots/create').at(-1),
  )
  assert.equal(uncertain.owner, 'one')
  assert.equal(uncertain.input.createTask.harness.model, 'one-model')
  assert.equal(uncertain.input.createTask.harness.provider, 'codex')
  assert.equal(await computer().isDisabled(), true)
  await page.evaluate(() => {
    window.setOwner('one')
    window.updateHost('one', { credential: '-replacement' })
  })
  await page.getByText(/This computer was removed or its pairing changed/).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Retry creation', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'Uncertain desktop Bot',
  )
  await page.evaluate(() =>
    window.updateHost('one', { credential: '', address: 'http://one-replaced.lan' }),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Retry creation', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() =>
    window.updateHost('one', { address: 'http://one.lan', routes: { runtimeId: 'learned-one' } }),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Retry creation', exact: true }).isEnabled(),
    true,
    'Learned runtime metadata keeps the same address/token pairing',
  )
  await page.evaluate(() => window.updateHost('one', { credential: '', offline: true }))
  assert.equal(
    await page.getByRole('button', { name: 'Retry creation', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.updateHost('one', { offline: false, removed: true }))
  await page.getByText(/This computer was removed or its pairing changed/).waitFor()
  await page.evaluate(() => {
    window.updateHost('one', { removed: false })
    window.setScratch('one', false)
  })
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await page.locator('textarea[data-task-id="' + uncertain.input.createTask.id + '"]').waitFor()
  const uncertainCalls = await page.evaluate(
    (id) =>
      window.calls.filter(
        (call) => call.path === '/api/bots/create' && call.input.requestId === id,
      ),
    uncertain.input.requestId,
  )
  assert.equal(uncertainCalls.length, 2)
  assert.equal(uncertainCalls[1].owner, 'one')
  assert.deepEqual(uncertainCalls[0].input, uncertainCalls[1].input)
  assert.equal(
    await page.evaluate(
      (id) => window.all.one.tasks.filter((task) => task.id === id).length,
      uncertain.input.createTask.id,
    ),
    1,
  )

  // A response arriving after global navigation must leave the draft workspace in place.
  await page.evaluate(() => {
    window.setScratch('one', true)
    window.route({ viewId: 'bots' })
  })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await chooseComputer('two')
  await page.getByLabel('Bot name', { exact: true }).fill('Late response Bot')
  await page.getByLabel('Bot role', { exact: true }).fill('Keep the right conversation')
  await page.evaluate(() => (window.deferCreate = true))
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  await page.evaluate(() => window.setOwner('two'))
  assert.equal(await page.getByLabel('Bot name', { exact: true }).inputValue(), 'Late response Bot')
  await page.evaluate(() => {
    window.deferCreate = false
    window.failRefresh = true
    window.releaseCreate()
  })
  await page.getByRole('button', { name: 'Open Bot', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry creation', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: 'Create your Bot', exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => window.currentRoute.entityId), undefined)
  await page.getByRole('button', { name: 'Open Bot', exact: true }).click()
  const late = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/bots/create').at(-1),
  )
  await page.locator('textarea[data-task-id="' + late.input.createTask.id + '"]').waitFor()
  await page.getByText(/Bot created. Waiting for its computer to refresh:/).waitFor()
  assert.equal(await page.evaluate(() => window.owner), 'two')
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter(
          (call) =>
            call.path === '/api/bots/create' &&
            call.input.requestId ===
              window.calls.filter((call) => call.path === '/api/bots/create').at(-1).input
                .requestId,
        ).length,
    ),
    1,
  )
  // Replacing credentials during I/O must retain the original request without navigation.
  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await chooseComputer('one')
  await page.getByLabel('Bot name', { exact: true }).fill('In-flight pairing Bot')
  await page.getByLabel('Bot role', { exact: true }).fill('Keep the original owner')
  await page.evaluate(() => {
    window.releaseCreate = undefined
    window.deferCreate = true
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  await page.evaluate(() => window.updateHost('one', { credential: '-new-in-flight' }))
  await page.getByText(/This computer was removed or its pairing changed/).waitFor()
  await page.evaluate(() => {
    window.deferCreate = false
    window.releaseCreate()
  })
  await page.getByText('Runtime pairing changed', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Retry creation', exact: true }).isDisabled(),
    true,
  )
  const replaced = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/bots/create').at(-1),
  )
  await page.evaluate(() => window.updateHost('one', { credential: '' }))
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await page.locator('textarea[data-task-id="' + replaced.input.createTask.id + '"]').waitFor()
  const replayed = await page.evaluate(
    (id) =>
      window.calls.filter(
        (call) => call.path === '/api/bots/create' && call.input.requestId === id,
      ),
    replaced.input.requestId,
  )
  assert.equal(replayed.length, 2)
  assert.deepEqual(replayed[0], replayed[1])
  const startDraft = async (name, machine) => {
    await page.evaluate(() => window.route({ viewId: 'bots' }))
    await page.getByRole('button', { name: 'New Bot', exact: true }).click()
    if (machine) await chooseComputer(machine)
    await page.getByLabel('Bot name', { exact: true }).fill(name)
    await page.getByLabel('Bot role', { exact: true }).fill('Keep the requested conversation')
  }
  const lastCreate = () =>
    page.evaluate(() => window.calls.filter((call) => call.path === '/api/bots/create').at(-1))
  const createsFor = (id) =>
    page.evaluate(
      (id) =>
        window.calls.filter(
          (call) => call.path === '/api/bots/create' && call.input.requestId === id,
        ).length,
      id,
    )
  const selectBot = async (id) => {
    await page
      .locator('[data-bot-row="' + id + '"]')
      .getByRole('button')
      .first()
      .click()
    await page.locator('textarea[data-task-id="' + id + '"]').waitFor()
  }

  // No forced React flush: one submit must survive a delayed switch and open the remote Bot.
  await page.evaluate(() => window.setOwner('one'))
  await startDraft('Delayed remote switch', 'two')
  await page.evaluate(() => window.holdOwnerRender('two'))
  await page.evaluate(() => {
    window.deferSwitch = true
    window.releaseSwitch = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseSwitch)
  const switched = await lastCreate()
  assert.equal(await page.evaluate(() => window.owner), 'one')
  assert.equal(await page.getByRole('button', { name: 'New Bot', exact: true }).isDisabled(), true)
  assert.equal(
    await page.getByRole('button', { name: 'Back to Bots', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page
      .locator('[data-bot-row="' + replaced.input.createTask.id + '"]')
      .getByRole('button')
      .first()
      .isDisabled(),
    true,
    'Local Bot selection must wait for the owned switch',
  )
  await page.evaluate(() => {
    window.deferSwitch = false
    window.releaseSwitch()
  })
  await page.waitForFunction(
    (id) => window.navigations.at(-1)?.entityId === id,
    switched.input.createTask.id,
  )
  assert.equal(
    await page.evaluate(() => window.committedOwner),
    'one',
    'Navigation does not require React to commit the new context first',
  )
  await page.evaluate(() => window.releaseOwnerRender())
  await page.locator('textarea[data-task-id="' + switched.input.createTask.id + '"]').waitFor()
  assert.equal(await page.evaluate(() => window.owner), 'two')
  assert.equal(await page.evaluate(() => window.switchBeforeRender), true)
  assert.equal(await createsFor(switched.input.requestId), 1)

  // An external local Bot route during the owned switch must keep its exact owner.
  // Reuse an existing ID on both computers to catch accidental cross-computer rekeying.
  await page.evaluate((id) => window.cloneBot('one', 'two', id), replaced.input.createTask.id)
  await page.evaluate(() => window.setOwner('one'))
  await startDraft('External route during switch', 'two')
  await page.evaluate(() => {
    window.deferSwitch = true
    window.releaseSwitch = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseSwitch)
  const routeDuringSwitch = await lastCreate()
  await page.evaluate(
    (id) => window.route({ viewId: 'bots', entityId: id }),
    replaced.input.createTask.id,
  )
  await page.locator('textarea[data-task-id="' + replaced.input.createTask.id + '"]').waitFor()
  const localSameId = page
    .locator('[data-bot-row="' + replaced.input.createTask.id + '"]')
    .filter({ hasText: 'In-flight pairing Bot' })
  const remoteSameId = page
    .locator('[data-bot-row="' + replaced.input.createTask.id + '"]')
    .filter({ hasText: 'Remote same-ID Bot' })
  assert.equal(await localSameId.locator('button[aria-current="true"]').count(), 1)
  assert.equal(await remoteSameId.locator('button[aria-current="true"]').count(), 0)
  await page.evaluate(() => {
    window.deferSwitch = false
    window.releaseSwitch()
  })
  await page.waitForFunction(() => window.owner === 'two')
  await page.getByRole('heading', { name: 'Select a Bot', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.currentRoute.entityId),
    replaced.input.createTask.id,
  )
  assert.equal(
    await localSameId.locator('button[aria-current="true"]').count(),
    1,
    'The local owner key stays selected after the old switch finishes',
  )
  assert.equal(
    await remoteSameId.locator('button[aria-current="true"]').count(),
    0,
    'A matching resource ID on the new computer cannot take the selection',
  )
  assert.equal(
    await page.locator('textarea[data-task-id="' + replaced.input.createTask.id + '"]').count(),
    0,
    'Do not show a wrong-computer conversation while the selected owner is inactive',
  )
  assert.equal(
    await page
      .locator('[data-thread-header="' + routeDuringSwitch.input.createTask.id + '"]')
      .count(),
    0,
    'The invalidated auto-open cannot replace the external route',
  )
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'External route during switch',
  )
  await page.getByRole('button', { name: 'Open Bot', exact: true }).click()
  await page
    .locator('textarea[data-task-id="' + routeDuringSwitch.input.createTask.id + '"]')
    .waitFor()
  assert.equal(await createsFor(routeDuringSwitch.input.requestId), 1)

  // An external route in the Bots view reuses BotsView. Stay on Y after the late create reply.
  await page.evaluate(() => window.setOwner('one'))
  await selectBot(replaced.input.createTask.id)
  await startDraft('External route during create', 'two')
  assert.equal(
    await page.evaluate(() => window.currentRoute.entityId),
    undefined,
    'New Bot clears the previous route entity',
  )
  await page.evaluate(() => {
    window.deferCreate = true
    window.releaseCreate = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  const interrupted = await lastCreate()
  assert.equal(
    await page.getByRole('button', { name: 'Back to Bots', exact: true }).isEnabled(),
    true,
    'Network creation alone does not lock navigation',
  )
  await page.evaluate(
    (id) => window.route({ viewId: 'bots', entityId: id }),
    replaced.input.createTask.id,
  )
  await page.locator('textarea[data-task-id="' + replaced.input.createTask.id + '"]').waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Create your Bot', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.deferCreate = false
    window.releaseCreate()
  })
  await page.waitForFunction(
    (id) => window.createReturned.includes(id),
    interrupted.input.requestId,
  )
  // Do not reopen creation here: keep the route and conversation selected through completion.
  assert.equal(
    await page.evaluate(() => window.currentRoute.entityId),
    replaced.input.createTask.id,
  )
  assert.equal(await page.evaluate(() => window.owner), 'one')
  assert.equal(
    await page.locator('textarea[data-task-id="' + replaced.input.createTask.id + '"]').isVisible(),
    true,
  )
  assert.equal(await page.getByRole('heading', { name: 'Create your Bot', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'External route during create',
  )
  assert.equal(await page.evaluate(() => window.currentRoute.entityId), undefined)
  await page.getByRole('button', { name: 'Open Bot', exact: true }).click()
  await page.locator('textarea[data-task-id="' + interrupted.input.createTask.id + '"]').waitFor()
  assert.equal(await createsFor(interrupted.input.requestId), 1)

  // Leave and remount during create. The new form shares the lock and receives the result.
  await startDraft('Remounted pending Bot', 'two')
  await page.evaluate(() => {
    window.deferCreate = true
    window.releaseCreate = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  const remounted = await lastCreate()
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click()
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Creating…', exact: true }).isDisabled(),
    true,
  )
  await page
    .locator('[aria-label="Create Bot"] form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
  assert.equal(
    await createsFor(remounted.input.requestId),
    1,
    'A remount cannot send the in-flight request again',
  )
  await selectBot(switched.input.createTask.id)
  await page.evaluate(() => {
    window.deferCreate = false
    window.releaseCreate()
  })
  await page.waitForFunction((id) => window.createReturned.includes(id), remounted.input.requestId)
  assert.equal(
    await page.evaluate(() => window.currentRoute.entityId),
    switched.input.createTask.id,
  )
  assert.equal(
    await page.locator('textarea[data-task-id="' + switched.input.createTask.id + '"]').isVisible(),
    true,
    'Stay on the selected Bot through the late reply',
  )
  assert.equal(await page.evaluate(() => window.owner), 'two')
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Open Bot', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.currentRoute.entityId),
    undefined,
    'Reopening creation clears the route without losing its pending request',
  )
  await page.getByRole('button', { name: 'Open Bot', exact: true }).click()
  await page.locator('textarea[data-task-id="' + remounted.input.createTask.id + '"]').waitFor()
  assert.equal(await createsFor(remounted.input.requestId), 1)

  // Explicit discard releases a replaced pairing. Its old reply cannot restore or clear newer text.
  await startDraft('Discarded in-flight Bot', 'one')
  await page.evaluate(() => {
    window.deferCreate = true
    window.releaseCreate = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  const discarded = await lastCreate()
  await page.evaluate(() => window.updateHost('one', { credential: '-discarded' }))
  await page.getByText(/This computer was removed or its pairing changed/).waitFor()
  await page.evaluate(() => {
    window.confirmationResponse = (options) => {
      window.lastConfirmation = options
      return false
    }
  })
  await page.getByRole('button', { name: 'Discard creation request', exact: true }).click()
  assert.equal(await computer().isDisabled(), true, 'Cancel keeps the pending request')
  assert.match(
    await page.evaluate(() => window.lastConfirmation.description),
    /may already exist.*Check Bots/,
  )
  await page.evaluate(
    () =>
      (window.confirmationResponse = (options) => {
        window.lastConfirmation = options
        return true
      }),
  )
  await page.getByRole('button', { name: 'Discard creation request', exact: true }).click()
  assert.equal(await page.getByLabel('Bot name', { exact: true }).isEditable(), true)
  assert.equal(await page.getByLabel('Bot role', { exact: true }).isEditable(), true)
  assert.equal(await page.getByLabel('Bot responsibilities', { exact: true }).isEditable(), true)
  assert.equal(await computer().isEnabled(), true)
  await chooseComputer('two')
  await page.getByLabel('Bot name', { exact: true }).fill('Newer successful Bot')
  await page.evaluate(() => {
    window.deferCreate = false
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  const newer = await lastCreate()
  await page.locator('textarea[data-task-id="' + newer.input.createTask.id + '"]').waitFor()
  await startDraft('Newer unsent draft', 'two')
  await page.evaluate(() => window.updateHost('one', { credential: '' }))
  await page.evaluate((id) => window.createReplies[id](), discarded.input.requestId)
  await page.evaluate(() => window.route({ viewId: 'tasks', entityId: 'chat' }))
  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.equal(
    await page.getByLabel('Bot name', { exact: true }).inputValue(),
    'Newer unsent draft',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isEnabled(),
    true,
  )
  assert.equal(await createsFor(discarded.input.requestId), 1)
  assert.equal(await createsFor(newer.input.requestId), 1)

  // Removed pairing after success discards only local navigation, never the Bot itself.
  await page.evaluate(() => {
    window.deferCreate = true
    window.releaseCreate = undefined
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseCreate)
  const alreadyCreated = await lastCreate()
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click()
  await page.evaluate(() => {
    window.deferCreate = false
    window.releaseCreate()
  })
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('button', { name: 'Open Bot', exact: true }).waitFor()
  await page.evaluate(() => window.updateHost('two', { removed: true }))
  await page.getByRole('button', { name: 'Discard creation request', exact: true }).click()
  assert.match(
    await page.evaluate(() => window.lastConfirmation.description),
    /already created.*only the saved request to open it/,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Create Bot', exact: true }).isEnabled(),
    true,
  )
  assert.equal(
    await page.evaluate(
      (id) => window.all.two.tasks.some((task) => task.id === id),
      alreadyCreated.input.createTask.id,
    ),
    true,
  )
  await page.evaluate(() => window.updateHost('two', { removed: false }))

  // The UI uses the real SavedActions panel, with fixture journal state and transport failures.
  await chooseComputer('one')
  await page.getByLabel('Bot name', { exact: true }).fill('Rejected Bot draft')
  await page.evaluate(() => {
    window.rejectCreate = true
  })
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page.getByText(/Creation was rejected. A saved action can still block/).waitFor()
  const rejected = await lastCreate()
  assert.equal(await page.getByLabel('Bot role', { exact: true }).isEditable(), true)
  assert.deepEqual(
    await page.evaluate(() => window.discardedActions ?? []),
    [],
    'Rejection cannot discard journal actions automatically',
  )
  await page.getByLabel('Bot role', { exact: true }).fill('Revised role keeps the draft')
  await page.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await page
    .getByText(
      'A saved action needs review. Open Computers and review saved actions for the original computer before trying again.',
      { exact: true },
    )
    .waitFor()
  const blocked = await lastCreate()
  assert.notEqual(blocked.input.requestId, rejected.input.requestId)
  await page.getByRole('button', { name: 'Open computers', exact: true }).click()
  await page.getByLabel('Computers fixture', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Review saved actions', exact: true }).click()
  const rejectedAction = page
    .getByRole('listitem')
    .filter({ has: page.getByText('Saved action', { exact: true }) })
  page.once('dialog', (dialog) => dialog.accept())
  await rejectedAction.getByRole('button', { name: 'Discard action', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.discardedActions), ['rejected-bot-command'])
  assert.equal(
    await page.getByRole('listitem').filter({ hasText: 'Save agent settings' }).count(),
    1,
    'Unrelated saved action stays intact',
  )
  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  assert.equal(
    await page.getByLabel('Bot role', { exact: true }).inputValue(),
    'Revised role keeps the draft',
  )
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await page.locator('textarea[data-task-id="' + blocked.input.createTask.id + '"]').waitFor()
  const recovered = await lastCreate()
  assert.deepEqual(recovered.input, blocked.input)
  assert.equal(await createsFor(blocked.input.requestId), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop ownership and creation assertions passed; capturing the form with no hero image.',
  )
  await page.evaluate(() => window.route({ viewId: 'bots' }))
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await chooseComputer('two')
  await page.getByLabel('Bot role', { exact: true }).fill('Keep the release process clear')
  await page.getByLabel('Bot name', { exact: true }).fill('Desktop release assistant')
  await page
    .getByLabel('Bot responsibilities', { exact: true })
    .fill('Review blockers and prepare release notes.')
  await page.evaluate(() => document.fonts.ready)
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1440],
    ['narrow', 640],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
      document.documentElement.classList.toggle('dark', theme === 'dark')
    }, theme)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const overflow = await page
      .getByLabel('Create Bot', { exact: true })
      .evaluate((node) => node.scrollWidth > node.clientWidth)
    assert.equal(overflow, false, 'Creation workspace has no horizontal overflow at ' + width)
    assert.equal(
      await page.getByRole('dialog').count(),
      0,
      'Capture the actual form with no dialog overlay',
    )
    await page.screenshot({
      path: '/tmp/dovo-bot-create-desktop-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Bots: real TasksView/TaskRow/composer integration, owner-scoped settings and memory, hold/resume UI, draft recovery, old/offline runtime, normal-chat regression, idempotent creation, routine targeting, desktop machine selection/defaults/ownership, refresh failure, frozen retries, pairing replacement, deferred switch/context commits and control locks, external Bot routes during create and switch, same-ID owner retention, remount single-flight, stale draft protection, explicit discard and saved-action recovery passed. Transport and visual shells are fixtures; native harness execution is not tested.',
  )
} finally {
  await browser.close()
}
