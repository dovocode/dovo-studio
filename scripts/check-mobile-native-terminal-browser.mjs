// Drives the real iOS/Android terminal session in Chromium: the mobile adapter
// (terminal-session.native.tsx) plus @dovo/terminal/native, with only the native boundaries
// replaced: the libghostty view, React Native primitives, and the runtime WebSocket. This does
// not validate native rendering.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/terminal'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {TerminalSession} from './src/terminal/terminal-session.native.tsx';import {WorkspaceTerminalScreen} from './src/terminal/workspace-terminal-screen.tsx';import {runtimeProfile} from '${root}packages/protocol/src/index.ts';
window.tickets=0;window.runtime={ready:true,connection:runtimeProfile({address:'http://computer.local:51464',token:'device-token-123456789'}).connection,call:async(path,input)=>{if(path!=='/api/terminals/ticket'||input.id!=='terminal')throw Error('Unexpected request '+path);window.tickets++;return {ticket:'ticket-'+window.tickets}}};
window.focused=true;window.runtime.connected=true;window.runtime.overviews=[{profile:{id:'computer',name:'Computer',connection:window.runtime.connection},connected:true,snapshot:{terminals:[{id:'terminal',taskId:'studio:terminals',title:'Shell'}]}}];
const node=createRoot(document.getElementById('app'));window.renderTerminal=(visible=true)=>flushSync(()=>node.render(<TerminalSession id="terminal" visible={visible}/>));window.renderStandalone=()=>flushSync(()=>node.render(<WorkspaceTerminalScreen runtimeId="computer" terminalId="terminal"/>));window.renderTerminal();`,
      loader: 'tsx',
      resolveDir: root + 'apps/mobile',
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    // One React instance: the app and @dovo/terminal otherwise resolve different installs.
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    // Workspace packages may not have emitted dist files yet.
    conditions: ['development'],
    nodePaths: [
      root + 'apps/mobile/node_modules',
      root + 'packages/studio-ui/node_modules',
      root + 'node_modules',
    ],
  },
  [
    {
      path: 'react-native',
      contents: `import {forwardRef,useImperativeHandle} from 'react';const keyboardListeners=new Map();window.keyboardEvent=(name,event)=>{for(const fn of keyboardListeners.get(name)??[])fn(event)};const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};window.appState=value=>{AppState.currentState=value;listeners.forEach(fn=>fn(value))};export const Keyboard={addListener:(name,fn)=>{const set=keyboardListeners.get(name)??new Set();keyboardListeners.set(name,set);set.add(fn);return {remove:()=>set.delete(fn)}}};export const Alert={alert:()=>{}};export const Platform={get OS(){return window.platformOS}};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Text=({children})=><span>{children}</span>;export const View=forwardRef(({children,testID,style},ref)=>{useImperativeHandle(ref,()=>({measureInWindow:fn=>fn(0,100,400,600)}));return <div data-testid={testID} data-pointer-events={[style].flat(9).filter(Boolean).reduce((value,item)=>item.pointerEvents??value,undefined)}>{children}</div>});`,
    },
    {
      path: 'expo',
      contents: `export const requireOptionalNativeModule=name=>name==='ExpoLibghostty'&&window.nativeTerminal?{clipboardActions:true}:null;`,
    },
    {
      path: 'expo-libghostty',
      // Mirrors expo-libghostty 0.8.1: imperative calls queue until the first grid size.
      contents: `import {useEffect,useImperativeHandle} from 'react';export function TerminalView(props){const {ref,fontSize,theme,onInput,onResize}=props;window.props=props;window.fontFallback=(fontFamily,message)=>props.onFontFallback({nativeEvent:{fontFamily,message}});useImperativeHandle(ref,()=>({copySelection:async()=>{window.copyCalls=(window.copyCalls??0)+1;return window.copyResult},pasteFromClipboard:async()=>{window.pasteCalls=(window.pasteCalls??0)+1},focus:async()=>{window.focusCalls=(window.focusCalls??0)+1;window.props.onKeyboardVisibilityChange({nativeEvent:{visible:true}});window.keyboardEvent('keyboardWillChangeFrame',{endCoordinates:{screenY:500}})},blur:async()=>{window.blurCalls=(window.blurCalls??0)+1;window.props.onKeyboardVisibilityChange({nativeEvent:{visible:false}});window.keyboardEvent('keyboardWillHide')},writeText:async text=>{window.writes.push(text)},write:async base64=>{window.writes.push(new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0))))},finish:async()=>{}}),[]);useEffect(()=>{window.mounts++;window.fontSizes.push(fontSize);window.themes.push(theme);window.input=text=>onInput({nativeEvent:{text,data:btoa(text)}});window.resize=(cols,rows)=>onResize({nativeEvent:{cols,rows}});onResize({nativeEvent:{cols:80,rows:24}})},[]);return <div data-testid="ghostty"/>}`,
    },
    {
      path: './webview-terminal-session',
      importer,
      contents: `export const WebViewTerminalSession=()=>{window.webviews++;return <div data-testid="webview"/>};`,
    },
    {
      path: '../runtime/state/application-state',
      importer,
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '../runtime/connection/provider',
      importer,
      contents: `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=><>{children}</>;`,
    },
    {
      path: '../runtime/preferences/app-preferences',
      importer,
      contents: `export const useMobilePreferences=()=>({terminalFontFamily:window.fontFamily,terminalFontSize:window.fontSize,unifiedWorkspaceEnabled:true});`,
    },
    {
      path: '../ui/theme',
      importer,
      contents: `export const useTheme=()=>({styles:{}});`,
    },
    {
      path: '../ui/content/text',
      importer,
      contents: `export const Text=({children})=><p className="status">{children}</p>;`,
    },
    {
      path: 'expo-router',
      contents: 'export const router={canGoBack:()=>false,replace:()=>{},push:()=>{}};',
    },
    {
      path: './terminal-session',
      importer,
      contents: "export {TerminalSession} from './src/terminal/terminal-session.native';",
    },
    {
      path: '../shell/navigation',
      importer,
      contents: 'export const useNavigation=()=>({focused:window.focused});',
    },
    {
      path: '../ui/layout/screen-header',
      importer,
      contents:
        'export const ScreenHeader=({title,buttons})=><header>{title}{buttons?.map(button=><button key={button.label} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;',
    },
    {
      path: '../ui/layout/sheet',
      importer,
      contents: 'export const Sheet=({children})=><div>{children}</div>;',
    },
    { path: '../ui/controls/field', importer, contents: 'export const Field=()=>null;' },
    {
      path: '../ui/controls/action',
      importer,
      contents:
        'export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
    },
    {
      path: '../ui/content/empty-state',
      importer,
      contents:
        'export const EmptyState=({title,description,action})=><div><p>{title}</p><p>{description}</p>{action}</div>;',
    },
    {
      path: '../workspace/resource-actions',
      importer,
      contents:
        'export const ResourceActions=()=>null;export const useTerminalActions=()=>({disabled:!window.runtime.connected});',
    },
    {
      path: '../workspace/workspace-items',
      importer,
      contents: 'export const workspaceItems=()=>[];',
    },
  ],
)

// fontProp: whether the native view config exposes the patched fontFamily prop.
const setup = (platformOS, nativeTerminal, fontProp) => `
window.platformOS=${JSON.stringify(platformOS)};window.nativeTerminal=${nativeTerminal};window.fontSize=14;window.fontFamily='';
window.expo={getViewConfig:name=>name==='ExpoLibghostty'?{validAttributes:${fontProp ? '{fontSize:true,fontFamily:true}' : '{fontSize:true}'}}:null};
window.copyResult=true;window.writes=[];window.mounts=0;window.webviews=0;window.fontSizes=[];window.themes=[];window.sockets=[];
window.WebSocket=class{static OPEN=1;readyState=0;sent=[];closed=false;constructor(url){this.url=url;window.sockets.push(this)}send(text){this.sent.push(JSON.parse(text))}close(){this.closed=true;this.readyState=3}open(){this.readyState=1;this.onopen?.({})}};
window.socket=()=>window.sockets.at(-1);
// Binary stream v1 frames: kind byte (0 data, 1 replayStart, 2 replayEnd, 3 pong) + payload.
window.frame=(kind,text='')=>{const payload=new TextEncoder().encode(text);const bytes=new Uint8Array(payload.length+1);bytes[0]=kind;bytes.set(payload,1);window.socket().onmessage({data:bytes.buffer})};
window.replay=text=>{window.frame(1);if(text)window.frame(0,text);window.frame(2)};
window.acks=()=>window.socket().sent.filter(frame=>frame.type==='ack');`

const browser = await chromium.launch()
try {
  const load = async (platformOS, nativeTerminal = true, fontProp = true) => {
    const page = await browser.newPage()
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: setup(platformOS, nativeTerminal, fontProp) })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    return page
  }

  // Native module missing (for example an older dev client): fall back to the WebView renderer.
  const fallback = await load('ios', false)
  assert.equal(await fallback.evaluate(() => window.webviews), 1)
  assert.equal(await fallback.evaluate(() => window.mounts), 0)

  const page = await load('ios')
  // The first grid size gates the connection; the ticket keeps the HTTP LAN address as ws://.
  await page.waitForFunction(() => window.sockets.length === 1)
  assert.equal(await page.evaluate(() => window.webviews), 0)
  assert.equal(
    await page.evaluate(() => window.socket().url),
    'ws://computer.local:51464/ws/terminal?ticket=ticket-1&stream=binary-v1',
  )
  assert.deepEqual(await page.evaluate(() => window.themes[0]), {
    background: '#101113',
    foreground: '#ededee',
  })
  assert.equal(await page.evaluate(() => window.fontSizes[0]), 14)
  assert.match(await page.textContent('#app'), /Connecting terminal…/)

  await page.evaluate(() => window.socket().open())
  assert.deepEqual(await page.evaluate(() => window.writes), [])
  assert.deepEqual(await page.evaluate(() => window.socket().sent.slice(0, 2)), [
    { type: 'resize', cols: 80, rows: 24 },
    { type: 'ping', nonce: '1' },
  ])
  // An open socket is not a usable terminal: the replay follows and input is unavailable.
  const surface = () =>
    page.evaluate(() =>
      document
        .querySelector('[data-testid="Terminal surface"]')
        .getAttribute('data-pointer-events'),
    )
  assert.doesNotMatch(await page.textContent('#app'), /Connecting terminal…/)
  assert.match(await page.textContent('#app'), /Replaying terminal history…/)
  assert.equal(await surface(), 'auto', 'Selection and Copy do not require a writable stream')
  assert.equal(await page.getByRole('button', { name: 'Paste into terminal' }).isDisabled(), true)

  // Binary v1: reset, replay and live output reach Ghostty in order and are acknowledged
  // after the native write resolves. Emulator answers to replayed queries are not sent.
  await page.evaluate(() => {
    window.frame(1)
    window.frame(0, 'history\r\n\x1b[c')
    window.frame(2)
    window.frame(0, 'live')
  })
  await page.waitForFunction(() => window.writes.length === 4)
  assert.deepEqual(await page.evaluate(() => window.writes), [
    '\x1bc\x1b[3J',
    'history\r\n\x1b[c',
    '\x1b[5n',
    'live',
  ])
  await page.waitForFunction(() => window.acks().length === 2)

  assert.deepEqual(await page.evaluate(() => window.acks()), [
    { type: 'ack', bytes: 12 },
    { type: 'ack', bytes: 4 },
  ])
  assert.match(await page.textContent('#app'), /Replaying terminal history…/)
  assert.equal(await surface(), 'auto')
  await page.evaluate(() => {
    window.input('\x1b[?62c')
    window.input('\x1b[0n')
  })
  // The barrier answer arrived: the terminal is ready and takes touches again.
  await page.waitForFunction(
    () => !document.body.textContent.includes('Replaying terminal history…'),
  )
  assert.equal(await surface(), 'auto')
  await page.getByRole('button', { name: 'Copy terminal selection', exact: true }).click()
  await page.getByText('Copied', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.copyCalls), 1)
  await page.evaluate(() => (window.copyResult = false))
  await page.getByRole('button', { name: 'Copy terminal selection', exact: true }).click()
  await page
    .getByText('Long press terminal output to select text, then choose Copy.', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Paste into terminal', exact: true }).click()
  assert.equal(await page.evaluate(() => window.pasteCalls), 1)
  // An accessory-only frame can overlap the terminal while the software keyboard stays hidden.
  await page.evaluate(() => {
    window.keyboardEvent('keyboardWillChangeFrame', { endCoordinates: { screenY: 650 } })
    window.props.onKeyboardVisibilityChange({ nativeEvent: { visible: false } })
  })
  await page.getByRole('button', { name: 'Show terminal keyboard' }).waitFor()
  await page.getByRole('button', { name: 'Show terminal keyboard' }).click()
  await page.getByRole('button', { name: 'Hide terminal keyboard' }).waitFor()
  assert.equal(await page.evaluate(() => window.focusCalls), 1)
  await page.getByRole('button', { name: 'Hide terminal keyboard' }).click()
  await page.getByRole('button', { name: 'Show terminal keyboard' }).waitFor()
  assert.equal(await page.evaluate(() => window.blurCalls), 1)

  await page.evaluate(() => {
    window.input('ls -la\r')
    window.input('\x03')
    window.resize(100, 30)
  })
  assert.deepEqual(
    await page.evaluate(() =>
      window
        .socket()
        .sent.filter((frame) => frame.type !== 'ack')
        .slice(2),
    ),
    [
      { type: 'input', data: 'ls -la\r' },
      { type: 'input', data: '\x03' },
      { type: 'resize', cols: 100, rows: 30 },
    ],
  )

  // Hidden panes release the socket; showing them reconnects with a fresh ticket.
  await page.evaluate(() => window.renderTerminal(false))
  await page.waitForFunction(() => window.sockets[0].closed)
  await page.evaluate(() => window.renderTerminal(true))
  await page.waitForFunction(() => window.tickets === 2 && window.sockets.length === 2)
  assert.equal(await page.evaluate(() => window.mounts), 1)

  // A true background stay disconnects; returning reconnects and replays after a reset.
  await page.evaluate(() => window.socket().open())
  await page.evaluate(() => window.appState('background'))
  await page.waitForFunction(() => window.sockets[1].closed)
  await page.evaluate(() => window.appState('inactive'))
  assert.equal(await page.evaluate(() => window.sockets.length), 2)
  await page.evaluate(() => window.appState('active'))
  await page.waitForFunction(() => window.sockets.length === 3)
  await page.evaluate(() => {
    window.socket().open()
    window.replay('history again')
  })
  await page.waitForFunction(
    () => window.writes.filter((text) => text === '\x1bc\x1b[3J').length === 2,
  )
  assert.equal(await page.evaluate(() => window.writes.at(-2)), 'history again')

  // Disconnect reasons from the runtime are shown while the reconnect loop retries.
  await page.evaluate(() => {
    window.socket().readyState = 3
    window.socket().onclose({ reason: 'Device revoked' })
  })
  await page.waitForFunction(() =>
    document.body.textContent.includes('Device revoked Reconnecting…'),
  )
  assert.equal(await surface(), 'auto', 'Retained output remains selectable while disconnected')
  assert.equal(
    await page.getByRole('button', { name: 'Copy terminal selection' }).isDisabled(),
    false,
  )
  assert.equal(await page.getByRole('button', { name: 'Paste into terminal' }).isDisabled(), true)
  await page.evaluate(() => {
    window.copyResult = true
    window.input('must not reach the socket')
  })
  const writesWhileOffline = await page.evaluate(() => window.socket().sent.length)
  await page.getByRole('button', { name: 'Copy terminal selection' }).click()
  await page.getByText('Copied', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.socket().sent.length), writesWhileOffline)
  await page.waitForFunction(() => window.sockets.length === 4, null, { timeout: 5000 })
  await page.evaluate(() => window.socket().open())

  // iOS rebuilds the Ghostty surface on font changes: remount, then reconnect for the replay.
  await page.evaluate(() => {
    window.fontSize = 18
    window.renderTerminal(true)
  })
  await page.waitForFunction(() => window.mounts === 2 && window.sockets.length === 5)
  assert.equal(await page.evaluate(() => window.sockets[3].closed), true)
  assert.equal(await page.evaluate(() => window.fontSizes[1]), 18)

  // Android reflows in place: the font prop changes without remounting or reconnecting.
  const android = await load('android')
  await android.waitForFunction(() => window.sockets.length === 1)
  await android.evaluate(() => window.socket().open())
  await android.evaluate(() => {
    window.fontSize = 20
    window.renderTerminal(true)
  })
  assert.equal(await android.evaluate(() => window.mounts), 1)
  assert.equal(await android.evaluate(() => window.sockets.length), 1)
  assert.equal(await android.evaluate(() => window.socket().closed), false)

  // An out-of-range stored size falls back to the default instead of reaching native code.
  const invalid = await load('android')
  await invalid.evaluate(() => {
    window.fontSize = 100
    window.renderTerminal(true)
  })
  assert.deepEqual(await invalid.evaluate(() => window.fontSizes), [14])

  // Font family preference: the device default is a system monospace on both platforms.
  const fonts = await load('ios')
  await fonts.waitForFunction(() => window.sockets.length === 1)
  await fonts.evaluate(() => window.socket().open())
  assert.equal(await fonts.evaluate(() => window.props.fontFamily), 'Menlo')
  // The bundled Nerd Font applies live (a config update, not a surface rebuild).
  await fonts.evaluate(() => {
    window.fontFamily = 'JetBrains Mono Nerd Font'
    window.renderTerminal(true)
  })
  assert.equal(
    await fonts.evaluate(() => window.props.fontFamily),
    'JetBrainsMonoNL Nerd Font Mono',
  )
  assert.equal(await fonts.evaluate(() => window.mounts), 1)
  assert.equal(await fonts.evaluate(() => window.socket().closed), false)
  assert.doesNotMatch(await fonts.textContent('#app'), /terminal font/)
  // A family the native side cannot load is reported, not silently ignored.
  await fonts.evaluate(() =>
    window.fontFallback(
      'JetBrainsMonoNL Nerd Font Mono',
      'Font family JetBrainsMonoNL Nerd Font Mono is not registered with this app.',
    ),
  )
  await fonts.waitForFunction(() =>
    document.body.textContent.includes(
      'not registered with this app. Showing the default terminal font.',
    ),
  )
  // A fallback for a previous preference no longer applies after switching back.
  await fonts.evaluate(() => {
    window.fontFamily = ''
    window.renderTerminal(true)
  })
  assert.doesNotMatch(await fonts.textContent('#app'), /terminal font/)

  const androidFonts = await load('android')
  await androidFonts.evaluate(() => {
    window.fontFamily = 'JetBrains Mono Nerd Font'
    window.renderTerminal(true)
  })
  assert.equal(
    await androidFonts.evaluate(() => window.props.fontFamily),
    'JetBrainsMonoNLNerdFontMono',
  )

  // A binary built without the native patch: never pass the prop, and say when the built-in
  // font (embedded JetBrains Mono on iOS, system monospace on Android) differs from the choice.
  const unpatchedAndroid = await load('android', true, false)
  await unpatchedAndroid.evaluate(() => {
    window.fontFamily = 'JetBrains Mono Nerd Font'
    window.renderTerminal(true)
  })
  assert.equal(await unpatchedAndroid.evaluate(() => 'fontFamily' in window.props), false)
  assert.match(
    await unpatchedAndroid.textContent('#app'),
    /cannot change the terminal font; showing the system monospace font instead/,
  )
  const unpatchedIos = await load('ios', true, false)
  assert.equal(await unpatchedIos.evaluate(() => 'fontFamily' in window.props), false)
  assert.match(await unpatchedIos.textContent('#app'), /showing JetBrains Mono Nerd Font instead/)
  await unpatchedIos.evaluate(() => {
    window.fontFamily = 'JetBrains Mono Nerd Font'
    window.renderTerminal(true)
  })
  assert.doesNotMatch(await unpatchedIos.textContent('#app'), /terminal font/)

  // Exercise the standalone screen too. Its offline state must not unmount the native grid.
  const standalone = await load('ios')
  await standalone.evaluate(() => window.renderStandalone())
  await standalone.waitForFunction(() => window.mounts === 2 && window.sockets.length === 2)
  await standalone.evaluate(() => {
    window.socket().open()
    window.replay('Retained standalone output')
  })
  await standalone.waitForFunction(() => window.writes.includes('Retained standalone output'))
  await standalone.evaluate(() => window.input('\x1b[0n'))
  await standalone.waitForFunction(
    () => !document.body.textContent.includes('Replaying terminal history…'),
  )
  const mounts = await standalone.evaluate(() => window.mounts)
  await standalone.evaluate(() => {
    window.runtime.connected = false
    window.runtime.overviews[0].connected = false
    window.socket().readyState = 3
    window.socket().onclose({ reason: 'Computer offline' })
    window.renderStandalone()
  })
  await standalone
    .getByText('Computer offline. Showing retained terminal output.', { exact: true })
    .waitFor()
  assert.equal(await standalone.evaluate(() => window.mounts), mounts)
  assert.equal(await standalone.getByTestId('ghostty').count(), 1)
  assert.equal(
    await standalone.getByRole('button', { name: 'Paste into terminal' }).isDisabled(),
    true,
  )
  await standalone.getByRole('button', { name: 'Copy terminal selection' }).click()
  await standalone.getByText('Copied', { exact: true }).waitFor()
  // Hidden stack screens keep their grid but release their socket.
  await standalone.evaluate(() => {
    window.focused = false
    window.renderStandalone()
  })
  assert.equal(await standalone.evaluate(() => window.mounts), mounts)
  await standalone.evaluate(() => {
    window.focused = true
    window.runtime.connected = true
    window.runtime.overviews[0].connected = true
    window.renderStandalone()
  })
  assert.equal(await standalone.evaluate(() => window.mounts), mounts)
  // Re-pairing is a new scope and must clear the previous computer's retained output.
  await standalone.evaluate(() => {
    window.runtime.connection = { ...window.runtime.connection, token: 'new-pairing' }
    window.runtime.overviews[0].profile.connection = window.runtime.connection
    window.renderStandalone()
  })
  await standalone.waitForFunction((previous) => window.mounts === previous + 1, mounts)
  // An empty registry during startup does not yet confirm that the pairing is gone.
  await standalone.evaluate(() => {
    window.runtime.ready = false
    window.runtime.overviews = []
    window.renderStandalone()
  })
  await standalone.getByText('Loading terminal…', { exact: true }).waitFor()
  assert.equal(
    await standalone.getByText('This computer is no longer paired.', { exact: true }).count(),
    0,
  )
  assert.equal(await standalone.getByTestId('ghostty').count(), 0)
  await standalone.evaluate(() => {
    window.runtime.ready = true
    window.renderStandalone()
  })
  await standalone.getByText('This computer is no longer paired.', { exact: true }).waitFor()
  assert.equal(await standalone.getByTestId('ghostty').count(), 0)
  console.log(
    'Native terminal adapters: clipboard, replay, fonts and standalone offline retention passed.',
  )
} finally {
  await browser.close()
}
