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
    contents: `import {useEffect} from 'react';export const View=({children,style,testID,onLayout,accessibilityRole,accessibilityLabel})=>{useEffect(()=>{if(testID==='PR file controls')onLayout?.({nativeEvent:{layout:{height:88}}})},[testID]);return <div role={accessibilityRole==='image'?'img':undefined} aria-label={accessibilityLabel} data-testid={testID} style={style}>{children}</div>};export const Pressable=({children,onPress,accessibilityLabel,accessibilityState,style})=><button style={style} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>;export const useWindowDimensions=()=>({height:800});`,
  },
  {
    path: '../../../ui/content/text',
    importer: mobile,
    contents: 'export const Text=({children})=><span>{children}</span>;',
  },
  {
    path: '../../../ui/theme',
    importer: mobile,
    contents: `export const useTheme=()=>({mode:'light',colors:{muted:'#666',text:'#111',border:'#ddd',selection:'#eee'},styles:{}});`,
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
    contents: 'export const MobileOrganizeReview=()=> <button>Organize review</button>;',
  },
  {
    path: '../../review/file-review',
    importer: mobile,
    contents:
      'export const MobileFileReview=({files,selected,onSelect,onOptions})=><><button onClick={onOptions}>File actions</button><select aria-label="Changed file" value={selected} onChange={event=>onSelect(event.target.value)}>{files.map(file=><option key={file.path} value={file.path}>{file.path}</option>)}</select></>;',
  },
  {
    path: '../../../tasks/preview/diff-view',
    importer: mobile,
    contents:
      "import {useEffect} from 'react';export const DiffView=({patch})=>{useEffect(()=>{window.diffMounts++},[]);return <pre data-diff>{patch}</pre>};",
  },
  {
    path: './pull-comments',
    importer: mobile,
    contents:
      'export const PullComments=({comments})=><div>{comments.map(comment=><p key={comment.id}>{comment.body}</p>)}</div>;',
  },
  { path: '../../../ui/controls/icon', importer: mobile, contents: 'export const Icon=()=>null;' },
  {
    path: '../../../ui/layout/sheet',
    importer: mobile,
    contents:
      'export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>;',
  },
]
stubs.push(
  {
    path: '../theme',
    importer: `${mobile}/ui/content`,
    contents: stubs.find((stub) => stub.path === '../../../ui/theme').contents,
  },
  {
    path: './text',
    importer: `${mobile}/ui/content`,
    contents: 'export const Text=({children,style})=><span style={style}>{children}</span>;',
  },
)
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {PullChanges} from '${mobile}/scm/pulls/detail/pull-changes.tsx';
window.diffMounts=0;
const files=['binary.dat','generated.ts','vendor.ts','normal.ts','docs/setup.md'].map((path,index)=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new',attributes:{binary:index===0,generated:index===1,vendored:index===2}}));
function App(){const [current,setCurrent]=useState(files),[fragment,setFragment]=useState(''),[initialPath,setInitialPath]=useState();window.openLinkedComment=()=>{setInitialPath('normal.ts');setFragment('#discussion_r7')};window.clearGenerated=()=>setCurrent(prior=>prior.map(file=>({...file,attributes:{...file.attributes,generated:false}})));return <PullChanges initialPath={initialPath} viewportHeight={640} fragment={fragment} repositoryId="repo" detail={{pull:{number:7,headSha:'a'.repeat(40),baseSha:'b'.repeat(40)},files:current,comments:[{id:'inline',kind:'inline',path:'normal.ts',url:'https://github.com/o/r/pull/7#discussion_r7',body:'Inline feedback'}],capabilities:{actions:['inline-comment']}}} onOpen={()=>{}} onLineComment={()=>{}}/>}createRoot(document.getElementById('app')).render(<App/>);`,
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
  await page.getByRole('button', { name: 'Code 3', exact: true }).waitFor()
  const docs = page.getByRole('button', { name: 'Docs 1', exact: true })
  await docs.click()
  assert.equal(await docs.getAttribute('aria-pressed'), 'true')
  assert.deepEqual(await page.locator('select option').allTextContents(), ['docs/setup.md'])
  assert.equal(
    await docs.locator('[role=img]').evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(146, 64, 14)',
  )
  await docs.click()
  assert.equal(await docs.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator('select option').count(), 5)
  await page.getByRole('button', { name: 'Generated 1', exact: true }).click()
  assert.deepEqual(await page.locator('select option').allTextContents(), ['generated.ts'])
  await page.getByRole('button', { name: 'All 5', exact: true }).click()
  const initialMounts = await page.evaluate(() => window.diffMounts)
  const files = page.getByRole('combobox', { name: 'Changed file' })
  for (const path of ['generated.ts', 'vendor.ts']) {
    await files.selectOption(path)
    await page.getByRole('button', { name: 'Show changes', exact: true }).waitFor()
    assert.equal(await page.locator('[data-diff]').count(), 0)
  }
  assert.equal(await page.evaluate(() => window.diffMounts), initialMounts)
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await page.locator('[data-diff]').waitFor()
  await page.getByRole('button', { name: 'Comment on line', exact: true }).waitFor()
  await files.selectOption('normal.ts')
  await page.locator('[data-diff]').waitFor()
  assert.equal(await page.locator('[data-diff]').count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Organize review', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('dialog', { name: 'File actions' }).waitFor()
  await page.getByRole('button', { name: 'Organize review', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const feedback = page.getByRole('button', { name: 'Feedback on this file (1)', exact: true })
  assert.equal(await feedback.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByText('Inline feedback', { exact: true }).count(), 0)
  assert.equal(
    await page.getByTestId('PR code viewport').evaluate((node) => node.style.height),
    '484px',
  )
  await feedback.click()
  await page.getByText('Inline feedback', { exact: true }).waitFor()
  await feedback.click()
  assert.equal(await page.getByText('Inline feedback', { exact: true }).count(), 0)
  await docs.click()
  await page.evaluate(() => window.openLinkedComment())
  await page.getByText('Inline feedback', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'All 5', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await feedback.click()
  assert.equal(await feedback.getAttribute('aria-expanded'), 'false')

  await files.selectOption('generated.ts')
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await page.locator('[data-diff]').waitFor()
  await page.getByRole('button', { name: 'Hide changes', exact: true }).click()
  assert.equal(await page.locator('[data-diff]').count(), 0)
  await page.getByRole('button', { name: 'Generated 1', exact: true }).click()
  await page.evaluate(() => window.clearGenerated())
  await page.getByText('No matching files.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Generated 0', exact: true }).waitFor()
  await page.getByRole('button', { name: 'All 5', exact: true }).click()
  await page.locator('[data-diff]').waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile PR attributes: binary notices, default generated/vendor collapse, explicit expansion, selected-file rendering, inline comment availability and attribute refresh passed.',
  )
} finally {
  await browser.close()
}
