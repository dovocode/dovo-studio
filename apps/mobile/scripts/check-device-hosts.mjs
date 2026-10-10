import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const mocks = {
  'expo-router': 'export const router={push:path=>window.settingsRoute=path};',
  'react-native': `
    export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
    export const Image=View;export const Platform={OS:"web"};
    export const ScrollView=View;
    export const Alert={alert:(title,message,actions)=>actions.find(action=>action.style==='destructive')?.onPress()};
  `,
  'expo-crypto': `export const randomUUID=()=> 'host-new';`,
  '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../ui/content/text': `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title})=><h1>{title}</h1>;`,
  '../ui/controls/switch': `export const Switch=({value,onValueChange,disabled,accessibilityLabel})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;`,
  './settings-theme': `export const useSettingsTheme=()=>({styles:{}});export const SettingsPage=({children})=>children;export const SettingsSheet=({children,onClose})=><div>{children}<button onClick={onClose}>Close actions</button></div>;`,
  './settings-controls': `
    export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
    export const SettingsField=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/></label>;
    export const SettingsChoice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  `,
  './settings-group': `export const SettingsGroup=({children,title})=><section><h2>{title}</h2>{children}</section>;export const SettingsRow=({title,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{title}</button>;`,
}

Object.assign(mocks, {
  '../../ui/controls/switch': mocks['../ui/controls/switch'],
  '../../runtime/connection/provider': mocks['../runtime/connection/provider'],
  '../../runtime/state/application-state': mocks['../runtime/state/application-state'],
  '../../ui/content/text': mocks['../ui/content/text'],
  '../../screens/settings-theme': mocks['./settings-theme'],
  '../../screens/settings-controls': mocks['./settings-controls'],
  '../../ui/theme': `export const useTheme=()=>({styles:{},colors:{}});`,
  '../../ui/controls/action': mocks['./settings-controls'] + 'export const Action=SettingsAction;',
  '../../ui/controls/field': mocks['./settings-controls'] + 'export const Field=SettingsField;',
  '../../ui/controls/choice': mocks['./settings-controls'] + 'export const Choice=SettingsChoice;',
  '../../ui/controls/icon-button': `export const IconButton=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/use-action': `import {useRef,useState} from 'react';import {Effect} from 'effect';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);return {busy,error,act:work=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');Promise.resolve().then(work).then(result=>Effect.isEffect(result)?Effect.runPromise(result):result).catch(error=>setError(error.message)).finally(()=>{lock.current=false;setBusy(false)})}}}`,
  '../../runtime/state/native-effect': `import {Effect} from 'effect';export const mobileWorkflow=Effect.gen;export const nativeEffect=work=>Effect.tryPromise({try:()=>Promise.resolve(work()),catch:error=>error});`,
  '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
  '../../ui/content/open-link': `export const openAppLink=async()=>{};`,
  'react-native-webview': `export const WebView=()=>null;`,
  './remote-browser': `export const RemoteBrowser=props=>{window.liveDeviceProps=props;return <div>Live device</div>};`,
  './physical-controls': `export const PhysicalControls=()=> <div>Physical iOS controls</div>;`,
})

