import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ApplicationStateProvider } from '@dovo/studio-core/state';
import { readAppPreferences } from '@dovo/studio-core';
import { ResizablePanel, ResizablePanelGroup } from '@dovo/studio-ui';
import { ResizableSidebar } from '../extension-tasks/src/detail/resizable-sidebar.tsx';
import { FileTree } from '../extension-tasks/src/review/file-tree.tsx';
const root=createRoot(document.getElementById('app'));
window.saved=()=>readAppPreferences();
function Fixture(){
 const [diff,setDiff]=useState(false),[selected,setSelected]=useState('src/first.ts');
 window.toggleDiff=()=>setDiff(v=>!v);
 const changedFiles=[{path:'src/first.ts',before:'old',after:'new',viewed:false},{path:'src/second.ts',before:'old',after:'new',viewed:false}];
 const diffView=<div className="flex h-screen w-screen min-h-0 min-w-0"><main className="min-w-0 flex-1" data-testid="diff-content">{selected}</main><FileTree files={changedFiles} stats={[]} selected={selected} onSelect={setSelected}/></div>;
 const [left,setLeft]=useState(true),[right,setRight]=useState(true),[files,setFiles]=useState(false),[expanded,setExpanded]=useState(false);
 window.toggleLeft=()=>setLeft(v=>!v);window.toggleRight=()=>setRight(v=>!v);window.files=()=>setFiles(v=>!v);window.expand=()=>setExpanded(v=>!v);
 if(diff)return diffView;
 return <div className="flex h-screen w-screen min-w-0"><nav id="left-icons" style={{width:56,minWidth:56}} className="shrink-0">Icons</nav><div className="flex min-h-0 min-w-0 flex-1"><ResizableSidebar as="div" preference="threadSidebarWidth" side="left" label="thread sidebar" maxFraction={.45} maxWidth={640} resizable={left} className={left?'':'hidden'} data-testid="left"><div>Threads</div></ResizableSidebar><ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1"><ResizablePanel id="conversation" minSize={30}><div className="relative flex h-full min-w-0"><main className={expanded?'hidden':'min-w-0 flex-1'}>Chat</main><ResizableSidebar key={files?'viewer':'tools'} preference={files?'viewerSidebarWidth':'toolsSidebarWidth'} side="right" label="tools sidebar" maxFraction={files?.5:.48} maxWidth={960} resizable={right&&!expanded} data-testid="right" className={!right?'hidden':expanded?'flex-1':'flex flex-col'}><iframe title="Preview" srcDoc="<p>Remote browser</p>" className="h-full w-full"/></ResizableSidebar><nav id="right-icons" style={{width:56,minWidth:56}} className="shrink-0">Tools</nav></div></ResizablePanel></ResizablePanelGroup></div></div>
}
window.mount=()=>root.render(<ApplicationStateProvider><Fixture key={Math.random()}/></ApplicationStateProvider>);window.mount();
`,
    resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  const directory = new URL('../apps/web/dist/client/assets/', import.meta.url)
  const css = (await readdir(directory)).find((name) => name.endsWith('.css'))
  if (!css) throw new Error('Build the web app first.')
  await page.addStyleTag({ content: await readFile(new URL(css, directory), 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const width = async (name) => (await page.getByTestId(name).boundingBox()).width
  const expectWidth = async (name, value) => {
    await page.waitForFunction(
      ({ name, value }) =>
        Math.abs(
          document.querySelector('[data-testid="' + name + '"]').getBoundingClientRect().width -
            value,
        ) < 1,
      { name, value },
    )
  }
  await expectWidth('left', 280)
  await expectWidth('right', 380)
  const icons = async () =>
    [
      await page.locator('#left-icons').boundingBox(),
      await page.locator('#right-icons').boundingBox(),
    ].map((box) => box.width)
  const originalIcons = await icons()
  const drag = async (name, delta) => {
    const box = await page.getByRole('separator', { name }).boundingBox()
    await page.mouse.move(box.x + box.width / 2, 200)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + delta, 200, { steps: 12 })
    await page.mouse.up()
  }
  await drag('Resize thread sidebar', 100)
  await expectWidth('left', 380)
  await drag('Resize tools sidebar', -80)
  await expectWidth('right', 460)
  await page.waitForFunction(
    () => window.saved().threadSidebarWidth === 380 && window.saved().toolsSidebarWidth === 460,
  )
  await drag('Resize tools sidebar', 160)
  await expectWidth('right', 300)
  await page.getByRole('separator', { name: 'Resize tools sidebar' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expectWidth('right', 310)
  const previousId = await page.getByTestId('left').getAttribute('id')
  await page.evaluate(() => window.mount())
  await page.waitForFunction(
    (id) => document.querySelector('[data-testid=left]').id !== id,
    previousId,
  )
  await expectWidth('left', 380)
  await expectWidth('right', 310)
  await page.evaluate(() => window.toggleLeft())
  await page.getByTestId('left').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.toggleLeft())
  await expectWidth('left', 380)
  await page.evaluate(() => window.toggleRight())
  await page.getByTestId('right').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.toggleRight())
  await expectWidth('right', 310)
  await page.getByRole('separator', { name: 'Resize thread sidebar' }).dblclick()
  await expectWidth('left', 280)
  await page.getByRole('separator', { name: 'Resize tools sidebar' }).dblclick()
  await expectWidth('right', 380)
  await page.setViewportSize({ width: 900, height: 800 })
  await expectWidth('left', 280)
  const remaining = await page
    .getByTestId('right')
    .evaluate((element) => element.parentElement.clientWidth)
  if ((await width('right')) > remaining * 0.48 + 1)
    throw new Error('Right sidebar exceeded narrow-window limit')
  await page.setViewportSize({ width: 1600, height: 800 })
  await expectWidth('right', 380)
  await page.evaluate(() => window.files())
  await expectWidth('right', 560)
  await page.evaluate(() => window.expand())
  await page.getByRole('separator', { name: 'Resize tools sidebar' }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.expand())
  await expectWidth('right', 560)
  if (JSON.stringify(await icons()) !== JSON.stringify(originalIcons))
    throw new Error('Icon bars resized')
  await page.evaluate(() => window.toggleDiff())
  const filePane = page.getByRole('complementary', { name: 'Changed files' })
  const expectFileWidth = async (expected) => {
    await page.waitForFunction(
      (expected) =>
        Math.abs(
          document.querySelector('[aria-label="Changed files"]').getBoundingClientRect().width -
            expected,
        ) < 1,
      expected,
    )
  }
  await expectFileWidth(256)
  await drag('Resize diff files pane', -80)
  await expectFileWidth(336)
  await page.waitForFunction(() => window.saved().diffFilesSidebarWidth === 336)
  await filePane.getByRole('button', { name: /second.ts/ }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="diff-content"]').textContent === 'src/second.ts',
  )
  await page.getByRole('searchbox', { name: 'Search changed files' }).fill('second')
  await filePane.getByRole('button', { name: /first.ts/ }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.toggleDiff())
  await filePane.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.toggleDiff())
  await expectFileWidth(336)
  const fileHandle = page.getByRole('separator', { name: 'Resize diff files pane' })
  await fileHandle.focus()
  await page.keyboard.press('ArrowLeft')
  await expectFileWidth(346)
  await page.keyboard.press('Home')
  await expectFileWidth(180)
  await page.keyboard.press('End')
  await expectFileWidth(640)
  await page.setViewportSize({ width: 500, height: 800 })
  await expectFileWidth(200)
  await page.setViewportSize({ width: 1600, height: 800 })
  await expectFileWidth(640)
  await fileHandle.dblclick()
  await expectFileWidth(256)
  await page.waitForFunction(() => window.saved().diffFilesSidebarWidth === 256)
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    '280px default, both drag directions, iframe crossing, keyboard resize, remembered widths, reset, narrow windows, viewer expansion and fixed icon bars, diff file pane resize/persistence/reset and file selection/filtering verified.',
  )
} finally {
  await browser.close()
}
