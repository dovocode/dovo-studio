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
    contents: `import {createRoot} from 'react-dom/client';import {WindowsRuntimeGate} from './src/windows-runtime.tsx';createRoot(document.getElementById('app')).render(<WindowsRuntimeGate><p>Workspace ready</p></WindowsRuntimeGate>);`,
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
  const setup = async (status, fail = false) => {
    await page.goto('https://dovo.test/')
    await page.evaluate(
      ({ status, fail }) => {
        window.saved = []
        window.connectionChecks = 0
        window.dovo = {
          windowsRuntime: {
            read: async () => status,
            connection: async () => {
              window.connectionChecks++
              if (fail) throw new Error('Distribution no longer available')
              return {
                address: 'http://127.0.0.1:12345',
                token: 'local-owner-token-at-least-thirty-two-characters',
              }
            },
            save: async (choice) => {
              window.saved.push(choice)
              if (choice.mode === 'wsl' && window.failSave)
                throw new Error('Download checksum mismatch')
              return {
                address: 'http://127.0.0.1:12345',
                token: 'local-owner-token-at-least-thirty-two-characters',
              }
            },
          },
        }
      },
      { status, fail },
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
  await setup({ ...base, distributions: [], error: 'WSL unavailable' })
  await page.getByLabel('Execution environment', { exact: true }).selectOption('wsl')
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true)
  await page.getByLabel('Execution environment', { exact: true }).selectOption('native')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('Workspace ready').waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Windows runtime chooser: distribution selection, failed setup, native fallback and WSL-unavailable flows passed.',
  )
} finally {
  await browser.close()
}
