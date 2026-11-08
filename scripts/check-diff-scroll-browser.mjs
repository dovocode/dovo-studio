import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mocks = {
  '@dovo/studio-core': `export * from '@dovo/protocol';export const updateTask=(workspace)=>workspace;export const useAppPreferences=()=>({hideWhitespaceChanges:false});export const whitespaceOnlyFile=()=>false;export const useWorkspace=()=>({snapshot:{codeReviewsEnabled:window.reviewsEnabled},workspace:{repositories:[],agents:[]},connected:false,setWorkspace:()=>{},request:async()=>({})});export const useFileReview=()=>({progress:null,busy:false,error:"",ready:false,reload(){},setViewed(){}});export const defaultAppPreferences={diffFilesSidebarWidth:260};export const readAppPreferences=()=>defaultAppPreferences;export const updateAppPreferences=()=>{};`,
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export const useApplicationState=v=>{const [value,set]=useState(v);const ref=useRef(value);ref.current=value;return [value,set,ref]};`,
  '@dovo/studio-ui': `export {Button} from './src/components/ui/button';export {Dialog,DialogContent,DialogTitle,DialogDescription} from './src/components/ui/dialog';export const OrganizeReview=()=>null;export {ReviewFiles,FileReviewControls} from './src/review/file-review';export {cn} from './src/lib/utils';export {ChoicePicker} from './src/choice-picker';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const EmptyState=()=>null;export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;export const ErrorBoundary=({children})=>children;`,
  '../files/presentation': `export const DiffAmounts=()=>null;export const fileStats=file=>({path:file.path,additions:1,deletions:1});`,
  './linked-review': `export const LinkedReview=()=>null;`,
  '../files/saved-file-preview': `export const SavedFilePreview=()=>null;`,
  '../detail/live-refresh': `export const useLiveRefresh=()=>null;`,
  './disk-actions': `export const DiskActions=()=>null;`,
  '../chat/thread/review-findings': `export const ReviewFindings=()=>null;`,
  './commit-bar': `export const CommitBar=()=>null;`,
  './review-feedback': `export const ReviewFeedback=()=>null;`,
  '../chat/thread/review-comments-tray': `export const ReviewCommentsTray=()=>null;`,
  './use-task-review': `export const useTaskReview=()=>({busy:false,error:'',refresh(){},run(){},report:{current:true,evidenceLimited:false,reviews:[{id:'review',status:'completed',reviewer:'Independent reviewer',model:'Thread model',createdAt:'2026-10-12',baseline:'tree',files:[],summary:'Inspected persistence and callers',notVerified:['Physical iPhone behavior'],findings:[{id:'finding',path:'src/nested/file-000.ts',line:42,severity:'high',status:'addressed',title:'Closing can lose unsaved changes',trigger:'Close while persistence is pending',impact:'Latest changes are lost',suggestion:'Wait for persistence before closing'}]}],commands:[{id:'check',command:'pnpm test persistence',status:'passed',source:'reviewer',revision:'tree',time:'2026-10-12',output:'Regression passed',exitCode:0}]}});`,
  './pierre-editor': `export const PierreEditor=()=> <div className="flex h-full min-h-0 flex-col"><header className="shrink-0 h-10">Editor</header><div id="real-diff" className="min-h-0 flex-1 overflow-auto"><pre>{Array.from({length:600},(_,i)=>'line '+i).join('\\n')}</pre></div></div>;`,
}
const bundle = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {FileTree} from '${root}/packages/extension-tasks/src/review/file-tree.tsx';import {ReviewPane} from '${root}/packages/extension-tasks/src/review/review-pane.tsx';import {ReviewFiles} from '@dovo/studio-ui';
const files=Array.from({length:160},(_,i)=>({path:'src/nested/file-'+String(i).padStart(3,'0')+'.ts',before:'before',after:'after',status:'modified'}));function App(){const [selected,setSelected]=useState(files[0].path);return <div className="studio dark flex flex-col overflow-hidden" style={{height:"100vh"}}><header className="h-10 shrink-0">Thread</header><section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><header className="h-10 shrink-0">Diff toolbar</header><div className="flex min-h-0 min-w-0 flex-1"><div id="diff" className="min-h-0 min-w-0 flex-1 overflow-auto"><pre>{Array.from({length:300},(_,i)=>'line '+i).join('\\n')}</pre></div><FileTree files={files} stats={[]} selected={selected} onSelect={setSelected}/></div></section><aside id="pull-tree" style={{maxHeight:"25vh"}} className="flex min-h-0 shrink-0 flex-col overflow-hidden"><ReviewFiles files={files} selected={selected} groups={[]} related={false} onRelatedChange={()=>{}} onSelect={setSelected}/></aside></div>};const rootView=createRoot(document.getElementById('app'));window.reviewsEnabled=true;window.showRealReview=()=>rootView.render(<div className="studio dark flex flex-col overflow-hidden" style={{height:'100vh'}}><header className="h-10 shrink-0">Thread</header><aside className="flex min-h-0 flex-1 flex-col"><header className="h-10 shrink-0">Changes</header><div className="min-h-0 min-w-0 flex-1"><ReviewPane task={{id:'task',repositoryId:'repo',files,messages:[],turns:[],status:'completed'}}/></div></aside></div>);rootView.render(<App/>);`,
    resolveDir: root + '/packages/studio-ui',
    loader: 'tsx',
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
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 650 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<style>body{margin:0}</style><div id="app"></div>')
  const assets = root + '/apps/desktop/dist/assets'
  for (const name of (await readdir(assets)).filter((name) => name.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + name, 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const tree = page.getByRole('complementary', { name: 'Changed files' })
  await tree.waitFor({ state: 'attached' })
  const scroll = tree.locator('nav.overflow-auto')
  assert.equal(
    await scroll.evaluate((e) => e.scrollHeight > e.clientHeight && e.clientHeight > 50),
    true,
  )
  await scroll.hover()
  await page.mouse.wheel(0, 2000)
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Changed files"] .overflow-auto').scrollTop > 0,
  )
  assert.equal(await page.locator('#diff').evaluate((e) => e.scrollTop), 0)
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0)
  const filter = tree.getByRole('searchbox', { name: 'Search changed files' })
  assert.equal(await filter.isVisible(), true)
  await filter.fill('file-159')
  await tree.getByRole('button', { name: /file-159/ }).click()
  assert.equal(await page.locator('#diff').evaluate((e) => e.scrollTop), 0)
  const pr = page.locator('#pull-tree nav')
  await pr.hover()
  await page.mouse.wheel(0, 2000)
  await page.waitForFunction(() => document.querySelector('#pull-tree nav').scrollTop > 0)
  assert.equal(
    await page
      .locator('#pull-tree')
      .getByRole('searchbox', { name: 'Search changed files' })
      .isVisible(),
    true,
  )
  assert.equal(
    await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight),
    true,
  )
  await page.evaluate(() => window.showRealReview())
  await page.getByRole('button', { name: 'Show change map', exact: true }).click()
  const realTree = page.getByRole('complementary', { name: 'Changed files' })
  const realScroll = realTree.locator('nav.overflow-auto')
  await realTree.waitFor()
  assert.equal(
    await realScroll.evaluate(
      (element) => element.scrollHeight > element.clientHeight && element.clientHeight > 50,
    ),
    true,
  )
  const filterTop = await page
    .getByRole('searchbox', { name: 'Search changed files' })
    .evaluate((element) => element.getBoundingClientRect().top)
  await realScroll.hover()
  await page.mouse.wheel(0, 2000)
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Changed files"] .overflow-auto').scrollTop > 0,
  )
  assert.equal(await page.locator('#real-diff').evaluate((element) => element.scrollTop), 0)
  assert.equal(
    await page
      .getByRole('searchbox', { name: 'Search changed files' })
      .evaluate((element) => element.getBoundingClientRect().top),
    filterTop,
  )
  await page.locator('#real-diff').hover()
  await page.mouse.wheel(0, 2000)
  await page.waitForFunction(() => document.querySelector('#real-diff').scrollTop > 0)
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0)
  assert.equal(
    await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight),
    true,
  )
  await page.getByRole('tab', { name: /Findings/ }).click()
  const panel = page.getByRole('complementary', { name: 'Findings beside diff' })
  await panel.getByText('Closing can lose unsaved changes', { exact: true }).waitFor()
  assert.equal(await page.locator('#real-diff').isVisible(), true)
  assert.equal(
    await panel.getByText('Close while persistence is pending', { exact: false }).isVisible(),
    false,
  )
  await panel.getByText('Evidence & suggested fix', { exact: true }).click()
  assert.equal(
    await panel.getByText('Close while persistence is pending', { exact: false }).isVisible(),
    true,
  )
  await page.getByRole('button', { name: 'Hide change map', exact: true }).click()
  const screenshots = process.env.DOVO_REVIEW_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })
  for (const width of [1200, 736, 360]) {
    await page.setViewportSize({ width, height: 800 })
    const diff = await page.locator('#real-diff').boundingBox()
    const findings = await panel.boundingBox()
    assert.ok(
      diff && findings && diff.width > 100 && diff.height > 80 && findings.height > 80,
      JSON.stringify({ width, diff, findings }),
    )
    if (width >= 700) assert.ok(findings.x >= diff.x + diff.width - 2)
    else assert.ok(findings.y >= diff.y + diff.height - 2)
    assert.equal(
      await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth),
      true,
    )
    if (screenshots)
      await page.screenshot({ path: screenshots + '/review-workbench-' + width + '.png' })
  }
  await page.evaluate(() => {
    window.reviewsEnabled = false
    window.showRealReview()
  })
  await panel.waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('tab', { name: /Findings/ }).count(), 0)
  assert.equal(await page.locator('#real-diff').isVisible(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Diff and PR file trees scroll independently; filters remain visible and the page stays bounded',
  )
} finally {
  await browser.close()
}
