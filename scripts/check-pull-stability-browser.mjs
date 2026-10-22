import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { checkPinRemoval } from './browser/pin-removal.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const uiDir = root + '/packages/studio-ui/src'
const controls =
  ['button', 'input', 'textarea', 'checkbox', 'badge', 'dialog']
    .map((name) => `export * from '${uiDir}/components/ui/${name}.tsx';`)
    .join('') +
  `export * from '${uiDir}/sidebar-header.tsx';export {ProjectIcon} from '${uiDir}/project-icon.tsx';export const OrganizeReview=()=>null;export {FileReviewControls,ReviewFiles} from '${uiDir}/review/file-review.tsx';export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {LineCommentForm} from '${uiDir}/line-comment-form.tsx';export const FormField=({label,children})=><label>{label}{children}</label>;export {MessageResponse} from '${uiDir}/components/ai-elements/message.tsx';`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export const useRepositorySources=()=>[];export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});export {useFileReview} from '${root}/packages/studio-core/src/review/use-file-review.ts';export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useDiffOptions=()=>({options:{theme:'dovo-dovo-dark',themeType:'dark',overflow:'wrap'},defaultSplit:false});export const useResolvedTheme=()=> 'dark';export const useAppPreferences=()=>({hideWhitespaceChanges:false,themePalette:'dovo',importedCodeThemes:[]});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto',importedCodeThemes:[]});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
  '../workspace/context':
    'export const useRepositorySources=()=>[];export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});',
  '@dovo/studio-core/state': `export * from '${root}/packages/studio-core/src/runtime/application-state.ts';`,
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,reader:window.source,pulls:window.pulls,error:window.pullError}],connected:window.store.connected,busy:false,refresh:()=>{},more:()=>{}});`,
  './pipeline-runs': `export const PullPipelineRuns=()=>null;`,
  '../list/start-task': `export const StartPullTask=()=> <button>New task</button>;`,
  './create': `export const CreatePull=()=>null;`,
  '../../connections/forge-connections': `export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[]});`,
  '../../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {pullFileFingerprint} from '@dovo/protocol';import {Effect} from 'effect';import {ApplicationStateProvider} from '@dovo/studio-core/state';import {createRoot} from 'react-dom/client';import {PullDetail} from '${root}/packages/extension-scm/src/pulls/detail/detail.tsx';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],checksState:'SUCCESS',reviewDecision:'REVIEW_REQUIRED',additions:24,deletions:8,commentCount:3,viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,url:'https://github.com/team/project/pull/8',title:'Other author',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false},{...pull,number:9,url:'https://github.com/team/project/pull/9',title:'Draft feature',draft:true,viewerIsAuthor:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={destination:'verified-project-account',pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',mergeable:true,reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'},{id:'review',kind:'review',author:'teammate',state:'APPROVED',body:'Looks good to me',url:pull.url,date:'2026-10-04'}],checks:[{name:'Tests',status:'SUCCESS',summary:'All tests passed',details:'2 tests completed'}],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>window.copied.push(value)}});window.store={connected:true,activeRuntimeId:'mac',workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};const cachedReads=window.savedReads=new Map();window.store.readCache={
read:async key=>cachedReads.get(key)??null,
write:async(key,value)=>cachedReads.set(key,{value:structuredClone(value),cachedAt:'2026-10-14'}),
remove:async key=>cachedReads.delete(key),
readEffect:key=>Effect.sync(()=>cachedReads.get(key)??null),
writeEffect:(key,value)=>Effect.sync(()=>{cachedReads.set(key,{value:structuredClone(value),cachedAt:'2026-10-14'})})
};window.detailReads=0;window.sectionReads=[];window.sectionReleases={};window.releaseSection=section=>{window.blockedSections=window.blockedSections.filter(value=>value!==section);for(const release of window.sectionReleases[section]??[])release();};window.store.requestEffect=(_path,input)=>Effect.tryPromise({try:async()=>{window.detailReads++;window.sectionReads.push(input.section);if(window.blockedSections?.includes(input.section))await new Promise(resolve=>(window.sectionReleases[input.section]??=[]).push(resolve));if(input.section===window.failedSection)throw new Error('Checks temporarily unavailable');const value=JSON.parse(JSON.stringify({...window.detail,pull:{...window.detail.pull,changedFiles:window.detail.files.length}}));if(input.section!=='changes')value.files=[];if(input.section!=='checks')value.checks=[];if(input.section!=='discussion')value.comments=[];return value;},catch:error=>error});const realRoot=createRoot(document.getElementById('app'));const rootView={render:element=>realRoot.render(<ApplicationStateProvider>{element}</ApplicationStateProvider>)};window.showLongList=()=>{window.pullError='Command failed: gh repo view '+('https://github.example/'+ 'long-repository-name'.repeat(70));window.source.repository.name='project-name'.repeat(40);window.pulls=Array.from({length:180},(_,i)=>({...pull,number:i+1,title:'Scroll regression '+i,url:'https://github.com/team/project/pull/'+(i+1)}));rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key="long-list"/></div></div></main></div></div>)};window.showEmbedded=()=>rootView.render(<main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main>);window.renderKey=0;window.showProbe=()=>rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><nav className="studio-navigation" style={{width:44}}/><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key={window.renderKey++}/></div></div></main></div></div>);
const originalRequest = window.store.request; const marks = new Map();
window.store.request = async (path, input, ...rest) => {
  if (!path.startsWith('/api/review/')) return originalRequest(path, input, ...rest);
  const files = window.detail.files.map(file => {
    const key = window.detail.pull.url + ':' + file.path, fingerprint = pullFileFingerprint(file, window.detail.pull);
    const prior = marks.get(key);
    const state = prior?.fingerprint === fingerprint ? prior : {path:file.path, fingerprint, viewed:false, version:(prior?.version??0)+1};
    marks.set(key,state); return state;
  });
  if (path.endsWith('/set')) { const file = files.find(file => file.path === input.path); if (!file || file.fingerprint !== input.fingerprint || file.version !== input.version) throw new Error('File changed'); Object.assign(file,{viewed:input.viewed,version:file.version+1}); }
  return {files:files.map(file=>({...file})), groups:[{label:'src',basis:'folder',paths:files.map(file=>file.path)}]};
};
window.showAnchored=()=>rootView.render(<main className="studio dark flex flex-col" style={{height:'100vh'}}><PullDetail key="anchored" repositoryId="repo" number={7} initialTab="changes" initialFragment="#anchor" onBack={()=>{}} onChanged={()=>{}}/></main>);window.showProbe();`,
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
            (await readFile(path, 'utf8'))
              .replace('parsePatchFiles }', 'parsePatchFiles as originalParsePatchFiles }')
              .replace(
                'onGutterUtilityClick: (range) => {',
                'onGutterUtilityClick: (window.inlineSelections ??= {})[file.path] = (range) => {',
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
  await checkPinRemoval(browser, 'file')
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
    window.detail.pull.headSha = 'e'.repeat(40)
    window.blockedSections = ['changes', 'checks', 'stack']
  })
  await open()
  await detail.getByText('Review workflow description', { exact: true }).waitFor()
  await detail.getByText('Loading stack…', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.sectionReads.includes('changes') || window.sectionReads.includes('checks'),
    ),
    false,
  )
  await detail.getByRole('tab', { name: 'Changes (2)', exact: true }).click()
  await detail.getByText('Loading files…', { exact: true }).waitFor()
  await page.evaluate(() => window.releaseSection('changes'))
  await detail.getByRole('navigation', { name: 'Changed files', exact: true }).waitFor()
  await page.evaluate(() => {
    window.failedSection = 'checks'
    window.releaseSection('checks')
  })
  await detail.getByRole('tab', { name: /^Checks/ }).click()
  await detail.getByRole('alert').filter({ hasText: 'Checks temporarily unavailable' }).waitFor()
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await detail.getByText('Review workflow description', { exact: true }).waitFor()
  await detail.getByRole('tab', { name: /^Checks/ }).click()
  await page.evaluate(() => {
    window.failedSection = undefined
  })
  await detail.getByRole('button', { name: 'Refresh checks', exact: true }).click()
  await detail.getByText('All tests passed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.releaseSection('stack')
    window.detail.pull.headSha = 'a'.repeat(40)
    window.savedReads.clear()
  })
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()

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
      document.querySelectorAll('diffs-container').length > 0 &&
      [...document.querySelectorAll('diffs-container')].every((e) =>
        e.shadowRoot?.querySelector('pre'),
      ),
  )
  assert.ok(
    (await page.evaluate(() => window.parseCount)) < 10,
    'offscreen files were parsed eagerly',
  )
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
  await page.waitForTimeout(250)
  const changesTop = await content.evaluate((e) => e.scrollTop)
  assert.ok(changesTop > 4000)
  const pinned = detail.getByLabel('Pinned file review controls', { exact: true })
  const pinnedBounds = await pinned.boundingBox()
  const contentBounds = await content.boundingBox()
  assert.ok(pinnedBounds && contentBounds)
  assert.ok(
    Math.abs(pinnedBounds.y - contentBounds.y) < 2,
    'File review controls must stay directly beneath the PR header while scrolling: ' +
      JSON.stringify({
        pinnedBounds,
        contentBounds,
        style: await pinned.evaluate((e) => ({
          position: getComputedStyle(e).position,
          top: getComputedStyle(e).top,
        })),
      }),
  )
  assert.ok(pinnedBounds.y + pinnedBounds.height <= contentBounds.y + contentBounds.height)
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  assert.equal(await content.evaluate((e) => e.scrollTop), 0)
  const form = detail.getByRole('form', { name: 'Add a pull request comment' }).getByRole('textbox')
  await form.fill('Keep my feedback')
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).click()
  assert.ok(Math.abs((await content.evaluate((e) => e.scrollTop)) - changesTop) < 2)
  await detail.getByRole('checkbox', { name: 'File viewed', exact: true }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Code changes"] [aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await page.waitForTimeout(250)
  const parsedBeforeRefresh = await page.evaluate(() => window.parseCount)
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => window.detailReads >= 2)
  await page.waitForTimeout(100)
  assert.equal(
    await page.evaluate(() => window.parseCount),
    parsedBeforeRefresh,
    'unchanged refresh reparsed patches',
  )
  await page.evaluate(() => {
    window.detail.files[0].patch += '\n+changed'
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction((count) => window.parseCount === count + 1, parsedBeforeRefresh)
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  assert.equal(await form.inputValue(), 'Keep my feedback')
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).click()
  await detail.getByText('0 of 30 viewed', { exact: true }).waitFor()

  // A push preserves the inline draft and original range, while blocking stale publication.
  await page.evaluate(() => {
    window.detail.capabilities.actions.push('inline-comment')
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.evaluate(() =>
    window.inlineSelections['src/file-0.txt']({ start: 2, end: 2, side: 'additions' }),
  )
  const inline = detail.getByRole('textbox', { name: 'Line comment', exact: true })
  await inline.fill('Keep my inline feedback across pushes')
  const preservedInlineForm = inline.locator('xpath=ancestor::form')
  await preservedInlineForm
    .getByRole('button', { name: 'Suggest code change', exact: true })
    .click()
  await preservedInlineForm
    .getByRole('textbox', { name: 'Suggested replacement', exact: true })
    .fill('suggested replacement survives')
  await page.evaluate(() => {
    window.store.connected = false
    window.showProbe()
  })
  await inline.waitFor()
  assert.equal(await inline.inputValue(), 'Keep my inline feedback across pushes')
  assert.equal(
    await preservedInlineForm
      .getByRole('textbox', { name: 'Suggested replacement', exact: true })
      .inputValue(),
    'suggested replacement survives',
  )
  assert.equal(
    await preservedInlineForm
      .getByRole('button', { name: 'Start agent task', exact: true })
      .isDisabled(),
    true,
  )
  await inline.fill('Edited while offline')
  await page.evaluate(() => {
    window.store.connected = true
    window.showProbe()
  })
  assert.equal(await inline.inputValue(), 'Edited while offline')
  // Leave the detail and return to the same owner/account/PR.
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await open()
  await detail.getByRole('tab', { name: 'Changes (30)', exact: true }).waitFor()
  assert.equal(await inline.inputValue(), 'Edited while offline')
  assert.equal(
    await preservedInlineForm
      .getByRole('textbox', { name: 'Suggested replacement', exact: true })
      .inputValue(),
    'suggested replacement survives',
  )
  await inline.fill('Keep my inline feedback across pushes')

  await page.evaluate(() => {
    window.detail.pull.headSha = 'b'.repeat(40)
    window.detail.files[0].patch = '@@ -1 +1,2 @@\n old\n+updated'
    window.detail.files[0].attributes = { binary: true, generated: false, vendored: false }
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await detail.getByRole('status').filter({ hasText: 'earlier PR revision' }).waitFor()
  assert.equal(await inline.inputValue(), 'Keep my inline feedback across pushes')
  const inlineForm = inline.locator('xpath=ancestor::form')
  await inlineForm.getByRole('button', { name: 'Comment destination', exact: true }).click()
  await page.getByRole('dialog').getByRole('option', { name: 'GitHub PR', exact: true }).click()
  await inlineForm.getByRole('button', { name: 'Post to GitHub', exact: true }).click()
  await inlineForm
    .getByRole('alert')
    .filter({ hasText: 'PR changed while you were writing' })
    .waitFor()
  assert.equal(
    await page.evaluate(
      () => window.writes.filter((write) => write.path === '/api/scm/pulls/comment').length,
    ),
    0,
  )
  assert.equal(await inline.inputValue(), 'Keep my inline feedback across pushes')
  await inlineForm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await detail
    .getByText('Text diff disabled by .gitattributes (binary or -diff).', { exact: true })
    .waitFor()

  await page.setViewportSize({ width: 768, height: 350 })
  await page.evaluate(() => {
    window.detail.pull.title = 'A long pull request title '.repeat(12)
    window.detail.refreshError = 'E'.repeat(180)
    window.detail.warnings = ['W'.repeat(180)]
    window.detail.checks = [{ name: 'C'.repeat(120), status: 'FAILURE', summary: 'Failure' }]
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => window.detailReads >= 4)
  await detail.getByRole('tab', { name: /^Checks(?: \(\d+\))?$/ }).click()
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
  await detail.getByRole('tab', { name: /^Checks(?: \(\d+\))?$/ }).click()
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
  // Real syntax rendering must color deletions too, including a rename across languages.
  await page.evaluate(() => {
    window.detail.files = [
      {
        path: 'new.tsx',
        previousPath: 'old.py',
        status: 'renamed',
        additions: 1,
        deletions: 1,
        patch:
          '@@ -1 +1 @@\n-def example(): return "old"\n+export const example = <div title="new" />;',
      },
    ]
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => {
    const pre = [...document.querySelectorAll('diffs-container')]
      .map((element) => element.shadowRoot?.querySelector('pre'))
      .find((element) => element?.textContent.includes('def example'))
    if (!pre) return false
    const tokens = [...pre.querySelectorAll('span')].filter((element) => !element.children.length)
    return ['def', 'export'].every((text) =>
      tokens.some(
        (element) =>
          element.textContent === text && getComputedStyle(element).color === 'rgb(124, 201, 255)',
      ),
    )
  })
  await page.evaluate(() => {
    window.detail.files = [
      {
        path: 'Card.tsx',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch:
          '@@ -1 +1 @@\n-export const before = <span title="old" />;\n+export const after = <span title="new" />;',
      },
    ]
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(() => {
    const pre = [...document.querySelectorAll('diffs-container')]
      .map((element) => element.shadowRoot?.querySelector('pre'))
      .find((element) => element?.textContent.includes('const before'))
    return (
      pre &&
      [...pre.querySelectorAll('span')].filter(
        (element) =>
          !element.children.length &&
          element.textContent === 'export' &&
          getComputedStyle(element).color === 'rgb(124, 201, 255)',
      ).length === 2
    )
  })
  // Start the independent large-PR fixture from the list; section remount now retains selection.
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  // Large PRs defer parsing; attribute-collapsed files and binary files never parse eagerly.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.detail.files = Array.from({ length: 120 }, (_, i) => ({
      path: 'src/lazy-' + i + '.txt',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1 +1,2 @@\n old\n+lazy change ' + i,
      attributes: { binary: i === 0, generated: i === 1, vendored: i === 2 },
    }))
    window.detail.pull.headSha = 'c'.repeat(40)
    window.detail.pull.title = 'Improve pull request reviews'
    window.pulls = [{ ...window.detail.pull }]
    window.parseCount = 0
    window.savedReads.clear()
    window.showProbe()
  })
  await open()
  await detail.getByRole('tab', { name: 'Changes (120)', exact: true }).click()
  await detail
    .getByText('Text diff disabled by .gitattributes (binary or -diff).', { exact: true })
    .waitFor()
  const generated = detail.locator('article').filter({ hasText: 'src/lazy-1.txt' })
  const vendored = detail.locator('article').filter({ hasText: 'src/lazy-2.txt' })
  assert.equal(await generated.locator('diffs-container').count(), 0)
  assert.equal(await vendored.locator('diffs-container').count(), 0)
  await page.waitForFunction(() => document.querySelectorAll('diffs-container').length > 0)
  assert.ok((await page.evaluate(() => window.parseCount)) < 12)
  await generated.getByRole('button', { name: 'Show changes', exact: true }).click()
  await generated.locator('diffs-container').waitFor()
  await generated.getByRole('button', { name: 'Hide changes', exact: true }).click()
  assert.equal(
    await generated.locator('diffs-container').count(),
    1,
    'collapse discarded mounted state',
  )
  await page.evaluate(() => {
    window.detail.files[1].attributes.generated = false
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await generated
    .getByRole('button', { name: 'Show changes', exact: true })
    .waitFor({ state: 'detached' })
  await generated.locator('diffs-container').waitFor({ state: 'visible' })
  await detail
    .getByRole('navigation', { name: 'Changed files', exact: true })
    .getByRole('button')
    .filter({ hasText: 'lazy-119.txt' })
    .click()
  const last = detail.locator('article').filter({ hasText: 'src/lazy-119.txt' })
  await last.locator('diffs-container').waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('diffs-container')].some((e) =>
      e.shadowRoot?.textContent.includes('lazy change 119'),
    ),
  )
  assert.ok(
    (await page.evaluate(() => window.parseCount)) < 40,
    'file navigation mounted the entire PR',
  )
  await bounded(content)
  // Reading the whole PR keeps a bounded diff window; an inline draft keeps its file mounted.
  const scrollContent = async (top) => {
    await content.evaluate((element, top) => {
      element.scrollTop = top
    }, top)
    await page.waitForTimeout(60)
  }
  const fileCard = (path) =>
    detail.locator('article').filter({ has: page.getByText(path, { exact: true }) })
  const mountedDiffs = () =>
    page.evaluate(() => document.querySelectorAll('diffs-container').length)
  let peakDiffs = 0
  const extent = await content.evaluate((element) => element.scrollHeight)
  for (let top = 0; top <= extent; top += 600) {
    await scrollContent(top)
    peakDiffs = Math.max(peakDiffs, await mountedDiffs())
  }
  assert.ok(peakDiffs < 45, `reading the PR mounted ${peakDiffs} diffs at once`)
  assert.equal(await fileCard('src/lazy-5.txt').locator('diffs-container').count(), 0)
  const draftFile = fileCard('src/lazy-10.txt')
  await draftFile.scrollIntoViewIfNeeded()
  await draftFile.locator('diffs-container').waitFor()
  await page.evaluate(() =>
    window.inlineSelections['src/lazy-10.txt']({ start: 2, end: 2, side: 'additions' }),
  )
  const draftInput = draftFile.getByRole('textbox', { name: 'Line comment', exact: true })
  await draftInput.fill('Draft that must survive distant scrolling')
  await page.evaluate(() => document.activeElement.blur())
  await scrollContent(await content.evaluate((element) => element.scrollHeight))
  await page.waitForTimeout(200)
  assert.equal(await draftFile.locator('diffs-container').count(), 1, 'draft file was released')
  assert.equal(await draftInput.inputValue(), 'Draft that must survive distant scrolling')
  await draftFile.scrollIntoViewIfNeeded()
  await draftFile.getByRole('button', { name: 'Cancel', exact: true }).click()
  await scrollContent(await content.evaluate((element) => element.scrollHeight))
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('article')].some(
        (article) =>
          article.textContent.includes('src/lazy-10.txt') &&
          article.querySelector('diffs-container'),
      ),
  )
  const releasedHeight = await content.evaluate((element) => element.scrollHeight)
  await scrollContent(0)
  await scrollContent(releasedHeight)
  assert.ok(
    Math.abs((await content.evaluate((element) => element.scrollHeight)) - releasedHeight) <= 2,
    'released diffs changed the scroll extent',
  )
  console.log(JSON.stringify({ prFiles: 120, peakMountedDiffs: peakDiffs }))
  await bounded(content)
  // A linked comment is an initial destination, not a command to jump back on every poll.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.savedReads.clear()
    window.detail.files = Array.from({ length: 12 }, (_, i) => ({
      path: 'src/review-' + i + '.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1 +1,2 @@\n old\n+new',
    }))
    delete window.detail.refreshError
    window.detail.warnings = []
    window.detail.comments = [
      {
        id: 'anchor',
        kind: 'inline',
        path: 'src/review-5.ts',
        body: 'Linked feedback',
        author: 'reviewer',
        url: window.detail.pull.url + '#anchor',
        date: '2026-10-04',
      },
    ]
    window.showAnchored()
  })
  await page
    .getByLabel('Changed file breakdown', { exact: true })
    .filter({ hasText: '12 normal files · 0 mocks · 0 tests' })
    .waitFor()
  const reviewControls = page.getByLabel('Pinned file review controls', { exact: true })
  await reviewControls.getByText('src/review-5.ts', { exact: true }).waitFor()
  await detail
    .getByRole('navigation', { name: 'Changed files', exact: true })
    .getByRole('button')
    .filter({ hasText: 'review-11.ts' })
    .click()
  await reviewControls.getByText('src/review-11.ts', { exact: true }).waitFor()
  await detail
    .locator('article')
    .filter({ hasText: 'src/review-11.ts' })
    .locator('diffs-container')
    .waitFor()
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label="Pull request content"]')
    const h = node.scrollHeight
    const last = window.lastExtent
    window.lastExtent = h
    return last === h
  })
  await page.evaluate(() => {
    window.scrollCalls = 0
    HTMLElement.prototype.scrollIntoView = function (...args) {
      window.scrollCalls++
      return Element.prototype.scrollIntoView.apply(this, args)
    }
    window.beforeRefresh = window.detailReads
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(
    () =>
      window.detailReads > window.beforeRefresh &&
      !document.querySelector('button[aria-label="Refresh details"]').disabled,
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.evaluate(() => window.scrollCalls),
    0,
    'Refreshing an anchored PR scrolled back to its original linked file',
  )
  await reviewControls.getByText('src/review-11.ts', { exact: true }).waitFor()
  // A push must retain the mounted file list and its position while the new diff is pending.
  await page.evaluate(() => {
    window.priorFile = [...document.querySelectorAll('article')].find(
      (element) => element.querySelector('span')?.textContent.trim() === 'src/review-11.ts',
    )
    window.priorScroll = document.querySelector('[aria-label="Pull request content"]').scrollTop
    window.blockedSections = ['changes']
    window.detail.pull.headSha = 'd'.repeat(40)
  })
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page
    .getByText('Updating files · showing the previous revision read-only.', { exact: true })
    .waitFor()
  await reviewControls.getByText('src/review-11.ts', { exact: true }).waitFor()
  assert.ok(
    await page.evaluate(() => !!window.priorFile),
    'The selected file was not mounted before the push',
  )
  assert.equal(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('article')].find(
          (element) => element.querySelector('span')?.textContent.trim() === 'src/review-11.ts',
        ) === window.priorFile,
    ),
    true,
  )
  assert.equal(
    await reviewControls.getByRole('checkbox', { name: 'File viewed' }).isDisabled(),
    true,
  )
  assert.ok(
    Math.abs(
      (await content.evaluate((element) => element.scrollTop)) -
        (await page.evaluate(() => window.priorScroll)),
    ) < 120,
    'A push collapsed the review scroll position: ' +
      JSON.stringify(
        await content.evaluate((element) => ({
          now: element.scrollTop,
          height: element.scrollHeight,
          prior: window.priorScroll,
        })),
      ),
  )
  await page.evaluate(() => window.releaseSection('changes'))
  await page
    .getByText('Updating files · showing the previous revision read-only.', { exact: true })
    .waitFor({ state: 'hidden' })
  await reviewControls.getByText('src/review-11.ts', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.scrollCalls),
    0,
    'A push replayed the original comment anchor',
  )
  if (process.env.DOVO_SCREENSHOT_DIR) {
    const directory = process.env.DOVO_SCREENSHOT_DIR
    await mkdir(directory, { recursive: true })
    await page.evaluate(() => {
      window.detail.warnings = []
      delete window.detail.refreshError
      window.pullError = ''
      window.source.repository.name = 'dovo-studio'
      window.detail.files = [
        {
          path: 'assets/app-icon.png',
          attributes: { binary: true, generated: false, vendored: false },
        },
        {
          path: 'src/generated/api-client.ts',
          attributes: { binary: false, generated: true, vendored: false },
        },
        {
          path: 'vendor/marked/index.js',
          attributes: { binary: false, generated: false, vendored: true },
        },
        {
          path: 'src/features/pulls/file-tree.tsx',
          attributes: { binary: false, generated: false, vendored: false },
        },
      ].map((file) => ({
        ...file,
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch:
          '@@ -1 +1 @@\n-export const lazyRendering = false\n+export const lazyRendering = true',
      }))
      window.showProbe()
    })
    await open()
    await detail.getByRole('tab', { name: 'Changes (4)', exact: true }).click()
    await detail.getByText('Generated file · marked in .gitattributes', { exact: true }).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('diffs-container')].some((element) =>
        element.shadowRoot?.querySelector('pre'),
      ),
    )
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${directory}/pr-diff-attributes.png` })
    await detail
      .locator('article')
      .filter({ hasText: 'src/generated/api-client.ts' })
      .getByRole('button', { name: 'Show changes', exact: true })
      .click()
    await page.waitForFunction(() => document.querySelectorAll('diffs-container').length >= 2)
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${directory}/pr-generated-file-expanded.png` })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Real PR hook, Markdown and diff: lazy parsing in a 120-file PR, attribute collapse/binary handling, direct navigation, bounded layouts, preserved drafts/reviews, wrap preference, and syntax failure fallback/retry passed.',
  )
} finally {
  await browser.close()
}
