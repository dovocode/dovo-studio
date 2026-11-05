import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ApplicationStateProvider,useApplicationState} from '@dovo/studio-core/state';
      import {useDetailTransition} from '@dovo/studio-ui/detail-transition';
      function Collection(){
        const [selected,setSelected]=useApplicationState(null);
        const {transition,style}=useDetailTransition();
        window.openDetail=value=>transition(()=>{window.navigationCount++;setSelected(value)});
        return <div style={{display:'flex',height:400}}>
          <nav><input id="draft" aria-label="Retained input" defaultValue="Keep this draft"/>
            {['PR','Issue','Jira','Artifact'].map(kind=><button key={kind} onClick={()=>window.openDetail(kind)}>Open {kind}</button>)}
          </nav>
          {selected&&<section className="studio-detail-transition" style={{...style,flex:1,background:'var(--background)'}} aria-label="Detail">
            <h1>{selected}</h1><button onClick={()=>transition(()=>setSelected(null),'close')}>Close detail</button>
          </section>}
        </div>;
      }
      function App(){const [show,setShow]=useState(true);window.unmount=()=>setShow(false);return <ApplicationStateProvider>{show&&<Collection/>}</ApplicationStateProvider>}
      window.navigationCount=0;window.trace=[];
      const native=document.startViewTransition.bind(document);
      document.startViewTransition=options=>{
        const next=native(options);window.lastTransition=next;
        next.ready.then(()=>window.trace.push({
          names:document.getAnimations().map(animation=>animation.animationName),
          pointerEvents:getComputedStyle(document.documentElement,'::view-transition').pointerEvents,
          rootAnimation:getComputedStyle(document.documentElement,'::view-transition-new(root)').animationName,
        }),()=>{});
        return next;
      };
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByLabel('Retained input').waitFor()
  await page.evaluate(() => {
    window.originalInput = document.getElementById('draft')
  })
  const finish = () => page.evaluate(() => window.lastTransition.finished)
  let traces = 0
  for (const kind of ['PR', 'Issue', 'Jira', 'Artifact']) {
    await page.getByRole('button', { name: `Open ${kind}`, exact: true }).click()
    await page.waitForFunction((count) => window.trace.length > count, traces++)
    const trace = await page.evaluate(() => window.trace.at(-1))
    assert.ok(trace.names.includes('studio-detail-in'), kind)
    assert.equal(trace.rootAnimation, 'none', 'The rest of the app must not crossfade')
    assert.equal(trace.pointerEvents, 'none', 'Animations must not block interaction')
    await page.getByRole('heading', { name: kind, exact: true }).waitFor()
    await finish()
    await page.getByRole('button', { name: 'Close detail', exact: true }).click()
    await page.waitForFunction((count) => window.trace.length > count, traces++)
    assert.ok(
      (await page.evaluate(() => window.trace.at(-1).names)).includes('studio-detail-close'),
    )
    assert.equal(
      await page.getByRole('region', { name: 'Detail', exact: true }).count(),
      0,
      'Closing unmounts live detail immediately',
    )
    await finish()
  }
  // Switching keeps the selected panel's identity but animates the changed content.
  await page.evaluate(() => window.openDetail('PR'))
  await page.getByRole('heading', { name: 'PR', exact: true }).waitFor()
  await finish()
  await page.evaluate(() => window.openDetail('Jira'))
  await page.waitForFunction(() => window.trace.at(-1)?.names.includes('studio-detail-out'))
  await page.getByRole('heading', { name: 'Jira', exact: true }).waitFor()
  await finish()
  await page.evaluate(() => {
    window.openDetail('Issue')
    window.openDetail('Artifact')
  })
  await page.getByRole('heading', { name: 'Artifact', exact: true }).waitFor()
  await finish()
  assert.equal(
    await page.evaluate(() => document.getElementById('draft') === window.originalInput),
    true,
  )
  assert.equal(await page.getByLabel('Retained input').inputValue(), 'Keep this draft')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const count = await page.evaluate(() => window.trace.length)
  await page.getByRole('button', { name: 'Close detail', exact: true }).click()
  await page.getByRole('button', { name: 'Open PR', exact: true }).click()
  await page.getByRole('heading', { name: 'PR', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.trace.length),
    count,
    'Reduced motion skips capture entirely',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    document.startViewTransition = undefined
    window.openDetail('Issue')
  })
  await page.getByRole('heading', { name: 'Issue', exact: true }).waitFor()
  assert.deepEqual(errors, [])

  // Match the real shell's nested headers and floating rails in both themes.
  await page.setViewportSize({ width: 1440, height: 900 })
  await mkdir(root + 'work/detail-transitions', { recursive: true })
  for (const mode of ['light', 'dark']) {
    for (const platform of ['linux', 'darwin']) {
      for (const collection of ['Thread sidebar', 'Pull request sidebar']) {
        await page.setContent(
          `<html class="${mode === 'dark' ? 'dark' : ''}" data-theme="${mode}"><body style="margin:0"><div class="studio-header-layout" data-inline-header="true" data-compact="false"><div class="studio" data-platform="${platform}"><div class="studio-body"><nav class="studio-navigation" aria-label="Main navigation"><button class="studio-navigation-item">T</button></nav><main class="studio-main"><div style="display:flex;flex:1;min-height:0"><aside class="studio-task-sidebar" aria-label="${collection}" style="display:flex;flex-direction:column;width:320px"><header class="studio-titlebar" data-sidebar-brand="true"><span id="brand">Dovo Studio</span></header><div class="studio-overview-pane" style="flex:1">${collection}</div></aside><div style="display:flex;flex:1;flex-direction:column"><header class="studio-titlebar">Thread</header><div style="display:flex;flex:1"><section style="flex:1">Conversation</section><aside class="studio-thread-tools-panel" style="width:240px">Project</aside><nav class="studio-navigation studio-tools-navigation" aria-label="Thread tools"><button class="studio-navigation-item">F</button></nav></div></div></div></main></div></div></div></body></html>`,
        )
        await page.addStyleTag({ content: css })
        const layout = await page.locator('.studio').evaluate((element) => {
          const rule = getComputedStyle(element, '::before'),
            header = document.querySelector('.studio-titlebar'),
            rect = (selector) => document.querySelector(selector).getBoundingClientRect()
          return {
            top: parseFloat(rule.top),
            width: parseFloat(rule.width),
            height: parseFloat(rule.height),
            color: rule.backgroundColor,
            headerColor: getComputedStyle(header).borderBottomColor,
            headerTop: header.getBoundingClientRect().top,
            headerHeight: header.getBoundingClientRect().height,
            headerLeft: header.getBoundingClientRect().left,
            pointerEvents: rule.pointerEvents,
            leftGap:
              rect('.studio-overview-pane').left - rect('[aria-label="Main navigation"]').right,
            rightGap:
              rect('.studio-tools-navigation').left - rect('.studio-thread-tools-panel').right,
            brandLeft: rect('#brand').left,
          }
        })
        assert.equal(layout.top, layout.headerTop + layout.headerHeight - 1)
        assert.equal(layout.width, layout.headerLeft, 'Divider must meet the inline header')
        assert.equal(layout.height, 1)
        assert.equal(layout.color, layout.headerColor)
        assert.equal(layout.pointerEvents, 'none')
        assert.equal(layout.leftGap, 6)
        assert.equal(
          layout.rightGap,
          mode === 'light' ? 8 : 6,
          'Tool pane clearance follows the theme rail margins',
        )
        if (platform === 'linux' && collection === 'Thread sidebar')
          await page.screenshot({ path: root + 'work/detail-transitions/' + mode + '.png' })
        // The fallback header retains the same brand origin with the sidebar hidden.
        const fallbackBrand = await page.evaluate(() => {
          document.querySelector('.studio-header-layout').dataset.inlineHeader = 'false'
          const studio = document.querySelector('.studio'),
            header = document.createElement('header')
          header.className = 'studio-titlebar'
          header.innerHTML = '<span id="fallback-brand">Dovo Studio</span>'
          studio.prepend(header)
          return document.getElementById('fallback-brand').getBoundingClientRect().left
        })
        assert.equal(layout.brandLeft, fallbackBrand, 'Brand must not shift on sidebar collapse')
      }
    }
  }
  console.log(
    'Detail transitions: opening, switching, closing, rapid selection, retained drafts, immediate unmount, reduced motion, unsupported-browser fallback and full-width light/dark header dividers, theme rail clearances and fixed header brands passed.',
  )
} finally {
  await browser.close()
}
