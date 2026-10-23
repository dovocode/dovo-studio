import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const mobile = fileURLToPath(new URL('../apps/mobile', import.meta.url))
const controls = `
export const View=({children})=><div>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const SafeModal=View;
export const useTheme=()=>({styles:{}});
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {MobileRemoteDesktop} from './src/screens/remote-desktop';
window.webViews=new Map();window.commands=[];window.requests=[];
window.runtime={connection:{address:'http://runtime.lan:4310',token:'paired-device-token'},connected:true,snapshot:{remoteDesktopEnabled:true},
readEffect:(path,input)=>Effect.tryPromise({try:async()=>{
 window.requests.push({path,input});
 if(input.action==='start'&&window.hold)await new Promise(resolve=>window.release=resolve);
 return path.endsWith('unlock-ticket')?{ticket:'one-use-ticket'}:{session:input.action==='stop'?null:{id:input.id,viewer:'iPhone',control:false,locked:true}};
},catch:error=>error})};
window.send=(message)=>Array.from(window.webViews.values()).at(-1).onMessage({nativeEvent:{data:JSON.stringify({channel:'dovo-desktop',type:'request',id:++window.sequence,...message})}});
window.sequence=0;
function App(){const[open,setOpen]=useState(true);return open?<MobileRemoteDesktop onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Open viewer</button>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    conditions: ['development'],
    alias: {
      react: mobile + '/node_modules/react',
      'react-dom': mobile + '/node_modules/react-dom',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: 'react-native',
      contents: `${controls}
const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,callback)=>{listeners.add(callback);return{remove:()=>listeners.delete(callback)}}};
window.appState=state=>{AppState.currentState=state;for(const callback of listeners)callback(state)};`,
    },
    {
      path: 'react-native-webview',
      contents: `
import {forwardRef,useEffect,useImperativeHandle,useState} from 'react';let next=0;
export const WebView=forwardRef((props,ref)=>{const[id]=useState(()=>++next);window.webViews.set(id,props);
useImperativeHandle(ref,()=>({injectJavaScript:code=>window.commands.push({id,code})}),[]);
useEffect(()=>{props.onMessage({nativeEvent:{data:JSON.stringify({channel:'dovo-desktop',type:'ready'})}});return()=>window.webViews.delete(id)},[]);
return <div data-webview={id}/>;});`,
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    ...[
      '../ui/layout/safe-modal',
      '../ui/controls/action',
      '../ui/content/text',
      '../ui/theme',
    ].map((path) => ({ path, importer: mobile, contents: controls })),
    {
      path: '../../assets/remote-desktop.json',
      importer: mobile,
      contents: 'export default "self-contained-viewer";',
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.webViews.size === 1)
  // Ignore arbitrary API paths and reject tickets for sessions not owned by this screen.
  await page.evaluate(() => {
    window.send({ action: 'arbitrary', path: '/api/runtime/preferences' })
    window.send({ action: 'unlock', sessionId: '11111111-1111-4111-8111-111111111111' })
  })
  await page.waitForFunction(() =>
    window.commands.some((item) => item.code.includes('Desktop session ended')),
  )
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  const id = randomUUID()
  await page.evaluate(
    (id) => window.send({ action: 'desktop', input: { action: 'start', id } }),
    id,
  )
  await page.waitForFunction(() => window.requests.length === 1)
  await page.evaluate((id) => window.send({ action: 'unlock', sessionId: id }), id)
  await page.waitForFunction(() =>
    window.commands.some((item) =>
      item.code.includes('ws://runtime.lan:4310/ws/remote-desktop/unlock?ticket=one-use-ticket'),
    ),
  )
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.commands).includes('paired-device-token')),
    false,
  )
  await page.evaluate(() => window.appState('inactive'))
  assert.equal(
    await page.evaluate(() => window.requests.some((item) => item.input.action === 'stop')),
    false,
  )
  await page.evaluate(() => window.appState('background'))
  await page.waitForFunction(
    () =>
      window.webViews.size === 0 && window.requests.some((item) => item.input.action === 'stop'),
  )
  await page.evaluate(() => window.appState('active'))
  await page.waitForFunction(() => window.webViews.size === 1)
  // A pending start that finishes after backgrounding must be stopped again, never resurrected.
  const delayedId = randomUUID()
  await page.evaluate((id) => {
    window.hold = true
    window.send({ action: 'desktop', input: { action: 'start', id } })
  }, delayedId)
  await page.waitForFunction(() => typeof window.release === 'function')
  await page.evaluate(() => window.appState('background'))
  await page.waitForFunction(() => window.webViews.size === 0)
  await page.evaluate(() => {
    window.hold = false
    window.release()
  })
  await page.waitForFunction(
    (id) =>
      window.requests.filter((item) => item.input.action === 'stop' && item.input.id === id)
        .length === 2,
    delayedId,
  )
  await page.evaluate(() => window.appState('active'))
  await page.waitForFunction(() => window.webViews.size === 1)
  const finalId = randomUUID()
  await page.evaluate(
    (id) => window.send({ action: 'desktop', input: { action: 'start', id } }),
    finalId,
  )
  await page.waitForFunction(
    (id) => window.requests.some((item) => item.input.action === 'start' && item.input.id === id),
    finalId,
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForFunction(
    (id) => window.requests.some((item) => item.input.action === 'stop' && item.input.id === id),
    finalId,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile desktop bridge: session ownership, restricted commands, HTTP/WS ticket, no pairing token in document, inactive/background/close cleanup and late-start cancellation passed.',
  )
} finally {
  await browser.close()
}
