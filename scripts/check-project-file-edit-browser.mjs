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
      if(path.endsWith('/search-content')) {if(input.query==='old request') return new Promise(resolve=>window.resolveOldSearch=()=>resolve({matches:[{path:'old.ts',line:1,excerpt:'old request',matchStart:0,matchEnd:11}],truncated:false,scannedFiles:1,skippedFiles:0})); if(input.query==='limited')return {matches:[],truncated:true,scannedFiles:2000,skippedFiles:1};return {matches:Object.entries(files).flatMap(([path,contents])=>contents.split(String.fromCharCode(10)).flatMap((excerpt,index)=>excerpt.includes(input.query)?[{path,line:index+1,excerpt,matchStart:excerpt.indexOf(input.query),matchEnd:excerpt.indexOf(input.query)+input.query.length}]:[])),truncated:false,scannedFiles:Object.keys(files).length,skippedFiles:0};}
      if(path.endsWith('/directory'))return {entries:Object.keys(files).map(path=>({path,kind:'file'})),truncated:false};
      if(path.endsWith('/search-paths'))return {files:Object.keys(files).filter(path=>path.includes(input.query)),truncated:false};
      if(path.endsWith('/list')) return {files:Object.keys(files)};
      if(path.endsWith('/read')) {window.reads.push(input.path);return {path:input.path,contents:files[input.path],size:new TextEncoder().encode(files[input.path]).length,complete:true,truncated:false,startLine:1,hasMore:false};}
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
      contents: `import {Effect} from 'effect';export {responses} from '@dovo/protocol';const requestEffect=(...args)=>Effect.tryPromise({try:signal=>{if(args[0].endsWith('/search-content'))(window.searchSignals??=[]).push({query:args[1].query,signal});return window.runtime.request(...args)},catch:error=>error});export const useWorkspace=()=>({...window.runtime,requestEffect});export const useStudioHost=()=>({});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {SearchField} from '${root}/packages/studio-ui/src/search-field.tsx';export const FileTypeIcon=()=>null;export const FileChangeCounts=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const IconButton=({children,label,...props})=><button aria-label={label} {...props}>{children}</button>;export const FileBrowserTree=({files,onSelect})=><nav>{files.map(file=><button key={file.path} onClick={()=>onSelect(file.path)}>{file.path}</button>)}</nav>;`,
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
  await page
    .locator('p[role="alert"]')
    .filter({ hasText: /^save failed$/ })
    .waitFor()
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
  await page
    .locator('p[role="alert"]')
    .filter({ hasText: /^conflict$/ })
    .waitFor()
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
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    window.otherFiles['deep.ts'] = Array.from({ length: 400 }, (_, index) =>
      index === 349
        ? 'const NEEDLE[a+b] = 1'
        : index === 19
          ? 'const FIRST_NEEDLE[a+b] = 1'
          : 'line ' + (index + 1),
    ).join('\n')
  })
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search project code', exact: true })
  await search.fill('NEEDLE[a+b]')
  await page.getByRole('button').filter({ hasText: 'deep.ts:350' }).click()
  const selectedLine = page.locator('[data-line][data-selected-line]').first()
  await selectedLine.waitFor()
  assert.match(await selectedLine.textContent(), /NEEDLE\[a\+b\]/)
  const bounds = await selectedLine.boundingBox()
  assert.ok(
    bounds && bounds.y >= 0 && bounds.y < page.viewportSize().height,
    'The exact matching line is revealed in the source viewer',
  )
  for (const line of [20, 350, 350]) {
    await page
      .getByRole('button')
      .filter({ hasText: 'deep.ts:' + line })
      .click()
    const match = page.locator('[data-line="' + line + '"][data-selected-line]').first()
    await match.waitFor()
    await match.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    const bounds = await match.boundingBox()
    assert.ok(
      bounds && bounds.y >= 0 && bounds.y < page.viewportSize().height,
      'Every result selection reveals its line, including another match in the same file',
    )
  }
  await search.fill('old request')
  await page.waitForFunction(() => !!window.resolveOldSearch)
  await search.fill('NEEDLE[a+b]')
  await page.waitForFunction(
    () => window.searchSignals.find((item) => item.query === 'old request')?.signal.aborted,
  )
  await page.getByRole('button').filter({ hasText: 'deep.ts:350' }).waitFor()
  await page.evaluate(() => window.resolveOldSearch())
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await page.getByRole('button').filter({ hasText: 'old.ts:1' }).count(), 0)
  await search.fill('limited')
  await page.getByText(/Some files are omitted/).waitFor()
  await page.getByText(/1 item skipped/).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Real Pierre edit retention, literal project search, exact-line reveal, stale-query protection and truncation passed',
  )
} finally {
  await browser.close()
}
