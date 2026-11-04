import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {ImageViewer} from './src/image-viewer';
const make=(width,height)=>{const image=document.createElement('canvas');image.width=width;image.height=height;const ctx=image.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,width,height);return image.toDataURL()};
function App(){const [src,setSrc]=useState(()=>make(1600,1000));window.replaceImage=()=>setSrc(make(200,100));return <ImageViewer src={src} alt="Test image" className="h-[400px] w-[500px]"/>};createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ hasTouch: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const canvas = page.getByRole('region', { name: 'Image viewer: Test image', exact: true })
  const image = page.getByRole('img', { name: 'Test image', exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1600)
  await page.waitForFunction(
    () => document.querySelector('img')?.getBoundingClientRect().width === 500,
  )
  await button('Zoom in').click()
  assert.equal(Math.round((await image.boundingBox()).width), 625)
  await button('Actual size').click()
  assert.equal(Math.round((await image.boundingBox()).width), 1600)
  const area = await canvas.boundingBox()
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
  const before = await image.boundingBox()
  await page.mouse.down()
  await page.mouse.move(area.x + area.width / 2 + 60, area.y + area.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  const dragged = await image.boundingBox()
  assert.ok(Math.abs(dragged.x - before.x - 60) < 1)
  assert.ok(Math.abs(dragged.y - before.y - 40) < 1)
  await canvas.press('ArrowRight')
  assert.ok(Math.abs((await image.boundingBox()).x - dragged.x + 40) < 1)
  const wheelBefore = await image.boundingBox()
  const point = { x: area.x + area.width / 2, y: area.y + area.height / 2 }
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(0, -80)
  await page.waitForFunction(
    (width) => document.querySelector('img').getBoundingClientRect().width > width,
    wheelBefore.width,
  )
  const wheelAfter = await image.boundingBox()
  assert.ok(
    Math.abs(
      (point.x - wheelBefore.x) / wheelBefore.width - (point.x - wheelAfter.x) / wheelAfter.width,
    ) < 0.002,
    'Zoom stays anchored to the cursor',
  )
  await canvas.press('0')
  assert.equal(Math.round((await image.boundingBox()).width), 500)
  await button('Actual size').click()
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2 })),
    })
  await touch('touchStart', [
    [point.x - 40, point.y],
    [point.x + 40, point.y],
  ])
  await touch('touchMove', [
    [point.x - 80, point.y],
    [point.x + 80, point.y],
  ])
  await touch('touchEnd', [])
  await page.waitForFunction(
    () => document.querySelector('img').getBoundingClientRect().width > 2500,
  )
  await button('Fit').click()
  assert.equal(Math.round((await image.boundingBox()).width), 500)
  await canvas.press('+')
  assert.equal(Math.round((await image.boundingBox()).width), 625)
  await page.evaluate(() => window.replaceImage())
  await page.waitForFunction(() => document.querySelector('img').naturalWidth === 200)
  await page.waitForFunction(
    () => document.querySelector('img').getBoundingClientRect().width === 200,
  )
  assert.equal(await page.getByLabel('Image zoom', { exact: true }).textContent(), '100%')
  assert.deepEqual(errors, [])
  console.log(
    'Image viewer: fit, actual pixels, buttons, cursor-centred wheel zoom, drag, keyboard, touch pinch and source reset passed.',
  )
} finally {
  await browser.close()
}
