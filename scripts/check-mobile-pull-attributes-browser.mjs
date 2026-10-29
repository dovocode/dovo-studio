import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = `${root}/apps/mobile/src`
const stubs = [
  {
    path: '@dovo/protocol',
    importer: mobile,
    contents: `export * from '${root}/packages/protocol/src/index.ts';import {pullFileFingerprint as fingerprint} from '${root}/packages/protocol/src/index.ts';export const pullFileFingerprint=(...args)=>{window.fingerprintCalls=(window.fingerprintCalls??0)+1;const value=fingerprint(...args);(window.fingerprints??={})[args[0].path]=value;return value};`,
  },
  {
    path: '../../../runtime/connection/provider',
    importer: mobile,
    contents: 'export const useRuntime=()=>({connection:null,snapshot:null});',
  },
  {
    path: 'react-native',
    contents: `import {useEffect} from 'react';export const View=({children,style,testID,onLayout,accessibilityRole,accessibilityLabel,pointerEvents})=>{useEffect(()=>{if(testID==='PR file controls')onLayout?.({nativeEvent:{layout:{height:88}}})},[testID]);return <div role={accessibilityRole==='image'?'img':undefined} aria-label={accessibilityLabel} data-testid={testID} style={{...style,pointerEvents:pointerEvents==='none'?'none':undefined}}>{children}</div>};export const Pressable=({children,onPress,accessibilityLabel,accessibilityState,style})=><button style={{position:'relative',...(typeof style==='function'?style({pressed:false}):style)}} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>;export const SectionList=()=>null;export const useWindowDimensions=()=>({height:800});`,
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
    path: 'lucide-react-native',
    contents:
      'export const Box=()=>null,CodeXml=()=>null,FileText=()=>null,FlaskConical=()=>null,Settings=()=>null;',
  },
  {
    path: '../controls/icon',
    importer: `${mobile}/ui/content`,
    contents: 'export const Icon=()=>null;',
  },
  {
    path: '../theme',
    importer: `${mobile}/ui/content`,
    contents: stubs.find((stub) => stub.path === '../../../ui/theme').contents,
  },
  {
    path: './text',
    importer: `${mobile}/ui/content`,
    contents:
      'export const Text=({children,style})=><span style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;',
  },
)
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {PullChanges} from '${mobile}/scm/pulls/detail/pull-changes.tsx';
window.diffMounts=0;
const files=['binary.dat','generated.ts','vendor.ts','normal.ts','docs/setup.md'].map((path,index)=>({path,status:'modified',additions:index===0?null:1,deletions:index===0?null:0,patch:index===0?undefined:'@@ -1 +1,2 @@\\n old\\n+new',attributes:{binary:index===0,generated:index===1,vendored:index===2}}));
function App(){const [version,setVersion]=useState(0),[headSha,setHeadSha]=useState('a'.repeat(40)),[current,setCurrent]=useState(files),[fragment,setFragment]=useState(''),[initialPath,setInitialPath]=useState();window.statusVersion=version;window.refreshStatus=()=>setVersion(value=>value+1);window.pushCommit=()=>setHeadSha('c'.repeat(40));window.openLinkedComment=()=>{setInitialPath('normal.ts');setFragment('#discussion_r7')};window.clearGenerated=()=>setCurrent(prior=>prior.map(file=>({...file,attributes:{...file.attributes,generated:false}})));return <PullChanges initialPath={initialPath} viewportHeight={640} fragment={fragment} repositoryId="repo" detail={{pull:{number:7,headSha,baseSha:'b'.repeat(40)},files:current,comments:[{id:'inline',kind:'inline',path:'normal.ts',url:'https://github.com/o/r/pull/7#discussion_r7',body:'Inline feedback'}],capabilities:{actions:['inline-comment']}}} onOpen={()=>{}} onLineComment={()=>{}}/>}createRoot(document.getElementById('app')).render(<App/>);`,
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
  const fingerprintCalls = await page.evaluate(() => window.fingerprintCalls)
  assert.equal(fingerprintCalls, 5)
  const initialFingerprints = await page.evaluate(() => window.fingerprints)
  await page.evaluate(() => window.refreshStatus())
  await page.waitForFunction(() => window.statusVersion === 1)
  assert.equal(
    await page.evaluate(() => window.fingerprintCalls),
    fingerprintCalls,
    'Unrelated PR metadata must not rehash native review files',
  )
  await page.evaluate(() => window.pushCommit())
  await page.waitForFunction((count) => window.fingerprintCalls > count, fingerprintCalls)
  assert.equal(
    await page.evaluate(() => window.fingerprintCalls),
    fingerprintCalls + 5,
    'A new commit still invalidates fingerprints, including missing patches',
  )
  const nextFingerprints = await page.evaluate(() => window.fingerprints)
  assert.notEqual(nextFingerprints['binary.dat'], initialFingerprints['binary.dat'])
  assert.equal(nextFingerprints['normal.ts'], initialFingerprints['normal.ts'])
  assert.equal(await page.locator('[data-diff]').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Comment on line', exact: true }).count(), 0)
  const summary = page.getByRole('button', { name: '5 files changed', exact: true })
  assert.equal(await summary.getAttribute('aria-expanded'), 'false')
  assert.match(await summary.innerText(), /available stats/)
  assert.match(await summary.innerText(), /\+4/)
  assert.equal(await page.getByRole('button', { name: 'Code 3', exact: true }).count(), 0)
  await summary.click()
  assert.equal(await summary.getAttribute('aria-expanded'), 'true')
  await page.getByRole('button', { name: 'Code 3', exact: true }).waitFor()
  assert.match(
    await page
      .getByRole('img', { name: /Available changed line distribution/ })
      .getAttribute('aria-label'),
    /Code 2 lines/,
  )
  assert.match(
    await page.getByRole('button', { name: 'Filter Code: 3 files' }).innerText(),
    /available/,
  )
  assert.doesNotMatch(
    await page.getByRole('button', { name: 'binary.dat, unviewed', exact: true }).innerText(),
    /[+−]\d/,
  )
  await page.getByRole('button', { name: 'normal.ts, unviewed', exact: true }).click()
  assert.equal(await page.getByRole('combobox', { name: 'Changed file' }).inputValue(), 'normal.ts')
  await page.locator('[data-diff]').waitFor()
  await page.getByRole('combobox', { name: 'Changed file' }).selectOption('binary.dat')
  const docsTile = page.getByRole('button', { name: 'Filter Docs: 1 files', exact: true })
  assert.ok((await docsTile.evaluate((node) => parseFloat(getComputedStyle(node).minHeight))) >= 44)
  await docsTile.click()
  assert.equal(await docsTile.getAttribute('aria-pressed'), 'true')
  assert.deepEqual(await page.locator('select option').allTextContents(), ['docs/setup.md'])
  await docsTile.click()
  assert.equal(await docsTile.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator('select option').count(), 5)
  const docs = page.getByRole('button', { name: 'Docs 1', exact: true })
  await docs.click()
  assert.equal(await docs.getAttribute('aria-pressed'), 'true')
  assert.deepEqual(await page.locator('select option').allTextContents(), ['docs/setup.md'])
  assert.equal(
    await docs.locator('[role=img]').evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(4, 120, 87)',
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
