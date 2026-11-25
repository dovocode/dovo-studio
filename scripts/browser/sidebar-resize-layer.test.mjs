import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from './harness.mjs'

const css = await readFile(
  new URL('../../packages/studio-ui/src/styles.css', import.meta.url),
  'utf8',
)

for (const side of ['left', 'right'])
  for (const hasTouch of [false, true])
    await test(`${side} sidebar handle leaves the adjacent pane scrollable with ${hasTouch ? 'touch' : 'a mouse'}`, async () => {
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, hasTouch })
        // Give the pane a stacking context regardless of its material.
        await page.setContent(`
        <style>
          .studio-resizable-sidebar > [data-sidebar-resize-edge='left'] { left: -4px; }
          .studio-resizable-sidebar > [data-sidebar-resize-edge='right'] { right: -4px; }
          ${css}
        </style>
        <div style="display:flex;flex-direction:${side === 'left' ? 'row' : 'row-reverse'};height:500px">
          <aside class="studio-side-panel studio-resizable-sidebar" style="position:relative;width:280px;flex-shrink:0;isolation:isolate">
            Sidebar
            <div role="separator" aria-label="Resize sidebar" data-sidebar-resize-edge="${side === 'left' ? 'right' : 'left'}" style="position:absolute;top:0;bottom:0;width:8px;z-index:40"></div>
          </aside>
          <main style="position:relative;flex:1;background:gray">Chat</main>
        </div>
      `)
        const handle = page.getByRole('separator', { name: 'Resize sidebar' })
        assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), hasTouch)
        assert.equal(
          await handle.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return [1, rect.width / 2, rect.width - 1].every(
              (offset) => document.elementFromPoint(rect.x + offset, rect.y + 100) === element,
            )
          }),
          true,
          'The entire resize handle must receive pointer input',
        )
        const overlapsChat = await page.locator('main').evaluate((element, side) => {
          const rect = element.getBoundingClientRect()
          const x = side === 'left' ? rect.left + 2 : rect.right - 2
          return document.elementFromPoint(x, rect.y + 100)?.getAttribute('role') === 'separator'
        }, side)
        assert.equal(overlapsChat, !hasTouch)
      } finally {
        await browser.close()
      }
    })
