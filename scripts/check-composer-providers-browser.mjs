import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const require = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export * from '@dovo/protocol';export {providers} from '../studio-core/src/providers';export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  './harness-catalog': `export const useHarnessCatalog=harness=>({catalog:{models:[{id:'model',name:harness.provider+' model'}]},modelName:'',loading:false,error:''});`,
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
window.pending=[];window.changes=[];window.mode='desktop';
function App(){const[host,setHost]=useState('one');const[mode,setMode]=useState('desktop');const[locked,setLocked]=useState(undefined);const[value,setValue]=useState(defaultTaskHarness('codex'));window.host=setHost;window.mode=setMode;window.lock=setLocked;window.value=value;
const request=useCallback(async(path,input)=>{if(path!='/api/agents/availability')throw new Error('Unexpected request '+path);return new Promise((resolve,reject)=>window.pending.push({host,input,resolve,reject}));},[host]);
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
    if (await locator.count()) throw new Error('Unavailable provider remained visible')
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
  await page.evaluate(() => window.lock('codex'))
  await absent(page.getByRole('button', { name: 'Claude models', exact: true }))
  if (await page.evaluate(() => window.changes.length))
    throw new Error('Availability changed saved selection')
  await page.evaluate(() => window.mode('mobile'))
  await waitRequests(4)
  await finish(3, ['harness:claude', 'agent:custom', 'acp:installed'])
  const choice = page.getByRole('combobox', { name: 'Agent', exact: true })
  await choice.getByRole('option', { name: 'Claude', exact: true }).waitFor({ state: 'attached' })
  await absent(choice.getByRole('option', { name: 'Cursor', exact: true }))
  await choice.selectOption('harness:claude')
  if (await page.evaluate(() => window.changes.at(-1)?.provider !== 'claude'))
    throw new Error('Available mobile provider was not selectable')
  await page.evaluate(() => window.host('four'))
  await waitRequests(5)
  await absent(choice.getByRole('option', { name: 'Claude', exact: true }))
  await page.evaluate(() => window.pending[4].reject(new Error('Offline')))
  await page.getByText('Could not check available providers: Error: Offline').waitFor()
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Desktop/mobile provider availability, favorites, saved agents, runtime isolation, locks and recovery passed.',
  )
} finally {
  await browser.close()
}
