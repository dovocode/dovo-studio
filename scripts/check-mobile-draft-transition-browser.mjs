import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
// Exercise the real route, startup controller, creation runtime and TaskDetail. Native
// controls/conversation content are boundaries; their mount counts expose page replacement.
const mocks = {
  // Bot settings has its own real-component suite. Normal chat startup does not open it.
  '../../bots/bot-settings': 'export const BotSettings=()=>null;',
  // Native handoff controls have their own desktop/mobile browser suite.
  './continue-elsewhere': 'export const ContinueElsewhere=()=>null;',
  './components/failed-task-retry': 'export const FailedTaskRetry=()=>null;',

  '../../runtime/connection/account-context': `import {useSyncExternalStore} from 'react';window.sharingAccount={directory:{},deletionPending:false};window.setSharingAccount=account=>{window.sharingAccount=account;window.dispatchEvent(new Event('sharing-account'))};const subscribe=notify=>{window.addEventListener('sharing-account',notify);return()=>window.removeEventListener('sharing-account',notify)};export const useOptionalMobileAccount=()=>useSyncExternalStore(subscribe,()=>window.sharingAccount);`,
  // Encrypted sharing is exercised by the dedicated sharing controls suite.
  './thread-sharing':
    'export const ThreadSharing=({onClose})=><section role="dialog" aria-label="Share thread"><button onClick={onClose}>Close sharing</button></section>;export const InlineThreadSuggestions=()=>null;',
  // Pairing is covered by check-thread-pairing-browser; keep its native scanner
  // outside this route/composer continuity fixture.
  '../../runtime/connection/pair-computer': `export const PairComputer=()=>null;`,
  // Worktree transfer has its own browser suite; this fixture covers thread continuity.
  '../../scm/connections/project-transfer': `export const ProjectTransferDialog=({repository,sourceTask,onClose})=><section aria-label="Copy checkout"><span>{repository.id}|{sourceTask.id}</span><button onClick={onClose}>Close copy checkout</button></section>;`,
  'expo-router': `
    import {createContext,useContext,useEffect} from 'react';
    export const RouteContext=createContext({});
    export const useLocalSearchParams=()=>useContext(RouteContext);
    export const router={
      setParams:params=>{window.navigation.push({kind:'params',params});window.setParams(params)},
      push:href=>{window.navigation.push({kind:'push',href});window.openRoute(href)},
      replace:href=>{window.navigation.push({kind:'replace',href});window.openRoute(href)},
      canGoBack:()=>false,
      back:()=>{}
    };
    export const Redirect=({href})=>{
      useEffect(()=>{window.navigation.push({kind:'redirect',href});window.openRoute(href)},[]);
      return null;
    };
  `,
  'expo-crypto': `let id=0;export const randomUUID=()=> 'thread-'+(++id);`,
  '../../ui/content/open-link':
    'export const openAppLink=async()=>{};export const useOpenAppLink=()=>openAppLink;',
  '../../ui/controls/icon': 'export const Icon=()=>null;',
  '../ui/controls/icon':
    'export const Icon=({name})=><span aria-label={name==="bot"?"Bot avatar":name}>{name}</span>;',
  '../ui/theme': 'export const useTheme=()=>({colors:{},styles:{}});',
  'react-native': `
    import {useImperativeHandle,useRef} from 'react';
    export function TextInput({ref,accessibilityLabel,secureTextEntry,editable,onChangeText,onEndEditing,onSubmitEditing}){
      const field=useRef(null);
      useImperativeHandle(ref,()=>({clear:()=>{if(field.current)field.current.value=''},isFocused:()=>document.activeElement===field.current,blur:()=>field.current.blur()}));
      return <input ref={field} aria-label={accessibilityLabel} type={secureTextEntry?'password':'text'} disabled={!editable} onChange={event=>onChangeText?.(event.target.value)} onBlur={event=>onEndEditing?.({nativeEvent:{text:event.target.value}})} onKeyDown={event=>{if(event.key==='Enter')onSubmitEditing?.({nativeEvent:{text:field.current.value}})}}/>;
    }
    export const Image=({source,accessibilityLabel})=><img src={source.uri} alt={accessibilityLabel}/>;
    export const StyleSheet={hairlineWidth:1};
    export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent})=><div>{ListHeaderComponent}{data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>)}{ListFooterComponent}</div>;
    export const Pressable=({children,onPress,disabled,accessibilityRole,accessibilityLabel})=><button role={accessibilityRole} aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;
    export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={Array.isArray(style)?Object.assign({},...style):style}>{children}</div>;
    export const ScrollView=({children})=><div>{children}</div>;
    export const ActivityIndicator=()=> <span>Loading</span>;
    export const Keyboard={dismiss:()=>{}};
    export const Platform={get OS(){return window.os??'ios'}};
    export const BackHandler={addEventListener:(name,handler)=>{window.hardwareBack=handler;return{remove:()=>{window.hardwareBack=undefined}}}};
    export const Alert={alert:()=>{}};
    export const AccessibilityInfo={announceForAccessibility:()=>{}};
    export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};
    export const useWindowDimensions=()=>({width:390,height:844});
  `,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0});`,
  '@dovo/protocol': `
    export * from '${root}packages/protocol/src/index.ts';
    export const watchRuntimeTask=(connection,id)=>{
      window.watches.push({address:connection.address,id});
      return ()=>{};
    };
  `,
  '../../runtime/connection/provider': `
    import {createContext,useContext} from 'react';
    import {Effect} from 'effect';
    export const RuntimeContext=createContext(null);
    export const useRuntimeSelector=select=>select(useRuntime());export const sameRuntimeFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));export const useRuntime=()=>useContext(RuntimeContext);
    export const RuntimeScope=({runtimeId,children})=>{
      const root=useRuntime();
      const entry=root.overviews.find(entry=>entry.profile.id===runtimeId);
      return <RuntimeContext.Provider value={{...root,activeId:runtimeId,profile:entry.profile,
        snapshot:entry.snapshot,connected:entry.connected,readCache:window.caches[runtimeId]??null,
        readEffect:(...args)=>root.request(runtimeId,...args),
        call:(...args)=>Effect.runPromise(root.request(runtimeId,...args)),
        callEffect:(...args)=>root.request(runtimeId,...args)}}>{children}</RuntimeContext.Provider>;
    };
  `,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>!!window.carMode;`,
  '../../shell/navigation': `import {createContext,useContext} from 'react';export const FocusContext=createContext(true);export const useNavigation=()=>({focused:useContext(FocusContext),navigate:()=>{}});`,
  '../../ui/content/text': `export const Text=({children,accessibilityLabel,accessibilityRole})=><span role={accessibilityRole} aria-label={accessibilityLabel}>{children}</span>;`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/use-action': `export {useAction} from '${root}apps/mobile/src/ui/controls/use-action.ts';`,
  '../../ui/layout/sheet': `import {useImperativeHandle} from 'react';export const Sheet=({children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section>{children}</section>};export const useSheetNavigation=()=>navigate=>navigate();`,
  '../../ui/theme': `export const useTheme=()=>({colors:{},styles:{}});`,
  '../../ui/layout/screen-header': `import {useState} from 'react';export const ScreenHeader=({title,titleContent,titleMenuDisabled,buttons,leading,hidden,onBack,gestureEnabled,collapsedMenuGroups})=>{window.headerTitleMenuDisabled=!!titleMenuDisabled;window.headerCollapsedMenuGroups=collapsedMenuGroups;const [menu,setMenu]=useState(false);window.headerGestures=gestureEnabled;window.headerActions=buttons;return hidden?null:<header>{(window.os??'ios')==='ios'&&onBack?<button onClick={onBack}>Back</button>:leading}{titleContent??title}{buttons?.some(b=>b.overflow)&&<button onClick={()=>setMenu(true)}>Thread tools</button>}{buttons?.filter(b=>!b.overflow||menu).map(b=><button key={b.label} disabled={b.disabled} onClick={b.onPress}>{b.label}</button>)}</header>};`,
  '../../ui/content/markdown': `export const Markdown=({text})=><p data-native-prose>{text}</p>;`,
  '../files/task-files': 'export const TaskFiles=()=>null;',
  './task-agents': `export const TaskAgents=({task,onOpenThread})=><button onClick={()=>onOpenThread({taskId:task.id,agent:task.subagents[0]})}>Open native Claude thread</button>;`,
  '../../ui/content/clipboard': `export const copyText=async text=>{(window.mobileCopies??=[]).push(text);return 'copied'};`,
  '../../ui/content/artifacts': `export const ArtifactBrowser=()=>null;`,
  '../draft/use-draft': `export const saveRuntimeDraft=async(...args)=>{window.savedDraft=args};`,
  './folder-picker': `export const FolderPicker=()=>null;`,
  '../conversation/state/provider': `
    import {createContext,useContext,useEffect} from 'react';
    export const ConversationContext=createContext(null);
    export const useConversation=()=>useContext(ConversationContext);
    export const useConversationSelector=fn=>fn({task:useContext(ConversationContext)});
    export const ConversationProvider=({children,task,temporary,openCheckpoint})=>{
      useEffect(()=>{window.providerMounts++;return ()=>window.providerUnmounts++},[]);
      window.task=task;window.temporary=temporary;window.openCheckpoint=openCheckpoint;
      return <ConversationContext.Provider value={task}>{children}</ConversationContext.Provider>;
    };
  `,
  '../conversation/view': `
    import {useConversation} from '../conversation/state/provider';
    import {TaskEmptyState} from '${root}apps/mobile/src/tasks/creation/task-empty-state';
    export const Conversation=({children})=>{
      const task=useConversation();
      return <section aria-label="Thread chat">{task.messages.length?task.messages.map(m=><p key={m.id}>{m.text}</p>):<TaskEmptyState/>}{children}</section>;
    };
  `,
  '../composer/composer': `
    import {useState,useEffect} from 'react';
    import {Schema} from 'effect';
    import {runClientEffect} from '@dovo/client-runtime';
    import {useRuntime} from '../../runtime/connection/provider';
    export const Composer=({task,onSelectRemote,renderAbove,onHistoryBrowsingChange})=>{
      window.setHistoryBrowsing=onHistoryBrowsingChange;
      const runtime=useRuntime();
      const [text,setText]=useState(task.draft);
      const [pending,setPending]=useState(false);
      useEffect(()=>{window.editorMounts++;return ()=>window.editorUnmounts++},[]);
      window.runtimeId=runtime.activeId;
      window.send=async(path='/api/tasks/message')=>{
        setPending(true);
        try {
          await runClientEffect(runtime.callEffect(path,path==='/api/tasks/message'?{id:task.id,text}:{taskId:task.id},Schema.Unknown));
          if(path==='/api/tasks/message')setText('');
        }catch(error){window.failure=String(error)}finally{setPending(false)}
      };
      return <>
        {renderAbove?.(null)}
        <input aria-label="Message" value={text} onChange={e=>setText(e.target.value)}/>
        <span data-pending={pending}>{pending?'Sending':'Ready'}</span>
        <button onClick={()=>runClientEffect(runtime.callEffect('/api/workspace',{collection:'tasks',id:task.id,changes:{setupCommand:{before:task.setupCommand,after:'pnpm install'}}},Schema.Unknown,'PATCH'))}>Settings</button>
        <button onClick={()=>runClientEffect(runtime.callEffect('/api/workspace',{collection:'tasks',id:task.id,changes:{linkedCheckouts:{before:task.linkedCheckouts,after:[{id:'link',repositoryId:'repo',execution:'main',access:'read-only'}]}}},Schema.Unknown,'PATCH'))}>Link project</button><button onClick={()=>window.send()}>Send</button>
        <button onClick={()=>window.send('/api/attachments/upload')}>Attach</button>
        {onSelectRemote&&<button onClick={()=>onSelectRemote('b',{id:'remote',kind:'folder',name:'Remote',path:'/remote',branch:''},text)}>Remote</button>}
      </>;
    };
  `,
  './use-task-lifecycle': `export const useTaskLifecycle=()=>({enabled:true,error:'',busy:false});export const chooseSnoozeDuration=async()=>3600000;`,
  './task-project-sheet': `import {TaskWaitingPanel} from '${root}apps/mobile/src/tasks/detail/task-waiting-panel';export const TaskProjectSheet=({task,onClose,inline,onShare})=>{window.projectInfoInline=inline;return <section><TaskWaitingPanel task={task}/>{onShare&&<button onClick={onShare}>Share thread</button>}<button onClick={onClose}>Close project information</button></section>};`,
  './use-task-viewed': `export const useTaskViewed=()=>({error:false});`,
}
for (const [path, names] of Object.entries({
  './task-linked-pull-sheet': ['TaskLinkedPullSheet'],
  './task-thread-behavior': ['TaskThreadBehavior'],
  '../preview/browser-pane': ['BrowserPane', 'DevicesPane'],
  './side-thread-changes': ['SideThreadChanges'],
  '../conversation/components/agent-side-chats': ['SideThreadActions', 'SideChatAttention'],
  './project-approval-rules': ['ProjectApprovalRules'],
  './task-questions': ['TaskQuestions'],
  './linked-projects': ['LinkedProjects'],
  './rename-thread': ['RenameThread'],
  './task-review': ['TaskReview'],
  '../../terminal/terminal-pane': ['TerminalPane'],
  './task-source': ['TaskSource'],
  '../conversation/components/preparation-progress': ['PreparationProgress'],
  '../conversation/components/review-comments': ['ReviewComments'],
  '../conversation/components/plan-approval': ['PlanApproval'],
  '../conversation/components/side-question': ['SideQuestion'],
  './project-instructions': ['ProjectInstructions'],
  '../conversation/components/review-findings': ['ReviewFindings'],
  '../../scm/review/code-review-card': ['CodeReviewCard'],
  '../../scm/review/code-review-report': ['CodeReviewReport'],
}))
  mocks[path] = names.map((name) => `export const ${name}=()=>null;`).join('\n')

