import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useSoftwareKeyboard} from './apps/mobile/src/shell/use-software-keyboard';
function App(){const keyboard=useSoftwareKeyboard();return <div data-testid="avoidance" data-enabled={keyboard}>{keyboard?'Above keyboard':'Normal position'}</div>}
const root=createRoot(document.getElementById('app'));root.render(<App/>);window.unmount=()=>root.unmount();`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '../runtime/state/application-state',
      importer: root + 'apps/mobile/src/shell/',
      contents: "export {useState as useApplicationState} from 'react'",
    },
    {
      path: 'react-native',
      contents: `
const listeners=new Map();let metrics;
export const AppState={currentState:'active',addEventListener:(name,fn)=>listen('app:'+name,fn)};
export const Keyboard={metrics:()=>metrics,addListener:listen};
function listen(name,fn){const set=listeners.get(name)??new Set();set.add(fn);listeners.set(name,set);return {remove:()=>set.delete(fn)}}
window.appState=state=>{AppState.currentState=state;listeners.get('app:change')?.forEach(fn=>fn(state))};
window.keyboard=(name,height=0)=>{if(name==='keyboardDidShow')metrics={height};if(name==='keyboardDidHide')metrics=undefined;listeners.get(name)?.forEach(fn=>fn({endCoordinates:{height}}))};
window.listenerCount=()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0);`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const enabled = async (value) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="avoidance"]')?.dataset.enabled === String(expected),
      value,
    )
  await enabled(false)
  await page.evaluate(() => window.keyboard('keyboardDidShow', 340))
  await enabled(true)
  await page.evaluate(() => window.appState('inactive'))
  await enabled(false)
  // The keyboard can remain visible without another show notification after activation.
  await page.evaluate(() => window.appState('active'))
  await enabled(true)
  await page.evaluate(() => {
    window.appState('background')
    window.keyboard('keyboardDidHide')
    window.keyboard('keyboardDidShow', 360)
  })
  await enabled(false)
  await page.evaluate(() => window.appState('active'))
  await enabled(true)
  await page.evaluate(() => window.keyboard('keyboardDidHide'))
  await enabled(false)
  await page.evaluate(() => {
    window.appState('background')
    window.keyboard('keyboardDidShow', 0)
    window.appState('active')
  })
  await enabled(false)
  await page.evaluate(() => window.unmount())
  assert.equal(await page.evaluate(() => window.listenerCount()), 0)
  console.log(
    'Keyboard resume: retained visibility, show-before-active ordering, real hide, zero-height shortcuts and listener cleanup pass. Native geometry needs device verification.',
  )
} finally {
  await browser.close()
}
