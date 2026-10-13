import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {DeferredTurn} from './src/chat/thread/deferred-turn';import {FloatingPreview} from './src/detail/floating-preview';
window.intersections=[];window.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;window.intersections.push(this)}observe(target){this.target=target}unobserve(){}disconnect(){}};
window.setNear=near=>{for(const observer of window.intersections){const margin=observer.options.rootMargin;if(near&&margin==='1200px 0px'||!near&&margin==='3600px 0px')observer.callback([{target:observer.target,isIntersecting:near}])}};
function Preview(){const [placement,setPlacement]=useState('inline');return <FloatingPreview title="Counter" placement={placement} onPlacementChange={setPlacement} onClose={placement==='inline'?undefined:()=>setPlacement('inline')}><iframe title="Counter frame" srcDoc={'<button onclick="this.textContent=Number(this.textContent)+1">0</button>'}/></FloatingPreview>}
createRoot(document.getElementById('app')).render(<DeferredTurn id="turn" pinned={false}>{()=> <Preview/>}</DeferredTurn>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export const useConversationHistory=()=>({ready:true,scrollRef:{current:document.getElementById('scroll')}});export const cn=(...values)=>values.filter(Boolean).join(' ');export const IconButton=({label,...props})=><button aria-label={label} {...props}/>;`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<button id="outside">Composer</button><div id="scroll" style="height:400px;overflow:auto"><div id="app"></div></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.intersections.length === 2)
  for (const mode of ['Float preview', 'Expand preview']) {
    await page.evaluate(() => window.setNear(true))
    await page.frameLocator('iframe').getByRole('button').click()
    assert.equal(await page.frameLocator('iframe').getByRole('button').innerText(), '1')
    await page.evaluate(
      () => (window.originalFrame = document.querySelector('iframe').contentWindow),
    )
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.getByRole('button', { name: 'Composer', exact: true }).focus()
    await page.evaluate(() => window.setNear(false))
    await page.waitForTimeout(50)
    assert.equal(
      await page.locator('iframe').count(),
      1,
      'A detached preview remains mounted after its turn leaves the retained scroll window',
    )
    assert.equal(
      await page.evaluate(
        () => document.querySelector('iframe').contentWindow === window.originalFrame,
      ),
      true,
    )
    assert.equal(await page.frameLocator('iframe').getByRole('button').innerText(), '1')
    // Closing without changing focus must release the offscreen turn.
    await page.evaluate(() => document.querySelector('[aria-label="Close preview"]').click())
    await page
      .getByRole('group', { name: 'Turn not loaded. Focus to load it.', exact: true })
      .waitFor()
    assert.equal(await page.locator('iframe').count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Floating preview retention: floating and expanded previews survive offscreen turn unloading without iframe reload; closing releases the turn.',
  )
} finally {
  await browser.close()
}