mocks['./task-review'] =
  `export {TaskReview} from '${root}apps/mobile/src/tasks/detail/task-review.tsx';`
mocks['./commit-section'] = 'export const CommitSection=()=>null;'
mocks['./pull-status'] = 'export const PullStatus=()=>null;'
mocks['../files/saved-file-preview'] =
  'export const SavedFilePreview=({checkoutId,file})=> <div>Binary preview {checkoutId} {file.path}</div>;'
mocks['../preview/diff-view'] =
  'export const DiffView=({path,after})=> <div data-git-controls>Git controls {path} {after}</div>;'
mocks['../../scm/review/use-file-review'] =
  'export const useFileReview=()=>({progress:null,ready:false,busy:false,error:"",reload:()=>{window.reviewReloads=(window.reviewReloads??0)+1},setViewed:()=>{}});'
mocks['../../scm/review/use-task-review'] =
  'export const useTaskReview=()=>({report:null,busy:false,error:"",refresh:async()=>{},run:async()=>false});'
mocks['../../scm/review/organize-review'] = 'export const MobileOrganizeReview=()=>null;'
mocks['../../scm/review/file-review'] = 'export const MobileFileReview=()=>null;'
mocks['../../ui/controls/choice'] = 'export const Choice=()=>null;'
mocks['../../ui/controls/field'] =
  'export const Field=({label,value,onChangeText,editable})=> <textarea aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;'

