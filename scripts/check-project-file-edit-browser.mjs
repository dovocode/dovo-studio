import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const detail = root + '/packages/extension-tasks/src/detail/'
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {TaskFiles} from '${detail}task-files.tsx';
    import {useState} from 'react';
    window.writes=[]; window.reads=[]; window.files={'a.txt':'original','b.txt':'other'};window.otherFiles={'a.txt':'computer two','b.txt':'second computer b'};
    const request=async(path,input)=>{
      const files=window.runtime.connection.address==='http://other.test'?window.otherFiles:window.files;
      if(path.endsWith('/list')) return {files:Object.keys(files)};
      if(path.endsWith('/read')) {window.reads.push(input.path);return {path:input.path,contents:files[input.path]};}
      if(path.endsWith('/write')) { window.writes.push(input); if(window.fail) throw Error('save failed'); if(window.delay) await new Promise(resolve=>window.resolveWrite=resolve); if(files[input.path]!==input.expectedContents) throw Error('conflict'); files[input.path]=input.contents; return {path:input.path,contents:input.contents}; }
      throw Error(path);
    };
    window.runtime={connected:true,connection:{address:'http://runtime.test',token:'paired-token'},request};
    function App(){const [surface,setSurface]=useState(true);const [thread,setThread]=useState('one');const [computer,setComputer]=useState(false);window.runtime.connection={address:computer?'http://other.test':'http://runtime.test',token:computer?'other-token':'paired-token'};return <><button onClick={()=>setSurface(!surface)}>surface</button><button onClick={()=>setThread(thread==='one'?'two':'one')}>thread</button><button onClick={()=>setComputer(!computer)}>runtime</button>{surface&&<TaskFiles key={thread} task={{id:thread,repositoryId:'repo',files:[]}}/>}</>};
    createRoot(document.getElementById('app')).render(<App/>);
  `,
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
      contents: `export {responses} from '@dovo/protocol';export const useWorkspace=()=>window.runtime;export const useStudioHost=()=>({});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {SearchField} from '${root}/packages/studio-ui/src/search-field.tsx';export const FileTypeIcon=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const IconButton=({children,label,...props})=><button aria-label={label} {...props}>{children}</button>;export const FileBrowserTree=({files,onSelect})=><nav>{files.map(file=><button key={file.path} onClick={()=>onSelect(file.path)}>{file.path}</button>)}</nav>;`,
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents: `import {preloadHighlighter} from '@pierre/diffs';export const preloadStudioHighlighter=language=>preloadHighlighter({themes:['github-dark'],langs:[language]});export const useDiffOptions=()=>({options:{theme:'github-dark'}});`,
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
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://studio.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://studio.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.locator('[contenteditable="true"]')
  await editor.waitFor()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.press('End')
  await page.keyboard.type(' draft')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'b.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.writes.length), 0)
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor()
  await page.getByRole('button', { name: 'surface', exact: true }).click()
  await page.getByRole('button', { name: 'surface', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor()
  await page.getByRole('button', { name: 'thread', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Save draft', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'thread', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.evaluate(() => (window.fail = true))
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('save failed', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'surface', exact: true }).click()
  await page.getByRole('button', { name: 'surface', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor()
  await page.evaluate(() => {
    window.fail = false
    window.delay = true
  })
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await page.waitForFunction(() => !!window.resolveWrite)
  await page.getByRole('button', { name: 'b.txt', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
  await page.getByRole('button', { name: 'thread', exact: true }).click()
  await page.getByRole('button', { name: 'thread', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.writes.length), 2)
  await page.evaluate(() => window.resolveWrite())
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.files['a.txt']), 'original draft')
  assert.equal(await page.evaluate(() => window.writes.length), 2)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.waitFor()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.type(' cancelled')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.writes.length), 2)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.type(' conflict')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'b.txt', exact: true }).click()
  await page.evaluate(() => {
    window.files['a.txt'] = 'newer external edit'
    window.delay = false
  })
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('conflict', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.files['a.txt']), 'newer external edit')
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  assert.equal(await page.evaluate(() => window.writes.length), 3)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.type(' direct')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.writes.length), 4)
  assert.match(await page.evaluate(() => window.files['a.txt']), / direct/)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.type(' first-runtime-draft')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'runtime', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('computer two', { exact: true }).waitFor()
  assert.equal(await page.getByText('a.txt •', { exact: true }).count(), 0)
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.press('Control+z')
  assert.equal(await editor.textContent(), 'computer two')
  await page.keyboard.type(' cancelled-other')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('computer two', { exact: true }).waitFor()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.press('Control+z')
  assert.doesNotMatch(await editor.textContent(), /cancelled-other|first-runtime-draft/)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'runtime', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Resume editing', exact: true }).click()
  await editor.waitFor()
  assert.match(await editor.textContent(), /first-runtime-draft/)
  await page.getByRole('button', { name: 'b.txt', exact: true }).click()
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.waitFor()
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.press('Control+z')
  assert.doesNotMatch(await editor.textContent(), /first-runtime-draft/)
  await page.keyboard.type(' pending-old-runtime')
  await page.getByText('a.txt •', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.delay = true
    window.resolveWrite = undefined
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(() => !!window.resolveWrite)
  await page.getByRole('button', { name: 'runtime', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('computer two', { exact: true }).waitFor()
  await page.evaluate(() => window.resolveWrite())
  await page.waitForFunction(() => window.files['a.txt'].includes('pending-old-runtime'))
  assert.equal(await editor.textContent(), 'computer two')
  assert.equal(await page.evaluate(() => window.otherFiles['a.txt']), 'computer two')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('computer two', { exact: true }).waitFor()
  assert.equal(await editor.textContent(), 'computer two')
  await page.getByRole('button', { name: 'b.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('second computer b', { exact: true }).waitFor()
  assert.equal(await editor.textContent(), 'second computer b')
  assert.equal(await page.evaluate(() => window.otherFiles['b.txt']), 'second computer b')
  await editor.locator('[data-char="0"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.keyboard.type(' delayed-b')
  await page.getByText('b.txt •', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.resolveWrite = undefined
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(() => !!window.resolveWrite)
  await page.getByRole('button', { name: 'a.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByText('computer two', { exact: true }).waitFor()
  await page.evaluate(() => window.resolveWrite())
  await page.waitForFunction(() => window.otherFiles['b.txt'].includes('delayed-b'))
  assert.equal(await editor.textContent(), 'computer two')
  assert.deepEqual(errors, [])
  console.log('Real Pierre edit navigation and save retention passed')
} finally {
  await browser.close()
}
