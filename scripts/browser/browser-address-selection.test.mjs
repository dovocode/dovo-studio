import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './harness.mjs'

await test('address suggestions leave composition keys to the input method', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { useRef, useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { BrowserAddressInput } from './src/browser/browser-address-input'
        const tab = { id: 'example', title: 'Example', url: 'https://example.test/', profileId: 'default', kind: 'web' }
        function Address() {
          const [value, setValue] = useState('')
          return <BrowserAddressInput value={value} onChange={setValue} inputRef={useRef(null)}
            shared profileId="default" tabs={[tab]} bookmarks={[]} visits={[]}
            onEditing={() => {}} onChoose={page => setValue(page.url)}/>
        }
        createRoot(document.body).render(<Address />)
      `,
      loader: 'tsx',
      resolveDir: fileURLToPath(new URL('../../packages/extension-tasks/', import.meta.url)),
    },
    alias: {
      '@dovo/studio-ui': fileURLToPath(
        new URL('../../packages/web-ui/src/input.tsx', import.meta.url),
      ),
    },
    conditions: ['development'],
    jsx: 'automatic',
    bundle: true,
    write: false,
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const input = page.getByRole('combobox')
    await input.fill('example')
    const selected = page.getByRole('option', { selected: true })
    await selected.waitFor()
    const initial = await selected.getAttribute('id')
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'Enter']) {
        const unhandled = await input.evaluate(
          (node, init) =>
            node.dispatchEvent(
              new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
            ),
          { key, ...composition },
        )
        assert.ok(unhandled, `The address bar intercepted ${key}`)
        assert.equal(await input.getAttribute('aria-activedescendant'), initial)
      }
    }
    await input.press('ArrowDown')
    await input.press('Enter')
    assert.equal(await input.inputValue(), 'https://example.test/')
  } finally {
    await browser.close()
  }
})
