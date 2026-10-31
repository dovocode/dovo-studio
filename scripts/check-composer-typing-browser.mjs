import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ComposerEditor } from './src/chat/composer/composer-editor.tsx';
import { createComposerDraft } from './src/chat/composer/composer-draft.ts';
const frame = window.requestAnimationFrame.bind(window);
window.heldFrames = [];
window.requestAnimationFrame = callback => window.holdFrames ? window.heldFrames.push(callback) : frame(callback);
const controller = createComposerDraft('', () => {}, console.error);
window.parentRenders = 0; window.defaults=0;window.alternatives=0;
window.latencies = [];
document.addEventListener('input', () => { const start = performance.now(); requestAnimationFrame(() => window.latencies.push(performance.now()-start)); });
function Composer() {
  const hasText = useSyncExternalStore(controller.subscribe, () => !!controller.text.trim());
  window.parentRenders++;
  const input = useRef(null);
  const [submitBusy,setSubmitBusy]=useState(false);window.setSubmitBusy=setSubmitBusy;
  const [composingNextDraft,setComposingNextDraft]=useState(false);window.setComposingNextDraft=setComposingNextDraft;
  return <form onSubmit={event=>{event.preventDefault();if(!submitBusy)window.defaults++}}><ComposerEditor onCommand={()=>{window.commands=(window.commands??0)+1}} onAlternativeSubmit={()=>window.alternatives++} controller={controller} taskId="test" messages={[{role:"user",text:"First message"},{role:"assistant",text:"Reply"},{role:"user",text:"Second message"}]} input={input} resources={{skills:[],mcpServers:[]}} autoFocus={false} hidden={false} disabled={false} submitBusy={submitBusy && !composingNextDraft} submittedText={submitBusy?'Queued first':null} placeholder="Message" />
    <button type="submit" disabled={!hasText||submitBusy}>Send</button>{Array.from({length:500},(_,i)=><span key={i}>Control {i}</span>)}</form>;
}
createRoot(document.getElementById('app')).render(<Composer/>);
window.controller = controller;
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'editor-environment',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/(studio-core|studio-ui)$/ }, ({ path }) => ({
          path,
          namespace: 'editor-environment',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'editor-environment' }, ({ path }) => ({
          contents: path.endsWith('studio-core')
            ? `const workspace = {connected:false,request:()=>Promise.reject(new Error('Unexpected discovery'))}; export const useWorkspace = () => workspace; export const useAppPreferences=()=>({sendWith:'enter'}); export const useResolvedTheme=()=> 'dark'; export {studioSyntaxTheme} from '../studio-core/src/themes';`
            : `export {cn} from '../studio-ui/src/lib/utils'; export {ComposerTextarea} from '../studio-ui/src/composer-surface';`,
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
          loader: 'js',
        }))
      },
    },
  ],
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Message task' })
  await input.click()
  const text =
    'Smooth typing keeps the surrounding controls stable while the draft is edited. '.repeat(3)
  await input.pressSequentially(text, { delay: 1 })
  await page.waitForFunction(() => window.latencies.length > 0)
  const result = await page.evaluate(() => ({
    renders: window.parentRenders,
    text: window.controller.text,
    latencies: window.latencies.sort((a, b) => a - b),
  }))
  if (result.text !== text || result.renders !== 2 || errors.length)
    throw new Error(JSON.stringify({ result, errors }))
  const p95 = result.latencies[Math.floor(result.latencies.length * 0.95)]
  if (p95 > 100) throw new Error(`Input-to-frame p95 exceeded 100ms: ${p95}`)
  await input.fill('')
  await page.getByRole('button', { name: 'Send' }).waitFor()
  if (!(await page.getByRole('button', { name: 'Send' }).isDisabled()))
    throw new Error('Empty input did not disable Send')
  await input.press('ArrowUp')
  await page.waitForFunction(() => window.controller.text === 'Second message')
  await input.press('ArrowUp')
  await page.waitForFunction(() => window.controller.text === 'First message')
  await input.press('ArrowUp')
  if ((await input.inputValue()) !== 'First message')
    throw new Error('History moved beyond the oldest message')
  await input.press('ArrowDown')
  await page.waitForFunction(() => window.controller.text === 'Second message')
  await input.press('ArrowDown')
  await page.waitForFunction(() => window.controller.text === '')
  await input.fill('Keep my draft')
  await input.evaluate((element) => element.setSelectionRange(0, 0))
  await input.press('ArrowUp')
  if ((await input.inputValue()) !== 'Keep my draft')
    throw new Error('History replaced a typed draft')
  await input.fill('')
  await page.evaluate(() => {
    window.holdFrames = true
  })
  await input.press('ArrowUp')
  await page.waitForFunction(() => window.controller.text === 'Second message')
  await input.fill('Edited recalled message')
  await page.evaluate(() => {
    window.holdFrames = false
    for (const callback of window.heldFrames.splice(0)) callback(performance.now())
  })
  if (
    (await input.evaluate((element) => element.selectionStart)) !== 'Edited recalled message'.length
  )
    throw new Error('A delayed history cursor reset moved the caret after editing')
  await input.evaluate((element) => element.setSelectionRange(0, 0))
  await input.press('ArrowUp')
  if ((await input.inputValue()) !== 'Edited recalled message')
    throw new Error('History replaced an edited message')
  for (const shape of [{ isComposing: true }, { keyCode: 229 }]) {
    await input.fill('')
    await input.evaluate(
      (element, shape) =>
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
            cancelable: true,
            ...shape,
          }),
        ),
      shape,
    )
    if ((await input.inputValue()) !== '')
      throw new Error('IME candidate navigation recalled history')
    await input.fill('Candidate')
    for (const altKey of [false, true])
      await input.evaluate(
        (element, options) =>
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true,
              ...options,
            }),
          ),
        { ...shape, altKey },
      )
    if ((await page.evaluate(() => window.defaults + window.alternatives)) !== 0)
      throw new Error('IME candidate confirmation submitted')
    await input.fill('/')
    const menu = page.getByRole('listbox', { name: 'Commands and skills' })
    await menu.waitFor()
    const selected = await input.getAttribute('aria-activedescendant')
    for (const key of ['ArrowDown', 'Enter', 'Tab', 'Escape'])
      await input.evaluate(
        (element, options) =>
          element.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }),
          ),
        { ...shape, key },
      )
    if (
      (await input.inputValue()) !== '/' ||
      (await input.getAttribute('aria-activedescendant')) !== selected ||
      !(await menu.isVisible())
    )
      throw new Error('IME candidate keys changed mentions')
  }
  await input.press('Enter')
  await page.waitForFunction(() => window.commands === 1)
  if ((await page.evaluate(() => window.defaults)) !== 0)
    throw new Error('Mention selection submitted the form')
  await input.fill('Keyboard guidance')
  await input.press('Enter')
  await input.press('Alt+Enter')
  const counts = await page.evaluate(() => ({
    defaults: window.defaults,
    alternatives: window.alternatives,
  }))
  if (counts.defaults !== 1 || counts.alternatives !== 1) throw new Error(JSON.stringify(counts))
  await input.press('Shift+Enter')
  if (!(await input.inputValue()).includes('\n'))
    throw new Error('Shift+Enter did not insert a line')
  await page.evaluate(() => {
    window.controller.update('')
    window.setSubmitBusy(true)
    window.setComposingNextDraft(true)
  })
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea')
    return input && !input.readOnly && input.value === ''
  })
  await input.fill('Second queued prompt')
  if ((await page.evaluate(() => window.controller.text)) !== 'Second queued prompt')
    throw new Error('The real editor did not allow the next draft during a queued send')
  await input.press('Enter')
  if ((await page.evaluate(() => window.defaults)) !== 1)
    throw new Error('Typing the next draft bypassed the pending-send lock')
  await page.evaluate(() => window.setComposingNextDraft(false))
  await page.waitForFunction(() => document.querySelector('textarea').readOnly)
  await page.evaluate(() => window.setSubmitBusy(false))
  if ((await input.inputValue()) !== 'Second queued prompt')
    throw new Error('Completing the send replaced the newer draft')
  console.log(
    'Enter submits the default and Alt+Enter submits the alternative without a duplicate submission.',
  )
  console.log(
    `Typed ${text.length} characters without losing text; composer parent rendered twice; input-to-frame p95 ${p95.toFixed(1)}ms.`,
  )
} finally {
  await browser.close()
}
