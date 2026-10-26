import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/desktop',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {ErrorBoundary} from '${root}packages/studio-ui/src/components/error-boundary';
window.fixed=false;window.copied=[];
function Broken(){if(!window.fixed)throw Error('Failed http://user:secret@host/api?token=private#hash Bearer credential');return <p>Recovered</p>}
const root=createRoot(document.getElementById('app'));root.render(<ErrorBoundary scope="app" diagnosticContext={{appVersion:'0.0.9',channel:'nightly',runtimeVersion:'0.0.9-nightly.526'}}><Broken/></ErrorBoundary>);window.nested=()=>root.render(<ErrorBoundary key="nested" scope="app" diagnosticContext={{appVersion:'0.0.9',channel:'nightly'}}><ErrorBoundary><Broken/></ErrorBoundary></ErrorBoundary>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '../clipboard',
      importer: root + 'packages/studio-ui/src/components/error-boundary.tsx',
      contents:
        "export const copyTextToClipboard=async text=>{if(window.failCopy)throw Error('Copy failed');window.copied.push(JSON.parse(text))}",
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Dovo hit a problem', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await page.getByRole('status').getByText('Diagnostics copied').waitFor()
  const first = await page.evaluate(() => window.copied[0])
  assert.equal(first.context.appVersion, '0.0.9')
  assert.equal(first.context.runtimeVersion, '0.0.9-nightly.526')
  assert.equal(first.context.surface, 'app')
  for (const secret of ['user:secret', 'private', 'credential', '#hash'])
    assert.ok(!first.error.includes(secret))
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  assert.equal(await page.evaluate(() => window.copied[1].id), first.id)
  await page.evaluate(() => {
    window.failCopy = true
  })
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await page.getByRole('status').getByText('Copy failed').waitFor()
  await page.evaluate(() => {
    window.fixed = true
  })
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByText('Recovered', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.fixed = false
    window.failCopy = false
    window.nested()
  })
  await page.getByText('This view could not load', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  const nested = await page.evaluate(() => window.copied.at(-1))
  assert.equal(nested.context.appVersion, '0.0.9')
  assert.equal(nested.context.surface, 'view')
  console.log(
    'Error recovery: bounded redacted copyable diagnostics, stable identity, failed clipboard feedback and retry passed.',
  )
} finally {
  await browser.close()
}
