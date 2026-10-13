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
const request=async(path,input)=>{window.requests.push({path,input});if(path.endsWith('/list')&&window.failListing)throw new Error('File listing unavailable');if(path.endsWith('/list'))return {files:['small.txt','large.txt','binary.txt']};if(path.endsWith('/share'))return {url:'/api/tasks/files/shared/ticket'};if(path.endsWith('/read')){if(window.fail||input.path==='binary.txt')throw new Error('Cannot preview this file');return {path:input.path,contents:input.path==='large.txt'?'é'.repeat(600000):'Small file'}};throw new Error('Unexpected request: '+path)};
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
      contents: `export {responses} from '@dovo/protocol';export const useWorkspace=()=>window.runtime;export const useStudioHost=()=>({openExternalLink:async url=>window.opened.push(url)});export const useDiffOptions=()=>({options:{}});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const FileTypeIcon=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const IconButton=({children,label,...props})=><button aria-label={label} {...props}>{children}</button>;export const FileBrowserTree=({files,onSelect})=><nav>{files.map(file=><button key={file.path} onClick={()=>onSelect(file.path)}>{file.path}</button>)}</nav>;`,
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents: 'export const preloadStudioHighlighter=async()=>{};',
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
  await page.goto('http://studio.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
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
  await page.evaluate(() => {
    window.failListing = false
  })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'large.txt', exact: true }).click()
  await page
    .getByText('Read-only preview · Files over 1 MB must be edited externally', { exact: true })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'binary.txt', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('file-preview').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Project file preview error, retry, external opening, and read-only checks passed.')
} finally {
  await browser.close()
}
