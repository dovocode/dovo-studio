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
import { useRef, useState, useMemo, useSyncExternalStore } from 'react';
import { ComposerEditor } from './src/chat/composer/composer-editor.tsx';
import { ComposerModeToggle } from './src/chat/composer/composer-mode.tsx';
import { createComposerDraft } from './src/chat/composer/composer-draft.ts';
import { selectComposerInput, composerSelection } from './src/chat/composer/composer-input.ts';
const controller = createComposerDraft('', () => {}, console.error);
window.editorRenders = 0; window.controller = controller; window.submits = []; window.alternatives = 0; window.commands = [];
const messages = [{ role: 'user', text: 'First message' }, { role: 'user', text: 'Second **message**' }];
const resources = { skills: [{ name: 'review', enabled: true }], mcpServers: [{ name: 'docs', enabled: true }], agents: [{ id: 'work', provider: 'claude' }] };
const history = () => messages;
const command = id => window.commands.push(id);
const alternative = () => window.alternatives++;
const dismissSuggestion = () => window.setSuggestion('');
function Composer() {
  const [agents,setAgents] = useState(resources.agents); window.setReferenceAgents = setAgents;
  const chipResources = useMemo(() => ({...resources,agents}), [agents]);
  const [suggestion,setSuggestion] = useState(''); window.setSuggestion = setSuggestion;
  const [provider,setProvider] = useState('codex'); window.setGoalProvider = setProvider;
  const [menu, setMenu] = useState(false); window.setMenuMode = setMenu;
  const [tick, setTick] = useState(0); window.runtimeTick = () => setTick(value => value + 1);
  const input = useRef(null);
  window.selectSource = (start, end = start) => { input.current.focus(); selectComposerInput(input.current, start, end) };
  window.sourceSelection = () => composerSelection(input.current, 0);
  const hasText = useSyncExternalStore(controller.subscribe, () => !!controller.text.trim());
  return <form data-suggestion={suggestion} data-has-text={hasText} data-runtime-tick={tick} onSubmit={event => { event.preventDefault(); window.submits.push(controller.text) }}>
    <ComposerModeToggle input={input} menu={menu} />
    <ComposerEditor provider={provider} controller={controller} taskId="task" input={input} resources={chipResources}
      suggestion={suggestion} onDismissSuggestion={dismissSuggestion}
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
            ? `export { composerCaretRecoveryKey } from '../studio-core/src/workspace/composer-recovery';
import { useSyncExternalStore } from 'react';
const listeners = new Set(); let preferences = { sendWith: 'enter', richTextComposer: true, showSkillsInSlashMenu: true };
export const readAppPreferences = () => preferences;
export const updateAppPreferences = changes => { preferences = { ...preferences, ...changes }; listeners.forEach(listener => listener()) };
export const useAppPreferences = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => preferences);
const workspace = { connected: false, snapshot: { modelMentionsSupported: true }, request: async path => { if(path === '/api/tasks/files')return {files:[]}; if(path === '/api/agents/model-mentions'){ if(window.failCatalog)throw Error('Catalog temporarily unavailable'); return {models:[{name:'GPT Exact',provider:'Codex',model:'gpt/exact',reference:'model:harness%3Acodex/gpt%2Fexact'}],unavailable:[]}; } throw Error('Unexpected request') } }; window.workspace = workspace;
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

  for (const provider of ['codex', 'claude']) {
    await page.evaluate((value) => window.setGoalProvider(value), provider)
    await setDraft('/go')
    await editor.click()
    await page.keyboard.press('End')
    await page.getByRole('listbox', { name: 'Commands and skills' }).waitFor()
    await page.keyboard.press('Enter')
    assert.equal(await text(), '/goal ')
    assert.deepEqual(await page.evaluate(() => window.commands), ['compact'])
    assert.equal(await page.evaluate(() => window.submits.length), 2)
  }

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
  // Suggestions require an empty draft and support both editor modes.
  for (const mode of ['rich', 'source']) {
    if (mode === 'source') {
      await editor.press('ControlOrMeta+Shift+m')
      await source.waitFor()
    }
    const active = mode === 'rich' ? editor : source
    await page.evaluate(() => window.setSuggestion('Add a settings page'))
    await page.waitForFunction(
      () =>
        document.querySelector('form').dataset.suggestion === 'Add a settings page' &&
        document.querySelector('form').dataset.hasText === 'false',
    )
    await active.press('Tab')
    assert.equal(await text(), 'Add a settings page')
    await setDraft('')
    await page.evaluate(() => window.setSuggestion('Dismiss this suggestion'))
    await page.waitForFunction(
      () =>
        document.querySelector('form').dataset.suggestion === 'Dismiss this suggestion' &&
        document.querySelector('form').dataset.hasText === 'false',
    )
    await active.press('Escape')
    await page.waitForFunction(() => document.querySelector('form').dataset.suggestion === '')
    await active.press('Tab')
    assert.equal(await text(), '', 'Dismissed suggestions must not fill the draft')
    await setDraft('My own draft')
    await page.evaluate(() => window.setSuggestion('Do not replace my draft'))
    await active.press('Tab')
    assert.equal(await text(), 'My own draft')
    await setDraft('')
    await page.evaluate(() => window.setSuggestion(''))
  }
  // Exact model references use the real desktop mention picker without changing the provider.
  await page.evaluate(() => {
    window.workspace.connected = true
  })
  await source.fill('@gpt')
  await source.press('End')
  const modelOption = page.getByRole('option').filter({ hasText: 'GPT Exact' })
  await modelOption.click()
  assert.equal(await text(), '`model:harness%3Acodex/gpt%2Fexact` ')
  await page.evaluate(() => {
    window.failCatalog = true
  })
  await source.fill('@other')
  await source.press('End')
  await page.getByRole('status').filter({ hasText: 'Catalog temporarily unavailable' }).waitFor()
  assert.equal(await text(), '@other')
  // Chips retain source through selection, copy, atomic deletion, undo, and editor swaps.
  await source.press('ControlOrMeta+Shift+m')
  await editor.waitFor()
  const chipDraft =
    '🚀 Review @src/file.ts $review @docs and `model:harness%3Acodex/gpt%2Fexact` please'
  await setDraft(chipDraft)
  await editor.locator('[data-reference-kind="model"]').waitFor()
  assert.equal(await editor.locator('.dovo-composer-reference').count(), 4)
  assert.equal(
    await editor.locator('[data-reference-kind="file"]').getAttribute('title'),
    '@src/file.ts',
  )
  assert.match(await editor.locator('[data-reference-kind="model"]').innerText(), /gpt\/exact/)
  assert.equal(await editor.locator('[data-reference-kind="model"]').innerText(), 'gpt/exact')
  assert.equal(await editor.locator('[data-reference-kind="file"]').innerText(), 'file.ts')
  assert.equal(await editor.locator('[data-reference-kind="skill"]').innerText(), 'review')
  assert.equal(await editor.locator('[data-reference-kind="mcp"]').innerText(), 'docs')
  assert.equal(await editor.locator('[data-reference-icon="file-code"]').count(), 1)
  assert.equal(await editor.locator('[data-reference-icon="skill"]').count(), 1)
  assert.equal(await editor.locator('[data-reference-icon="mcp"]').count(), 1)
  const modelIcon = editor.locator('[data-reference-kind="model"] svg[data-harness="codex"]')
  await modelIcon.waitFor()
  assert.equal(await modelIcon.getAttribute('aria-hidden'), 'true')
  const iconBounds = await modelIcon.boundingBox()
  assert.ok(iconBounds && iconBounds.width > 0 && iconBounds.height > 0)
  assert.equal(await text(), chipDraft, 'Chips must not rewrite saved Markdown')
  await editor.press('ControlOrMeta+a')
  const copied = await editor.evaluate((element) => {
    const clipboardData = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
    )
    return clipboardData.getData('text/plain')
  })
  assert.equal(
    copied,
    chipDraft.trimEnd(),
    'Copy includes the full paths and exact model reference',
  )
  const fileStart = chipDraft.indexOf('@src')
  const fileEnd = fileStart + '@src/file.ts'.length
  await page.evaluate((end) => window.selectSource(end), fileEnd)
  assert.deepEqual(await page.evaluate(() => window.sourceSelection()), {
    start: fileEnd,
    end: fileEnd,
  })
  await editor.press('Backspace')
  assert.equal(await editor.locator('[data-reference-kind="file"]').count(), 0)
  assert.equal(await text(), chipDraft.slice(0, fileStart) + chipDraft.slice(fileEnd))
  await editor.press('ControlOrMeta+z')
  assert.equal(await text(), chipDraft)
  await page.getByRole('button', { name: /Markdown source/ }).click()
  await source.waitFor()
  assert.equal(await source.inputValue(), chipDraft)
  await source.press('ControlOrMeta+Shift+m')
  await editor.locator('[data-reference-kind="file"]').waitFor()
  assert.equal(await text(), chipDraft)
  const punctuatedPath = 'Read @src/__tests__/my_file.ts please'
  await setDraft(punctuatedPath)
  await editor.locator('[data-reference-kind="file"]').waitFor()
  assert.equal(await editor.locator('.dovo-composer-reference').count(), 1)
  assert.equal(await text(), punctuatedPath)
  await editor.press('ControlOrMeta+a')
  const copiedPath = await editor.evaluate((element) => {
    const clipboardData = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
    )
    return clipboardData.getData('text/plain')
  })
  assert.equal(copiedPath, punctuatedPath)
  await page.evaluate((end) => window.selectSource(end), punctuatedPath.length)
  await editor.pressSequentially(' again')
  assert.equal(await text(), punctuatedPath + ' again')
  await setDraft(
    '# Heading @src/file.ts here\n\nCode `@src/file.ts `\n\n[`model:codex/gpt`](https://example.com)',
  )
  assert.equal(await editor.locator('.dovo-composer-reference').count(), 0)
  assert.equal(
    await text(),
    '# Heading @src/file.ts here\n\nCode `@src/file.ts `\n\n[`model:codex/gpt`](https://example.com)',
  )
  const harnessDraft =
    '`model:agent%3Awork/same-model` `model:acp%3Amy-install/same-model` `model:agent%3Amissing/same-model`'
  await setDraft(harnessDraft)
  await editor.locator('svg[data-harness="claude"]').waitFor()
  assert.equal(await editor.locator('svg[data-harness="claude"]').getAttribute('fill'), '#d97757')
  assert.equal(await editor.locator('svg[data-harness="acp"]').count(), 1)
  assert.equal(await editor.locator('[data-reference-kind="model"]').count(), 3)
  assert.equal(await editor.locator('[data-reference-kind="model"] svg').count(), 2)
  assert.equal(await text(), harnessDraft)
  // Existing chips must resolve again when scoped settings arrive, with no draft edit.
  await page.evaluate(() => window.setReferenceAgents([]))
  await editor.locator('svg[data-harness="claude"]').waitFor({ state: 'detached' })
  await page.evaluate(() => window.setReferenceAgents([{ id: 'work', provider: 'opencode' }]))
  await editor.locator('svg[data-harness="opencode"]').waitFor()
  assert.equal(await editor.locator('[data-reference-kind="model"]').count(), 3)
  assert.equal(await text(), harnessDraft)
  assert.deepEqual(errors, [])
  console.log('Rich composer browser checks passed')
} finally {
  await browser.close()
}
