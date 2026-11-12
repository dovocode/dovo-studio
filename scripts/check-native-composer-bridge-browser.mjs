import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

// Check the real .native.tsx adapter. Expo/RN are replaced only at the native event boundary.
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  expo: `export const requireOptionalNativeModule=()=>window.moduleAvailable?{blur:async()=>{window.blurs++}}:null;
export const requireNativeView=()=>props=>{window.nativeProps=props;window.nativeRenders++;return <div data-testid="native-input"/>};`,
  'react-native': `export const Keyboard={dismiss:()=>window.dismissals++};`,
  '../../ui/theme': `export const useTheme=()=>({colors:{text:'#fff',muted:'#aaa',surface:'#222'}});`,
}
const result = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';
import {NativeComposerInput,nativeComposerAvailable,dismissComposerKeyboard} from './apps/mobile/src/tasks/composer/native-composer-input.native';
window.available=nativeComposerAvailable;window.dismiss=dismissComposerKeyboard;
const resources={skills:[{name:'review'}],mcpServers:[{name:'docs',enabled:true}]};
function App(){const [value,setValue]=useState('🚀 @src/file.ts $review @docs '+String.fromCharCode(96)+'model:codex/gpt'+String.fromCharCode(96)+' ');const [revision,setRevision]=useState('first');
window.external=text=>flushSync(()=>{setRevision('next');setValue(text)});
return <NativeComposerInput value={value} revision={revision} resources={resources} expanded={false} focusKey="focus-1" editable placeholder="Message" onChangeText={setValue} onSelectionChange={value=>window.selection=value}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-boundary',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'native-boundary' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  for (const moduleAvailable of [true, false]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.evaluate((available) => {
      window.moduleAvailable = available
      window.nativeRenders = 0
      window.blurs = 0
      window.dismissals = 0
    }, moduleAvailable)
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.waitForFunction(() => typeof window.available === 'boolean')
    assert.equal(await page.evaluate(() => window.available), moduleAvailable)
    if (moduleAvailable) {
      await page.waitForFunction(() => !!window.nativeProps)
      assert.deepEqual(
        await page.evaluate(() => window.nativeProps.content.references.map(({ kind }) => kind)),
        ['file', 'skill', 'mcp', 'model'],
      )
      assert.equal(await page.evaluate(() => window.nativeProps.content.references[0].start), 3)
      await page.evaluate(() =>
        window.nativeProps.onTextChange({
          nativeEvent: { text: 'Fast native typing 🚀', eventCount: 7 },
        }),
      )
      await page.waitForFunction(() => window.nativeProps.content.eventCount === 7)
      assert.equal(
        await page.evaluate(() => window.nativeProps.content.text),
        'Fast native typing 🚀',
      )
      await page.evaluate(() =>
        window.nativeProps.onSourceSelection({ nativeEvent: { start: 4, end: 7 } }),
      )
      assert.deepEqual(await page.evaluate(() => window.selection), { start: 4, end: 7 })
      await page.evaluate(() => window.nativeProps.onSize({ nativeEvent: { height: 999 } }))
      await page.waitForFunction(() => window.nativeProps.style.height === 144)
      await page.evaluate(() => window.external(''))
      assert.deepEqual(await page.evaluate(() => window.nativeProps.content), {
        text: '',
        revision: 'next',
        eventCount: 7,
        references: [],
      })
    } else assert.equal(await page.locator('[data-testid="native-input"]').count(), 0)
    await page.evaluate(() => window.dismiss())
    assert.equal(await page.evaluate(() => window.dismissals), 1)
    assert.equal(await page.evaluate(() => window.blurs), moduleAvailable ? 1 : 0)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Native composer JS bridge: descriptors, event acknowledgements, source selection, height, external clear, keyboard dismissal and missing-module fallback passed.',
  )
} finally {
  await browser.close()
}
