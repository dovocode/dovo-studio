import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const built = await build({
  stdin: {
    contents: `import {copyTextToClipboard} from './packages/studio-ui/src/clipboard';
const dialog=document.querySelector('[role=dialog]');
document.addEventListener('focusin', event=>{if(window.trap && !dialog.contains(event.target)) document.querySelector('textarea').focus()});
for(const button of document.querySelectorAll('button')) {
  button.onmousedown=event=>event.preventDefault();
  button.onclick=async()=>{try{await copyTextToClipboard(window.copyValue);window.result='copied'}catch(error){window.result=error.message}};
}`,
    resolveDir: new URL('../', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
})
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(
    `<div role="dialog"><textarea aria-label="Draft">Keep my draft selection</textarea><button>Copy</button></div><p>Selected thread prose</p><script>${built.outputFiles[0].text}</script>`,
  )
})
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve))
const port = server.address().port
const browser = await chromium.launch({
  headless: true,
  args: ['--host-resolver-rules=MAP clipboard.test 127.0.0.1'],
})
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const reader = await context.newPage()
  await reader.goto(`http://127.0.0.1:${port}`)
  for (const mode of ['modern', 'denied', 'http', 'native']) {
    const page = await context.newPage()
    await page.goto(`http://${mode === 'http' ? 'clipboard.test' : '127.0.0.1'}:${port}`)
    const value =
      `${mode}: literal Markdown **bold**, two  spaces,\n Unicode ✓\n` +
      'Long selection. '.repeat(4000)
    await page.evaluate(
      ({ mode, value }) => {
        window.copyValue = value
        window.trap = true
        if (mode === 'native') {
          window.dovoCopyText = async (text) => {
            window.nativeText = text
          }
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async () => {
                throw new Error('Renderer clipboard must not be used')
              },
            },
          })
        }
        if (mode === 'denied')
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async () => {
                throw new DOMException('Denied', 'NotAllowedError')
              },
            },
          })
        if (mode === 'http' && navigator.clipboard)
          throw new Error('Expected insecure HTTP context')
        const input = document.querySelector('textarea')
        input.focus()
        input.setSelectionRange(5, 13, 'backward')
      },
      { mode, value },
    )
    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await page.waitForFunction(() => window.result !== undefined)
    assert.equal(await page.evaluate(() => window.result), 'copied', mode)
    if (mode === 'native') assert.equal(await page.evaluate(() => window.nativeText), value)
    else {
      await reader.bringToFront()
      assert.equal(await reader.evaluate(() => navigator.clipboard.readText()), value, mode)
    }
    assert.deepEqual(
      await page
        .locator('textarea')
        .evaluate((input) => [
          input.value,
          input.selectionStart,
          input.selectionEnd,
          input.selectionDirection,
        ]),
      ['Keep my draft selection', 5, 13, 'backward'],
    )
    await page.close()
  }
  console.log(
    'Clipboard: native bridge, modern, denied API and LAN HTTP copy preserve long literal text, modal focus and draft selection.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
