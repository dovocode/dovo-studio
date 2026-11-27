import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { bundleBrowser, chromium } from './browser/harness.mjs'

await test('distinguishes a phone’s readiness from live preview support', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const ui = root + 'packages/studio-ui'
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import { createRoot } from 'react-dom/client';
import { DeviceList } from './packages/extension-tasks/src/browser/device-list.tsx';
import { TooltipProvider } from '@dovo/studio-ui';
const phone = { id: 'phone', kind: 'physical', platform: 'ios', runtime: 'iOS 26', name: 'USB iPhone', state: 'stopped', connection: 'USB' };
const ready = { ...phone, id: 'ready', name: 'Ready iPhone', state: 'booted', liveSupported: false };
const simulator = { id: 'simulator', kind: 'simulator', platform: 'ios', runtime: 'iOS-26', name: 'iOS Simulator', state: 'stopped' };
window.deviceActions = [];
createRoot(document.getElementById('app')).render(<TooltipProvider>
  <DeviceList devices={[phone, ready, simulator]} host="Test Mac" busy={false} connected
    onOpen={device => window.deviceActions.push(['open', device.id])}
    onAction={(device, action) => window.deviceActions.push([action, device.id])} />
</TooltipProvider>);`,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      alias: { react: ui + '/node_modules/react' },
      nodePaths: [ui + '/node_modules'],
    },
    [
      {
        path: '@dovo/studio-ui',
        contents: `
export { Button } from '${ui}/src/components/ui/button';
export { IconButton } from '${ui}/src/components/icon-button';
export { TooltipProvider } from '${ui}/src/components/ui/tooltip';
export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
      },
    ],
  )
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const unavailable = page.getByRole('button', { name: /^USB iPhone/ })
    await unavailable.waitFor()
    assert.equal(await unavailable.isDisabled(), true)
    assert.match(await unavailable.innerText(), /Unavailable/)
    assert.doesNotMatch(await unavailable.innerText(), /Start/)

    const ready = page.getByRole('button', { name: /^Ready iPhone/ })
    assert.equal(await ready.isDisabled(), true)
    assert.match(await ready.innerText(), /USB · Ready/)
    assert.match(await ready.innerText(), /Live preview unavailable/)

    const simulator = page.getByRole('button', { name: /^iOS Simulator/ })
    assert.match(await simulator.innerText(), /Start/)
    await simulator.click()
    assert.deepEqual(await page.evaluate(() => window.deviceActions), [['boot', 'simulator']])
  } finally {
    await browser.close()
  }
})
