import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from './browser/harness.mjs'

const require = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {DiscoveryCache} from '../client-runtime/src/effects/discovery-cache';export {browserModelCatalogCache} from '../studio-core/src/workspace/model-catalog-cache';export {providers} from '../studio-core/src/providers';export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '../ui/controls/field': `export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;`,
  '../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async()=>{}};`,
  'expo-crypto': `export const CryptoDigestAlgorithm={SHA256:'SHA-256'};export const digestStringAsync=async(_,text)=>text;`,
  './agent-avatar': `export const AgentAvatar=()=>null;`,
  '../../agents/harness-icon': `export const HarnessIcon=()=>null;`,
  '../../ui/layout/sheet': `export const Sheet=({children,onClose,title})=><section aria-label={title}>{children}<button onClick={onClose}>Close picker</button></section>;`,
  './harness-icon': `export const HarnessIcon=()=>null;`,
  '../ui/controls/icon': `export const Icon=()=>null;`,
  'react-native': `export const ScrollView=({children})=><div>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button aria-label={accessibilityLabel} role={accessibilityRole} aria-expanded={accessibilityState?.expanded} onClick={onPress} disabled={disabled}>{children}</button>;export const View=({children})=><div>{children}</div>;export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};`,
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const MobileContext=createContext(null);export const useRuntime=()=>useContext(MobileContext);export const useRuntimeSelector=select=>select(useContext(MobileContext));`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../agents/model-settings': `export const ModelSettings=()=>null;`,
  '../../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled,selectedLabel})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{!items.some(item=>item.id===value)&&<option value={value} disabled hidden>{selectedLabel}</option>}{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../ui/theme': `export const styles={};export const useTheme=()=>({styles,colors:{},mode:'dark'});`,
}
mocks['../screens/settings-controls'] = mocks['../../ui/controls/choice'].replace(
  'const Choice=',
  'const SettingsChoice=',
)
mocks['../ui/controls/choice'] = mocks['../../ui/controls/choice']
mocks['../ui/content/text'] = mocks['../../ui/content/text']
mocks['../ui/theme'] = mocks['../../ui/theme']
const built = await build({
  alias: {
    react: dirname(require.resolve('react/package.json')),
    'react-dom': dirname(require.resolve('react-dom/package.json')),
  },
  stdin: {
    contents: `
