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
export const Textarea=(props)=><textarea {...props}/>;`
const nativeControls = `
export const Platform={OS:'ios'};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
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
import{DryRunPanel as Desktop}from'./packages/extension-jobs/src/dry-run';import{DryRun as Mobile}from'./apps/mobile/src/jobs/dry-run';
const node=(id,kind,label,extra={})=>({id,type:'automation',position:{x:0,y:0},data:{kind,label,trigger:'manual',schedule:'',timezone:'UTC',objective:'Summarise',agentId:'agent',repositoryId:'repo',...extra}});
const flow={id:'flow',name:'Release check',nodes:[node('trigger','trigger','Delivery',{trigger:'webhook'}),node('work','task','Work'),node('approve','review','Approve'),node('ship','task','Ship')],edges:[{id:'a',source:'trigger',target:'work'},{id:'b',source:'work',target:'approve'},{id:'c',source:'approve',target:'ship'}],monitor:{url:'https://example.com/feed'}};
window.calls=[];
const run=decode(jobRunSchema,{id:'event-run',automationId:'flow',createdAt:'2026-11-23T10:00:00Z',status:'waiting',waitingNodeId:'approve',completedNodes:['trigger','work'],taskIds:[],mcpEvent:{name:'incident.created',server:'operations',eventId:'occurrence-1',timestamp:'2026-11-23T09:59:00Z'}});
const snapshot={workspace:{tasks:[]},questions:[],approvals:[]};

window.result={outcome:'stopped',trigger:'webhook',generated:false,input:{payload:{ref:'main'}},issues:[],warnings:['Automatic triggers are paused. This trigger starts no runs until you enable it.'],steps:[
{nodeId:'trigger',label:'Delivery',kind:'trigger',status:'ran',inputs:[{name:'Trigger data',value:'{"ref": "main"}'}],output:"The trigger data is added to each task's instructions."},
{nodeId:'work',label:'Work',kind:'task',status:'simulated',inputs:[{name:'Instructions',value:'Summarise WITH-TRIGGER-DATA'}],output:'Simulated. No thread was created and no agent ran.'},
{nodeId:'approve',label:'Approve',kind:'review',status:'simulated',inputs:[{name:'Waits for',value:'A person to approve or reject the run'}],output:'Simulated rejection. The run stops here.'},
{nodeId:'ship',label:'Ship',kind:'task',status:'not-reached',inputs:[]}],
unexercised:['Failure of "Work".','Approval at "Approve".','"Ship" was not reached.']};
const request=async(path,input)=>{window.calls.push({path,input});return decode(automationDryRunSchema,window.result)};
function App(){
 const[mode,setMode]=useState('desktop');window.mode=setMode;
 window.store={connected:true,connection:'a',request,workspace:snapshot.workspace,snapshot};
 window.runtime={connected:true,profile:{id:'a'},snapshot,callEffect:(path,input)=>Effect.tryPromise(()=>request(path,input))};
 if(mode==='desktop-run')return <RunDetails flow={flow} runs={[run]} run={run} provenance={{}} actions={{}} selectRun={()=>{}} onStep={()=>{}}/>;
 if(mode==='mobile-run')return <RunProgress run={run}/>;
 return <main key={mode}>{mode==='desktop'?<Desktop flow={flow}/>:<Mobile flow={flow} disabled={false}/>}</main>;
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
      contents:
        'export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate(){}});export const formatDateTime=String;',
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
      contents: 'export const useNavigation=()=>({focused:true,navigate(){}});',
    },
    {
      path: '../ui/controls/icon',
      importer: mobile + 'jobs/',
      contents: 'export const Icon=()=>null;',
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
      contents: `import{useState}from'react';export const useAction=()=>{const[state,setState]=useState({busy:false,error:''});return{...state,act:async work=>{setState({busy:true,error:''});try{await work();setState({busy:false,error:''})}catch(error){setState({busy:false,error:error.message})}}}};`,
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
  for (const mode of ['desktop-run', 'mobile-run']) {
    await page.setViewportSize(
      mode === 'desktop-run' ? { width: 1024, height: 720 } : { width: 390, height: 844 },
    )
    await page.evaluate((mode) => window.mode(mode), mode)
    await page.getByText('MCP event · incident.created · operations', { exact: true }).waitFor()
    const approve = mode === 'desktop-run' ? 'Approve & continue' : 'Approve review'
    await page.getByRole('button', { name: approve, exact: true }).waitFor()
  }
  assert.deepEqual(errors, [])
  console.log(
    'Automation dry run: web/mobile sample input, JSON validation, simulated outcome, step statuses, unexercised paths and resolved inputs pass. Runtime transport and native controls are fixtures.',
  )
} finally {
  await browser.close()
}
