import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {PreferenceSaveNotice} from './packages/studio-shell/src/preference-save-notice.tsx';import {ServiceUrlSettings} from './packages/extension-runtime/src/service-url-settings.tsx';createRoot(document.getElementById('app')).render(<><PreferenceSaveNotice/><ServiceUrlSettings/></>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    conditions: ['development'],
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '${root}packages/studio-core/src/preferences.ts';export const useSettingsDraft=()=>{};`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const SettingsGroup=({children,title})=><section><h2>{title}</h2>{children}</section>;export const SettingsStorageInfo=({children})=><div>{children}</div>;export const SettingsSaveBar=({onSave,onDiscard})=><div><button onClick={onSave}>Save URLs</button><button onClick={onDiscard}>Discard</button></div>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const desktop of [false, true]) {
    const page = await browser.newPage()
    await page.route('http://studio.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    await page.goto('http://studio.test/')
    await page.evaluate((desktop) => {
      window.failSave = true
      window.failRead = false
      window.saved = null
      if (desktop)
        window.dovo = {
          readAppSettings: () => {
            if (window.failRead) throw Error('Temporary read error')
            return window.saved
          },
          writeAppSettings: (value) => {
            if (window.failSave) throw Error('Disk full')
            window.saved = JSON.parse(value)
          },
        }
      else {
        const write = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem').value
        const read = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem').value
        Storage.prototype.getItem = function (key) {
          if (window.failRead) throw Error('Temporary read error')
          return read.call(this, key)
        }
        Storage.prototype.setItem = function (key, value) {
          if (window.failSave) throw Error('Disk full')
          write.call(this, key, value)
          window.saved = JSON.parse(value)
        }
      }
    }, desktop)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByLabel('Dovo Connect URL', { exact: true }).fill('https://connect.example.test')
    await page.getByRole('button', { name: 'Save URLs', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Studio could not read or save settings' })
      .waitFor()
    assert.equal(
      await page.getByText('Service URLs saved on this device.', { exact: true }).count(),
      0,
    )
    assert.equal(
      await page.getByLabel('Dovo Connect URL', { exact: true }).inputValue(),
      'https://connect.example.test',
    )
    assert.equal(
      await page.evaluate(
        () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
      ),
      true,
    )
    await page.evaluate(() => (window.failSave = false))
    await page.getByRole('button', { name: 'Retry saving settings', exact: true }).click()
    await page.waitForFunction(() => window.saved?.connectOrigin === 'https://connect.example.test')
    await page.getByText('Service URLs saved on this device.', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Retry saving settings', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.failRead = true
    })
    await page.getByLabel('Dovo Connect URL', { exact: true }).fill('https://retry.example.test')
    await page.getByRole('button', { name: 'Save URLs', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Temporary read error' }).waitFor()
    assert.equal(
      await page.evaluate(() => window.saved.connectOrigin),
      'https://connect.example.test',
    )
    assert.equal(
      await page.getByLabel('Dovo Connect URL', { exact: true }).inputValue(),
      'https://retry.example.test',
    )
    await page.evaluate(() => {
      window.failRead = false
    })
    await page.getByRole('button', { name: 'Retry saving settings', exact: true }).click()
    await page.waitForFunction(() => window.saved.connectOrigin === 'https://retry.example.test')
    await page.getByRole('alert').waitFor({ state: 'detached' })
    await page.close()
  }
  console.log(
    'Web and desktop preferences: failed reads and saves preserve settings and edits; retry saves URLs without false success.',
  )
} finally {
  await browser.close()
}
