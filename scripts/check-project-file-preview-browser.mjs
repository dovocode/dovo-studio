import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const detail = root + '/packages/extension-tasks/src/detail/'
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/studio-ui',
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {TaskFiles} from '${detail}task-files.tsx';
window.fail=true;window.requests=[];window.opened=[];
window.projectFile=(path,contents)=>{const size=new TextEncoder().encode(contents).length,complete=size<=256*1024;return {path,contents:complete?contents:contents.slice(0,128*1024),size,complete,truncated:!complete,startLine:1,hasMore:!complete}};
const request=async(path,input)=>{window.requests.push({path,input});if((path.endsWith('/directory')||path.endsWith('/search-paths'))&&window.failListing)throw new Error('File listing unavailable');if(path.endsWith('/directory'))return {entries:['small.txt','large.txt','binary.txt','preview.png','vector.svg'].map(path=>({path,kind:'file'})),truncated:false};if(path.endsWith('/search-paths'))return {files:['small.txt','large.txt','binary.txt','preview.png','vector.svg'].filter(path=>path.includes(input.query)),...(window.listingCompleteness===undefined?{}:{truncated:window.listingCompleteness})};if(path==='/api/tasks/images/read'){if(window.failImage)throw new Error('Image unavailable');return {uri:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHioAAAAASUVORK5CYII='}};if(path.endsWith('/share'))return {url:'/api/tasks/files/shared/ticket'};if(path.endsWith('/read')){if(window.fail||input.path==='binary.txt')throw new Error('Cannot preview this file');return window.projectFile(input.path,input.path==='large.txt'?'é'.repeat(600000):'Small file')};throw new Error('Unexpected request: '+path)};
window.runtime={connected:true,connection:{address:'http://runtime.test:7777',token:'paired-token'},request};
createRoot(document.getElementById('app')).render(<TaskFiles task={{id:'task',files:[]}}/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
  },
  [
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-core',
      contents: `import {Effect} from 'effect';export {responses} from '@dovo/protocol';const requestEffect=(...args)=>Effect.tryPromise({try:signal=>{if(args[0].endsWith('/search-content'))(window.searchSignals??=[]).push({query:args[1].query,signal});return window.runtime.request(...args)},catch:error=>error});export const useWorkspace=()=>({...window.runtime,requestEffect});export const useStudioHost=()=>({openExternalLink:async url=>window.opened.push(url)});export const useDiffOptions=()=>({options:{}});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {SearchField} from '${root}/packages/studio-ui/src/search-field.tsx';export const FileTypeIcon=()=>null;export const FileChangeCounts=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const IconButton=({children,label,...props})=><button aria-label={label} {...props}>{children}</button>;export const FileBrowserTree=({files,onSelect})=><nav>{files.map(file=><button key={file.path} onClick={()=>onSelect(file.path)}>{file.path}</button>)}</nav>;`,
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents:
        "export {useDiffOptions} from '@dovo/studio-core';export const preloadStudioHighlighter=async()=>{};",
    },
    { path: '@pierre/diffs/edit', contents: 'export class Editor{}' },
    {
      path: '@pierre/diffs/react',
      contents:
        'export const EditProvider=({children})=>children;export const File=({file})=><pre data-testid="file-preview">{file.contents.slice(0,100)}</pre>;',
    },
    {
      path: './resizable-sidebar',
      importer: detail,
      contents: 'export const ResizableSidebar=({children})=><aside>{children}</aside>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://studio.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.route('http://runtime.test:7777/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>',
    }),
  )
  await page.goto('http://studio.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const search = page.getByRole('searchbox', { name: 'Search project files', exact: true })
  await page.getByRole('button', { name: 'small.txt', exact: true }).waitFor()
  await search.fill('large')
  await page.getByRole('button', { name: 'small.txt', exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'large.txt', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clear file search', exact: true }).click()
  assert.equal(await search.inputValue(), '')
  assert.equal(
    await search.evaluate((node) => node === document.activeElement),
    true,
    'Clearing file search retains focus',
  )
  await page.getByRole('button', { name: 'small.txt', exact: true }).click()
  await page.getByRole('alert').getByText('Cannot preview this file', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0)
  assert.equal(await page.getByTestId('file-preview').count(), 0)
  await page.getByRole('button', { name: 'Open in browser', exact: true }).click()
  await page.waitForFunction(() => window.opened.length === 1)
  assert.equal(
    await page.evaluate(() => window.opened[0]),
    'http://runtime.test:7777/api/tasks/files/shared/ticket',
  )
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Retry file', exact: true }).click()
  await page.getByTestId('file-preview').getByText('Small file', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor()
  await page.evaluate(() => {
    window.failListing = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('alert').getByText('File listing unavailable', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor()
  assert.equal(await page.getByTestId('file-preview').count(), 1)
  const listingsBeforeSelection = await page.evaluate(
    () => window.requests.filter((item) => item.path.endsWith('/directory')).length,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'large.txt', exact: true }).click()
  await page
    .getByText('Read-only preview · Files over 1 MB must be edited externally', { exact: true })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).isDisabled(), true)
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((item) => item.path.endsWith('/directory')).length,
    ),
    listingsBeforeSelection,
  )
  await page.evaluate(() => {
    window.failListing = false
  })
  await page.getByRole('button', { name: 'binary.txt', exact: true }).click()
  await page.getByRole('alert').getByText('Cannot preview this file', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('file-preview').count(), 0)
  await page.evaluate(() => {
    window.failImage = true
  })
  await page.getByRole('button', { name: 'preview.png', exact: true }).click()
  await page.getByRole('alert').getByText('Image unavailable', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.failImage = false
  })
  await page.getByRole('button', { name: 'Retry file', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('img[alt="preview.png"]')?.naturalWidth > 0,
  )
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() =>
      window.requests.some(
        (item) => item.path === '/api/tasks/files/read' && item.input.path === 'preview.png',
      ),
    ),
    false,
  )
  const readsBeforeRefresh = await page.evaluate(
    () => window.requests.filter((item) => item.path === '/api/tasks/images/read').length,
  )
  await page.getByRole('button', { name: 'Refresh files', exact: true }).click()
  await page.waitForFunction(
    (count) =>
      window.requests.filter((item) => item.path === '/api/tasks/images/read').length > count,
    readsBeforeRefresh,
  )
  await page.waitForFunction(
    () => document.querySelector('img[alt="preview.png"]')?.naturalWidth > 0,
  )
  if (process.env.DOVO_IMAGE_PREVIEW_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_IMAGE_PREVIEW_SCREENSHOT })
  await page.getByRole('button', { name: 'Open original', exact: true }).click()
  await page.waitForFunction(() => window.opened.length === 2)
  await page.getByRole('button', { name: 'vector.svg', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('img[alt="vector.svg"]')?.naturalWidth === 24,
  )
  assert.equal(
    await page.evaluate(() =>
      window.requests.some(
        (item) => item.path === '/api/tasks/files/read' && item.input.path === 'vector.svg',
      ),
    ),
    false,
  )
  await page.getByRole('button', { name: 'small.txt', exact: true }).click()
  await page.getByTestId('file-preview').getByText('Small file', { exact: true }).waitFor()
  assert.equal(await page.locator('img').count(), 0)
  await page.evaluate(() => {
    const original = window.runtime.request
    let first = true
    window.runtime.request = (path, input) => {
      if (path.endsWith('/read') && input.path === 'small.txt') {
        if (first) {
          first = false
          return new Promise((resolve) => {
            window.resolveOldRead = () => resolve(window.projectFile('small.txt', 'Stale A'))
          })
        }
        return Promise.resolve(window.projectFile('small.txt', 'Fresh A'))
      }
      return original(path, input)
    }
  })
  await page.getByRole('button', { name: 'large.txt', exact: true }).click()
  await page.getByRole('button', { name: 'small.txt', exact: true }).click()
  await page.waitForFunction(() => !!window.resolveOldRead)
  await page.getByRole('button', { name: 'large.txt', exact: true }).click()
  await page.getByRole('button', { name: 'small.txt', exact: true }).click()
  await page.getByTestId('file-preview').getByText('Fresh A', { exact: true }).waitFor()
  await page.evaluate(() => window.resolveOldRead())
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await page.getByTestId('file-preview').textContent(), 'Fresh A')
  await search.fill('missing-file')
  for (const completeness of [true, undefined, false]) {
    await page.evaluate((value) => {
      window.listingCompleteness = value
    }, completeness)
    await page.getByRole('button', { name: 'Refresh files', exact: true }).click()
    if (completeness === false) {
      await page.getByText('No matching files.', { exact: true }).waitFor()
      assert.equal(await page.getByText(/Some files are omitted/).count(), 0)
      assert.equal(await page.getByText(/Listing completeness is unknown/).count(), 0)
    } else {
      await page
        .getByText(completeness ? /Some files are omitted/ : /Listing completeness is unknown/)
        .waitFor()
      await page.getByText('No matching files in this listing.', { exact: true }).waitFor()
    }
  }
  assert.deepEqual(errors, [])
  console.log(
    'Project text/image previews, retry, format switching, external opening and read-only checks passed.',
  )
} finally {
  await browser.close()
}
