import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/studio-ui',
      loader: 'tsx',
      contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ComposerSurface} from './src/composer-surface.tsx';
function App(){
  const [tick,setTick]=useState(0),[compact,setCompact]=useState(true),[collapsed,setCollapsed]=useState(false);
  const [wide,setWide]=useState(false),[attached,setAttached]=useState(false),[moved,setMoved]=useState(false);
  window.bump=()=>flushSync(()=>setTick(x=>x+1));
  window.compact=value=>flushSync(()=>setCompact(value));
  window.collapse=value=>flushSync(()=>setCollapsed(value));
  window.widen=value=>flushSync(()=>setWide(value));
  window.attach=value=>flushSync(()=>setAttached(value));
  window.move=value=>flushSync(()=>setMoved(value));
  window.unmount=()=>flushSync(()=>root.unmount());
  return <div className="task-composer" data-tick={tick}>
    <ComposerSurface compact={compact} collapsed={collapsed}
      controls={<><button type="button" id="model" style={{width:wide?140:60,marginLeft:moved?10:0}}>Model</button><button type="button">Effort</button></>}
      actions={<button type="submit">Send</button>}>
      <textarea aria-label="Message" defaultValue="Draft" onFocus={()=>setCompact(false)}/>
      {attached&&<div id="attachment">Attachment</div>}
    </ComposerSurface>
  </div>
}
const root=createRoot(document.getElementById('app'));root.render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useAppPreferences=()=>({});' },
    {
      path: './components/ai-elements/message',
      importer: root + 'packages/studio-ui/src/composer-surface.tsx',
      contents: 'export const MessageResponse=()=>null;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<style>
    .task-composer{width:500px} form{display:flex;flex-direction:column;width:500px;box-sizing:border-box}
    textarea{box-sizing:border-box;width:100%;height:90px;padding:12px}
    form[data-idle] textarea{height:40px;padding:4px}
    [data-composer-footer]{display:flex;width:100%;height:50px}
    [data-composer-controls]{display:flex;flex:1;gap:8px}button{height:30px}
  </style><div id="app"></div>`)
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.locator('form').waitFor()
  const settle = () =>
    page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {})),
      )
      // ResizeObserver delivery and the coalesced measurement each get their own frame.
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    })
  await settle()
  await page.evaluate(() => {
    window.counts = { rects: 0, styles: 0 }
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect').value
    const style = window.getComputedStyle
    Element.prototype.getBoundingClientRect = function (...args) {
      if (this.closest('form.studio-composer')) window.counts.rects++
      return rect.apply(this, args)
    }
    window.getComputedStyle = function (element, ...args) {
      if (element.closest('form.studio-composer')) window.counts.styles++
      return style.call(this, element, ...args)
    }
  })
  const reset = () => page.evaluate(() => (window.counts = { rects: 0, styles: 0 }))
  const counts = () => page.evaluate(() => window.counts)
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.bump())
  await settle()
  assert.deepEqual(await counts(), { rects: 0, styles: 0 })

  const before = await page.locator('form').boundingBox()
  await reset()
  await page.evaluate(() => window.widen(true))
  await settle()
  assert.ok((await counts()).rects > 0, 'Child resizes update the baseline')
  const after = await page.locator('form').boundingBox()
  assert.equal(after.width, before.width)
  assert.equal(after.height, before.height)
  await reset()
  await page.evaluate(() => window.move(true))
  await settle()
  assert.ok((await counts()).rects > 0, 'Position changes with unchanged sizes update the baseline')
  await reset()
  await page.evaluate(() => window.attach(true))
  await settle()
  assert.ok((await counts()).rects > 0, 'Inserted content updates the baseline')

  await page.getByRole('textbox', { name: 'Message' }).focus()
  assert.ok(
    await page.locator('form').evaluate((form) => form.getAnimations({ subtree: true }).length > 0),
    'Focus retains the compact transition',
  )
  await page.evaluate(() => {
    window.compact(true)
    window.compact(false)
  })
  await settle()
  assert.equal(await page.locator('form').getAttribute('data-layout-animating'), null)
  assert.equal(await page.getByRole('textbox').inputValue(), 'Draft')
  assert.equal(await page.locator('form').getAttribute('data-idle'), null)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.compact(true))
  await settle()
  assert.equal(await page.locator('form').evaluate((form) => form.getAnimations().length), 0)
  await page.evaluate(() => window.collapse(true))
  await settle()
  await reset()
  await page.evaluate(() => {
    window.widen(false)
    window.attach(false)
  })
  await settle()
  assert.deepEqual(await counts(), { rects: 0, styles: 0 })
  await page.evaluate(() => window.collapse(false))
  await settle()
  await reset()
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.bump())
  await settle()
  assert.deepEqual(await counts(), { rects: 0, styles: 0 })
  await page.evaluate(() => window.unmount())
  await settle()
  assert.deepEqual(errors, [])
  console.log(
    'Composer measurements: unchanged renders skip layout reads; child resizing, repositioning, attachments, focus, interrupted transitions, reduced motion and cleanup passed.',
  )
} finally {
  await browser.close()
}
