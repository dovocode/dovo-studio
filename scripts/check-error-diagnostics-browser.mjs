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
import {workbenchDiagnosticContext} from '${root}packages/studio-shell/src/workbench-diagnostics';
window.fixed=false;window.copied=[];
function Broken(){if(!window.fixed){const error=Error('Failed http://user:secret@host/api?token=private#hash Bearer credential');error.stack='RAW_ERROR_STACK_PRIVATE';throw error};return <p>Recovered</p>}
Object.defineProperty(Broken,'name',{value:'Broken token=stack-secret https://user:pass@host/source?token=query-secret#fragment '+ 'x'.repeat(3000)});
const desktopContext=workbenchDiagnosticContext({version:'0.0.9',channel:'nightly',viewer:{platform:'darwin',architecture:'arm64',processArchitecture:'arm64'}},'MacIntel');
const root=createRoot(document.getElementById('app'));root.render(<ErrorBoundary scope="app" diagnosticContext={{...desktopContext,viewId:'must-not-appear-on-app',runtimeVersion:'0.0.9-nightly.526'}}><Broken/></ErrorBoundary>);window.nested=(viewId="tasks")=>root.render(<ErrorBoundary key={viewId} scope="app" diagnosticContext={{...desktopContext,runtimeVersion:'0.0.9-nightly.526'}}><ErrorBoundary diagnosticContext={{viewId}}><Broken/></ErrorBoundary></ErrorBoundary>);
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
  assert.equal(first.context.viewerPlatform, 'darwin')
  assert.equal(first.context.viewerArchitecture, 'arm64')
  assert.equal(first.context.viewerProcessArchitecture, 'arm64')
  assert.equal(first.context.platform, undefined)
  assert.equal(first.context.browserPlatformLegacy, undefined)
  assert.equal(first.context.surface, 'app')
  assert.equal(first.context.viewId, undefined)
  assert.equal(first.componentStack.length, 2000)
  assert.ok(first.componentStack.includes('Broken'))
  for (const secret of [
    'stack-secret',
    'user:pass',
    'query-secret',
    '#fragment',
    'RAW_ERROR_STACK_PRIVATE',
  ])
    assert.ok(!JSON.stringify(first).includes(secret))
  for (const secret of ['user:secret', 'private', 'credential', '#hash'])
    assert.ok(!first.error.includes(secret))
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.copied[1]), first)
  await page.evaluate(() => {
    window.failCopy = true
  })
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await page.getByRole('status').getByText('Copy failed').waitFor()
  await page.evaluate(() => {
    window.failCopy = false
  })
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  await page.getByRole('status').getByText('Diagnostics copied').waitFor()
  assert.deepEqual(await page.evaluate(() => window.copied.at(-1)), first)
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
  assert.equal(nested.context.viewId, 'tasks')
  assert.equal(nested.context.runtimeVersion, '0.0.9-nightly.526')
  assert.equal(nested.context.viewerPlatform, 'darwin')
  assert.equal(nested.context.viewerArchitecture, 'arm64')
  assert.equal(nested.context.viewerProcessArchitecture, 'arm64')
  assert.equal(nested.componentStack.length, 2000)
  assert.notEqual(nested.id, first.id)
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.copied.at(-1)), nested)
  await page.evaluate(() => {
    window.fixed = true
  })
  await page.getByRole('button', { name: 'Retry view', exact: true }).click()
  await page.getByText('Recovered', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.fixed = false
    window.nested(
      'token=view-secret https://user:pass@host/view?token=query-secret#fragment ' +
        'x'.repeat(500),
    )
  })
  await page.getByText('This view could not load', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click()
  const boundedView = await page.evaluate(() => window.copied.at(-1))
  assert.equal(boundedView.context.viewId.length, 256)
  for (const secret of ['view-secret', 'user:pass', 'query-secret', '#fragment'])
    assert.ok(!boundedView.context.viewId.includes(secret))
  console.log(
    'Error recovery: bounded redacted copyable diagnostics, stable identity, failed clipboard feedback and retry passed.',
  )
} finally {
  await browser.close()
}