const mobileRequire = createRequire(root + 'apps/mobile/package.json')
mocks['../ui/controls/action'] = mocks['../../ui/controls/action']
mocks['../ui/content/text'] = mocks['../../ui/content/text']
mocks['../runtime/connection/provider'] = `export * from '../../runtime/connection/provider';`
mocks['../runtime/state/application-state'] = mocks['../../runtime/state/application-state']
mocks['./navigation'] = `export * from '../../shell/navigation';`
const built = await build({
  alias: {
    react: mobileRequire.resolve('react'),
    'react/jsx-runtime': mobileRequire.resolve('react/jsx-runtime'),
  },
  stdin: {
    contents: `
      import {useCallback,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Effect} from 'effect';
      import {createRuntimeReadCache,writeRuntimeSnapshotCache,decode,snapshotSchema,taskSchema} from '@dovo/protocol';
      import {RuntimeContext} from '../../runtime/connection/provider';
      import {RouteContext} from 'expo-router';
      import {FocusContext} from '../../shell/navigation';
      import {NewTaskScreen,TaskRouteScreen} from './src/tasks/detail/task-route-screen';
      window.requests=[];window.navigation=[];window.watches=[];window.failure='';window.ownerRefreshes=[];
      window.editorMounts=0;window.editorUnmounts=0;window.providerMounts=0;window.providerUnmounts=0;
      window.caches={};window.cacheReads=0;
      const entries=new Map();
      const storage={getItem:async key=>entries.get(key)??null,setItem:async(key,value)=>{entries.set(key,value)},removeItem:async key=>{entries.delete(key)},removePrefix:async prefix=>{for(const key of entries.keys())if(key.startsWith(prefix))entries.delete(key)}};
      window.seedCache=async(runtimeId,text,cold=false)=>{
        await window.caches[runtimeId]?.close();
        const connection={address:'http://'+runtimeId,token:runtimeId};
        let cache=createRuntimeReadCache(connection,storage,async value=>value);
        const task=decode(taskSchema,{...window.created,id:'cached',historyRevision:0,title:'Cached title',draft:'Cached draft',messages:[{id:'cached-reply',role:'assistant',text}]});
        const snapshot=decode(snapshotSchema,{revision:1,owner:false,detailTaskIds:['cached'],workspace:{version:1,runtimeAddress:'',repositories:[],agents:[],tasks:[task],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
        await Effect.runPromise(writeRuntimeSnapshotCache(cache,{snapshot,lastSeen:null,pulls:null}));
        if(cold){await cache.close();cache=createRuntimeReadCache(connection,storage,async value=>value)};
        const read=cache.read.bind(cache);
        cache.read=async(...args)=>{
          window.cacheReads++;
          if(window.failCacheRead)throw Error('Cache read failed');
          const entry=await read(...args);
          if(window.holdCacheRead)await new Promise(resolve=>window.releaseCacheRead=resolve);
          return entry;
        };
        window.caches[runtimeId]=cache;
        return {...task,title:'Fresh title',draft:'Fresh draft',messages:[]};
      };
      const profiles=['a','b'].map(id=>({id,name:id,connection:{address:'http://'+id,token:'mobile-copy-token-for-'+id}}));
      function App(){
        const [route,setRoute]=useState({href:'/new',params:{},key:0});
        const [activeId,setActiveId]=useState('a');
        const [recovering,setRecovering]=useState(false);window.setPairingRecovery=setRecovering;
        const [online,setOnline]=useState(true);
        const [focused,setFocused]=useState(true);window.setFocused=setFocused;
        const [snapshots,setSnapshots]=useState(Object.fromEntries(profiles.map(p=>[p.id,{
          detailTaskIds:[],questions:[],approvals:[],runs:[],
          workspace:{tasks:[],agents:[],repositories:[{id:'chat-'+p.id,kind:'scratch',name:'No project',path:'/scratch',branch:''}]}
        }])));
        window.params=route.params;
        window.setParams=params=>{setRoute(route=>({...route,params:{...route.params,...params}}));if(params.runtimeId)setActiveId(params.runtimeId)};
        window.openRoute=href=>setRoute(route=>({href:typeof href==='string'?href:href.pathname,params:typeof href==='string'?{}:href.params,key:route.key+1}));
        window.publish=(runtimeId,task,detailed=true)=>setSnapshots(s=>({...s,[runtimeId]:{...s[runtimeId],detailTaskIds:detailed?[task.id]:[],workspace:{...s[runtimeId].workspace,tasks:[task]}}}));
        window.publishSecureInputs=(runtimeId,secureInputs)=>setSnapshots(s=>({...s,[runtimeId]:{...s[runtimeId],secureInputs}}));
        window.online=setOnline;
        window.clearSnapshots=()=>setSnapshots(saved=>{window.snapshotBackup=saved;return {a:null,b:null}});
        window.restoreSnapshots=()=>setSnapshots(window.snapshotBackup);
        window.selectRuntime=setActiveId;window.globalActiveId=activeId;
        window.setLinkedProject=(present)=>setSnapshots(s=>({...s,a:{...s.a,workspace:{...s.a.workspace,repositories:[s.a.workspace.repositories[0],...(present?[{id:'repo',name:'Linked project',path:'/linked',branch:'main'}]:[])]}}}));
        window.makeGit=(runtimeId,kind)=>setSnapshots(s=>({...s,[runtimeId]:{...s[runtimeId],workspace:{...s[runtimeId].workspace,repositories:s[runtimeId].workspace.repositories.map(repo=>({...repo,id:window.created.repositoryId,kind}))}}}));
        const overviews=profiles.map(profile=>({profile,connected:online,snapshot:snapshots[profile.id],unauthorized:window.pairingRejected}));
        const request=(runtimeId,path,input,schema)=>Effect.tryPromise({try:async()=>{
          if(path==='/api/tasks/waiting')return {dependencies:window.watchedItems??[]};
          window.requests.push({runtimeId,path,input});
          if(path==='/api/scm/changes')return decode(schema,window.legacyChanges?{files:window.task.files}:{ok:true});
          if(path==='/api/tasks/native-thread')return {entries:[{id:'native-prompt',role:'user',text:'Native mobile prompt'},{id:'native-answer',role:'assistant',text:'Native mobile answer'}]};
          if(path==='/api/workspace'){window.created=input.create;return {revision:1}}
          if(window.holdMessage&&path==='/api/tasks/message')await new Promise(resolve=>window.releaseMessage=resolve);
          if(window.failAttachment&&path==='/api/attachments/upload'){window.failAttachment=false;throw Error('Upload failed')}
          return {ok:true};
        },catch:error=>error});
        const selectRuntimeEffect=useCallback(id=>Effect.tryPromise({try:async()=>{(window.selectionAttempts??=[]).push(id);if(window.holdSelection)await new Promise(resolve=>window.finishSelection=resolve);if(window.failSelection)throw Error('Secure storage unavailable');setActiveId(id)},catch:error=>error}),[]);
        const refreshRuntime=useCallback(async profile=>{window.ownerRefreshes.push(profile.id);if(window.scopeRefreshTask)setSnapshots(s=>({...s,[profile.id]:{...s[profile.id],detailTaskIds:[window.scopeRefreshTask.id],workspace:{...s[profile.id].workspace,tasks:[window.scopeRefreshTask]}}}))},[]);
        const runtime={ready:true,recovering,selectRuntimeEffect,refreshRuntime,activeId,profiles,profile:profiles.find(p=>p.id===activeId),connected:online,snapshot:snapshots[activeId],overviews,request,call:(...args)=>Effect.runPromise(request(activeId,...args)),readEffect:(...args)=>request(activeId,...args),callEffect:(...args)=>request(activeId,...args),readCache:window.caches[activeId]??null,refresh:async()=>{if(window.holdRefresh)await new Promise((resolve,reject)=>window.finishRefresh={resolve,reject});if(window.failRefresh)throw Error('Computer unavailable')}};
        return <FocusContext.Provider value={focused}><RuntimeContext.Provider value={runtime}><RouteContext.Provider value={route.params}>
          {route.href==='/new'?<NewTaskScreen key={route.key}/>:<TaskRouteScreen key={route.key}/>}
        </RouteContext.Provider></RuntimeContext.Provider></FocusContext.Provider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: root + 'apps/mobile/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native-boundary' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'apps/mobile/',
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByLabel('Message')
  await input.waitFor()
  assert.equal(await page.evaluate(() => window.headerGestures), true)
  await page.evaluate(() => window.setHistoryBrowsing(true))
  await page.waitForFunction(() => window.headerGestures === false)
  await page.evaluate(() => window.setHistoryBrowsing(false))
  await page.waitForFunction(() => window.headerGestures === true)
  assert.deepEqual(await page.evaluate(() => window.navigation.map((n) => n.kind)), ['redirect'])
  assert.equal(await page.evaluate(() => window.watches.length), 0)
  await page.getByRole('button', { name: 'Link project', exact: true }).click()
  await page.waitForFunction(() => window.task.linkedCheckouts?.length === 1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForFunction(() => window.task.setupCommand === 'pnpm install')
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await input.fill('First prompt')
  await input.evaluate((element) => {
    window.originalInput = element
  })
  await page.evaluate(() => {
    window.holdMessage = true
    void window.send()
  })
  await page.waitForFunction(() => !!window.releaseMessage)
  await page.waitForFunction(() => window.temporary === false && window.watches.length === 1)
  assert.equal(await page.evaluate(() => window.temporary), false)
  assert.equal(await page.evaluate(() => window.watches.length), 1)
  assert.equal(await page.locator('[data-pending="true"]').count(), 1)
  assert.equal(await page.evaluate(() => window.editorMounts), 1)
  assert.equal(await page.evaluate(() => window.providerMounts), 1)
  assert.equal(await input.evaluate((element) => element === window.originalInput), true)
  await page.evaluate(() => {
    window.holdMessage = false
    window.releaseMessage()
  })
  await page.waitForFunction(() => window.params.draft === undefined)
  await page.getByLabel('No Project · a', { exact: true }).waitFor()
  assert.ok(!(await page.locator('header').innerText()).includes('No project'))
  await page.waitForFunction(() => window.originalInput.value === '')
  assert.deepEqual(await page.evaluate(() => window.navigation.map((n) => n.kind)), [
    'redirect',
    'params',
  ])
  assert.deepEqual(
    await page.evaluate(() => [
      window.editorMounts,
      window.providerMounts,
      window.editorUnmounts,
      window.providerUnmounts,
    ]),
    [1, 1, 0, 0],
  )
  assert.equal(await input.evaluate((element) => element === window.originalInput), true)
  assert.equal(await page.evaluate(() => window.created.setupCommand), 'pnpm install')
  assert.equal(await page.evaluate(() => window.created.linkedCheckouts[0].repositoryId), 'repo')
  await page.evaluate(() => {
    window.watchedItems = [
      {
        kind: 'pipeline',
        repositoryId: window.created.repositoryId,
        target: '8',
        label: 'Pipeline run 8',
        project: 'Project',
        url: 'https://github.com/team/project/actions/runs/8',
        status: 'running',
      },
    ]
    window.publish(
      'a',
      {
        ...window.created,
        status: 'running',
        watchCounts: { pipelines: 1 },
        messages: [{ id: 'sent', role: 'user', text: 'First prompt' }],
      },
      false,
    )
  })
  await page.getByLabel('Pipeline progress', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('region', { name: 'Thread chat' })
      .getByLabel('Pipeline progress', { exact: true })
      .count(),
    1,
  )
  assert.equal(await page.getByLabel('Pipeline progress', { exact: true }).count(), 1)
  const menuGroups = await page.evaluate(() => [
    ...new Set(
      window.headerActions.filter((action) => action.overflow).map((action) => action.group),
    ),
  ])
  assert.deepEqual(menuGroups, ['Tools', 'Navigate', 'Thread', 'Project', 'Advanced', 'Delete'])
  assert.equal(await page.getByRole('button', { name: 'Share thread', exact: true }).count(), 0)
  assert.equal(await page.getByRole('dialog', { name: 'Share thread' }).count(), 0)
  assert.equal(
    await page.evaluate(() =>
      window.headerActions.some((action) => action.label === 'Share thread'),
    ),
    false,
  )
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click()
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await page.getByRole('button', { name: 'Share thread', exact: true }).click()
  await page.getByRole('dialog', { name: 'Share thread' }).waitFor()
  await page.evaluate(() => window.setSharingAccount(null))
  await page.getByRole('dialog', { name: 'Share thread' }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: 'Share thread', exact: true }).count(), 0)
  await page.evaluate(() => window.setSharingAccount({ directory: {}, deletionPending: true }))
  assert.equal(await page.getByRole('button', { name: 'Share thread', exact: true }).count(), 0)
  await page.evaluate(() => window.setSharingAccount({ directory: {}, deletionPending: false }))
  await page.getByRole('dialog', { name: 'Share thread' }).waitFor()
  await page.getByRole('button', { name: 'Close sharing', exact: true }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Share thread' }).count(), 0)
  assert.deepEqual(await page.evaluate(() => window.headerCollapsedMenuGroups), [
    'Project',
    'Advanced',
  ])
  assert.equal(
    await page.evaluate(() => window.headerActions.find((a) => a.label === 'Thread info').overflow),
    true,
  )
  // General threads show their linked project's information directly when it is available.
  await page.evaluate(() => window.setLinkedProject(true))
  await page.waitForFunction(
    () => window.headerActions.find((a) => a.label === 'Thread info').overflow === false,
  )
  assert.ok((await page.locator('header').innerText()).includes('Linked project'))
  await page.evaluate(() => window.setLinkedProject(false))
  await page.waitForFunction(
    () => window.headerActions.find((a) => a.label === 'Thread info').overflow === true,
  )
  const threadActions = await page.evaluate(() =>
    window.headerActions
      .filter((action) => action.group === 'Thread')
      .map((action) => action.label),
  )
  assert.equal(threadActions[0], 'Rename thread')
  assert.equal(threadActions[1], 'Pin thread')
  assert.ok(threadActions.includes('Settle thread'))
  assert.equal(
    await page.evaluate(() =>
      window.headerActions.some(
        (action) =>
          action.label.startsWith('Copy project checkout') ||
          action.label.startsWith('Copy worktree'),
      ),
    ),
    false,
  )
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click()
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).waitFor()
  // Blurred stack screens remain mounted, but must not retain project information.
  const projectClose = page.getByRole('button', { name: 'Close project information', exact: true })
  await page.evaluate(() => window.setFocused(false))
  await projectClose.waitFor({ state: 'detached' })
  await page.evaluate(() => window.setFocused(true))
  assert.equal(await projectClose.count(), 0)
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await projectClose.waitFor()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await projectClose.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  assert.equal(await projectClose.count(), 0)
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await projectClose.click()
  await page.getByText('First prompt', { exact: true }).waitFor()
  assert.equal(await input.evaluate((element) => element === window.originalInput), true)
  await input.fill('Follow-up')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 3)
  assert.equal(
    await page.evaluate(() => window.requests.filter((r) => r.path === '/api/workspace').length),
    1,
  )

  // Moving an unsent draft changes its runtime intentionally; committing it must only
  // update the owning route params, including after a failed upload and a retry.
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await projectClose.waitFor()
  await page.evaluate(() => window.openRoute('/new'))
  await page.getByRole('button', { name: 'Remote', exact: true }).waitFor()
  assert.equal(await projectClose.count(), 0)
  await input.fill('Remote draft')
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.waitForFunction(() => window.runtimeId === 'b')
  assert.equal(await input.inputValue(), 'Remote draft')
  await input.evaluate((element) => {
    window.originalInput = element
  })
  const mounts = await page.evaluate(() => [window.editorMounts, window.providerMounts])
  await page.evaluate(() => {
    window.requests = []
    window.navigation = []
    window.failAttachment = true
  })
  await page.getByRole('button', { name: 'Attach', exact: true }).click()
  await page.waitForFunction(() => window.failure.includes('Upload failed'))
  assert.equal(await page.evaluate(() => window.params.draft), 'true')
  assert.equal(await input.inputValue(), 'Remote draft')
  await page.getByRole('button', { name: 'Attach', exact: true }).click()
  await page.waitForFunction(() => window.params.draft === undefined)
  assert.deepEqual(await page.evaluate(() => window.navigation.map((n) => n.kind)), ['params'])
  assert.equal(await page.evaluate(() => window.params.runtimeId), 'b')
  assert.deepEqual(await page.evaluate(() => window.requests.map((r) => [r.runtimeId, r.path])), [
    ['b', '/api/workspace'],
    ['b', '/api/attachments/upload'],
    ['b', '/api/attachments/upload'],
  ])
  assert.deepEqual(await page.evaluate(() => [window.editorMounts, window.providerMounts]), mounts)
  assert.equal(await input.evaluate((element) => element === window.originalInput), true)

  // A restored URL carrying a stale draft flag resolves the existing task rather than
  // creating it again, even when another runtime has a task with the same ID.
  await page.evaluate(() => {
    window.publish('b', { ...window.created, draft: 'Restored on b' })
    window.publish('a', { ...window.created, draft: 'Other computer' })
    window.openRoute({ pathname: '/thread', params: { ...window.params, draft: 'true' } })
    window.requests = []
  })
  await page.waitForFunction(() => window.task.draft === 'Restored on b')
  assert.equal(await input.inputValue(), 'Restored on b')
  assert.equal(await page.evaluate(() => window.temporary), false)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 1)
  assert.equal(await page.evaluate(() => window.requests[0].path), '/api/tasks/message')
  assert.equal(await page.evaluate(() => window.requests[0].runtimeId), 'b')

  // Committing must not remove the Changes pane while a push retry is still possible.
  await page.evaluate(() => {
    window.makeGit('b')
    window.publish('b', {
      ...window.created,
      status: 'done',
      files: [{ path: 'changed.ts', before: 'old', after: 'new', viewed: false }],
    })
  })
  await page.waitForFunction(
    () => window.headerActions.find((a) => a.label === 'Thread info').overflow === false,
  )
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await projectClose.waitFor()
  await projectClose.click()
  await page.evaluate(() => {
    window.carMode = true
    window.setLinkedProject(true)
  })
  await page.waitForFunction(
    () => window.headerActions.find((action) => action.label === 'Thread info').overflow === true,
  )
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click()
  await page.getByRole('button', { name: 'Thread info', exact: true }).click()
  await projectClose.waitFor()
  assert.equal(
    await page.evaluate(() => window.projectInfoInline),
    false,
    'Car mode opens Thread Info as a sheet',
  )
  await projectClose.click()
  await page.evaluate(() => {
    window.carMode = false
    window.setLinkedProject(false)
  })
  // The real thread header exposes checkout copying for Git and plain-folder threads.
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click()
  for (const kind of [undefined, 'folder']) {
    await page.evaluate((kind) => window.makeGit('b', kind), kind)
    const copyCheckout = page.getByRole('button', {
      name: 'Copy project checkout to another machine',
      exact: true,
    })
    await copyCheckout.waitFor()
    await copyCheckout.click()
    assert.equal(
      await page.getByLabel('Copy checkout').innerText(),
      await page.evaluate(
        () => window.created.repositoryId + '|' + window.created.id + 'Close copy checkout',
      ),
    )
    await page.getByRole('button', { name: 'Close copy checkout', exact: true }).click()
  }
  await page.evaluate(() => window.makeGit('b'))
  await input.fill('Keep my chat draft')
  await input.evaluate((element) => {
    window.diffInput = element
  })
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  await page.locator('[data-git-controls]').waitFor()
  // The actual review action decodes lightweight and old-runtime replies without losing files.
  for (const legacy of [false, true]) {
    await page.evaluate((legacy) => {
      window.legacyChanges = legacy
      window.reviewReloads = 0
    }, legacy)
    await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
    await page.waitForFunction(() => window.reviewReloads === 1)
    const refreshRequest = await page.evaluate(() =>
      window.requests.findLast((request) => request.path === '/api/scm/changes'),
    )
    assert.equal(refreshRequest.runtimeId, 'b')
    assert.equal(refreshRequest.input.includeFiles, false)
    assert.equal(await page.locator('[data-git-controls]').count(), 1)
  }
  // Returning from a thread diff must keep the same thread and composer mounted.
  const diffRoute = await page.evaluate(() => window.params)
  await page.evaluate(() => {
    window.os = 'ios'
  })
  assert.equal(await page.evaluate(() => window.headerGestures), false)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.params), diffRoute)
  assert.equal(await input.evaluate((element) => element === window.diffInput), true)
  assert.equal(await input.inputValue(), 'Keep my chat draft')
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.params), diffRoute)
  await page.evaluate(() => {
    window.os = 'android'
  })
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  assert.equal(await page.evaluate(() => window.hardwareBack()), true)
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.hardwareBack), undefined)
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('button', { name: 'Edit file', exact: true }).click()
  const fileDraft = page.getByRole('textbox', { name: 'changed.ts', exact: true })
  await fileDraft.fill('Keep my unsaved file edit')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  assert.equal(await fileDraft.inputValue(), 'Keep my unsaved file edit')
  await page.evaluate(() =>
    window.publish('b', {
      ...window.created,
      status: 'done',
      files: [
        { path: 'changed.ts', before: '', after: '', viewed: false, preview: { kind: 'binary' } },
      ],
    }),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Cancel edit', exact: true }).isEnabled(),
    true,
  )
  assert.equal(await fileDraft.inputValue(), 'Keep my unsaved file edit')
  await page.evaluate(() => window.publish('b', { ...window.created, status: 'done', files: [] }))
  await page.waitForFunction(() => window.task.files.length === 0)
  await page.getByRole('button', { name: 'Back to chat', exact: true }).waitFor()
  assert.equal(await fileDraft.inputValue(), 'Keep my unsaved file edit')
  // A saved file edit keeps Changes in the header even before history loads, with no Git changes.
  await page.evaluate(() => {
    window.pendingEditTask = { ...window.task, historyRevision: 1 }
    window.makeGit('b', 'folder')
    window.publish('b', window.pendingEditTask, false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: window.task.id } })
  })
  await page.getByText('Loading conversation…', { exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Changes (0)', exact: true }).isDisabled())
  assert.equal(await page.evaluate(() => window.headerTitleMenuDisabled), true)
  await page.evaluate(() => window.publish('b', window.pendingEditTask, true))
  await input.waitFor()
  await page.getByRole('button', { name: 'Changes (0)', exact: true }).click()
  assert.equal(await page.evaluate(() => window.headerTitleMenuDisabled), false)
  assert.equal(await fileDraft.inputValue(), 'Keep my unsaved file edit')
  await page.evaluate(() => window.makeGit('b'))
  await page.getByRole('button', { name: 'Cancel edit', exact: true }).click()
  await page.getByText('No changed files.', { exact: true }).waitFor()

  // The same path exists in three checkouts; route by checkout ID, including deferred previews.
  await page.evaluate(() => {
    const file = (after) => ({ path: 'same.ts', before: '', after, viewed: false })
    window.publish('b', {
      ...window.created,
      status: 'done',
      files: [],
      turns: [
        {
          id: 'turn',
          status: 'completed',
          checkpoint: {
            files: [file('primary')],
            omitted: [],
            linked: [
              { checkoutId: 'first', repositoryId: 'first', files: [file('first')], omitted: [] },
              {
                checkoutId: 'second',
                repositoryId: 'second',
                files: [file('second')],
                omitted: ['large.bin'],
              },
            ],
          },
        },
      ],
    })
  })
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await page.evaluate(() => window.openCheckpoint('turn', 'same.ts', 'second'))
  await page.getByText('Git controls same.ts second', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await page.evaluate(() => window.openCheckpoint('turn', 'large.bin', 'second'))
  await page.getByText('Binary preview second large.bin', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await page.evaluate(() => window.openCheckpoint('turn', 'same.ts'))
  await page.getByText('Git controls same.ts primary', { exact: true }).waitFor()

  await page.evaluate(() => {
    window.online(false)
    window.selectRuntime('a')
    window.openRoute('/new')
  })
  await input.waitFor()
  assert.equal(await page.evaluate(() => window.runtimeId), 'a')
  await input.fill('Draft while the computer is unreachable')
  const offlineRequests = await page.evaluate(() => window.requests.length)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await input.inputValue(), 'Draft while the computer is unreachable')
  assert.equal(await page.evaluate(() => window.requests.length), offlineRequests)
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.waitForFunction(() => window.runtimeId === 'b')
  assert.equal(await input.inputValue(), 'Draft while the computer is unreachable')
  assert.equal(await page.evaluate(() => window.savedDraft[0]), 'b')
  assert.equal(await page.evaluate(() => window.requests.length), offlineRequests)
  // A never-loaded computer still needs its first workspace; do not invent defaults.
  await page.evaluate(() => {
    window.clearSnapshots()
    window.openRoute('/new')
  })
  await page.getByText('Connect a computer', { exact: true }).waitFor()
  assert.equal(await input.count(), 0)
  await page.evaluate(() => window.restoreSnapshots())

  // Already decoded history opens without another aggregate read, while live metadata wins.
  await page.evaluate(async () => {
    const summary = await window.seedCache('b', 'Decoded reply')
    window.cacheSummary = summary
    window.selectRuntime('b')
    window.online(true)
    window.publish('b', summary, false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: summary.id } })
  })
  await page.getByText('Decoded reply', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.cacheReads), 0)
  assert.equal(await page.evaluate(() => window.task.title), 'Fresh title')
  assert.equal(await input.inputValue(), 'Fresh draft')

  // A rewind invalidates cached history instead of mounting an empty conversation as loaded.
  const loadedHeader = await page.locator('header').boundingBox()
  const loadedSubtitle = await page
    .locator('header span[aria-label]')
    .first()
    .getAttribute('aria-label')
  await page.evaluate(() =>
    window.publish('b', { ...window.cacheSummary, historyRevision: 1 }, false),
  )
  await page.getByText('Loading conversation…', { exact: true }).waitFor()
  assert.equal(
    (await page.locator('header').boundingBox()).y,
    loadedHeader.y,
    'Loading keeps navigation at the top',
  )
  assert.equal(await page.getByText('Decoded reply', { exact: true }).count(), 0)
  assert.equal(await input.count(), 0)
  assert.equal(await page.getByText('Loading', { exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).count(), 1)
  assert.ok(await page.getByLabel(loadedSubtitle, { exact: true }).isVisible())
  assert.ok(await page.getByRole('button', { name: 'Thread info', exact: true }).isDisabled())
  // A failed cache read offers Retry. A failed reconnect keeps its separate network feedback.
  await page.evaluate(() => {
    window.failCacheRead = true
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: 'cached' } })
  })
  await page.getByText('Cache read failed', { exact: true }).waitFor()
  assert.equal(await page.getByText('Loading', { exact: true }).count(), 0)
  await page.evaluate(() => {
    window.failCacheRead = false
    window.holdRefresh = true
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRefresh)
  assert.ok(await page.getByRole('button', { name: 'Retrying…', exact: true }).isDisabled())
  await page.evaluate(() => window.finishRefresh.reject(new Error('Computer unavailable')))
  await page.getByText('Computer unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByText('Cache read failed', { exact: true }).count(), 0)
  await page.evaluate(() => window.online(false))
  await page
    .getByText('This conversation is not cached. Connect b to load it.', { exact: true })
    .waitFor()
  assert.equal(await page.getByText('Loading', { exact: true }).count(), 0)
  await page.evaluate(() => window.online(true))
  await page.getByText('Loading', { exact: true }).waitFor()
  assert.equal(await page.getByText('Computer unavailable', { exact: true }).count(), 0)
  await page.evaluate(() => window.online(false))
  await page.evaluate(() => {
    window.pairingRejected = true
    window.publish('b', { ...window.cacheSummary, historyRevision: 1 }, false)
  })
  await page
    .getByText('This computer rejected this device’s pairing. Open Computers to pair it again.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'Reconnect', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.pairingRejected = false
    window.holdRefresh = false
    window.online(true)
  })
  await page.evaluate(() =>
    window.publish('b', { ...window.cacheSummary, historyRevision: 1 }, true),
  )
  await input.waitFor()
  assert.equal(await page.evaluate(() => window.task.messages.length), 0)

  // A cold cache still hydrates from storage, and a late read cannot replace another computer.
  const readsBeforeCold = await page.evaluate(() => window.cacheReads)
  await page.evaluate(async () => {
    const summary = await window.seedCache('b', 'Persistent reply', true)
    window.publish('b', summary, false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: summary.id } })
  })
  await page.getByText('Persistent reply', { exact: true }).waitFor()
  const reads = await page.evaluate(() => window.cacheReads)
  assert.equal(reads - readsBeforeCold, 1, 'Cold history needs one aggregate cache read')
  await page.evaluate(() => {
    window.holdCacheRead = true
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: 'cached' } })
  })
  await page.waitForFunction(() => !!window.releaseCacheRead)
  await page.evaluate(async () => {
    window.holdCacheRead = false
    const summary = await window.seedCache('a', 'Other computer reply')
    window.selectRuntime('a')
    window.publish('a', summary, false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'a', taskId: summary.id } })
  })
  await page.getByText('Other computer reply', { exact: true }).waitFor()
  await page.evaluate(() => window.releaseCacheRead())
  assert.equal(await page.getByText('Persistent reply', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Other computer reply', { exact: true }).count(), 1)
  // The actual mobile copy action must page with authentication and stop on lost focus.
  await page.evaluate(() => {
    window.online(true)
    window.mobileCopies = []
    window.mobileCopyRequests = []
    window.fetch = async (url, init) => {
      if (new URL(url).pathname !== '/api/tasks/history' || init.method !== 'POST')
        throw new Error('Invalid mobile copy request')
      if (new Headers(init.headers).get('Authorization') !== 'Bearer mobile-copy-token-for-a')
        throw new Error('Unauthenticated mobile copy')
      window.mobileCopyRequests.push(JSON.parse(init.body))
      if (window.holdCopy) {
        window.mobileCopySignal = init.signal
        return new Promise(
          (resolve) =>
            (window.finishMobileCopy = () =>
              resolve(Response.json({ messages: [], turns: [], historyRevision: 0 }))),
        )
      }
      return Response.json({
        messages: [{ id: 'older-copy', role: 'user', text: 'Older mobile request' }],
        turns: [],
        historyRevision: 0,
      })
    }
    window.publish(
      'a',
      {
        ...window.task,
        historyBefore: 'newest-copy',
        historyRevision: 0,
        messages: [{ id: 'newest-copy', role: 'assistant', text: 'Newest mobile reply' }],
      },
      true,
    )
  })
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click()
  const copyButton = page.getByRole('button', { name: 'Copy conversation', exact: true })
  await copyButton.click()
  await page.waitForFunction(() => window.mobileCopies.length === 1)
  const copied = await page.evaluate(() => window.mobileCopies[0])
  assert.ok(copied.indexOf('Older mobile request') < copied.indexOf('Newest mobile reply'))
  assert.deepEqual(await page.evaluate(() => window.mobileCopyRequests[0]), {
    id: 'cached',
    before: 'newest-copy',
  })
  await page.evaluate(() => (window.holdCopy = true))
  await copyButton.click()
  await page.waitForFunction(() => !!window.finishMobileCopy)
  assert.equal(await copyButton.isDisabled(), true)
  await page.evaluate(() => window.setFocused(false))
  await page.waitForFunction(() => window.mobileCopySignal.aborted)
  await page.evaluate(() => window.finishMobileCopy())
  await page.waitForFunction(() =>
    [...document.querySelectorAll('header button')].some(
      (button) => button.textContent === 'Copy conversation' && !button.disabled,
    ),
  )
  assert.equal(await page.evaluate(() => window.mobileCopies.length), 1)
  await page.evaluate(() => {
    window.setFocused(true)
    window.publish(
      'a',
      {
        ...window.task,
        subagents: [
          {
            id: 'native-claude',
            sessionId: 'claude-mobile',
            provider: 'claude',
            name: 'Claude reviewer',
            status: 'completed',
          },
        ],
      },
      true,
    )
  })
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await input.fill('Mobile draft while reading a child')
  await input.evaluate((element) => (window.nativeParentEditor = element))
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('button', { name: 'Open native Claude thread', exact: true }).click()
  await page.getByText('Native mobile answer', { exact: true }).waitFor()
  assert.equal(await input.isVisible(), false)
  const nativeRead = await page.evaluate(() =>
    window.requests.findLast((request) => request.path === '/api/tasks/native-thread'),
  )
  assert.equal(nativeRead.runtimeId, 'a')
  assert.equal(nativeRead.input.provider, 'claude')
  assert.equal(nativeRead.input.sessionId, 'claude-mobile')
  await page.getByRole('button', { name: 'Back to agents', exact: true }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), 'Mobile draft while reading a child')
  assert.equal(await input.evaluate((element) => element === window.nativeParentEditor), true)
  // The real secure-input panel must mount through TaskDetail and discard private text
  // when this retained conversation loses focus or changes panes.
  await page.evaluate(() =>
    window.publishSecureInputs('a', [
      {
        id: 'secure-input:continuity',
        taskId: window.task.id,
        title: 'Private sign-in',
        prompt: 'Enter a private value',
        destination: {
          kind: 'command',
          command: '/fixture/private-login',
          args: [],
          appendNewline: false,
        },
        directory: '/fixture',
        publicKey: '11'.repeat(32),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        status: 'pending',
      },
    ]),
  )
  const privateInput = page.getByLabel('Private value', { exact: true })
  await privateInput.waitFor()
  assert.equal(await privateInput.getAttribute('type'), 'password')
  await privateInput.fill('synthetic-focus-private-value')
  await page.evaluate(() => window.setFocused(false))
  await privateInput.waitFor({ state: 'detached' })
  await page.evaluate(() => window.setFocused(true))
  await privateInput.waitFor()
  assert.equal(await privateInput.inputValue(), '')
  await privateInput.fill('synthetic-pane-private-value')
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await privateInput.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await privateInput.waitFor()
  assert.equal(await privateInput.inputValue(), '')
  assert.equal(await input.inputValue(), 'Mobile draft while reading a child')
  assert.ok(!JSON.stringify(await page.evaluate(() => window.requests)).includes('private-value'))
  await page.evaluate(() => window.publishSecureInputs('a', []))
  // A remote child route retains its parent, including when the child is unavailable.
  await page.evaluate(() =>
    window.openRoute({
      pathname: '/thread',
      params: {
        runtimeId: 'b',
        taskId: 'remote-child',
        parentRuntimeId: 'a',
        parentTaskId: window.task.id,
        parentTitle: 'Release parent',
      },
    }),
  )
  await page.getByRole('button', { name: 'Back to parent · Release parent', exact: true }).click()
  await page.waitForFunction(() => window.navigation.at(-1)?.href?.params?.runtimeId === 'a')
  assert.equal(
    await page.evaluate(() => window.navigation.at(-1).href.params.taskId),
    await page.evaluate(() => window.task.id),
  )
  assert.equal(await page.getByRole('button', { name: /Back to parent ·/ }).count(), 0)
  // A cold cross-computer route renders cached history and the composer while
  // the real route-selection hook is still waiting for secure storage.
  await page.evaluate(() => {
    window.holdSelection = true
    window.selectRuntime('a')
    const task = {
      ...window.task,
      id: 'cold-owner-thread',
      title: 'Cold owner thread',
      draft: 'Owner draft',
      messages: [{ id: 'owner-history', role: 'assistant', text: 'Owner cached history' }],
    }
    window.publish('a', { ...task, draft: 'Wrong computer draft', messages: [] })
    window.publish('b', task)
    window.online(false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: task.id } })
  })
  await page.waitForFunction(() => !!window.finishSelection)
  await page.getByText('Owner cached history', { exact: true }).waitFor({ timeout: 2000 })
  assert.equal(await input.inputValue(), 'Owner draft')
  assert.equal(await page.evaluate(() => window.runtimeId), 'b')
  await input.fill('Draft written before selection saved')
  const mountedEditor = await input.elementHandle()
  await page.evaluate(() => {
    window.holdSelection = false
    window.finishSelection()
  })
  await page.waitForFunction(() => window.globalActiveId === 'b')
  assert.equal(await mountedEditor.evaluate((element) => element.isConnected), true)
  assert.equal(await input.inputValue(), 'Draft written before selection saved')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForFunction(() => window.requests.at(-1)?.input?.id === 'cold-owner-thread')
  assert.equal(await page.evaluate(() => window.requests.at(-1).runtimeId), 'b')
  await page.evaluate(() => {
    window.failSelection = true
    window.selectRuntime('a')
  })
  await page
    .getByRole('alert')
    .filter({ hasText: 'Could not save the selected computer' })
    .waitFor()
  assert.equal(await input.inputValue(), 'Draft written before selection saved')
  assert.equal(await mountedEditor.evaluate((element) => element.isConnected), true)
  await page.evaluate(() => {
    window.failSelection = false
  })
  await page.getByRole('button', { name: 'Retry saving computer', exact: true }).click()
  await page.waitForFunction(() => window.globalActiveId === 'b')
  assert.equal(
    await page.getByRole('button', { name: 'Retry saving computer', exact: true }).count(),
    0,
  )
  assert.equal(await mountedEditor.evaluate((element) => element.isConnected), true)
  assert.equal(await input.inputValue(), 'Draft written before selection saved')
  console.log(
    'Cold cross-computer route: cached history and composer usable before selected-computer storage finishes; owner-bound edits and draft preserved.',
  )
  await page.evaluate(() => {
    window.holdSelection = true
    window.finishSelection = undefined
    window.selectRuntime('a')
    const task = {
      ...window.task,
      id: 'uncached-history',
      draft: 'Uncached thread draft',
      messages: [
        { id: 'fresh-history', role: 'assistant', text: 'History from the thread computer' },
      ],
    }
    window.setPairingRecovery(true)
    window.scopeRefreshTask = task
    window.ownerRefreshes = []
    window.publish('b', { ...task, messages: [] }, false)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: task.id } })
  })
  await page.waitForFunction(() => !!window.finishSelection)
  assert.deepEqual(
    await page.evaluate(() => window.ownerRefreshes),
    [],
    'Thread fetch must wait for pairing recovery before using saved credentials',
  )
  await page.evaluate(() => window.setPairingRecovery(false))
  await page
    .getByText('History from the thread computer', { exact: true })
    .waitFor({ timeout: 2000 })
  assert.deepEqual(await page.evaluate(() => window.ownerRefreshes), ['b'])
  assert.equal(await page.evaluate(() => window.globalActiveId), 'a')
  assert.equal(await input.inputValue(), 'Uncached thread draft')
  await page.evaluate(() => {
    window.holdSelection = false
    window.finishSelection()
  })
  await page.waitForFunction(() => window.globalActiveId === 'b')
  assert.equal(await input.inputValue(), 'Uncached thread draft')
  console.log('Uncached cross-computer history loads before the selected-computer save finishes.')
  await page.evaluate(() => {
    const bot = {
      ...window.task,
      id: 'lasting-bot-route',
      title: 'Lasting Bot',
      status: 'done',
      draft: 'Bot human draft',
      messages: [{ id: 'bot-history', role: 'assistant', text: 'Bot saved conversation' }],
      bot: {
        role: 'Release lead',
        responsibilities: 'Check releases',
        state: 'paused',
        revision: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-11-12T00:00:00Z',
        updatedAt: '2026-11-12T00:00:00Z',
      },
    }
    window.scopeRefreshTask = undefined
    window.publish('b', bot)
    window.openRoute({ pathname: '/thread', params: { runtimeId: 'b', taskId: bot.id } })
  })
  await page.getByText('Bot saved conversation', { exact: true }).waitFor()
  await page.locator('header').getByText('Lasting Bot', { exact: true }).waitFor()
  await page.locator('header').getByLabel('Bot avatar', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.headerActions.every((action) => action.overflow)),
    true,
    'All Bot tools belong in More',
  )
  assert.deepEqual(
    await page.evaluate(() =>
      Object.fromEntries(
        window.headerActions
          .filter((action) => action.label.startsWith('Bot '))
          .map((action) => [action.label, action.icon]),
      ),
    ),
    {
      'Bot settings': 'settings',
      'Bot MCP servers': 'mcp',
      'Bot skills': 'skill',
      'Bot memory': 'memory',
      'Bot routines': 'routines',
    },
  )
  await page.locator('header').getByRole('button', { name: 'Thread tools', exact: true }).click()
  for (const label of [
    'Bot settings',
    'Bot MCP servers',
    'Bot skills',
    'Bot memory',
    'Bot routines',
    'Files',
    'Terminal',
    'Browser',
    'Devices',
    'Agents',
  ])
    await page.locator('header').getByRole('button', { name: label, exact: true }).waitFor()
  await page.evaluate(() => {
    const task = window.task
    window.publish('b', {
      ...task,
      title: 'Renamed Bot',
      bot: { ...task.bot, avatar: 'data:image/webp;base64,UklGRg==' },
    })
  })
  await page.locator('header').getByText('Renamed Bot', { exact: true }).waitFor()
  await page
    .locator('header')
    .getByRole('img', { name: 'Renamed Bot avatar', exact: true })
    .waitFor()

  await page
    .getByText('Release lead · Paused. New messages stay queued until you resume.', { exact: true })
    .waitFor()
  for (const name of [
    'Thread info',
    'Linked projects',
    'Edit project instructions',
    'Project approval rules',
    'Regenerate title',
    'Continue elsewhere',
  ])
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0)
  assert.equal(await input.inputValue(), 'Bot human draft')
  await input.fill('Human edited Bot draft')
  assert.equal(await input.inputValue(), 'Human edited Bot draft')
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((request) => request.path === '/api/bots/create').length,
    ),
    0,
  )
  console.log(
    'Mobile Bot route: real thread history, paused identity and composer drafts use the owning runtime without creating work.',
  )
  await page.evaluate(async () => {
    await Promise.all(Object.values(window.caches).map((cache) => cache.close()))
  })
  assert.deepEqual(errors, [])
  console.log(
    'Mobile draft transition: creation, delayed snapshots, upload retry, restoration and offline startup; decoded cache reuse, revision invalidation, cold hydration, computer isolation, guarded conversation copying, private-input masking and navigation clearing, and file drafts across pane switches, binary refresh and removal passed.',
  )
} finally {
  await browser.close()
}
