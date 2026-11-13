import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
import {useImperativeHandle} from 'react';
export const Platform={OS:'web'};export const StyleSheet={flatten:style=>style};export const useWindowDimensions=()=>({fontScale:1,width:390,height:844});export const Alert={alert(){}};
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
import {Effect} from 'effect';import {decode,snapshotSchema,taskSchema,threadActionSendSchema} from '@dovo/protocol';import {ThreadActionCards,mobileThreadActions} from './apps/mobile/src/tasks/conversation/components/thread-actions';
const snapshot=decode(snapshotSchema,{revision:1,owner:false,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],threadActionsSupported:true,permissionPolicySupported:true,workspace:{version:1,runtimeAddress:'',repositories:[{id:'source-project',name:'Source project',path:'/project',branch:'main'},{id:'target-project',name:'Target project',path:'/target',branch:'main'}],agents:[],tasks:[],automations:[]}});
window.sends=[];window.fail=true;window.hold=true;window.routes=[];
const stamp='2026-11-12T00:00:00Z';const source=decode(taskSchema,{id:'source-bot',title:'Source Bot',repositoryId:'source-project',agentId:'',status:'draft',createdAt:stamp,messages:[],files:[],draft:'',example:false,harness:{provider:'codex',model:'',permission:'read-only',instructions:'',endpoint:''},bot:{role:'Reviewer',responsibilities:'Review',state:'active',revision:'11111111-1111-4111-8111-111111111111',createdAt:stamp,updatedAt:stamp,resources:{mcpServers:[],skills:[{name:'private-bot-skill',description:'Only Bot',content:'private',enabled:true}]}},threadActions:[{id:'action-1',key:'followup',title:'Suggested followup',prompt:'Agent suggested prompt',runId:'run-1',state:'prepared',createdAt:stamp,updatedAt:stamp}]});
window.placement=()=>{const task={...source,messages:[{id:'first',turnId:'run-1'},{id:'last',turnId:'run-1'},{id:'later',turnId:'run-2'}]};return [mobileThreadActions(task,'first').length,mobileThreadActions(task,'last').length,mobileThreadActions(task).length,mobileThreadActions(source).length]};
window.runtime={profile:{id:'owner-a',connection:{address:'http://source.lan',token:'test-token'}},connected:true,snapshot,callEffect:(path,input,schema)=>Effect.tryPromise({try:async()=>{
  if(path==='/api/thread-actions/send'){
    decode(threadActionSendSchema,input);window.sends.push(input);
    if(window.hold)await new Promise(resolve=>window.release=resolve);
    if(window.fail)throw Error('Temporary runtime outage');
    return decode(schema,{action:{...source.threadActions[0],state:'sent',updatedAt:'2026-11-12T00:01:00Z',sent:{taskId:input.createTask.id,messageId:input.messageId,sentAt:stamp}},revision:2,runtimeInstanceId:'runtime-a'});
  }
  if(path==='/api/thread-actions/dismiss')return decode(schema,{action:{...source.threadActions[0],state:'dismissed'},revision:2,runtimeInstanceId:'runtime-a'});
  throw Error(path);
},catch:error=>error})};
function App(){const[task,setTask]=useState(source);window.setActionState=state=>setTask({...source,threadActions:[{...source.threadActions[0],state}]});const[show,setShow]=useState(true);window.remount=()=>{flushSync(()=>setShow(false));setTimeout(()=>setShow(true),0)};return show?<ThreadActionCards task={task}/>:null};
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
      path: '../../../ui/controls/choice',
      importer: mobile + 'tasks/conversation/',
      contents: controls,
    },
    // Automation cards share this module; this fixture covers new-thread cards only.
    {
      path: '../../../ui/layout/sheet',
      importer: mobile + 'tasks/conversation/',
      contents: controls,
    },
    {
      path: '../../../shell/source-route',
      importer: mobile + 'tasks/conversation/',
      contents: 'export const automationHref=()=>null;',
    },
    { path: 'expo-router', contents: 'export const router={push(){}};' },
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.deepEqual(await page.evaluate(() => window.placement()), [0, 1, 0, 1])
  assert.equal(await page.getByText('Suggested followup', { exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => window.sends.length), 0)
  await page.getByRole('button', { name: 'Review new thread', exact: true }).click()
  await page.getByLabel('Prompt', { exact: true }).fill('Human edited prompt')
  await page.evaluate(() => window.setActionState('dismissed'))
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.sends.length), 0)
  await page.evaluate(() => window.setActionState('prepared'))
  await page.getByRole('button', { name: 'Review new thread', exact: true }).click()
  assert.equal(await page.getByLabel('Prompt', { exact: true }).inputValue(), 'Human edited prompt')
  await page.getByRole('button', { name: 'Choose Claude', exact: true }).click()
  await page.getByLabel('Model', { exact: true }).fill('human-chosen-model')
  await page.getByRole('button', { name: 'Use Target project', exact: true }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  await page.waitForFunction(() => window.sends.length === 1)
  await page.evaluate(() => {
    window.hold = false
    window.release()
  })
  await page.getByText('Temporary runtime outage', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    window.fail = false
    window.runtime.snapshot.defaults = { taskDefaults: { execution: 'worktree' } }
    window.remount()
  })
  await page.getByRole('button', { name: 'Review new thread', exact: true }).click()
  assert.equal(await page.getByLabel('Prompt', { exact: true }).inputValue(), 'Human edited prompt')
  await page.getByRole('button', { name: 'Retry Send', exact: true }).click()
  await page.getByText('Sent', { exact: true }).waitFor()
  const sends = await page.evaluate(() => window.sends)
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0], sends[1])
  assert.equal(sends[0].sourceTaskId, 'source-bot')
  assert.equal(sends[0].createTask.repositoryId, 'target-project')
  assert.equal(sends[0].createTask.bot, undefined)
  assert.equal(sends[0].createTask.threadActions, undefined)
  assert.equal(sends[0].createTask.harness.provider, 'claude')
  assert.equal(sends[0].createTask.harness.model, 'human-chosen-model')
  await page.getByRole('button', { name: 'Open sent thread', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), [
    'tasks',
    sends[0].createTask.id,
    'owner-a',
  ])
  await page.evaluate(() => window.remount())
  await page.getByRole('button', { name: 'Dismiss thread action', exact: true }).click()
  await page
    .getByRole('button', { name: 'Review new thread', exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.sends.length), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile native thread action cards: no work on load, editable harness/model/prompt, duplicate taps, exact full request retries, owner/project routing and sent link pass.',
  )
} finally {
  await browser.close()
}
