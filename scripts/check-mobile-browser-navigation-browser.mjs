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
      contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';import {BrowserNavigation} from './src/browser/browser-navigation';function App(){const [address,setAddress]=useState('http://100.64.0.2:3000/'+ 'long-path/'.repeat(60));const [disabled,setDisabled]=useState(false);window.setDisabled=setDisabled;return <View style={{height:'100%',justifyContent:'flex-end'}}><BrowserNavigation address={address} onAddress={setAddress} onEditing={value=>window.editing=value} onNavigate={()=>window.sent=address} changed back forward disabled={disabled} tabs={12} onTabs={()=>window.tabs=true} onOptions={()=>window.options=true} onBack={()=>window.back=true} onForward={()=>window.forward=true}/></View>}createRoot(document.getElementById('app')).render(<App/>);`,
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
    },
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  },
  [
    {
      path: '../ui/layout/glass',
      importer: mobile + '/src/browser',
      contents: "export {View as Glass} from 'react-native'",
    },
    {
      path: '../ui/content/text',
      importer: mobile + '/src/browser',
      contents: "export {Text} from 'react-native'",
    },
    {
      path: '../ui/theme',
      importer: mobile + '/src/browser',
      contents: "export const useTheme=()=>({colors:{text:'#eee',muted:'#999',accent:'#9cf'}})",
    },
    {
      path: '../ui/controls/icon-button',
      importer: mobile + '/src/browser',
      contents: `import {Pressable,Text} from 'react-native';export const IconButton=({label,onPress,disabled})=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{width:44,height:44,flexShrink:0}}><Text>·</Text></Pressable>`,
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const width of [320, 390, 440, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } })
    await page.setContent(
      '<style>html,body,#app{margin:0;height:100%;width:100%;background:#111}</style><div id="app"></div>',
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const input = page.getByLabel('Search or enter address', { exact: true })
    await input.waitFor()
    const bar = page.getByLabel('Browser navigation', { exact: true })
    const before = await bar.boundingBox()
    assert.ok(before.height <= 66)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Forward', exact: true }).click()
    await page.getByRole('button', { name: 'Tabs (12)', exact: true }).click()
    await page.getByRole('button', { name: 'Browser options', exact: true }).click()
    assert.deepEqual(
      await page.evaluate(() => [window.back, window.forward, window.tabs, window.options]),
      [true, true, true, true],
    )
    const full = await input.inputValue()
    assert.ok(full.length > 500)
    const submit = page.getByRole('button', { name: 'Go', exact: true })
    const submitFrame = await submit.boundingBox()
    await input.click()
    assert.equal(await page.evaluate(() => window.editing), true)
    assert.equal(await input.inputValue(), full)
    assert.ok((await input.boundingBox()).width >= width - 156)
    assert.deepEqual(await submit.boundingBox(), submitFrame, 'Go stays in place while editing')
    await input.fill('http://100.64.0.2:3000/edited')
    await input.press('Enter')
    assert.equal(await page.evaluate(() => window.sent), 'http://100.64.0.2:3000/edited')
    await input.fill('http://100.64.0.2:3000/button')
    await submit.click()
    await page.waitForFunction(() => window.editing === false)
    assert.equal(await page.evaluate(() => window.sent), 'http://100.64.0.2:3000/button')
    assert.equal(await input.inputValue(), 'http://100.64.0.2:3000/button')
    assert.deepEqual(await bar.boundingBox(), before)
    await page.evaluate(() => window.setDisabled(true))
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Back"]')?.getAttribute('aria-disabled') === 'true',
    )
    await page
      .getByRole('button', { name: 'Back', exact: true })
      .isDisabled()
      .then((value) => assert.equal(value, true))
    assert.equal(await page.getByRole('button', { name: 'Go', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.close()
  }
  console.log(
    'Browser navigation: compact single row, narrow layouts, full URL editing, HTTP, focus, actions and disabled controls pass with native rendering adapters.',
  )
} finally {
  await browser.close()
}
