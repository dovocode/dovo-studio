import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `import {imageEditorDocument,parseImageEditorResult} from './packages/client-runtime/src/images/image-editor';window.editorDocument=imageEditorDocument;window.parseResult=parseImageEditorResult;`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  },
  [],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<iframe title="Editor" sandbox="allow-scripts" style="width:100%;height:780px;border:0"></iframe>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => {
    const image = document.createElement('canvas')
    image.width = 400
    image.height = 240
    const ctx = image.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 400, 240)
    window.original = image.toDataURL('image/png')
    window.results = []
    window.addEventListener('message', (event) => {
      if (event.source === document.querySelector('iframe').contentWindow) {
        const result = window.parseResult(event.data)
        if (result) window.results.push(result)
      }
    })
    window.openEditor = () => {
      window.results = []
      document.querySelector('iframe').srcdoc = window.editorDocument(window.original)
    }
    window.openEditor()
  })
  const frame = page.frameLocator('iframe')
  const ready = async () => {
    await frame.getByRole('button', { name: 'Attach image', exact: true }).waitFor()
    await frame.locator('#attach:enabled').waitFor()
  }
  const drag = async (x1, y1, x2, y2) => {
    const box = await frame.locator('canvas').boundingBox()
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 12 })
    await page.mouse.up()
  }
  const output = async () =>
    page.evaluate(async () => {
      const result = window.results.at(-1)
      if (result.type !== 'edited') return result
      const image = await createImageBitmap(await (await fetch(result.data)).blob())
      const c = document.createElement('canvas')
      c.width = image.width
      c.height = image.height
      const ctx = c.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const pixel = Array.from(
        ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data,
      )
      return { type: result.type, width: c.width, height: c.height, pixel }
    })
  await ready()
  for (const [key, label] of [
    ['h', 'Highlight'],
    ['a', 'Arrow'],
    ['r', 'Rectangle'],
    ['c', 'Crop'],
    ['b', 'Pen'],
    ['p', 'Pen'],
  ]) {
    const button = frame.getByRole('button', { name: label, exact: true })
    assert.equal(await button.locator('svg').count(), 1)
    assert.equal(await button.textContent(), '')
    await frame.locator('canvas').focus()
    await page.keyboard.press(key)
    await frame.getByRole('button', { name: label, exact: true, pressed: true }).waitFor()
  }
  await frame.locator('canvas').focus()
  await page.keyboard.press(']')
  assert.equal(await frame.getByLabel('Stroke size').inputValue(), '8')
  await page.keyboard.press('[')
  assert.equal(await frame.getByLabel('Stroke size').inputValue(), '6')
  await frame.getByLabel('Stroke size').focus()
  await page.keyboard.press('c')
  await frame.getByRole('button', { name: 'Pen', exact: true, pressed: true }).waitFor()
  await frame.locator('canvas').focus()
  await drag(0.15, 0.5, 0.85, 0.5)
  await page.keyboard.press('Control+z')
  assert.equal(await frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true)
  await page.keyboard.press('Control+y')
  assert.equal(await frame.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true)
  await page.keyboard.press('Meta+z')
  assert.equal(await frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true)
  await page.keyboard.press('Meta+Shift+z')
  assert.equal(await frame.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true)
  await page.screenshot({ path: '/tmp/dovo-image-editor-icons.png' })
  await page.keyboard.press('Control+Enter')
  await page.waitForFunction(() => window.results.length === 1)
  let result = await output()
  assert.deepEqual([result.width, result.height], [400, 240])
  assert.ok(result.pixel[0] > 180 && result.pixel[1] < 150, 'Pen must change image pixels')
  await page.evaluate(() => window.openEditor())
  await ready()
  await frame.getByRole('button', { name: 'Crop', exact: true }).click()
  await drag(0.25, 0.25, 0.75, 0.75)
  await frame.getByRole('button', { name: 'Undo', exact: true }).click()
  await frame.getByRole('button', { name: 'Redo', exact: true }).click()
  await frame.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.waitForFunction(() => window.results.length === 1)
  result = await output()
  assert.deepEqual([result.width, result.height], [200, 120])
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 850 })
    await page.evaluate(() => window.openEditor())
    await ready()
    for (const tool of ['Arrow', 'Rectangle', 'Highlight']) {
      await frame.getByRole('button', { name: tool, exact: true }).click()
      await drag(0.2, 0.2, 0.8, 0.8)
    }
    await frame.getByRole('button', { name: 'Reset', exact: true }).click()
    await frame.getByRole('button', { name: 'Attach image', exact: true }).click()
    await page.waitForFunction(() => window.results.length === 1)
    assert.equal((await output()).type, 'original')
  }
  await page.evaluate(() => window.openEditor())
  await ready()
  await frame.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.results.length === 1)
  assert.equal((await output()).type, 'cancel')
  await page.evaluate(() => window.openEditor())
  await ready()
  await drag(0.1, 0.2, 0.9, 0.8)
  await frame.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => window.results.length === 1)
  assert.equal((await output()).type, 'original')
  // The same document uses the native message bridge when embedded on mobile.
  await page.evaluate(() => {
    window.results = []
    document.querySelector('iframe').srcdoc = window
      .editorDocument(window.original)
      .replace(
        '<script>',
        '<script>window.ReactNativeWebView={postMessage:data=>parent.postMessage(JSON.parse(data),"*")};',
      )
  })
  await ready()
  await frame.getByRole('button', { name: 'Crop', exact: true }).click()
  await drag(0.1, 0.1, 0.9, 0.9)
  await frame.getByRole('button', { name: 'Attach image', exact: true }).click()
  await page.waitForFunction(() => window.results.length === 1)
  result = await output()
  assert.deepEqual([result.width, result.height], [320, 192])
  assert.equal(
    await page.evaluate(() =>
      window.parseResult({ channel: 'other', type: 'edited', data: 'data:image/png;base64,AA==' }),
    ),
    null,
  )
  assert.equal(
    await page.evaluate(() =>
      window.parseResult({
        channel: 'dovo-image-editor',
        type: 'edited',
        data: 'https://external.test/image.png',
      }),
    ),
    null,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Image editor: pen pixels, crop bounds, undo/redo/reset, icon tools, keyboard shortcuts, input isolation, narrow layouts, cancel/original, native bridge and result validation passed.',
  )
} finally {
  await browser.close()
}
