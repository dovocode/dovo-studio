import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const desktopControls = `
export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
export const ChoicePicker=({value,onValueChange,children,'aria-label':label})=><select aria-label={label} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;
export const cn=(...names)=>names.filter(Boolean).join(' ');
export const FormField=({children})=><div>{children}</div>;
export const Input=(props)=><input {...props}/>;
export const Textarea=(props)=><textarea {...props}/>;
export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=({children})=><div>{children}</div>;
export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;
export const MessageAction=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;`
const nativeControls = `
export const Platform={OS:'ios'};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
export const Keyboard={dismiss(){}};
export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':accessibilityRole}>{children}</span>;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SettingsChoice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const SettingsField=({label,value,onChangeText,multiline})=>multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const useTheme=()=>({styles:{},colors:{}});`
const icons = [
  'ArrowUpRight',
  'Check',
  'CalendarPlus',
  'Circle',
  'Clock3',
  'FlaskConical',
  'LoaderCircle',
  'OctagonX',
  'RotateCw',
  'X',
]
  .map((name) => 'export const ' + name + '=()=>null;')
  .join('')
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import{createRoot}from'react-dom/client';import{useState}from'react';import{Effect}from'effect';
import{decode,automationDryRunSchema,jobRunSchema}from'@dovo/protocol';
import{RunDetails}from'./packages/extension-jobs/src/run-details';import{RunProgress}from'./apps/mobile/src/jobs/run-progress';
import{useJobActions}from'./packages/extension-jobs/src/use-job-actions';
import{DryRunPanel as Desktop}from'./packages/extension-jobs/src/dry-run';import{DryRun as Mobile}from'./apps/mobile/src/jobs/dry-run';
import{SuggestRoutine as DeskSuggest}from'./packages/extension-tasks/src/chat/actions/suggest-routine';
import{SuggestRoutine as MobileSuggest}from'./apps/mobile/src/tasks/conversation/components/suggest-routine';
const node=(id,kind,label,extra={})=>({id,type:'automation',position:{x:0,y:0},data:{kind,label,trigger:'manual',schedule:'',timezone:'UTC',objective:'Summarise',agentId:'agent',repositoryId:'repo',...extra}});
const flow={id:'flow',name:'Release check',nodes:[node('trigger','trigger','Delivery',{trigger:'webhook'}),node('work','task','Work',{resultSchema:'{"type":"integer"}'}),node('approve','review','Approve'),node('ship','task','Ship')],edges:[{id:'a',source:'trigger',target:'work'},{id:'b',source:'work',target:'approve'},{id:'c',source:'approve',target:'ship'}],monitor:{url:'https://example.com/feed'}};
window.calls=[];
const run=decode(jobRunSchema,{id:'event-run',automationId:'flow',createdAt:'2026-11-23T10:00:00Z',status:'waiting',waitingNodeId:'approve',completedNodes:['trigger','work'],taskIds:[],mcpEvent:{name:'incident.created',server:'operations',eventId:'occurrence-1',timestamp:'2026-11-23T09:59:00Z'}});
const failed={...run,id:'failed-run',status:'completed',attempt:2,failures:[{attempt:1,failedAt:'2026-11-23T10:00:00Z'}]};
const waiting={...run,id:'ci-run',mcpEvent:undefined,pipelineWait:{url:'https://github.com/owner/repo/actions/runs/42/attempts/2',until:'2026-11-23T10:30:00Z'}};
const queued={...run,id:'pool-run',waitingNodeId:undefined,waitingForStepPool:'builders',mcpEvent:undefined};
const message={id:'owner-message',role:'user',source:{kind:'user'},text:'Summarize open PRs every Friday at 09:00'};
const snapshot={automationExplainSupported:true,routineSuggestionsSupported:true,workspace:{tasks:[{id:'bot',bot:{state:'active'}}],automations:[flow]},questions:[],approvals:[]};

