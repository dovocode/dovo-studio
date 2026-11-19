import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './harness.mjs'

await test('a link preview keeps the first opener click after the window regains focus', async () => {
  const bundle = await build({
    stdin: {
      contents: `import {onNativeBrowserBackgroundClick} from './native-browser-layout'
        window.returns = 0
        onNativeBrowserBackgroundClick(document.querySelector('#opener'), () => window.returns++)
      `,
      resolveDir: fileURLToPath(
        new URL('../../packages/extension-tasks/src/browser/', import.meta.url),
      ),
    },
    bundle: true,
    write: false,
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(
      '<style>body{height:100vh;margin:0}#opener{width:300px;height:200px}</style><button id="opener">Return to opener</button><button id="close">Close preview</button>',
    )
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const returnFromAnotherWindow = () =>
      page.evaluate(() => {
        // Headless Chromium emulates focus on every page. Supply the window focus transitions.
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
        window.dispatchEvent(new Event('blur'))
        delete document.hasFocus
        window.dispatchEvent(new Event('focus'))
      })
    for (const clipped of [true, false]) {
      await page.locator('#opener').evaluate((button, clipped) => {
        button.style.pointerEvents = clipped ? 'none' : ''
        window.returns = 0
      }, clipped)
      await returnFromAnotherWindow()
      await page.mouse.click(50, 50)
      assert.equal(await page.evaluate(() => window.returns), 0)
      await page.mouse.click(50, 50)
      assert.equal(await page.evaluate(() => window.returns), 1)
    }
    await returnFromAnotherWindow()
    await page.locator('#close').click()
    await page.locator('#opener').click()
    assert.equal(await page.evaluate(() => window.returns), 2)
    await returnFromAnotherWindow()
    await page.locator('#opener').press('Enter')
    assert.equal(await page.evaluate(() => window.returns), 3)
  } finally {
    await browser.close()
  }
})
