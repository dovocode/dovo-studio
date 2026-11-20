import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = root + '/apps/mobile/src'
const controls = `import {useState,useLayoutEffect,useRef} from 'react';export const Text=({children,style,numberOfLines})=><span style={{display:'block',...flat(style)}}>{children}</span>;const flat=style=>{const value=Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';for(const [axis,edges] of [['Vertical',['Top','Bottom']],['Horizontal',['Left','Right']]])for(const prefix of ['padding','margin']){const key=prefix+axis;if(value[key]!==undefined){for(const edge of edges)value[prefix+edge]=value[key];delete value[key]}}if(value.borderWidth)value.borderStyle='solid';return value};export const View=({children,style,accessibilityLabel})=>{const ref=useRef();useLayoutEffect(()=>{if(Array.from(ref.current.childNodes).some(node=>node.nodeType===3&&node.textContent))throw new Error('Text strings must be rendered within a Text component')});return <div ref={ref} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>};export const Pressable=({children,onPress,disabled,style,accessibilityLabel,accessibilityState,testID})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} data-testid={testID} disabled={disabled} onClick={onPress} style={{display:'flex',flexDirection:'column',border:0,background:'transparent',font:'inherit',textAlign:'left',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;export const Image=({source,style})=><img src={source.uri} style={flat(style)}/>;export const ScrollView=({children,contentContainerStyle,horizontal})=><div style={{overflow:'auto',display:'flex',flexDirection:horizontal?'row':'column',...flat(contentContainerStyle)}}>{children}</div>;export const Alert={alert:(...args)=>window.alerts.push(args)};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};export const Platform={OS:'web'};export const Keyboard={dismiss(){}};`
const action = `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsAction=Action;`
const theme = `export const useTheme=()=>({mode:'dark',colors:{background:'#101014',text:'#efeff2',muted:'#92929e',border:'#303036',surface:'#17171c',selection:'#24324b',accent:'#7297ff',warning:'#e6b96a',success:'#43c983',error:'#fa7185',elevated:'#26262d'},styles:{text:{color:'#efeff2'},muted:{color:'#92929e',fontSize:13},error:{color:'#fa7185'},row:{display:'flex',flexDirection:'row',flexWrap:'wrap',gap:8},card:{border:'1px solid #303036',padding:12,borderRadius:12},separator:{borderTop:'1px solid #303036'}}});`
const mocks = {
  '../../ui/controls/icon-button': `export const IconButton=({label,icon,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress} style={{width:44,height:44,flexShrink:0}}>{icon==='moveUp'?'↑':icon==='moveDown'?'↓':icon==='tune'?'⚙':'✓'}</button>;`,
  '@dovo/studio-core': `export {useTaskWaiting} from '${root}/packages/studio-core/src/use-task-waiting.ts';`,
  'react-native':
    controls +
    `export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input type="checkbox" role="switch" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;`,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};`,
  './harness-settings': `import {useState} from 'react';export function HarnessSettings(){const[draft,setDraft]=useState('');return <div><p>Model controls</p><input aria-label="Model draft fixture" value={draft} onChange={e=>setDraft(e.target.value)}/></div>}`,
  'expo-router': `export const useLocalSearchParams=()=>({approvalId:window.approvalId});export const router={push:href=>{window.route=href;window.childNavigation.push('route')},setParams:({approvalId})=>window.setApprovalRoute(approvalId)};`,
  'lucide-react-native': `export * from 'lucide-react';`,
  'expo-crypto': `let n=0;export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');`,
  'expo-document-picker': `export const getDocumentAsync=async()=>({canceled:true});`,
  'expo-file-system': `export class File{size=0;async base64(){return ''}};`,
  '../../runtime/connection/context': 'export const useRuntime=()=>window.runtime;',
  './thread-pressable': 'export {Pressable} from "react-native";',
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const useRuntimeSelector=select=>select(useRuntime());export const sameRuntimeFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));`,
  '../../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const useRuntimeSelector=select=>select(useRuntime());export const sameRuntimeFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/controls/use-action': `import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:async f=>{setBusy(true);setError('');try{const result=f();await (Effect.isEffect(result)?Effect.runPromise(result):result)}catch(error){setError(String(error))}finally{setBusy(false)}}}};`,
  '../conversation/state/provider':
    'export const useConversationSelector=select=>select({visible:true});',
  '../../notifications/viewport-view':
    'export const NotificationInputView=({children})=><section>{children}</section>;',
  '../../ui/controls/action': action,
  '../../../ui/controls/action': action,
  '../../screens/settings-controls': action,
  '../../ui/content/text': `export {Text} from 'react-native';`,
  '../../../ui/content/text': `export {Text} from 'react-native';`,
  '../../ui/theme': theme,
  '../../../ui/theme': theme,
  '../theme': theme,
  '../../ui/controls/icon': `export {Icon} from '${mobile}/ui/controls/icon';`,
  '../../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../ui/layout/sheet': `import {useImperativeHandle} from 'react';export const useSheetNavigation=()=>action=>action();export const Sheet=({title,children,onClose,ref,headerAction})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section role="dialog" style={{padding:16,background:'#17171c',color:'#efeff2',height:'100vh',overflow:'auto'}}><header style={{display:'flex',justifyContent:'space-between'}}><h2>{title}</h2>{headerAction&&<button aria-label={headerAction.label} onClick={headerAction.onPress} style={{width:44,height:44}}>⚙</button>}<button onClick={onClose}>Close</button></header>{children}</section>};`,
  '../../ui/controls/field': `export const Field=({label,value,onChangeText,editable=true})=><label>{label}<input aria-label={label} disabled={!editable} value={value} onChange={e=>onChangeText(e.target.value)}/></label>;`,
  '../../ui/controls/choice': `export const Choice=({label,value,onChange,items,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/content/open-link': `export const openAppLink=async url=>window.opened=url;export const useOpenAppLink=()=>openAppLink;`,
  '../../scm/pulls/detail/pull-detail': `export const PullDetail=({repositoryId,number,onBack})=><div>Native PR #{number} {repositoryId}<button onClick={onBack}>Back to linked PRs</button></div>;`,
  './task-source': `export const TaskSource=()=>null;`,
  './commit-section': `export const CommitSection=()=> <p>Commit controls</p>;`,
  '../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  '../../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  '../../../runtime/state/app-active': `export const useForegroundInterval=()=>{};`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {TaskProjectSheet} from '${mobile}/tasks/detail/task-project-sheet';import {TaskApprovals} from '${mobile}/tasks/detail/approvals';import {TaskLinkedPullSheet} from '${mobile}/tasks/detail/task-linked-pull-sheet';import {TaskThreadBehavior} from '${mobile}/tasks/detail/task-thread-behavior';import {ProjectIconSettings} from '${mobile}/scm/connections/project-icon-settings';import {PipelineJobs} from '${mobile}/scm/pulls/detail/pipeline-details';
window.calls=[];window.alerts=[];window.childNavigation=[];window.refreshes=0;
const repo={id:'repo',name:'Dovo Studio',path:'/studio',branch:'main',gitIdentity:'github.com/dovocode/dovo-studio',actions:[]};
const task=window.task={id:'thread',title:'Fix sync',repositoryId:'repo',agentId:'',status:'done',createdAt:'',execution:'local',harness:{provider:'codex',model:'gpt-6.1-sol',reasoning:'medium',permission:'full-access',instructions:'',endpoint:''},files:[],messages:[],example:false,pullRequest:{number:7,url:'https://github.com/dovocode/dovo-studio/pull/7',repositoryUrl:'https://github.com/dovocode/dovo-studio',title:'Fix reconnection'},linkedPullRequests:[{number:8,url:'https://github.com/foreign/project/pull/8',repositoryUrl:'https://github.com/foreign/project',title:'Foreign project'}]};
window.setPullStatuses=()=>{task.pullStatus={number:7,url:task.pullRequest.url,state:'open',checks:'failed',checkedAt:'',title:'Fix reconnection',failedChecks:['Browser tests']};task.pullStatuses=[{number:8,url:task.linkedPullRequests[0].url,state:'merged',checks:'passed',checkedAt:''}]};
const read=async(path,input)=>{window.calls.push({path,input});if(path==='/api/scm/open-targets')return{targets:['zed','finder']};if(path==='/api/tasks/waiting')return{dependencies:[{kind:'pipeline',repositoryId:'repo',target:'run-1',url:'https://github.com/dovocode/dovo-studio/actions/runs/1',project:'Studio',label:'Pipeline 1'}],related:[]};return{ok:true}};
window.runtime={connected:true,profile:{id:'mac',name:'MacBook',connection:{address:'http://mac.local',token:'paired'}},snapshot:{workspace:{repositories:[repo],tasks:[task],agents:[]}},read,call:read,refresh:async()=>window.refreshes++,callEffect:(path,input)=>Effect.promise(()=>read(path,input))};
Object.assign(window.runtime.snapshot,{approvals:[],questions:[]});window.runtime.overviews=[window.runtime];window.runtime.profiles=[window.runtime.profile];
window.showChild=()=>{window.runtime.snapshot.workspace.tasks.push({...task,id:'child',title:'Verify child routing',status:'running',delegation:{parentTaskId:'thread',parentRunId:'run',key:'child'}});window.runtime.overviews=[window.runtime];window.setContextUsage(undefined)};

window.approvalReads=[];window.approvalId='wanted';
window.runtime.snapshot.approvals=[{id:'another',taskId:'thread',title:'Different pending approval',detail:'',createdAt:''}];
window.runtime.readEffect=(path,input)=>Effect.callback(resume=>{
  window.approvalReads.push({path,input,reply:events=>resume(Effect.succeed({events})),fail:()=>resume(Effect.fail(new Error('Connection interrupted')))});
});
const jobs=[{id:'test',name:'Tests',status:'success',url:'https://github.com/o/r/actions/runs/1',steps:[{id:'1',name:'Run tests',status:'success'}]},{id:'release',name:'Release',status:'in_progress',url:'https://github.com/o/r/actions/runs/1',steps:[{id:'1',name:'Sign app',status:'in_progress'}]}];
const graph=[{id:'check',name:'Tests',needs:[],jobIds:['test']},{id:'publish',name:'Release',needs:['check'],jobIds:['release']}];
function App(){const[page,setPage]=useState('project');const[,render]=useState(0);window.setContextUsage=usage=>{task.contextUsage=usage;render(n=>n+1)};window.show=setPage;window.approvalConnected=connected=>{window.runtime.connected=connected;render(n=>n+1)};window.setApprovalRoute=id=>{window.approvalId=id;render(n=>n+1)};return page==='approval'?<TaskApprovals taskId="thread"/>:page==='inline'?<div style={{height:'100vh',display:'flex',flexDirection:'column',background:'#101014',color:'#efeff2'}}><header style={{padding:12}}>Thread · Thread info <button onClick={()=>setPage('project')}>i</button></header><TaskProjectSheet onProjects={()=>window.projectsLinked=true} inline task={task} scripts={[]} branchActions={[]} onChanges={()=>window.inlineChanged=true} onPulls={url=>{window.selectedPull=url;setPage('pulls')}} onClose={()=>{window.childNavigation.push('close');setPage('project')}}/><p style={{padding:16}}>Conversation remains available</p></div>:page==='project'?<TaskProjectSheet onProjects={()=>window.projectsLinked=true} task={task} scripts={[]} branchActions={[]} onChanges={()=>window.changed=true} onPulls={url=>{window.selectedPull=url;setPage('pulls')}} onClose={()=>window.childNavigation.push('close')}/>:page==='pulls'?<TaskLinkedPullSheet task={task} onClose={()=>setPage('project')}/>:page==='behavior'?<TaskThreadBehavior task={task} onClose={()=>setPage('project')}/>:page==='icons'?<ProjectIconSettings repository={repo}/>:<PipelineJobs graph={graph} jobs={jobs} hasMore={false} onOpen={url=>window.opened=url}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + '/node_modules', root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-fixtures',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
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
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.error('Native fixture:', e.message)
  })
  await page.route('http://thread-info.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  )
  await page.goto('http://thread-info.test')
  await page.setContent(
    '<style>body{margin:0;background:#101014;color:#efeff2;font-family:system-ui}button{color:inherit;background:#26262d;border:1px solid #40404a;border-radius:8px;min-height:36px;padding:8px}input,select{display:block;max-width:100%}#app{width:100vw}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  await page.getByRole('button', { name: 'More details', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Add project script', exact: true }).count(),
    0,
  )
  assert.equal(await page.getByRole('button', { name: 'Project icon', exact: true }).count(), 0)
  assert.equal(await page.getByText('Not reported', { exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setContextUsage({ used: 170000, limit: 200000, updatedAt: new Date().toISOString() }),
  )
  await page.getByText('85% used', { exact: true }).waitFor()
  assert.ok(
    (await page.getByLabel('Thread info sections', { exact: true }).boundingBox()).height <= 320,
    'Compact mobile info must fit within 320px',
  )
  await page.screenshot({ path: '/tmp/dovo-thread-info-compact-mobile.png' })
  await page.getByText('6.1 Sol', { exact: true }).waitFor()
  const modelToggle = page.getByRole('button', { name: 'Agent & model', exact: true })
  assert.ok((await modelToggle.boundingBox()).height >= 44)
  await modelToggle.click()
  await page.getByText('Model controls', { exact: true }).waitFor()
  await page.getByLabel('Model draft fixture').fill('keep this model draft')
  await page.getByRole('button', { name: 'Hide details', exact: true }).click()
  assert.equal(await page.getByText('Model controls', { exact: true }).isVisible(), false)
  await page.getByRole('button', { name: 'More details', exact: true }).click()
  await page.getByText('Model controls', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Model draft fixture').inputValue(), 'keep this model draft')
  await page.getByRole('button', { name: 'Hide agent & model', exact: true }).click()
  assert.equal(await page.getByText('Model controls', { exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setContextUsage({ used: 170000, limit: 200000, updatedAt: new Date().toISOString() }),
  )
  await page.getByText('85% used', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Customize thread info', exact: true }).click()
  await page.getByRole('button', { name: 'Move Context usage up', exact: true }).click()
  const savedOrder = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadInfoOrder,
  )
  assert.ok(savedOrder.indexOf('usage') < savedOrder.indexOf('lineage'))
  const actualOrder = await page
    .getByLabel('Thread info sections', { exact: true })
    .evaluate((node) =>
      Array.from(node.children)
        .map((child) => child.getAttribute('aria-label'))
        .filter(Boolean),
    )
  assert.ok(
    actualOrder.indexOf('Context usage') < actualOrder.indexOf('Related threads and agents'),
  )
  const usageChoice = page.getByRole('switch', { name: 'Context usage', exact: true })
  await usageChoice.uncheck()
  await page.getByLabel('Context usage', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('85% used', { exact: true }).count(), 0)
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadInfoSections.usage ===
      false,
  )
  await page.getByRole('switch', { name: 'Project actions', exact: true }).uncheck()
  assert.equal(
    await page.getByRole('button', { name: 'Add project script', exact: true }).count(),
    0,
  )
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadInfoSections.scripts ===
      false,
  )
  await page.reload()
  await page.setContent(
    '<style>body{margin:0;background:#101014;color:#efeff2;font-family:system-ui}button{color:inherit;background:#26262d;border:1px solid #40404a;border-radius:8px;min-height:36px;padding:8px}input,select{display:block;max-width:100%}#app{width:100vw}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'Customize thread info', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-label="Context usage"]')?.disabled === false,
  )
  assert.equal(await usageChoice.isChecked(), false)
  assert.deepEqual(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadInfoOrder,
    ),
    savedOrder,
  )
  assert.equal(
    await page.getByRole('switch', { name: 'Project actions', exact: true }).isChecked(),
    false,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Add project script', exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Reset to default', exact: true }).click()
  await page.getByRole('button', { name: 'Done customizing thread info', exact: true }).click()
  await page.getByRole('button', { name: 'More details', exact: true }).click()
  await page.evaluate(() =>
    window.setContextUsage({ used: 42000, updatedAt: new Date().toISOString() }),
  )
  await page.getByText('42k tokens', { exact: true }).waitFor()
  assert.equal(await page.getByText(/% used/).count(), 0)
  const linked = page.getByLabel('Linked pull requests', { exact: true })
  await linked.waitFor()
  assert.equal(
    await page.getByRole('button', { name: /Open in|Choose editor|Looking for editors/ }).count(),
    0,
  )
  assert.equal(
    await page.evaluate(() => window.calls.some((c) => c.path === '/api/scm/open-targets')),
    false,
  )
  const first = linked.getByRole('button', { name: 'Open PR #7: Source pull request', exact: true })
  const second = linked.getByRole('button', { name: 'Open PR #8: Foreign project', exact: true })
  const boxes = await Promise.all([first.boundingBox(), second.boundingBox()])
  assert.ok(boxes.every(Boolean))
  assert.equal(boxes[0].y, boxes[1].y)
  assert.ok(
    boxes[0].y >
      (await page.getByRole('button', { name: 'Add project script', exact: true }).boundingBox()).y,
  )
  await second.click()
  await page.getByRole('button', { name: 'Open PR #8: Foreign project', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.selectedPull),
    'https://github.com/foreign/project/pull/8',
  )
  await page.evaluate(() => window.show('project'))
  await page.getByRole('button', { name: 'More details', exact: true }).click()
  await page.getByText('Watching · Dovo monitors these for updates', { exact: true }).waitFor()
  await page
    .getByRole('button', { name: 'Customize thread info', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/dovo-native-project.png' })
  await page.getByRole('button', { name: 'Add project script', exact: true }).click()
  await page.getByRole('button', { name: 'Add script', exact: true }).click()
  await page.getByLabel('Script 1 name', { exact: true }).fill('Test')
  await page.getByLabel('Script 1 command', { exact: true }).fill('pnpm test')
  await page.getByRole('button', { name: 'Save scripts', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.path === '/api/workspace' && c.input.changes?.actions?.after?.[0].command === 'pnpm test',
    ),
  )
  await page.evaluate(() => window.show('pulls'))
  await page.getByRole('button', { name: 'Open PR #7: Source pull request', exact: true }).click()
  await page.getByText('Native PR #7 repo', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Back to linked PRs' }).click()
  await page.getByRole('button', { name: 'Open PR #8: Foreign project' }).click()
  await page
    .getByText('Native PR #8 https://github.com/foreign/project/pull/8', { exact: false })
    .waitFor()
  await page.evaluate(() => window.show('behavior'))
  await page.getByLabel('Auto-archive after settled').selectOption('on')
  await page.getByLabel('Days in Settled').fill('12')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((c) => c.input.changes?.archiveAfterSettledDays?.after === 12),
  )
  await page.evaluate(() => window.show('icons'))
  await page.getByRole('button', { name: 'Icon or emoji', exact: true }).click()
  await page.getByRole('button', { name: 'Emoji: Rocket', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((c) => c.path === '/api/scm/repositories/icon' && c.input.data),
  )
  assert.equal(await page.evaluate(() => window.refreshes), 1)
  await page.evaluate(() => window.show('pipeline'))
  await page.getByRole('button', { name: 'View job Release', exact: true }).click()
  await page.getByText('Sign app', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-native-pipeline.png' })
  await page.evaluate(() => window.show('inline'))
  await page.getByText('Conversation remains available', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByLabel('Thread info', { exact: true })
      .evaluate((panel) => getComputedStyle(panel).backgroundColor),
    'rgb(23, 23, 28)',
    'Inline Thread Info uses the solid theme surface',
  )
  await page.getByRole('button', { name: 'More details', exact: true }).click()
  await page.getByRole('button', { name: 'Changes (0)', exact: true }).click()
  assert.equal(await page.evaluate(() => window.inlineChanged), true)
  await page.screenshot({ path: '/tmp/dovo-native-project-sticky.png' })
  await page.evaluate(() => {
    window.setPullStatuses()
    window.show('project')
  })
  await page
    .getByRole('button', { name: 'Open PR #7: Fix reconnection. PR #7 · 1 failing', exact: true })
    .waitFor()
  assert.equal(await page.getByText('PR #7 · 1 failing', { exact: true }).count(), 1)
  await page.getByText('PR #8 merged', { exact: true }).waitFor()
  await page
    .getByRole('button', { name: 'Ask the agent to fix the failing checks', exact: true })
    .click()
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.path === '/api/tasks/message' &&
        c.input.id === 'thread' &&
        c.input.text.includes('Browser tests'),
    ),
  )
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth))
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/dovo-native-project-pr-status.png' })
  await page.evaluate(() => window.show('inline'))

  await page.evaluate(() => {
    window.runtime.snapshot.workspace.repositories[0].kind = 'scratch'
    window.show('project')
  })
  await page.getByText('No Project', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'More details', exact: true }).click()
  await page.getByRole('button', { name: 'Link projects', exact: true }).click()
  assert.equal(await page.evaluate(() => window.projectsLinked), true)
  await page.evaluate(() => window.show('approval'))
  await page.getByText('Checking decision…', { exact: true }).waitFor()
  await page.waitForFunction(() => window.approvalReads.length === 1)
  assert.deepEqual(
    await page.evaluate(() => ({
      path: window.approvalReads[0].path,
      input: window.approvalReads[0].input,
    })),
    // No scope filter: the exact ID is matched in the visible family on the client.
    { path: '/api/activity', input: { kind: 'approval', query: 'wanted' } },
  )
  assert.equal(await page.getByText('Different pending approval', { exact: true }).count(), 0)
  await page.evaluate(() => window.approvalReads[0].fail())
  await page.getByText('Could not check this approval.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByText('Checking decision…', { exact: true }).waitFor()
  await page.waitForFunction(() => window.approvalReads.length === 2)
  await page.evaluate(() => window.approvalConnected(false))
  await page.getByText('Reconnect to check this approval.', { exact: true }).waitFor()
  await page.evaluate(() => window.approvalConnected(true))
  await page.waitForFunction(() => window.approvalReads.length === 3)
  await page.evaluate(() => {
    const event = (scope, id, decision) => ({
      id: scope + id,
      scope,
      kind: 'approval',
      time: '',
      summary: '',
      payload: JSON.stringify({ id, status: 'resolved', decision }),
    })
    window.approvalReads[1].reply([event('thread', 'wanted', 'approve')])
    window.approvalReads[2].reply([
      event('different-thread', 'wanted', 'approve'),
      event('thread', 'another', 'always'),
      event('thread', 'wanted', 'deny'),
    ])
  })
  await page.getByText('Recorded decision: Not approved', { exact: true }).waitFor()
  assert.equal(await page.getByText('Different pending approval', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Show pending approvals', exact: true }).click()
  await page.getByText('Different pending approval', { exact: true }).waitFor()
  await page.evaluate(() => window.showChild())
  for (const mode of ['project', 'inline']) {
    await page.evaluate((mode) => {
      window.show(mode)
      window.childNavigation = []
    }, mode)
    await page.getByRole('button', { name: 'Open child thread Verify child routing' }).click()
    assert.deepEqual(await page.evaluate(() => window.childNavigation), ['close', 'route'])
    assert.equal(await page.evaluate(() => window.route.params.taskId), 'child')
    assert.equal(await page.evaluate(() => window.route.params.parentTaskId), 'thread')
  }
  // A child asked for the approval, so its receipt is in the child's scope. The parent finds it.
  const receipt = async (approvalId, payload, text) => {
    const count = await page.evaluate(() => window.approvalReads.length)
    await page.evaluate((approvalId) => {
      window.show('approval')
      window.setApprovalRoute(approvalId)
    }, approvalId)
    await page.waitForFunction((count) => window.approvalReads.length === count + 1, count)
    await page.evaluate((payload) => {
      const event = (scope) => ({
        id: scope + payload.id,
        scope,
        kind: 'approval',
        time: '',
        summary: '',
        payload: JSON.stringify(payload),
      })
      window.approvalReads.at(-1).reply([event('different-thread'), event('child')])
    }, payload)
    await page.getByText(text, { exact: true }).waitFor()
  }
  await receipt(
    'child-wanted',
    { id: 'child-wanted', status: 'resolved', decision: 'session' },
    'Recorded decision: Approved for this session',
  )
  // A withdrawn request is not a recorded denial.
  await receipt(
    'child-withdrawn',
    { id: 'child-withdrawn', status: 'resolved', decision: 'deny', reason: 'withdrawn' },
    'This approval request was withdrawn, or its turn ended. No decision was recorded.',
  )
  assert.equal(await page.getByText('Recorded decision: Not approved', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'React Native project panel: hidden editor controls, inline PR links, scripts, linked PRs, lifecycle overrides, PNG emoji picker, refresh, watchers, pipeline graph and exact approval decision recovery in the thread family passed.',
  )
} finally {
  await browser.close()
}
