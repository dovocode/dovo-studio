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
import {MobileAccountProvider} from '${root}/apps/mobile/src/runtime/connection/account-provider';
import {AccountPanel as Mobile} from '${root}/apps/mobile/src/runtime/connection/account-panel';
window.internetRequests=[];window.connects=[];window.boxSecret=new Uint8Array(32).fill(7);window.internetStatus={enabled:false,connected:false,error:''};window.syncSession=async session=>{window.session=session};window.runtimeRequest=async(path,body)=>{window.internetRequests.push({path,body});window.internetStatus={enabled:body.enabled,connected:body.enabled,error:''};window.hosted(body.enabled);return window.internetStatus};window.saved=null;window.calls=[];window.ready=false;window.unavailable=false;
window.sources=[{name:'Mac Studio',profile:{id:'local',name:'Mac Studio',connection:{address:'http://127.0.0.1:51464',token:'runtime-token-never-upload',runtimeId:'mac'}},snapshot:{runtimeId:'mac',releaseVersion:'0.0.9',releaseDistribution:'archive',releaseCanUpdate:true,runtimeHost:'mac',desktopApp:{version:'0.0.9',canUpdate:true},workspace:{tasks:[]},runs:[],runtimeAddresses:['http://lan:51464','http://vpn:51464']},connected:true}];
window.overviews=window.sources;
window.storage={read:async()=>window.saved,write:async token=>{window.saved=token}};
window.open=async url=>{window.browserOpened=url};window.host={accountStorage:window.storage,openExternalLink:window.open};
let servers=[{id:'server',name:'My Server',address:'http://server.internal:51464'}];window.hosted=enabled=>{servers=servers.filter(s=>s.id!=='internet');if(enabled)servers.push({id:'internet',name:'Internet Computer',address:'',internet:{publicKey:internetPublicKey(window.boxSecret),online:true}})};
window.fetch=async(url,init={})=>{const path=new URL(url).pathname;window.calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});if(new URL(url).hostname==='api.github.com')return Response.json(path.endsWith('/latest')?{tag_name:'v0.0.10',html_url:'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.10'}:[]);if(path.endsWith('/status'))return Response.json({status:'idle'});if(path==='/v1/internet/connections'){if(init.method==='POST'){const input=JSON.parse(init.body);window.connectionRequest={id:'encrypted-request',publicKey:input.publicKey};return Response.json({id:'encrypted-request'})}const peer={origin:'https://connect.dovo.studio',secret:'f'.repeat(64)};return Response.json({publicKey:internetPublicKey(window.boxSecret),box:sealInternet({requestId:'encrypted-request',runtimeId:'internet',connection:{address:peerAddress(peer),token:'internet-private-token-stays-on-device',peer,runtimeId:'internet'}},window.connectionRequest.publicKey,window.boxSecret,new Uint8Array(24).fill(8))})}if(window.unavailable)return Response.json({error:'unavailable'},{status:503});if(path==='/v1/login'&&init.method==='POST')return Response.json({token:'a'.repeat(43),code:'ABCD1234',url:'https://connect.dovo.studio/auth/start?id=test',expiresAt:Date.now()+300000});if(path==='/v1/login')return Response.json({ready:window.ready});if(path==='/v1/servers'&&init.method==='GET')return Response.json({user:{id:'person',name:'Dominic'},servers});if(init.method==='PUT')servers=servers.filter(server=>server.id!==JSON.parse(init.body).id).concat(JSON.parse(init.body));if(init.method==='DELETE'&&path.startsWith('/v1/servers/'))servers=servers.filter(server=>server.id!==decodeURIComponent(path.split('/').at(-1)));return Response.json({ok:true})};
function App(){const [address,setAddress]=useState('');return <><MobileAccountProvider><window.Panel onPair={setAddress}/>{window.Panel===Desktop&&<PairingClient onManage={profile=>window.managed=profile.id}/>}</MobileAccountProvider><input aria-label='Pairing address' value={address} readOnly/><p>Pairing code required</p></>}
const app=createRoot(document.getElementById('app'));window.show=kind=>{window.Panel=kind==='desktop'?Desktop:Mobile;app.render(<App key={kind}/>)};window.show('desktop');
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
      path: '@dovo/studio-core',
      contents: `export {useAccount} from '${root}/packages/studio-core/src/use-account';export const useStudioHost=()=>window.host;export const useRuntimeSources=()=>window.sources;export {responses,runtimeRequest,runtimeRequestEffect} from '@dovo/protocol';export {startPolling} from '@dovo/client-runtime';export const useWorkspace=()=>({runtimes:window.sources,mutationStatus:()=>({pending:0}),snapshot:{owner:true,internet:window.internetStatus},connected:true,request:window.runtimeRequest,activeRuntimeId:'local',runtimeRegistry:{profiles:window.sources.map(s=>s.profile)},refreshRuntime:async()=>{}});`,
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
        `export const Linking={openURL:url=>window.open(url)};export const Alert={alert:(title,message,buttons)=>{if(window.confirm(title+"\\n"+message))buttons.find(button=>button.style==='destructive').onPress();}};`,
    },
    {
      path: 'expo-crypto',
      contents: `export const getRandomBytes=count=>crypto.getRandomValues(new Uint8Array(count));`,
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
      contents: `export const useRuntime=()=>({overviews:window.overviews,registryLoaded:true,syncAccountSession:window.syncSession,connect:async(connection,name)=>{window.connects.push({connection,name})}});`,
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
        body: { enabled: true, accountToken: 'a'.repeat(43) },
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
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.saved), null)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Signed in as Dominic', { exact: true }).waitFor()
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
    'Desktop computer list, deferred update dialog, collapsed account directory; desktop/mobile optional accounts: browser confirmation, secure storage adapters, private metadata linking, discovery into pairing, encrypted account internet setup without pairing, owner checkbox, no plaintext runtime credentials in Connect requests, sign-out, and confirmed account deletion with cancellation passed.',
  )
} finally {
  await browser.close()
}
