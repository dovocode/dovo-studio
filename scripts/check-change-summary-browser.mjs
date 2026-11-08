import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const ui = root + '/packages/studio-ui'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: ui,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ChangeSummary} from './src/review/change-summary';
import {FileBrowserTree} from './src/file-tree';
import {pullFileKind} from '@dovo/protocol';
const files=[
 {path:'apps/mobile/src/App.tsx',additions:120,deletions:42},
 {path:'apps/mobile/src/auth.ts',additions:30,deletions:12},
 {path:'tests/session.test.ts',additions:62,deletions:28},
 {path:'mocks/client.ts',additions:18,deletions:6},
 {path:'docs/guide.md',additions:12,deletions:6},
 {path:'pnpm-lock.yaml',additions:62,deletions:2},
 {path:'assets/screenshot.png',additions:null,deletions:null}
];
function App(){const [expanded,setExpanded]=useState(false),[kind,setKind]=useState(),[selected,setSelected]=useState('');
const [,rerender]=useState(0);window.setSummaryFiles=next=>{window.summaryFiles=next;rerender(value=>value+1)};
const current=window.summaryFiles??files;
return <main className="studio dark mx-auto max-w-4xl p-4 text-foreground" id="fixture">
<ChangeSummary files={current} expanded={expanded} onExpandedChange={setExpanded} value={kind} onChange={setKind} total={window.partialTotal}>
<div className="studio-change-file-tree"><FileBrowserTree files={current.filter(file=>!kind||pullFileKind(file)===kind).map(file=>({...file,additions:file.additions??undefined,deletions:file.deletions??undefined,changeKind:pullFileKind(file)}))} selected={selected} onSelect={path=>{setSelected(path);window.selectedFile=path}} defaultExpandedDepth={0} showChangeBars /></div>
</ChangeSummary></main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: ui + '/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [ui + '/node_modules', root + '/node_modules'],
  },
  [],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;background:var(--background);font-family:system-ui}</style><div id="app"></div>',
  )
  for (const name of (await readdir(root + '/apps/desktop/dist/assets')).filter((name) =>
    name.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: await readFile(root + '/apps/desktop/dist/assets/' + name, 'utf8'),
    })
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const summary = page.getByRole('region', { name: 'Changed file summary', exact: true })
  const toggle = summary.getByRole('button', { name: '7 files changed', exact: true })
  await toggle.waitFor()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await summary.locator('[data-file-tree-row]').count(), 0)
  assert.equal(await toggle.getByText('+304', { exact: true }).count(), 1)
  assert.equal(await toggle.getByText('−96', { exact: true }).count(), 1)
  await summary.screenshot({ path: '/tmp/dovo-diff-summary-desktop-collapsed.png' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await summary.locator('.studio-change-category-card').count(), 5)
  await summary.getByRole('button', { name: 'Filter Tests: 1 files', exact: true }).click()
  const tree = summary.locator('.studio-change-file-tree')
  assert.equal(await tree.getByRole('button').count(), 1)
  await tree.getByRole('button', { name: 'tests', exact: true }).click()
  await tree.getByRole('button', { name: 'tests/session.test.ts', exact: true }).click()
  assert.equal(await page.evaluate(() => window.selectedFile), 'tests/session.test.ts')
  await summary.getByRole('button', { name: 'All 7', exact: true }).click()
  await tree.getByRole('button', { name: 'apps/mobile/src', exact: true }).click()
  await tree.getByRole('button', { name: 'apps/mobile/src/auth.ts', exact: true }).waitFor()
  await summary.screenshot({ path: '/tmp/dovo-diff-summary-desktop-expanded.png' })
  for (const width of [320, 390, 768, 1100]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Expanded fits at ${width}px`,
    )
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Collapsed fits at ${width}px`,
    )
    if (width === 390)
      await summary.screenshot({ path: '/tmp/dovo-diff-summary-desktop-narrow.png' })
    await toggle.click()
  }
  await page.evaluate(() => {
    document.documentElement.dataset.themeGlow = '0'
    document.documentElement.dataset.themeGradients = 'false'
  })
  assert.equal(await summary.evaluate((node) => getComputedStyle(node).backgroundImage), 'none')
  const flatShadow = await summary.evaluate((node) => getComputedStyle(node).boxShadow)
  assert.ok(
    flatShadow === 'none' || flatShadow.includes('rgba(0, 0, 0, 0)'),
    'Glow zero removes decorative shadow',
  )
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'light'
    document.querySelector('#fixture').classList.remove('dark')
  })
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  )
  await summary.screenshot({ path: '/tmp/dovo-diff-summary-desktop-light.png' })
  await page.emulateMedia({ forcedColors: 'active' })
  assert.equal(await summary.evaluate((node) => getComputedStyle(node).borderTopStyle), 'solid')
  await page.emulateMedia({ forcedColors: 'none' })
  await page.evaluate(() => {
    window.partialTotal = 10
    window.setSummaryFiles([{ path: 'src/partial.ts', additions: null, deletions: 5 }])
  })
  await summary.getByRole('button', { name: '10 files changed', exact: true }).waitFor()
  assert.equal(
    await summary.getByText('+0', { exact: true }).count(),
    0,
    'An unknown side is not shown as zero',
  )
  assert.equal(await summary.getByText('1 of 10 files loaded', { exact: true }).count(), 1)
  await summary.getByRole('button', { name: 'Filter Code: 1 files', exact: true }).waitFor()
  await page.evaluate(() => {
    window.partialTotal = undefined
    window.setSummaryFiles([{ path: 'image.png', additions: null, deletions: null }])
  })
  await summary.getByRole('button', { name: '1 file changed', exact: true }).waitFor()
  assert.equal(
    await summary.locator('.studio-change-category-card').getByText('+0', { exact: true }).count(),
    0,
    'Unknown binary line counts remain unknown',
  )
  assert.equal(
    await summary.getByRole('img', { name: /^File type distribution/ }).count(),
    1,
    'No line data falls back to file distribution',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Diff summary: collapsed default, keyboard expansion, real category totals, filters, folder/file navigation, narrow layouts, effects off, light/forced colors and binary fallback passed.',
  )
} finally {
  await browser.close()
}
