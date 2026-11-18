import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.argv[2] ?? '/tmp/dovo-liquid-glass'
await mkdir(output, { recursive: true })
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/studio-ui',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {useAppearance} from '../studio-shell/src/appearance';
import {CommandPalette} from '../studio-shell/src/command-palette';
import {updateAppPreferences} from '@dovo/studio-core';
import {ComposerSurface,ComposerTextarea,ComposerSubmit} from './src/composer-surface';
import {Button} from '../web-ui/src/button';
import {Input} from '../web-ui/src/input';
import {Card} from '../web-ui/src/card';
import {ChangeSummary} from './src/review/change-summary';
import {Dialog,DialogContent,DialogTitle} from './src/components/ui/dialog';
import {ImageViewer} from './src/image-viewer';
const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#305a78"/><circle cx="800" cy="500" r="260" fill="#87bde3"/></svg>');
import {startLiquidGlass} from './src/liquid-glass/controller';
window.preferences=updateAppPreferences;window.startGlass=startLiquidGlass;
updateAppPreferences({theme:'light',themePalette:'dovo',themeGradients:true,themeGlow:.5});
function App(){useAppearance();const[open,setOpen]=useState(false);const[text,setText]=useState('Draft survives appearance changes');const[imageOpen,setImageOpen]=useState(false);const[summary,setSummary]=useState(false);window.showSummary=setSummary;
return <div className="studio-header-layout" data-inline-header="true"><main className="studio" style={{minHeight:'100vh',padding:24,display:'grid',gridTemplateColumns:'240px minmax(0,1fr)',gap:24}}><div className="studio-header-corner" aria-hidden="true"/>
<div className="studio-task-sidebar"><div className="studio-sidebar-brand-row"><header className="studio-titlebar" data-sidebar-brand="true"><span className="studio-titlebar-brand">Dovo Studio</span></header><Button className="studio-sidebar-toggle" aria-label="Toggle sidebar">Toggle</Button></div><aside className="studio-overview-pane" style={{padding:16,minHeight:550}}><nav className="studio-navigation" aria-label="Main navigation" style={{margin:0,width:"100%"}}><Button className="studio-navigation-item" aria-current="page">Threads</Button></nav><h2>Threads</h2><Input aria-label="Search threads"/><Button variant="secondary" onClick={()=>setOpen(true)}>Open commands</Button><Button onClick={()=>setImageOpen(true)}>Open image</Button><Card className="mt-4 p-4">Shared settings pane</Card><div id="selected-thread" className="studio-thread-row" data-highlighted><button className="studio-thread-card">Selected thread</button></div><div id="other-thread" className="studio-thread-row"><button className="studio-thread-card">Other thread</button></div></aside></div>
<section><header className="studio-task-thread-header p-4">Opaline workspace</header><div className="studio-conversation-content" style={{minHeight:280,padding:24}}><p>Messages stay solid and readable.</p><div id="stream">Streaming response</div>{summary&&<ChangeSummary files={[{path:"app.ts",additions:2,deletions:1}]} expanded={true} onExpandedChange={()=>{}} onChange={()=>{}}/>}</div><div className="task-composer" style={{padding:0}}><ComposerSurface onSubmit={()=>{}} controls={<Button variant="ghost">Codex</Button>} actions={<ComposerSubmit/>}><ComposerTextarea value={text} onChange={e=>setText(e.target.value)} preview={false} aria-label="Message"/></ComposerSurface></div></section>
<Dialog open={imageOpen} onOpenChange={setImageOpen}><DialogContent className="max-w-5xl"><DialogTitle>Image preview</DialogTitle><ImageViewer src={preview} alt="Preview image" className="h-96"/></DialogContent></Dialog><CommandPalette open={open} onOpenChange={setOpen} commands={[{id:'settings',title:'Open settings',run:()=>{window.executed=true}}]}/></main></div>}
const app=createRoot(document.getElementById('app'));window.unmountApp=()=>app.unmount();app.render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export * from './src/components/ui/dialog';export {Input} from './src/components/ui/input';export {Button} from './src/components/ui/button';export {startLiquidGlass} from './src/liquid-glass/controller';`,
    },
  ],
)
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, watch: null },
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(origin + '/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto(origin)
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const composer = page.locator('.studio-composer')
  const brandHeader = page.locator('.studio-sidebar-brand-row')
  const field = page.getByRole('textbox', { name: 'Message', exact: true })
  const filters = () => page.locator('filter[id^="studio-glass-"]').count()
  await page.waitForFunction(() => !!document.querySelector('.studio-composer[data-studio-glass]'))
  const rail = page.getByRole('navigation', { name: 'Main navigation' })
  await page.waitForFunction(
    () => !!document.querySelector('.studio-navigation[data-studio-glass]'),
  )
  assert.match(await rail.evaluate((el) => getComputedStyle(el).backdropFilter), /url\(/)
  const solid = async (target) => {
    assert.equal(await target.getAttribute('data-studio-glass'), null)
    assert.equal(await target.evaluate((el) => getComputedStyle(el).backdropFilter), 'none')
    assert.equal(await target.evaluate((el) => getComputedStyle(el).backgroundImage), 'none')
  }
  await solid(brandHeader)
  for (const selector of [
    '.studio-overview-pane',
    '.studio-task-thread-header',
    '[data-slot="card"]',
    '#selected-thread .studio-thread-card',
  ])
    await solid(page.locator(selector))
  // Changing the selected row transfers its material without leaving stale optical maps.
  await page.evaluate(() => {
    document.getElementById('selected-thread').removeAttribute('data-highlighted')
    document.getElementById('other-thread').setAttribute('data-highlighted', '')
  })
  await solid(page.locator('#selected-thread .studio-thread-card'))
  await solid(page.locator('#other-thread .studio-thread-card'))
  assert.match(
    await page
      .locator('.studio-header-corner')
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    /blur\(/,
    'The narrow rail cap shares the material without a faceted optical map',
  )
  // A review pane can arrive and leave inside a streaming conversation.
  const beforeInlinePane = await filters()
  await page.evaluate(() => window.showSummary(true))
  await solid(page.locator('.studio-change-summary'))
  await page.evaluate(() => window.showSummary(false))
  await page.waitForFunction(
    (count) => document.querySelectorAll('filter[id^="studio-glass-"]').length === count,
    beforeInlinePane,
  )
  assert.match(await composer.evaluate((el) => getComputedStyle(el).backdropFilter), /url\(/)
  const refracted = await composer.screenshot()
  const opticalFilter = await composer.evaluate((el) =>
    el.style.getPropertyValue('--studio-glass-refraction'),
  )
  await composer.evaluate((el) =>
    el.style.setProperty('--studio-glass-refraction', 'blur(8px) saturate(1.6)'),
  )
  const frosted = await composer.screenshot()
  assert.equal(refracted.equals(frosted), false, 'Refraction changes rendered pixels')
  await composer.evaluate(
    (el, filter) => el.style.setProperty('--studio-glass-refraction', filter),
    opticalFilter,
  )
  for (const selector of [
    '[data-slot="input"]',
    '.studio-conversation-content',
    '.studio-sidebar-brand-row .studio-titlebar',
    '.studio-sidebar-brand-row .studio-sidebar-toggle',
  ])
    assert.equal(
      await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).backdropFilter),
      'none',
      selector + ' stays flat',
    )
  await field.focus()
  await page.evaluate(() => (window.savedInput = document.querySelector('[aria-label="Message"]')))
  for (const theme of ['dark', 'light', 'dark']) {
    await page.evaluate((theme) => window.preferences({ theme }), theme)
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme)
    await solid(brandHeader)
    assert.equal(await field.inputValue(), 'Draft survives appearance changes')
    assert.equal(
      await field.evaluate((el) => el === window.savedInput && el === document.activeElement),
      true,
    )
    await page.screenshot({ path: `${output}/workspace-${theme}.png` })
  }
  // Streaming text must not rebuild maps or grow the SVG filter set.
  const beforeStream = await composer.getAttribute('style')
  const count = await filters()
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++)
      document.getElementById('stream').append(document.createTextNode(' text'))
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert.equal(await composer.getAttribute('style'), beforeStream)
  assert.equal(await filters(), count)
  // Image previews use the same portal material and retain their zoom controls.
  await page.getByRole('button', { name: 'Open image', exact: true }).click()
  const imageDialog = page.getByRole('dialog', { name: 'Image preview' })
  await solid(imageDialog)
  assert.equal(
    await page
      .locator('.dovo-dialog-overlay')
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    'none',
    'The dim overlay leaves context visible',
  )
  await imageDialog.getByRole('button', { name: 'Actual size', exact: true }).click()
  await page.screenshot({ path: `${output}/image-dialog-dark.png` })
  await imageDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForFunction(
    (expected) => document.querySelectorAll('filter[id^="studio-glass-"]').length === expected,
    count,
  )
  // A solid pane can become a standalone composer without remounting.
  await page.addStyleTag({ content: '.material-wide-radius { border-radius: 30px !important; }' })
  await page.evaluate(() => {
    const pane = document.createElement('aside')
    pane.id = 'dynamic-pane'
    pane.style.cssText = 'position:absolute;left:24px;top:500px;width:150px;height:90px'
    pane.textContent = 'Detail pane'
    document.body.append(pane)
    pane.classList.add('studio-overview-pane')
  })
  await solid(page.locator('#dynamic-pane'))
  await page.locator('#dynamic-pane').evaluate((el) => {
    el.classList.remove('studio-overview-pane')
    el.classList.add('studio-composer')
  })
  await page.waitForFunction(() =>
    document.getElementById('dynamic-pane').hasAttribute('data-studio-glass'),
  )
  assert.equal(await filters(), count + 1)
  const paneFilter = await page
    .locator('#dynamic-pane')
    .evaluate((el) => el.style.getPropertyValue('--studio-glass-refraction'))
  await page.locator('#dynamic-pane').evaluate((el) => el.classList.add('material-wide-radius'))
  await page.waitForFunction(
    (old) =>
      document
        .getElementById('dynamic-pane')
        .style.getPropertyValue('--studio-glass-refraction') !== old,
    paneFilter,
  )
  assert.equal(await filters(), count + 1, 'Radius updates replace rather than leak maps')
  await page.locator('#dynamic-pane').evaluate((el) => el.classList.remove('studio-composer'))
  await page.waitForFunction(
    () => !document.getElementById('dynamic-pane').hasAttribute('data-studio-glass'),
  )
  assert.equal(await filters(), count, 'Changing back to content releases the map')
  await page.locator('#dynamic-pane').evaluate((el) => el.classList.add('studio-composer'))
  await page.waitForFunction(() =>
    document.getElementById('dynamic-pane').hasAttribute('data-studio-glass'),
  )
  assert.match(
    await page.locator('#dynamic-pane').evaluate((el) => getComputedStyle(el).backdropFilter),
    /url\(/,
    'Standalone launcher composers share the material',
  )
  await page.locator('#dynamic-pane').evaluate((el) => el.remove())
  // A portal-mounted command palette stays solid and keeps keyboard behavior.
  await page.getByRole('button', { name: 'Open commands', exact: true }).click()
  await solid(page.getByRole('dialog'))
  await page.screenshot({ path: `${output}/commands-dark.png` })
  // A launcher inside a dialog is content, not a second glass layer.
  await page.evaluate(() => {
    window.observedMaterialTargets = []
    const observe = Reflect.get(ResizeObserver.prototype, 'observe')
    ResizeObserver.prototype.observe = function (target, options) {
      window.observedMaterialTargets.push(target)
      return Reflect.apply(observe, this, [target, options])
    }
  })
  await page.getByRole('dialog').evaluate((el) => {
    const form = document.createElement('form')
    form.className = 'studio-composer'
    form.id = 'nested-composer'
    form.style.cssText = 'width:200px;height:50px'
    el.append(form)
  })
  assert.equal(
    await page.locator('#nested-composer').evaluate((el) => getComputedStyle(el).backdropFilter),
    'none',
  )
  assert.equal(await page.locator('#nested-composer').getAttribute('data-studio-glass'), null)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.evaluate(() =>
      window.observedMaterialTargets.includes(document.getElementById('nested-composer')),
    ),
    false,
    'Nested composer is never scheduled for refraction',
  )

  await page.getByRole('combobox', { name: 'Search commands' }).fill('settings')
  assert.equal(await page.getByRole('option').count(), 1)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.dovo-dialog-content'))
  await page.waitForFunction(
    (expected) => document.querySelectorAll('filter[id^="studio-glass-"]').length === expected,
    count,
  )
  // Resizing replaces the map without leaving orphaned filters.
  const old = await composer.evaluate((el) =>
    el.style.getPropertyValue('--studio-glass-refraction'),
  )
  await page.setViewportSize({ width: 1050, height: 850 })
  await page.waitForFunction(
    (old) =>
      document
        .querySelector('.studio-composer')
        .style.getPropertyValue('--studio-glass-refraction') !== old,
    old,
  )
  assert.equal(await filters(), count)
  // High contrast must release optical resources and restore them when turned off.
  await page.evaluate(() => window.preferences({ highContrast: true }))
  await page.waitForFunction(
    () => document.querySelectorAll('filter[id^="studio-glass-"]').length === 0,
  )
  assert.equal(await composer.evaluate((el) => getComputedStyle(el).backdropFilter), 'none')
  assert.equal(await brandHeader.evaluate((el) => getComputedStyle(el).backdropFilter), 'none')
  for (const selector of ['.studio-header-corner', '#other-thread .studio-thread-card'])
    assert.equal(
      await page.locator(selector).evaluate((el) => getComputedStyle(el).backdropFilter),
      'none',
    )
  await page.evaluate(() => window.preferences({ highContrast: false }))
  await page.waitForFunction(() => !!document.querySelector('.studio-composer[data-studio-glass]'))
  // OS accessibility changes apply live, and changing them back needs no reload or setup.
  const media = await page.context().newCDPSession(page)
  await media.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await page.waitForFunction(
    () => document.querySelectorAll('filter[id^="studio-glass-"]').length === 0,
  )
  assert.equal(await composer.evaluate((el) => getComputedStyle(el).backdropFilter), 'none')
  await media.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }],
  })
  await page.waitForFunction(() => !!document.querySelector('.studio-composer[data-studio-glass]'))
  await page.emulateMedia({ forcedColors: 'active' })
  await page.waitForFunction(
    () => document.querySelectorAll('filter[id^="studio-glass-"]').length === 0,
  )
  await page.emulateMedia({ forcedColors: 'none' })
  await page.waitForFunction(() => !!document.querySelector('.studio-composer[data-studio-glass]'))
  // Appearance effects stay optional. Content never gains a glass layer.
  await page.evaluate(() => window.preferences({ themeGradients: false, themeGlow: 0 }))
  assert.equal(await composer.evaluate((el) => getComputedStyle(el).backgroundImage), 'none')
  assert.equal(await field.inputValue(), 'Draft survives appearance changes')
  // Last-owner teardown cancels pending maps and removes every filter.
  await page.evaluate(() => {
    const stop = window.startGlass(true)
    stop()
    window.unmountApp()
  })
  await page.waitForFunction(
    () => document.querySelectorAll('filter[id^="studio-glass-"]').length === 0,
  )
  await media.detach()
  assert.deepEqual(errors, [])
  console.log(
    'Liquid glass: maps, portal lifecycle, streaming, resize, themes, input identity, accessibility and appearance controls passed.',
  )
} finally {
  await browser?.close()
  await server.close()
}
