import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `
import {forwardRef,useImperativeHandle} from 'react';
const flatten=value=>Array.isArray(value)?Object.assign({},...value.map(flatten)):value??{};
export const View=({children,style,testID})=><div data-testid={testID} style={{display:'flex',flexDirection:'column',...flatten(style)}}>{children}</div>;
export const ScrollView=View;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityValue,testID,style})=><button data-testid={testID} aria-label={accessibilityLabel} data-value={accessibilityValue?.text} onClick={onPress} style={{border:0,textAlign:'left',display:'flex',flexDirection:'column',maxWidth:'100%',...flatten(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style})=><span style={{...flatten(style)}}>{children}</span>;
export const Icon=()=>null;export const RuntimeIcon=()=>null;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const useSheetNavigation=()=>callback=>callback();
export const Sheet=forwardRef(function Sheet({children,title,onClose},ref){useImperativeHandle(ref,()=>({dismiss:callback=>{onClose();callback?.()}}));return <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>});
export const useTheme=()=>({styles:{row:{flexDirection:'row',gap:6},muted:{fontSize:12},text:{fontSize:14}},colors:{}});
`
const stubs = [
  { path: 'react-native', contents: controls },
  {
    path: '@dovo/protocol',
    contents: `export * from '${root}packages/protocol/src/index.ts';export const runtimeSyncStatus=()=>window.liveUpdates?'live':undefined;`,
  },
  {
    path: '../../shell/navigation',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: 'export const useNavigation=()=>({navigate(){}});',
  },
  {
    path: '../state/application-state',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../../ui/content/format-date',
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: 'export const formatDateTime=value=>String(value);',
  },
  {
    path: './peer-native',
    importer: mobile + 'runtime/connection/peer-transport.ts',
    contents: `export const openPeerTunnel=async(config,onClosed,abort,onRouteChanged)=>{
      window.relayEnabled=config.relay==='dovo';let live=true;
      window.changeRoute=value=>{window.selectedRoute=value;onRouteChanged()};
      const close=()=>{if(!live)return;live=false;onClosed()};abort.addEventListener('abort',close,{once:true});
      return {address:'http://127.0.0.1:44555',alive:()=>live,route:()=>window.selectedRoute,close};
    };`,
  },
]
for (const path of [
  '../../ui/theme',
  '../../ui/content/text',
  '../../ui/content/runtime-icon',
  '../../ui/controls/icon',
  '../../ui/controls/action',
  '../../ui/layout/sheet',
])
  stubs.push({
    path,
    importer: mobile + 'runtime/connection/fleet-overview.tsx',
    contents: controls,
  })
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {mergeAccountInternetConnection,invalidateRuntimeRoute,peerAddress} from '@dovo/protocol';
import {resolveRuntimeEndpoint} from './packages/protocol/src/runtime/connection/routes.ts';
import {preparePeerConnection,closePeerConnections} from './apps/mobile/src/runtime/connection/peer-transport.ts';
import {FleetOverview} from './apps/mobile/src/runtime/connection/fleet-overview.tsx';
const peer={origin:'https://connect.dovo.studio',secret:'b'.repeat(64),relay:'dovo'};preparePeerConnection(peer);
const connection=mergeAccountInternetConnection({address:'http://vpn.test',token:'vpn-paired-device-token',runtimeId:'host'},
 {address:peerAddress(peer),peer,token:'account-device-token',runtimeId:'host',accountSession:'session'});
window.lan=true;window.selectedRoute='direct';window.fetch=async()=>{
 if(!window.lan)throw Error('Private network unavailable');return Response.json({service:'dovo-runtime',runtimeId:'host'});
};
window.resolveConnection=async(purpose='http')=>{invalidateRuntimeRoute(connection,purpose);await resolveRuntimeEndpoint(connection,new AbortController().signal,purpose)};
window.closePeers=closePeerConnections;
function App(){const [connected,setConnected]=useState(true);const [compact,setCompact]=useState(false);window.setConnected=setConnected;window.setCompact=setCompact;
 const entry={profile:{id:'host',name:'dovo-agent',connection},connected,error:connected?undefined:'Offline'};
 return <FleetOverview entries={[entry]} compact={compact} onSelectSource={()=>{}}/>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
    nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
  },
  stubs,
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 650 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app" style="max-width:288px"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const label = (text) => page.getByText(text, { exact: true }).first().waitFor()
  await label('Private · LAN / VPN')
  await page.evaluate(async () => {
    window.lan = false
    await window.resolveConnection()
  })
  assert.equal(await page.evaluate(() => window.relayEnabled), true)
  await label('Dovo Direct · WebRTC / STUN')
  // A permitted relay is not necessarily in use. Change the selected pair without a snapshot.
  await page.evaluate(() => window.changeRoute('relay'))
  await label('Dovo Connect · TURN')
  await page.getByRole('button', { name: /dovo-agent, Online, Dovo Connect/ }).click()
  await page.getByRole('dialog').getByText('Dovo Connect · TURN', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.changeRoute('custom'))
  await label('Custom relay · TURN')
  await page.evaluate(() => window.changeRoute(undefined))
  await label('WebRTC · Checking route…')
  await page.evaluate(() => window.setConnected(false))
  await label('Offline')
  assert.equal(await page.getByText(/^(Dovo Direct|Dovo Connect|Private|WebRTC) ·/).count(), 0)
  // Returning to VPN must replace the fallback label even though the tunnel remains alive.
  await page.evaluate(async () => {
    window.lan = true
    await window.resolveConnection()
    window.setConnected(true)
  })
  await label('Private · LAN / VPN')
  await page.evaluate(async () => {
    window.liveUpdates = true
    window.lan = false
    window.changeRoute('relay')
    await window.resolveConnection('stream')
  })
  await label('Private · LAN / VPN · Live updates: Dovo Connect · TURN')
  await page.evaluate(async () => {
    window.lan = true
    await window.resolveConnection('stream')
  })
  await label('Private · LAN / VPN')
  await page.evaluate(() => window.setCompact(true))
  await page.getByText('dovo-agent · Online · Private', { exact: true }).waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  assert.equal(overflow, false)
  await page.evaluate(() => window.closePeers())
  assert.deepEqual(errors, [])
  console.log(
    'Mobile connection labels: selected direct/TURN, private fallback and recovery, split HTTP/live routes, unknown/offline, details and compact overview passed.',
  )
} finally {
  await browser.close()
}
