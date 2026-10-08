import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
// Exercise the real route, startup controller, creation runtime and TaskDetail. Native
// controls/conversation content are boundaries; their mount counts expose page replacement.
const mocks = {
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
  'react-native': `
    export const View=({children})=><div>{children}</div>;
    export const ActivityIndicator=()=> <span>Loading</span>;
    export const Keyboard={dismiss:()=>{}};
    export const Alert={alert:()=>{}};
    export const AccessibilityInfo={announceForAccessibility:()=>{}};
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
    export const RuntimeContext=createContext(null);
    export const useRuntime=()=>useContext(RuntimeContext);
    export const RuntimeScope=({runtimeId,children})=>{
      const root=useRuntime();
      const entry=root.overviews.find(entry=>entry.profile.id===runtimeId);
      return <RuntimeContext.Provider value={{...root,activeId:runtimeId,profile:entry.profile,
        snapshot:entry.snapshot,connected:entry.connected,
        readEffect:(...args)=>root.request(runtimeId,...args),
        callEffect:(...args)=>root.request(runtimeId,...args)}}>{children}</RuntimeContext.Provider>;
    };
  `,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;`,
  '../../shell/navigation': `export const useNavigation=()=>({focused:true,navigate:()=>{}});`,
  '../../shell/use-route-computer': `export const useRouteComputer=()=>({error:'',retry:()=>{}});`,
  '../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/use-action': `export const useAction=()=>({busy:false,error:'',act:()=>{}});`,
  '../../ui/layout/sheet': `export const Sheet=()=>null;`,
  '../../ui/theme': `export const useTheme=()=>({colors:{},styles:{}});`,
  '../../ui/layout/screen-header': `export const ScreenHeader=({title,buttons})=><header>{title}{buttons?.filter(b=>!b.overflow).map(b=><button key={b.label} onClick={b.onPress}>{b.label}</button>)}</header>;`,
  '../../ui/content/clipboard': `export const copyText=async()=> 'copied';`,
  '../../ui/content/artifacts': `export const ArtifactBrowser=()=>null;`,
  '../draft/use-draft': `export const saveRuntimeDraft=async(...args)=>{window.savedDraft=args};`,
  './folder-picker': `export const FolderPicker=()=>null;`,
  '../conversation/state/provider': `
    import {createContext,useContext,useEffect} from 'react';
    export const ConversationContext=createContext(null);
    export const useConversation=()=>useContext(ConversationContext);
    export const ConversationProvider=({children,task,temporary})=>{
      useEffect(()=>{window.providerMounts++;return ()=>window.providerUnmounts++},[]);
      window.task=task;window.temporary=temporary;
      return <ConversationContext.Provider value={task}>{children}</ConversationContext.Provider>;
    };
  `,
  '../conversation/view': `
    import {useConversation} from '../conversation/state/provider';
    import {TaskEmptyState} from '${root}apps/mobile/src/tasks/creation/task-empty-state';
    export const Conversation=({onBrowse})=>{
      const task=useConversation();
      return task.messages.length?task.messages.map(m=><p key={m.id}>{m.text}</p>):<TaskEmptyState onBrowse={onBrowse}/>;
    };
  `,
  '../composer/composer': `
    import {useState,useEffect} from 'react';
    import {Schema} from 'effect';
    import {runClientEffect} from '@dovo/client-runtime';
    import {useRuntime} from '../../runtime/connection/provider';
    export const Composer=({task,onSelectRemote,renderAbove})=>{
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
        <button onClick={()=>window.send()}>Send</button>
        <button onClick={()=>window.send('/api/attachments/upload')}>Attach</button>
        {onSelectRemote&&<button onClick={()=>onSelectRemote('b',{id:'remote',kind:'folder',name:'Remote',path:'/remote',branch:''},text)}>Remote</button>}
      </>;
    };
  `,
  './use-task-lifecycle': `export const useTaskLifecycle=()=>({enabled:true,error:'',busy:false});`,
  './use-task-viewed': `export const useTaskViewed=()=>({error:false});`,
}
for (const [path, names] of Object.entries({
  './task-agents': ['TaskAgents'],
  '../preview/browser-pane': ['BrowserPane', 'DevicesPane'],
  '../composer/message-queue': ['MessageQueue'],
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
}))
  mocks[path] = names.map((name) => `export const ${name}=()=>null;`).join('\n')

mocks['./task-review'] = 'export const TaskReview=()=> <div data-git-controls>Git controls</div>;'

const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Effect} from 'effect';
      import {RuntimeContext} from '../../runtime/connection/provider';
      import {RouteContext} from 'expo-router';
      import {NewTaskScreen,TaskRouteScreen} from './src/tasks/detail/task-route-screen';
      window.requests=[];window.navigation=[];window.watches=[];window.failure='';
      window.editorMounts=0;window.editorUnmounts=0;window.providerMounts=0;window.providerUnmounts=0;
      const profiles=['a','b'].map(id=>({id,name:id,connection:{address:'http://'+id}}));
      function App(){
        const [route,setRoute]=useState({href:'/new',params:{},key:0});
        const [activeId,setActiveId]=useState('a');
        const [online,setOnline]=useState(true);
        const [snapshots,setSnapshots]=useState(Object.fromEntries(profiles.map(p=>[p.id,{
          detailTaskIds:[],questions:[],approvals:[],runs:[],
          workspace:{tasks:[],agents:[],repositories:[{id:'chat-'+p.id,kind:'scratch',name:'Chat',path:'/scratch',branch:''}]}
        }])));
        window.params=route.params;
        window.setParams=params=>{setRoute(route=>({...route,params:{...route.params,...params}}));if(params.runtimeId)setActiveId(params.runtimeId)};
        window.openRoute=href=>setRoute(route=>({href:typeof href==='string'?href:href.pathname,params:typeof href==='string'?{}:href.params,key:route.key+1}));
        window.publish=(runtimeId,task,detailed=true)=>setSnapshots(s=>({...s,[runtimeId]:{...s[runtimeId],detailTaskIds:detailed?[task.id]:[],workspace:{...s[runtimeId].workspace,tasks:[task]}}}));
        window.online=setOnline;
        window.makeGit=runtimeId=>setSnapshots(s=>({...s,[runtimeId]:{...s[runtimeId],workspace:{...s[runtimeId].workspace,repositories:s[runtimeId].workspace.repositories.map(repo=>({...repo,id:window.created.repositoryId,kind:undefined}))}}}));
        const overviews=profiles.map(profile=>({profile,connected:online,snapshot:snapshots[profile.id]}));
        const request=(runtimeId,path,input)=>Effect.tryPromise({try:async()=>{
          window.requests.push({runtimeId,path,input});
          if(path==='/api/workspace'){window.created=input.create;return {revision:1}}
          if(window.holdMessage&&path==='/api/tasks/message')await new Promise(resolve=>window.releaseMessage=resolve);
          if(window.failAttachment&&path==='/api/attachments/upload'){window.failAttachment=false;throw Error('Upload failed')}
          return {ok:true};
        },catch:error=>error});
        const runtime={ready:true,activeId,profiles,profile:profiles.find(p=>p.id===activeId),connected:online,snapshot:snapshots[activeId],overviews,request,refresh:async()=>{}};
        return <RuntimeContext.Provider value={runtime}><RouteContext.Provider value={route.params}>
          {route.href==='/new'?<NewTaskScreen key={route.key}/>:<TaskRouteScreen key={route.key}/>}
        </RouteContext.Provider></RuntimeContext.Provider>;
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
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByLabel('Message')
  await input.waitFor()
  assert.deepEqual(await page.evaluate(() => window.navigation.map((n) => n.kind)), ['redirect'])
  assert.equal(await page.evaluate(() => window.watches.length), 0)
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
  await page.evaluate(() =>
    window.publish(
      'a',
      {
        ...window.created,
        status: 'running',
        messages: [{ id: 'sent', role: 'user', text: 'First prompt' }],
      },
      false,
    ),
  )
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
  await page.evaluate(() => window.openRoute('/new'))
  await page.getByRole('button', { name: 'Remote', exact: true }).waitFor()
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
    window.publish('b', { ...window.created, status: 'done', files: [{ path: 'changed.ts' }] })
  })
  await page.getByRole('button', { name: 'Changes (1)', exact: true }).click()
  await page.locator('[data-git-controls]').waitFor()
  await page.evaluate(() => window.publish('b', { ...window.created, status: 'done', files: [] }))
  await page.getByRole('button', { name: 'Changes (0)', exact: true }).waitFor()
  assert.equal(await page.locator('[data-git-controls]').count(), 1)

  await page.evaluate(() => {
    window.online(false)
    window.openRoute('/new')
  })
  await page.getByText('Connect a computer', { exact: true }).waitFor()
  assert.equal(await input.count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile draft transition: one mounted screen/provider/editor through creation, send, delayed snapshots, upload retry and owner-qualified URL updates; restoration and offline startup passed.',
  )
} finally {
  await browser.close()
}
