import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from './browser/harness.mjs'

const require = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {DiscoveryCache} from '../client-runtime/src/effects/discovery-cache';export {providers} from '../studio-core/src/providers';export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  './agent-avatar': `export const AgentAvatar=()=>null;`,
  './harness-icon': `export const HarnessIcon=()=>null;`,
  'react-native': `export const View=({children})=><div>{children}</div>;`,
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const MobileContext=createContext(null);export const useRuntime=()=>useContext(MobileContext);`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../agents/model-settings': `export const ModelSettings=()=>null;`,
  '../../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled,selectedLabel})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{!items.some(item=>item.id===value)&&<option value={value} disabled hidden>{selectedLabel}</option>}{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../ui/theme': `export const styles={};export const useTheme=()=>({styles,colors:{},mode:'dark'});`,
}
const built = await build({
  alias: {
    react: dirname(require.resolve('react/package.json')),
    'react-dom': dirname(require.resolve('react-dom/package.json')),
  },
  stdin: {
    contents: `
import {useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';import {Context,defaultTaskHarness} from '@dovo/studio-core';import {MobileContext} from '../runtime/connection/provider';import {ComposerModelPicker} from './src/composer-model-picker';import {TaskLauncherControls} from '../../apps/mobile/src/tasks/creation/task-launcher-controls';
const agents=[{...defaultTaskHarness('codex'),id:'custom',name:'Custom Codex'},{...defaultTaskHarness('cursor'),id:'missing',name:'Missing Cursor'}];
const installations=[{id:'installed',registryId:'installed',name:'Installed ACP',version:'1',distribution:'npx',installedAt:'2026-10-01T00:00:00Z'}];
const repository={id:'repo',name:'Repo',path:'/repo',branch:'main'};
const snapshot={workspace:{agents,repositories:[repository],tasks:[]},defaults:{},acpInstallations:installations};
window.deferModels=false;window.pendingModels=[];window.modelRequests=[];window.pending=[];window.changes=[];window.mode='desktop';
function App(){const[host,setHost]=useState('one');const[mode,setMode]=useState('desktop');const[locked,setLocked]=useState(undefined);const[value,setValue]=useState(defaultTaskHarness('codex'));window.host=setHost;window.mode=setMode;window.lock=setLocked;window.value=value;
const request=useCallback(async(path,input)=>{if(path==='/api/agents/models'){window.modelRequests.push({host,input});if(window.deferModels)return new Promise((resolve,reject)=>window.pendingModels.push({resolve,reject}));return {models:[{id:'model',name:input.provider+' model'}]}}if(path!='/api/agents/availability')throw new Error('Unexpected request '+path);return new Promise((resolve,reject)=>window.pending.push({host,input,resolve,reject}));},[host]);
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
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.evaluate(() =>
    localStorage.setItem('dovo:model-favorites', 'cursor:missing-model\ncodex:favorite-model'),
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
  await finish(0, ['harness:codex', 'harness:claude', 'agent:custom', 'acp:installed'])
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Installed ACP models', exact: true }).waitFor()
  await absent(page.getByRole('button', { name: 'Cursor models', exact: true }))
  await absent(page.getByRole('button', { name: 'ACP models', exact: true }))
  await page.getByRole('button', { name: 'Favorite models', exact: true }).click()
  await page.getByRole('option', { name: 'favorite-model' }).waitFor()
  await absent(page.getByRole('option', { name: 'missing-model' }))
  await page.getByRole('button', { name: 'Configurations', exact: true }).click()
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
  await page.getByRole('button', { name: 'Refresh providers' }).click()
  await waitRequests(4)
  if (!(await page.evaluate(() => window.pending[3].input.refresh)))
    throw new Error('Manual refresh did not bypass cached availability')
  await page.getByRole('button', { name: 'Claude models', exact: true }).waitFor()
  await finish(3, ['harness:claude', 'harness:codex'])
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await absent(codexSignIn)
  await page.getByRole('button', { name: 'Refresh providers' }).click()
  await waitRequests(5)
  await page.evaluate(() => window.pending[4].reject(new Error('Refresh failed')))
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  const modelRequests = await page.evaluate(() => window.modelRequests.length)
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.getByRole('button', { name: 'Choose agent and model' }).click()
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  if (await page.evaluate(() => window.pending.length !== 5))
    throw new Error('Reopening discarded fresh provider cache')
  if (await page.evaluate((count) => window.modelRequests.length !== count, modelRequests))
    throw new Error('Reopening rediscovered cached models')
  await page.evaluate(() => window.lock('codex'))
  await absent(page.getByRole('button', { name: 'Claude models', exact: true }))
  if (await page.evaluate(() => window.changes.length))
    throw new Error('Availability changed saved selection')
  await page.evaluate(() => window.mode('mobile'))
  await waitRequests(6)
  await finish(5, ['harness:claude', 'agent:custom', 'acp:installed'])
  const choice = page.getByRole('combobox', { name: 'Agent', exact: true })
  await choice.getByRole('option', { name: 'Claude', exact: true }).waitFor({ state: 'attached' })
  await absent(choice.getByRole('option', { name: 'Cursor', exact: true }))
  await choice.selectOption('harness:claude')
  if (await page.evaluate(() => window.changes.at(-1)?.provider !== 'claude'))
    throw new Error('Available mobile provider was not selectable')
  await page.evaluate(() => window.host('four'))
  await waitRequests(7)
  await absent(choice.getByRole('option', { name: 'Claude', exact: true }))
  await page.evaluate(() => window.pending[6].reject(new Error('Offline')))
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
  await waitRequests(8)
  await page.waitForFunction(() => window.pendingModels.length === 1)
  await page.locator('[role=option][data-value=model]').waitFor()
  await page.getByRole('button', { name: 'Codex models', exact: true }).waitFor()
  await page.evaluate(() => window.pendingModels[0].reject(new Error('Model refresh failed')))
  await page.getByText('Error: Model refresh failed', { exact: true }).waitFor()
  await page.locator('[role=option][data-value=model]').waitFor()
  await finish(7, ['harness:codex', 'harness:claude'])
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Desktop/mobile provider availability, favorites, saved agents, runtime isolation, locks, cached reopening, stale model refresh and failure recovery passed.',
  )
} finally {
  await browser.close()
}