import {useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';import {Context,defaultTaskHarness} from '@dovo/studio-core';import {MobileContext} from '../runtime/connection/provider';import {ComposerModelPicker} from './src/composer-model-picker';import {TaskLauncherPicker as TaskLauncherControls} from '../../apps/mobile/src/tasks/creation/task-launcher-controls';
const agents=[{...defaultTaskHarness('codex'),id:'custom',name:'Custom Codex'},{...defaultTaskHarness('cursor'),id:'missing',name:'Missing Cursor'}];
const installations=[{id:'installed',registryId:'installed',name:'Installed ACP',version:'1',distribution:'npx',installedAt:'2026-10-01T00:00:00Z'}];
const repository={id:'repo',name:'Repo',path:'/repo',branch:'main'};
const snapshot={workspace:{agents,repositories:[repository],tasks:[]},defaults:{},acpInstallations:installations};
window.deferModels=false;window.pendingModels=[];window.modelRequests=[];window.pending=[];window.changes=[];window.mode='desktop';
function App(){const[host,setHost]=useState('one');const[mode,setMode]=useState('desktop');const[locked,setLocked]=useState(undefined);const[value,setValue]=useState(defaultTaskHarness('codex'));window.host=setHost;window.mode=setMode;window.lock=setLocked;window.value=value;
const request=useCallback(async(path,input)=>{if(path==='/api/agents/models/cached')return null;if(path==='/api/agents/models'){window.modelRequests.push({host,input});if(window.deferModels)return new Promise((resolve,reject)=>window.pendingModels.push({resolve,reject}));return {models:[{id:'',name:'Provider default'},{id:'default',name:'Default (recommended)',isDefault:true},{id:'model',name:input.provider+' model'},...(window.terraAvailable?[{id:'gpt-6.1-terra',name:'GPT-6.1 Terra'}]:[])],reasoning:[]}}if(path!='/api/agents/availability')throw new Error('Unexpected request '+path);return new Promise((resolve,reject)=>window.pending.push({host,input,resolve,reject}));},[host]);
const profile={id:host,connection:{address:'http://'+host,token:'token-'+host}};
const change=async next=>{window.changes.push(next);setValue(next);return true};
return mode==='desktop'?<Context.Provider value={{request,connected:true,connection:profile.connection,snapshot}}><ComposerModelPicker repositoryId="repo" value={value} agents={agents} disabled={false} lockedProvider={locked} onChange={change} onConfigure={()=>{}} onSelectAgent={async id=>{window.changes.push(id);return true}} onUseHarness={change}/></Context.Provider>:<MobileContext.Provider value={{profile,connected:true,snapshot,readRuntime:(_profile,path,input)=>request(path,input)}}><TaskLauncherControls snapshot={snapshot} repository={repository} selection={{key:'harness:codex',name:'Codex',provider:'codex',model:'',harness:value}} disabled={false} onChange={next=>window.changes.push(next)}/></MobileContext.Provider>};
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'provider-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'provider-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'provider-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
          loader: 'tsx',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.evaluate(() =>
    localStorage.setItem(
      'dovo:model-favorites',
      'cursor:missing-model\ncodex:favorite-model\ncodex:\ncodex:default',
    ),
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const waitRequests = (count) =>
    page.waitForFunction((count) => window.pending.length === count, count)
  const finish = (index, ids) =>
    page.evaluate(
      ({ index, ids }) => window.pending[index].resolve(ids.map((id) => ({ id, available: true }))),
      { index, ids },
    )
  const absent = async (locator) => {
    await locator.waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await waitRequests(1)
  await absent(page.getByRole('button', { name: 'Cursor models', exact: true }))
  await finish(0, [
    'harness:codex',
    'harness:claude',
    'harness:vibe',
    'agent:custom',
    'acp:installed',
  ])
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Installed ACP models', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Vibe models', exact: true }).waitFor()
  await absent(page.getByRole('button', { name: 'Cursor models', exact: true }))
  await absent(page.getByRole('button', { name: 'ACP models', exact: true }))
  await page.getByRole('button', { name: 'Favorite models', exact: true }).click()
  await page.getByRole('option', { name: 'favorite-model' }).waitFor()
  await absent(page.getByRole('option', { name: 'missing-model' }))
  await absent(page.getByRole('option', { name: 'Provider default' }))
  await absent(page.getByRole('option', { name: 'default', exact: true }))
  await page.getByRole('button', { name: 'Custom configurations', exact: true }).click()
  await page.getByRole('option', { name: 'Custom Codex' }).waitFor()
  await absent(page.getByRole('option', { name: 'Missing Cursor' }))
  await page.evaluate(() => window.host('two'))
  await waitRequests(2)
  await absent(page.getByRole('button', { name: 'Codex models', exact: true }))
  await page.evaluate(() => window.host('three'))
  await waitRequests(3)
  await finish(1, ['harness:cursor'])
  await absent(page.getByRole('button', { name: 'Cursor models', exact: true }))
  await finish(2, ['harness:claude'])
  await page.getByRole('button', { name: 'Claude models', exact: true }).waitFor()
  const codexSignIn = page.getByRole('button', { name: 'Codex requires sign-in' })
  if (!(await codexSignIn.isDisabled())) throw new Error('Signed-out provider is selectable')
  await page.getByText('codex login', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Refresh providers and models' }).click()
  await waitRequests(4)
  if (!(await page.evaluate(() => window.pending[3].input.refresh)))
    throw new Error('Manual refresh did not bypass cached availability')
  await page.getByRole('button', { name: 'Claude models', exact: true }).waitFor()
  await finish(3, ['harness:claude', 'harness:codex'])
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await absent(codexSignIn)
  await page.getByRole('button', { name: 'Refresh providers and models' }).click()
  await waitRequests(5)
  await page.evaluate(() => window.pending[4].reject(new Error('Refresh failed')))
  await absent(page.getByRole('button', { name: 'Codex models', exact: true }))
  await page
    .getByText('Could not check available providers: Error: Refresh failed', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await waitRequests(6)
  await finish(5, ['harness:claude', 'harness:codex'])
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await page.locator('[role=option][data-value=model]').waitFor()
  await absent(page.getByRole('option', { name: 'Provider default' }))
  await absent(page.getByRole('option', { name: 'Default (recommended)' }))
  if (await page.locator('[role=option][data-value=model] svg').count())
    throw new Error('Model row still contains a repeated harness icon')
  if ((await page.locator('[role=option][data-value=model]').innerText()).trim() !== 'codex model')
    throw new Error('Model row still repeats the harness name')
  const modelRequests = await page.evaluate(() => window.modelRequests.length)
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  if (await page.evaluate(() => window.pending.length !== 6))
    throw new Error('Reopening discarded fresh provider cache')
  if (await page.evaluate((count) => window.modelRequests.length !== count, modelRequests))
    throw new Error('Reopening rediscovered cached models')
  await page.evaluate(() => window.lock('codex'))
  await absent(page.getByRole('button', { name: 'Claude models', exact: true }))
  if (await page.evaluate(() => window.changes.length))
    throw new Error('Availability changed saved selection')
  await page.evaluate(() => window.mode('mobile'))
  if (await page.getByRole('textbox', { name: 'Search harnesses and models' }).count())
    throw new Error('New-thread picker was expanded before opening')
  await page.getByRole('button', { name: 'Choose agent and model', exact: true }).click()
  await waitRequests(7)
  await finish(6, ['harness:claude', 'harness:vibe', 'agent:custom', 'acp:installed'])
  await page.getByRole('button', { name: 'More settings', exact: true }).click()
  if (await page.getByRole('textbox', { name: 'Search harnesses and models' }).count())
    throw new Error('New-thread settings were appended below the picker')
  await page.getByRole('button', { name: 'Back to models', exact: true }).click()
  const harness = (name) => page.getByRole('button', { name, exact: true })
  await harness('Claude models').waitFor()
  await absent(harness('Cursor models'))
  await page
    .getByRole('textbox', { name: 'Search harnesses and models', exact: true })
    .fill('vibe model')
  if (await page.evaluate(() => window.changes.length))
    throw new Error('Browsing a harness changed selection')
  await absent(harness('Provider default'))
  await absent(harness('Default (recommended)'))
  await harness('vibe model').click()
  if (await page.evaluate(() => window.changes.at(-1)?.provider !== 'vibe'))
    throw new Error('Available mobile Vibe provider was not selectable')
  await page
    .getByRole('combobox', { name: 'Filter models', exact: true })
    .selectOption('harness:claude')
  await absent(harness('Provider default'))
  await absent(harness('Default (recommended)'))
  await harness('claude model').click()
  if (await page.evaluate(() => window.changes.at(-1)?.provider !== 'claude'))
    throw new Error('Available mobile provider was not selectable')
  await page.evaluate(() => window.host('four'))
  await waitRequests(8)
  await absent(harness('Claude models'))
  await page.evaluate(() => window.pending[7].reject(new Error('Offline')))
  await page.getByText('Could not check available providers: Error: Offline').waitFor()
  await page.evaluate(() => {
    window.host('three')
    window.mode('desktop')
    window.lock(undefined)
  })
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.locator('[role=option][data-value=model]').waitFor()
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.evaluate(() => {
    const now = Date.now()
    Date.now = () => now + 6 * 60_000
    window.deferModels = true
  })
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await waitRequests(9)
  await finish(8, ['harness:codex', 'harness:claude'])
  await page.waitForFunction(() => window.pendingModels.length === 1)
  await page.locator('[role=option][data-value=model]').waitFor()
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await page.evaluate(() => window.pendingModels[0].reject(new Error('Model refresh failed')))
  await page.getByText('Error: Model refresh failed', { exact: true }).waitFor()
  await page.locator('[role=option][data-value=model]').waitFor()
  await page.evaluate(() => {
    window.deferModels = false
  })
  await page.getByRole('combobox', { name: 'Search models', exact: true }).fill('gpt-6.1-terra')
  await page.getByRole('option', { name: 'Use custom model “gpt-6.1-terra”' }).click()
  if (await page.evaluate(() => window.value.model !== 'gpt-6.1-terra'))
    throw new Error('Custom Terra model ID was not preserved')
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.evaluate(() => {
    window.terraAvailable = true
  })
  await page.getByRole('button', { name: 'Refresh providers and models', exact: true }).click()
  await waitRequests(10)
  await finish(9, ['harness:codex', 'harness:claude'])
  await page.getByRole('option', { name: 'GPT-6.1 Terra' }).waitFor()
  if (!(await page.evaluate(() => window.modelRequests.at(-1).input.refresh)))
    throw new Error('Picker refresh did not bypass the cached model list')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Desktop/mobile provider availability, favorites, saved agents, runtime isolation, locks, cached reopening, stale model refresh and failure recovery passed.',
  )
} finally {
  await browser.close()
}
