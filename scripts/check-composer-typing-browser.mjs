import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useRef, useSyncExternalStore } from 'react';
import { ComposerEditor } from './src/chat/composer/composer-editor.tsx';
import { createComposerDraft } from './src/chat/composer/composer-draft.ts';
const controller = createComposerDraft('', () => {}, console.error);
window.parentRenders = 0;
window.latencies = [];
document.addEventListener('input', () => { const start = performance.now(); requestAnimationFrame(() => window.latencies.push(performance.now()-start)); });
function Composer() {
  const hasText = useSyncExternalStore(controller.subscribe, () => !!controller.text.trim());
  window.parentRenders++;
  const input = useRef(null);
  return <><ComposerEditor controller={controller} taskId="test" input={input} resources={{skills:[],mcpServers:[]}} autoFocus={false} hidden={false} disabled={false} submitBusy={false} submittedText={null} placeholder="Message" />
    <button disabled={!hasText}>Send</button>{Array.from({length:500},(_,i)=><span key={i}>Control {i}</span>)}</>;
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
  console.log(
    `Typed ${text.length} characters without losing text; composer parent rendered twice; input-to-frame p95 ${p95.toFixed(1)}ms.`,
  )
} finally {
  await browser.close()
}
