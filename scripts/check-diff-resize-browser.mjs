import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {PierreEditor} from './src/review/pierre-editor';import {updateAppPreferences} from '${root}/packages/studio-core/src/preferences.ts';updateAppPreferences({diffLayout:'split',diffOverflow:'wrap'});import {ResizableSidebar} from './src/detail/resizable-sidebar';
const lines=Array.from({length:1000},(_,i)=>'export const value'+i+' = '+i+';');const before=lines.join('\\n');lines[10]='export const changed = '+JSON.stringify('long '.repeat(200))+';';lines[800]='export const other = false;';const file={path:'fixture.ts',before,after:lines.join('\\n'),viewed:false};
const noop=()=>{};const comment=async(body,range)=>{window.postedComment={body,range}};window.renderCount=0;
function App(){const[current,setFile]=useState(file);window.loadLarge=()=>setFile({...file,before:'',after:Array.from({length:50000},(_,i)=>'export const large'+i+' = '+JSON.stringify('text '.repeat(30))+';').join('\\n')});const[focus,setFocus]=useState(undefined);window.setFocus=setFocus;window.renderCount++;return <main className="dark flex h-screen min-w-0 overflow-hidden"><section className="flex min-h-0 min-w-0 flex-1 flex-col"><PierreEditor file={current} task={{id:"task",repositoryId:"repo"}} comments={[]} onSave={contents=>{window.savedContents=contents;setFile(current=>({...current,after:contents}))}} onComment={comment} onEditingChange={noop} focusedLine={focus}/></section><ResizableSidebar preference="diffFilesSidebarWidth" label="diff files pane" side="right" maxFraction={0.4} maxWidth={640} className="border-l">Files</ResizableSidebar></main>};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    plugins: process.env.DOVO_DIFF_PLAIN
      ? [
          {
            name: 'plain-baseline',
            setup(b) {
              b.onLoad({ filter: /review\/pierre-editor\.tsx$/ }, async ({ path }) => ({
                loader: 'tsx',
                contents: (await readFile(path, 'utf8'))
                  .replace('<Virtualizer className=', '<div className=')
                  .replace('</Virtualizer>', '</div>'),
              }))
            },
          },
        ]
      : [],
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '@dovo/studio-core/state',
      contents: `export {useApplicationState} from '${root}/packages/studio-core/src/runtime/application-state.ts';`,
    },
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>({connection:{address:'http://runtime',token:'test'},workspace:{repositories:[]}});export * from '${root}/packages/studio-core/src/preferences.ts';export * from '${root}/packages/studio-core/src/themes.ts';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {cn} from '${root}/packages/studio-ui/src/lib/utils';export {Button} from '${root}/packages/studio-ui/src/components/ui/button';export {LineCommentForm} from '${root}/packages/studio-ui/src/line-comment-form';export const MessageResponse=()=>null;`,
    },
  ],
)
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: css })
  await page.evaluate(() => {
    window.resizeCount = 0
    const Observer = window.ResizeObserver
    window.ResizeObserver = class extends Observer {
      constructor(callback) {
        super((entries, observer) => {
          window.resizeCount++
          callback(entries, observer)
        })
      }
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() =>
    document.querySelector('diffs-container')?.shadowRoot?.querySelector('pre'),
  )
  await page.evaluate(() => window.setFocus(500))
  for (const width of [1100, 1049, 1051, 800, 400, 180, 100, 60, 1400]) {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  const handle = page.getByRole('separator', { name: 'Resize diff files pane' })
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x - 150, box.y + 100, { steps: 50 })
  await page.mouse.move(box.x + 90, box.y + 100, { steps: 50 })
  await page.mouse.up()
  await page.evaluate(() => {
    window.loadLarge()
    window.setFocus(undefined)
  })
  await page.waitForTimeout(300)
  const stress = await page.evaluate(async () => {
    const panel = document.querySelector('main > section')
    const times = []
    let previous = performance.now()
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame)
      const now = performance.now()
      times.push(now - previous)
      previous = now
      panel.style.flex = 'none'
      panel.style.width = 400 + (i % 6) * 50 + 'px'
    }
    panel.style.flex = ''
    panel.style.width = ''
    return {
      lines: document.querySelector('diffs-container').shadowRoot.querySelectorAll('[data-line]')
        .length,
      p95: times.toSorted((a, b) => a - b)[28],
      max: Math.max(...times),
    }
  })
  if (!process.env.DOVO_DIFF_PLAIN)
    assert.ok(
      stress.lines < 500,
      'Resizing mounted the whole 50,000-line diff: ' + JSON.stringify(stress),
    )
  console.log('Large diff resize', stress)
  await page.evaluate(() => window.setFocus(4500))
  await page.waitForFunction(() => {
    const line = document
      .querySelector('diffs-container')
      .shadowRoot.querySelector('[data-column-number="4500"][data-selected-line]')
    if (!line) return false
    const viewport = document.querySelector('.studio-code').getBoundingClientRect()
    const bounds = line.getBoundingClientRect()
    return bounds.bottom > viewport.top && bounds.top < viewport.bottom
  })
  await page.locator('[data-column-number="4500"] [data-utility-button]').click()
  const comment = page.getByRole('textbox', { name: 'Line comment', exact: true })
  await comment.fill('Keep this steering draft through resizing')
  await page.getByRole('button', { name: 'Suggest code change', exact: true }).click()
  const replacement = page.getByRole('textbox', { name: 'Suggested replacement' })
  await replacement.fill('replacement after reopening')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => window.setFocus(4501))
  await page.locator('[data-column-number="4501"] [data-utility-button]').click()
  assert.equal(await comment.inputValue(), '')
  await comment.fill('Other range draft')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => window.setFocus(4500))
  await page.locator('[data-column-number="4500"] [data-utility-button]').click()
  assert.equal(await comment.inputValue(), 'Keep this steering draft through resizing')
  assert.equal(await replacement.inputValue(), 'replacement after reopening')
  await page.getByRole('button', { name: 'Remove suggestion', exact: true }).click()
  for (const width of [800, 400, 1400]) await page.setViewportSize({ width, height: 800 })
  assert.equal(await comment.inputValue(), 'Keep this steering draft through resizing')
  await page.getByRole('button', { name: 'Add steering to chat', exact: true }).click()
  await page.waitForFunction(
    () => window.postedComment?.body === 'Keep this steering draft through resizing',
  )
  assert.deepEqual(await page.evaluate(() => window.postedComment.range), {
    start: 4500,
    end: 4500,
    side: 'additions',
  })
  await page.evaluate(() => window.setFocus(undefined))

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.locator('[contenteditable="true"]')
  const focusVisibleText = async () => {
    const point = await editor.evaluate((element) => {
      const viewport = document.querySelector('.studio-code').getBoundingClientRect()
      for (const char of element.querySelectorAll('[data-char="0"]')) {
        const bounds = char.getBoundingClientRect()
        if (bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && bounds.width)
          return { x: bounds.left + 2, y: bounds.top + bounds.height / 2 }
      }
      throw new Error('No visible editable line')
    })
    await page.mouse.click(point.x, point.y)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  await editor.waitFor()
  await focusVisibleText()
  await page.keyboard.press('End')
  await page.keyboard.type(' /* preserved resize edit */')
  await page.getByText('fixture.ts •', { exact: true }).waitFor()
  for (const width of [800, 400, 180, 100, 60, 1400]) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(80)
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.waitForFunction(() => window.savedContents?.includes('/* preserved resize edit */'))
  const saved = await page.evaluate(() => window.savedContents)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await focusVisibleText()
  await page.keyboard.type('cancelled resize edit ')
  await page.getByText('fixture.ts •', { exact: true }).waitFor()
  await page.setViewportSize({ width: 700, height: 800 })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.savedContents), saved)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.waitFor()
  assert.equal(
    await editor.textContent().then((text) => text.includes('cancelled resize edit')),
    false,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => window.setFocus(50000))
  await page.locator('[data-line="50000"]').waitFor()
  if (!process.env.DOVO_DIFF_PLAIN)
    assert.ok(
      (await page.locator('[data-line]').count()) < 500,
      'Scrolling mounted the entire diff',
    )
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await page.getByRole('button', { name: 'Unified', exact: true }).waitFor()
  await page.evaluate(() => window.setFocus(500000))
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const tick = () => (++frames === 15 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
  )
  const initial = await page.evaluate(() => ({
    renders: window.renderCount,
    resizes: window.resizeCount,
  }))
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const tick = () => (++frames === 15 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
  )
  const final = await page.evaluate(() => ({
    renders: window.renderCount,
    resizes: window.resizeCount,
  }))
  assert.deepEqual(errors, [])
  assert.ok(
    final.resizes - initial.resizes < 10,
    'Resize observers settle after dragging: ' + JSON.stringify({ initial, final }),
  )
  assert.ok(final.renders - initial.renders < 3, 'React settles after resizing')
  console.log(
    'Real split/wrapped diff resizing and invalid-line navigation settle without repeated rendering:',
    { initial, final },
  )
} finally {
  await browser.close()
}
