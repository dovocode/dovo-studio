import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = root + '/apps/mobile/src'
const controls = `import {useState} from 'react';export const Text=({children,style,numberOfLines})=><span style={{display:'block',...flat(style)}}>{children}</span>;const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;export const Pressable=({children,onPress,disabled,style,accessibilityLabel,accessibilityState,testID})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} data-testid={testID} disabled={disabled} onClick={onPress} style={{display:'flex',flexDirection:'column',border:0,background:'transparent',font:'inherit',textAlign:'left',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;export const Image=({source,style})=><img src={source.uri} style={flat(style)}/>;export const ScrollView=({children,contentContainerStyle,horizontal})=><div style={{overflow:'auto',display:'flex',flexDirection:horizontal?'row':'column',...flat(contentContainerStyle)}}>{children}</div>;export const Alert={alert:(...args)=>window.alerts.push(args)};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};export const Platform={OS:'web'};export const Keyboard={dismiss(){}};`
const action = `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsAction=Action;`
const theme = `export const useTheme=()=>({mode:'dark',colors:{background:'#101014',text:'#efeff2',muted:'#92929e',border:'#303036',accent:'#7297ff',success:'#43c983',error:'#fa7185',elevated:'#26262d'},styles:{text:{color:'#efeff2'},muted:{color:'#92929e',fontSize:13},error:{color:'#fa7185'},row:{display:'flex',flexDirection:'row',flexWrap:'wrap',gap:8},card:{border:'1px solid #303036',padding:12,borderRadius:12},separator:{borderTop:'1px solid #303036'}}});`
const mocks = {
  '@dovo/studio-core': `export {useTaskWaiting} from '${root}/packages/studio-core/src/use-task-waiting.ts';`,
  'react-native': controls,
  'expo-router': `export const router={push:href=>window.route=href};`,
  'lucide-react-native': `export * from 'lucide-react';`,
  'expo-crypto': `let n=0;export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');`,
  'expo-document-picker': `export const getDocumentAsync=async()=>({canceled:true});`,
  'expo-file-system': `export class File{size=0;async base64(){return ''}};`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/controls/use-action': `import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:async f=>{setBusy(true);setError('');try{const result=f();await (Effect.isEffect(result)?Effect.runPromise(result):result)}catch(error){setError(String(error))}finally{setBusy(false)}}}};`,
  '../../ui/controls/action': action,
  '../../../ui/controls/action': action,
  '../../screens/settings-controls': action,
  '../../ui/content/text': `export {Text} from 'react-native';`,
  '../../../ui/content/text': `export {Text} from 'react-native';`,
  '../../ui/theme': theme,
  '../../../ui/theme': theme,
  '../theme': theme,
  '../../ui/controls/icon': `export const Icon=({name})=><span>{name==='preview'?'◉':'◇'}</span>;`,
  '../../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../ui/layout/sheet': `import {useImperativeHandle} from 'react';export const useSheetNavigation=()=>action=>action();export const Sheet=({title,children,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section role="dialog" style={{padding:16,background:'#17171c',color:'#efeff2',height:'100vh',overflow:'auto'}}><header style={{display:'flex',justifyContent:'space-between'}}><h2>{title}</h2><button onClick={onClose}>Close</button></header>{children}</section>};`,
  '../../ui/controls/field': `export const Field=({label,value,onChangeText,editable=true})=><label>{label}<input aria-label={label} disabled={!editable} value={value} onChange={e=>onChangeText(e.target.value)}/></label>;`,
  '../../ui/controls/choice': `export const Choice=({label,value,onChange,items,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/content/open-link': `export const openAppLink=async url=>window.opened=url;export const useOpenAppLink=()=>openAppLink;`,
  '../../scm/pulls/detail/pull-detail': `export const PullDetail=({repositoryId,number,onBack})=><div>Native PR #{number} {repositoryId}<button onClick={onBack}>Back to linked PRs</button></div>;`,
  './task-source': `export const TaskSource=()=>null;`,
  './pull-status': `export const PullStatus=()=>null;`,
  './commit-section': `export const CommitSection=()=> <p>Commit controls</p>;`,
  '../../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  '../../../runtime/state/app-active': `export const useForegroundInterval=()=>{};`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {TaskProjectSheet} from '${mobile}/tasks/detail/task-project-sheet';import {TaskLinkedPullSheet} from '${mobile}/tasks/detail/task-linked-pull-sheet';import {TaskThreadBehavior} from '${mobile}/tasks/detail/task-thread-behavior';import {ProjectIconSettings} from '${mobile}/scm/connections/project-icon-settings';import {PipelineJobs} from '${mobile}/scm/pulls/detail/pipeline-details';
window.calls=[];window.alerts=[];window.refreshes=0;
const repo={id:'repo',name:'Dovo Studio',path:'/studio',branch:'main',gitIdentity:'github.com/dovocode/dovo-studio',actions:[]};
const task={id:'thread',title:'Fix sync',repositoryId:'repo',agentId:'',status:'done',createdAt:'',execution:'local',files:[],messages:[],example:false,pullRequest:{number:7,url:'https://github.com/dovocode/dovo-studio/pull/7',repositoryUrl:'https://github.com/dovocode/dovo-studio',title:'Fix reconnection'},linkedPullRequests:[{number:8,url:'https://github.com/foreign/project/pull/8',repositoryUrl:'https://github.com/foreign/project',title:'Foreign project'}]};
const read=async(path,input)=>{window.calls.push({path,input});if(path==='/api/scm/open-targets')return{targets:['zed','finder']};if(path==='/api/tasks/waiting')return{dependencies:[{kind:'pipeline',repositoryId:'repo',target:'run-1',url:'https://github.com/dovocode/dovo-studio/actions/runs/1',project:'Studio',label:'Pipeline 1'}],related:[]};return{ok:true}};
window.runtime={connected:true,profile:{id:'mac',name:'MacBook',connection:{address:'http://mac.local',token:'paired'}},snapshot:{workspace:{repositories:[repo],tasks:[task]}},read,call:read,refresh:async()=>window.refreshes++,callEffect:(path,input)=>Effect.promise(()=>read(path,input))};
const jobs=[{id:'test',name:'Tests',status:'success',url:'https://github.com/o/r/actions/runs/1',steps:[{id:'1',name:'Run tests',status:'success'}]},{id:'release',name:'Release',status:'in_progress',url:'https://github.com/o/r/actions/runs/1',steps:[{id:'1',name:'Sign app',status:'in_progress'}]}];
const graph=[{id:'check',name:'Tests',needs:[],jobIds:['test']},{id:'publish',name:'Release',needs:['check'],jobIds:['release']}];
function App(){const[page,setPage]=useState('project');window.show=setPage;return page==='inline'?<div style={{height:'100vh',display:'flex',flexDirection:'column',background:'#101014',color:'#efeff2'}}><header style={{padding:12}}>Thread · Project information <button onClick={()=>setPage('project')}>i</button></header><TaskProjectSheet onProjects={()=>window.projectsLinked=true} inline task={task} scripts={[]} branchActions={[]} onChanges={()=>window.inlineChanged=true} onPulls={()=>setPage('pulls')} onClose={()=>setPage('project')}/><p style={{padding:16}}>Conversation remains available</p></div>:page==='project'?<TaskProjectSheet onProjects={()=>window.projectsLinked=true} task={task} scripts={[]} branchActions={[]} onChanges={()=>window.changed=true} onPulls={()=>setPage('pulls')} onClose={()=>{}}/>:page==='pulls'?<TaskLinkedPullSheet task={task} onClose={()=>setPage('project')}/>:page==='behavior'?<TaskThreadBehavior task={task} onClose={()=>setPage('project')}/>:page==='icons'?<ProjectIconSettings repository={repo}/>:<PipelineJobs graph={graph} jobs={jobs} hasMore={false} onOpen={url=>window.opened=url}/>}
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
  await page.setContent(
    '<style>body{margin:0;background:#101014;color:#efeff2;font-family:system-ui}button{color:inherit;background:#26262d;border:1px solid #40404a;border-radius:8px;min-height:36px;padding:8px}input,select{display:block;max-width:100%}#app{width:100vw}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'Open in Zed', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((c) => c.path === '/api/scm/open-folder' && c.input.taskId === 'thread'),
  )
  await page.getByText('Watching · Dovo monitors these for updates', { exact: true }).waitFor()
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
  await page.getByRole('button', { name: 'Changes (0)', exact: true }).click()
  assert.equal(await page.evaluate(() => window.inlineChanged), true)
  await page.screenshot({ path: '/tmp/dovo-native-project-sticky.png' })
  await page.evaluate(() => {
    window.runtime.snapshot.workspace.repositories[0].kind = 'scratch'
    window.show('project')
  })
  await page.getByText('General', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Link projects', exact: true }).click()
  assert.equal(await page.evaluate(() => window.projectsLinked), true)
  assert.deepEqual(errors, [])
  console.log(
    'React Native project panel: editor, scripts, linked PRs, lifecycle overrides, PNG emoji picker, refresh, watchers and pipeline graph passed.',
  )
} finally {
  await browser.close()
}
