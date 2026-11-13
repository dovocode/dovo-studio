import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
import {useImperativeHandle} from 'react';
export const Platform={OS:'web'};export const StyleSheet={flatten:style=>style};export const useWindowDimensions=()=>({fontScale:1,width:390,height:844});export const Alert={alert(){}};export const Keyboard={dismiss(){}};export const ScrollView=({children})=><div>{children}</div>;
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const TextInput=({ref,accessibilityLabel,value,onChangeText,editable,multiline})=>{useImperativeHandle(ref,()=>({focus(){}}));const props={'aria-label':accessibilityLabel,value,disabled:editable===false,onChange:event=>onChangeText(event.target.value)};return multiline?<textarea {...props}/>:<input {...props}/>};
export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
`
const controls = `
export const Sheet=({title,children,footer,onClose})=><section role="dialog" aria-label={title}>{children}{footer}<button onClick={onClose}>Close sheet</button></section>;
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const useTheme=()=>({styles:{},colors:{}});export const useSheetNavigation=()=>navigate=>navigate();export const Icon=()=>null;export const HarnessIcon=()=>null;export const IconButton=()=>null;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';import {RegistryProvider} from '@effect/atom-react';
import {Effect} from 'effect';import {decode,snapshotSchema,taskSchema,threadActionSchema,RuntimeRequestError,automationActionSendSchema,threadActionReviewSchema} from '@dovo/protocol';
import {ThreadActionCards} from './apps/mobile/src/tasks/conversation/components/thread-actions';
const stamp='2026-11-12T00:00:00Z';
const node=(id,kind,label,data={})=>({id,type:'automation',position:{x:0,y:0},data:{kind,label,trigger:'manual',schedule:'',timezone:'UTC',objective:'',agentId:'agent-1',repositoryId:'source-project',harness:{provider:'codex',env:{API_TOKEN:'SECRET-HARNESS-VALUE'}},...data}});
const workflow=(objective,enabled=true)=>({id:'nightly',name:'Nightly review',enabled,nodes:[node('start','trigger','Start',{trigger:'github',github:{host:'github.com',repository:'acme/app',event:'pull_request.opened',label:'',actor:'',requireWriteAccess:true}}),node('triage','task','Triage issues',{objective,botId:'bot-1',execution:'worktree'}),node('fix','task','Fix failures',{objective:'Fix the checks.',agentId:'',harness:undefined})],edges:[{id:'e1',source:'start',target:'triage'}]});
const resources=[{nodeId:'triage',label:'Triage issues',botId:'bot-1',botName:'Release Bot',execution:'main',repositoryId:'source-project',repositoryName:'Source project',projects:[{id:'source-project',name:'Source project',path:'/project'}],agent:{provider:'claude',model:'claude-opus-5-5',permission:'read-only'}},{nodeId:'fix',label:'Fix failures',repositoryId:'source-project',repositoryName:'Source project',projects:[],agent:{provider:'codex',model:'explicit-node-model',permission:'workspace-write',approvalPolicy:'on-request',sandboxMode:'workspace-write'}}];
const automation=(revision,objective,enabled)=>({automationId:'nightly',revision,workflow:workflow(objective,enabled),resources});
const action=(id,extra={})=>decode(threadActionSchema,{id,key:id,title:'Run nightly '+id,prompt:'Agent context '+id,runId:'run-1',state:'prepared',createdAt:stamp,updatedAt:stamp,automation:automation('rev-1','Triage open issues.'),...extra});
const snapshot=decode(snapshotSchema,{revision:1,owner:false,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],threadActionsSupported:true,permissionPolicySupported:true,workspace:{version:1,runtimeAddress:'',repositories:[{id:'source-project',name:'Source project',path:'/project',branch:'main'}],agents:[],tasks:[],automations:[]}});
const source=decode(taskSchema,{id:'source-thread',title:'Source',repositoryId:'source-project',agentId:'',status:'draft',createdAt:stamp,messages:[],files:[],draft:'',example:false,harness:{provider:'codex',model:'',permission:'read-only',instructions:'',endpoint:''},threadActions:[action('first'),action('second'),action('paused',{automation:automation('rev-p','Paused.',false)}),action('legacy',{automation:undefined,title:'Legacy new thread'})]});
window.setSelection=mode=>{source.threadActions=source.threadActions.map(action=>action.id==='first'?decode(threadActionSchema,{...action,automation:{...action.automation,resources:action.automation.resources.map(resource=>resource.nodeId==='fix'?{...resource,agent:{...resource.agent,modelSelection:mode}}:resource)}}):action);window.rerender()};window.reviewed=source.threadActions;window.calls=[];window.routes=[];window.mode={};window.releases=[];
const reply=(base,extra)=>({action:{...base,...extra},revision:2,runtimeInstanceId:'runtime-a'});
const runtimeFor=(id)=>({profile:{id,connection:{address:'http://'+id+'.lan',token:'token-'+id}},connected:true,snapshot,callEffect:(path,input,schema)=>Effect.tryPromise({try:async()=>{
  window.calls.push({runtime:id,path,input:JSON.parse(JSON.stringify(input))});
  const base=source.threadActions.find(item=>item.id===input.actionId);
  if(path==='/api/thread-actions/review'){decode(threadActionReviewSchema,input);return decode(schema,reply(base,{automation:automation('rev-2','Triage and label issues.'),updatedAt:'2026-11-12T00:02:00Z'}))}
  if(path==='/api/thread-actions/dismiss')return decode(schema,reply(base,{state:'dismissed'}));
  if(path!=='/api/thread-actions/send')throw Error(path);
  decode(automationActionSendSchema,input);
  if(window.mode.hold)await new Promise(resolve=>window.releases.push(resolve));
  if(window.mode.lost){window.mode.lost=false;throw new RuntimeRequestError({kind:'connection',message:'Start reply lost'})}
  if(window.mode.stale){window.mode.stale=false;throw new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'The automation changed. Review it again.'})}
  return decode(schema,reply(base,{state:'sent',updatedAt:'2026-11-12T00:03:00Z',automationSent:{runId:'job-'+input.actionId,sentAt:stamp}}));
},catch:error=>error})});
window.runtime=runtimeFor('owner-a');
function App(){const[only,setOnly]=useState('first');const[,render]=useState(0);window.only=setOnly;window.rerender=()=>render(value=>value+1);
const[show,setShow]=useState(true);window.remount=()=>{flushSync(()=>setShow(false));setTimeout(()=>setShow(true),0)};
return show?<ThreadActionCards task={{...source,threadActions:source.threadActions.filter(item=>item.id===only)}}/>:null};
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
      '@effect/atom-react': root + 'apps/mobile/node_modules/@effect/atom-react/dist/index.js',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: native },
    {
      path: 'expo-crypto',
      contents:
        'let id=0;export const randomUUID=()=>`00000000-0000-4000-8000-${String(++id).padStart(12,"0")}`;',
    },
    {
      path: '../../../runtime/connection/provider',
      importer: mobile + 'tasks/conversation/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../../../shell/navigation',
      importer: mobile + 'tasks/conversation/',
      contents: 'export const useNavigation=()=>({navigate:(...args)=>window.routes.push(args)});',
    },
    { path: '../../../ui/theme', importer: mobile + 'tasks/conversation/', contents: controls },
    {
      path: '../../../ui/layout/sheet',
      importer: mobile + 'tasks/conversation/',
      contents: controls,
    },
    { path: 'expo-router', contents: 'export const router={push:href=>window.routes.push(href)};' },
    { path: './icon-button', importer: mobile + 'ui/controls/', contents: controls },
    { path: './icon', importer: mobile + 'ui/controls/', contents: controls },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    ...['../layout/sheet', '../theme'].map((path) => ({
      path,
      importer: mobile + 'ui/',
      contents: controls,
    })),
    ...[
      '../../ui/layout/sheet',
      '../../ui/theme',
      '../../ui/controls/choice',
      '../../ui/controls/icon',
      '../../agents/harness-icon',
    ].map((path) => ({ path, importer: mobile + 'tasks/creation/', contents: controls })),
    {
      path: '../../agents/use-harness-availability',
      importer: mobile + 'tasks/creation/',
      contents:
        'export const useHarnessAvailability=()=>({available:new Set(["harness:codex","harness:claude"]),loading:false});',
    },
    {
      path: '../../agents/harness-model-picker',
      importer: mobile + 'tasks/creation/',
      contents: `import {defaultTaskHarness} from '@dovo/protocol';export const HarnessModelPicker=({agent,onChange,disabled,options})=><div><button disabled={disabled} onClick={()=>onChange('harness:claude',{...defaultTaskHarness('claude'),id:'claude',name:'Claude'})}>Choose Claude</button><input aria-label="Model" disabled={disabled} value={agent.model} onChange={event=>onChange('harness:'+agent.provider,{...agent,model:event.target.value})}/>{options}</div>;`,
    },
    {
      path: '../../agents/model-settings',
      importer: mobile + 'tasks/creation/',
      contents: 'export const ModelSettings=()=>null;',
    },
    { path: '../ui/theme', importer: mobile + 'agents/', contents: controls },
    {
      path: '../screens/settings-controls',
      importer: mobile + 'agents/',
      contents: controls.replaceAll('Choice', 'SettingsChoice'),
    },
  ],
)
const enabled = (page, name) =>
  page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('button')].some(
        (item) => (item.getAttribute('aria-label') ?? item.textContent) === name && !item.disabled,
      ),
    name,
  )
