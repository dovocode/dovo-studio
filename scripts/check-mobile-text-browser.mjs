import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile'
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {Text} from './src/ui/content/text';import {MobileThemeContext,createMobileTheme} from './src/ui/theme';
function App(){const [dark,setDark]=useState(true);window.setDark=setDark;const theme=createMobileTheme('dovo',dark?'dark':'light');return <MobileThemeContext.Provider value={theme}><Text testID="bare">Active. This Bot keeps one conversation.</Text><Text style={{color:'#ff0000'}} testID="parent">Error <Text testID="nested">inherits red</Text><Text testID="explicit" style={{color:'#00ff00'}}>explicit green</Text></Text><Text testID="sized" style={{fontSize:20,lineHeight:24}}>Sized</Text><Text testID="button" style={{color:'#000000'}}>Explicit button label</Text></MobileThemeContext.Provider>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    alias: {
      'react-native': require.resolve('react-native-web'),
      react: mobile + '/node_modules/react',
      'react-dom': mobile + '/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  },
  [
    {
      path: '../../runtime/preferences/app-preferences',
      importer: mobile + '/src/ui/content/',
      contents: 'export const carZoom=1.4;export const useCarMode=()=>false;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByTestId('bare').waitFor()
  const color = (id) => page.getByTestId(id).evaluate((node) => getComputedStyle(node).color)
  const dark = await color('bare')
  assert.notEqual(dark, 'rgb(0, 0, 0)')
  assert.equal(await color('nested'), 'rgb(255, 0, 0)')
  assert.equal(await color('explicit'), 'rgb(0, 255, 0)')
  assert.equal(await color('button'), 'rgb(0, 0, 0)')
  await page.evaluate(() => window.setDark(false))
  await page.waitForFunction(
    (previous) =>
      getComputedStyle(document.querySelector('[data-testid="bare"]')).color !== previous,
    dark,
  )
  assert.equal(await color('nested'), 'rgb(255, 0, 0)')
  assert.equal(
    await page.getByTestId('sized').evaluate((node) => getComputedStyle(node).fontSize),
    '20px',
  )
  console.log(
    'Shared mobile Text: live light/dark theme, explicit colors and nested inheritance pass with real RN Web.',
  )
} finally {
  await browser.close()
}
