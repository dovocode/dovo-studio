import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = `${root}/apps/mobile/src`
const theme = `export const useTheme=()=>({mode:'light',colors:{background:'#fff',text:'#17202a',muted:'#52606d',border:'#ccd2d8',accent:'#315ec6',success:'#22733d',error:'#b42332',elevated:'#edf1f4',surface:'#f3f5f7'},styles:{screen:{display:'flex',flexDirection:'column'},content:{padding:12},text:{color:'#17202a'},muted:{color:'#52606d'},error:{color:'#b42332'},row:{display:'flex',flexDirection:'row',gap:8},card:{padding:12},separator:{borderTop:'1px solid #ccd2d8'}}});`
const controls = `
import {useEffect,useImperativeHandle,useRef} from 'react';
const flat=s=>Object.assign({},...(Array.isArray(s)?s.flat(Infinity):[s]));
export const View=({children,style,accessibilityLabel,onLayout,ref})=>{const node=useRef(null);useImperativeHandle(ref,()=>({measureLayout:(parent,done)=>done(0,120)}));useEffect(()=>{onLayout?.({nativeEvent:{layout:{y:120}}})},[onLayout]);return <div ref={node} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>};
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='alert'?'alert':undefined} style={{display:'block',...flat(style)}}>{children}</span>;
export const Pressable=({children,onPress,disabled,style,accessibilityLabel,accessibilityRole,accessibilityState,testID})=><button role={accessibilityRole} aria-label={accessibilityLabel} aria-selected={accessibilityState?.selected} aria-expanded={accessibilityState?.expanded} data-testid={testID} disabled={disabled} onClick={onPress} style={flat(typeof style==='function'?style({pressed:false}):style)}>{children}</button>;
export const ScrollView=({children,ref,contentContainerStyle,style,testID})=>{useImperativeHandle(ref,()=>({scrollTo:input=>window.scrolls.push(input)}));return <div data-testid={testID} style={{...flat(style),...flat(contentContainerStyle)}}>{children}</div>};
export const Platform={OS:'ios'};export const Keyboard={dismiss(){},addListener:()=>({remove(){}})};export const KeyboardAvoidingView=View;export const RefreshControl=()=>null;export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};export const useWindowDimensions=()=>({height:844,width:390});export const Alert={alert:(title,body,actions)=>{window.alerts.push({title,body});actions?.find(a=>a.style==='destructive')?.onPress()}};
`
const swift = `import {useEffect} from 'react';const Wrap=({children})=><div>{children}</div>;export const Host=Wrap,Group=Wrap,NavigationStack=Wrap,RNHostView=Wrap;export const Toolbar=Object.assign(Wrap,{Content:Wrap});export const Button=({children,onPress,testID})=><button aria-label={testID} onClick={onPress}>{children}</button>;export const BottomSheet=({children,isPresented,onDismiss})=>{useEffect(()=>{if(!isPresented){window.events.push('dismissing');window.completeDismiss=()=>{window.events.push('dismissed');onDismiss()}}},[isPresented]);return <section role="dialog" data-presented={isPresented}>{children}</section>};`
const action = `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`
const field = `export const Field=({label,value,onChangeText,editable=true,multiline})=><label>{label}{multiline?<textarea aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/>}</label>;`
const mocks = {
  '@dovo/studio-core': `export {useTaskWaiting} from '${root}/packages/studio-core/src/use-task-waiting.ts';`,
  'react-native': controls,
  '@expo/ui/swift-ui': swift,
  '@expo/ui/swift-ui/modifiers': [
    'accessibilityLabel',
    'disabled',
    'interactiveDismissDisabled',
    'labelStyle',
    'navigationTitle',
    'navigationBarTitleDisplayMode',
    'presentationDetents',
    'presentationDragIndicator',
  ]
    .map((n) => `export const ${n}=()=>null;`)
    .join(''),
  'expo-router': `export const router={push:href=>{window.events.push('route');window.routes.push(href)}};`,
  'expo-crypto': `export const randomUUID=()=>'00000000-0000-4000-8000-000000000001';`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../shell/navigation': `export const useNavigation=()=>window.navigation;`,
  '../../../shell/navigation': `export const useNavigation=()=>window.navigation;`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  './safe-modal': `export const SafeModal=({children})=><div>{children}</div>;`,
  '../controls/native-icon': `export const NativeIcon=()=>null;export const NativeMenuButton=({onPress,label})=><button onClick={onPress}>{label}</button>;`,
  '../controls/icon-button': `export const IconButton=({label,onPress})=><button onClick={onPress}>{label}</button>;`,
  '../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../ui/content/pull-request-icon': `export const PullRequestIcon=()=>null;`,
  '../../../ui/content/pull-request-icon': `export const PullRequestIcon=()=>null;`,
  '../content/text': `export {Text} from 'react-native';`,
  '../../ui/content/text': `export {Text} from 'react-native';`,
  '../../../ui/content/text': `export {Text} from 'react-native';`,
  '../controls/action': action,
  '../../ui/controls/action': action,
  '../../../ui/controls/action': action,
  '../../ui/controls/field': field,
  '../../../ui/controls/field': field,
  '../../ui/controls/choice': `export const Choice=({label,value,onChange,items})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(i=><option value={i.id} key={i.id}>{i.name}</option>)}</select>;`,
  '../../../ui/controls/choice': `export const Choice=({label,value,onChange,items})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(i=><option value={i.id} key={i.id}>{i.name}</option>)}</select>;`,
  '../theme': theme,
  '../../ui/theme': theme,
  '../../../ui/theme': theme,
  '../../ui/controls/use-action': `import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:async f=>{setBusy(true);try{const r=f();await(Effect.isEffect(r)?Effect.runPromise(r):r)}catch(e){setError(String(e))}finally{setBusy(false)}}}};`,
  '../../../ui/controls/use-action': `import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:async f=>{setBusy(true);try{const r=f();await(Effect.isEffect(r)?Effect.runPromise(r):r)}catch(e){setError(String(e))}finally{setBusy(false)}}}};`,
  '../../ui/content/open-link': `export const openAppLink=async(url,external)=>window.external.push({url,external});export const useOpenAppLink=()=>openAppLink;`,
  '../../../ui/content/open-link': `export const openAppLink=async(url,external)=>window.external.push({url,external});export const useOpenAppLink=()=>openAppLink;`,
  '../../../ui/content/markdown': `export const Markdown=({text})=><p>{text}</p>;`,
  '../../../ui/layout/screen-header': `export const ScreenHeader=({title,leading,actions})=><header><h2>{title}</h2>{leading}{actions}</header>;`,
  '../list/create-pull': `export const CreatePull=()=>null;`,
  './use-pull-detail': `export const usePullDetail=()=>({detail:window.detail,error:'',setError:()=>{},refresh:()=>{},invalidate:()=>{},busy:false,refreshing:false});`,
  '../list/pull-menu': `export const PullMenu=({onStartTask,onOpen})=><><button onClick={()=>onStartTask('new-branch')}>Start PR task</button><button onClick={onOpen}>Open on server</button></>;`,
  './pull-status': `export const PullStatus=()=>null;export const Signal=({signal})=><span>{signal?.label}</span>;export const PullCommentLabel=()=>null;`,
  '../../review/use-file-review': `export const useFileReview=()=>({progress:{files:[],groups:[]},ready:false,setViewed(){},reload(){}});`,
  '../../review/organize-review': `export const MobileOrganizeReview=()=>null;`,
  '../../review/file-review': `export const MobileFileReview=({files,selected,onSelect})=><select aria-label="Changed file" value={selected} onChange={e=>onSelect(e.target.value)}>{files.map(f=><option key={f.path} value={f.path}>{f.path}</option>)}</select>;`,
  '../../../tasks/preview/diff-view': `export const DiffView=()=>null;`,
  '../../runtime/preferences/app-preferences': `export const formatTime=()=>'';export const readMobilePreferences=()=>({mergeMethod:'auto'});`,
  '../../../runtime/preferences/app-preferences': `export const formatTime=()=>'';export const readMobilePreferences=()=>({mergeMethod:'auto'});`,
  '../../scm/connections/project-icon-settings': `export const ProjectIconSettings=()=>null;`,
  './commit-section': `export const CommitSection=()=>null;`,
  './task-source': `export const TaskSource=()=>null;`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {Sheet} from '${mobile}/ui/layout/sheet';import {pullHref} from '${mobile}/shell/source-route';import {githubPullTarget} from '@dovo/protocol';window.pullRoute=url=>{const target=githubPullTarget(url);return pullHref('owner-b','repo',target.number,target)};import {usePullTaskCreation} from '${mobile}/scm/pulls/list/start-pull-task';import {WorkTaskAction} from '${mobile}/scm/work/work-task-action';import {TaskWaitingPanel} from '${mobile}/tasks/detail/task-waiting-panel';import {PullDetail} from '${mobile}/scm/pulls/detail/pull-detail';import {PullActionSheet} from '${mobile}/scm/pulls/list/pull-actions';import {TaskProjectSheet} from '${mobile}/tasks/detail/task-project-sheet';
window.events=[];window.routes=[];window.external=[];window.alerts=[];window.scrolls=[];window.writes=[];
const repo={id:'repo',name:'Studio',path:'/studio',gitIdentity:'github.com/o/r',forge:{connectionId:'account',repository:'o/r',revision:'1'}};
const pull={number:7,title:'Review me',url:'https://github.com/o/r/pull/7',repositoryUrl:'https://github.com/o/r',state:'open',draft:false,author:'dominic',head:'feature',base:'main',headSha:'a'.repeat(40),changedFiles:1,additions:1,deletions:0,assignees:[],reviewers:[],labels:[],updatedAt:''};
const task={id:'thread',repositoryId:'repo',title:'Thread',files:[],messages:[],status:'done',createdAt:'',agentId:'',execution:'local',linkedPullRequests:[{number:7,title:'Review me',url:pull.url,repositoryUrl:pull.repositoryUrl}]};
window.detail={pull,files:[{path:'src/new.ts',previousPath:'src/old.ts',status:'modified',patch:'@@ -1 +1 @@\\n-old\\n+new',additions:1,deletions:1}],checks:[],reviews:[],warnings:[],comments:[{id:'1',kind:'comment',author:'dominic',body:'Discussion target',date:'',url:pull.url+'#issuecomment-1'},{id:'2',kind:'inline',path:'src/old.ts',author:'dominic',body:'Inline target',date:'',url:pull.url+'#discussion_r2'}],capabilities:{provider:'github',actions:['comment','reply','inline-comment'],reviewDecisions:[],mergeMethods:[]}};
const read=async(path,input)=>{if(path==='/api/tasks/waiting')return{dependencies:[{kind:'pipeline',repositoryId:'repo',target:'42',label:'Pipeline 42',project:'Studio',url:'https://github.com/o/r/actions/runs/42'},{kind:'pull',repositoryId:'repo',target:pull.url,label:'PR #7',project:'Studio',url:pull.url}],related:[]};if(path==='/api/scm/open-targets')return{targets:[]};return{ok:true}};
const connection={address:'http://owner-b.local:8787',token:'paired-b'};
window.runtime={activeId:'owner-b',profile:{id:'owner-b',name:'Owner B',connection},connection,connected:true,snapshot:{workspace:{repositories:[repo],tasks:[task,{id:'existing',repositoryId:'repo',workItem:{kind:'issue',url:'https://github.com/o/r/issues/1'},title:'Existing task'},{id:'created',repositoryId:'repo',title:'Created task'}]}},call:read,read,callEffect:(path,input)=>Effect.sync(()=>{window.writes.push({path,input});return {id:'created',status:'done'}}),refreshEffect:()=>Effect.void};
window.navigation={focused:true,navigate:(view,id,owner)=>{window.events.push('task');window.routes.push({view,id,owner})}};
function Create(){const action=usePullTaskCreation('repo',pull);return <button disabled={action.busy} onClick={()=>action.start('new-branch')}>Create PR task</button>}
function App(){const[state,setState]=useState({page:'create',tab:undefined,fragment:''}),[tick,setTick]=useState(0);window.show=(page,tab,fragment='')=>setState({page,tab,fragment});window.update=patch=>{Object.assign(window.runtime,patch);setTick(x=>x+1)};const close=()=>{window.events.push('closed');setState({page:'empty'})};return state.page==='create'?<Sheet title="PR preview" onClose={close}><Create/></Sheet>:state.page==='work'?<Sheet title="Issue preview" onClose={close}><WorkTaskAction repositoryId="repo" source={{kind:'issue',item:{id:'1',url:'https://github.com/o/r/issues/1'}}} disabled={false}/></Sheet>:state.page==='picker'?<Sheet title="Jira preview" onClose={close}><WorkTaskAction jiraSourceId="jira" source={{kind:'issue',item:{id:'1',url:'https://jira.example/TEST-1',revision:'1'}}} disabled={false}/></Sheet>:state.page==='prsheet'?<Sheet title="Linked PR preview" onClose={close}><PullDetail repositoryId="repo" number={7} initialTab="checks" onBack={close}/></Sheet>:state.page==='waiting'?<Sheet title="Project watchers" onClose={close}><TaskWaitingPanel taskId="thread"/></Sheet>:state.page==='project'?<TaskProjectSheet task={task} scripts={[]} branchActions={[]} onClose={close} onChanges={()=>window.events.push('changes')} onPulls={url=>{window.events.push('linked');setState({page:'linked'})}}/>:state.page==='pr'?<PullDetail key={state.tab+state.fragment} repositoryId="repo" number={7} initialTab={state.tab} initialFragment={state.fragment} onBack={()=>setState({page:'empty'})}/>:state.page==='draft'?<PullActionSheet repositoryId="repo" detail={window.detail} target={{action:'comment'}} onClose={close} onDone={()=>window.events.push('posted')}/>:state.page==='linked'?<p>Linked PR destination</p>:<p>Closed</p>};createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: `${root}/packages/studio-ui/node_modules/react`,
    'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
    '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    '@dovo/client-runtime': `${root}/packages/client-runtime/src/index.ts`,
    '@dovo/studio-core': `${root}/packages/studio-core/src/index.ts`,
  },
  plugins: [
    {
      name: 'native-audit-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'native-fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Native audit fixture:', error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const dismiss = async () => {
    await page.waitForFunction(() => window.events.at(-1) === 'dismissing')
    await page.evaluate(() => window.completeDismiss())
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: 'Create PR task', exact: true }).click()
  await page.waitForFunction(() => window.events.includes('dismissing'))
  assert.equal(await page.evaluate(() => window.routes.length), 0)
  await dismiss()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
    view: 'tasks',
    id: 'created',
    owner: 'owner-b',
  })
  assert.deepEqual(await page.evaluate(() => window.events), [
    'dismissing',
    'dismissed',
    'closed',
    'task',
  ])
  await page.evaluate(() => window.show('work'))
  await page.getByRole('button', { name: 'Open linked task', exact: true }).click()
  await dismiss()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
    view: 'tasks',
    id: 'existing',
    owner: 'owner-b',
  })
  assert.deepEqual(
    await page.evaluate(
      () => window.pullRoute('https://github.com/o/r/pull/7/files#discussion_r2').params,
    ),
    {
      runtimeId: 'owner-b',
      repositoryId: 'repo',
      number: '7',
      tab: 'changes',
      fragment: '#discussion_r2',
      navigationUrl: 'https://github.com/o/r/pull/7/files#discussion_r2',
    },
  )
  await page.evaluate(() => window.show('picker'))
  await page.getByRole('button', { name: 'Start task', exact: true }).click()
  await page.getByRole('combobox', { name: 'Dovo project', exact: true }).selectOption('repo')
  const beforePickerRoutes = await page.evaluate(() => window.routes.length)
  await page.getByRole('button', { name: 'Start task', exact: true }).last().click()
  await page.waitForFunction(() => window.events.at(-1) === 'dismissing')
  assert.equal(await page.evaluate(() => window.routes.length), beforePickerRoutes)
  assert.equal(await page.getByRole('dialog').count(), 2)
  await page.evaluate(() => window.completeDismiss())
  await page.waitForFunction(
    () =>
      window.events.at(-1) === 'dismissing' &&
      document.querySelectorAll('[role="dialog"]').length === 1,
  )
  assert.equal(await page.evaluate(() => window.routes.length), beforePickerRoutes)
  await dismiss()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
    view: 'tasks',
    id: 'created',
    owner: 'owner-b',
  })
  await page.evaluate(() => window.show('prsheet'))
  const beforePipelineRoutes = await page.evaluate(() => window.routes.length)
  await page
    .getByRole('button', { name: 'View pipeline runs for this commit', exact: true })
    .click()
  await page.waitForFunction(() => window.events.at(-1) === 'dismissing')
  assert.equal(await page.evaluate(() => window.routes.length), beforePipelineRoutes)
  await dismiss()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1).params), {
    runtimeId: 'owner-b',
    repositoryId: 'repo',
    sha: 'a'.repeat(40),
    pull: '7',
  })
  await page.evaluate(() => window.show('waiting'))
  await page.getByRole('link', { name: 'Open Pipeline 42', exact: true }).click()
  await dismiss()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1).params), {
    runtimeId: 'owner-b',
    repositoryId: 'repo',
    itemId: '42',
    url: 'https://github.com/o/r/actions/runs/42',
  })
  await page.evaluate(() => {
    window.show('empty')
    window.update({ connected: false })
  })
  await page.getByText('Closed', { exact: true }).waitFor()
  await page.evaluate(() => window.show('waiting'))
  await page.getByText('Offline · showing last loaded waiting items.', { exact: false }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Stop watching Pipeline 42', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.update({ connected: true })
    window.show('project')
  })
  const linked = page.getByRole('button', { name: 'Linked PRs (1)', exact: true })
  await linked.waitFor()
  assert.equal(await linked.count(), 1)
  await linked.click()
  await page.waitForFunction(() => window.events.at(-1) === 'dismissing')
  assert.equal(await page.getByText('Linked PR destination', { exact: true }).count(), 0)
  await dismiss()
  await page.getByText('Linked PR destination', { exact: true }).waitFor()
  await page.evaluate(() => window.show('pr', 'checks'))
  await page.getByRole('tab', { name: 'Checks', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('tab', { name: 'Checks', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.evaluate(() => window.show('pr', 'overview', '#issuecomment-1'))
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="PR discussion"]')?.getAttribute('aria-selected') ===
      'true',
  )
  await page.waitForFunction(() => window.scrolls.some((item) => item.y === 120))
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
  assert.equal(
    await page.getByRole('tab', { name: 'Files', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  await page.evaluate(() => window.show('pr', 'overview', '#discussion_r2'))
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="PR changes"]')?.getAttribute('aria-selected') ===
      'true',
  )
  assert.equal(
    await page.getByRole('combobox', { name: 'Changed file' }).inputValue(),
    'src/new.ts',
  )
  await page.evaluate(() => window.show('draft'))
  await page.getByRole('textbox', { name: 'Message' }).fill('Full unsent native draft\nsecond line')
  await page.evaluate(() => {
    window.show('empty')
  })
  await page.getByText('Closed', { exact: true }).waitFor()
  await page.evaluate(() => window.show('draft'))
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Full unsent native draft\nsecond line',
  )
  await page.evaluate(() => window.update({ connected: false }))
  assert.equal(
    await page.getByRole('button', { name: 'Add comment', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Full unsent native draft\nsecond line',
  )
  await page.evaluate(() => {
    window.show('empty')
    window.runtime.snapshot.workspace.repositories[0].forge = {
      connectionId: 'different-account',
      repository: 'o/r',
      revision: '2',
    }
  })
  await page.getByText('Closed', { exact: true }).waitFor()
  await page.evaluate(() => window.show('draft'))
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), '')
  await page.evaluate(() => {
    window.show('empty')
    window.runtime.snapshot.workspace.repositories[0].forge = {
      connectionId: 'account',
      repository: 'o/r',
      revision: '1',
    }
  })
  await page.getByText('Closed', { exact: true }).waitFor()
  await page.evaluate(() => window.show('draft'))
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Full unsent native draft\nsecond line',
  )
  await page.evaluate(() => {
    window.show('empty')
    window.update({
      connection: { address: 'http://owner-b.local:8787', token: 'renewed-pairing' },
    })
  })
  await page.getByText('Closed', { exact: true }).waitFor()
  await page.evaluate(() => window.show('draft'))
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), '')
  assert.deepEqual(errors, [])
  console.log(
    'Native audit: owner-qualified task/linked-task navigation, nested dismissal completion, embedded PR pipeline navigation, watcher pipeline routes/offline cache, Linked PR transitions, PR tabs/comment anchors, full drafts/offline retention and account/pairing isolation passed (Chromium with native presentation stubs).',
  )
} finally {
  await browser.close()
}
