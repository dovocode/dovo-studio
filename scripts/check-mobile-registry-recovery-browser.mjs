import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/runtime/connection/provider.tsx'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';
import {runtimeProfile} from '@dovo/protocol';
import {ApplicationStateProvider} from './packages/studio-core/src/runtime/application-state.ts';
import {RuntimeProvider,useRuntime} from './apps/mobile/src/runtime/connection/provider.tsx';
window.readFails=true;window.writes=[];window.requests=[];
const profiles=['one','two'].map(name=>runtimeProfile({address:'http://'+name+'.lan:8787',token:'test-private-token-at-least-32-characters-'+name},name));
window.saved=JSON.stringify({version:1,activeId:profiles[0].id,profiles});
window.fetch=async(url)=>{window.requests.push(String(url));return Response.json({revision:1,owner:false,workspace:{version:1,runtimeAddress:'',agents:[],tasks:[],repositories:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]})};
function Probe(){window.runtime=useRuntime();return <div>{window.runtime.ready?'Ready':'Loading'}</div>}
createRoot(document.getElementById('app')).render(<ApplicationStateProvider><RuntimeProvider><Probe/></RuntimeProvider></ApplicationStateProvider>);
window.connectThird=()=>window.runtime.connect({address:'http://third.lan:8787',token:'test-third-private-token-at-least-32-characters'});
`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
  },
  [
    {
      path: '@dovo/protocol',
      contents: `export * from '${root}packages/protocol/src/index.ts';export const startRuntimeSync=()=>({online:()=>false,refresh:()=>{},stop:()=>{}});`,
    },
    {
      path: 'react-native',
      contents: `export const AppState={currentState:'background',addEventListener:()=>({remove:()=>{}})};`,
    },
    {
      path: 'expo-network',
      contents: `export const addNetworkStateListener=()=>({remove:()=>{}});export const getNetworkStateAsync=async()=>({isConnected:true});export const NetworkStateType={CELLULAR:'cellular'};`,
    },
    {
      path: 'expo-secure-store',
      contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=async key=>{if(window.readFails)throw Error('Credential store temporarily unavailable');return key==='dovo.runtime.registry'?window.saved:null};export const setItemAsync=async(key,value)=>{window.writes.push({key,value});if(key==='dovo.runtime.registry')window.saved=value};export const deleteItemAsync=async()=>{};`,
    },
    {
      path: './read-cache',
      importer,
      contents: `export {browserReadCache as mobileReadCache} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
    },
    {
      path: './mutation-storage',
      importer,
      contents: `export {browserMutationStorage as mobileMutationStorage} from '${root}packages/studio-core/src/workspace/read-cache.ts';`,
    },
    {
      path: '../preferences/app-preferences',
      importer,
      contents: `const preferences={computerRefresh:'manual',globalAgentPresets:[],retiredGlobalAgentPresets:[],globalModelPreferences:null,globalModelPreferencesUpdatedAt:0,sharedScopedSettings:[]};export const useMobilePreferences=()=>preferences;export const readMobilePreferences=()=>preferences;export const updateMobilePreferences=()=>{};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.route('http://mobile-recovery.lan/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.goto('http://mobile-recovery.lan/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.runtime?.ready)
  assert.equal(await page.evaluate(() => window.runtime.registryLoaded), false)
  assert.match(
    await page.evaluate(() => window.runtime.error),
    /Credential store temporarily unavailable/,
  )
  const failure = await page.evaluate(() =>
    window.connectThird().then(
      () => '',
      (error) => error.message,
    ),
  )
  assert.match(failure, /Retry loading/)
  assert.deepEqual(await page.evaluate(() => window.writes), [])
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  assert.equal(await page.evaluate(() => JSON.parse(window.saved).profiles.length), 2)
  await page.evaluate(async () => {
    window.readFails = false
    await window.runtime.refreshAll()
  })
  await page.waitForFunction(
    () => window.runtime.registryLoaded && window.runtime.profiles.length === 2,
  )
  await page.evaluate(() => window.connectThird())
  assert.equal(await page.evaluate(() => JSON.parse(window.saved).profiles.length), 3)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile registry recovery: failed credential reads preserve pairings, block writes, and recover on explicit retry.',
  )
} finally {
  await browser.close()
}
