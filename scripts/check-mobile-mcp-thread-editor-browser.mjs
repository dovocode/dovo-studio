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
export const useTheme=()=>({styles:{},colors:{}});export const Icon=()=>null;export const HarnessIcon=()=>null;export const IconButton=()=>null;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {RegistryProvider} from '@effect/atom-react';
import {decode,snapshotSchema,launcherDefaultAgent} from '@dovo/protocol';import {McpThreadEditor} from './apps/mobile/src/ui/content/mcp-thread-editor';
const snapshot=decode(snapshotSchema,{revision:1,owner:false,approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[],permissionPolicySupported:true,workspace:{version:1,runtimeAddress:'',repositories:[{id:'source-project',name:'Source project',path:'/project',branch:'main'}],agents:[],tasks:[],automations:[]}});
window.runtime={connected:true,snapshot};window.sends=[];window.fail=true;window.hold=true;
const repository=snapshot.workspace.repositories[0];const initial={prompt:'Agent suggested prompt',selection:launcherDefaultAgent(snapshot,repository)};
function App(){const [show,setShow]=useState(true);const [scope,setScope]=useState('source-owner/app/action-1');window.openEditor=key=>{setScope(key);setShow(true)};return show?<McpThreadEditor key={scope} draftKey={scope} initial={initial} repository={repository} onClose={()=>setShow(false)} onSend={async value=>{window.sends.push(value);if(window.hold)await new Promise(resolve=>window.release=resolve);if(window.fail)throw Error('Temporary runtime outage')}}/>:null};
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
  await page.getByLabel('Prompt', { exact: true }).fill('Human edited prompt')
  await page.getByRole('button', { name: 'Choose Claude', exact: true }).click()
  await page.getByLabel('Model', { exact: true }).fill('human-chosen-model')
  assert.equal(await page.evaluate(() => window.sends.length), 0)
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => window.openEditor('other-owner/app/action-1'))
  assert.equal(
    await page.getByLabel('Prompt', { exact: true }).inputValue(),
    'Agent suggested prompt',
  )
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => window.openEditor('source-owner/app/action-1'))
  assert.equal(await page.getByLabel('Prompt', { exact: true }).inputValue(), 'Human edited prompt')
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'human-chosen-model')
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
  assert.equal(await page.getByLabel('Prompt', { exact: true }).inputValue(), 'Human edited prompt')
  assert.equal(await page.getByLabel('Prompt', { exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await page.evaluate(() => {
    window.fail = false
    window.openEditor('source-owner/app/action-1')
  })
  await page.getByRole('button', { name: 'Retry Send', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const sends = await page.evaluate(() => window.sends)
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0], sends[1])
  assert.equal(sends[0].prompt, 'Human edited prompt')
  assert.equal(sends[0].selection.provider, 'claude')
  assert.equal(sends[0].selection.harness.model, 'human-chosen-model')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile MCP thread editor: local preparation, real launcher controls, prompt/harness/model edits, source-isolated drafts, double taps and identical retry after reopening pass.',
  )
} finally {
  await browser.close()
}
