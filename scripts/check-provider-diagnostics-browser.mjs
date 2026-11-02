import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const react = createRequire(root + 'packages/studio-ui/package.json')
const browser = await chromium.launch({ headless: true })
const native = `
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':accessibilityRole}>{children}</span>;
export const useTheme=()=>({styles:{}});
export const SettingsAction=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SettingsChoice=({label,value,disabled,items,onChange})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
`
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core/state': "export {useState as useApplicationState} from 'react'",
      '../runtime/state/application-state': "export {useState as useApplicationState} from 'react'",
      '@dovo/studio-core': `export const useWorkspace=()=>({connected:window.connected,workspace:window.workspace,request:window.request});export const useAppPreferences=()=>({providerUpdateChecks:false});`,
      '../runtime/connection/provider': `import {Effect} from 'effect';export const useRuntime=()=>({connected:window.connected,snapshot:{workspace:window.workspace},callEffect:(...args)=>Effect.tryPromise({try:()=>window.request(...args),catch:error=>error})});`,
      'react-native': native,
      '../ui/content/text': native,
      '../ui/theme': native,
      '../screens/settings-controls': native,
    }
    const built = await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `import {createRoot} from 'react-dom/client';import {HarnessUpdates} from '${root}${mobile ? 'apps/mobile/src/agents' : 'packages/studio-ui/src'}/harness-updates';const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<HarnessUpdates/>);window.render();`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      conditions: ['development'],
      define: { 'process.env.NODE_ENV': '"development"' },
      alias: {
        react: react.resolve('react'),
        'react/jsx-runtime': react.resolve('react/jsx-runtime'),
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      plugins: [
        {
          name: 'diagnostics-fixture',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + 'packages/studio-ui',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.evaluate(() => {
      window.connected = true
      window.workspace = {
        agents: [
          { id: 'custom', name: 'Work Codex', provider: 'codex' },
          { id: 'claude', name: 'Claude', provider: 'claude' },
        ],
      }
      window.calls = []
      window.request = async (path, body) => {
        window.calls.push({ path, body })
        if (path === '/api/agents/updates') return []
        if (window.fail) throw new Error('Runtime unreachable')
        return new Promise((resolve) => {
          window.finish = () => resolve({ ok: true, durationMs: 1200, output: 'WebSocket OK' })
        })
      }
    })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const test = page.getByRole('button', { name: 'Test Codex network', exact: true })
    await test.waitFor()
    const profile = page.getByLabel('Codex diagnostic profile', { exact: true })
    assert.deepEqual(await profile.locator('option').allTextContents(), [
      'Default Codex executable',
      'Work Codex',
    ])
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/network-diagnostics')).length,
      ),
      0,
    )
    await profile.selectOption('custom')
    await test.click()
    await page.getByRole('button', { name: 'Testing Codex network…', exact: true }).waitFor()
    assert.equal(await profile.isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), {
      path: '/api/agents/codex/network-diagnostics',
      body: { agentId: 'custom' },
    })
    await page.evaluate(() => window.finish())
    await page.getByText('WebSocket OK', { exact: true }).waitFor()
    await profile.selectOption('')
    assert.equal(await page.getByText('WebSocket OK', { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.fail = true
    })
    await test.click()
    await page.getByRole('alert').filter({ hasText: 'Runtime unreachable' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).body), {})
    await page.evaluate(() => {
      window.connected = false
      window.render()
    })
    await page.waitForFunction(() => document.querySelector('select').disabled)
    assert.equal(await test.isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Desktop/mobile Codex diagnostics passed: explicit-only requests, selected profile, pending state, output, failure and offline controls.',
  )
} finally {
  await browser.close()
}
