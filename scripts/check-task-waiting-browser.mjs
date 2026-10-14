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
      '@dovo/studio-core': `export {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting.ts';export const encodeWorkTarget=JSON.stringify;export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>{window.opened=JSON.parse(target.entityId).url;window.internal=true},openPullLink:url=>{if(url.includes('/pull/')){window.opened=url;window.internal=true;return true}return false},openExternalLink:url=>{window.opened=url;window.internal=false}});`,
      '@dovo/studio-ui':
        'export const Button=({size,variant,children,...props})=><button {...props}>{children}</button>;export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogHeader=DialogContent;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;',
      '../../ui/layout/sheet': 'export const useSheetNavigation=()=>action=>action();',
      'expo-router': 'export const router={push:href=>{window.opened=href}};',
      '../../runtime/connection/provider': 'export const useRuntime=()=>window.store;',
      '../../ui/content/open-link':
        'export const openAppLink=async url=>{window.opened=url};export const useOpenAppLink=()=>openAppLink;',
      '../../ui/controls/icon': 'export const Icon=()=> <span>×</span>;',
      'react-native':
        'export const Keyboard={dismiss:()=>{}};export const Alert={alert:(title,message,buttons)=>{if(window.confirm(title)) buttons.find(b=>b.style==="destructive").onPress()}};export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,disabled})=><button role={accessibilityRole} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;',
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
    await page.clock.install()
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
        return { dependencies: window.items, related: window.related }
      }
      window.store = { connected: true, request, call: request }
    })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Stop watching PR #7', exact: true }).waitFor()
    assert.match(await page.locator('#app').innerText(), /Waiting for approval/)
    const link = page.getByRole('link', {
      name: mobile ? 'Open PR #7' : 'Project · PR #7',
      exact: true,
    })
    await link.click()
    assert.equal(await page.evaluate(() => window.opened), 'https://github.com/team/project/pull/7')
    if (!mobile) assert.equal(await page.evaluate(() => window.internal), true)
    if (mobile) page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Stop watching PR #7', exact: true }).click()
    if (!mobile) await page.getByRole('button', { name: 'Keep watching', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.some((call) => call.unlink)), false)
    if (mobile) page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Stop watching PR #7', exact: true }).click()
    if (!mobile) await page.getByRole('button', { name: 'Stop watching', exact: true }).click()
    await page.waitForFunction(() => !document.body.textContent.includes('PR #7'))
    assert.equal(
      await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).count(),
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
      await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).count(),
      1,
    )
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: /Refresh/ }).click()
    await page.waitForFunction(() => !document.querySelector('[role=alert]'))
    await page.evaluate(() => {
      window.items[0].pausedReason = 'Monitoring paused: watcher disabled in runtime settings'
    })
    await page.getByRole('button', { name: /Refresh/ }).click()
    await page.getByText('Paused', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.store.connected = false
      window.render()
    })
    await page.waitForFunction(() => document.body.textContent.toLowerCase().includes('offline'))
    assert.equal(await page.getByRole('button', { name: /Refresh/ }).isDisabled(), true)
    assert.equal(
      await page
        .getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true })
        .isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.store.connected = true
      window.render()
    })
    await page.getByRole('button', { name: 'Stop watching Pipeline run 8', exact: true }).click()
    if (!mobile) await page.getByRole('button', { name: 'Stop watching', exact: true }).click()
    await page.waitForFunction(() => document.getElementById('app').textContent === '')
    // The empty panel keeps discovering new watches without taking up space.
    await page.evaluate(() => {
      window.items = [
        {
          kind: 'pipeline',
          repositoryId: 'repo',
          target: '10',
          label: 'Pipeline run 10',
          project: 'Project',
          url: 'https://github.com/team/project/actions/runs/10',
          status: 'running',
        },
      ]
    })
    await page.clock.fastForward(15000)
    await page.getByRole('button', { name: 'Stop watching Pipeline run 10', exact: true }).waitFor()
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
    await page.getByRole('button', { name: 'Stop watching Pipeline run 9', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Stop watching Pipeline run 9', exact: true }).click()
    if (!mobile) await page.getByRole('button', { name: 'Stop watching', exact: true }).click()
    await page.waitForFunction(() => document.getElementById('app').textContent === '')
    assert.equal(await page.evaluate(() => window.calls.at(-1).taskId), 'second')
    // A related item remains a link after monitoring ends, with no stop control.
    await page.evaluate(() => {
      window.related = [
        {
          label: 'Pipeline run 9',
          project: 'Other',
          url: 'https://github.com/other/repo/actions/runs/9',
        },
      ]
    })
    await page.clock.fastForward(15000)
    await page
      .getByRole('link', {
        name: mobile ? 'Open Pipeline run 9' : 'Other · Pipeline run 9',
        exact: true,
      })
      .click()
    assert.equal(
      await page.evaluate(() => window.opened),
      'https://github.com/other/repo/actions/runs/9',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Stop watching Pipeline run 9', exact: true }).count(),
      0,
    )
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} waiting panel: dependencies, unlink, errors/retry, offline, and thread isolation passed`,
    )
  }
} finally {
  await browser.close()
}
