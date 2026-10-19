import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const SettingsChoice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AccountPanel as Desktop} from '${root}/packages/extension-runtime/src/account-panel';
import {MobileAccountProvider} from '${root}/apps/mobile/src/runtime/connection/account-provider';
import {AccountPanel as Mobile} from '${root}/apps/mobile/src/runtime/connection/account-panel';
window.saved=null;window.calls=[];window.ready=false;window.unavailable=false;
window.sources=[{name:'Mac Studio',profile:{id:'local',name:'Mac Studio',connection:{address:'http://127.0.0.1:51464',token:'runtime-token-never-upload',runtimeId:'mac'}},snapshot:{runtimeId:'mac',runtimeAddresses:['http://lan:51464','http://vpn:51464']},connected:true}];
window.overviews=window.sources;
window.storage={read:async()=>window.saved,write:async token=>{window.saved=token}};
window.open=async url=>{window.browserOpened=url};window.host={accountStorage:window.storage,openExternalLink:window.open};
let servers=[{id:'server',name:'My Server',address:'http://server.internal:51464'}];
window.fetch=async(url,init)=>{const path=new URL(url).pathname;window.calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});if(window.unavailable)return Response.json({error:'unavailable'},{status:503});if(path==='/v1/login'&&init.method==='POST')return Response.json({token:'a'.repeat(43),code:'ABCD1234',url:'https://connect.dovo.studio/auth/start?id=test',expiresAt:Date.now()+300000});if(path==='/v1/login')return Response.json({ready:window.ready});if(path==='/v1/servers'&&init.method==='GET')return Response.json({user:{id:'person',name:'Dominic'},servers});if(init.method==='PUT')servers=servers.filter(server=>server.id!==JSON.parse(init.body).id).concat(JSON.parse(init.body));if(init.method==='DELETE'&&path.startsWith('/v1/servers/'))servers=servers.filter(server=>server.id!==decodeURIComponent(path.split('/').at(-1)));return Response.json({ok:true})};
function App(){const [address,setAddress]=useState('');return <><MobileAccountProvider><window.Panel onPair={setAddress}/></MobileAccountProvider><input aria-label='Pairing address' value={address} readOnly/><p>Pairing code required</p></>}
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
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {useAccount} from '${root}/packages/studio-core/src/use-account';export const useStudioHost=()=>window.host;export const useRuntimeSources=()=>window.sources;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const ChoicePicker=({children,value,onValueChange,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;`,
    },
    {
      path: 'react-native',
      contents:
        controls +
        `export const Linking={openURL:url=>window.open(url)};export const Alert={alert:(title,message,buttons)=>{if(window.confirm(title+"\\n"+message))buttons.find(button=>button.style==='destructive').onPress();}};`,
    },
    {
      path: 'expo-secure-store',
      contents: `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='private';export const getItemAsync=()=>window.storage.read();export const setItemAsync=(key,value)=>window.storage.write(value);export const deleteItemAsync=()=>window.storage.write(null);`,
    },
    {
      path: './provider',
      importer: root + '/apps/mobile/src/runtime/connection',
      contents: `export const useRuntime=()=>({overviews:window.overviews});`,
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
    await page.getByLabel('Address for Mac Studio').selectOption('http://vpn:51464')
    await page.getByRole('button', { name: 'Link Mac Studio to account', exact: true }).click()
    await page.getByText('Already paired', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.method === 'PUT').at(-1).body.address,
      ),
      'http://vpn:51464',
    )
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
    'Desktop/mobile optional accounts: browser confirmation, secure storage adapters, private metadata linking, discovery into pairing, no runtime credentials or automatic pairing, sign-out, and confirmed account deletion with cancellation passed.',
  )
} finally {
  await browser.close()
}
