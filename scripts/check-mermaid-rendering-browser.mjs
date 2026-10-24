import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import MermaidResponse from './src/components/ai-elements/mermaid-response';function App(){const[chart,setChart]=useState('');window.setChart=setChart;return <MermaidResponse key={chart} mode="static" controls={{mermaid:{copy:true,download:true,fullscreen:true,panZoom:true}}}>{'\u0060\u0060\u0060mermaid\\n'+chart+'\\n\u0060\u0060\u0060'}</MermaidResponse>}createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const css = (
  await Promise.all(
    (await readdir(root + 'apps/desktop/dist/assets'))
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFile(root + 'apps/desktop/dist/assets/' + file, 'utf8')),
  )
).join('\n')
const charts = [
  'flowchart LR\n A[Start] --> B[Finish]',
  'sequenceDiagram\n Alice->>Bob: Hello\n Bob-->>Alice: Hi',
  'classDiagram\n Animal <|-- Duck\n Animal : +String name',
  'stateDiagram-v2\n [*] --> Ready\n Ready --> Done',
  'erDiagram\n CUSTOMER ||--o{ ORDER : places',
  'pie title Languages\n "TypeScript" : 85\n "Other" : 15',
  'gantt\n dateFormat YYYY-MM-DD\n section Work\n Ship :2026-10-23, 1d',
  'mindmap\n root((Studio))\n  Desktop\n  Mobile',
]
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(7000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<!doctype html><div id="app" style="padding:16px"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => !!window.setChart)
  await mkdir('/tmp/dovo-pele', { recursive: true })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.className = theme), theme)
      for (const chart of charts) {
        await page.evaluate((chart) => window.setChart(chart), chart)
        await page
          .locator('svg.pele')
          .waitFor()
          .catch(async (error) => {
            console.error((await page.locator('#app').innerHTML()).slice(0, 2000))
            throw error
          })
        assert.equal(await page.locator('svg.pele').count(), 1)
        const dimensions = await page.locator('svg.pele').boundingBox()
        assert.ok(dimensions.width > 0 && dimensions.height > 0)
        assert.ok(dimensions.x >= 0 && dimensions.x + dimensions.width <= width + 1)
        const colors = await page.locator('svg.pele').evaluate((svg) => ({
          actual: getComputedStyle(svg).color,
          expected: getComputedStyle(document.body).color,
        }))
        assert.equal(colors.actual, colors.expected, 'Diagram should inherit the active theme')
      }
      await page.screenshot({ path: `/tmp/dovo-pele/desktop-${theme}-${width}.png` })
    }
  }
  await page.evaluate(() => window.setChart('flowchart LR\n A --> B'))
  await page.locator('svg.pele').waitFor()
  const fullscreen = page.getByRole('button', { name: /full.?screen|expand/i })
  await fullscreen.click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('dialog').locator('svg.pele').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Copy Code', exact: true }).waitFor()
  const expectedColor = await page
    .locator('svg.pele')
    .evaluate((svg) => getComputedStyle(svg).color)
  await page.getByRole('button', { name: 'Download diagram', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download diagram as SVG', exact: true }).click()
  const downloaded = await downloadPromise
  const standalone = await browser.newPage()
  await standalone.setContent(await readFile(await downloaded.path(), 'utf8'))
  assert.equal(
    await standalone.locator('svg.pele').evaluate((svg) => getComputedStyle(svg).color),
    expectedColor,
    'Downloaded SVG should preserve its theme without Studio CSS',
  )
  await standalone.close()
  for (const chart of ['flowchart LR\n A --> [']) {
    await page.evaluate((chart) => window.setChart(chart), chart)
    await page.getByText('Could not render diagram. Mermaid source:', { exact: true }).waitFor()
    assert.equal(await page.locator('pre code').textContent(), chart + '\n')
  }

  // Exercise the actual bundled WebView client, including its native message bridge.
  const mobile = await browser.newPage({ viewport: { width: 320, height: 900 } })
  mobile.on('pageerror', (error) => errors.push(error.message))
  const html = JSON.parse(await readFile(root + 'apps/mobile/assets/mermaid.json', 'utf8'))
  await mobile.setContent(html)
  await mobile.evaluate(() => {
    window.messages = []
    window.ReactNativeWebView = {
      postMessage: (message) => window.messages.push(JSON.parse(message)),
    }
  })
  for (const chart of charts) {
    await mobile.evaluate(
      (chart) =>
        window.renderDiagram(chart, {
          text: '#eeeeee',
          surface: '#202020',
          border: '#444444',
          muted: '#aaaaaa',
          background: '#111111',
          selection: '#426090',
          elevated: '#303030',
        }),
      chart,
    )
    await mobile.locator('svg.pele').waitFor()
    assert.equal(
      await mobile.locator('svg.pele').evaluate((svg) => getComputedStyle(svg).color),
      'rgb(238, 238, 238)',
    )
  }
  await mobile.evaluate(() =>
    window.renderDiagram(
      'flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B\n click B "https://example.test"',
      {},
    ),
  )
  assert.equal(
    await mobile
      .locator('svg.pele script, svg.pele a, svg.pele image, svg.pele [onerror], svg.pele [onload]')
      .count(),
    0,
  )
  await mobile.screenshot({ path: '/tmp/dovo-pele/mobile-webview-320.png' })
  await mobile.evaluate(() => window.renderDiagram('flowchart LR\n A --> [', {}))
  await mobile.evaluate(() => {
    window.messages = []
    window.renderDiagram('flowchart LR\n' + 'x'.repeat(50001), {})
  })
  assert.ok(await mobile.evaluate(() => window.messages.some((message) => message.error)))
  await mobile.evaluate(() => window.renderDiagram('flowchart LR\n A --> B', {}))
  assert.ok(await mobile.evaluate(() => window.messages.some((message) => message.height > 0)))
  assert.deepEqual(errors, [])
  console.log(
    'Pele: desktop and mobile WebView diagrams, light/dark themes, narrow widths, fullscreen, limits and source fallback passed.',
  )
} finally {
  await browser.close()
}
