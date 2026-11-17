import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from './harness.mjs'

const css = await readFile(
  new URL('../../packages/studio-ui/src/styles.css', import.meta.url),
  'utf8',
)

for (const side of ['left', 'right'])
  await test(`glass ${side} sidebar keeps its resize handle above adjacent content`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      await page.setContent(`
        <style>${css}</style>
        <div style="display:flex;flex-direction:${side === 'left' ? 'row' : 'row-reverse'};height:500px;--studio-surface-filter:blur(8px)">
          <aside class="studio-side-panel studio-resizable-sidebar" style="position:relative;width:280px;flex-shrink:0">
            Sidebar
            <div role="separator" aria-label="Resize sidebar" style="position:absolute;top:0;bottom:0;${side === 'left' ? 'right' : 'left'}:-4px;width:8px;z-index:40"></div>
          </aside>
          <main style="position:relative;flex:1;background:gray">Chat</main>
        </div>
      `)
      assert.notEqual(
        await page.locator('aside').evaluate((element) => getComputedStyle(element).backdropFilter),
        'none',
        'The regression fixture must create the glass stacking context',
      )
      const handle = page.getByRole('separator', { name: 'Resize sidebar' })
      assert.equal(
        await handle.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return [1, rect.width / 2, rect.width - 1].every(
            (offset) => document.elementFromPoint(rect.x + offset, rect.y + 100) === element,
          )
        }),
        true,
        'The entire resize handle must receive pointer input across the pane boundary',
      )
    } finally {
      await browser.close()
    }
  })
