import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = `${root}/apps/mobile/src`
const stubs = [
  {
    path: '../../../runtime/connection/provider',
    importer: mobile,
    contents: 'export const useRuntime=()=>({connection:null,snapshot:null});',
  },
  {
    path: 'react-native',
    contents:
      'export const View=({children})=><div>{children}</div>;export const useWindowDimensions=()=>({height:800});',
  },
  {
    path: '../../../ui/content/text',
    importer: mobile,
    contents: 'export const Text=({children})=><span>{children}</span>;',
  },
  {
    path: '../../../ui/theme',
    importer: mobile,
    contents: 'export const useTheme=()=>({colors:{},styles:{}});',
  },
  {
    path: '../../../ui/controls/action',
    importer: mobile,
    contents: 'export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;',
  },
  {
    path: '../../review/use-file-review',
    importer: mobile,
    contents:
      'export const useFileReview=()=>({progress:{files:[],groups:[]},ready:false,setViewed:()=>{},reload:()=>{}});',
  },
  {
    path: '../../review/organize-review',
    importer: mobile,
    contents: 'export const MobileOrganizeReview=()=>null;',
  },
  {
    path: '../../review/file-review',
    importer: mobile,
    contents:
      'export const MobileFileReview=({files,selected,onSelect})=><select aria-label="Changed file" value={selected} onChange={event=>onSelect(event.target.value)}>{files.map(file=><option key={file.path} value={file.path}>{file.path}</option>)}</select>;',
  },
  {
    path: '../../../tasks/preview/diff-view',
    importer: mobile,
    contents:
      "import {useEffect} from 'react';export const DiffView=({patch})=>{useEffect(()=>{window.diffMounts++},[]);return <pre data-diff>{patch}</pre>};",
  },
  { path: './pull-comments', importer: mobile, contents: 'export const PullComments=()=>null;' },
]
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {PullChanges} from '${mobile}/scm/pulls/detail/pull-changes.tsx';
window.diffMounts=0;
const files=['binary.dat','generated.ts','vendor.ts','normal.ts'].map((path,index)=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new',attributes:{binary:index===0,generated:index===1,vendored:index===2}}));
function App(){const [current,setCurrent]=useState(files);window.clearGenerated=()=>setCurrent(prior=>prior.map(file=>({...file,attributes:{...file.attributes,generated:false}})));return <PullChanges repositoryId="repo" detail={{pull:{number:7,headSha:'a'.repeat(40),baseSha:'b'.repeat(40)},files:current,comments:[],capabilities:{actions:['inline-comment']}}} onOpen={()=>{}} onLineComment={()=>{}}/>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
  },
  stubs,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page
    .getByText('Text diff disabled by .gitattributes (binary or -diff).', { exact: true })
    .waitFor()
  assert.equal(await page.locator('[data-diff]').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Comment on line', exact: true }).count(), 0)
  const files = page.getByRole('combobox', { name: 'Changed file' })
  for (const path of ['generated.ts', 'vendor.ts']) {
    await files.selectOption(path)
    await page.getByRole('button', { name: 'Show changes', exact: true }).waitFor()
    assert.equal(await page.locator('[data-diff]').count(), 0)
  }
  assert.equal(await page.evaluate(() => window.diffMounts), 0)
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await page.locator('[data-diff]').waitFor()
  await page.getByRole('button', { name: 'Comment on line', exact: true }).waitFor()
  await files.selectOption('normal.ts')
  await page.locator('[data-diff]').waitFor()
  assert.equal(await page.locator('[data-diff]').count(), 1)
  await files.selectOption('generated.ts')
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await page.locator('[data-diff]').waitFor()
  await page.getByRole('button', { name: 'Hide changes', exact: true }).click()
  assert.equal(await page.locator('[data-diff]').count(), 0)
  await page.evaluate(() => window.clearGenerated())
  await page.locator('[data-diff]').waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile PR attributes: binary notices, default generated/vendor collapse, explicit expansion, selected-file rendering, inline comment availability and attribute refresh passed.',
  )
} finally {
  await browser.close()
}