// The exact-run route: the real AutomationRouteScreen and source-route with native shells mocked.
const routeBuilt = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {AutomationRouteScreen} from './apps/mobile/src/jobs/automation-route-screen';
import {automationHref} from './apps/mobile/src/shell/source-route';
const run=(id,automationId,createdAt)=>({id,automationId,status:'completed',completedNodes:[],taskIds:[],createdAt});
const flow={id:'nightly',name:'Nightly review',nodes:[],edges:[]};
window.state={snapshot:{runs:[run('job-first','nightly','2026-11-12T00:03:00Z'),run('job-later','nightly','2026-11-13T00:00:00Z'),run('job-other','other-flow','2026-11-13T00:00:00Z')],workspace:{automations:[flow]}}};
function App(){const[href,setHref]=useState(null);window.open=(...args)=>setHref({...automationHref(...args),at:Date.now()});window.setFlows=flows=>{window.state.snapshot={...window.state.snapshot,workspace:{automations:flows}};setHref(value=>({...value,at:Date.now()}))};
window.params=href?.params;return href?<AutomationRouteScreen key={href.at}/>:null}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: native },
    {
      path: 'expo-router',
      contents: 'export const router={};export const useLocalSearchParams=()=>window.params;',
    },
    {
      path: '@dovo/protocol',
      contents: 'export const runtimeComputerName=({profile})=>profile.id;',
    },
    {
      path: '../runtime/state/application-state',
      importer: mobile + 'jobs/',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'jobs/',
      contents:
        "export const useRuntime=()=>({snapshot:window.state.snapshot,profile:{id:'owner-a'}});",
    },
    {
      path: '../shell/runtime-route',
      importer: mobile + 'jobs/',
      contents:
        'export const RuntimeRoute=({runtimeId,children})=><div data-runtime={runtimeId}>{children}</div>;',
    },
    {
      path: '../ui/controls/icon-button',
      importer: mobile + 'jobs/',
      contents: 'export const IconButton=()=>null;',
    },
    {
      path: '../ui/layout/screen-header',
      importer: mobile + 'jobs/',
      contents: 'export const ScreenHeader=({title})=><h1>{title}</h1>;',
    },
    {
      path: '../ui/content/text',
      importer: mobile + 'jobs/',
      contents: 'export const Text=({children})=><span>{children}</span>;',
    },
    {
      path: '../screens/settings-theme',
      importer: mobile + 'jobs/',
      contents:
        'export const useSettingsTheme=()=>({styles:{}});export const SettingsPage=({children})=><main>{children}</main>;',
    },
    {
      path: './automation-card',
      importer: mobile + 'jobs/',
      contents: 'export const AutomationCard=({flow})=><p>Automation card {flow.id}</p>;',
    },
    {
      path: './automation-editor',
      importer: mobile + 'jobs/',
      contents: 'export const AutomationEditor=()=>null;',
    },
    {
      path: './run-progress',
      importer: mobile + 'jobs/',
      contents: 'export const RunProgress=({run})=><p data-run={run.id}>Run {run.id}</p>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const calls = () => page.evaluate(() => window.calls)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const context = page.getByLabel('Run context', { exact: true })
  const sheet = page.getByRole('dialog')

  // Review shows the saved workflow and its effective resources. It starts no work.
  await page.getByText('Automation · Nightly review', { exact: true }).waitFor()
  await button('Review automation').click()
  assert.deepEqual(await calls(), [])
  for (const text of [
    'GitHub Pull request · Opened on github.com/acme/app · write access required',
    'Triage open issues.',
    'Release Bot',
    'claude · claude-opus-5-5',
    'read-only',
    'Source project · /project',
    'Start → Triage issues',
    'Message to Bot',
    'Main checkout',
  ])
    await sheet.getByText(text, { exact: true }).waitFor()
  // Saved node harness, agent and checkout fields never reach the review.
  assert.equal(await page.getByText('SECRET-HARNESS-VALUE').count(), 0)
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.reviewed).includes('SECRET-HARNESS-VALUE')),
    false,
  )
  // Bot steps show the Bot's effective execution, not the dormant saved node setting.
  assert.equal(await sheet.getByText('New worktree', { exact: true }).count(), 0)
  await sheet.getByText(/Bot’s own current settings and resources/).waitFor()

  // A normal step with a pending default shows the mode. Access and existing Bot models stay visible.
  for (const [mode, label] of [
    ['auto', 'Tune · Model chosen at start'],
    ['smart', 'Maestro · Model chosen at start'],
    ['inherit', 'Inherit · Project model applied at start'],
  ]) {
    await page.evaluate((mode) => window.setSelection(mode), mode)
    await sheet.getByText(label, { exact: true }).waitFor()
    assert.equal(await sheet.getByText('codex · explicit-node-model', { exact: true }).count(), 0)
    await sheet
      .getByText('workspace-write · approval on-request · sandbox workspace-write', { exact: true })
      .waitFor()
    await sheet.getByText('claude · claude-opus-5-5', { exact: true }).waitFor()
  }
  await page.evaluate(() => window.setSelection(undefined))
  await sheet.getByText('codex · explicit-node-model', { exact: true }).waitFor()

  // Run-only context survives close and remount.
  await context.fill('Human mobile context')
  await button('Close sheet').click()
  await page.evaluate(() => window.remount())
  await button('Review automation').click()
  assert.equal(await context.inputValue(), 'Human mobile context')

  // An uncertain reply freezes the exact payload. Retry sends the same body.
  await page.evaluate(() => (window.mode.lost = true))
  await button('Start automation').evaluate((element) => {
    element.click()
    element.click()
  })
  await sheet.getByText('Start reply lost', { exact: true }).waitFor()
  assert.equal((await calls()).length, 1, 'Double tap sends once')
  assert.equal(await context.isDisabled(), true)
  await button('Close sheet').click()
  await page.evaluate(() => window.remount())
  await button('Review automation').click()
  assert.equal(await context.isDisabled(), true, 'Frozen payload survives remount')
  await button('Retry Start').click()
  await button('Open automation run').waitFor()
  let sends = (await calls()).filter((call) => call.path.endsWith('/send'))
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0].input, sends[1].input)
  assert.deepEqual(sends[0].input, {
    sourceTaskId: 'source-thread',
    actionId: 'first',
    revision: 'rev-1',
    text: 'Human mobile context',
  })
  await button('Open automation run').click()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
    pathname: '/settings/automations/[runtimeId]/[automationId]',
    params: { runtimeId: 'owner-a', automationId: 'nightly', runId: 'job-first' },
  })

  // A definite stale rejection keeps the context and requires a review refresh.
  await page.evaluate(() => window.only('second'))
  await button('Review automation').click()
  await context.fill('Second mobile context')
  await page.evaluate(() => (window.mode.stale = true))
  await button('Start automation').click()
  await sheet.getByText('The automation changed. Review it again.', { exact: true }).waitFor()
  assert.equal(await context.isDisabled(), false)
  assert.equal(await context.inputValue(), 'Second mobile context')
  assert.equal(await button('Start automation').isDisabled(), true)
  await button('Refresh review').click()
  await sheet.getByText('Triage and label issues.', { exact: true }).waitFor()
  assert.equal(await context.inputValue(), 'Second mobile context')
  await button('Start automation').click()
  await button('Open automation run').waitFor()
  sends = (await calls()).filter(
    (call) => call.input.actionId === 'second' && call.path.endsWith('/send'),
  )
  assert.deepEqual(
    sends.map((call) => call.input.revision),
    ['rev-1', 'rev-2'],
  )

  // A paused automation shows its state and cannot start.
  await page.evaluate(() => window.only('paused'))
  await button('Review automation').click()
  await sheet
    .getByText('This automation is paused. Resume it in Automations, then refresh the review.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await button('Start automation').isDisabled(), true)
  await button('Close sheet').click()
  await button('Dismiss automation action').click()
  await button('Review automation').waitFor({ state: 'detached' })

  // A late reply after a pairing switch leaves the other pairing's card and draft alone.
  await page.evaluate(() => {
    window.calls = []
    window.only('first')
    window.runtime = {
      ...window.runtime,
      profile: { id: 'owner-b', connection: { address: 'http://owner-b.lan', token: 'token-b' } },
    }
    window.rerender()
  })
  await button('Review automation').click()
  assert.equal(await context.inputValue(), 'Agent context first', 'Drafts stay per pairing')
  await context.fill('Owner B context')
  await page.evaluate(() => (window.mode.hold = true))
  await button('Start automation').click()
  await page.waitForFunction(() => window.releases.length === 1)
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      profile: { id: 'owner-c', connection: { address: 'http://owner-c.lan', token: 'token-c' } },
    }
    window.rerender()
  })
  // The pending owner B start does not lock owner C.
  await enabled(page, 'Review automation')
  await button('Review automation').click()
  await context.fill('Owner C draft')
  await button('Start automation').click()
  await page.waitForFunction(() => window.releases.length === 2)
  await page.evaluate(() => {
    window.mode.hold = false
    window.releases[0]()
  })
  await page.waitForTimeout(100)
  assert.equal(await context.inputValue(), 'Owner C draft', 'Late reply keeps the newer draft')
  assert.equal(await button('Open automation run').count(), 0)
  await page.evaluate(() => window.releases[1]())
  await button('Open automation run').click()
  assert.deepEqual((await page.evaluate(() => window.routes.at(-1))).params, {
    runtimeId: 'owner-c',
    automationId: 'nightly',
    runId: 'job-first',
  })
  assert.deepEqual(
    (await calls()).map((call) => call.input.text),
    ['Owner B context', 'Owner C draft'],
  )
  // A new pairing starts clean after both replies.
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      profile: { id: 'owner-d', connection: { address: 'http://owner-d.lan', token: 'token-d' } },
    }
    window.rerender()
  })
  await enabled(page, 'Review automation')
  await button('Review automation').click()
  assert.equal(await context.inputValue(), 'Agent context first')
  assert.equal(await button('Start automation').isDisabled(), false)

  // Cards without an automation snapshot keep the editable new-thread flow.
  await button('Close sheet').click()
  await page.evaluate(() => window.only('legacy'))
  await button('Review new thread').click()
  assert.equal(
    await page.getByLabel('Prompt', { exact: true }).inputValue(),
    'Agent context legacy',
  )
  // The exact-run route never falls back to the latest run.
  const routePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  routePage.on('pageerror', (error) => errors.push(error.message))
  await routePage.setContent('<div id="app"></div>')
  await routePage.addScriptTag({ content: routeBuilt.outputFiles[0].text })
  const runs = () =>
    routePage.locator('[data-run]').evaluateAll((items) => items.map((item) => item.dataset.run))
  await routePage.evaluate(() => window.open('owner-a', 'nightly', 'job-first'))
  await routePage.getByText('Requested run', { exact: true }).waitFor()
  assert.deepEqual(await runs(), ['job-first'], 'A later run does not replace the requested run')
  await routePage.getByText('Automation card nightly', { exact: true }).waitFor()
  assert.equal(await routePage.locator('[data-runtime="owner-a"]').count(), 1)
  await routePage.evaluate(() => window.open('owner-a', 'nightly', 'job-other'))
  await routePage.getByText(/not in the recent run history/).waitFor()
  assert.deepEqual(await runs(), [], 'A run of another automation is not shown')
  await routePage.evaluate(() => window.open('owner-a', 'nightly', 'job-evicted'))
  await routePage.getByText(/not in the recent run history/).waitFor()
  assert.deepEqual(await runs(), [], 'An evicted run never falls back to the latest run')
  await routePage.evaluate(() => {
    window.open('owner-a', 'nightly', 'job-first')
    window.setFlows([])
  })
  await routePage.getByText('Automation run', { exact: true }).waitFor()
  await routePage.getByText(/may have been removed/).waitFor()
  assert.deepEqual(await runs(), ['job-first'], 'A retained run stays visible after flow deletion')
  await routePage.evaluate(() => window.open('owner-a', 'nightly'))
  await routePage.getByText('Automation unavailable', { exact: true }).waitFor()
  assert.equal(await routePage.getByText('Requested run', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile automation action cards: no work on review, exact workflow/agents/projects/access, run-only context drafts, frozen retry, stale refresh with retained context, late-reply isolation, exact-run routing (later run, other flow, evicted run, deleted flow), paused gate and legacy new-thread routing pass. Transport and native primitives are fixtures.',
  )
} finally {
  await browser.close()
}
