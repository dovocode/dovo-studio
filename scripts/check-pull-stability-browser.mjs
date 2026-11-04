import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { checkPinRemoval } from './browser/pin-removal.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const uiDir = root + '/packages/studio-ui/src'
const controls =
  ['button', 'input', 'textarea', 'checkbox', 'badge', 'dialog', 'tooltip']
    .map((name) => `export * from '${uiDir}/components/ui/${name}.tsx';`)
    .join('') +
  `export {IconButton} from '${uiDir}/components/icon-button.tsx';export * from '${uiDir}/sidebar-header.tsx';export {ProjectIcon} from '${uiDir}/project-icon.tsx';export {ChangeSummary} from '${uiDir}/review/change-summary.tsx';export const OrganizeReview=()=>null;export {ChangeTypeFilters} from '${uiDir}/review/change-types.tsx';export {FileReviewControls,ReviewFiles} from '${uiDir}/review/file-review.tsx';export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {LineCommentForm} from '${uiDir}/line-comment-form.tsx';export const FormField=({label,children})=><label>{label}{children}</label>;export {MessageResponse} from '${uiDir}/components/ai-elements/message.tsx';`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export const useRepositorySources=()=>[];export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});export {useFileReview} from '${root}/packages/studio-core/src/review/use-file-review.ts';export {studioSyntaxTheme,studioThemeIds} from '${root}/packages/studio-core/src/themes.ts';export const useDiffOptions=()=>({options:{preferredHighlighter:'highlights',theme:'dovo-dovo-dark',themeType:'dark',overflow:'wrap'},defaultSplit:false});export const useResolvedTheme=()=> 'dark';export const useAppPreferences=()=>({hideWhitespaceChanges:false,themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto',importedCodeThemes:[],theme:'dark',themePalette:'dovo',codeTheme:'app'});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
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
    contents: `import {TooltipProvider} from '@dovo/studio-ui';import {pullFileFingerprint} from '@dovo/protocol';import {Effect} from 'effect';import {ApplicationStateProvider} from '@dovo/studio-core/state';import {createRoot} from 'react-dom/client';import {PullDetail} from '${root}/packages/extension-scm/src/pulls/detail/detail.tsx';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],checksState:'SUCCESS',reviewDecision:'REVIEW_REQUIRED',additions:24,deletions:8,commentCount:3,viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,url:'https://github.com/team/project/pull/8',title:'Other author',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false},{...pull,number:9,url:'https://github.com/team/project/pull/9',title:'Draft feature',draft:true,viewerIsAuthor:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={destination:'verified-project-account',pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',mergeable:true,reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'},{id:'review',kind:'review',author:'teammate',state:'APPROVED',body:'Looks good to me',url:pull.url,date:'2026-10-04'}],checks:[{name:'Tests',status:'SUCCESS',summary:'All tests passed',details:'2 tests completed'}],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>window.copied.push(value)}});window.store={connected:true,activeRuntimeId:'mac',runtimes:[],workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};window.cacheReads=[];const cachedReads=window.savedReads=new Map();window.store.readCache={
read:async key=>cachedReads.get(key)??null,
write:async(key,value)=>cachedReads.set(key,{value:structuredClone(value),cachedAt:'2026-10-14'}),
remove:async key=>cachedReads.delete(key),
readEffect:key=>Effect.sync(()=>{window.cacheReads.push(key);return cachedReads.get(key)??null}),
writeEffect:(key,value)=>Effect.sync(()=>{cachedReads.set(key,{value:structuredClone(value),cachedAt:'2026-10-14'})})
};window.detailReads=0;window.detailRequests=[];window.sectionReads=[];window.sectionReleases={};window.releaseSection=section=>{window.blockedSections=window.blockedSections.filter(value=>value!==section);for(const release of window.sectionReleases[section]??[])release();};window.store.requestEffect=(_path,input)=>Effect.tryPromise({try:async()=>{window.detailReads++;window.detailRequests.push(input);window.sectionReads.push(input.section);if(window.blockedSections?.includes(input.section))await new Promise(resolve=>(window.sectionReleases[input.section]??=[]).push(resolve));if(input.section===window.failedSection)throw new Error('Checks temporarily unavailable');const value=JSON.parse(JSON.stringify({...window.detail,pull:{...window.detail.pull,changedFiles:window.detail.files.length}}));if(input.section!=='changes')value.files=[];if(input.section!=='checks')value.checks=[];if(input.section!=='discussion')value.comments=[];return value;},catch:error=>error});const realRoot=createRoot(document.getElementById('app'));const rootView={render:element=>realRoot.render(<ApplicationStateProvider><TooltipProvider>{element}</TooltipProvider></ApplicationStateProvider>)};window.showLongList=()=>{window.pullError='Command failed: gh repo view '+('https://github.example/'+ 'long-repository-name'.repeat(70));window.source.repository.name='project-name'.repeat(40);window.pulls=Array.from({length:180},(_,i)=>({...pull,number:i+1,title:'Scroll regression '+i,url:'https://github.com/team/project/pull/'+(i+1)}));rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key="long-list"/></div></div></main></div></div>)};window.showEmbedded=()=>rootView.render(<main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main>);window.showLinked=task=>rootView.render(<main className="studio dark flex flex-col" style={{height:'100vh'}}><PullDetail key={'linked:'+task.title} repositoryId="repo" number={7} embedded linkedThread={{task,onAsk:text=>window.asked.push(text)}} onBack={()=>{}} onChanged={()=>{}}/></main>);window.asked=[];window.showStandalone=()=>rootView.render(<main className="studio dark flex flex-col" style={{height:'100vh'}}><PullDetail key={'standalone:'+window.renderKey++} repositoryId="repo" number={7} onBack={()=>{}} onChanged={()=>{}}/></main>);window.renderKey=0;window.showProbe=()=>rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><nav className="studio-navigation" style={{width:44}}/><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key={window.renderKey++}/></div></div></main></div></div>);
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
        b.onLoad({ filter: /pulls\/detail\/changes\.tsx$/ }, async ({ path }) => ({
          loader: 'tsx',
          contents:
            (await readFile(path, 'utf8')).replace(
              'pullFileFingerprint,',
              'pullFileFingerprint as originalFingerprint,',
            ) +
            '\nfunction pullFileFingerprint(...args){window.fingerprintCalls=(window.fingerprintCalls??0)+1;return originalFingerprint(...args)}',
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
  await page.clock.install()
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
  assert.equal(
    await page.evaluate(() =>
      window.cacheReads.some((key) => {
        const parts = JSON.parse(key)
        return parts[1] === 'detail-section' && ['changes', 'checks'].includes(parts[2])
      }),
    ),
    false,
    'Closed PR tabs must not hydrate unused sections from disk',
  )
  assert.equal(await detail.getByTestId('PR title').textContent(), 'Improve pull request reviews')
  await detail.getByRole('button', { name: 'View pull request files', exact: true }).click()
  assert.equal(
    await detail
      .getByRole('tab', { name: 'Changes (2)', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  assert.equal(await detail.getByTestId('PR title').isVisible(), true)
  await detail.getByText('Loading files…', { exact: true }).waitFor()
  await page.evaluate(() => window.releaseSection('changes'))
  await detail.getByRole('button', { name: /^2 files ·/ }).click()
  await detail.getByRole('navigation', { name: 'Changed files', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() =>
      window.cacheReads.some((key) => {
        const parts = JSON.parse(key)
        return parts[1] === 'detail-section' && parts[2] === 'changes'
      }),
    ),
    true,
    'Opening Changes starts its deferred cache read',
  )
  const pinnedReads = await page.evaluate(
    () => window.sectionReads.filter((x) => x === 'changes').length,
  )
  const fingerprintCalls = await page.evaluate(() => window.fingerprintCalls)
  assert.ok(fingerprintCalls >= 2)
  const overviewReads = await page.evaluate(
    () => window.sectionReads.filter((x) => x === 'overview').length,
  )
  await page.clock.fastForward(31000)
  await page.waitForFunction(
    (count) => window.sectionReads.filter((x) => x === 'overview').length > count,
    overviewReads,
  )
  assert.equal(
    await page.evaluate(() => window.sectionReads.filter((x) => x === 'changes').length),
    pinnedReads,
  )
  assert.equal(
    await page.evaluate(() => window.fingerprintCalls),
    fingerprintCalls,
    'Overview/status refreshes must not rehash every unchanged patch',
  )
  await detail.getByRole('button', { name: 'Refresh details', exact: true }).click()
  await page.waitForFunction(
    (count) => window.sectionReads.filter((x) => x === 'changes').length > count,
    pinnedReads,
  )
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
  const resizeReads = await page.evaluate(() => window.detailReads)
  for (const width of [950, 700, 1050, 400, 1440, 650, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(300)
  const settledParses = await page.evaluate(() => window.parseCount)
  await page.waitForTimeout(500)
  assert.equal(
    await page.evaluate(() => window.parseCount),
    settledParses,
    'PR diffs keep remounting after resizing',
  )
  assert.equal(
    await page.evaluate(() => window.detailReads),
    resizeReads,
    'Resizing refetched PR sections',
  )
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
  await detail.getByRole('button', { name: '30 files · 0 viewed', exact: true }).waitFor()

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
  await preservedInlineForm
    .getByRole('status')
    .filter({ hasText: 'Offline · your draft is preserved. Connect to submit.' })
    .waitFor()
  await inline.waitFor()
  assert.equal(await inline.inputValue(), 'Keep my inline feedback across pushes')
  assert.equal(
    await preservedInlineForm
      .getByRole('textbox', { name: 'Suggested replacement', exact: true })
      .inputValue(),
    'suggested replacement survives',
  )
  assert.equal(
    await preservedInlineForm.getByRole('button', { name: 'Ask agent…', exact: true }).isDisabled(),
    true,
  )
  await inline.fill('Edited while offline')
  await page.evaluate(() => {
    window.store.connected = true
    window.showProbe()
  })
  await preservedInlineForm.getByRole('status').waitFor({ state: 'hidden' })
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
  const rowsHeight = await rows.evaluate((element) => element.clientHeight)
  assert.ok(rowsHeight >= 100, `Short-window PR rows retain a usable viewport: ${rowsHeight}px`)
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
          element.textContent.trim().split(/\s+/).includes(text) &&
          getComputedStyle(element).color === 'rgb(124, 201, 255)',
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
          element.textContent.trim().split(/\s+/).includes('export') &&
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
  await detail.getByRole('button', { name: /^120 files ·/ }).click()
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
      path: i === 0 ? 'docs/review.md' : 'src/review-' + i + '.ts',
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
  await page.getByRole('button', { name: /^12 files ·/ }).click()
  await page.getByLabel('Changed file breakdown', { exact: true }).waitFor()
  const reviewControls = page.getByLabel('Pinned file review controls', { exact: true })
  await reviewControls.getByText('src/review-5.ts', { exact: true }).waitFor()
  const types = page.getByLabel('Changed file breakdown', { exact: true })
  await types.getByRole('button', { name: 'Filter Docs: 1 files', exact: true }).click()
  assert.equal(
    await page
      .getByRole('region', { name: 'Code changes', exact: true })
      .locator('article')
      .count(),
    1,
  )
  await types.getByRole('button', { name: 'Filter Docs: 1 files', exact: true }).click()

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
  await page.evaluate(() => {
    window.blockedSections = []
    window.failedSection = ''
    window.highlightFailures = 0
    window.detail.warnings = []
    window.detail.pull.headSha = 'd'.repeat(40)
    window.detail.files = [
      {
        path: 'src/large.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        patch:
          '@@ -1 +1,2 @@\n-old\n+' +
          'x'.repeat(70000) +
          '\n+export const recoveredLargeDiff = true;',
      },
    ]
    window.showProbe()
  })
  await open()
  await detail.getByRole('tab', { name: 'Changes (1)', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('diffs-container')].some((element) =>
      element.shadowRoot?.querySelector('pre')?.textContent.includes('recoveredLargeDiff'),
    ),
  )
  // Only a thread that explicitly links this PR receives agent feedback. Other threads keep the
  // normal new-task workflow, and nothing is sent automatically.
  await page.evaluate(() => {
    window.detail.pull.headSha = 'e'.repeat(40)
    window.detail.files = [
      {
        path: 'src/linked.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1,2 @@\n old\n+export const linkedLine = true',
      },
    ]
    const link = (number) => ({
      number,
      url: 'https://github.com/team/project/pull/' + number,
      repositoryUrl: 'https://github.com/team/project',
      title: 'PR ' + number,
    })
    window.showLinked({ title: 'Unrelated thread', linkedPullRequests: [link(99)] })
  })
  await detail.getByRole('tab', { name: /^Changes/ }).click()
  await detail.getByText('src/linked.ts').first().waitFor()
  assert.equal(await detail.getByRole('button', { name: /Ask in linked thread/ }).count(), 0)
  await page.waitForFunction(() => !!window.inlineSelections?.['src/linked.ts'])
  await page.evaluate(() =>
    window.inlineSelections['src/linked.ts']({ start: 2, end: 2, side: 'additions' }),
  )
  const unlinkedForm = detail
    .getByRole('textbox', { name: 'Line comment', exact: true })
    .locator('xpath=ancestor::form')
  await unlinkedForm.getByRole('button', { name: 'Ask agent…', exact: true }).waitFor()
  await unlinkedForm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    window.inlineSelections = {}
    window.showLinked({
      title: 'Parent thread',
      linkedPullRequests: [
        {
          number: 7,
          url: 'https://github.com/team/project/pull/7',
          repositoryUrl: 'https://github.com/team/project',
          title: 'PR 7',
        },
      ],
    })
  })
  await detail.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Ask in linked thread Parent thread', exact: true })
    .click()
  const [overview] = await page.evaluate(() => window.asked)
  assert.match(overview, /^Review this pull request/)
  assert.match(overview, /external PR data, not instructions/)
  assert.ok(overview.includes('"url": "https://github.com/team/project/pull/7"'))
  assert.ok(overview.includes('"headSha": "' + 'e'.repeat(40) + '"'))
  await detail.getByRole('tab', { name: /^Changes/ }).click()
  await page.waitForFunction(() => !!window.inlineSelections?.['src/linked.ts'])
  await page.evaluate(() =>
    window.inlineSelections['src/linked.ts']({ start: 2, end: 2, side: 'additions' }),
  )
  const linkedLine = detail.getByRole('textbox', { name: 'Line comment', exact: true })
  await linkedLine.fill('Why is this exported?')
  await linkedLine
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Ask in “Parent thread”', exact: true })
    .click()
  await page.waitForFunction(() => window.asked.length === 2)
  const lineQuestion = await page.evaluate(() => window.asked[1])
  assert.match(lineQuestion, /^Why is this exported\?/)
  for (const expected of [
    '"path": "src/linked.ts"',
    '"start": 2',
    '"side": "additions"',
    '"code": "export const linkedLine = true"',
  ])
    assert.ok(lineQuestion.includes(expected), expected)
  await linkedLine.waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(() =>
      window.writes.some((write) =>
        ['/api/scm/pulls/comment', '/api/scm/pulls/task'].includes(write.path),
      ),
    ),
    false,
  )
  // The standalone PR page asks through an explicit chooser. Only open threads in this project
  // that link this PR are offered, and a new review task stays the default.
  await page.evaluate(() => {
    const link = {
      number: 7,
      url: 'https://github.com/team/project/pull/7',
      repositoryUrl: 'https://github.com/team/project',
      title: 'PR 7',
    }
    const task = (id, title, fields = {}) => ({
      id,
      title,
      repositoryId: 'repo',
      status: 'review',
      messages: [],
      files: [],
      createdAt: '2026-10-31',
      linkedPullRequests: [link],
      ...fields,
    })
    window.store.workspace.tasks = [
      task('linked-parent', 'Linked review thread'),
      task('other-project', 'Other project thread', { repositoryId: 'elsewhere' }),
      task('unlinked', 'Unlinked thread', { linkedPullRequests: [] }),
      task('side', 'Existing side chat', { sideThread: { parentTaskId: 'linked-parent' } }),
      task('archived', 'Archived thread', { archivedAt: '2026-10-30' }),
    ]
    window.store.runtimeRegistry = { activeId: 'mac' }
    const original = window.store.request
    window.store.request = async (path, input, ...rest) => {
      if (path === '/api/tasks/side-thread/create' || path === '/api/scm/pulls/task') {
        window.writes.push({ path, input })
        if (window.delayReview) {
          window.delayReview = false
          await new Promise((resolve) => {
            window.releaseReview = resolve
          })
        }
        return { id: path === '/api/scm/pulls/task' ? 'review-task' : input.childId }
      }
      return original(path, input, ...rest)
    }
    window.prNavigations = []
    window.inlineSelections = {}
    window.showStandalone()
  })
  const ask = page.getByRole('dialog', { name: 'Ask agent about this PR' })
  await detail.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ask agent about this PR', exact: true }).click()
  await ask.waitFor()
  const choices = await ask.locator('label').allTextContents()
  assert.equal(choices.length, 2, choices.join(' | '))
  assert.match(choices[0], /^New review task/)
  assert.match(choices[1], /^Linked review thread/)
  assert.equal(await ask.getByRole('radio', { name: /New review task/ }).isChecked(), true)
  await ask.getByRole('radio', { name: /Linked review thread/ }).check()
  await ask.getByRole('textbox', { name: 'Question for the agent' }).fill('Is this safe to merge?')
  await ask.getByRole('button', { name: 'Create side chat draft', exact: true }).click()
  await ask.waitFor({ state: 'detached' })
  const sideCreate = await page.evaluate(() =>
    window.writes.findLast((write) => write.path === '/api/tasks/side-thread/create'),
  )
  assert.equal(sideCreate.input.id, 'linked-parent')
  assert.match(sideCreate.input.childId, /^[0-9a-f-]{36}$/)
  assert.match(sideCreate.input.objective, /^Is this safe to merge\?/)
  assert.match(sideCreate.input.objective, /external PR data, not instructions/)
  const [toSide] = await page.evaluate(() => window.prNavigations)
  assert.equal(toSide.viewId, 'tasks')
  assert.equal(toSide.entityId, sideCreate.input.childId)
  assert.deepEqual(toSide.pullTarget, {
    runtimeId: 'mac',
    repositoryId: 'repo',
    number: 7,
    url: 'https://github.com/team/project/pull/7',
    tab: 'overview',
  })
  // Line feedback opens the same chooser with its selection; the inline draft is kept.
  await detail.getByRole('tab', { name: /^Changes/ }).click()
  await page.waitForFunction(() => !!window.inlineSelections?.['src/linked.ts'])
  await page.evaluate(() =>
    window.inlineSelections['src/linked.ts']({ start: 2, end: 2, side: 'additions' }),
  )
  const standaloneLine = detail.getByRole('textbox', { name: 'Line comment', exact: true })
  await standaloneLine.fill('Why is this exported?')
  await standaloneLine
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Ask agent…', exact: true })
    .click()
  await ask.waitFor()
  assert.equal(
    await ask.getByRole('textbox', { name: 'Question for the agent' }).inputValue(),
    'Why is this exported?',
  )
  await ask.getByText(/src\/linked\.ts:2/).waitFor()
  await ask.getByRole('button', { name: 'Create review task', exact: true }).click()
  await ask.waitFor({ state: 'detached' })
  const review = await page.evaluate(() =>
    window.writes.findLast((write) => write.path === '/api/scm/pulls/task'),
  )
  assert.equal(review.input.repositoryId, 'repo')
  assert.equal(review.input.headSha, 'e'.repeat(40))
  assert.equal(review.input.checkoutMode, 'new-branch')
  assert.equal(review.input.run, false)
  for (const expected of ['"path": "src/linked.ts"', '"code": "export const linkedLine = true"'])
    assert.ok(review.input.objective.includes(expected), expected)
  const toReview = await page.evaluate(() => window.prNavigations[1])
  assert.equal(toReview.entityId, 'review-task')
  assert.equal(toReview.pullTarget.tab, 'changes')
  assert.equal(await standaloneLine.inputValue(), 'Why is this exported?')
  assert.doesNotMatch(await detail.innerText(), /showing cached|Last fetched/i)
  const refreshWith = async (change) => {
    const before = await page.evaluate(() => window.detailRequests.length)
    await page.evaluate((change) => {
      const detail = window.detail
      if (change.headSha) detail.pull.headSha = change.headSha
      if (change.destination) detail.destination = change.destination
      if (change.changedPath)
        detail.files = detail.files.map((file) =>
          file.path === change.changedPath
            ? { ...file, patch: `${file.patch}\n+export const added = true` }
            : file,
        )
      if (change.removedPath)
        detail.files = detail.files.filter((file) => file.path !== change.removedPath)
      window.dispatchEvent(new Event('focus'))
    }, change)
    await page.waitForFunction((before) => window.detailRequests.length > before, before)
  }
  const question = ask.getByRole('textbox', { name: 'Question for the agent' })
  const latest = ask.getByRole('button', { name: 'Use latest revision', exact: true })
  const createReview = ask.getByRole('button', { name: 'Create review task', exact: true })
  // A newer push of the same PR keeps the question; the revision only changes on request, and a
  // line selection whose file changed falls back to the whole file.
  await standaloneLine
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Ask agent…', exact: true })
    .click()
  await ask.waitFor()
  await ask.getByText(/src\/linked\.ts:2/).waitFor()
  await refreshWith({ headSha: 'f'.repeat(40), changedPath: 'src/linked.ts' })
  await ask.getByText(/This PR was updated to ffffffff/).waitFor()
  assert.equal(await createReview.isDisabled(), true)
  assert.equal(await question.inputValue(), 'Why is this exported?')
  await latest.click()
  await ask.getByText(/src\/linked\.ts changed in the latest revision/).waitFor()
  await ask.getByText(/PR #7 · ffffffff · src\/linked\.ts\./).waitFor()
  assert.equal(await question.inputValue(), 'Why is this exported?')
  // A selected file that later leaves the PR asks about the whole PR instead.
  await refreshWith({ headSha: '1'.repeat(40), removedPath: 'src/linked.ts' })
  await ask.getByText(/This PR was updated to 11111111/).waitFor()
  await latest.click()
  await ask.getByText(/src\/linked\.ts is not part of the latest revision/).waitFor()
  await question.fill('Is the removal intended?')
  await createReview.click()
  await ask.waitFor({ state: 'detached' })
  const wholePull = await page.evaluate(() =>
    window.writes.findLast((write) => write.path === '/api/scm/pulls/task'),
  )
  assert.equal(wholePull.input.headSha, '1'.repeat(40))
  assert.match(wholePull.input.objective, /^Is the removal intended\?/)
  assert.ok(!wholePull.input.objective.includes('"selection"'), 'Removed file stayed selected')
  // A push while creation is in flight cannot navigate to a draft bound to the old revision.
  await detail.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ask agent about this PR', exact: true }).click()
  await ask.waitFor()
  await question.fill('Keep this question through the push')
  const navigationsBeforePush = await page.evaluate(() => {
    window.delayReview = true
    return window.prNavigations.length
  })
  await createReview.click()
  await page.waitForFunction(() => typeof window.releaseReview === 'function')
  await refreshWith({ headSha: '2'.repeat(40) })
  await ask.getByText(/This PR was updated to 22222222/).waitFor()
  await page.evaluate(() => window.releaseReview())
  await createReview.waitFor()
  assert.equal(await page.evaluate(() => window.prNavigations.length), navigationsBeforePush)
  assert.equal(await question.inputValue(), 'Keep this question through the push')
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click()
  // A different account or destination is never adopted silently.
  await detail.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ask agent about this PR', exact: true }).click()
  await ask.waitFor()
  await refreshWith({ destination: 'another-account' })
  await ask.getByText('The PR source changed. Close and reopen this review action.').waitFor()
  assert.equal(await createReview.isDisabled(), true)
  assert.equal(await latest.count(), 0)
  assert.equal(await page.evaluate(() => window.detailRequests.at(-1).refresh), true)
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(
    'Standalone PR Ask agent chooser (linked side chat or new review task, opening the task with its PR, recovering a newer push of the same PR on request while keeping the question and checking the selection, and refusing a changed source), linked-thread PR handoff with bounded review context, unlinked new-task fallback, real PR hook, Markdown and diff: lazy parsing in a 120-file PR, attribute collapse/binary handling, direct navigation, bounded layouts, preserved drafts/reviews, wrap preference, and syntax failure fallback/retry passed.',
  )
} finally {
  await browser.close()
}
