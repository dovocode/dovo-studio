import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const native = root + '/apps/mobile/src/runtime/connection'
const desktop = root + '/packages/extension-runtime/src'
const controls = `export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {internetPublicKey,sealInternet,peerAddress} from '@dovo/protocol';
import {ConnectSettings as Desktop} from '${desktop}/connect-settings';
import {ConnectSettings as Mobile} from '${native}/connect-settings';
window.writes=[];window.calls=[];window.connected=true;window.supported=true;window.enabled=false;window.signedIn=true;window.fail=false;window.refreshes=[];window.connects=[];window.secret=new Uint8Array(32).fill(7);
window.storage={read:async()=>window.signedIn?'a'.repeat(43):null,write:async()=>{}};window.open=async()=>{};
const profile={id:'paired-b',name:'Server B',connection:{address:'http://server-b.vpn:51464',token:'paired-b-secret',runtimeId:'server-b'}};
window.scope=()=>({profile,snapshot:{runtimeId:'server-b',owner:false,internetSetupSupported:window.supported,internet:{enabled:window.enabled,connected:window.enabled,error:''}},connected:window.connected,activeRuntimeId:'paired-b',runtimeRegistry:{profiles:[profile]},request:window.request,call:window.request,refreshRuntime:async p=>{window.refreshes.push(p.id);window.render()},refresh:async()=>{window.refreshes.push('paired-b');window.render()},connect:async connection=>window.connects.push(connection)});
window.request=async(path,input)=>{window.writes.push({target:'paired-b',path,input});if(window.fail)throw Error('Server B rejected setup');if(path.endsWith('/setup'))return {id:'setup-b',registration:{id:'server-b',name:'Server B',identity:'installation-b',publicKey:internetPublicKey(window.secret),timestamp:Date.now(),signature:'proof-b'}};window.enabled=true;return {enabled:true,connected:true,error:''}};
window.fetch=async(url,init)=>{const path=new URL(url).pathname;window.calls.push({path,authorization:new Headers(init.headers).get('Authorization'),input:init.body?JSON.parse(init.body):null});if(path==='/v1/servers')return Response.json({user:{id:'owner',name:'Dominic'},servers:window.enabled?[{id:'server-b',name:'Server B',address:'',internet:{publicKey:internetPublicKey(window.secret),online:true}}]:[]});if(path==='/v1/internet/hosts')return Response.json({grant:'scoped-grant-b'});if(path==='/v1/internet/connections'){if(init.method==='POST'){window.clientKey=JSON.parse(init.body).publicKey;return Response.json({id:'connection-b'})}const peer={origin:'https://connect.dovo.studio',secret:'f'.repeat(64),relay:'dovo'};return Response.json({publicKey:internetPublicKey(window.secret),box:sealInternet({requestId:'connection-b',runtimeId:'server-b',connection:{address:peerAddress(peer),runtimeId:'server-b',peer,token:'account-b-private-token-123456789'}},window.clientKey,window.secret,new Uint8Array(24).fill(8))})}return Response.json({ok:true})};
const app=createRoot(document.getElementById('app'));window.kind='desktop';window.key=0;window.render=()=>flushSync(()=>app.render(window.kind==='desktop'?<Desktop key={window.key}/>:<Mobile key={window.key}/>));window.reset=kind=>{window.kind=kind;window.key++;window.enabled=false;window.fail=false;window.approve=false;window.connected=true;window.supported=true;window.writes=[];window.calls=[];window.refreshes=[];window.render()};window.reset('desktop');
`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {useAccount} from '${root}/packages/studio-core/src/use-account';export const useWorkspace=()=>window.scope();export const useStudioHost=()=>({accountStorage:window.storage,openExternalLink:window.open});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Button=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;`,
    },
    {
      path: './provider',
      importer: native,
      contents: `export const useRuntime=()=>window.scope();`,
    },
    {
      path: './account-provider',
      importer: native,
      contents: `import {useAccount} from '${root}/packages/studio-core/src/use-account';export const useMobileAccount=()=>useAccount(window.storage,window.open);`,
    },
    {
      path: 'react-native',
      contents:
        controls +
        `export const Alert={alert:(title,message,buttons)=>{window.consent={title,message};if(window.approve)buttons.find(b=>b.text==='Enable Connect + relay').onPress()}};`,
    },
    {
      path: 'expo-crypto',
      contents: `export const getRandomBytes=n=>crypto.getRandomValues(new Uint8Array(n));`,
    },
    {
      path: './peer-transport',
      importer: native,
      contents: `export const preparePeerConnection=()=>{};`,
    },
    {
      path: '../../ui/controls/use-action',
      importer: native,
      contents: `import {useState,useRef} from 'react';export const useAction=()=>{const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);return {busy,error,act:work=>{if(pending.current)return;pending.current=true;setBusy(true);void work().catch(e=>setError(e.message)).finally(()=>{pending.current=false;setBusy(false)})}}};`,
    },
    { path: '../../ui/controls/action', importer: native, contents: controls },
    { path: '../../ui/content/text', importer: native, contents: controls },
    {
      path: '../../ui/theme',
      importer: native,
      contents: `export const useTheme=()=>({styles:{}});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const kind of ['desktop', 'mobile']) {
    await page.evaluate((kind) => window.reset(kind), kind)
    const enable = page.getByRole('button', { name: 'Enable Dovo Connect + relay', exact: true })
    await enable.waitFor()
    await enable.click()
    if (kind === 'desktop') {
      await page.getByText(/Enable Dovo Connect on Server B for Dominic/).waitFor()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    } else {
      assert.match(await page.evaluate(() => window.consent.title), /Server B/)
      assert.match(
        await page.evaluate(() => window.consent.message),
        /Dominic.*files, agents and terminal commands.*TURN/s,
      )
    }
    assert.equal(await page.evaluate(() => window.writes.length), 0)
    await page.evaluate(() => {
      window.connected = false
      window.render()
    })
    assert.equal(await enable.isDisabled(), true)
    await page.evaluate(() => {
      window.connected = true
      window.fail = true
      window.approve = true
      window.render()
    })
    await enable.click()
    if (kind === 'desktop')
      await page.getByRole('button', { name: 'Confirm Connect + relay', exact: true }).click()
    await page.getByText('Server B rejected setup', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.enabled), false)
    await page.evaluate(() => {
      window.fail = false
    })
    if (kind === 'desktop')
      await page.getByRole('button', { name: 'Confirm Connect + relay', exact: true }).click()
    else await enable.click()
    await page.getByText(/Enabled · Online/).waitFor()
    const writes = await page.evaluate(() => window.writes)
    assert.ok(writes.every((w) => w.target === 'paired-b'))
    assert.deepEqual(writes.at(-2).input, {
      session: writes.at(-2).input.session,
      consent: true,
      relay: 'dovo',
    })
    assert.match(writes.at(-2).input.session, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(JSON.stringify(writes).includes('a'.repeat(43)), false)
    assert.deepEqual(writes.at(-1).input, { id: 'setup-b', grant: 'scoped-grant-b' })
    const calls = await page.evaluate(() => window.calls)
    assert.ok(
      calls.some(
        (c) => c.path === '/v1/internet/hosts' && c.authorization === 'Bearer ' + 'a'.repeat(43),
      ),
    )
    assert.ok((await page.evaluate(() => window.refreshes)).every((id) => id === 'paired-b'))
    if (kind === 'mobile') {
      await page
        .waitForFunction(() => window.connects.length === 1, undefined, { timeout: 5000 })
        .catch(async (error) => {
          console.error(await page.locator('body').innerText())
          throw error
        })
      assert.equal(await page.evaluate(() => window.connects[0].runtimeId), 'server-b')
      assert.equal(await page.evaluate(() => window.connects[0].peer.relay), 'dovo')
    }
    await page.evaluate(() => {
      window.enabled = false
      window.supported = undefined
      window.render()
    })
    await page.getByText(/Update Dovo on this computer/).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Enable Dovo Connect + relay', exact: true }).count(),
      0,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Paired Connect desktop/mobile: confirmation, target scope, token isolation, offline, failure/retry, compatibility and mobile account fallback passed',
  )
} finally {
  await browser.close()
}