const result = await build({
  stdin: {
    contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {DeviceHostSettings} from './src/screens/device-host-settings';
      import {DevicesPane} from './src/tasks/preview/browser-pane';
      import {Effect} from 'effect';
      const profile={id:'current',name:'Current runtime',connection:{address:'http://runtime-a:3000',token:'current-secret-123456789'}};
      const destination={id:'remote',name:'Mac mini',connection:{address:'http://mac-mini:3000',token:'destination-secret-123456789'}};
      let settings={hosts:[],revision:0};window.operations=[];window.failRead=false;window.deferTest=false;
      const request=async(path,input,schema,method)=>{
        window.operations.push({path,input,method});
        if(path==='/api/previews/devices')return {devices:window.previewDevices,diagnostics:[],host:'runtime-a'};
        if(path==='/api/previews/action'||path==='/api/device-hosts/forward/stop')return {ok:true};
        if(path==='/api/device-hosts/install'){if(window.installFailure)throw new Error('Install failed destination-secret-123456789');return {ok:true}}
        if(path==='/api/device-hosts/forward')return {ok:true,id:'forward-1',url:'http://127.0.0.1:4000',expiresAt:new Date(Date.now()+600000).toISOString()};
        if(method==='GET'){if(window.failRead)throw new Error('Cannot load hosts');return structuredClone(settings)}
        if(path.endsWith('/test')){if(window.testFailure)return {ok:false,checks:[{name:'Pairing',ok:false,message:'Pairing failed destination-secret-123456789'}]};if(window.deferTest)return new Promise(resolve=>window.finishTest=()=>resolve({ok:true,checks:[{name:'SSH',ok:true,message:'Ready'}]}));return {ok:true,checks:[{name:'SSH',ok:true,message:'Ready'},{name:'devices',ok:false,message:'No devices connected'}]}}
        if(input.revision!==settings.revision)throw new Error('Settings changed elsewhere');
        settings={...input,revision:settings.revision+1,hosts:input.hosts.map(({token,...host})=>({...host,hasToken:!!token || !!settings.hosts.find(saved=>saved.id===host.id)?.hasToken}))};
        return structuredClone(settings);
      };
      window.runtime={profile,profiles:[profile,destination],connected:true,read:request,call:request};
      window.runtime.callEffect=(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error});
      window.previewDevices=[
        {id:'remote:host-ios:ios:uuid',hostId:'host-ios',hostName:'Mac devices',name:'iPhone simulator',platform:'ios',kind:'simulator',state:'booted',runtime:'ios'},
        {id:'remote:host-android:android:avd',hostId:'host-android',hostName:'Android host',name:'Pixel emulator',platform:'android',kind:'simulator',state:'stopped',runtime:'android'},
        {id:'remote:host-ios:physical-ios:phone',hostId:'host-ios',hostName:'Mac devices',name:'USB iPhone',platform:'ios',kind:'physical',state:'booted',runtime:'ios'},
        {id:'remote:host-android:physical-android:phone',hostId:'host-android',hostName:'Android host',name:'USB Pixel',platform:'android',kind:'physical',state:'booted',runtime:'android'},
      ];
      const root=createRoot(document.getElementById('app'));window.render=()=>root.render(window.screen==='previews'?<DevicesPane taskId='task-1' expanded={false} onExpand={()=>{}}/>:<DeviceHostSettings/>);
      window.setHub=enabled=>{settings.enabled=enabled};window.changeRemote=()=>{settings.hosts[0].name='Changed elsewhere';settings.revision++};window.render();
    `,
    resolveDir: root + 'apps/mobile/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          if (Object.hasOwn(mocks, path)) return { path, namespace: 'mock' }
          if (path === '@dovo/protocol') return { path: root + 'packages/protocol/src/index.ts' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'apps/mobile/',
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const button = (name) => page.getByRole('button', { name, exact: true })
  await page.getByLabel('Enable Device Hub').waitFor()
  assert.equal(await page.getByLabel('Enable Device Hub').isChecked(), false)
  assert.equal(await button('Add device host').count(), 0)
  await page.getByLabel('Enable Device Hub').check()
  await button('Add device host').click()
  await page.getByLabel('Device host name').fill('Remote Mac')
  await page.getByLabel('Paired destination computer').selectOption('remote')
  await page.getByLabel('SSH host', { exact: true }).fill('mac-mini.local')
  await page.getByLabel('SSH user', { exact: true }).fill('dominic')
  assert.equal(await page.getByLabel('Allow agent access to device host').isChecked(), false)
  assert.equal(await button('Save device host').isDisabled(), true)
  await page.evaluate(() => {
    window.testFailure = true
  })
  await button('Test connection & readiness').click()
  await page.getByText('Pairing failed [redacted]', { exact: true }).waitFor()
  assert.equal(await button('Save device host').isDisabled(), true)
  await page.evaluate(() => {
    window.testFailure = false
  })
  await button('Test connection & readiness').click()
  await button('Save device host').waitFor({ state: 'visible' })
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save device host',
      ).disabled,
  )
  await page.getByLabel('Enable Device Hub').uncheck()
  await page.getByLabel('Device host name').waitFor({ state: 'hidden' })
  await page.getByLabel('Enable Device Hub').check()
  assert.equal(await page.getByLabel('Device host name').inputValue(), 'Remote Mac')
  assert.equal(await button('Save device host').isDisabled(), false)
  await page.getByLabel('SSH port').fill('2222')
  assert.equal(await button('Save device host').isDisabled(), true)
  await button('Test connection & readiness').click()
  await button('Save device host').click()
  await button('Remote Mac').waitFor()
  const saved = await page.evaluate(
    () =>
      window.operations
        .filter((op) => op.path === '/api/device-hosts' && op.method !== 'GET')
        .at(-1).input,
  )
  assert.equal(saved.enabled, true)
  assert.equal(saved.revision, 3)
  assert.equal(saved.hosts[0].token, 'destination-secret-123456789')
  assert.equal(saved.hosts[0].sshPort, 2222)
  assert.equal(saved.hosts[0].agentAccess, false)
  assert.equal((await page.locator('body').innerText()).includes('destination-secret'), false)
  await page.getByLabel('Default device host').selectOption('host-new')
  await page.waitForFunction(() =>
    window.operations.some((op) => op.input?.defaultHostId === 'host-new'),
  )
  await page.getByLabel('Enable Device Hub').uncheck()
  assert.equal(await button('Remote Mac').count(), 0)
  await page.getByLabel('Enable Device Hub').check()
  await button('Remote Mac').waitFor()
  assert.equal(await page.getByLabel('Default device host').inputValue(), 'host-new')
  const toggled = await page.evaluate(
    () =>
      window.operations
        .filter((op) => op.path === '/api/device-hosts' && op.method !== 'GET')
        .at(-1).input,
  )
  assert.equal(toggled.hosts[0].name, 'Remote Mac')
  assert.equal(toggled.enabled, true)
  assert.equal(toggled.hosts[0].token, undefined)
  await button('Remote Mac').click()
  await page.getByLabel('Device host name').fill('My draft')
  await button('Test connection & readiness').click()
  await page.evaluate(() => window.changeRemote())
  await button('Save device host').click()
  await page.getByText('Device hosts changed elsewhere.', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Device host name').inputValue(), 'My draft')
  assert.equal(await button('Save device host').isDisabled(), true)
  // A late successful readiness result after disconnect must not enable save.
  await page.evaluate(() => {
    window.deferTest = true
  })
  await button('Test connection & readiness').click()
  assert.equal(await page.getByLabel('SSH host', { exact: true }).isDisabled(), true)
  await page.evaluate(() => {
    window.runtime.connected = false
    window.render()
  })
  await page.getByText('This computer is offline.', { exact: false }).waitFor()
  await page.evaluate(() => window.finishTest())
  await page.evaluate(() => {
    window.runtime.connected = true
    window.deferTest = false
    window.render()
  })
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('input')].find(
        (input) => input.getAttribute('aria-label') === 'SSH host',
      ).disabled,
  )
  assert.equal(await button('Save device host').isDisabled(), true)
  assert.equal(await page.getByLabel('Device host name').inputValue(), 'My draft')
  await button('Cancel editing').click()
  await button('Changed elsewhere').click()
  await button('Remove device host').click()
  await page.getByText('No remote device hosts yet.', { exact: false }).waitFor()
  const removed = await page.evaluate(
    () =>
      window.operations
        .filter((op) => op.path === '/api/device-hosts' && op.method !== 'GET')
        .at(-1).input,
  )
  assert.deepEqual(removed.hosts, [])
  assert.equal(removed.defaultHostId, undefined)
  await page.evaluate(() => {
    window.failRead = true
    window.runtime.connected = false
    window.render()
  })
  await page.getByText('This computer is offline.', { exact: false }).waitFor()
  await page.evaluate(() => {
    window.runtime.connected = true
    window.render()
  })
  await page.getByText('Cannot load hosts', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.failRead = false
  })
  await button('Retry device host settings').click()
  await button('Add device host').waitFor()
  await page.evaluate(() => {
    window.setHub(false)
    window.screen = 'previews'
    window.render()
  })
  await button('Enable in Device previews settings').waitFor()
  assert.equal(
    await page.evaluate(
      () => window.operations.filter((op) => op.path === '/api/previews/devices').length,
    ),
    0,
  )
  await button('Enable in Device previews settings').click()
  assert.equal(await page.evaluate(() => window.settingsRoute), '/settings/device-hosts')
  await page.evaluate(() => window.setHub(true))
  await button('Refresh devices').click()
  await page.waitForFunction(() =>
    window.operations.some((op) => op.path === '/api/previews/devices'),
  )
  const discovery = await page.evaluate(() =>
    window.operations.findIndex((op) => op.path === '/api/previews/devices'),
  )
  assert.equal(
    await page.evaluate((index) => window.operations[index - 1].path, discovery),
    '/api/device-hosts',
  )
  const ios = page.getByTestId('Simulator remote:host-ios:ios:uuid')
  const android = page.getByTestId('Simulator remote:host-android:android:avd')
  const phone = page.getByTestId('Simulator remote:host-android:physical-android:phone')
  await ios.waitFor()
  assert.match(await ios.innerText(), /Mac devices/)
  assert.match(await android.innerText(), /Android emulator/)
  assert.equal(await phone.getByRole('button', { name: 'Device controls' }).count(), 0)
  assert.equal(await phone.getByRole('button', { name: 'Start', exact: true }).count(), 0)
  await android.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => window.operations.some((op) => op.input?.action === 'boot'))
  const boot = await page.evaluate(
    () => window.operations.find((op) => op.input?.action === 'boot').input,
  )
  assert.equal(boot.id, 'remote:host-android:android:avd')
  assert.equal(boot.hostId, 'host-android')
  await ios.getByRole('button', { name: 'Live preview', exact: true }).click()
  await page.getByText('Live device', { exact: true }).waitFor()
  const live = await page.evaluate(() => window.liveDeviceProps)
  assert.equal(live.deviceId, 'remote:host-ios:ios:uuid')
  assert.equal(live.devicePlatform, 'ios')
  await button('Back to devices').click()
  await ios.getByRole('button', { name: 'Install app / URL forwards', exact: true }).click()
  await page.getByLabel('Build artifact path in task checkout').fill('build/Simulator.app')
  await page.evaluate(() => {
    window.installFailure = true
  })
  await button('Install app on device').click()
  await page.getByText('Install failed [redacted]', { exact: true }).waitFor()
  assert.equal((await page.locator('body').innerText()).includes('destination-secret'), false)
  await page.evaluate(() => {
    window.installFailure = false
  })
  await button('Install app on device').click()
  await page.getByText('Installed on iPhone simulator.', { exact: true }).waitFor()
  const install = await page.evaluate(
    () => window.operations.find((op) => op.path === '/api/device-hosts/install').input,
  )
  assert.equal(install.id, 'remote:host-ios:ios:uuid')
  assert.equal(install.hostId, 'host-ios')
  assert.equal(install.artifactPath, 'build/Simulator.app')
  await page.getByLabel('Server port on current runtime').fill('3000')
  await page.getByLabel('Listening port on destination host').fill('4000')
  await button('Start URL forward').click()
  await button('Use forwarded preview URL').click()
  assert.equal(await page.getByLabel('Preview URL').inputValue(), 'http://127.0.0.1:4000')
  await ios.getByRole('button', { name: 'Open URL', exact: true }).click()
  await page.waitForFunction(() => window.operations.some((op) => op.input?.action === 'open'))
  const opened = await page.evaluate(
    () => window.operations.find((op) => op.input?.action === 'open').input,
  )
  assert.equal(opened.url, 'http://127.0.0.1:4000')
  assert.equal(opened.id, 'remote:host-ios:ios:uuid')
  await ios.getByRole('button', { name: 'Install app / URL forwards', exact: true }).click()
  await button('Stop URL forward').click()
  await button('Start URL forward').waitFor()
  const stop = await page.evaluate(
    () => window.operations.find((op) => op.path === '/api/device-hosts/forward/stop').input,
  )
  assert.deepEqual(stop, { taskId: 'task-1', id: 'forward-1' })
  await button('Close actions').click()
  await android.getByRole('button', { name: 'Install app / URL forwards', exact: true }).click()
  await button('Start URL forward').click()
  await button('Use forwarded preview URL').click()
  assert.equal(await page.getByLabel('Preview URL').inputValue(), 'http://10.0.2.2:4000/')
  await android.getByRole('button', { name: 'Install app / URL forwards', exact: true }).click()
  await button('Stop URL forward').click()
  await button('Close actions').click()

  const discoveries = await page.evaluate(
    () => window.operations.filter((op) => op.path === '/api/previews/devices').length,
  )
  await page.evaluate(() => window.setHub(false))
  await button('Refresh devices').click()
  await button('Enable in Device previews settings').waitFor()
  assert.equal(await ios.count(), 0)
  assert.equal(
    await page.evaluate(
      () => window.operations.filter((op) => op.path === '/api/previews/devices').length,
    ),
    discoveries,
  )

  assert.deepEqual(errors, [])
  console.log(
    'Mobile device host UI: default-off hub, discovery gate, enable settings action, tested draft/config preservation, revision baseline, add/test/save, pairing secrecy, test invalidation, default, stale conflict, reconnect draft, removal, read retry, namespaced iOS/Android actions, live platform, install, error secrecy and URL forwards passed.',
  )
} finally {
  await browser.close()
}
