import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const worker = await build({
  entryPoints: [root + '/packages/extension-tasks/src/files/saved-file-diff.worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
})
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {TurnCheckpoint,CheckpointDiff} from './src/chat/thread/turn-checkpoint';
import {MessageAttachments} from './src/chat/composer/message-attachments';
import {SavedFilePreview} from './src/files/saved-file-preview';
const image={id:'image',name:'A very long screenshot attachment filename.png',mime:'image/png',size:2048};
const text={id:'text',name:'notes.txt',mime:'text/plain',size:32};
window.imageData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
window.calls=[];window.failSyntax=false;
window.store={connected:true,request:async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/read')return {attachment:input.id==='image'?image:text,data:input.id==='image'?window.imageData:btoa('Attachment preview text')};if(path==='/api/tasks/file/restore')return {ok:true};if(path==='/api/tasks/file/preview'){if(window.failFull&&input.full)throw Error('Diff read failed');const prefix='same line\\n'.repeat(20000);return {before:{kind:'text',size:prefix.length+12,text:input.full?prefix+'old tail\\n':prefix.slice(0,65536),truncated:!input.full},after:{kind:'text',size:prefix.length+12,text:input.full?prefix+'new tail\\n':prefix.slice(0,65536),truncated:!input.full}}};throw Error('Unexpected request '+path)}};
const before='export function greeting(name: string) {\\n  return "Hello " + name;\\n}\\n';
const after='export function greeting(name: string) {\\n  return \\x60Hello, \\x24{name}!\\x60;\\n}\\n';
const turn={id:'turn',status:'completed',checkpoint:{before:'a'.repeat(40),after:'b'.repeat(40),files:[{path:'src/greeting.ts',before,after,viewed:false},{path:'src/added.ts',before:'',after:'export const added = true;\\n',viewed:false},{path:'src/removed.ts',before:'export const old = true;\\n',after:'',viewed:false},{path:'src/mode.ts',before:'same\\n',after:'same\\n',viewed:false}],omitted:[]}};
function App(){const [current,setTurn]=useState(turn);window.setTurn=setTurn;const [files,setFiles]=useState([image,text]);return <main className="studio dark min-h-screen bg-background p-6 text-foreground"><h1 className="mb-6 text-sm">Turn complete</h1><TurnCheckpoint turn={current} taskId="task" checkoutId="linked"/><section className="mt-8 rounded-2xl border bg-card p-3" aria-label="Composer fixture"><MessageAttachments compact taskId="task" files={files} previews={new Map([['image','data:image/png;base64,'+window.imageData]])} remove={async id=>setFiles(current=>current.filter(file=>file.id!==id))}/><textarea aria-label="Message task" className="mt-2 w-full bg-transparent" defaultValue="Review these changes"/></section><section className="mt-8" aria-label="Sent message"><MessageAttachments taskId="task" files={[image]}/></section></main>};const root=createRoot(document.getElementById('app'));window.renderSaved=()=>root.render(<SavedFilePreview file={{path:'large.txt',before:'',after:'',viewed:false,preview:{kind:'large'}}} taskId="task" turnId="turn" checkoutId="linked"/>);window.renderComplex=()=>{const lines=Array.from({length:25000},(_,i)=>'line '+i+'\\n');root.render(<CheckpointDiff file={{path:'complex.txt',before:lines.join(''),after:lines.toReversed().join(''),viewed:false}}/>)};root.render(<App/>);`,
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
    plugins: [
      {
        name: 'checkpoint-worker-fixture',
        setup(builder) {
          builder.onLoad({ filter: /saved-file-diff-job\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            const asset = "new URL('./saved-file-diff.worker.ts', import.meta.url)"
            assert.ok(source.includes(asset), 'The fixture worker URL matches the production job')
            return {
              contents: source.replace(
                asset,
                "new URL('/checkpoint-diff.worker.js', window.location.href)",
              ),
              loader: 'ts',
              resolveDir: root + '/packages/extension-tasks/src/files',
            }
          })
        },
      },
    ],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useWorkspace=()=>window.store;export const whitespaceOnlyFile=()=>false;export const useAppPreferences=()=>({collapseChangedFiles:true,hideWhitespaceChanges:false,importedCodeThemes:[]});export const readAppPreferences=()=>({theme:'dark',themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});export const useDiffOptions=()=>({defaultSplit:false,options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'scroll'}});`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${ui}/components/ui/button.tsx';export * from '${ui}/components/ui/dialog.tsx';export {ChoicePicker} from '${ui}/choice-picker.tsx';export {ErrorBoundary} from '${ui}/components/error-boundary.tsx';export {FileBrowserTree} from '${ui}/file-tree.tsx';export {ChangeTypeFilters} from '${ui}/review/change-types.tsx';export {ChangeSummary} from '${ui}/review/change-summary.tsx';`,
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents: `import {preloadStudioHighlighter as preload} from '${ui}/code-themes.ts';export {useDiffOptions} from '${ui}/code-themes.ts';export const preloadStudioHighlighter=language=>window.failSyntax?Promise.reject(new Error('Syntax fixture unavailable')):preload(language);`,
    },
  ],
)
const server = createServer((request, response) => {
  if (request.url === '/checkpoint-diff.worker.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(worker.outputFiles[0].text)
  } else {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<div id="app"></div>')
  }
})
const browser = await chromium.launch()
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(() => {
    const BrowserWorker = window.Worker
    window.workerStats = { created: 0, terminated: 0, running: 0 }
    window.Worker = class extends BrowserWorker {
      constructor(...args) {
        super(...args)
        window.workerStats.created++
        window.workerStats.running++
      }
      terminate() {
        window.workerStats.terminated++
        window.workerStats.running--
        return super.terminate()
      }
    }
  })
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
  const summary = page.getByRole('region', { name: 'Changed file summary', exact: true })
  const disclosure = summary.getByRole('button', { name: '4 files changed', exact: true })
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  assert.equal(await summary.locator('[data-file-tree-row]').count(), 0)
  await page.screenshot({ path: '/tmp/dovo-turn-summary-collapsed.png' })
  await disclosure.click()
  await summary.getByRole('button', { name: 'Code 4', exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-turn-summary-expanded.png' })
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
  await breakdown.getByRole('button', { name: 'All 8', exact: true }).waitFor()
  const distribution = breakdown.getByRole('img', {
    name: /^(Available changed|Changed) line distribution/,
  })
  const segments = distribution.locator(':scope > span')
  const codeWidth = (await segments.nth(0).boundingBox()).width
  const testWidth = (await segments.nth(1).boundingBox()).width
  assert.ok(testWidth > codeWidth, 'The large test diff dominates the changed-line bar')
  assert.equal(await segments.count(), 4, 'Unknown generated line totals do not invent line weight')
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
  const docs = breakdown.getByRole('button', { name: 'Filter Docs: 1 files', exact: true })
  await docs.click()
  assert.equal(await docs.getAttribute('aria-pressed'), 'true')
  await breakdown.getByRole('button', { name: 'All 8', exact: true }).click()
  const updatedDisclosure = summary.getByRole('button', { name: '8 files changed', exact: true })
  await updatedDisclosure.click()
  assert.equal(await updatedDisclosure.getAttribute('aria-expanded'), 'false')
  assert.equal(await breakdown.count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => {
    window.failSyntax = false
    window.failFull = true
    window.renderSaved()
  })
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Diff read failed' }).waitFor()
  await page.evaluate(() => {
    window.failFull = false
  })
  await page.getByRole('button', { name: 'Retry full diff', exact: true }).click()
  await rendered('new tail')
  assert.equal(await page.getByRole('button', { name: 'Split diff', exact: true }).count(), 1)
  assert.ok(
    await page.evaluate(() =>
      window.calls.some(
        (call) =>
          call.path === '/api/tasks/file/preview' &&
          call.input.full &&
          call.input.id === 'task' &&
          call.input.turnId === 'turn' &&
          call.input.checkoutId === 'linked',
      ),
    ),
  )
  const initialWorkers = await page.evaluate(() => window.workerStats.created)
  await page.evaluate(() => {
    window.diffTicks = 0
    window.diffTicker = setInterval(() => window.diffTicks++, 10)
    window.renderComplex()
  })
  await page.getByRole('alert').filter({ hasText: 'Complete contents are shown below' }).waitFor()
  assert.ok(
    (await page.evaluate(() => window.diffTicks)) >= 2,
    'Complex parsing leaves the UI responsive',
  )
  assert.ok(
    (await page.evaluate(() => window.workerStats.created)) > initialWorkers,
    'A real worker parsed the complex diff',
  )
  await page.evaluate(() => clearInterval(window.diffTicker))
  assert.ok((await page.locator('pre').first().innerText()).includes('line 24999'))
  await page.evaluate(() => window.renderSaved())
  await page.getByRole('button', { name: 'Load full diff', exact: true }).waitFor()
  const beforeCancellation = await page.evaluate(() => window.workerStats.terminated)
  const beforeStart = await page.evaluate(() => window.workerStats.created)
  await page.evaluate(() => window.renderComplex())
  await page.waitForFunction((count) => window.workerStats.created > count, beforeStart)
  assert.equal(await page.evaluate(() => window.workerStats.running), 1)
  await page.evaluate(() => window.renderSaved())
  await page.getByRole('button', { name: 'Load full diff', exact: true }).waitFor()
  await page.waitForFunction((count) => window.workerStats.terminated > count, beforeCancellation)
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.workerStats.running), 0)
  assert.equal(await page.getByText('line 24999', { exact: false }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Checkpoint dialog: real worker parsing, responsive fallback, cancellation, highlighted diffs, layouts, file selection, syntax retry and scoped restore; compact attachments and preserved draft passed.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
