import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const ui = `
import {useImperativeHandle} from 'react';
const flat=style=>{const value=Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';return value};export const Text=({children,...props})=><span style={flat(props.style)} role={props.accessibilityRole==='alert'?'alert':undefined}>{children}</span>;
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable=true})=><input aria-label={label} value={value??''} disabled={!editable} onChange={event=>onChangeText(event.target.value)}/>;
export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value??''} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">Choose…</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const Sheet=({children,footer,title,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:after=>{window.dismissals++;onClose?.();after?.()}}));return <section aria-label={title}>{children}{footer}</section>};
export const useSheetNavigation=()=>callback=>{window.dismissals++;callback()};
export const SafeModal=({visible,children})=>visible?<div>{children}</div>:null;
export const ScreenHeader=({title,leading})=><header>{title}{leading}</header>;
export const useTheme=()=>({colors:{background:'#141419',surface:'#1c1c23',elevated:'#25252e',muted:'#aaaab7',border:'#393943',text:'#e9e9ef',accent:'#ad9cfa',error:'#ff7e97'},styles:{screen:{flex:1,backgroundColor:'#141419'},content:{padding:16},text:{color:'#e9e9ef',fontSize:16,lineHeight:22},muted:{color:'#aaaab7',fontSize:13,lineHeight:18},title:{color:'#e9e9ef',fontWeight:'700'},error:{color:'#ff7e97'},row:{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'},card:{backgroundColor:'#1c1c23',borderRadius:12,padding:12,borderWidth:1,borderColor:'#393943',gap:8}},mode:'dark'});
export const Switch=({value,onValueChange,label})=><button onClick={()=>onValueChange(!value)}>{label}</button>;
`
const native = `
const flat=style=>{const value=Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';return value};export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const ScrollView=({children,style,contentContainerStyle,testID})=><div data-testid={testID} style={flat(style)}><div style={{display:'flex',flexDirection:'column',...flat(contentContainerStyle)}}>{children}</div></div>;
export const RefreshControl=()=>null;
export const ActivityIndicator=()=> <span>Loading</span>;
export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;
export const Platform={OS:'ios'};
export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
export const Keyboard={dismiss(){}};
export const Alert={alert:(...args)=>window.alerts.push(args.slice(0,2))};
export const Linking={openURL:async url=>window.external.push(url)};
`
const boundaries = new Map([
  ...[
    'ui/content/text',
    'ui/controls/action',
    'ui/controls/icon-button',
    'ui/controls/icon',
    'ui/controls/field',
    'ui/controls/choice',
    'ui/layout/sheet',
    'ui/layout/safe-modal',
    'ui/layout/screen-header',
    'ui/theme',
    'ui/controls/switch',
  ].map((path) => [mobile + path, ui]),
  [
    mobile + 'runtime/preferences/app-preferences',
    `const preferences={mergeMethod:'auto',pullDraft:false,computerRefresh:'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[]};export const readMobilePreferences=()=>preferences;export const useMobilePreferences=()=>preferences;export const updateMobilePreferences=()=>{};export const carZoom=1;export const useCarMode=()=>false;`,
  ],
  [
    mobile + 'runtime/connection/read-cache',
    `export {browserReadCache as mobileReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
  ],
  [
    mobile + 'runtime/connection/mutation-storage',
    `export {browserMutationStorage as mobileMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
  ],
  [mobile + 'ui/content/task-visualization', 'export const TaskVisualization=()=>null;'],
  [mobile + 'ui/content/code-block', 'export const CodeBlock=()=>null;'],
  [mobile + 'ui/content/server-image', 'export const ServerImage=()=>null;'],
  [
    mobile + 'ui/content/rich-file',
    'export const RichFile=()=>null;export const TemplateCard=()=>null;',
  ],
  [mobile + 'ui/content/mermaid-diagram', 'export const MermaidDiagram=()=>null;'],
  [
    mobile + 'scm/work/work-menu',
    'export const WorkMenu=({actions})=><div>{actions.map((action,index)=><button key={index} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>;',
  ],
])
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState,useEffect} from 'react';
import {RegistryProvider} from '@effect/atom-react';import {Effect} from 'effect';
import {decode,snapshotSchema,pullDetailSchema,forgeWorkOptionsSchema,forgeIssueSchema} from '@dovo/protocol';
import {RuntimeContext,useRuntime} from './apps/mobile/src/runtime/connection/provider';
import {NavigationContext} from './apps/mobile/src/shell/navigation';
import {RuntimeRoute} from './apps/mobile/src/shell/runtime-route';
import {Markdown} from './apps/mobile/src/ui/content/markdown';import {LinkBrowser,openAppLink} from './apps/mobile/src/ui/content/open-link';
import {PullActionSheet} from './apps/mobile/src/scm/pulls/list/pull-actions';
import {LineComment} from './apps/mobile/src/scm/pulls/detail/line-comment';
import {CreatePull} from './apps/mobile/src/scm/pulls/list/create-pull';
import {WorkForm} from './apps/mobile/src/scm/work/work-form';
import {useWorkCollection} from './apps/mobile/src/scm/work/use-work-collection';
import {WorkItemScreen} from './apps/mobile/src/scm/work/work-item';
import {WorkTaskAction} from './apps/mobile/src/scm/work/work-task-action';
import {usePullTaskCreation} from './apps/mobile/src/scm/pulls/list/start-pull-task';
import {usePullDetail} from './apps/mobile/src/scm/pulls/detail/use-pull-detail';
import {usePulls} from './apps/mobile/src/scm/pulls/list/use-pulls';
window.calls=[];window.accepted=[];window.nav=[];window.alerts=[];window.external=[];window.dismissals=0;window.mounts=0;window.remote='old-destination';window.account='account-one';window.sameSha='a'.repeat(40);
const profiles=['one','two'].map(id=>({id,name:id,connection:{address:'http://'+id+'.lan:8787',token:'paired-device-secret-'+id},createdAt:new Date().toISOString()}));
const workspace=(name)=>decode(snapshotSchema,{revision:1,owner:false,workspace:{version:1,runtimeAddress:'',repositories:[{id:'repo',name:'Project '+name,path:'/repo',branch:'main',gitIdentity:'github.com/team/project',pullIdentity:'github.com/team/project',forge:{connectionId:'account-one',repository:'team/project',revision:'binding-1'}}],jiraSources:[{id:'jira',site:'https://team.atlassian.net',project:'TEAM',name}],agents:[],automations:[],tasks:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
const pull=decode(pullDetailSchema,{destination:'old-destination',pull:{destination:'old-destination',connectionId:'account-one',provider:'github',number:7,title:'Same-number PR',url:'https://github.com/team/project/pull/7',state:'open',draft:false,head:'feature',base:'main',author:'dominic',labels:[],updatedAt:'2026-10-14T10:00:00Z',headSha:window.sameSha,baseSha:window.sameSha,repositoryUrl:'https://github.com/team/project',body:'Body',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[]},comments:[],commits:[],files:[],checks:[],warnings:[]});
const options=decode(forgeWorkOptionsSchema,{destination:'old-destination',provider:'jira',issues:true,pipelines:false,issueStates:['Open','Done'],issueTypes:['Task'],assignees:false,labels:true,pipelineActions:[]});
const pipelineOptions=decode(forgeWorkOptionsSchema,{destination:'old-destination',provider:'github',issues:false,pipelines:true,pipelineActions:['run']});
const issue=decode(forgeIssueSchema,{destination:'old-destination',id:'TEAM-7',title:'Same-number issue',type:'Bug',priority:'High',assigneeNames:['Sam Developer'],body:'Investigate and fix the mobile connection issue.',url:'https://team.atlassian.net/browse/TEAM-7',state:'Open',author:'dominic',assignees:[],labels:[],updatedAt:'2026-10-14T10:00:00Z',revision:'same-revision'});
window.blockedPipeline=[];window.pipelineReleases={};window.failedPipeline=[];window.releasePipeline=section=>{window.blockedPipeline=window.blockedPipeline.filter(s=>s!==section);for(const release of window.pipelineReleases[section]??[])release();window.pipelineReleases[section]=[]};
const pipelineRun={destination:'old-destination',id:'42',title:'Mobile pipeline build',url:'https://github.com/team/project/actions/runs/42',status:'success',sha:window.sameSha,attempt:1,ref:'main',actor:'dominic',createdAt:'',updatedAt:''};
const caches=new Map();const cache=profile=>{let value=caches.get(profile.id);if(!value){const data=new Map();value={read:async(key,schema)=>{const row=data.get(key);return row?{...row,value:decode(schema,row.value)}:null},write:async(key,value)=>{data.set(key,{value,cachedAt:'2026-10-14T10:00:00Z'})},remove:async key=>{data.delete(key)},readEffect:key=>Effect.succeed(data.get(key)),writeEffect:(key,value)=>Effect.sync(()=>data.set(key,{value,cachedAt:'2026-10-14T10:00:00Z'})),removeEffect:key=>Effect.sync(()=>data.delete(key))};caches.set(profile.id,value)}return value};
const request=(profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
window.calls.push({owner:profile.id,path,input});
if(path.endsWith('/identity'))return decode(schema,{readerIdentity:window.account,destination:window.remote});
if(input.expectedReaderIdentity&&input.expectedReaderIdentity!==window.account)throw Error('409 reader changed');
if(/\\/(action|comment|create|task)$/.test(path)){
 if(input.expectedDestination!==window.remote)throw Error('409 destination changed');
 window.accepted.push({path,input});
 if(path.endsWith('/task'))return decode(schema,{id:'00000000-0000-4000-8000-000000000007'});
 if(path.includes('/work/'))return decode(schema,{message:'Saved'});
 return decode(schema,{number:7,url:pull.pull.url,status:'complete'});
}
if(path.endsWith('/options/read'))return decode(schema,{destination:window.remote,provider:'github',draft:true});
if(path.endsWith('/definitions'))return decode(schema,{items:[{id:'ci',name:'CI'}],manual:false});
if(path.endsWith('/overview'))return decode(schema,{pulls:[pull.pull],page:1,hasMore:false});
if(path==='/api/scm/work/issues/list')return decode(schema,{items:[issue],next:undefined});
if(input.jiraSourceId && (path==='/api/scm/work/issues/detail'||path==='/api/scm/work/options')){
const section=input.section??'issue-options';
if(window.blockedPipeline.includes(section))await new Promise(resolve=>(window.pipelineReleases[section]??=[]).push(resolve));
if(window.failedPipeline.includes(section))throw Error(section+' temporarily unavailable');
if(section==='issue-options')return decode(schema,{...options,destination:window.remote});
return decode(schema,{destination:window.remote,issue:{...issue,revision:window.issueRevision??issue.revision,destination:window.remote},comments:section==='discussion'?[{id:input.cursor?'2':'1',body:input.cursor?'Second comment':'First comment',author:'Dominic',createdAt:'2026-10-14T10:00:00Z'}]:[],next:section==='discussion'&&!input.cursor?'30':undefined});
}
if(path==='/api/scm/work/pipelines/detail'||path==='/api/scm/work/options'){
const section=input.section??'options';
if(window.blockedPipeline.includes(section))await new Promise(resolve=>(window.pipelineReleases[section]??=[]).push(resolve));
if(window.failedPipeline.includes(section))throw Error(section+' temporarily unavailable');
if(section==='options')return decode(schema,{...pipelineOptions,destination:window.remote});
return decode(schema,{destination:window.remote,run:{...pipelineRun,destination:window.remote},jobs:section==='jobs'?[{id:'job',name:'Mobile compile',status:'success',url:pipelineRun.url,steps:[]}]:[],graph:section==='graph'?[{id:'compile',name:'Mobile compile',jobIds:[],needs:[]}]:undefined});
}
if(path.endsWith('/detail'))return decode(schema,pull);
throw Error('Unexpected request '+path);
},catch:error=>error});
function JiraCollection(){const value=useWorkCollection('issues',JSON.stringify(['one','jira','jira']),'open','TEAM-7');window.jiraCollection=value;return <div>{value.pages.flatMap(page=>page.items).map(item=><span key={item.id}>{item.title}</span>)}</div>}
function Reader(){const value=usePullDetail('repo',7);window.reader=value;return <div aria-label="reader">{value.detail?.pull.title}{value.error}</div>}
function List(){const value=usePulls('','open');window.list=value;return <div aria-label="list">{value.pages.map(page=>page.runtimeName+':'+page.pulls.length).join(',')}</div>}
function Task(){const value=usePullTaskCreation('repo',pull.pull);return <><button onClick={()=>value.start('new-branch')}>Create task</button><span>{value.error}</span></>}
function Detail({kind,observed}){useEffect(()=>{window.mounts++;window.mountedKind=kind},[]);return kind==='jira-collection'?<JiraCollection/>:kind==='jira-detail'?<WorkItemScreen mode="issues" jiraSourceId="jira" itemId="TEAM-7" expectedURL={issue.url} onBack={()=>{}}/>:kind==='pipeline'?<WorkItemScreen mode="pipelines" repositoryId="repo" itemId="42" expectedURL={pipelineRun.url} onBack={()=>{}}/>:kind==='markdown'?<Markdown text="[PR](https://github.com/team/project/pull/7/files#diff-1) [Issue](https://github.com/team/project/issues/7) [Jira](https://team.atlassian.net/browse/TEAM-7) [Pipeline](https://github.com/team/project/actions/runs/7)"/>:kind==='line'?<LineComment repositoryId="repo" detail={pull} path="file.ts" onClose={()=>{}} onDone={()=>{}}/>:kind==='work'?<WorkForm kind="comment" jiraSourceId="jira" issue={issue} options={options} disabled={false} onClose={()=>{}} onDone={()=>{}}/>:kind==='run'?<WorkForm kind="run" repositoryId="repo" options={pipelineOptions} disabled={false} onClose={()=>{}} onDone={()=>{}}/>:kind==='worktask'||kind==='worktaskpicker'?<WorkTaskAction repositoryId={kind==='worktask'?'repo':undefined} jiraSourceId="jira" source={{kind:'issue',item:observed?{...issue,destination:'new-destination'}:issue}} disabled={false}/>:kind==='create'?<CreatePull repositoryId="repo" onClose={()=>{}} onCreated={()=>{}}/>:kind==='task'?<Task/>:kind==='reader'?<Reader/>:<PullActionSheet repositoryId="repo" detail={observed?{...pull,destination:"new-destination",pull:{...pull.pull,destination:"new-destination"}}:pull} target={{action:'comment'}} onClose={()=>{}} onDone={()=>{}}/>}
function App(){const [active,setActive]=useState('one'),[name,setName]=useState('Original Jira'),[kind,setKind]=useState('markdown'),[shown,setShown]=useState(true),[offline,setOffline]=useState(false),[observed,setObserved]=useState(false);
window.setKind=value=>{window.remote='old-destination';setObserved(false);setKind(value)};window.setActive=setActive;window.setShown=setShown;window.setOffline=setOffline;
const overviews=profiles.map(profile=>({profile,connected:profile.id==='one'?!offline:true,snapshot:workspace(name),error:null,pulls:null,pullError:null,lastSeen:null}));
const value={ready:true,activeId:active,profile:profiles.find(p=>p.id===active),connection:profiles.find(p=>p.id===active).connection,profiles,overviews,snapshot:overviews.find(e=>e.profile.id===active).snapshot,connected:true,readRuntimeEffect:request,cacheForRuntime:cache,pendingMessagesFor:()=>[],refreshRuntimeEffect:()=>Effect.void,refreshRuntime:async()=>{},refresh:async()=>{},selectRuntime:()=>{throw Error('No global selection during links')}};
return <RuntimeContext value={value}><NavigationContext value={{focused:true,navigate:(...args)=>window.nav.push(args),setDetail:()=>{},openWork:()=>{}}}><button onClick={()=>setActive('two')}>Select global two</button><button onClick={()=>setName('Renamed Jira')}>Rename Jira</button><button onClick={()=>window.remote='new-destination'}>Rebind remote only</button><button onClick={()=>setObserved(true)}>Observe replacement detail</button><button onClick={()=>window.account='account-two'}>Switch remote account</button>{shown&&<RuntimeRoute runtimeId="one" repositoryId="repo" jiraSourceId={kind==='work'||kind==='jira-detail'||kind==='jira-collection'?'jira':undefined} title="Detail" backTo="/pulls"><Detail key={kind} kind={kind} observed={observed}/></RuntimeRoute>}{kind==='list'&&shown&&<List/>}<LinkBrowser/></NavigationContext></RuntimeContext>}
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
    plugins: [
      {
        name: 'native-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
            const key = resolve(dirname(importer), path).replace(/\.tsx?$/, '')
            return boundaries.has(key) ? { path: key, namespace: 'native-boundary' } : undefined
          })
          builder.onLoad({ filter: /.*/, namespace: 'native-boundary' }, ({ path }) => ({
            contents: boundaries.get(path),
            loader: 'tsx',
            resolveDir: root,
          }))
        },
      },
    ],
  },
  [
    { path: '@dovo/protocol', contents: `export * from '${root}packages/protocol/src/index.ts';` },
    { path: 'react-native', contents: native },
    {
      path: 'react-native-enriched-markdown',
      contents: `export const EnrichedMarkdownText=({markdown,onLinkPress})=>!/[\\[]/.test(markdown)?<div style={{whiteSpace:"pre-wrap"}}>{markdown}</div>:<div>{[...markdown.matchAll(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g)].map((match,index)=><button key={index} onClick={()=>onLinkPress({url:match[2]})}>{match[1]}</button>)}</div>;`,
    },
    { path: 'react-native-webview', contents: 'export default ()=>null;' },
    {
      path: 'react-native-safe-area-context',
      contents: 'export const useSafeAreaInsets=()=>({bottom:0});',
    },
    {
      path: 'expo-router',
      contents: `export const router={push:href=>window.nav.push(href),canGoBack:()=>true,back:()=>window.nav.push('back'),replace:href=>window.nav.push(href)};`,
    },
    {
      path: 'expo-crypto',
      contents: 'export const randomUUID=()=>"00000000-0000-4000-8000-000000000001";',
    },
    {
      path: 'expo-network',
      contents:
        'export const addNetworkStateListener=()=>({remove(){}});export const getNetworkStateAsync=async()=>({isConnected:true});export const NetworkStateType={CELLULAR:"cellular"};',
    },
    {
      path: 'expo-secure-store',
      contents:
        'export const WHEN_UNLOCKED_THIS_DEVICE_ONLY="private";export const getItemAsync=async()=>null;export const setItemAsync=async()=>{};export const deleteItemAsync=async()=>{};',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Select global two' }).click()
  for (const [label, pathname] of [
    ['PR', '/pulls/pr/'],
    ['Issue', '/issues/item/'],
    ['Jira', '/issues/jira/'],
    ['Pipeline', '/pulls/pipeline/'],
  ]) {
    const navigationCount = await page.evaluate(() => window.nav.length)
    await page.getByRole('button', { name: label, exact: true }).click()
    assert.equal(
      await page.evaluate(() => window.nav.length),
      navigationCount,
      'Wait for a link destination',
    )
    const detailLabel =
      label === 'PR'
        ? 'Open PR details'
        : label === 'Pipeline'
          ? 'Open pipeline details'
          : 'Open issue details'
    await page.getByRole('region', { name: 'Open link', exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: 'Open link', exact: true }).count(), 1)
    await page.getByRole('button', { name: detailLabel, exact: true }).click()
    await page.waitForFunction((count) => window.nav.length > count, navigationCount)
    await page
      .getByRole('region', { name: 'Open link', exact: true })
      .waitFor({ state: 'detached' })
    const target = await page.evaluate(() => window.nav.at(-1))
    assert.equal(
      target.params.runtimeId,
      'one',
      label + ' must preserve Markdown origin after global selection',
    )
    assert.ok(target.pathname.startsWith(pathname))
  }
  const choose = async (kind) => {
    await page.evaluate((kind) => window.setKind(kind), kind)
    await page.waitForFunction((kind) => window.mountedKind === kind, kind)
  }
  await choose('action')
  await page.getByRole('textbox', { name: 'Message' }).fill('Unsent PR comment')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Observe replacement detail' }).click()
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Unsent PR comment',
  )
  await choose('line')
  await page.getByRole('textbox', { name: 'Line in the diff' }).fill('1')
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Unsent inline comment')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Post comment', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  await choose('work')
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Unsent Jira comment')
  assert.equal(
    await page.getByRole('textbox', { name: 'Comment', exact: true }).inputValue(),
    'Unsent Jira comment',
    'Typed draft must be committed before rename',
  )
  await page.waitForFunction(() => window.mountedKind === 'work')
  const before = await page.evaluate(() => window.mounts)
  await page.getByRole('button', { name: 'Rename Jira' }).click()
  assert.equal(
    await page.evaluate(() => window.mounts),
    before,
    'Cosmetic Jira rename must not remount detail',
  )
  assert.equal(
    await page.getByRole('textbox', { name: 'Comment', exact: true }).inputValue(),
    'Unsent Jira comment',
  )
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Post comment', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  await choose('task')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.getByText('409 destination changed', { exact: true }).waitFor()
  await choose('create')
  await page.waitForFunction(() => window.calls.some((call) => call.path.endsWith('/options/read')))
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('New PR')
  await page.getByRole('textbox', { name: 'Source branch' }).fill('feature')
  await page.getByRole('textbox', { name: 'Target branch' }).fill('main')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Create pull request', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(),
    'New PR',
  )
  await choose('run')
  await page.getByRole('combobox', { name: 'Pipeline', exact: true }).selectOption('ci')
  await page.getByRole('textbox', { name: 'Branch or ref', exact: true }).fill('main')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Run pipeline', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  await choose('worktask')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Start task', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '409 destination changed' }).waitFor()
  const writes = await page.evaluate(() =>
    window.calls.filter((call) => /\/(action|comment|create|task)$/.test(call.path)),
  )
  assert.equal(writes.length, 7)
  for (const write of writes) {
    assert.equal(write.owner, 'one')
    assert.equal(write.input.expectedDestination, 'old-destination')
  }
  assert.deepEqual(await page.evaluate(() => window.accepted), [])
  await choose('worktaskpicker')
  await page.getByRole('button', { name: 'Start task', exact: true }).click()
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Observe replacement detail' }).click()
  await page
    .locator('section[aria-label="Start task in a project"]')
    .getByRole('button', { name: 'Start task', exact: true })
    .click()
  await page
    .locator('section[aria-label="Start task in a project"]')
    .getByRole('alert')
    .filter({ hasText: '409 destination changed' })
    .waitFor()
  const pickerWrite = await page.evaluate(() => window.calls.at(-1))
  assert.equal(pickerWrite.input.expectedDestination, 'old-destination')
  assert.deepEqual(await page.evaluate(() => window.accepted), [])
  await choose('worktask')
  await page.getByRole('button', { name: 'Rebind remote only' }).click()
  await page.getByRole('button', { name: 'Observe replacement detail' }).click()
  await page.getByRole('button', { name: 'Start task', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.path === '/api/scm/work/task').length === 3,
  )
  const refreshedTaskWrite = await page.evaluate(() => window.calls.at(-1))
  assert.equal(
    refreshedTaskWrite.input.expectedDestination,
    'new-destination',
    'A new task action must capture the detail displayed at its opening click',
  )
  assert.equal(await page.evaluate(() => window.accepted.length), 1)
  await choose('reader')
  await page.waitForFunction(() => !!window.reader?.detail)
  const detailRead = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/scm/pulls/detail').at(-1),
  )
  assert.equal(detailRead.input.expectedReaderIdentity, 'account-one')
  await page.getByRole('button', { name: 'Switch remote account' }).click()
  await page.evaluate(() => window.reader.refresh())
  await page.getByLabel('reader').filter({ hasText: 'different account' }).waitFor()
  await page.evaluate(() => window.reader.acceptCurrentAccount())
  await page.waitForFunction(() => !window.reader.error && !!window.reader.detail)
  const acceptedRead = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/scm/pulls/detail').at(-1),
  )
  assert.equal(
    acceptedRead.input.expectedReaderIdentity,
    'account-two',
    'Explicit acceptance recovers reads without restart',
  )
  await page.evaluate(() => {
    window.account = 'account-one'
    window.setActive('one')
    window.setKind('list')
  })
  await page.waitForFunction(() =>
    window.list?.pages.some((page) => page.runtimeId === 'one' && !page.stale),
  )
  await page.getByRole('button', { name: 'Select global two' }).click()
  assert.equal(await page.evaluate(() => window.list.pages[0].runtimeId), 'one')
  await page.evaluate(() => window.setShown(false))
  await page.evaluate(() => window.setShown(true))
  await page.waitForFunction(() => window.list.pages.some((page) => page.runtimeId === 'one'))
  assert.equal(
    await page.evaluate(() => window.list.pages[0].runtimeId),
    'one',
    'Owner persists through remount after global selection changes',
  )
  await page.evaluate(() => {
    window.account = 'account-two'
    window.blockedPipeline = ['jobs', 'graph', 'options']
    window.setKind('pipeline')
  })
  await page.getByText('Mobile pipeline build', { exact: true }).waitFor()
  await page.getByText('Loading jobs…', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.failedPipeline = ['jobs']
    window.releasePipeline('jobs')
  })
  await page.getByRole('alert').filter({ hasText: 'jobs temporarily unavailable' }).waitFor()
  assert.equal(await page.getByText('Mobile pipeline build', { exact: true }).count(), 1)
  await page.evaluate(() => {
    window.failedPipeline = []
    window.releasePipeline('options')
    window.releasePipeline('graph')
  })
  await page.getByRole('button', { name: 'Refresh jobs', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'Mobile compile' }).last().waitFor()
  assert.equal(
    await page.evaluate(() =>
      window.calls
        .filter((c) => c.path === '/api/scm/work/pipelines/detail')
        .every((c) => c.owner === 'one'),
    ),
    true,
    'Pipeline reads escaped their runtime route',
  )
  await page.evaluate(() => {
    window.setOffline(true)
    window.setShown(false)
  })
  await page.getByText('Mobile pipeline build', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => window.setShown(true))
  await page.getByText('Mobile pipeline build', { exact: true }).waitFor()
  await page.getByRole('button').filter({ hasText: 'Mobile compile' }).last().waitFor()
  await page.evaluate(() => {
    window.setOffline(false)
    window.blockedPipeline = ['discussion', 'issue-options']
    window.setKind('jira-detail')
  })
  await page.getByText('Same-number issue', { exact: true }).waitFor()
  await page.getByText('Loading discussion…', { exact: true }).last().waitFor()
  assert.equal(await page.getByText('No comments yet.', { exact: true }).count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'Add comment', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.failedPipeline = ['discussion', 'issue-options']
    window.releasePipeline('discussion')
    window.releasePipeline('issue-options')
  })
  await page.getByRole('alert').filter({ hasText: 'discussion temporarily unavailable' }).waitFor()
  await page
    .getByText('Issue actions: issue-options temporarily unavailable', { exact: true })
    .waitFor()
  assert.equal(await page.getByText('Same-number issue', { exact: true }).count(), 1)
  await page.evaluate(() => {
    window.failedPipeline = []
  })
  await page.getByRole('button', { name: 'Refresh discussion', exact: true }).click()
  await page.getByText('Discussion · 1+', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'More comments', exact: true }).click()
  await page.getByText('Discussion · 2', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retry actions', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Add comment' && !button.disabled,
    ),
  )
  await page.getByText('Discussion · 2', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() =>
      window.calls
        .filter((call) => call.path === '/api/scm/work/issues/detail')
        .every((call) => call.owner === 'one'),
    ),
    true,
  )
  await page.evaluate(() => {
    window.setOffline(true)
    window.setShown(false)
  })
  await page.getByText('Same-number issue', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => window.setShown(true))
  await page.getByText('Same-number issue', { exact: true }).waitFor()
  await page.getByText('Discussion · 2', { exact: true }).waitFor()
  await page.evaluate(() => window.setOffline(false))
  await page.getByRole('button', { name: 'Add comment', exact: true }).waitFor()
  await mkdir('/tmp/dovo-jira', { recursive: true })
  await page.addStyleTag({
    content:
      'body{margin:0;background:#141419;color:#e9e9ef;font-family:system-ui}button{color:inherit;background:#25252e;border:1px solid #393943;border-radius:7px;padding:8px 12px;font:inherit}header{display:flex;gap:12px;align-items:center;padding:16px}span{overflow-wrap:anywhere}',
  })
  await page
    .locator('[data-testid="Work detail content"]')
    .screenshot({ path: '/tmp/dovo-jira/mobile-dark.png' })
  await page.evaluate(() => {
    window.blockedPipeline = ['issue-options']
    window.setKind('jira-collection')
  })
  await page.waitForFunction(() => window.jiraCollection?.pages[0]?.items.length === 1)
  assert.equal(await page.evaluate(() => window.jiraCollection.pages[0].searched), true)
  assert.equal(await page.evaluate(() => window.jiraCollection.pages[0].options), undefined)
  await page.evaluate(() => {
    window.failedPipeline = ['issue-options']
    window.releasePipeline('issue-options')
  })
  await page.waitForFunction(
    () => window.jiraCollection.pages[0]?.optionsError === 'issue-options temporarily unavailable',
  )
  assert.equal(
    await page.evaluate(() => window.jiraCollection.pages[0].items[0].title),
    'Same-number issue',
  )
  assert.equal(await page.evaluate(() => window.jiraCollection.pages[0].stale), false)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile integration continuity passed: actual RuntimeScope and Markdown owner after global selection; PR action/inline/create/task and Jira destination guards; preserved rejected drafts and Jira rename mount; verified reader/account rejection and explicit recovery; retained list owner through remount; pipeline/Jira task guards; actual pipeline and Jira screens independent overview/options/discussion loading, section failure/retry, pagination, pinned runtime and offline sections. Native boundaries mocked; no device or provider writes.',
  )
} finally {
  await browser.close()
}
