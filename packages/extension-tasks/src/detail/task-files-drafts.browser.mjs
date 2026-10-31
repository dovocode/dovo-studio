import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from '../../../../scripts/browser/harness.mjs'
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '')
const detail = root + '/packages/extension-tasks/src/detail/'
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/extension-tasks',
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';import {useState} from 'react';
    import {TaskFiles} from '${detail}task-files.tsx';import {fileDrafts} from '${detail}file-drafts.ts';
    window.drafts=fileDrafts;window.writes=[];window.files={'a.txt':'original','b.txt':'second'};
    const request=async(path,input)=>{
      if(path.endsWith('/directory'))return {entries:Object.keys(window.files).map(path=>({path,kind:'file'})),truncated:false};
      if(path.endsWith('/read')){if(!window.files[input.path])throw Error('File removed');return {contents:window.files[input.path],size:8,complete:true,truncated:false,startLine:1,hasMore:false}};
      if(path.endsWith('/write')){window.writes.push(input);if(window.fail)throw Error('save failed');if(window.delay)await new Promise(resolve=>window.complete=resolve);if(window.files[input.path]!==input.expectedContents)throw Error('conflict');window.files[input.path]=input.contents;return {contents:input.contents}};
      throw Error(path);
    };
    window.runtime={connected:true,connection:{runtimeId:'runtime',address:'http://lan.test',token:'paired-secret'},request};
    function App(){const[thread,setThread]=useState('one');const[visible,setVisible]=useState(true);window.showFiles=()=>setVisible(true);return <div onClick={event=>{if(window.unmountOnEdit&&event.target.textContent==='Edit')setVisible(false)}}><button onClick={()=>setThread(thread==='one'?'two':'one')}>thread</button>{visible&&<TaskFiles key={thread} task={{id:thread,repositoryId:'repo',files:[]}}/>}</div>};
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
      contents: "export {useState as useApplicationState} from 'react'",
    },
    {
      path: '@dovo/studio-core',
      contents:
        "export {responses} from '@dovo/protocol';export const useWorkspace=()=>window.runtime;export const useStudioHost=()=>({})",
    },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>',
    },
    {
      path: '@dovo/studio-ui/code-themes',
      contents:
        'export const preloadStudioHighlighter=async()=>{};export const useDiffOptions=()=>({options:{}})',
    },
    { path: '@pierre/diffs', contents: 'export const getFiletypeFromFileName=()=>"text"' },
    { path: '@pierre/diffs/edit', contents: 'export class Editor{}' },
    {
      path: '@pierre/diffs/react',
      contents:
        'export const EditProvider=({children})=>children;export const File=({file,edit,onEditChange})=>edit?<textarea aria-label="File editor" defaultValue={file.contents} onChange={event=>onEditChange({file:{contents:event.target.value}})}/>:<pre>{file.contents}</pre>',
    },
    {
      path: './resizable-sidebar',
      importer: detail,
      contents: 'export const ResizableSidebar=({children})=><aside>{children}</aside>',
    },
    {
      path: './project-file-browser',
      importer: detail,
      contents:
        'export const ProjectFileBrowser=({onSelect})=><nav>{Object.keys(window.files).map(path=><button key={path} onClick={()=>onSelect(path)}>{path}</button>)}</nav>',
    },
    {
      path: './project-image-preview',
      importer: detail,
      contents: 'export const ProjectImagePreview=()=>null',
    },
    {
      path: './live-refresh',
      importer: detail,
      contents:
        "import {useEffect} from 'react';export const useLiveRefresh=(connected,refresh)=>useEffect(()=>{void refresh()},[connected,refresh])",
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
  const boot = () => page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.goto('http://studio.test/')
  await boot()
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('a.txt').click()
  await page.evaluate(() => {
    window.unmountOnEdit = true
  })
  await button('Edit').click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Project files"]'))
  assert.equal(
    await page.evaluate(() => window.drafts.bytes),
    0,
    'Admission batched with unmount must release the clean reservation',
  )
  await page.evaluate(() => {
    window.unmountOnEdit = false
    window.showFiles()
  })
  await button('a.txt').click()
  await button('Edit').click()
  await page.getByRole('textbox', { name: 'File editor' }).fill('dirty source')
  await button('b.txt').click()
  await button('Recover draft: a.txt').click()
  await button('Save draft').waitFor()
  await button('thread').click()
  await button('a.txt').click()
  await button('Edit').waitFor()
  assert.equal(await button('Save draft').count(), 0)
  await button('thread').click()
  await button('Recover draft: a.txt').click()
  await page.evaluate(() => (window.fail = true))
  await button('Save draft').click()
  await page.getByText('save failed', { exact: true }).first().waitFor()
  await page.evaluate(() => {
    window.fail = false
    window.delay = true
  })
  await button('Retry save').click()
  await page.waitForFunction(() => !!window.complete)
  await button('b.txt').click()
  await button('Recover draft: a.txt').click()
  await button('Saving…').waitFor()
  await button('thread').click()
  await page.getByText('Draft from another task or checkout: a.txt', { exact: true }).waitFor()
  assert.equal(
    await button('Discard draft: a.txt').isDisabled(),
    true,
    'An orphaned inflight save must not be discarded',
  )
  await button('thread').click()
  await button('Recover draft: a.txt').click()
  await button('Saving…').waitFor()
  await page.evaluate(() => window.complete())
  await button('Edit').waitFor()
  assert.equal(await page.evaluate(() => window.files['a.txt']), 'dirty source')
  // Existing editor may grow under pressure; another file cannot allocate a new slot.
  await button('Edit').click()
  assert.equal(await page.evaluate(() => window.drafts.budget), 50 * 1024 * 1024)
  await page.getByRole('textbox', { name: 'File editor' }).fill('x'.repeat(4_300_000))
  assert.equal(
    await page.evaluate(() => window.drafts.pressure),
    false,
    'The old 8 MiB threshold must no longer apply',
  )
  await page.getByRole('textbox', { name: 'File editor' }).fill('x'.repeat(26_300_000))
  await page.getByText(/Draft memory limit reached/).waitFor()
  assert.equal(await page.evaluate(() => window.drafts.pressure), true)
  await button('b.txt').click()
  assert.equal(await button('Edit').isDisabled(), true)
  await page.getByText(/Save, download and discard, or shrink/).waitFor()
  await button('Recover draft: a.txt').click()
  await button('Resume editing').click()
  await page.getByRole('textbox', { name: 'File editor' }).fill('shrunk draft')
  assert.equal(await page.evaluate(() => window.drafts.pressure), false)
  await button('b.txt').click()
  assert.equal(await button('Edit').isEnabled(), true)
  // Switching scope never hides retained drafts or applies them to the new source.
  await button('thread').click()
  await page.getByText('Draft from another task or checkout: a.txt', { exact: true }).waitFor()
  await button('a.txt').click()
  await button('Edit').waitFor()
  assert.equal(await button('Save draft').count(), 0)
  const downloadEvent = page.waitForEvent('download')
  await button('Download draft: a.txt').click()
  const download = await downloadEvent
  const { readFile } = await import('node:fs/promises')
  assert.equal(await readFile(await download.path(), 'utf8'), 'shrunk draft')
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
    true,
  )
  await button('Discard draft: a.txt').click()
  assert.equal(await page.evaluate(() => window.drafts.unsafe), false)
  assert.equal(
    await page.getByText('Draft from another task or checkout: a.txt', { exact: true }).count(),
    0,
  )
  // The real Electron preload exposes window.dovo before renderer imports.
  // Preserve native close semantics even when this window has unsaved work.
  await page.addInitScript(() => {
    window.dovo = {}
  })
  await page.reload()
  await boot()
  await button('a.txt').click()
  await button('Edit').click()
  await page.getByRole('textbox', { name: 'File editor' }).fill('native unsaved draft')
  await page
    .getByText('Unsaved drafts stay in this window. Save or download before closing.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.evaluate(() => window.drafts.unsafe), true)
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
    false,
    'Electron preload marker must leave close/reload unblocked',
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS batched-unmount reservation cleanup, draft projected budget, active editing under pressure, shrinking, scope visibility, download, discard, browser-only unload warning, Electron preload bypass and failed/inflight saves',
  )
} finally {
  await browser.close()
}
