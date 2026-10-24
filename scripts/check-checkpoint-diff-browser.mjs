import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {TurnCheckpoint} from './src/chat/thread/turn-checkpoint';
import {MessageAttachments} from './src/chat/composer/message-attachments';
const image={id:'image',name:'A very long screenshot attachment filename.png',mime:'image/png',size:2048};
const text={id:'text',name:'notes.txt',mime:'text/plain',size:32};
window.imageData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
window.calls=[];window.failSyntax=false;
window.store={connected:true,request:async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/read')return {attachment:input.id==='image'?image:text,data:input.id==='image'?window.imageData:btoa('Attachment preview text')};if(path==='/api/tasks/file/restore')return {ok:true};throw Error('Unexpected request '+path)}};
const before='export function greeting(name: string) {\\n  return "Hello " + name;\\n}\\n';
const after='export function greeting(name: string) {\\n  return \\x60Hello, \\x24{name}!\\x60;\\n}\\n';
const turn={id:'turn',status:'completed',checkpoint:{before:'a'.repeat(40),after:'b'.repeat(40),files:[{path:'src/greeting.ts',before,after,viewed:false},{path:'src/added.ts',before:'',after:'export const added = true;\\n',viewed:false},{path:'src/removed.ts',before:'export const old = true;\\n',after:'',viewed:false},{path:'src/mode.ts',before:'same\\n',after:'same\\n',viewed:false}],omitted:[]}};
function App(){const [current,setTurn]=useState(turn);window.setTurn=setTurn;const [files,setFiles]=useState([image,text]);return <main className="studio dark min-h-screen bg-background p-6 text-foreground"><h1 className="mb-6 text-sm">Turn complete</h1><TurnCheckpoint turn={current} taskId="task" checkoutId="linked"/><section className="mt-8 rounded-2xl border bg-card p-3" aria-label="Composer fixture"><MessageAttachments compact taskId="task" files={files} previews={new Map([['image','data:image/png;base64,'+window.imageData]])} remove={async id=>setFiles(current=>current.filter(file=>file.id!==id))}/><textarea aria-label="Message task" className="mt-2 w-full bg-transparent" defaultValue="Review these changes"/></section><section className="mt-8" aria-label="Sent message"><MessageAttachments taskId="task" files={[image]}/></section></main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useWorkspace=()=>window.store;export const whitespaceOnlyFile=()=>false;export const useAppPreferences=()=>({collapseChangedFiles:false,hideWhitespaceChanges:false,importedCodeThemes:[]});export const readAppPreferences=()=>({importedCodeThemes:[]});export const useDiffOptions=()=>({defaultSplit:false,options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'scroll'}});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${ui}/components/ui/button.tsx';export * from '${ui}/components/ui/dialog.tsx';export {ChoicePicker} from '${ui}/choice-picker.tsx';export {ErrorBoundary} from '${ui}/components/error-boundary.tsx';export {FileBrowserTree} from '${ui}/file-tree.tsx';export {ChangeTypeFilters} from '${ui}/review/change-types.tsx';`,
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents: `import {preloadStudioHighlighter as preload} from '${ui}/code-themes.ts';export {useDiffOptions} from '${ui}/code-themes.ts';export const preloadStudioHighlighter=language=>window.failSyntax?Promise.reject(new Error('Syntax fixture unavailable')):preload(language);`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  const assets = root + '/apps/desktop/dist/assets'
  for (const name of (await readdir(assets)).filter((name) => name.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + name, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const draft = page.getByLabel('Draft attachments', { exact: true })
  const draftImage = draft.locator('img')
  await draftImage.evaluate((image) => image.decode())
  assert.equal(await draftImage.evaluate((image) => image.getBoundingClientRect().width), 24)
  assert.ok((await draft.boundingBox()).height <= 84)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const row = await draftImage.evaluate((image) => {
      const box = image.closest('button').parentElement.getBoundingClientRect()
      return {
        width: box.width,
        height: box.height,
        available: image.closest('button').parentElement.parentElement.clientWidth,
      }
    })
    assert.equal(row.width, row.available, 'Attachment rows use the full available width')
    assert.ok(row.height <= 36)
    assert.equal(
      await draft.getByRole('button', { name: 'Remove notes.txt', exact: true }).innerText(),
      '',
    )
  }
  const name = 'A very long screenshot attachment filename.png'
  await draft.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
  const attachment = page.getByRole('dialog', { name })
  await attachment.getByRole('img', { name }).waitFor()
  await attachment.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Message task' }).inputValue(),
    'Review these changes',
  )
  await draft.getByRole('button', { name: 'Remove notes.txt', exact: true }).click()
  assert.equal(
    await draft.getByRole('button', { name: 'Preview notes.txt', exact: true }).count(),
    0,
  )
  const sent = page.getByRole('region', { name: 'Sent message' })
  await sent.locator('img').waitFor()
  assert.equal(
    await sent.locator('img').evaluate((image) => image.getBoundingClientRect().width),
    28,
  )
  await page.screenshot({ path: '/tmp/dovo-compact-attachments.png' })
  await page
    .getByLabel('Changed file breakdown', { exact: true })
    .filter({ hasText: /All 4Code 4/ })
    .waitFor()
  await page.getByRole('button', { name: 'Open diff', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Turn checkpoint · 4 files' })
  const rendered = async (text) =>
    page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('diffs-container')].some((element) =>
          element.shadowRoot?.querySelector('pre')?.textContent.includes(text),
        ),
      text,
    )
  await rendered('Hello,')
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Split diff', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  )
  await dialog.getByRole('button', { name: 'Split diff', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.dataset
        .diffType === 'split',
  )
  await dialog.getByRole('button', { name: 'Wrap diff lines', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.dataset
        .overflow === 'wrap',
  )
  await page.screenshot({ path: '/tmp/dovo-turn-checkpoint-diff.png' })
  const sidebar = dialog.getByRole('complementary', { name: 'Checkpoint files' })
  await sidebar.getByRole('button', { name: 'src/added.ts', exact: true }).click()
  await rendered('export const added')
  await sidebar.getByRole('button', { name: 'src/removed.ts', exact: true }).click()
  await rendered('export const old')
  await sidebar.getByRole('button', { name: 'src/mode.ts', exact: true }).click()
  await dialog.getByText('No text changes.', { exact: false }).waitFor()
  await page.evaluate(() => {
    window.failSyntax = true
  })
  await sidebar.getByRole('button', { name: 'src/greeting.ts', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Highlighting unavailable' }).waitFor()
  await dialog.getByRole('heading', { name: 'Before', exact: true }).waitFor()
  await dialog.getByRole('heading', { name: 'After', exact: true }).waitFor()
  await page.evaluate(() => {
    window.failSyntax = false
  })
  await dialog.getByRole('button', { name: 'Retry highlighting', exact: true }).click()
  await rendered('Hello,')
  await page.setViewportSize({ width: 390, height: 700 })
  assert.equal(await sidebar.isVisible(), false)
  await dialog.getByRole('button', { name: 'Checkpoint file', exact: true }).click()
  await page.getByRole('option', { name: 'src/added.ts', exact: true }).click()
  await rendered('export const added')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const area = dialog.getByLabel('Saved file diff', { exact: true })
  assert.ok((await area.boundingBox()).height > 100)
  await dialog.getByRole('button', { name: 'Revert this file', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/tasks/file/restore').input,
    ),
    { id: 'task', path: 'src/added.ts', turnId: 'turn', checkoutId: 'linked' },
  )
  await page.screenshot({ path: '/tmp/dovo-turn-checkpoint-narrow.png' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Message task' }).inputValue(),
    'Review these changes',
  )
  await page.evaluate(() =>
    window.setTurn((turn) => ({
      ...turn,
      checkpoint: {
        ...turn.checkpoint,
        files: [
          ...turn.checkpoint.files,
          ...['src/greeting.test.ts', '__mocks__/client.ts', 'docs/review.md'].map((path) => ({
            path,
            before: '',
            after: path.endsWith('.test.ts') ? 'change\n'.repeat(100) : 'change',
            viewed: false,
          })),
        ],
        omitted: ['src/generated/client.ts'],
      },
    })),
  )
  const breakdown = page.getByLabel('Changed file breakdown', { exact: true })
  await breakdown.filter({ hasText: /All 8Code 4Tests 1Mocks 1Docs 1Generated 1/ }).waitFor()
  const distribution = breakdown.getByLabel('Changed line distribution', { exact: true })
  const codeSegment = distribution.getByRole('button', {
    name: 'Filter Code: 4 files, 4 of 106 changed lines',
    exact: true,
  })
  const testSegment = distribution.getByRole('button', {
    name: 'Filter Tests: 1 files, 100 of 106 changed lines',
    exact: true,
  })
  const codeWidth = (await codeSegment.boundingBox()).width
  const testWidth = (await testSegment.boundingBox()).width
  assert.ok(
    Math.abs(testWidth / codeWidth - 25) < 0.2,
    'The large test diff occupies 25 times the code segment',
  )
  assert.equal(await distribution.getByRole('button', { name: /Generated/ }).count(), 0)
  // A file with no line evidence remains selectable through its category chip.
  await breakdown.getByRole('button', { name: 'Generated 1', exact: true }).click()
  assert.equal(
    await breakdown
      .getByRole('button', { name: 'Generated 1', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  await breakdown.getByRole('button', { name: 'Tests 1', exact: true }).click()
  assert.equal(
    await page
      .locator(
        '[data-file-tree-row][aria-current], button[data-file-tree-row]:not([aria-expanded])',
      )
      .count(),
    1,
  )
  await breakdown.getByRole('button', { name: 'All 8', exact: true }).click()
  const categoryColors = await breakdown
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => /^(Code|Tests|Mocks|Docs) /.test(button.textContent))
        .map((button) => getComputedStyle(button).color),
    )
  assert.equal(new Set(categoryColors).size, 4)
  await page.screenshot({ path: '/tmp/dovo-change-type-filters.png' })
  await page.evaluate(() =>
    window.setTurn((turn) => ({
      ...turn,
      checkpoint: {
        ...turn.checkpoint,
        files: turn.checkpoint.files.map((file) =>
          file.path === 'src/greeting.test.ts'
            ? { ...file, after: 'change\n'.repeat(10000) }
            : file,
        ),
      },
    })),
  )
  const tinyDoc = distribution.getByRole('button', {
    name: 'Filter Docs: 1 files, 1 of 10006 changed lines',
    exact: true,
  })
  assert.ok(
    (await tinyDoc.boundingBox()).width >= 8,
    'A one-line category remains visible beside a huge diff',
  )
  await tinyDoc.click()
  assert.equal(
    await breakdown
      .getByRole('button', { name: 'Docs 1', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  await breakdown.getByRole('button', { name: 'All 8', exact: true }).click()
  const disclosure = page.getByRole('button', { name: /8 changed files/ })
  await disclosure.click()
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  assert.equal(await breakdown.isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log(
    'Checkpoint dialog: real highlighted diffs, layouts, wrapping, file selection, added/deleted/unchanged files, syntax retry and scoped restore; compact attachments: preview, removal and preserved draft passed.',
  )
} finally {
  await browser.close()
}
