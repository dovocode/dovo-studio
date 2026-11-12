import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

// Check the real .native.tsx adapter. Expo/RN are replaced only at the native event boundary.
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  expo: `export const requireOptionalNativeModule=()=>window.moduleAvailable?{supportsReferenceMessages:window.messageSupport,supportsDraftSnapshot:window.snapshotSupport,blur:async()=>{window.blurs++}}:null;
import {useImperativeHandle} from 'react';export const requireNativeView=()=>props=>{useImperativeHandle(props.ref,()=>({readText:()=>window.readNative?window.readNative():Promise.resolve(window.snapshot)}));window.nativeProps=props;window.nativeRenders++;return <div data-testid="native-input"/>};`,
  'react-native': `export const Keyboard={dismiss:()=>window.dismissals++};export const useWindowDimensions=()=>({fontScale:1.5});`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const carZoom=1.4;`,
  '../../ui/theme': `export const useTheme=()=>({colors:{text:'#fff',muted:'#aaa',surface:'#222'}});`,
}
const result = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState,useRef} from 'react';
import {NativeComposerInput,NativeReferenceMessage,nativeComposerAvailable,nativeReferenceMessagesAvailable,dismissComposerKeyboard} from './apps/mobile/src/tasks/composer/native-composer-input.native';
import {resolveScopedAgents,messageReferences} from '@dovo/protocol';
window.available=nativeComposerAvailable;window.messageAvailable=nativeReferenceMessagesAvailable;window.dismiss=dismissComposerKeyboard;
const resources={skills:[{name:'review'}],mcpServers:[{name:'docs',enabled:true}],agents:resolveScopedAgents(undefined,undefined,[])};
function App(){const input=useRef();window.read=()=>input.current.readText();const [value,setValue]=useState('🚀 @src/file.ts $review @docs '+String.fromCharCode(96)+'model:agent%3Adovo%3Acodex/gpt'+String.fromCharCode(96)+' ');const [revision,setRevision]=useState('first');
const [message,setMessage]=useState(false);window.showMessage=()=>setMessage(true);
window.external=text=>flushSync(()=>{setRevision('next');setValue(text)});
if(message){const text='🚀 @src/file.ts https://github.com/team/repo/pull/42';const start=text.indexOf('https:');return <NativeReferenceMessage text={text} references={messageReferences(text,resources)} links={[{start,end:text.length,url:text.slice(start)}]} onLink={url=>window.link=url}/>}
return <NativeComposerInput inputRef={input} value={value} revision={revision} resources={resources} expanded={false} focusKey="focus-1" editable placeholder="Message" onChangeText={setValue} onSelectionChange={value=>window.selection=value}/>}
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
  for (const [moduleAvailable, messageSupport, snapshotSupport] of [
    [true, true, true],
    [true, false, false],
    [false, false, false],
  ]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.evaluate((available) => {
      window.moduleAvailable = available
      window.messageSupport = false
      window.nativeRenders = 0
      window.blurs = 0
      window.dismissals = 0
    }, moduleAvailable)
    await page.evaluate((value) => {
      window.messageSupport = value
    }, messageSupport)
    await page.evaluate((value) => (window.snapshotSupport = value), snapshotSupport)
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.waitForFunction(() => typeof window.available === 'boolean')
    assert.equal(await page.evaluate(() => window.available), moduleAvailable && snapshotSupport)
    assert.equal(await page.evaluate(() => window.messageAvailable), messageSupport)
    if (moduleAvailable) {
      await page.waitForFunction(() => !!window.nativeProps)
      assert.deepEqual(
        await page.evaluate(() => window.nativeProps.content.references.map(({ kind }) => kind)),
        ['file', 'skill', 'mcp', 'model'],
      )
      assert.equal(await page.evaluate(() => window.nativeProps.content.references[0].start), 3)
      assert.ok(
        await page.evaluate(() =>
          window.nativeProps.content.references.every((reference) =>
            reference.icon?.startsWith('iVBOR'),
          ),
        ),
      )
      const model = await page.evaluate(() => window.nativeProps.content.references[3])
      assert.equal(model.provider, 'codex')
      assert.ok(model.icon.startsWith('iVBOR'), 'The native bridge must receive bundled PNG data')
      assert.equal(model.iconTemplate, true)
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
      assert.equal(
        await page.evaluate(async () => {
          window.snapshot = {
            text: 'Full native text 🚀 after queued keyboard events',
            eventCount: 9,
            revision: 'first',
          }
          return window.read()
        }),
        'Full native text 🚀 after queued keyboard events',
      )
      await page.waitForFunction(() => window.nativeProps.content.eventCount === 9)
      await page.evaluate(() =>
        window.nativeProps.onTextChange({
          nativeEvent: { text: 'Partial stale event', eventCount: 8 },
        }),
      )
      assert.equal(
        await page.evaluate(() => window.nativeProps.content.text),
        'Full native text 🚀 after queued keyboard events',
      )
      // A read that crosses an external draft change must fail rather than submit another draft.
      assert.match(
        await page.evaluate(async () => {
          let finish
          window.readNative = () => new Promise((resolve) => (finish = resolve))
          const reading = window.read()
          window.external('replacement')
          finish({ text: 'old input', eventCount: 9, revision: 'first' })
          try {
            await reading
            return 'unexpected success'
          } catch (error) {
            return error.message
          } finally {
            window.readNative = null
          }
        }),
        /changed before sending/,
      )
      await page.evaluate(() => window.external(''))
      await page.evaluate(() =>
        window.nativeProps.onTextChange({
          nativeEvent: { text: 'Full native text 🚀 after queued keyboard events', eventCount: 9 },
        }),
      )
      assert.deepEqual(await page.evaluate(() => window.nativeProps.content), {
        text: '',
        revision: 'next',
        eventCount: 9,
        references: [],
      })
      await page.evaluate(() => window.showMessage())
      await page.waitForFunction(() => window.nativeProps.displayOnly === true)
      assert.equal(await page.evaluate(() => window.nativeProps.editable), false)
      assert.equal(await page.evaluate(() => window.nativeProps.messageFontSize), 25.5)
      assert.equal(await page.evaluate(() => window.nativeProps.messageLineHeight), 37.5)
      assert.equal(await page.evaluate(() => window.nativeProps.content.references[0].start), 3)
      assert.equal(await page.evaluate(() => window.nativeProps.content.links[0].start), 16)
      assert.ok(
        await page.evaluate(() =>
          window.nativeProps.content.references[0].icon.startsWith('iVBOR'),
        ),
      )
      await page.evaluate(() => window.nativeProps.onSize({ nativeEvent: { height: 999 } }))
      await page.waitForFunction(() => window.nativeProps.style.height === 999)
      await page.evaluate(() =>
        window.nativeProps.onLink({ nativeEvent: { url: 'https://github.com/team/repo/pull/42' } }),
      )
      assert.equal(await page.evaluate(() => window.link), 'https://github.com/team/repo/pull/42')
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
