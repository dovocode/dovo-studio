import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mocks = {
  'react-native': `export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value),removeItem:async key=>localStorage.removeItem(key)};`,
  '../../runtime/connection/provider': `export const useRuntime=()=>({activeId:window.runtimeId??'computer',legacyDraftRuntimeId:null});`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/theme': `export const useTheme=()=>({styles:{chatText:{}}});`,
  '../../ui/controls/field': `import {useRef,useImperativeHandle,useEffect} from 'react';export function Field({value,defaultValue,inputRef,onChangeText,onSelectionChange,editable,label,style,scrollEnabled}){const input=useRef();useEffect(()=>{window.mounts++},[]);useImperativeHandle(inputRef,()=>({clear:()=>{window.clears++;window.writes.push('');input.current.value=''},setNativeProps:props=>{window.writes.push(props.text);if(props.text!==defaultValue)input.current.value=props.text}}),[]);window.composerLayout=style.at(-1);return <textarea style={{height:style.at(-1).height,minHeight:style.at(-1).minHeight,maxHeight:style.at(-1).maxHeight}} data-scroll-enabled={String(scrollEnabled)} ref={input} aria-label={label} value={value} defaultValue={defaultValue} disabled={!editable} onChange={e=>onChangeText(e.target.value)} onSelect={e=>onSelectionChange({nativeEvent:{selection:{start:e.target.selectionStart,end:e.target.selectionEnd}}})}/>;}`,
}
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState,useCallback} from 'react';
import {ComposerField} from '${root}/apps/mobile/src/tasks/composer/composer-field.tsx';
import {useDraft} from '${root}/apps/mobile/src/tasks/draft/use-draft.ts';
window.mounts=0;window.writes=[];window.clears=0;window.storageText=()=>localStorage.getItem('dovo.draft.computer.task');
function App(){const draft=useDraft('task','Recovered draft');const [echo,setEcho]=useState(null);const [sending,setSending]=useState(false);const [stream,setStream]=useState(0);const type=useCallback(text=>draft.update(text,'keyboard'),[draft.update]);const select=useCallback(()=>{},[]);window.draft=draft;window.echo=text=>flushSync(()=>setEcho(text));window.stream=()=>flushSync(()=>setStream(n=>n+1));window.switchRuntime=id=>{window.runtimeId=id;flushSync(()=>setStream(n=>n+1))};window.apply=text=>flushSync(()=>{setEcho(null);setSending(false);draft.update(text)});window.send=()=>flushSync(()=>{setEcho(null);setSending(true)});window.fail=()=>flushSync(()=>setSending(false));return <div data-stream={stream}><ComposerField key={draft.key} value={echo??(sending?'':draft.text)} revision={JSON.stringify([draft.revision,sending])} onChangeText={type} onSelectionChange={select} editable={draft.ready} showOptions placeholder="Message"/></div>};
createRoot(document.getElementById('app')).render(<App/>);
`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-input',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://composer.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://composer.test')
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Message' })
  await page.waitForFunction(() => window.draft?.ready)
  assert.equal(await input.inputValue(), 'Recovered draft')
  await page.evaluate(() => window.apply('Start end'))
  await input.focus()
  await input.evaluate((e) => e.setSelectionRange(6, 6))
  const typed = 'Fast typing with delayed renders '.repeat(8)
  const writes = await page.evaluate(() => window.writes.length)
  await input.pressSequentially(typed, { delay: 1 })
  const expected = 'Start ' + typed + 'end'
  assert.equal(await input.inputValue(), expected)
  // Replay stale parent acknowledgements and live thread updates after native text is ahead.
  await page.evaluate(() => {
    for (let n = 0; n < 100; n++) {
      window.echo('Start ' + String(n))
      window.stream()
    }
  })
  assert.equal(await input.inputValue(), expected)
  assert.equal(await input.evaluate((e) => e.selectionStart), 6 + typed.length)
  assert.equal(await page.evaluate(() => window.writes.length), writes)
  assert.equal(await page.evaluate(() => window.draft.text), expected)
  await page.waitForFunction((expected) => window.storageText() === expected, expected)
  await page.evaluate(() => window.apply('Mention @src/file.ts and dictated words'))
  assert.equal(await input.inputValue(), 'Mention @src/file.ts and dictated words')
  // Native Fabric owns text measurement; JS must leave height unconstrained so native
  // typing can trigger layout, while retaining the composer bounds and overflow scrolling.
  assert.deepEqual(
    await page.evaluate(() => ({
      height: window.composerLayout.height ?? null,
      minHeight: window.composerLayout.minHeight,
      maxHeight: window.composerLayout.maxHeight,
    })),
    { height: null, minHeight: 44, maxHeight: 144 },
  )
  assert.equal(await input.getAttribute('data-scroll-enabled'), 'true')
  await page.evaluate(() => window.send())
  assert.equal(await input.inputValue(), '')
  assert.equal(await input.evaluate((e) => e.style.height), '')
  await page.evaluate(() => window.fail())
  assert.equal(await input.inputValue(), 'Mention @src/file.ts and dictated words')
  await page.evaluate(() => window.apply(''))
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.mounts), 1)
  await page.evaluate(() => {
    localStorage.setItem('dovo.draft.other.task', 'Other computer draft')
    window.switchRuntime('other')
  })
  await page.waitForFunction(
    () => window.draft?.ready && window.draft.key === 'dovo.draft.other.task',
  )
  assert.equal(await input.inputValue(), 'Other computer draft')
  assert.equal(await page.evaluate(() => window.mounts), 2)
  await page.evaluate(() => window.switchRuntime('computer'))
  await page.waitForFunction(
    () => window.draft?.ready && window.draft.key === 'dovo.draft.computer.task',
  )
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.mounts), 3)
  // Start empty, then type natively: another empty text prop is a no-op in Fabric.
  await input.fill('Fresh message')
  const cleared = await page.evaluate(() => window.clears)
  await page.evaluate(() => window.send())
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.evaluate(() => window.clears), cleared + 1)
  await page.evaluate(() => window.fail())
  assert.equal(await input.inputValue(), 'Fresh message')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile composer: rapid middle-of-draft typing, 100 stale acknowledgements and stream updates preserve text, caret and persistence; external edits, send clearing, failed-send restoration, native measurement constraints, overflow scrolling and computer switching pass.',
  )
} finally {
  await browser.close()
}
