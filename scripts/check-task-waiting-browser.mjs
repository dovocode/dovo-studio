import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await chromium.launch({ headless: true })
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': `export {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting.ts';export const useWorkspace=()=>window.store;`,
      '@dovo/studio-ui':
        'export const Button=({size,variant,children,...props})=><button {...props}>{children}</button>;',
      '../../runtime/connection/provider': 'export const useRuntime=()=>window.store;',
      'react-native':
        'export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;',
      '../../ui/content/text':
        'export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
      '../../ui/controls/action':
        'export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
      '../../ui/theme':
        'export const useTheme=()=>({styles:{text:{},muted:{}},colors:{error:"red"}});',
    }
    const built = await build({
      stdin: {
        contents: `import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {TaskWaitingPanel} from '${root}${mobile ? 'apps/mobile/src/tasks/detail' : 'packages/extension-tasks/src/detail'}/task-waiting-panel.tsx';const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<StrictMode><TaskWaitingPanel key={window.target} taskId={window.target}/></StrictMode>);window.render();`,
        loader: 'tsx',
        resolveDir: root + 'packages/extension-tasks/',
      },
      alias: {
        react: createRequire(root + 'packages/extension-tasks/package.json').resolve('react'),
        'react/jsx-runtime': createRequire(root + 'packages/extension-tasks/package.json').resolve(
          'react/jsx-runtime',
        ),
      },
      bundle: true,
      write: false,
      format: 'iife',
      jsx: 'automatic',
      conditions: ['development'],
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [
        {
          name: 'waiting-fixture',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + 'packages/studio-core/',
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
      window.target = 'first'
      window.fail = false
      window.calls = []
      window.items = [
        {
          kind: 'pull',
          repositoryId: 'repo',
          target: 'https://github.com/team/project/pull/7',
          label: 'PR #7',
          project: 'Project',
          url: 'https://github.com/team/project/pull/7',
          status: 'Waiting for PR feedback',
        },
        {
          kind: 'pipeline',
          repositoryId: 'repo',
          target: '8',
          label: 'Pipeline run 8',
          project: 'Project',
          url: 'https://github.com/team/project/actions/runs/8',
          status: 'blocked',
          error: 'Waiting for approval',
        },
      ]
      const request = async (path, input) => {
        window.calls.push({ path, ...input })
        if (window.fail) throw new Error('Connection failed')
        if (input.unlink)
          window.items = window.items.filter((item) => item.target !== input.unlink.target)
        return { dependencies: window.items }
      }
      window.store = { connected: true, request, call: request }
    })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Unlink PR #7', exact: true }).waitFor()
    assert.match(await page.locator('#app').innerText(), /Waiting for approval/)
    await page.getByRole('button', { name: 'Unlink PR #7', exact: true }).click()
    await page.waitForFunction(() => !document.body.textContent.includes('PR #7'))
    assert.equal(
      await page.getByRole('button', { name: 'Unlink Pipeline run 8', exact: true }).count(),
      1,
    )
    const call = await page.evaluate(() => window.calls.find((item) => item.unlink))
    assert.equal(call.path, '/api/tasks/waiting')
    assert.deepEqual(call.unlink, {
      kind: 'pull',
      repositoryId: 'repo',
      target: 'https://github.com/team/project/pull/7',
    })
    await page.evaluate(() => {
      window.fail = true
    })
    await page.getByRole('button', { name: /Refresh/ }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /Connection failed/)
    assert.equal(
      await page.getByRole('button', { name: 'Unlink Pipeline run 8', exact: true }).count(),
      1,
    )
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: /Refresh/ }).click()
    await page.waitForFunction(() => !document.querySelector('[role=alert]'))
    await page.getByRole('button', { name: 'Unlink Pipeline run 8', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('No active waiting items.'))
    await page.evaluate(() => {
      window.store.connected = false
      window.render()
    })
    await page.waitForFunction(() => document.body.textContent.includes('Connect the runtime'))
    assert.equal(await page.getByRole('button', { name: /Refresh/ }).isDisabled(), true)
    await page.evaluate(() => {
      window.store.connected = true
      window.target = 'second'
      window.items = [
        {
          kind: 'pipeline',
          repositoryId: 'other',
          target: '9',
          label: 'Pipeline run 9',
          project: 'Other',
          url: 'https://github.com/other/repo/actions/runs/9',
          status: 'running',
        },
      ]
      window.render()
    })
    await page.getByRole('button', { name: 'Unlink Pipeline run 9', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Unlink Pipeline run 9', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('No active waiting items.'))
    assert.equal(await page.evaluate(() => window.calls.at(-1).taskId), 'second')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} waiting panel: dependencies, unlink, errors/retry, offline, and thread isolation passed`,
    )
  }
} finally {
  await browser.close()
}
