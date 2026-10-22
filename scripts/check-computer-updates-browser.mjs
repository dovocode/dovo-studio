import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/screens/'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {ComputerUpdates as Desktop} from './packages/extension-runtime/src/computer-updates.tsx';
    import {ComputerUpdates as Mobile} from './apps/mobile/src/screens/computer-updates.tsx';
    const app=createRoot(document.getElementById('app'));
    window.show=kind=>app.render(kind==='desktop'?<Desktop/>:<Mobile/>);
  `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      react: root + 'packages/studio-ui/node_modules/react',
    },
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.workspace;' },
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${root}packages/studio-ui/src/components/ui/dialog.tsx';export const Button=({children,...props})=><button {...props}>{children}</button>;export const MessageResponse=({children})=>children;`,
    },
    {
      path: 'react-native',
      contents:
        "export const View=({children})=><div>{children}</div>;export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};",
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.workspace;',
    },
    {
      path: '../ui/content/text',
      importer: mobile,
      contents: 'export const Text=({children})=><span>{children}</span>;',
    },
    {
      path: './settings-controls',
      importer: mobile,
      contents:
        'export const SettingsAction=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;',
    },
    {
      path: '../ui/controls/switch',
      importer: mobile,
      contents:
        'export const Switch=({value,onValueChange,accessibilityLabel})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={event=>onValueChange(event.target.checked)}/>;',
    },
    {
      path: '../ui/theme',
      importer: mobile,
      contents: 'export const useTheme=()=>({styles:{},colors:{}});',
    },
    {
      path: './settings-group',
      importer: mobile,
      contents: 'export const SettingsGroup=({children})=><section>{children}</section>;',
    },
    {
      path: '../ui/layout/sheet',
      importer: mobile,
      contents:
        'export const Sheet=({children,title})=><div role="dialog" aria-label={title}>{children}</div>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const client of ['desktop', 'mobile'])
    for (const resumeInterrupted of [false, true]) {
      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent('<div id="app"></div>')
      await page.clock.install()
      await page.evaluate(() => {
        const base = {
          revision: 0,
          owner: false,
          approvals: [],
          terminals: [],
          runs: [],
          devices: [],
          pendingDevices: [],
          releaseVersion: '1.0.0',
          releaseDistribution: 'archive',
          releaseCanUpdate: true,
          workspace: {
            version: 1,
            runtimeAddress: '',
            agents: [],
            repositories: [],
            tasks: [],
            automations: [],
          },
        }
        const entry = (id, extra = {}) => ({
          profile: {
            id,
            name: id,
            connection: { address: 'http://' + id + '.local', token: 'device-token' },
          },
          connected: true,
          snapshot: { ...base, ...extra },
        })
        const entries = [
          entry('desktop', { releaseDistribution: 'desktop' }),
          entry('server'),
          { ...entry('offline'), connected: false },
          entry('current', { releaseVersion: '1.0.1' }),
          entry('external', { releaseCanUpdate: false }),
        ]
        window.workspace = { runtimes: entries, overviews: entries, refreshRuntime: async () => {} }
        window.commands = []
        window.statusRequests = []
        window.hostStatuses = {}
        window.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input.toString())
          if (url.hostname === 'api.github.com')
            return Response.json(
              url.pathname.endsWith('/latest')
                ? {
                    tag_name: 'v1.0.1',
                    html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v1.0.1',
                    body: 'Changes',
                  }
                : [],
            )
          const id = url.hostname.split('.')[0]
          if (url.pathname.endsWith('/status')) {
            window.statusRequests.push(id)
            return Response.json(window.hostStatuses[id] ?? { status: 'idle' })
          }
          window.commands.push({ id, body: JSON.parse(init.body) })
          return Response.json({ status: 'queued', version: '1.0.1' })
        }
      })
      await page.addScriptTag({ content: built.outputFiles[0].text })
      await page.evaluate((client) => window.show(client), client)
      if (client === 'desktop') {
        await page.clock.runFor(6001)
        assert.deepEqual(await page.evaluate(() => window.statusRequests), [])
        await page.getByRole('button', { name: 'Computer updates', exact: true }).click()
      }
      const update = page.getByRole('button', { name: 'Update all (2)', exact: true })
      await update.waitFor({ timeout: 10000 }).catch(async (error) => {
        console.log(client, errors, await page.locator('body').innerText())
        throw error
      })
      if (client === 'desktop') {
        const updates = page.getByRole('dialog', { name: 'Computer updates', exact: true })
        await updates.getByRole('button', { name: 'Close', exact: true }).click()
        await updates.waitFor({ state: 'detached' })
        const requests = await page.evaluate(() => window.statusRequests.length)
        await page.clock.runFor(6001)
        assert.equal(await page.evaluate(() => window.statusRequests.length), requests)
        await page.getByRole('button', { name: 'Computer updates', exact: true }).click()
      }
      await update.click()
      const dialog = page.getByRole('dialog', { name: 'Update all computers', exact: true })
      const choice = dialog.getByLabel('Resume interrupted threads after restart')
      assert.equal(await choice.isChecked(), false)
      assert.deepEqual(await page.evaluate(() => window.commands), [])
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.commands), [])
      await update.click()
      if (resumeInterrupted) await choice.check()
      await dialog.getByRole('button', { name: 'Update and restart (2)', exact: true }).click()
      await page.waitForFunction(() => window.commands.length === 2)
      assert.deepEqual(await page.evaluate(() => window.commands), [
        {
          id: 'desktop',
          body: { version: '1.0.1', restartAfterDownload: true, resumeInterrupted },
        },
        { id: 'server', body: { version: '1.0.1' } },
      ])
      if (client === 'desktop') {
        await page.evaluate(() => {
          window.hostStatuses.desktop = { status: 'downloaded', version: '1.0.1' }
          window.hostStatuses.server = { status: 'complete', version: '1.0.1' }
        })
        const updates = page.getByRole('dialog', { name: 'Computer updates', exact: true })
        await updates.getByRole('button', { name: 'Close', exact: true }).click()
        await updates.waitFor({ state: 'detached' })
        await page.clock.runFor(3001)
        await page.waitForFunction(() => window.commands.length === 3)
        assert.deepEqual(await page.evaluate(() => window.commands[2]), {
          id: 'desktop',
          body: { version: '1.0.1', restartAfterDownload: false, resumeInterrupted },
        })
        await page.getByRole('button', { name: 'Computer updates', exact: true }).click()
        await page
          .getByRole('checkbox', { name: 'Select desktop for update', exact: true })
          .waitFor()
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  console.log(
    'Computer updates: desktop idle polling, dialog reopen, background automatic restarts, and desktop/mobile consent choices passed',
  )
} finally {
  await browser.close()
}
