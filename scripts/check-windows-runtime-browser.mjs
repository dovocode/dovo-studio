import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const built = await build({
  alias: {
    'react-dom': dirname(
      createRequire(new URL('../apps/desktop/package.json', import.meta.url)).resolve(
        'react-dom/package.json',
      ),
    ),
  },
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {WindowsRuntimeGate,WindowsRuntimeSettings} from './src/windows-runtime.tsx';createRoot(document.getElementById('app')).render(location.search === '?settings' ? <WindowsRuntimeSettings/> : <WindowsRuntimeGate><p>Workspace ready</p></WindowsRuntimeGate>);`,
    resolveDir: new URL('../packages/extension-runtime/', import.meta.url).pathname,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'windows-test',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-(ui|core)$/ }, ({ path }) => ({
          path,
          namespace: 'windows-test',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'windows-test' }, ({ path }) => ({
          contents: path.endsWith('ui')
            ? 'export const Button=({children,...props})=><button {...props}>{children}</button>;'
            : "export {connectionSchema} from '@dovo/protocol';",
          loader: 'tsx',
          resolveDir: new URL('../packages/extension-runtime/', import.meta.url).pathname,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const setup = async (
    status,
    fail = false,
    security = { checkedAt: '2026-10-06T10:00:00Z', status: 'ok', events: [] },
    settings = false,
  ) => {
    await page.goto(settings ? 'https://dovo.test/?settings' : 'https://dovo.test/')
    await page.evaluate(
      ({ status, fail, security }) => {
        window.saved = []
        window.connectionChecks = 0
        window.failConnection = fail
        window.holdConnection = false
        window.securityChecks = 0
        window.copiedReport = ''
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.copiedReport = text
            },
          },
        })
        window.dovo = {
          windowsRuntime: {
            security: async () => {
              window.securityChecks++
              return security
            },
            read: async () => status,
            connection: async () => {
              window.connectionChecks++
              if (window.holdConnection)
                await new Promise((resolve) => (window.releaseConnection = resolve))
              if (window.failConnection) throw new Error('Distribution no longer available')
              return {
                address: 'http://127.0.0.1:12345',
                token: 'local-owner-token-at-least-thirty-two-characters',
              }
            },
            save: async (choice) => {
              window.saved.push(choice)
              if (choice.mode === 'wsl' && window.failSave)
                throw new Error('Download checksum mismatch')
              if (choice.mode === 'native' && !window.keepConnectionFailure)
                window.failConnection = false
              return {
                address: 'http://127.0.0.1:12345',
                token: 'local-owner-token-at-least-thirty-two-characters',
              }
            },
          },
        }
      },
      { status, fail, security },
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
  }
  const base = {
    configured: false,
    choice: { mode: 'native' },
    distributions: [
      { name: 'Ubuntu Work', version: 2 },
      { name: 'Legacy', version: 1 },
    ],
  }
  const securityEvent = {
    timeCreated: '2026-10-06T09:55:00Z',
    ruleId: '9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2',
    processPath: 'C:\\Windows\\System32\\svchost.exe',
    targetPath: 'C:\\Windows\\System32\\lsass.exe',
  }
  const report = { checkedAt: '2026-10-06T10:00:00Z', status: 'ok', events: [securityEvent] }
  await setup(base, false, report)
  await page.getByRole('button', { name: 'Check Windows security', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.securityChecks), 0)
  await page.getByRole('button', { name: 'Check Windows security', exact: true }).click()
  await page.getByText(/without stopping it/).waitFor()
  await page.getByRole('button', { name: 'Copy report', exact: true }).click()
  assert.deepEqual(JSON.parse(await page.evaluate(() => window.copiedReport)), report)
  assert.equal(await page.evaluate(() => window.connectionChecks), 0)
  assert.deepEqual(await page.evaluate(() => window.saved), [])
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(base, false, { ...report, events: Array.from({ length: 20 }, () => securityEvent) })
  await page.getByRole('button', { name: 'Check Windows security', exact: true }).click()
  await page.getByText(/Most recent ASR blocks/).waitFor()
  const heading = await page.getByRole('heading', { name: 'Set up Dovo Studio' }).boundingBox()
  assert.ok(
    heading && heading.y >= 0 && heading.y < 844,
    'Long security reports keep setup controls accessible',
  )
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const [status, text] of [
    ['ok', /No ASR block events were recorded/],
    ['access-denied', /Windows denied access/],
    ['unavailable', /Defender events could not be read/],
  ]) {
    await setup(base, false, { ...report, status, events: [] })
    await page.getByRole('button', { name: 'Check Windows security', exact: true }).click()
    await page.getByText(text).waitFor()
  }
  await setup(base)
  await page.getByLabel('Execution environment', { exact: true }).selectOption('wsl')
  await page.getByLabel('WSL distribution').selectOption('Ubuntu Work')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  assert.equal(await page.getByLabel('Execution environment', { exact: true }).inputValue(), 'wsl')
  assert.equal(await page.getByRole('option', { name: 'Legacy', exact: true }).count(), 0)
  await page.evaluate(() => {
    window.failSave = true
  })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Download checksum mismatch' }).waitFor()
  assert.equal(await page.getByText('Workspace ready').count(), 0)
  await page.evaluate(() => {
    window.failSave = false
  })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('Workspace ready').waitFor()
  assert.deepEqual(await page.evaluate(() => window.saved), [
    { mode: 'wsl', distribution: 'Ubuntu Work' },
    { mode: 'wsl', distribution: 'Ubuntu Work' },
  ])
  await setup(
    { ...base, configured: true, choice: { mode: 'wsl', distribution: 'Ubuntu Work' } },
    true,
  )
  await page.getByRole('alert').filter({ hasText: 'Distribution no longer available' }).waitFor()
  await page.getByLabel('Execution environment', { exact: true }).selectOption('native')
  await page.getByRole('button', { name: 'Apply environment', exact: true }).click()
  await page.getByText('Workspace ready').waitFor()
  assert.deepEqual(await page.evaluate(() => window.saved), [{ mode: 'native' }])
  await setup(base)
  await page.evaluate(() => {
    window.holdConnection = true
  })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Connecting workspace…', exact: true }).waitFor()
  assert.equal(await page.getByText('Workspace ready').count(), 0)
  await page.evaluate(() => {
    window.holdConnection = false
    window.releaseConnection()
  })
  await page.getByText('Workspace ready').waitFor()
  assert.equal(await page.evaluate(() => window.connectionChecks), 1)

  await setup(base)
  await page.evaluate(() => {
    window.failConnection = true
    window.keepConnectionFailure = true
  })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'The runtime was prepared, but the workspace connection failed' })
    .waitFor()
  assert.equal(await page.getByText('Workspace ready').count(), 0)
  await page.evaluate(() => {
    window.failConnection = false
  })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('Workspace ready').waitFor()

  await setup({ ...base, distributions: [], error: 'WSL unavailable' })
  await page.getByLabel('Execution environment', { exact: true }).selectOption('wsl')
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true)
  await page.getByLabel('Execution environment', { exact: true }).selectOption('native')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('Workspace ready').waitFor()
  // Settings must not reload until the selected runtime connection is verified.
  await setup({ ...base, configured: true }, false, undefined, true)
  await page.getByLabel('Execution environment', { exact: true }).selectOption('wsl')
  await page.evaluate(() => {
    window.holdConnection = true
  })
  await page.getByRole('button', { name: 'Apply environment', exact: true }).click()
  await page.getByRole('button', { name: 'Connecting workspace…', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.saved), [
    { mode: 'wsl', distribution: 'Ubuntu Work' },
  ])
  const reloaded = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  await page.evaluate(() => {
    window.holdConnection = false
    window.releaseConnection()
  })
  await reloaded
  await page.waitForLoadState()
  assert.equal(await page.locator('#app').textContent(), '')

  // A settings activation failure stays visible and permits retry without reloading.
  await setup({ ...base, configured: true }, false, undefined, true)
  await page.getByLabel('Execution environment', { exact: true }).selectOption('wsl')
  await page.evaluate(() => {
    window.failConnection = true
  })
  await page.getByRole('button', { name: 'Apply environment', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({
      hasText: 'The runtime was prepared, but the workspace connection failed',
    })
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Apply environment', exact: true }).isEnabled(),
    true,
  )
  assert.equal(await page.evaluate(() => window.connectionChecks), 1)
  const retried = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  await page.evaluate(() => {
    window.failConnection = false
  })
  await page.getByRole('button', { name: 'Apply environment', exact: true }).click()
  await retried
  await page.waitForLoadState()
  assert.equal(await page.locator('#app').textContent(), '')
  assert.deepEqual(errors, [])
  console.log(
    'Windows runtime chooser: security reports/copy/access errors, distribution selection, failed setup, native fallback and WSL-unavailable flows passed.',
  )
} finally {
  await browser.close()
}
