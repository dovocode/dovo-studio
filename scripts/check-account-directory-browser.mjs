import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const SettingsChoice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import React,{useState} from 'react';import {internetPublicKey,sealInternet,peerAddress} from '${root}/packages/protocol/src/index.ts';import {createRoot} from 'react-dom/client';
import {AccountPanel as Desktop} from '${root}/packages/extension-runtime/src/account-panel';
import {PairingClient} from '${root}/packages/extension-runtime/src/pairing-client';
import {MobileAccountProvider,useMobileAccount} from '${root}/apps/mobile/src/runtime/connection/account-provider';
import {AccountPanel as Mobile} from '${root}/apps/mobile/src/runtime/connection/account-panel';
window.internetRequests=[];window.connects=[];window.boxSecret=new Uint8Array(32).fill(7);window.internetStatus={enabled:false,connected:false,error:''};window.syncSession=async session=>{window.session=session};window.runtimeRequest=async(path,body)=>{window.internetRequests.push({path,body});window.internetStatus={enabled:body.enabled,connected:body.enabled,error:''};window.hosted(body.enabled);return window.internetStatus};window.saved=null;window.calls=[];window.ready=false;window.unavailable=false;
window.sources=[{name:'Mac Studio',profile:{id:'local',name:'Mac Studio',connection:{address:'http://127.0.0.1:51464',token:'runtime-token-never-upload',runtimeId:'mac'}},snapshot:{runtimeId:'mac',releaseVersion:'0.0.9',releaseDistribution:'archive',releaseCanUpdate:true,runtimeHost:'mac',desktopApp:{version:'0.0.9',canUpdate:true},workspace:{tasks:[]},runs:[],runtimeAddresses:['http://lan:51464','http://vpn:51464']},connected:true}];
window.overviews=window.sources;
window.storage={read:async()=>window.saved,write:async token=>{window.saved=token}};
window.open=async url=>{window.browserOpened=url};window.host={accountStorage:window.storage,openExternalLink:window.open};
let servers=[{id:'server',name:'My Server',address:'http://server.internal:51464'}];window.hosted=enabled=>{servers=servers.filter(s=>s.id!=='internet');if(enabled)servers.push({id:'internet',name:'Internet Computer',address:'',internet:{publicKey:internetPublicKey(window.boxSecret),online:true}})};
window.fetch=async(url,init={})=>{const path=new URL(url).pathname;window.calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});if(new URL(url).hostname==='api.github.com')return Response.json(path.endsWith('/latest')?{tag_name:'v0.0.10',html_url:'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.10'}:[]);if(path.endsWith('/status'))return Response.json({status:'idle'});if(path==='/v1/internet/connections'){if(init.method==='POST'){const input=JSON.parse(init.body);if(window.holdInternet)return new Promise((_,reject)=>{window.internetHeld=true;init.signal.addEventListener('abort',()=>{window.internetAborted=true;reject(new DOMException('Aborted','AbortError'))},{once:true})});window.connectionRequest={runtimeId:input.runtimeId,id:'encrypted-request',publicKey:input.publicKey};return Response.json({id:'encrypted-request'})}const peer={origin:'https://connect.dovo.studio',secret:'f'.repeat(64)};return Response.json({publicKey:internetPublicKey(window.boxSecret),box:sealInternet({requestId:'encrypted-request',runtimeId:window.connectionRequest.runtimeId,connection:{address:peerAddress(peer),token:'internet-private-token-stays-on-device',peer,runtimeId:window.connectionRequest.runtimeId}},window.connectionRequest.publicKey,window.boxSecret,new Uint8Array(24).fill(8))})}if(window.unavailable)return Response.json({error:'unavailable'},{status:503});if(path==='/v1/login'&&init.method==='POST')return Response.json({token:'a'.repeat(43),code:'ABCD1234',url:'https://connect.dovo.studio/auth/start?id=test',expiresAt:Date.now()+300000});if(path==='/v1/login')return Response.json({ready:window.ready});if(path==='/v1/servers'&&init.method==='GET')return Response.json({user:{id:'person',name:'Dominic'},servers});if(init.method==='PUT')servers=servers.filter(server=>server.id!==JSON.parse(init.body).id).concat(JSON.parse(init.body));if(init.method==='DELETE'&&path.startsWith('/v1/servers/'))servers=servers.filter(server=>server.id!==decodeURIComponent(path.split('/').at(-1)));return Response.json({ok:true})};
function AccountProbe(){window.accountState=useMobileAccount();return null}function App(){const [address,setAddress]=useState('');return <><MobileAccountProvider><AccountProbe/><window.Panel onPair={setAddress}/>{window.Panel===Desktop&&<PairingClient onManage={profile=>window.managed=profile.id}/>}</MobileAccountProvider><input aria-label='Pairing address' value={address} readOnly/><p>Pairing code required</p></>}
const app=createRoot(document.getElementById('app'));window.renderApp=()=>app.render(<App key={window.kind}/>);window.show=kind=>{window.kind=kind;window.Panel=kind==='desktop'?Desktop:Mobile;window.renderApp()};window.show('desktop');
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
      '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '../preferences/app-preferences',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents:
        "export const useMobilePreferences=()=>({connectOrigin:'',artifactsOrigin:'',ready:true,computerRefresh:window.refreshMode??'normal'});",
    },
    {
      path: '@dovo/studio-core',
      contents: `export {useAccount} from '${root}/packages/studio-core/src/use-account';export const useAppPreferences=()=>({connectOrigin:'',artifactsOrigin:''});export const useStudioHost=()=>window.host;export const useRuntimeSources=()=>window.sources;export {responses,runtimeRequest,runtimeRequestEffect} from '@dovo/protocol';export {startPolling} from '@dovo/client-runtime';export const useWorkspace=()=>({runtimes:window.sources,mutationStatus:()=>({pending:0}),snapshot:{owner:true,internet:window.internetStatus},connected:true,request:window.runtimeRequest,activeRuntimeId:'local',runtimeRegistry:{profiles:window.sources.map(s=>s.profile)},refreshRuntime:async()=>{}});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${root}/packages/studio-ui/src/components/ui/dialog.tsx';export * from '${root}/packages/studio-ui/src/components/ui/input.tsx';export * from '${root}/packages/studio-ui/src/components/form-field.tsx';export {cn} from '${root}/packages/studio-ui/src/lib/utils.ts';export const MessageResponse=({children})=>children;export const ChoicePicker=({children,value,onValueChange,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;`,
    },
    {
      path: 'react-native',
      contents:
        controls +
        `const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};window.setAppState=state=>{AppState.currentState=state;for(const fn of listeners)fn(state)};export const Linking={openURL:url=>window.open(url)};export const Alert={alert:(title,message,buttons)=>{if(window.confirm(title+"\\n"+message))buttons.find(button=>button.style==='destructive').onPress();}};`,
    },
    {
      path: 'expo-network',
      contents: `export const getNetworkStateAsync=async()=>({type:window.networkType??'wifi'});export const NetworkStateType={CELLULAR:'cellular'};const listeners=new Set();export const addNetworkStateListener=fn=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)}};window.networkChanged=()=>{for(const fn of listeners)fn({isConnected:true})};`,
    },
    {
      path: 'expo-crypto',
      contents: `export const getRandomBytes=count=>crypto.getRandomValues(new Uint8Array(count));export const CryptoDigestAlgorithm={SHA256:'SHA-256'};export const digestStringAsync=async(algorithm,value)=>Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');`,
    },
    {
      path: './peer-transport',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: `export const preparePeerConnection=()=>{};`,
    },
    {
      path: 'expo-secure-store',
      contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=()=>window.storage.read();export const setItemAsync=(key,value)=>window.storage.write(value);export const deleteItemAsync=()=>window.storage.write(null);`,
    },
    {
      path: './provider',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: `export const useRuntime=()=>({mutationStatus:()=>({pending:0}),overviews:window.overviews,registryLoaded:true,recovering:false,recoverAccountConnection:async(previous,incoming,signal)=>{signal.throwIfAborted();window.recoveries??=[];window.recoveries.push({previous,incoming});window.overviews=window.overviews.map(entry=>entry.profile.id===previous.id?{...entry,connected:true,error:null,profile:{...entry.profile,connection:{...entry.profile.connection,internet:{address:incoming.address,token:incoming.token,peer:incoming.peer,runtimeId:incoming.runtimeId,session:incoming.accountSession}}}}:entry);window.renderApp()},syncAccountSession:window.syncSession,connect:async(connection,name)=>{window.connects.push({connection,name})}});`,
    },
    {
      path: '../../ui/content/text',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: controls,
    },
    {
      path: '../../screens/settings-controls',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: controls,
    },
    {
      path: '../../screens/settings-theme',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: `export const useSettingsTheme=()=>({styles:{}});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const kind of ['desktop', 'mobile']) {
    await page.evaluate((kind) => {
      window.ready = false
      window.show(kind)
    }, kind)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText(/Confirm code/).waitFor()
    assert.match(
      await page.evaluate(() => window.browserOpened),
      /^https:\/\/connect.dovo.studio\/auth\/start\?/,
    )
    await page.evaluate(() => (window.ready = true))
    await page.getByText('Signed in as Dominic', { exact: true }).waitFor()
    if (kind === 'desktop') {
      assert.equal(await page.getByText('My Server', { exact: true }).isVisible(), false)
      assert.equal(
        await page.getByText('Mac Studio', { exact: true }).filter({ visible: true }).count(),
        1,
      )
      assert.equal(
        await page.getByRole('heading', { name: 'Computer updates', exact: true }).count(),
        0,
      )
      assert.equal(
        await page.evaluate(() => window.calls.some((call) => call.path.includes('/releases'))),
        false,
      )
      await page.getByRole('button', { name: 'Computer updates', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Computer updates', exact: true })
      await dialog.getByRole('button', { name: 'Update all (2)', exact: true }).waitFor()
      assert.equal(
        await dialog
          .getByRole('checkbox', { name: 'Select Mac Studio for update', exact: true })
          .count(),
        2,
      )
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await page.getByText('Mac Studio', { exact: true }).filter({ visible: true }).count(),
        1,
      )
      await page.getByRole('button', { name: 'Manage Mac Studio', exact: true }).click()
      assert.equal(await page.evaluate(() => window.managed), 'local')
      await page.getByText('Manage linked computers', { exact: true }).click()
    } else {
      assert.equal(await page.getByText('My Server', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Manage linked computers', exact: true }).click()
      await page.getByRole('button', { name: 'Hide linked computers', exact: true }).click()
      assert.equal(await page.getByText('My Server', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Manage linked computers', exact: true }).click()
    }
    const pair = page.getByRole('button', {
      name: kind === 'desktop' ? 'Pair computer' : 'Pair My Server',
      exact: true,
    })
    await pair.click()
    assert.equal(
      await page.getByLabel('Pairing address').inputValue(),
      'http://server.internal:51464',
    )
    assert.equal(
      await page.evaluate(() => window.calls.some((call) => call.path.includes('/api/pair'))),
      false,
    )
    await page
      .getByLabel('Address for Mac Studio', { exact: true })
      .selectOption('http://vpn:51464')
    await page.getByRole('button', { name: 'Link Mac Studio to account', exact: true }).click()
    await page.getByText('Already paired', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.method === 'PUT').at(-1).body.address,
      ),
      'http://vpn:51464',
    )
    if (kind === 'desktop') {
      await page.getByText('Manage linked computers', { exact: true }).click()
      assert.equal(
        await page.getByText('Mac Studio', { exact: true }).filter({ visible: true }).count(),
        1,
      )
      await page.getByText('Manage linked computers', { exact: true }).click()
    }
    await page
      .getByRole('button', {
        name: kind === 'desktop' ? 'Unlink' : 'Unlink Mac Studio',
        exact: true,
      })
      .last()
      .click()
    await page.getByRole('button', { name: 'Link Mac Studio to account', exact: true }).waitFor()
    const requests = await page.evaluate(() => window.calls.filter((call) => call.method === 'PUT'))
    assert.equal(JSON.stringify(requests).includes('runtime-token-never-upload'), false)
    if (kind === 'desktop') {
      await page.getByRole('checkbox', { name: 'Enable Dovo Connect', exact: true }).check()
      await page.getByText(/Available to devices signed in to your account/).waitFor()
      assert.deepEqual(await page.evaluate(() => window.internetRequests[0]), {
        path: '/api/runtime/internet',
        body: {
          enabled: true,
          accountToken: 'a'.repeat(43),
          origin: 'https://connect.dovo.studio',
        },
      })
      await page.getByRole('checkbox', { name: 'Enable Dovo Connect', exact: true }).uncheck()
    } else {
      await page.evaluate(() => window.hosted(true))
      await page.getByRole('button', { name: 'Refresh linked computers', exact: true }).click()
      await page.getByRole('button', { name: 'Connect Internet Computer', exact: true }).click()
      await page.waitForFunction(() => window.connects.length === 1)
      const connected = await page.evaluate(() => window.connects[0])
      assert.equal(connected.connection.runtimeId, 'internet')
      assert.equal(connected.connection.token, 'internet-private-token-stays-on-device')
      assert.ok(connected.connection.accountSession)
      assert.equal(
        await page.evaluate(() =>
          window.calls.some((c) => JSON.stringify(c.body).includes('internet-private-token')),
        ),
        false,
      )
    }
    if (kind === 'mobile') {
      // The management list may be collapsed: saved computers still gain account fallback.
      await page.getByRole('button', { name: 'Hide linked computers', exact: true }).click()
      await page.evaluate(() => {
        window.overviews = [
          {
            ...window.sources[0],
            profile: {
              ...window.sources[0].profile,
              connection: { ...window.sources[0].profile.connection, runtimeId: 'internet' },
            },
          },
        ]
        window.renderApp()
      })
      await page.waitForFunction(() => window.recoveries?.length === 1)
      const recovery = await page.evaluate(() => window.recoveries[0])
      assert.equal(recovery.previous.id, 'local')
      assert.equal(recovery.incoming.runtimeId, 'internet')
      assert.equal(recovery.incoming.accountSession, await page.evaluate(() => window.session))
      // An expired internet credential renews automatically, retaining no-TURN consent.
      await page.evaluate(() => {
        window.overviews = window.overviews.map((entry) => ({
          ...entry,
          connected: false,
          error: 'Device not authorized',
          profile: {
            ...entry.profile,
            connection: {
              ...entry.profile.connection,
              internet: {
                ...entry.profile.connection.internet,
                token: 'expired-account-device-token',
                peer: { ...entry.profile.connection.internet.peer, relay: undefined },
              },
            },
          },
        }))
        window.renderApp()
      })
      await page.waitForFunction(() => window.recoveries.length === 2)
      assert.equal(await page.evaluate(() => window.recoveries[1].incoming.peer.relay), undefined)
      // Backgrounding suspends recovery; foregrounding retries the failed saved computer.
      await page.evaluate(() => {
        window.setAppState('background')
        window.overviews = window.overviews.map((entry) => ({
          ...entry,
          connected: false,
          error: 'Offline',
          profile: {
            ...entry.profile,
            connection: {
              ...entry.profile.connection,
              internet: {
                ...entry.profile.connection.internet,
                token: 'second-expired-device-token',
              },
            },
          },
        }))
        window.renderApp()
      })
      await page.evaluate(() => window.networkChanged())
      assert.equal(await page.evaluate(() => window.recoveries.length), 2)
      await page.evaluate(() => window.setAppState('active'))
      await page.waitForFunction(() => window.recoveries.length === 3)
      // Saved stale access also recovers after a provider restart.
      await page.evaluate(() => {
        window.overviews = window.overviews.map((entry) => ({
          ...entry,
          connected: false,
          error: 'Offline',
        }))
        window.kind = 'mobile-restarted'
        window.renderApp()
      })
      await page.waitForFunction(() => window.recoveries.length === 4)
      assert.equal(await page.evaluate(() => window.overviews.length), 1)
      // In-flight access requests are cancelled when the app backgrounds.
      await page.evaluate(() => {
        window.holdInternet = true
        window.overviews = window.overviews.map((entry) => ({
          ...entry,
          connected: false,
          error: 'Offline',
        }))
        window.renderApp()
      })
      await page.waitForFunction(() => window.internetHeld)
      await page.evaluate(() => window.setAppState('background'))
      await page.waitForFunction(() => window.internetAborted)
      assert.equal(await page.evaluate(() => window.recoveries.length), 4)
      await page.evaluate(() => {
        window.holdInternet = false
        window.setAppState('active')
      })
      await page.waitForFunction(() => window.recoveries.length === 5)
      // Refresh preferences suppress automatic recovery but preserve an explicit retry.
      for (const mode of ['manual', 'reduced']) {
        const before = await page.evaluate(() => window.recoveries.length)
        await page.evaluate((mode) => {
          window.refreshMode = mode
          window.networkType = 'cellular'
          window.overviews = window.overviews.map((entry) => ({
            ...entry,
            connected: false,
            error: 'Offline',
          }))
          window.renderApp()
        }, mode)
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        await page.evaluate(() => window.networkChanged())
        assert.equal(await page.evaluate(() => window.recoveries.length), before)
        await page.evaluate(() => window.accountState.retryRecovery())
        await page.waitForFunction((count) => window.recoveries.length === count, before + 1)
      }
      await page.evaluate(() => {
        window.refreshMode = 'normal'
        window.networkType = 'wifi'
        window.renderApp()
      })
      // Signing out also aborts pending renewal instead of saving old account access.
      await page.evaluate(() => {
        window.holdInternet = true
        window.internetHeld = false
        window.internetAborted = false
        window.overviews = window.overviews.map((entry) => ({
          ...entry,
          connected: false,
          error: 'Offline',
        }))
        window.renderApp()
      })
      await page.waitForFunction(() => window.internetHeld)
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.saved), null)
    if (kind === 'mobile') {
      await page.waitForFunction(() => window.internetAborted)
      assert.equal(await page.evaluate(() => window.recoveries.length), 7)
      await page.evaluate(() => {
        window.holdInternet = false
        window.overviews = window.sources
      })
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Signed in as Dominic', { exact: true }).waitFor()
    if (kind === 'mobile')
      assert.equal(await page.getByText('My Server', { exact: true }).count(), 0)
    const beforeDeletion = await page.evaluate(
      () => window.calls.filter((call) => call.path === '/v1/account').length,
    )
    if (kind === 'desktop') {
      await page.getByRole('button', { name: 'Delete account', exact: true }).click()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((call) => call.path === '/v1/account').length,
        ),
        beforeDeletion,
      )
      await page.getByRole('button', { name: 'Delete account', exact: true }).click()
      await page.getByRole('button', { name: 'Delete account permanently', exact: true }).click()
    } else {
      page.once('dialog', (dialog) => dialog.dismiss())
      await page.getByRole('button', { name: 'Delete account', exact: true }).click()
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((call) => call.path === '/v1/account').length,
        ),
        beforeDeletion,
      )
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: 'Delete account', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.saved), null)
    assert.equal(
      await page.evaluate(() => window.calls.filter((call) => call.path === '/v1/account').length),
      beforeDeletion + 1,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop computer list; desktop/mobile collapsed account directories, optional accounts, private metadata linking, pairing discovery, encrypted account setup, automatic saved-access recovery, relay opt-out, restart recovery, cancellation, sign-out and confirmed account deletion passed.',
  )
} finally {
  await browser.close()
}
