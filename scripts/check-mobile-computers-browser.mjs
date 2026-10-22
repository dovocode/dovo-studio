import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
export const ScrollView=View;
export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const Platform={OS:'ios'};export const Alert={alert(){}};
export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
export const StyleSheet={hairlineWidth:1};export const useWindowDimensions=()=>({width:390,fontScale:1});
`
const text = `export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':accessibilityRole}>{children}</span>;`
const theme = `export const useTheme=()=>({styles:{},colors:{}});export const useSettingsTheme=useTheme;export const SettingsPage=({children})=><main>{children}</main>;`
const sheet = `export const Sheet=({children,title,onClose})=><section role="dialog" aria-label={title}><button onClick={onClose}>Close</button>{children}</section>;export const SettingsSheet=Sheet;`
const stubs = [
  { path: 'react-native', contents: native },
  {
    path: 'expo-router',
    contents:
      'export const useLocalSearchParams=()=>({});export const router={setParams(){},push(){},navigate(){}};',
  },
  { path: 'expo-crypto', contents: 'export const getRandomBytes=n=>new Uint8Array(n);' },
  {
    path: './account-provider',
    importer: mobile + 'runtime/connection/',
    contents: 'export const useMobileAccount=()=>window.account;',
  },
  {
    path: './peer-transport',
    importer: mobile + 'runtime/connection/',
    contents: 'export const preparePeerConnection=()=>{};',
  },
  ...[
    ['./provider', 'runtime/connection/'],
    ['../runtime/connection/provider', 'screens/'],
  ].map(([path, importer]) => ({
    path,
    importer: mobile + importer,
    contents:
      'export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;',
  })),
  {
    path: '../runtime/state/application-state',
    importer: mobile + 'screens/',
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../runtime/state/native-effect',
    importer: mobile + 'screens/',
    contents: 'export const mobileWorkflow=()=>{};',
  },
  {
    path: '../runtime/connection/connection-type',
    importer: mobile + 'screens/',
    contents: 'export const useConnectionTypes=()=>()=>({label:"Private · LAN / VPN"});',
  },
  ...[
    ['../../ui/content/text', 'runtime/connection/', text],
    ['../ui/content/text', 'screens/', text],
    ['../ui/controls/icon', 'screens/', 'export const Icon=()=>null;'],
    [
      '../ui/controls/use-action',
      'screens/',
      'export const useAction=()=>({busy:false,error:"",act:fn=>fn()});',
    ],
    [
      '../ui/controls/switch',
      'screens/',
      'export const Switch=({value,onValueChange,accessibilityLabel})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={e=>onValueChange(e.target.checked)}/>;',
    ],
    [
      '../ui/layout/screen-header',
      'screens/',
      'export const ScreenHeader=({title})=><h1>{title}</h1>;',
    ],
    ['../ui/content/runtime-icon', 'screens/', 'export const runtimeIconName=()=>"device";'],
    ['../ui/theme', 'screens/', theme],
    ['../ui/layout/sheet', 'screens/', sheet],
    ['./settings-theme', 'screens/', theme + sheet],
    ['../../screens/settings-theme', 'runtime/connection/', theme],
  ].map(([path, importer, contents]) => ({ path, importer: mobile + importer, contents })),
  ...[
    ['./settings-controls', 'screens/'],
    ['../../screens/settings-controls', 'runtime/connection/'],
  ].map(([path, importer]) => ({
    path,
    importer: mobile + importer,
    contents:
      'export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsChoice=()=>null;export const SettingsField=()=>null;',
  })),
]
// These editors are opened from the screen but have independent interaction coverage.
for (const [path, name] of [
  ['../runtime/connection/runtime-icon-settings', 'RuntimeIconSettings'],
  ['./device-host-settings', 'DeviceHostSettings'],
  ['../runtime/preferences/task-default-settings', 'TaskDefaultSettings'],
  ['../runtime/connection/runtime-preferences', 'RuntimePreferences'],
  ['../runtime/state/activity', 'ActivityLog'],
  ['../runtime/preferences/command-settings', 'CommandSettings'],
  ['../runtime/connection/pair-computer', 'PairComputer'],
  ['../runtime/connection/upgrade-internet', 'UpgradeInternet'],
  ['../runtime/connection/connect-settings', 'ConnectSettings'],
  ['../runtime/connection/relay-settings', 'RelaySettings'],
  ['../runtime/connection/peer-relay-choice', 'PeerRelayChoice'],
  ['../runtime/connection/connection-help', 'ConnectionHelp'],
])
  stubs.push({ path, importer: mobile + 'screens/', contents: `export const ${name}=()=>null;` })

const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {decode,snapshotSchema} from '@dovo/protocol';import Screen from '${mobile}screens/devices.tsx';
window.calls=[];
const source=(id,name,connected)=>({profile:{id,name,connection:{address:'http://'+id+'.vpn:51464',token:'private-device-token',runtimeId:id}},connected,error:connected?'':'Offline',lastSeen:1,snapshot:decode(snapshotSchema,{revision:1,owner:false,runtimeId:id,releaseDistribution:'archive',releaseCanUpdate:true,releaseVersion:'1.0.0',workspace:{version:1,runtimeAddress:'',tasks:[],repositories:[],agents:[],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]})});
const overviews=[source('mac','Mac Studio',true),source('server','Linux server',false)];
window.runtime={profiles:overviews.map(e=>e.profile),overviews,activeId:'mac',registryLoaded:true,refreshRuntime:async()=>{}};
window.account={loaded:true,busy:false,error:'',directory:{user:{id:'owner',name:'Dominic'},servers:[{id:'mac',name:'Mac Studio',address:'http://mac.vpn:51464'},{id:'cloud',name:'Cloud computer',address:'http://cloud.vpn:51464'}]},client:{}};
window.fetch=async(input,init)=>{const url=new URL(input);window.calls.push({path:url.pathname,method:init?.method??'GET'});return Response.json(url.hostname==='api.github.com'?(url.pathname.endsWith('/latest')?{tag_name:'v1.0.1',html_url:'https://github.com/dovocode/dovo-studio/releases/tag/v1.0.1'}:[]):{status:'idle'})};
const app=createRoot(document.getElementById('app'));window.render=()=>app.render(<Screen/>);window.render();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
  },
  stubs,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.clock.install()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Manage Mac Studio', exact: true }).waitFor()
  const singleList = async () => {
    assert.equal(await page.getByText('Mac Studio', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Linux server', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Cloud computer', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('checkbox').count(), 0)
  }
  await singleList()
  await page.clock.runFor(6001)
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  await page.getByRole('button', { name: 'Manage linked computers', exact: true }).click()
  await page.getByRole('button', { name: 'Pair Cloud computer', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Hide linked computers', exact: true }).click()
  await singleList()
  await page.getByRole('button', { name: 'Computer updates', exact: true }).click()
  const updates = page.getByRole('dialog', { name: 'Computer updates', exact: true })
  await updates.getByLabel('Select Mac Studio for update', { exact: true }).waitFor()
  assert.equal(
    await updates.getByLabel('Select Linux server for update', { exact: true }).count(),
    1,
  )
  await updates.getByRole('button', { name: 'Close', exact: true }).click()
  await singleList()
  assert.equal(
    await page.getByRole('button', { name: 'Manage Linux server', exact: true }).count(),
    1,
  )
  assert.equal(await page.evaluate(() => window.calls.some((call) => call.method !== 'GET')), false)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Computers screen: one saved-computer list, optional account directory, deferred update sheet, offline management and no background requests or mutations passed.',
  )
} finally {
  await browser.close()
}
