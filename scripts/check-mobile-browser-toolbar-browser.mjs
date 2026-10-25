import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile'
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const stubs = [
  {
    path: '../../runtime/state/application-state',
    importer: mobile,
    contents: "export {useState as useApplicationState} from 'react'",
  },
  {
    path: '../../ui/layout/glass',
    importer: mobile,
    contents: "export {View as Glass} from 'react-native'",
  },
  { path: '../../ui/controls/icon', importer: mobile, contents: 'export const Icon=()=>null' },
  { path: './icon', importer: mobile + '/src/ui/controls', contents: 'export const Icon=()=>null' },
  {
    path: '../../ui/controls/icon-button',
    importer: mobile,
    contents: `import {Pressable,Text} from 'react-native';export const IconButton=({label,onPress,disabled})=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{width:44,height:44,flexShrink:0,alignItems:'center',justifyContent:'center'}}><Text>·</Text></Pressable>`,
  },
  {
    path: './browser-menu',
    importer: mobile,
    contents: `import {Pressable,Text} from 'react-native';export const BrowserMenu=({items,onChange})=>{window.items=items;window.choose=onChange;return <Pressable accessibilityRole="button" accessibilityLabel="Browser options" style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Text>•••</Text></Pressable>}`,
  },
  {
    path: '../content/text',
    importer: mobile + '/src/ui/controls',
    contents: "export {Text} from 'react-native'",
  },
  {
    path: '../../ui/content/text',
    importer: mobile,
    contents: "export {Text} from 'react-native'",
  },
  { path: '../../ui/theme', importer: mobile, contents: "export {useTheme} from './src/ui/theme'" },
]
// Use the real RN Web layout, Field and theme; native glass and SwiftUI button rendering
// are boundaries, verified separately on iOS. Their fixed 44px frames match IconButton.
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';import {BrowserToolbar} from './src/tasks/preview/browser-toolbar';function App(){const [url,setUrl]=useState('https://www.google.com/sorry/index?continue='+encodeURIComponent('https://www.google.com/search?q=very-long-address'.repeat(12)));window.setUrl=setUrl;const insets=window.insets;return <View style={{height:'100%',justifyContent:'flex-end',backgroundColor:'#111',paddingLeft:insets.left,paddingRight:insets.right,paddingBottom:insets.bottom}}><BrowserToolbar address={url} onAddress={setUrl} onNavigate={()=>window.navigated=url} back={false} forward={false} onBack={()=>{}} onForward={()=>{}} onReload={()=>{}} preset="fill" onPreset={()=>{}} onRotate={()=>{}} onScreenshot={()=>{}} onKeyboard={()=>{}} mode="remote" onMode={mode=>window.mode=mode} onExpand={()=>window.expanded=true} onExternal={()=>window.external=true}/></View>}createRoot(document.getElementById('app')).render(<App/>);`,
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
  stubs,
)
const browser = await chromium.launch()
try {
  // Model the route/native boundary's consumed insets; real UIKit is checked on device.
  for (const { width, height, insets } of [
    ...[320, 390, 440, 768].map((width) => ({
      width,
      height: 850,
      insets: { left: 0, right: 0, bottom: 34 },
    })),
    { width: 844, height: 390, insets: { left: 62, right: 62, bottom: 21 } },
    { width: 390, height: 500, insets: { left: 0, right: 0, bottom: 0 } },
  ]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(
      '<style>html,body,#app{margin:0;height:100%;width:100%}</style><div id="app"></div>',
    )
    await page.evaluate((insets) => {
      window.insets = insets
    }, insets)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const field = page.getByRole('textbox', { name: 'Preview URL', exact: true })
    await field.waitFor()
    const before = await page.getByLabel('Browser navigation').boundingBox()
    assert.ok(before.height <= 110, 'Compact toolbar height at ' + width + ': ' + before.height)
    assert.equal(before.x, insets.left)
    assert.equal(before.width, width - insets.left - insets.right)
    assert.equal(before.y + before.height, height - insets.bottom)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.equal(await field.getAttribute('type'), 'url')
    const value = await field.inputValue()
    assert.ok(value.length > 400)
    await field.click()
    assert.equal(await field.inputValue(), value)
    assert.deepEqual(
      await page.getByLabel('Browser navigation').boundingBox(),
      before,
      'Focus keeps layout stable',
    )
    await field.fill('http://100.64.0.2:3000/a-very-long-path')
    await page.getByRole('button', { name: 'Go to address' }).click()
    assert.equal(
      await page.evaluate(() => window.navigated),
      'http://100.64.0.2:3000/a-very-long-path',
    )
    assert.deepEqual(
      await page.getByLabel('Browser navigation').boundingBox(),
      before,
      'Submitting keeps layout stable',
    )
    await page.evaluate(() => window.choose('mode'))
    assert.equal(await page.evaluate(() => window.mode), 'web')
    await page.evaluate(() => window.choose('expand'))
    assert.equal(await page.evaluate(() => window.expanded), true)
    await page.evaluate(() => window.choose('external'))
    assert.equal(await page.evaluate(() => window.external), true)
    await page.screenshot({
      path: root + 'work/browser-compact/toolbar-' + width + '-' + height + '.png',
    })
    await page.close()
  }
  console.log(
    'Real RN Web layout: long URLs, compact height, no overflow, stable focus/submit, HTTP and mode/external actions passed with portrait, landscape and keyboard-sized safe content areas.',
  )
} finally {
  await browser.close()
}
