import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

// Match the production header structure with the real stylesheet and work control classes.
const root = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(root + 'packages/extension-tasks/src/bots/bot-work-summary.tsx', 'utf8')
const summaryClass = source.match(/className="(studio-bot-work-summary [^"]+)"/)?.[1]
assert.ok(summaryClass, 'Bot work control classes found')
const cssServer = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await cssServer.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await cssServer.close()
}
await mkdir(root + 'work/bot-header', { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 320 } })
  for (const mode of ['dark', 'light']) {
    await page.setContent(`
      <html class="${mode === 'dark' ? 'dark' : ''}" data-theme="${mode}"><body style="margin:0">
        <div class="studio" style="height:320px">
          <div class="studio-thread-pane-body flex" style="height:320px">
            <div class="studio-thread-pane-frame relative flex min-h-0 min-w-0 flex-1 flex-col">
              <header class="studio-task-thread-header studio-pane-header" data-window-edge>
                <nav class="studio-titlebar-heading min-w-0 flex-1">
                  <h1 class="studio-titlebar-task">Release Bot</h1>
                </nav>
                <button>+</button>
                <span class="studio-pane-shoulder" aria-hidden="true"></span>
                <section aria-label="Bot work overview" class="${summaryClass}">
                  <button aria-label="Routines · 0" class="h-7 shrink-0 rounded-full border px-2">▣ 0</button>
                  <button aria-label="Workers · 0 active" class="h-7 shrink-0 rounded-full border px-2">♙ 0</button>
                  <button aria-label="Archive and start new" class="size-8 shrink-0">▤</button>
                </section>
                <button>Call</button><button>Thread tools</button>
              </header>
              <div class="studio-thread-stack flex min-h-0 flex-1">
                <div class="studio-work-pane relative h-full min-h-0 flex-1" data-conversation-boundary>
                  Conversation
                </div>
              </div>
            </div>
          </div>
        </div>
      </body></html>
    `)
    await page.addStyleTag({ content: css })
    const header = page.locator('.studio-task-thread-header')
    const actions = header.getByRole('region', { name: 'Bot work overview' })
    assert.equal(await actions.count(), 1)
    for (const width of [320, 1280]) {
      await page.locator('.studio-thread-pane-frame').evaluate((frame, width) => {
        frame.style.maxWidth = width + 'px'
      }, width)
      const rail = await actions.boundingBox()
      const shoulder = await header.locator('.studio-pane-shoulder').boundingBox()
      const call = await header.getByRole('button', { name: 'Call', exact: true }).boundingBox()
      const bar = await header.boundingBox()
      const pane = await page.locator('[data-conversation-boundary]').boundingBox()
      assert.ok(rail.x >= shoulder.x + shoulder.width, `${mode}: actions follow the pane fill`)
      assert.ok(rail.x + rail.width <= call.x, `${mode}: actions sit before Call`)
      assert.ok(rail.y >= bar.y && rail.y + rail.height <= bar.y + bar.height)
      assert.equal(pane.y, bar.y + bar.height, `${mode}: conversation starts below the header`)
    }
    await page.screenshot({ path: root + 'work/bot-header/' + mode + '.png' })
  }
  console.log(
    'Bot header layout: work and archive actions sit beside Call in wide and narrow panes in light and dark themes.',
  )
} finally {
  await browser.close()
}
