import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.argv[2] ?? '/tmp/dovo-solid-surfaces'
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
window.preferences=updateAppPreferences;
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
      contents: `export * from './src/components/ui/dialog';export {Input} from './src/components/ui/input';export {Button} from './src/components/ui/button';`,
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
  const solid = async (target, fill) => {
    assert.equal(await target.getAttribute('data-studio-glass'), null)
    const surface = await target.evaluate(async (node, fill) => {
      await Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
      const style = getComputedStyle(node)
      const sample = document.createElement('span')
      sample.style.color = fill ? `var(--${fill})` : 'inherit'
      node.append(sample)
      const expected = getComputedStyle(sample).color
      sample.remove()
      return {
        backdrop: style.backdropFilter,
        image: style.backgroundImage,
        color: style.backgroundColor,
        expected,
      }
    }, fill)
    assert.equal(surface.backdrop, 'none')
    assert.equal(surface.image, 'none')
    if (fill) assert.equal(surface.color, surface.expected)
  }
  const rail = page.getByRole('navigation', { name: 'Main navigation' })
  const railItem = rail.getByRole('button', { name: 'Threads' })
  const corner = page.locator('.studio-header-corner')
  await field.focus()
  await field.evaluate((el) => (window.savedInput = el))
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => window.preferences({ theme }), theme)
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme)
    await solid(composer, 'card')
    await solid(rail, 'sidebar')
    await solid(railItem, 'selection')
    await solid(corner, 'card')
    await solid(brandHeader, 'card')
    for (const selector of [
      '.studio-overview-pane',
      '.studio-task-thread-header',
      '[data-slot="card"]',
      '#selected-thread .studio-thread-card',
    ])
      await solid(page.locator(selector))
    assert.equal(await field.inputValue(), 'Draft survives appearance changes')
    assert.equal(
      await field.evaluate((el) => el === window.savedInput && el === document.activeElement),
      true,
    )
    await page.screenshot({ path: `${output}/workspace-${theme}.png` })
  }

  await page.evaluate(() => {
    window.showSummary(true)
    document.getElementById('stream').append(document.createTextNode(' Streamed response'))
  })
  await solid(page.locator('.studio-change-summary'), 'card')
  assert.equal(await field.inputValue(), 'Draft survives appearance changes')
  for (const width of [750, 1050, 1200]) {
    await page.setViewportSize({ width, height: 850 })
    await solid(composer, 'card')
    await solid(rail, 'sidebar')
  }

  await page.getByRole('button', { name: 'Open image', exact: true }).click()
  const imageDialog = page.getByRole('dialog', { name: 'Image preview' })
  await solid(imageDialog, 'card')
  await solid(page.locator('.dovo-dialog-overlay'))
  await imageDialog.getByRole('button', { name: 'Actual size', exact: true }).click()
  await imageDialog.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Open commands', exact: true }).click()
  await solid(page.getByRole('dialog'), 'card')
  await page.getByRole('combobox', { name: 'Search commands' }).fill('settings')
  assert.equal(await page.getByRole('option').count(), 1)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })

  await page.evaluate(() =>
    window.preferences({ highContrast: true, themeGradients: false, themeGlow: 0 }),
  )
  await page.waitForFunction(() => document.documentElement.dataset.highContrast === 'true')
  await solid(composer, 'card')
  await solid(rail, 'sidebar')
  await page.emulateMedia({ forcedColors: 'active' })
  await solid(composer)
  await solid(rail)
  await page.emulateMedia({ forcedColors: 'none' })
  assert.equal(await page.locator('filter[id^="studio-glass-"]').count(), 0)
  assert.equal(await field.inputValue(), 'Draft survives appearance changes')
  assert.deepEqual(errors, [])
  console.log(
    'Solid sidebar, composer, review summary and overlays passed in both modes. Draft identity, resize, command and preview controls, and accessibility appearance passed.',
  )
} finally {
  await browser?.close()
  await server.close()
}