window.result={outcome:'stopped',trigger:'webhook',generated:false,input:{payload:{ref:'main'}},issues:[],warnings:['Automatic triggers are paused. This trigger starts no runs until you enable it.'],steps:[
{nodeId:'trigger',label:'Delivery',kind:'trigger',status:'ran',inputs:[{name:'Trigger data',value:'{"ref": "main"}'}],output:"The trigger data is added to each task's instructions."},
{nodeId:'work',label:'Work',kind:'task',status:'simulated',inputs:[{name:'Instructions',value:'Summarise WITH-TRIGGER-DATA'}],output:'Simulated. No thread was created and no agent ran.'},
{nodeId:'approve',label:'Approve',kind:'review',status:'simulated',inputs:[{name:'Waits for',value:'A person to approve or reject the run'}],output:'Simulated rejection. The run stops here.'},
{nodeId:'ship',label:'Ship',kind:'task',status:'not-reached',inputs:[]}],
unexercised:['Failure of "Work".','Approval at "Approve".','"Ship" was not reached.']};
let scenarios=[];
const request=async(path,input)=>{window.calls.push({path,input});if(path.endsWith('/scenarios')){if(input.action==='save')scenarios=[...scenarios.filter(item=>item.id!==input.scenario.id),input.scenario];if(input.action==='delete')scenarios=scenarios.filter(item=>item.id!==input.expected.id);return scenarios}if(path.endsWith('/explain'))return {taskId:input.taskId};if(path.endsWith('/from-message'))return{id:input.id};return decode(automationDryRunSchema,{...window.result,input:{...window.result.input,stepResults:input.input?.stepResults}})};
const connection={address:'http://fixture',token:'device'};
function App(){
 const[mode,setMode]=useState('desktop');window.mode=setMode;
 const[paused,setPaused]=useState(false);
 const[online,setOnline]=useState(true);window.online=setOnline;
 const current={...snapshot,automationPauseSupported:mode.endsWith('controls')||undefined,automationDryRunScenariosSupported:mode.startsWith('scenario-')};
 const controlRequest=async (path,input)=>{
   if(!['/api/jobs/pause','/api/jobs/resume'].includes(path))return request(path,input);
   window.calls.push({path,input});
   setPaused(path.endsWith('/pause'));
   return {ok:true};
 };
 window.store={connected:online,activeRuntimeId:'a',connection,request:controlRequest,workspace:snapshot.workspace,snapshot:current,flush:async()=>{}};
 window.runtime={connected:online,profile:{id:'a',connection},snapshot:current,call:controlRequest,read:request,callEffect:(path,input)=>Effect.tryPromise(()=>controlRequest(path,input))};
 const actions=useJobActions();
 if(mode.startsWith('suggest-')){
   const Suggest=mode.endsWith('desktop')?DeskSuggest:MobileSuggest;
   return <Suggest taskId="bot" message={message}/>;
 }
 if(!mode.includes('scenario')&&mode.includes('-run')){
   const selected=mode.endsWith('controls')?{...queued,pause:paused?{phase:'paused',at:run.createdAt}:undefined}:mode.endsWith('failed')?failed:mode.endsWith('ci')?waiting:run;
   if(mode.startsWith('desktop'))return <RunDetails key={mode} flow={flow} runs={[selected]} run={selected} provenance={{}} actions={actions} selectRun={()=>{}} onStep={()=>{}}/>;
   return <RunProgress key={mode} run={selected}/>;
 }
 return <main key={mode}>{mode.endsWith('desktop')?<Desktop flow={flow}/>:<Mobile flow={flow} disabled={false}/>}</main>;
};
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate(target){window.navigated=target}});export const formatDateTime=String;export const clientScopeKey=()=>1;export {responses} from '@dovo/protocol';export {useDryRunScenarios} from '${root}packages/studio-core/src/use-dry-run-scenarios.ts';`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: 'export {useState as useApplicationState} from "react";',
    },
    {
      path: '../runtime/state/application-state',
      importer: mobile + 'jobs/',
      contents: 'export {useState as useApplicationState} from "react";',
    },
    {
      path: '../shell/navigation',
      importer: mobile + 'jobs/',
      contents:
        'export const useNavigation=()=>({focused:true,navigate(viewId,entityId,runtimeId){window.navigated={viewId,entityId,runtimeId}}});',
    },
    {
      path: '../ui/controls/icon',
      importer: mobile + 'jobs/',
      contents: 'export const Icon=()=>null;',
    },
    {
      path: '../ui/content/open-link',
      importer: mobile + 'jobs/',
      contents: 'export const openAppLink=async url=>{window.openedLink=url};',
    },
    ...[mobile + 'jobs/', root + 'packages/extension-jobs/src/'].flatMap((importer) =>
      [
        ['./restore-definition', 'RestoreDefinition'],
        ['./run-audit', 'RunAudit'],
        ['./routine-provenance', 'RunRoutineSource'],
      ].map(([path, name]) => ({
        path,
        importer,
        contents: 'export const ' + name + '=()=>null;',
      })),
    ),
    { path: '@dovo/studio-ui', contents: desktopControls },
    { path: 'lucide-react', contents: icons },
    { path: 'react-native', contents: nativeControls },
    {
      path: 'expo-router',
      contents: 'export const router={push(target){window.navigated=target}};',
    },
    {
      path: '../../../ui/layout/sheet',
      importer: mobile + 'tasks/conversation/components/',
      contents:
        'export const Sheet=({title,children})=><div role="dialog"><h2>{title}</h2>{children}</div>;',
    },
    ...[
      ['../../../ui/theme', ''],
      ['../../../ui/content/text', ''],
      ['../../../ui/controls/action', 'export {SettingsAction as Action};'],
      ['../../../ui/controls/field', 'export {SettingsField as Field};'],
    ].map(([path, exports]) => ({
      path,
      importer: mobile + 'tasks/conversation/components/',
      contents: nativeControls + exports,
    })),
    {
      path: '../../../runtime/connection/provider',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../../../ui/controls/use-action',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const useAction=()=>({act: work=>work(),busy:false,error:""});',
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'jobs/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    { path: '../screens/settings-controls', importer: mobile + 'jobs/', contents: nativeControls },
    { path: '../ui/content/text', importer: mobile + 'jobs/', contents: nativeControls },
    { path: '../ui/theme', importer: mobile + 'jobs/', contents: nativeControls },
    {
      path: '../ui/controls/use-action',
      importer: mobile + 'jobs/',
      contents: `import{useState}from'react';import{Effect}from'effect';export const useAction=()=>{const[state,setState]=useState({busy:false,error:''});return{...state,act:async work=>{setState({busy:true,error:''});try{const result=work();await(Effect.isEffect(result)?Effect.runPromise(result):result);setState({busy:false,error:''})}catch(error){setState({busy:false,error:error.message})}}}};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => {
      window.calls = []
      window.mode(mode)
    }, mode)
    if (mode === 'mobile') await page.getByRole('button', { name: 'Dry run', exact: true }).click()
    const payload = page.getByLabel('Sample trigger data (JSON)')
    // The generated sample is valid JSON for the trigger.
    assert.equal(JSON.parse(await payload.inputValue()).event, 'sample')
    await payload.fill('{')
    await page.getByRole('button', { name: 'Start dry run', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Enter the sample payload as JSON.' }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 0)

    await payload.fill('{"ref":"main"}')
    await page.getByLabel('Simulated outcome').selectOption('approve')
    await page.getByLabel('Source since the last successful run').selectOption('unchanged')
    assert.equal(
      await page.getByLabel('Sample source content').inputValue(),
      'Sample source content',
    )
    await page.getByRole('button', { name: 'Start dry run', exact: true }).click()
    await page.getByText('The run stopped at the simulated failure or rejection.').waitFor()
    const call = await page.evaluate(() => window.calls[0])
    assert.equal(call.path, '/api/jobs/dry-run')
    assert.deepEqual(call.input.input, {
      payload: { ref: 'main' },
      sourceText: 'Sample source content',
      sourceUnchanged: true,
    })
    assert.equal(call.input.stopAt, 'approve')
    assert.equal(call.input.flow.id, 'flow')

    await page.getByText('1 ran · 2 simulated · 1 not reached').waitFor()
    await page
      .getByText('Automatic triggers are paused. This trigger starts no runs until you enable it.')
      .waitFor()
    for (const text of ['Ran', 'Not reached'])
      await page.getByText(text, { exact: true }).first().waitFor()
    assert.equal(await page.getByText('Simulated', { exact: true }).count(), 2)
    await page.getByText('Simulated rejection. The run stops here.').waitFor()
    for (const text of ['Failure of "Work".', 'Approval at "Approve".', '"Ship" was not reached.'])
      await page.getByText(text, { exact: false }).waitFor()

    // Resolved inputs open per step.
    assert.equal(await page.getByText('Summarise WITH-TRIGGER-DATA').isVisible(), false)
    if (mode === 'desktop') await page.locator('li', { hasText: 'Work' }).locator('summary').click()
    else await page.getByRole('button', { name: 'Work · Simulated', exact: true }).click()
    await page.getByText('Summarise WITH-TRIGGER-DATA').waitFor()
  }
  await page.evaluate(() => window.mode('scenario-desktop'))
  await page.getByLabel('Sample step results (JSON)').fill('{"work":7}')
  await page.getByRole('button', { name: 'Start dry run', exact: true }).click()
  await page.getByLabel('Scenario name').fill('Reject a release')
  await page.getByRole('button', { name: 'Save as scenario', exact: true }).click()
  await page.getByRole('button', { name: 'Reject a release', exact: true }).waitFor()
  await page.evaluate(() => window.mode('scenario-mobile'))
  await page.getByRole('button', { name: 'Dry run', exact: true }).click()
  await page.getByRole('button', { name: 'Reject a release', exact: true }).click()
  assert.equal(await page.getByLabel('Sample step results (JSON)').inputValue(), '{"work":7}')
  await page.getByRole('button', { name: 'Run saved scenarios', exact: true }).click()
  await page.getByText('Passed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.result.outcome = 'filtered'
  })
  await page.getByRole('button', { name: 'Run saved scenarios', exact: true }).click()
  await page.getByText('Expected stopped, got filtered.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Delete scenario', exact: true }).click()
  await page
    .getByRole('button', { name: 'Reject a release', exact: true })
    .waitFor({ state: 'detached' })
  for (const mode of ['desktop-run', 'mobile-run']) {
    await page.setViewportSize(
      mode === 'desktop-run' ? { width: 1024, height: 720 } : { width: 390, height: 844 },
    )
    await page.evaluate((mode) => window.mode(mode), mode)
    await page.getByText('MCP event · incident.created · operations', { exact: true }).waitFor()
    const approve = mode === 'desktop-run' ? 'Approve & continue' : 'Approve review'
    await page.getByRole('button', { name: approve, exact: true }).waitFor()
    const pause = page.getByRole('button', { name: 'Pause run', exact: true })
    assert.equal(await pause.count(), 0)
    await page.evaluate((mode) => {
      window.calls = []
      window.mode(mode + '-controls')
    }, mode)
    const poolWait = page.getByText('Waiting for step pool · builders', { exact: true })
    await poolWait.waitFor()
    assert.equal(await page.getByRole('button', { name: approve, exact: true }).count(), 0)
    await pause.click()
    const resume = page.getByRole('button', { name: 'Resume run', exact: true })
    await resume.waitFor()
    await page.getByText('Paused', { exact: true }).waitFor()
    await page.evaluate(() => window.online(false))
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Resume run' && button.disabled,
      ),
    )
    await page.evaluate(() => window.online(true))
    await resume.click()
    await poolWait.waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls), [
      { path: '/api/jobs/pause', input: { id: 'pool-run' } },
      { path: '/api/jobs/resume', input: { id: 'pool-run' } },
    ])
    await page.evaluate((mode) => window.mode(mode + '-ci'), mode)
    await page
      .getByText(mode === 'desktop-run' ? 'Waiting for CI' : /^Waiting for CI until/)
      .filter({ visible: true })
      .first()
      .waitFor()
    assert.equal(await page.getByRole('button', { name: approve, exact: true }).count(), 0)
    await page.evaluate((mode) => {
      window.calls = []
      window.navigated = undefined
      window.mode(mode + '-failed')
    }, mode)
    await page.getByRole('button', { name: /^Explain attempt 1/ }).click()
    await page.waitForFunction(() => window.navigated?.entityId === window.calls[0]?.input.taskId)
    const [explanation] = await page.evaluate(() => window.calls)
    assert.equal(explanation.path, '/api/jobs/explain')
    assert.equal(explanation.input.id, 'failed-run')
    assert.equal(explanation.input.attempt, 1)
  }
  for (const surface of ['desktop', 'mobile']) {
    await page.evaluate((surface) => {
      window.calls = []
      window.navigated = undefined
      window.mode('suggest-' + surface)
    }, surface)
    await page.getByRole('button', { name: 'Suggest a routine', exact: true }).click()
    const routine = page.getByRole('dialog')
    assert.equal(await routine.getByLabel('Schedule (cron)').inputValue(), '0 9 * * 5')
    await routine.getByLabel('Name', { exact: true }).fill('Friday check')
    await routine.getByRole('button', { name: 'Save paused routine', exact: true }).click()
    await page.waitForFunction(() => !!window.navigated)
    const [saved] = await page.evaluate(() => window.calls)
    assert.equal(saved.path, '/api/jobs/from-message')
    assert.equal(saved.input.taskId, 'bot')
    assert.equal(saved.input.messageId, 'owner-message')
    assert.equal(saved.input.draft.name, 'Friday check')
  }
  assert.deepEqual(errors, [])
  console.log(
    'Automation dry run: web/mobile sample input, JSON validation, simulated outcome, step statuses, unexercised paths and resolved inputs pass. Runtime transport and native controls are fixtures.',
  )
} finally {
  await browser.close()
}
