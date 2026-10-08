import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const uiDir = root + '/packages/studio-ui/src'
const controls =
  ['button', 'input', 'textarea', 'checkbox', 'badge', 'dialog']
    .map((name) => `export * from '${uiDir}/components/ui/${name}.tsx';`)
    .join('') +
  `export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {LineCommentForm} from '${uiDir}/line-comment-form.tsx';export const FormField=({label,children})=><label>{label}{children}</label>;export {MessageResponse} from '${uiDir}/components/ai-elements/message.tsx';`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export * from '@dovo/protocol';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export const useWorkspace=()=>window.store;export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useDiffOptions=()=>({options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'wrap'},defaultSplit:false});export const useResolvedTheme=()=> 'dark';export const useAppPreferences=()=>({hideWhitespaceChanges:false,themePalette:'dovo'});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto'});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
  '@dovo/studio-core/state': `export * from '${root}/packages/studio-core/src/runtime/application-state.ts';`,
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,pulls:window.pulls,error:window.pullError}],connected:window.store.connected,busy:false,refresh:()=>{},more:()=>{}});`,
  './pipeline-runs': `export const PullPipelineRuns=()=>null;`,
  '../list/start-task': `export const StartPullTask=()=> <button>New task</button>;`,
  './create': `export const CreatePull=()=>null;`,
  '../../connections/forge-connections': `export const ForgeConnections=()=>null;`,
  '../../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {Effect} from 'effect';import {ApplicationStateProvider} from '@dovo/studio-core/state';import {createRoot} from 'react-dom/client';import {PullDetail} from '${root}/packages/extension-scm/src/pulls/detail/detail.tsx';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],checksState:'SUCCESS',reviewDecision:'REVIEW_REQUIRED',additions:24,deletions:8,commentCount:3,viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,url:'https://github.com/team/project/pull/8',title:'Other author',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false},{...pull,number:9,url:'https://github.com/team/project/pull/9',title:'Draft feature',draft:true,viewerIsAuthor:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',mergeable:true,reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'},{id:'review',kind:'review',author:'teammate',state:'APPROVED',body:'Looks good to me',url:pull.url,date:'2026-10-04'}],checks:[{name:'Tests',status:'SUCCESS',summary:'All tests passed',details:'2 tests completed'}],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>window.copied.push(value)}});window.store={connected:true,activeRuntimeId:'mac',workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};window.detailReads=0;window.store.requestEffect=()=>Effect.sync(()=>{window.detailReads++;return JSON.parse(JSON.stringify(window.detail));});const realRoot=createRoot(document.getElementById('app'));const rootView={render:element=>realRoot.render(<ApplicationStateProvider>{element}</ApplicationStateProvider>)};window.showLongList=()=>{window.pullError='Command failed: gh repo view '+('https://github.example/'+ 'long-repository-name'.repeat(70));window.source.repository.name='project-name'.repeat(40);window.pulls=Array.from({length:180},(_,i)=>({...pull,number:i+1,title:'Scroll regression '+i,url:'https://github.com/team/project/pull/'+(i+1)}));rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key="long-list"/></div></div></main></div></div>)};window.showEmbedded=()=>rootView.render(<main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main>);window.renderKey=0;window.showProbe=()=>rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><nav className="studio-navigation" style={{width:44}}/><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key={window.renderKey++}/></div></div></main></div></div>);window.showProbe();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    '@dovo/studio-ui/code-themes': root + '/packages/studio-ui/src/code-themes.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onLoad({ filter: /studio-ui\/src\/code-themes\.ts$/ }, async ({ path }) => ({
          loader: 'ts',
          contents:
            (await readFile(path, 'utf8')).replace(
              'export function preloadStudioHighlighter(',
              'function originalPreloadStudioHighlighter(',
            ) +
            '\nexport function preloadStudioHighlighter(language){if(window.highlightFailures>0){window.highlightFailures--;return Promise.reject(new Error("Temporary syntax resource failure"));}return originalPreloadStudioHighlighter(language);}',
        }))
        b.onLoad({ filter: /pulls\/detail\/patch\.tsx$/ }, async ({ path }) => ({
          loader: 'tsx',
          contents:
            (await readFile(path, 'utf8')).replace(
              'parsePatchFiles }',
              'parsePatchFiles as originalParsePatchFiles }',
            ) +
            '\nfunction parsePatchFiles(...args){window.parseCount=(window.parseCount??0)+1;return originalParsePatchFiles(...args)}',
        }))
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
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

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  const assets = root + '/apps/desktop/dist/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const list = page.getByRole('navigation', { name: 'Pull request sidebar' })
  const detail = page.locator('[aria-label="Pull request details"]')
  const content = detail.locator('[aria-label="Pull request content"]')
  const bounded = async (locator) =>
    assert.equal(await locator.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true)
  const open = async () =>
    list.getByRole('button').filter({ hasText: 'Improve pull request reviews' }).first().click()

  await page.evaluate(() => {
    window.detail.files = Array.from({ length: 30 }, (_, i) => ({
      path: 'src/file-' + i + '.txt',
      status: 'modified',
      additions: 60,
      deletions: 0,
      patch:
        '@@ -1 +1,61 @@\n old\n' +
        Array.from({ length: 60 }, (_, j) => '+' + 'new line ' + j + ' ' + 'x'.repeat(120)).join(
          '\n',
        ),
    }))
    window.showProbe()
  })
  await open()
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('diffs-container').length === 30 &&
      [...document.querySelectorAll('diffs-container')].every((e) =>
        e.shadowRoot?.querySelector('pre'),
      ),
  )
  assert.equal(await page.evaluate(() => window.parseCount), 30)
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll('diffs-container')].every(
        (e) => e.shadowRoot.querySelector('pre').dataset.overflow === 'wrap',
      ),
    ),
    true,
  )
  await bounded(content)
  await content.evaluate((e) => {
    e.scrollTop = 5000
  })
  const changesTop = await content.evaluate((e) => e.scrollTop)
  assert.ok(changesTop > 4000)
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  assert.equal(await content.evaluate((e) => e.scrollTop), 0)
  const form = detail.getByRole('form', { name: 'Add a pull request comment' }).getByRole('textbox')
  await form.fill('Keep my feedback')
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).click()
  assert.ok(Math.abs((await content.evaluate((e) => e.scrollTop)) - changesTop) < 2)
  await detail.getByRole('checkbox').first().check()
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => window.detailReads >= 2)
  await page.waitForTimeout(100)
  assert.equal(
    await page.evaluate(() => window.parseCount),
    30,
    'unchanged refresh reparsed patches',
  )
  await page.evaluate(() => {
    window.detail.files[0].patch += '\n+changed'
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => window.parseCount === 31)
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  assert.equal(await form.inputValue(), 'Keep my feedback')
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).click()
  await detail.getByText('1 of 30 reviewed', { exact: true }).waitFor()

  await page.setViewportSize({ width: 768, height: 350 })
  await page.evaluate(() => {
    window.detail.pull.title = 'A long pull request title '.repeat(12)
    window.detail.refreshError = 'E'.repeat(180)
    window.detail.warnings = ['W'.repeat(180)]
    window.detail.checks = [{ name: 'C'.repeat(120), status: 'FAILURE', summary: 'Failure' }]
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => window.detailReads >= 4)
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await bounded(content)
  assert.ok((await content.evaluate((e) => e.clientHeight)) >= 100)
  await bounded(detail)
  await bounded(page.locator('html'))
  const controls = detail.locator('[aria-label="Pull request controls"]')
  assert.equal(await controls.evaluate((e) => e.scrollHeight > e.clientHeight), true)
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await bounded(content)

  await page.setViewportSize({ width: 880, height: 350 })
  await page.evaluate(() => window.showLongList())
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  const filters = list.locator('[aria-label="Pull request filters"]')
  assert.equal(await filters.evaluate((e) => e.scrollHeight > e.clientHeight), true)
  const rows = list.locator('[aria-label="Pull request rows"]')
  assert.ok((await rows.evaluate((e) => e.clientHeight)) >= 100)
  await rows.evaluate((e) => {
    e.scrollTop = e.scrollHeight
  })
  await list.getByRole('button').filter({ hasText: 'Scroll regression 179' }).first().click()
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await bounded(content)
  await bounded(list)
  await bounded(page.locator('html'))
  await page.evaluate(() => {
    window.highlightFailures = 1
    window.detail.files = [
      {
        path: 'recovery.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1,2 @@\n old\n+recoverable change',
      },
    ]
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await detail.getByRole('tab', { name: 'Changes (1)', exact: true }).click()
  const retry = detail.getByRole('button', { name: 'Retry highlighting', exact: true })
  await retry.waitFor()
  await detail.locator('pre').filter({ hasText: 'recoverable change' }).waitFor()
  await retry.click()
  await retry.waitFor({ state: 'detached' })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('diffs-container')].some((element) =>
      element.shadowRoot?.textContent.includes('recoverable change'),
    ),
  )
  await bounded(content)
  assert.deepEqual(errors, [])
  console.log(
    'Real PR hook, Markdown and diff: bounded narrow/short layouts, separate tab scroll positions, preserved drafts/reviews, wrap preference, content-based parsing, and syntax failure fallback/retry passed.',
  )
} finally {
  await browser.close()
}
