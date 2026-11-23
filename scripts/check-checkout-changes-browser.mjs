import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Checks the workspace tools pane: tool icons, open-tab marks and the checkout Changes reader.
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const worker = await build({
  entryPoints: [root + '/packages/extension-tasks/src/files/saved-file-diff.worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
})
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceToolsFrame} from './src/detail/workspace-tools-frame';
import {TooltipProvider} from '@dovo/studio-ui';
const file=(path,before,after)=>({path,before,after,viewed:false});
const lines=count=>Array.from({length:count},(_,i)=>'export const value'+i+' = '+i+'\\n').join('');
window.changes=[
 file('packages/extension-tasks/src/detail/a-very-long-component-file-name.tsx','export const a = 1\\n','export const a = 2\\nexport const b = 3\\n'),
 file('README.md','# Title\\n','# Title\\n\\nMore text\\n'),
 file('src/zeta.ts',lines(400),lines(400).replaceAll(' = ',' = 1').replace('value200 = 1200','value200 = 2000')),
 {path:'assets/logo.png',before:'',after:'',viewed:false,preview:{kind:'binary'}},
];
window.calls=[];window.failNext=false;window.hold=null;
window.store={connected:true,request:async(path,input)=>{
 window.calls.push({path,input});
 if(window.hold)await new Promise(resolve=>{window.release=resolve});
 if(window.failNext){window.failNext=false;throw new Error('Checkout read failed')}
 if(input.path){
  const file=window.changes.find(file=>file.path===input.path);
  return Object.fromEntries(['before','after'].map(side=>[side,{kind:'text',size:file[side].length,text:file[side],truncated:false}]));
 }
 if(input.metadataOnly)return {files:window.changes.map(file=>({...file,before:'',after:'',preview:{kind:'deferred'}}))};
 return {files:window.changes};
}};
window.terminal={id:'shell',profile:{id:'computer-a'},supported:true,project:{repositoryId:'project',git:true,main:true}};
function App(){
 const [terminal,setTerminal]=useState(window.terminal);
 window.setTerminal=next=>setTerminal(current=>next(current));
 return <main style={{display:"flex",height:"100vh"}} className="studio dark bg-background text-foreground">
  <WorkspaceToolsFrame scope="fixture-shell" terminal={terminal}>
   {tools=><header className="flex items-center gap-2 p-4"><span>Terminal</span>{tools}</header>}
  </WorkspaceToolsFrame>
 </main>}
createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
    plugins: [
      {
        name: 'checkout-diff-worker-fixture',
        setup(builder) {
          builder.onLoad({ filter: /saved-file-diff-job\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            const asset = "new URL('./saved-file-diff.worker.ts', import.meta.url)"
            assert.ok(source.includes(asset), 'The fixture worker URL matches the production job')
            return {
              contents: source.replace(asset, "new URL('/diff.worker.js', window.location.href)"),
              loader: 'ts',
              resolveDir: root + '/packages/extension-tasks/src/files',
            }
          })
        },
      },
    ],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useWorkspace=()=>window.store;export const useAppPreferences=()=>({importedCodeThemes:[]});export const useDiffOptions=()=>({defaultSplit:false,options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'scroll'}});export const readAppPreferences=()=>({theme:'dark',themePalette:'dovo',codeTheme:'app',importedCodeThemes:[],toolsSidebarWidth:440});export const defaultAppPreferences={toolsSidebarWidth:420};export const updateAppPreferences=()=>{};export const useStudioHost=()=>({});export const WorkspaceScope=({children})=>children;`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${ui}/components/ui/button.tsx';export * from '${ui}/components/icon-button.tsx';export * from '${ui}/components/ui/tooltip.tsx';export {cn} from '${ui}/lib/utils.ts';export {FileBrowserTree,FileChangeCounts} from '${ui}/file-tree.tsx';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
    },
    ...[
      '../browser/browser-pane',
      '../browser/browser-thread-panel',
      '../terminal/terminal-workspace-files',
    ].map((path) => ({
      path,
      importer: root + '/packages/extension-tasks/src/detail/workspace-tools-frame.tsx',
      contents: `const Tool=()=> <p>Other tool</p>;export {Tool as BrowserPane,Tool as DevicesPane,Tool as BrowserThreadPanel,Tool as TerminalWorkspaceFiles};`,
    })),
    {
      path: '@dovo/studio-ui/code-themes',
      contents: `export {useDiffOptions,preloadStudioHighlighter} from '${ui}/code-themes.ts';`,
    },
  ],
)
const server = createServer((request, response) => {
  if (request.url === '/diff.worker.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(worker.outputFiles[0].text)
  } else {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<div id="app"></div>')
  }
})
const browser = await chromium.launch()
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const assets = process.env.DOVO_BROWSER_ASSETS ?? root + '/apps/desktop/dist/assets'
  for (const name of (await readdir(assets)).filter((name) => name.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + name, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const rendered = (text) =>
    page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('diffs-container')].some((element) =>
          element.shadowRoot?.querySelector('pre')?.textContent.includes(text),
        ),
      text,
    )

  // Tabs and menu items share one icon per tool. Open tools keep their name and add a description.
  const pane = page.getByRole('complementary', { name: 'Workspace tools', exact: true })
  const tabs = pane.getByRole('tablist', { name: 'Right pane tabs', exact: true })
  const toolsMenu = page.getByRole('button', { name: 'Workspace tools', exact: true })
  for (const tool of ['Changes', 'Browser']) {
    await toolsMenu.click()
    await page.getByRole('menuitem', { name: tool, exact: true }).click()
  }
  await tabs.getByRole('tab', { name: 'Browser', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['Changes', 'Browser'])
  assert.equal(await tabs.getByRole('tab').first().locator('svg[aria-hidden="true"]').count(), 1)
  await tabs.getByRole('tab', { name: 'Changes', exact: true }).click()
  await toolsMenu.click()
  const browserItem = page.getByRole('menuitem', { name: 'Browser', exact: true })
  assert.equal(await browserItem.getAttribute('aria-description'), 'Open')
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Devices', exact: true })
      .getAttribute('aria-description'),
    null,
  )
  assert.equal(await browserItem.locator('svg').count(), 2, 'Tool icon and open mark')
  await page.screenshot({ path: '/tmp/dovo-workspace-tools-menu.png' })
  await page.keyboard.press('Escape')

  // The reader lists files in tree order, opens the first one and reports totals.
  const changes = page.getByRole('region', { name: 'Checkout changes', exact: true })
  await changes.getByText('4 files', { exact: true }).waitFor()
  const list = changes.getByRole('navigation', { name: 'Changed files', exact: true })
  const rows = list.locator('[data-file-tree-row]:not([aria-expanded])')
  assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.dataset.path)), [
    'assets/logo.png',
    'packages/extension-tasks/src/detail/a-very-long-component-file-name.tsx',
    'src/zeta.ts',
    'README.md',
  ])
  const position = changes.locator('[aria-live="polite"]')
  assert.equal(await position.textContent(), '1 of 4')
  await changes.getByText('Binary file. No text diff to show.').waitFor()
  const previous = changes.getByRole('button', { name: 'Previous file', exact: true })
  const next = changes.getByRole('button', { name: 'Next file', exact: true })
  assert.equal(await previous.isDisabled(), true)
  await next.click()
  await rendered('export const b')
  assert.equal(await position.textContent(), '2 of 4')
  assert.equal(
    await list.locator('[aria-current="true"]').getAttribute('data-path'),
    'packages/extension-tasks/src/detail/a-very-long-component-file-name.tsx',
  )

  // The diff header keeps the file name visible and shortens the folder in a narrow pane.
  const header = changes.locator(
    'span[title="packages/extension-tasks/src/detail/a-very-long-component-file-name.tsx"]',
  )
  const name = header.getByText('a-very-long-component-file-name.tsx', { exact: true })
  const nameBox = await name.evaluate((element) => ({
    clipped: element.scrollWidth > element.clientWidth,
    right: element.getBoundingClientRect().right,
  }))
  assert.equal(nameBox.clipped, false, 'The file name is not truncated')
  const folder = header.getByText('packages/extension-tasks/src/detail', { exact: true })
  assert.equal(
    await folder.evaluate((element) => element.scrollWidth > element.clientWidth),
    true,
    'The folder truncates first',
  )

  // Split and wrap toggles keep their visible label inside the accessible name.
  const split = changes.getByRole('button', { name: 'Split diff', exact: true })
  assert.equal(await split.textContent(), 'Split')
  assert.equal(await split.getAttribute('aria-pressed'), 'false')
  await split.click()
  assert.equal(await split.getAttribute('aria-pressed'), 'true')
  assert.equal(await split.textContent(), 'Split')
  await page.screenshot({ path: '/tmp/dovo-checkout-changes.png' })

  // Long diffs scroll inside the diff region only. The file list and header stay in place.
  await next.click()
  await rendered('value200 = 2000')
  const diffScroll = changes.locator('[aria-label="Saved file diff"]')
  assert.ok(await diffScroll.evaluate((element) => element.scrollHeight > element.clientHeight))
  assert.equal(
    await pane.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    true,
  )

  // Choosing a row in the tree selects that file and keeps navigation in sync.
  await list.getByRole('button', { name: 'README.md', exact: true }).click()
  await rendered('More text')
  assert.equal(await position.textContent(), '4 of 4')
  assert.equal(await next.isDisabled(), true)

  // The selection survives a tab switch, because the real frame owns it.
  await tabs.getByRole('tab', { name: 'Browser', exact: true }).click()
  await pane.getByText('Other tool', { exact: true }).waitFor()
  await tabs.getByRole('tab', { name: 'Changes', exact: true }).click()
  await rendered('More text')
  await changes.getByText('4 of 4', { exact: true }).waitFor()

  // A refresh keeps the current list visible, and a removed file moves the reader to its neighbour.
  await page.evaluate(() => {
    window.hold = true
    window.changes = window.changes.filter((file) => file.path !== 'README.md')
  })
  const refresh = changes.getByRole('button', { name: 'Refresh changes', exact: true })
  await refresh.click()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Refresh changes"]')?.getAttribute('aria-busy') ===
      'true',
  )
  assert.equal(await refresh.isDisabled(), true)
  assert.equal(await rows.count(), 4, 'Files stay visible during a refresh')
  await page.evaluate(() => {
    window.hold = null
    window.release()
  })
  await changes.getByText('3 files', { exact: true }).waitFor()
  await rendered('value200 = 2000')
  assert.equal(await position.textContent(), '3 of 3')

  // A failed refresh reports the error and keeps the files that were already loaded.
  await page.evaluate(() => {
    window.failNext = true
  })
  await refresh.click()
  await changes.getByRole('alert').filter({ hasText: 'Checkout read failed' }).waitFor()
  assert.equal(await rows.count(), 3)
  await refresh.click()
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'))

  // The file list can be hidden to give the diff the full pane height, and shown again.
  const toggle = changes.getByRole('button', { name: 'Hide changed files', exact: true })
  await toggle.click()
  assert.equal(await list.count(), 0)
  await changes.getByRole('button', { name: 'Show changed files', exact: true }).click()
  await list.waitFor()

  // An empty checkout shows a clear state and hides file navigation.
  await page.evaluate(() => {
    window.changes = []
  })
  await refresh.click()
  await changes.getByText('No working tree changes.', { exact: true }).waitFor()
  assert.equal(await next.count(), 0)
  assert.equal(
    await page.evaluate(() =>
      window.calls.every(
        (call) => call.path === '/api/terminals/workspace/changes' && call.input.id === 'shell',
      ),
    ),
    true,
  )

  // A long file name truncates inside a narrow pane. The folder shrinks first, and the title and
  // text keep the full path. The header never overflows the pane.
  const long =
    'an-extremely-long-generated-file-name-without-separators-that-must-truncate.config.ts'
  await page.evaluate((long) => {
    window.changes = [
      {
        path: long,
        before: 'export const root = 1\n',
        after: 'export const root = 2\n',
        viewed: false,
      },
      {
        path: 'deep/nested/folder/' + long,
        before: 'export const deep = 1\n',
        after: 'export const deep = 2\n',
        viewed: false,
      },
    ]
  }, long)
  await refresh.click()
  await changes.getByText('2 files', { exact: true }).waitFor()
  const paneBox = await pane.boundingBox()
  for (const [path, text] of [
    ['deep/nested/folder/' + long, 'export const deep = 2'],
    [long, 'export const root = 2'],
  ]) {
    await list.locator(`[data-path="${path}"]`).click()
    await rendered(text)
    const title = changes.locator(`span[title="${path}"]`)
    assert.equal(
      await title.evaluate((element) => element.textContent.replace(/\s+/g, '')),
      path.includes('/') ? long + path.slice(0, path.lastIndexOf('/')) : long,
      'The header text keeps the name and folder',
    )
    const header = await title.evaluate((element) => {
      const row = element.parentElement
      const [name, folder] = element.children
      return {
        nameClipped: name.scrollWidth > name.clientWidth,
        nameWidth: name.getBoundingClientRect().width,
        folderWidth: folder?.getBoundingClientRect().width ?? 0,
        rowOverflows: row.scrollWidth > row.clientWidth + 1,
      }
    })
    assert.equal(header.nameClipped, true, `The long name truncates for ${path}`)
    assert.ok(header.nameWidth > 100, 'The name keeps most of the header')
    assert.ok(header.folderWidth < 24, 'The folder gives up its space first')
    assert.equal(header.rowOverflows, false, 'The header stays inside the pane')
    const wrap = await changes
      .getByRole('button', { name: 'Wrap diff lines', exact: true })
      .boundingBox()
    assert.ok(wrap.x + wrap.width <= paneBox.x + paneBox.width, 'Wrap stays visible')
  }
  await page.screenshot({ path: '/tmp/dovo-checkout-long-name.png' })
  assert.equal(await position.textContent(), '2 of 2')

  // The open file belongs to one checkout. Another project or endpoint for the same terminal
  // starts at its first file and never shows the previous checkout's list while it loads.
  const sameFiles = async (change) => {
    await page.evaluate(() => {
      window.hold = true
    })
    await page.evaluate(change)
    await changes.getByText('Loading changes…', { exact: true }).waitFor()
    assert.equal(await rows.count(), 0, 'The previous checkout list is not shown')
    await page.evaluate(() => {
      window.hold = null
      window.release()
    })
    await changes.getByText('2 files', { exact: true }).waitFor()
    assert.equal(await position.textContent(), '1 of 2', 'The previous selection is not reused')
  }
  await sameFiles(() =>
    window.setTerminal((current) => ({
      ...current,
      project: { ...current.project, repositoryId: 'other' },
    })),
  )
  await list.locator(`[data-path="${long}"]`).click()
  await changes.getByText('2 of 2', { exact: true }).waitFor()
  await sameFiles(() => window.setTerminal((current) => ({ ...current, supported: false })))
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), {
    path: '/api/scm/changes',
    input: { repositoryId: 'other' },
  })
  await list.locator(`[data-path="${long}"]`).click()
  await changes.getByText('2 of 2', { exact: true }).waitFor()
  await sameFiles(() =>
    window.setTerminal((current) => ({
      ...current,
      supported: true,
      project: { ...current.project, repositoryId: 'project' },
    })),
  )
  await page.evaluate(() => {
    window.calls.length = 0
    window.store.snapshot = { selectedCheckoutDiffSupported: true }
    window.setTerminal((current) => ({ ...current, id: 'deferred' }))
  })
  await changes.getByText('2 files', { exact: true }).waitFor()
  await rendered('export const deep = 2')
  assert.deepEqual(await page.evaluate(() => window.calls.map(({ input }) => input)), [
    { id: 'deferred', metadataOnly: true },
    { id: 'deferred', path: 'deep/nested/folder/' + long, full: false },
  ])
  await list.locator(`[data-path="${long}"]`).click()
  await rendered('export const root = 2')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.path), long)
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  server.close()
}
console.log('Checkout changes browser check passed')
