import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from './harness.mjs'

await test('glass browser header keeps address suggestions above the page', async () => {
  const css = await readFile(
    new URL('../../packages/studio-ui/src/styles.css', import.meta.url),
    'utf8',
  )
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(`
      <style>${css}</style>
      <main style="display:flex;flex-direction:column;height:500px">
        <header class="studio-browser-header" style="height:56px;backdrop-filter:blur(8px)">
          <div style="position:relative;z-index:20">
            <input aria-label="Address" value="localhost">
            <div role="listbox" style="position:absolute;top:56px;z-index:50;width:400px;height:100px;background:white">
              <button role="option">Local page</button>
            </div>
          </div>
        </header>
        <div data-browser-viewport style="position:relative;flex:1;background:gray"></div>
      </main>
    `)
    const suggestion = page.getByRole('listbox')
    assert.equal(
      await suggestion.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + 20, rect.y + 20))
      }),
      true,
      'The popup must receive pointer input where it overlaps the page',
    )
    await page.getByRole('option').click()
  } finally {
    await browser.close()
  }
})
