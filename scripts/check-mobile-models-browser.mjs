import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const webRequire = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  'react-native': `export const View=({children})=><div>{children}</div>;`,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};`,
  'expo-crypto': `export const CryptoDigestAlgorithm={SHA256:'SHA-256'};export const digestStringAsync=async(_,text)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');`,
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const Context=createContext(null);export const useRuntime=()=>useContext(Context);`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../runtime/preferences/app-preferences': `export const useMobilePreferences=()=>({globalModelPreferences:{},globalModelPreferencesUpdatedAt:0});export const updateMobilePreferences=()=>{};`,
  '../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../ui/controls/field': `export const Field=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;`,
  '../ui/theme': `export const styles={};`,
}
const built = await build({
  alias: {
    react: dirname(webRequire.resolve('react/package.json')),
    'react-dom': dirname(webRequire.resolve('react-dom/package.json')),
  },
  stdin: {
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {defaultTaskHarness} from '@dovo/protocol';import {ModelSettings} from './src/agents/model-settings.tsx';import {Context} from '../runtime/connection/provider';
window.requests=[];window.finishes=[];
const readRuntime=async(profile,path,input)=>new Promise(resolve=>{window.requests.push({host:profile.id,path,input});window.finishes.push(resolve)});
function App(){const[host,setHost]=useState('one');const[agent,setAgent]=useState({...defaultTaskHarness('codex'),id:'agent',name:'Agent',model:''});const[online,setOnline]=useState(true);window.host=value=>setHost(value);window.harness=provider=>setAgent({...defaultTaskHarness(provider),id:'agent',name:'Agent',model:''});window.online=setOnline;const value={profile:{id:host,name:host,connection:{address:'http://'+host,token:'private-token'}},connected:online,readRuntime,snapshot:{defaults:{}},refresh:async()=>{}};return <Context.Provider value={value}><ModelSettings agent={agent} onChange={setAgent}/></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-environment' }, ({ path }) => ({
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
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const waitRequests = (count) =>
    page.waitForFunction((count) => window.requests?.length === count, count)
  const finish = (index, catalog) =>
    page.evaluate(({ index, catalog }) => window.finishes[index](catalog), { index, catalog })
  const catalog = (id, name, harness) => ({
    models: [{ id, name }],
    reasoning: [],
    ...(harness ? { harness } : {}),
  })
  await waitRequests(1)
  await page.evaluate(() => window.harness('opencode'))
  await waitRequests(2)
  await finish(0, catalog('gpt-5.1-sol', 'GPT-5.1 Sol'))
  if (await page.getByRole('option', { name: 'GPT-5.1 Sol', exact: true }).count())
    throw new Error('Late Codex response leaked into OpenCode')
  await finish(
    1,
    catalog('openai/custom', 'Host Custom', { name: 'OpenCode v2', generation: 'v2' }),
  )
  await page
    .getByRole('option', { name: 'Host Custom', exact: true })
    .waitFor({ state: 'attached' })
  await page.getByText('OpenCode v2 · Models from this computer', { exact: true }).waitFor()
  await page.evaluate(() => window.host('two'))
  await waitRequests(3)
  if (await page.getByRole('option', { name: 'Host Custom', exact: true }).count())
    throw new Error('Previous host catalogue remained in the picker')
  await finish(
    2,
    catalog('local/custom', 'Other Host Model', { name: 'OpenCode v1', generation: 'v1' }),
  )
  await page
    .getByRole('option', { name: 'Other Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.host('one'))
  await page
    .getByRole('option', { name: 'Host Custom', exact: true })
    .waitFor({ state: 'attached' })
  if ((await page.evaluate(() => window.requests.length)) !== 3)
    throw new Error('Returning to a cached harness rediscovered its models')
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click()
  await waitRequests(4)
  if (!(await page.evaluate(() => window.requests[3].input.refresh)))
    throw new Error('Refresh did not bypass the host cache')
  await finish(
    3,
    catalog('openai/custom', 'Updated Host Model', { name: 'OpenCode v2', generation: 'v2' }),
  )
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.online(false))
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  const stored = await page.evaluate(() => localStorage.getItem('dovo.model-catalogs.v1'))
  if (!stored || stored.includes('private-token'))
    throw new Error('Persistent model cache contains credentials or is missing')
  await page.reload()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page
    .getByRole('option', { name: 'GPT-5.1 Sol', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.harness('opencode'))
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.harness('hermes'))
  await waitRequests(1)
  const hermesRequest = await page.evaluate(() => window.requests[0].input)
  if (hermesRequest.provider !== 'hermes')
    throw new Error('Hermes model discovery used another provider')
  await finish(0, catalog('openrouter:anthropic/claude-sonnet-4.6', 'Hermes Sonnet'))
  await page
    .getByRole('option', { name: 'Hermes Sonnet', exact: true })
    .waitFor({ state: 'attached' })
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption('openrouter:anthropic/claude-sonnet-4.6')
  await page.evaluate(() => window.online(false))
  await page
    .getByRole('option', { name: 'Hermes Sonnet', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.online(true))
  for (const [provider, id, name] of [
    ['copilot', 'gpt-example', 'Copilot Model'],
    ['muse', JSON.stringify({ providerId: 'meta', modelId: 'example' }), 'Muse Model'],
    ['grok', 'grok-example', 'Grok Model'],
  ]) {
    const before = await page.evaluate(() => window.requests.length)
    await page.evaluate((provider) => window.harness(provider), provider)
    await waitRequests(before + 1)
    const request = await page.evaluate((index) => window.requests[index].input, before)
    if (request.provider !== provider)
      throw new Error(`${provider} discovered through another provider`)
    await finish(before, {
      models: [
        { id, name, ...(provider === 'grok' ? {} : { reasoning: [{ id: 'high', name: 'High' }] }) },
      ],
      reasoning: [{ id: 'high', name: 'High' }],
    })
    await page.getByRole('option', { name, exact: true }).waitFor({ state: 'attached' })
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption(id)
    if (provider === 'grok') {
      await waitRequests(before + 2)
      const selected = await page.evaluate((index) => window.requests[index].input, before + 1)
      if (selected.model !== id) throw new Error('Grok reasoning discovery lost the selected model')
      await finish(before + 1, {
        models: [{ id, name }],
        reasoning: [{ id: 'high', name: 'High' }],
      })
    }
    await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption('high')
    await page.evaluate(() => window.online(false))
    await page.getByRole('option', { name, exact: true }).waitFor({ state: 'attached' })
    await page.evaluate(() => window.online(true))
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Mobile picker: host and harness switches, late responses, cache reuse, real refresh, offline names, Hermes/Copilot/Grok/Muse model selection, reasoning and OpenCode v1/v2 labels passed.',
  )
} finally {
  await browser.close()
}
