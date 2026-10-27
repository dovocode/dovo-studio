import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/screens/jobs.tsx'
const controls = `
export const View=({children})=><div>{children}</div>;
export const Keyboard={dismiss:()=>{}};
export const FlatList=({data,renderItem,ListHeaderComponent,ListEmptyComponent,refreshing,onRefresh})=><section aria-busy={refreshing}>{ListHeaderComponent}<button onClick={onRefresh}>Refresh</button>{data.map((item,index)=><div key={item.key}>{renderItem({item,index})}</div>)}{!data.length&&ListEmptyComponent}</section>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const SettingsPage=View;
export const useSettingsTheme=()=>({styles:{},colors:{}});
export const SettingsSearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const ScreenHeader=({title})=><h1>{title}</h1>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Icon=()=>null;
export const AutomationRow=({flow})=><span>{flow.name}</span>;
export const AutomationEditor=()=>null;
export const CreationTarget=()=>null;
`
const mocks = [
  {
    path: '../runtime/connection/provider',
    importer,
    contents: 'export const useRuntime=()=>window.runtime;',
  },
  {
    path: '../runtime/state/application-state',
    importer,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../shell/navigation',
    importer,
    contents: 'export const useNavigation=()=>({focused:true});',
  },
  {
    path: '../ui/layout/use-list-scroll',
    importer,
    contents: 'export const useListScroll=()=>({retainPosition:()=>{}});',
  },
  { path: 'expo-router', contents: 'export const router={push:()=>{}};' },
  ...[
    'react-native',
    '../ui/content/text',
    './settings-theme',
    './settings-controls',
    '../ui/layout/screen-header',
    '../ui/controls/action',
    '../ui/controls/icon',
    '../jobs/automation-row',
    '../jobs/automation-editor',
    '../runtime/connection/creation-target',
  ].map((path) => ({ path, ...(path === 'react-native' ? {} : { importer }), contents: controls })),
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';
import JobsScreen from './apps/mobile/src/screens/jobs';
const source={profile:{id:'owner',name:'Mac Studio',nameIsCustom:true,connection:{address:'http://mac-studio.lan:8787',token:'token'}},connected:true,error:'',snapshot:{workspace:{automations:[{id:'job',name:'Saved automation'}]}}};
window.mode='reject';window.calls=0;
function App(){const[overviews,setOverviews]=useState([source]);window.publish=entries=>flushSync(()=>setOverviews(entries));window.source=source;window.runtime={overviews,refreshAll:async()=>{window.calls++;if(window.mode==='reject')throw Error('Connection interrupted');setOverviews([{...source,error:window.mode==='stored'?'Mac Studio refresh failed':''}])}};return <JobsScreen/>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  mocks,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Connection interrupted' }).waitFor()
  assert.equal(await page.locator('section').getAttribute('aria-busy'), 'false')
  assert.equal(await page.getByText('Saved automation', { exact: true }).count(), 1)
  await page.evaluate(() => (window.mode = 'stored'))
  await page.getByRole('button', { name: 'Retry loading automations', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Mac Studio refresh failed' }).waitFor()
  assert.equal(await page.getByText('Saved automation', { exact: true }).count(), 1)
  await page.evaluate(() => (window.mode = 'success'))
  await page.getByRole('button', { name: 'Retry loading automations', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.calls), 3)
  await page.evaluate(() =>
    window.publish([{ ...window.source, connected: false, snapshot: null }]),
  )
  await page.getByText('Connect a computer', { exact: true }).waitFor()
  assert.equal(await page.getByText('Create an automation', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile automations retain cached results, show rejected and stored refresh failures, retry cleanly and explain offline empty state.',
  )
} finally {
  await browser.close()
}

// Exercise the production editors' schedule fields and the mobile compare-and-set save payload.
const editorImporter = root + 'apps/mobile/src/jobs/automation-editor.tsx'
const inspectorImporter = root + 'packages/extension-jobs/src/node-inspector.tsx'
const editorControls = `
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;
export const StyleSheet={create:styles=>styles};
export const SettingsSheet=({children})=><section>{children}</section>;
export const SettingsField=({label,value,onChangeText,editable,placeholder})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} placeholder={placeholder} onChange={e=>onChangeText(e.target.value)}/></label>;
export const SettingsChoice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>;
export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Icon=()=>null;export const IconButton=()=>null;export const StepFields=()=>null;
export const useSettingsTheme=()=>({styles:{},colors:{}});
`
const editorBundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {Effect} from 'effect';import {defaultTaskHarness} from './packages/protocol/src/index';
import {AutomationEditor} from './apps/mobile/src/jobs/automation-editor';
import {NodeInspector} from './packages/extension-jobs/src/node-inspector';
const data={kind:'trigger',label:'Reminder',trigger:'manual',schedule:'0 9 * * *',timezone:'Europe/Amsterdam',objective:'Remind me to check the deployment',agentId:'',repositoryId:'repo'};
const trigger={id:'trigger',type:'automation',position:{x:0,y:0},data};
const task={...trigger,id:'task',data:{...data,kind:'task',harness:defaultTaskHarness('codex')}};
const flow={id:'reminder',name:'Deployment reminder',enabled:false,nodes:[trigger,task],edges:[{id:'edge',source:'trigger',target:'task'}]};
const workspace={agents:[],repositories:[{id:'repo',name:'App',path:'/app',branch:'main'}]};
window.runtime={connected:true,snapshot:{workspace},callEffect:(path,body)=>Effect.sync(()=>{window.saved={path,body};return {revision:1}})};
function App(){const[node,setNode]=useState(trigger);return <><div data-testid="desktop-editor"><NodeInspector node={node} workspace={workspace} onChange={data=>{window.desktopData=data;setNode({...node,data})}} onDelete={()=>{}}/></div><div data-testid="mobile-editor"><AutomationEditor flow={flow} onClose={()=>{window.editorClosed=true}}/></div></>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '@dovo/studio-ui',
      importer: inspectorImporter,
      contents: `
export const FormField=({label,children})=><label>{label}{children}</label>;
export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;
export const HarnessFields=()=>null;export const LinkedCheckoutEditor=()=>null;`,
    },
    {
      path: '../runtime/connection/provider',
      importer: editorImporter,
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../runtime/state/application-state',
      importer: editorImporter,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../shell/navigation',
      importer: editorImporter,
      contents: 'export const useNavigation=()=>({focused:true});',
    },
    {
      path: '../runtime/state/native-effect',
      importer: editorImporter,
      contents: "import {Effect} from 'effect';export const mobileWorkflow=Effect.gen;",
    },
    {
      path: '../ui/controls/use-action',
      importer: editorImporter,
      contents:
        "import {Effect} from 'effect';export const useAction=()=>({busy:false,error:'',act:fn=>Effect.runPromise(fn())});",
    },
    { path: 'expo-crypto', contents: 'export const randomUUID=()=>crypto.randomUUID();' },
    ...[
      'react-native',
      '../ui/content/text',
      '../screens/settings-theme',
      '../screens/settings-controls',
      '../ui/controls/icon',
      '../ui/controls/icon-button',
      './step-fields',
    ].map((path) => ({
      path,
      ...(path === 'react-native' ? {} : { importer: editorImporter }),
      contents: editorControls,
    })),
  ],
)
const editorBrowser = await chromium.launch()
try {
  const page = await editorBrowser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: editorBundle.outputFiles[0].text })
  const desktop = page.getByTestId('desktop-editor'),
    mobile = page.getByTestId('mobile-editor')
  await desktop.getByLabel('Trigger', { exact: true }).selectOption('once')
  await desktop.getByLabel('Run at', { exact: true }).fill('2026-10-28T09:30')
  assert.deepEqual(
    await page.evaluate(() => ({
      trigger: window.desktopData.trigger,
      runAt: window.desktopData.runAt,
      timezone: window.desktopData.timezone,
    })),
    { trigger: 'once', runAt: '2026-10-28T09:30', timezone: 'Europe/Amsterdam' },
  )
  await mobile.getByLabel('Trigger', { exact: true }).selectOption('once')
  await mobile.getByLabel('Run at', { exact: true }).fill('2026-02-30 09:30')
  await mobile.getByRole('button', { name: 'Save automation', exact: true }).click()
  await mobile
    .getByRole('alert')
    .filter({ hasText: 'Enter a valid date, time and time zone.' })
    .waitFor()
  assert.equal(await page.evaluate(() => window.saved), undefined)
  await mobile.getByLabel('Run at', { exact: true }).fill('2026-10-28 09:30')
  await mobile.getByRole('button', { name: 'Save automation', exact: true }).click()
  await page.waitForFunction(() => window.editorClosed)
  const saved = await page.evaluate(() => window.saved)
  assert.equal(saved.path, '/api/workspace')
  assert.equal(saved.body.id, 'reminder')
  assert.equal(saved.body.changes.nodes.before[0].data.trigger, 'manual')
  assert.equal(saved.body.changes.nodes.after[0].data.trigger, 'once')
  assert.equal(saved.body.changes.nodes.after[0].data.runAt, '2026-10-28T09:30')
  assert.equal(saved.body.changes.nodes.after[0].data.timezone, 'Europe/Amsterdam')
  assert.deepEqual(errors, [])
  console.log(
    'Desktop and mobile one-time editors preserve date/time zones, validate calendar dates and save the scheduled trigger.',
  )
} finally {
  await editorBrowser.close()
}
