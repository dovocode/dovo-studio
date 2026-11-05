import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'

// The real composer editor in rich text mode, with its Markdown source toggle.
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ComposerEditor } from './src/chat/composer/composer-editor.tsx';
import { ComposerModeToggle } from './src/chat/composer/composer-mode.tsx';
import { createComposerDraft } from './src/chat/composer/composer-draft.ts';
const controller = createComposerDraft('', () => {}, console.error);
window.editorRenders = 0; window.controller = controller; window.submits = []; window.alternatives = 0; window.commands = [];
const messages = [{ role: 'user', text: 'First message' }, { role: 'user', text: 'Second **message**' }];
const resources = { skills: [], mcpServers: [] };
const history = () => messages;
const command = id => window.commands.push(id);
const alternative = () => window.alternatives++;
function Composer() {
  const [menu, setMenu] = useState(false); window.setMenuMode = setMenu;
  const [tick, setTick] = useState(0); window.runtimeTick = () => setTick(value => value + 1);
  const input = useRef(null);
  const hasText = useSyncExternalStore(controller.subscribe, () => !!controller.text.trim());
  return <form data-runtime-tick={tick} onSubmit={event => { event.preventDefault(); window.submits.push(controller.text) }}>
    <ComposerModeToggle input={input} menu={menu} />
    <ComposerEditor controller={controller} taskId="task" input={input} resources={resources}
      messages={history} onCommand={command} onAlternativeSubmit={alternative}
      autoFocus={false} hidden={false} disabled={false} submitBusy={false} submittedText={null} placeholder="Message" />
    <button type="submit" disabled={!hasText}>Send</button>
  </form>;
}
createRoot(document.getElementById('app')).render(<Composer />);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'rich-composer-environment',
      setup(builder) {
        builder.onLoad({ filter: /composer-editor\.tsx$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replace(
            '  const draft = useSyncExternalStore(',
            '  window.editorRenders++;\n  const draft = useSyncExternalStore(',
          ),
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /^@dovo\/(studio-core|studio-ui)$/ }, ({ path }) => ({
          path,
          namespace: 'rich-composer-environment',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'rich-composer-environment' }, ({ path }) => ({
          contents: path.endsWith('studio-core')
            ? `import { useSyncExternalStore } from 'react';
const listeners = new Set(); let preferences = { sendWith: 'enter', richTextComposer: true, showSkillsInSlashMenu: true };
export const readAppPreferences = () => preferences;
export const updateAppPreferences = changes => { preferences = { ...preferences, ...changes }; listeners.forEach(listener => listener()) };
export const useAppPreferences = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => preferences);
const workspace = { connected: false, request: () => Promise.reject(new Error('Unexpected request')) };
export const useWorkspace = () => workspace;
export const useWorkspaceSelector = select => select(workspace);
export const sameWorkspaceFields = (a, b) => Object.keys(b).every(key => Object.is(a[key], b[key]));
export const useResolvedTheme = () => 'dark';`
            : `export { cn } from '../studio-ui/src/lib/utils'; export { ComposerTextarea } from '../studio-ui/src/composer-surface';
export const Button = ({ children, variant, ...props }) => <button {...props}>{children}</button>;
export const IconButton = ({ label, children, ...props }) => <button aria-label={label} {...props}>{children}</button>;`,
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
          loader: 'tsx',
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
  const editorCSS = await readFile(
    new URL('../packages/extension-tasks/src/styles.css', import.meta.url),
    'utf8',
  )
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: editorCSS.replace(/^@import.*$/gm, '') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const text = () => page.evaluate(() => window.controller.text)
  const setDraft = (value) => page.evaluate((value) => window.controller.update(value), value)
  const editor = page.locator('[contenteditable="true"][aria-label="Message thread"]')
  const source = page.locator('textarea[aria-label="Message thread"]')
  await editor.waitFor()
  assert.equal(
    await editor.evaluate((el) => getComputedStyle(el, '::before').content),
    '"Message"',
    'An empty rich editor shows its writing prompt',
  )
  assert.equal(
    await editor.evaluate((el) => getComputedStyle(el, '::before').whiteSpace),
    'nowrap',
    'The empty writing prompt cannot wrap into a clipped second line',
  )
  const initialRenders = await page.evaluate(() => window.editorRenders)
  assert(initialRenders > 0)
  for (let index = 0; index < 10; index++)
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.runtimeTick()
          requestAnimationFrame(resolve)
        }),
    )
  assert.equal(await page.locator('form').getAttribute('data-runtime-tick'), '10')
  assert.equal(
    await page.evaluate(() => window.editorRenders),
    initialRenders,
    'Unrelated runtime updates rerendered the editor',
  )

  // Formatting shortcuts produce Markdown; literal Markdown characters stay literal.
  await editor.click()
  await page.keyboard.type('Hello ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('bold')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('- not a list and 2 * 3')
  assert.match(await text(), /^Hello  ?\*\*bold\*\*\n\\- not a list and 2 \* 3$/)
  // Chrome may move the typed space into the bold run; the Markdown still expels it.
  assert.equal((await editor.locator('strong').textContent()).trim(), 'bold')

  // Typed Markdown block and inline shortcuts.
  await setDraft('')
  await editor.click()
  await page.keyboard.type('## Plan')
  await page.keyboard.press('Enter')
  assert.deepEqual(await page.evaluate(() => window.submits), ['## Plan'])
  assert.equal(await editor.locator('h2').textContent(), 'Plan')
  await setDraft('')
  await page.keyboard.type('- first')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('use `npm test` now')
  assert.equal(await text(), '- first\n- use `npm test` now')

  // Untouched blocks keep their exact source when another block is edited.
  const original = '# Title\n\n\n* keep_this  *exact*  \n\nedit me'
  await setDraft(original)
  await editor.locator('p', { hasText: 'edit me' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  assert.equal(await text(), original + '!')

  // Enter sends, Alt+Enter uses the alternative action, and Shift+Enter adds a line.
  await setDraft('Ship it')
  await editor.click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Alt+Enter')
  assert.deepEqual((await page.evaluate(() => window.submits)).at(-1), 'Ship it')
  assert.equal(await page.evaluate(() => window.alternatives), 1)
  assert.equal(await text(), 'Ship it')

  // The toggle shows the exact source and keeps focus and the caret; the shortcut switches back.
  await setDraft('# Title\n\nSome **bold** words')
  await editor.locator('strong').click()
  await page.keyboard.press('End')
  await page.getByRole('button', { name: /Markdown source/ }).click()
  await source.waitFor()
  assert.equal(await source.inputValue(), '# Title\n\nSome **bold** words')
  assert.equal(await source.evaluate((element) => element === document.activeElement), true)
  assert.equal(await source.evaluate((element) => element.selectionStart), 28)
  await source.evaluate((element) => element.setSelectionRange(4, 4))
  await page.keyboard.press('ControlOrMeta+Shift+m')
  await editor.waitFor()
  await page.keyboard.type('X')
  assert.equal(await text(), '# TiXtle\n\nSome **bold** words')

  // The + menu action preserves the draft and supports switching back with the shortcut.
  await page.evaluate(() => window.setMenuMode(true))
  await editor.focus()
  const beforeMenu = await text()
  const menuToggle = page.getByRole('button', { name: 'Markdown source', exact: true })
  await menuToggle.click()
  await source.waitFor()
  assert.equal(await source.inputValue(), beforeMenu)
  assert.equal(await menuToggle.getAttribute('aria-pressed'), 'true')
  await source.press('ControlOrMeta+Shift+m')
  await editor.waitFor()
  assert.equal(await text(), beforeMenu)
  await page.evaluate(() => window.setMenuMode(false))

  // History recall works from the start of the rich editor.
  await setDraft('')
  await editor.click()
  await page.keyboard.press('ArrowUp')
  assert.equal(await text(), 'Second **message**')
  assert.equal(await editor.locator('strong').textContent(), 'message')
  await page.keyboard.press('ArrowUp')
  assert.equal(await text(), 'First message')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  assert.equal(await text(), '')

  // Slash commands open from the rich editor and remove their text when chosen.
  await page.keyboard.type('Before')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('/comp')
  await page.getByRole('listbox', { name: 'Commands and skills' }).waitFor()
  await page.keyboard.press('Enter')
  assert.deepEqual(await page.evaluate(() => window.commands), ['compact'])
  assert.equal(await text(), 'Before')
  // Choosing with Enter does not also send.
  assert.equal(await page.evaluate(() => window.submits.length), 2)

  // Plain-text paste stays literal, with single newlines kept as line breaks.
  await setDraft('')
  await editor.click()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'trace:\nsrc/__tests__/a_b.ts:3')
    document
      .querySelector('[contenteditable="true"]')
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
  })
  const pasted = await text()
  assert.equal(await editor.innerText(), 'trace:\nsrc/__tests__/a_b.ts:3')
  assert.match(pasted, /^trace:\nsrc\/.*a_b\.ts:3$/)

  // Markdown the rich editor cannot preserve stays in source mode until the draft is cleared.
  const table = '| a | b |\n| - | - |\n| 1 | 2 |'
  await setDraft(table)
  await source.waitFor()
  await page.getByRole('status').filter({ hasText: 'Editing Markdown source' }).waitFor()
  assert.equal(await source.inputValue(), table)
  await source.fill('plain now')
  assert.equal(await source.count(), 1)
  await setDraft('')
  await editor.waitFor()
  assert.deepEqual(errors, [])
  console.log('Rich composer browser checks passed')
} finally {
  await browser.close()
}
