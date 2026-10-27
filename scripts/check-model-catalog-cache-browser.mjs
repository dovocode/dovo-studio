import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from './browser/harness.mjs'

const resolveDir = fileURLToPath(new URL('../packages/studio-ui/', import.meta.url))
const webRequire = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  '@dovo/client-runtime': `export * from '../client-runtime/src/index';`,
  '@dovo/studio-core': `export * from '@dovo/protocol'; export { browserModelCatalogCache } from '../studio-core/src/workspace/model-catalog-cache'; export { DiscoveryCache } from '@dovo/client-runtime'; export { Context as WorkspaceContext, useContextValue as useWorkspace } from 'cache-context';`,
  '@dovo/studio-core/state': `export { useState as useApplicationState } from 'react';`,
  'cache-context': `import {createContext,useContext} from 'react'; export const Context=createContext(null); export const useContextValue=()=>useContext(Context);`,
  'mobile-runtime': `import { useContextValue } from 'cache-context'; export const useRuntime=useContextValue; export const useRuntimeSelector=select=>select(useContextValue());`,
  'mobile-state': `export { useState as useApplicationState } from 'react';`,
  'mobile-active': `export { useCatalogVisible as useAppActive } from '../studio-ui/src/catalog-demand';`,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};`,
  'expo-crypto': `import {sha256} from '@noble/hashes/sha2.js'; import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js'; export const CryptoDigestAlgorithm={SHA256:'SHA256'}; export const digestStringAsync=async(_,value)=>bytesToHex(sha256(utf8ToBytes(value)));`,
}
const output = await build({
  alias: {
    react: dirname(webRequire.resolve('react/package.json')),
    'react-dom': dirname(webRequire.resolve('react-dom/package.json')),
  },
  stdin: {
    contents: `
import {useState,useCallback} from 'react'; import {createRoot} from 'react-dom/client';
import {defaultTaskHarness} from '@dovo/protocol'; import {Context} from 'cache-context';
import {useHarnessCatalog} from './src/harness-catalog'; import {useHarnessAvailability as useDesktopAvailability} from './src/use-harness-availability';
import {useModelCatalog} from '../../apps/mobile/src/agents/use-model-catalog'; import {useHarnessAvailability as useMobileAvailability} from '../../apps/mobile/src/agents/use-harness-availability';
window.requests=[];window.pending=[];window.serverCached=null;window.visible=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.visible?'visible':'hidden'});window.visibility=value=>{window.visible=value;document.dispatchEvent(new Event('visibilitychange'))};
const mobile=location.search.includes('mobile');
function Models({agent,active}) { const value=mobile?useModelCatalog(agent,active):useHarnessCatalog(agent,active); window.catalog=value; return <pre data-catalog>{JSON.stringify(value)}</pre> }
function Availability({agents}) { const value=mobile?useMobileAvailability('repo',agents):useDesktopAvailability('repo',true,agents);window.availability={...value,available:[...value.available]};return <pre data-availability>{JSON.stringify(window.availability)}</pre> }
function App(){
 const[state,setState]=useState({host:'one',boot:'boot-1',name:'Agent',model:'model',provider:'codex',env:{},alias:'lan',token:'device-token',permissionMode:'default',generation:'launch-1',version:'1',otherVersion:'1',active:false,online:true,availability:false,includeAgents:true,mounted:true});
 window.patch=change=>setState(old=>({...old,...change}));window.state=state;
 const profile={id:state.host,name:state.host,connection:{runtimeId:'logical-'+state.host,address:'http://'+state.alias,token:state.token}};
 const snapshot={runtimeId:'logical-'+state.host,runtimeInstanceId:state.boot,catalogGenerations:{codex:state.generation,'acp:selected':state.generation},acpInstallations:[{id:'selected',version:state.version,installedAt:'2026-10-14'},{id:'other',version:state.otherVersion,installedAt:'2026-10-14'}]};
 const agent={...defaultTaskHarness(state.provider),id:'selected',name:state.name,env:state.env,model:state.model,permissionMode:state.permissionMode,...(state.provider==='acp'?{acpInstallationId:'selected'}:{})};
 const request=useCallback(async(path,input)=>{
   const id=window.requests.length;window.requests.push({path,input,id});
   if(path==='/api/agents/models/cached')return window.serverCached;
   return new Promise((resolve,reject)=>window.pending[id]={resolve,reject});
 },[]);
 const readRuntime=useCallback((profile,path,input)=>request(path,input),[request]);
 const value={profile,activeRuntimeId:profile.id,connection:profile.connection,snapshot,connected:state.online,request,readRuntime,overviews:[{profile,snapshot}]};
 return <Context.Provider value={value}><pre data-state>{JSON.stringify(state)}</pre>{state.mounted&&<><Models agent={agent} active={state.active}/><Models agent={agent} active={state.active}/></>}{state.availability&&<Availability agents={state.includeAgents?[agent]:[]}/>}</Context.Provider>
}createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'catalog-adapters',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (importer.includes('/apps/mobile/src/agents/')) {
            if (path === '../runtime/connection/provider') path = 'mobile-runtime'
            if (path === '../runtime/state/application-state') path = 'mobile-state'
            if (path === '../runtime/state/app-active') path = 'mobile-active'
          }
          if (Object.hasOwn(mocks, path)) return { path, namespace: 'catalog-adapters' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'catalog-adapters' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/studio-core/', import.meta.url)),
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
const html = `<!doctype html><div id="app"></div><script>${output.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`
const catalog = (name = 'Last good model') => ({
  models: [{ id: 'model', name }],
  reasoning: [],
  harness: { name: 'Harness', generation: 'v2' },
  acp: {
    modes: [],
    commands: [],
    configOptions: [{ id: 'token', name: 'Token', currentValue: 'private-acp-value', options: [] }],
  },
  codex: { daybreakPrograms: ['daybreakBlue'], fastModeBlocked: true },
})
const browser = await chromium.launch({ headless: true })
try {
  for (const platform of ['desktop', 'mobile']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(platform, message.text())
    })
    await page.route('http://catalog-cache.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    )
    await page.goto(`http://catalog-cache.test/?${platform}`)
    await page.waitForFunction(() => window.patch)
    const patch = (value) => page.evaluate((change) => window.patch(change), value)
    const count = (path = '/api/agents/models') =>
      page.evaluate((path) => window.requests.filter((item) => item.path === path).length, path)
    const next = async (change, path = '/api/agents/models') => {
      const before = await count(path)
      await patch(change)
      await page.waitForFunction(
        ({ path, before }) =>
          window.requests.filter((item) => item.path === path).length === before + 1,
        { path, before },
      )
      return page.evaluate(
        (path) => window.requests.findLast((item) => item.path === path).id,
        path,
      )
    }
    const finish = (id, value) =>
      page.evaluate(({ id, value }) => window.pending[id].resolve(value), { id, value })
    const fail = (id, message) =>
      page.evaluate(({ id, message }) => window.pending[id].reject(new Error(message)), {
        id,
        message,
      })
    const named = (name) =>
      page.waitForFunction((name) => window.catalog.catalog?.models[0]?.name === name, name)
    const savedRaw = () =>
      page.evaluate(async (platform) => {
        if (platform === 'mobile') return localStorage.getItem('dovo.model-catalogs.v2')
        return new Promise((resolve, reject) => {
          const open = indexedDB.open('dovo-read-cache', 1)
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('entries', 'readonly')
            const request = tx.objectStore('entries').get('dovo.model-catalogs.v2')
            tx.oncomplete = () => {
              db.close()
              resolve(request.result)
            }
            tx.onerror = () => reject(tx.error)
          }
        })
      }, platform)
    assert.equal(await count(), 0, `${platform}: inactive rows must not discover`)
    const first = await next({ active: true }).catch(async (error) => {
      console.error(
        platform,
        await page.evaluate(() => ({
          state: window.state,
          catalog: window.catalog,
          requests: window.requests,
        })),
        errors,
      )
      throw error
    })
    assert.equal(await count('/api/agents/models/cached'), 1)
    await finish(first, catalog())
    await named('Last good model')
    await page.waitForTimeout(100)
    const raw = await savedRaw()
    assert.ok(raw.includes('Last good model'))
    for (const secret of ['private-acp-value', 'daybreakBlue', 'fastModeBlocked', 'device-token'])
      assert.ok(!raw.includes(secret), secret)
    await patch({
      name: 'Renamed',
      model: 'different',
      alias: 'vpn',
      token: 'rotated-token',
      permissionMode: 'bypass',
      otherVersion: '2',
    })
    await page.waitForTimeout(300)
    assert.equal(
      await count(),
      1,
      `${platform}: cosmetic/transport/unrelated install changes must not rediscover`,
    )
    const restarted = await next({ boot: 'boot-2' })
    await named('Last good model')
    assert.equal(
      await page.evaluate(() => !!window.catalog.catalog.codex || !!window.catalog.catalog.acp),
      false,
    )
    assert.equal(
      await count('/api/agents/models/cached'),
      1,
      'local presentation skips server cache',
    )
    await fail(restarted, 'Sign in required')
    await page.waitForFunction(() => window.catalog.error.includes('Sign in required'))
    await named('Last good model')
    await patch({ active: false })
    const empty = await next({ active: true })
    await finish(empty, { models: [], reasoning: [] })
    await page.waitForFunction(() => !window.catalog.loading)
    await named('Last good model')
    await patch({ active: false })
    const retry = await next({ active: true })
    await finish(retry, catalog('Recovered model'))
    await named('Recovered model')
    const beforeRefresh = await count()
    await page.evaluate(() => window.catalog.refresh())
    await page.waitForFunction(
      (before) =>
        window.requests.filter((item) => item.path === '/api/agents/models').length === before + 1,
      beforeRefresh,
    )
    const refreshed = await page.evaluate(() =>
      window.requests.findLast((item) => item.path === '/api/agents/models'),
    )
    assert.equal(
      refreshed.input.refresh,
      true,
      `${platform}: refresh must bypass the runtime cache`,
    )
    const updated = catalog('Recovered model')
    updated.models.push({ id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' })
    await finish(refreshed.id, updated)
    await page.waitForFunction(() =>
      window.catalog.catalog?.models.some((model) => model.id === 'gpt-6.1-terra'),
    )
    const old = await next({ boot: 'boot-3' })
    const newer = await next({ boot: 'boot-4' })
    await finish(newer, catalog('Current boot model'))
    await named('Current boot model')
    await finish(old, catalog('Late obsolete model'))
    await page.waitForTimeout(100)
    await named('Current boot model')
    assert.ok((await savedRaw()).includes('Current boot model'))
    if (platform === 'desktop')
      assert.ok(
        !(await page.evaluate(() => localStorage.getItem('dovo:model-labels:v1'))).includes(
          'Late obsolete model',
        ),
      )
    await page.reload()
    await named('Current boot model')
    assert.equal(await count(), 0)
    assert.equal(
      await page.evaluate(() => !!window.catalog.catalog.codex || !!window.catalog.catalog.acp),
      false,
    )
    const reloadLive = await next({ active: true })
    assert.equal(await count('/api/agents/models/cached'), 0)
    await finish(reloadLive, catalog('After reload'))
    await named('After reload')
    await page.evaluate((value) => {
      window.serverCached = value
    }, catalog('Server cached account'))
    const account = await next({ env: { ACCOUNT: 'private-account-setting' } })
    await named('Server cached account')
    assert.equal(
      await page.evaluate(() => !!window.catalog.catalog.codex || !!window.catalog.catalog.acp),
      false,
    )
    await finish(account, catalog('New account'))
    await named('New account')
    const generation = await next({ generation: 'launch-2' })
    await finish(generation, catalog('New launch'))
    await named('New launch')
    const acp = await next({ provider: 'acp' })
    await finish(acp, catalog('ACP model'))
    await named('ACP model')
    const installation = await next({ version: '2' })
    await finish(installation, catalog('ACP updated'))
    await named('ACP updated')
    await patch({ otherVersion: '3' })
    await page.waitForTimeout(300)
    assert.equal(await count(), 5, 'only selected install invalidates after reload')
    const unavailable = await next({ availability: true }, '/api/agents/availability')
    await finish(unavailable, [{ id: 'selected', available: false }])
    await page.waitForFunction(() => !window.availability.loading)
    assert.deepEqual(await page.evaluate(() => window.availability.available), [])
    await patch({ availability: false })
    const available = await next({ availability: true }, '/api/agents/availability')
    await finish(available, [{ id: 'selected', available: true }])
    await page.waitForFunction(() => window.availability.available.includes('selected'))
    await patch({ availability: false })
    await patch({ availability: true })
    await page.waitForTimeout(100)
    assert.equal(
      await count('/api/agents/availability'),
      2,
      'healthy availability can use 30-second memory cache',
    )
    await patch({ active: false })
    const availabilityRestart = await next({ boot: 'boot-5' }, '/api/agents/availability')
    await fail(availabilityRestart, 'Account unavailable')
    await page.waitForFunction(() => window.availability.error.includes('Account unavailable'))
    assert.deepEqual(await page.evaluate(() => window.availability.available), [])
    assert.equal(await count(), 5, 'inactive model consumers do not discover on runtime restart')
    await page.evaluate(() => window.visibility(false))
    await patch({ active: true, boot: 'boot-6' })
    await page.waitForTimeout(300)
    assert.equal(await count(), 5, 'hidden consumers do not discover')
    assert.equal(await count('/api/agents/availability'), 3)
    await page.evaluate(() => window.visibility(true))
    await page.waitForFunction(
      () =>
        window.requests.filter((item) => item.path === '/api/agents/models').length === 6 &&
        window.requests.filter((item) => item.path === '/api/agents/availability').length === 4,
    )
    const foreground = await page.evaluate(
      () => window.requests.findLast((item) => item.path === '/api/agents/models').id,
    )
    const foregroundAvailability = await page.evaluate(
      () => window.requests.findLast((item) => item.path === '/api/agents/availability').id,
    )
    await finish(foreground, catalog('Visible again'))
    await finish(foregroundAvailability, [{ id: 'selected', available: true }])
    await named('Visible again')
    await patch({ active: false })
    const noAgents = await next({ includeAgents: false }, '/api/agents/availability')
    await finish(noAgents, [{ id: 'harness:codex', available: true }])
    await page.waitForFunction(() => window.availability.available.includes('harness:codex'))
    const builtinGeneration = await next({ generation: 'launch-3' }, '/api/agents/availability')
    await finish(builtinGeneration, [{ id: 'harness:codex', available: true }])
    const otherInstall = await next({ otherVersion: '4' }, '/api/agents/availability')
    await finish(otherInstall, [{ id: 'harness:codex', available: true }])
    const otherRuntime = await next({ host: 'two' }, '/api/agents/availability')
    await finish(otherRuntime, [{ id: 'harness:codex', available: true }])
    await page.waitForFunction(() => window.availability.available.includes('harness:codex'))
    assert.equal(
      await count(),
      6,
      'availability covers builtins/installations even without configured agents',
    )
    assert.deepEqual(errors, [])
    console.log(
      `${platform}: persistence, stale hydration, visible demand, restart/account/config/install scope, late responses, empty/error retry, private-field stripping and live availability passed.`,
    )
    await context.close()
  }
} finally {
  await browser.close()
}
