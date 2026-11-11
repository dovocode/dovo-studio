import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const baseline = process.argv.includes('--baseline')
const built = await bundleBrowser(
  {
    stdin: {
      loader: 'ts',
      resolveDir: root,
      contents: `import {nativeBrowserBounds,nativeBrowserOcclusion,observeNativeBrowserLayout,nativeBrowserHole} from './packages/extension-tasks/src/browser/native-browser-layout';
window.makeHole=nativeBrowserHole;
window.start=()=>{
  const slot=document.getElementById('slot');
  let frame;
  window.scans=0;window.scanMs=0;window.occlusion=null;
  const update=()=>{frame=undefined;const start=performance.now();window.scans++;const rect=nativeBrowserBounds(slot);window.occlusion=rect?nativeBrowserOcclusion(slot,rect)??null:null;window.bounds=rect?.toJSON();window.scanMs+=performance.now()-start};
  const schedule=()=>{frame??=requestAnimationFrame(update)};
  ${baseline ? `const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','style','class','role','aria-modal','data-state','data-preview-dragging','data-preview-overlay']});window.stop=()=>observer.disconnect();` : 'window.stop=observeNativeBrowserLayout(slot,schedule);'}
  schedule();
};`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  },
  [],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0}#pane{position:fixed;left:400px;top:40px;width:700px}#slot{height:500px}#messages{width:350px}</style><main id="messages"></main><section id="pane" data-native-browser-layout><header id="header">Browser</header><div id="slot"></div></section><div id="portal"></div>',
  )
  await page.evaluate(() => {
    document.getElementById('messages').innerHTML = Array.from(
      { length: 4000 },
      (_, i) => '<p>Thread message ' + i + '</p>',
    ).join('')
  })
  await page.evaluate(() =>
    document
      .getElementById('messages')
      .insertAdjacentHTML(
        'beforeend',
        '<details open><summary>Tool result</summary><p id="stream">Streaming</p></details>',
      ),
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => window.start())
  await page.waitForFunction(() => window.scans > 0)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const metrics = await page.evaluate(async () => {
    const before = window.scans,
      ms = window.scanMs
    for (let i = 0; i < 90; i++) {
      document.getElementById('stream').textContent = 'Streaming ' + i
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
    return { scans: window.scans - before, scanMs: Math.round((window.scanMs - ms) * 100) / 100 }
  })
  console.log(
    JSON.stringify({
      fixture: '90 streaming updates beside a native browser, 4000 message nodes',
      baseline,
      ...metrics,
    }),
  )
  if (!baseline)
    assert.equal(
      metrics.scans,
      0,
      'Unrelated streaming must not trigger browser layout or document scans',
    )
  await page.evaluate(() => {
    const menu = document.createElement('div')
    menu.id = 'menu'
    menu.setAttribute('role', 'menu')
    menu.style.cssText = 'position:fixed;left:450px;top:90px;width:200px;height:100px;z-index:99'
    document.getElementById('portal').append(menu)
  })
  await page.waitForFunction(() => window.occlusion === 'overlay')
  await page.evaluate(() => (document.getElementById('menu').style.left = '10px'))
  await page.waitForFunction(() => window.occlusion === null)
  await page.evaluate(() => {
    const menu = document.getElementById('menu')
    menu.className = 'studio-tooltip'
    menu.style.cssText =
      'position:fixed;left:450px;top:90px;width:200px;height:40px;z-index:99;pointer-events:none'
    menu.removeAttribute('role')
  })
  await page.waitForFunction(() => window.occlusion === 'tooltip')
  await page.evaluate(() => {
    document.getElementById('menu').className = ''
    document.getElementById('menu').style.left = '10px'
  })
  await page.waitForFunction(() => window.occlusion === null)
  await page.evaluate(() => document.getElementById('menu').remove())
  const top = await page.evaluate(() => window.bounds.y)
  await page.evaluate(() => (document.getElementById('header').style.height = '100px'))
  await page.waitForFunction((top) => window.bounds.y > top, top)
  await page.evaluate(() => {
    const wrapper = document.createElement('div')
    wrapper.id = 'wrapper'
    wrapper.style.cssText = 'position:fixed;left:450px;top:90px;z-index:99'
    wrapper.innerHTML = '<div role="menu" style="width:200px;height:100px"></div>'
    document.getElementById('portal').append(wrapper)
  })
  await page.waitForFunction(() => window.occlusion === 'overlay')
  await page.evaluate(() => (document.getElementById('wrapper').style.left = '10px'))
  await page.waitForFunction(() => window.occlusion === null)
  const scans = await page.evaluate(() => window.scans)
  await page.evaluate(() => {
    window.stop()
    document.getElementById('pane').style.left = '420px'
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.evaluate(() => window.scans),
    scans,
    'Released panes must stop observing layout',
  )
  await page.setContent(
    '<style>html,body{margin:0}#root{position:fixed;inset:0;background:red}#slot{position:absolute;left:100px;top:80px;width:500px;height:350px}#suggestions{position:fixed;left:150px;top:100px;width:200px;height:100px;background:white;z-index:9}</style><div id="root"><div id="slot"></div><div id="suggestions" role="listbox">Inline address suggestions</div></div>',
  )
  await page.evaluate(() => {
    const slot = document.getElementById('slot')
    window.hole = window.makeHole(slot)
    window.hole.update(slot.getBoundingClientRect())
  })
  assert.equal(
    await page.evaluate(() => document.elementFromPoint(400, 250).id),
    '',
    'Uncovered slot is transparent through the app root',
  )
  assert.equal(
    await page.evaluate(() => document.elementFromPoint(200, 150).id),
    'suggestions',
    'Inline address suggestions remain visible and receive clicks',
  )
  await page.evaluate(() => {
    window.second = window.makeHole(document.getElementById('slot'))
    window.second.update(new DOMRect(300, 200, 300, 230))
    window.hole.dispose()
  })
  assert.equal(
    await page.evaluate(() => document.elementFromPoint(400, 250).id),
    '',
    'Overlapping panes must preserve the remaining hole',
  )
  await page.evaluate(() => window.second.dispose())
  assert.equal(
    await page.evaluate(() => document.getElementById('root').style.clipPath),
    '',
    'Last pane restores the root',
  )
  await page.setContent(
    '<style>body{margin:0}#root{position:fixed;inset:0}#under{position:fixed;inset:0}#floating{position:fixed;left:297.1875px;top:111.796875px;width:829.59375px;height:632.390625px;background:red}#slot{width:100%;height:100%}</style><div id="root"><div id="under"></div></div><div id="floating" data-preview-overlay="true"><div id="slot"></div></div>',
  )
  await page.evaluate(() => {
    const slot = document.getElementById('slot')
    window.hole = window.makeHole(slot)
    window.hole.update(slot.getBoundingClientRect())
  })
  assert.equal(
    await page.evaluate(() =>
      window.hole.occlusion(document.getElementById('slot').getBoundingClientRect()),
    ),
    undefined,
    'A floating preview must not treat its own hole as another overlay',
  )
  await page.evaluate(() => window.hole.dispose())
  assert.equal(
    await page.evaluate(() => document.getElementById('floating').style.clipPath),
    '',
    'Fractional preview bounds must not leave a stale clip after cleanup',
  )
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
