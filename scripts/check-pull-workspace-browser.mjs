import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const uiDir = root + '/packages/studio-ui/src'
const controls =
  ['button', 'input', 'textarea', 'checkbox', 'badge', 'dialog', 'tooltip']
    .map((name) => `export * from '${uiDir}/components/ui/${name}.tsx';`)
    .join('') +
  `export {ProjectIcon} from '${uiDir}/project-icon.tsx';export * from '${uiDir}/sidebar-header.tsx';export const OrganizeReview=()=>null;export {ChangeTypeFilters} from '${uiDir}/review/change-types.tsx';export {FileReviewControls,ReviewFiles} from '${uiDir}/review/file-review.tsx';export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const FormField=({label,children})=><label>{label}{children}</label>;export const MessageResponse=({children})=><div>{children}</div>;`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({appInfo:{channel:'nightly'},navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});export {useFileReview} from '${root}/packages/studio-core/src/review/use-file-review.ts';export const useAppPreferences=()=>({hideWhitespaceChanges:false});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto',importedCodeThemes:[],theme:'dark',themePalette:'dovo',codeTheme:'app'});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
  '../workspace/context': `export const useWorkspace=()=>window.store;export const useStudioHost=()=>({appInfo:{channel:'nightly'},navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,reader:window.source,pulls:window.pulls,error:window.pullError}],connected:window.store.connected,busy:false,refresh:()=>{},more:()=>{}});`,
  './use-pull-detail': `export const usePullDetail=()=>({sections:Object.fromEntries(['overview','status','discussion','changes','checks','stack'].map(key=>[key,{ready:true,detail:window.detail,refresh:()=>{}}])),detail:window.detail,readConnected:window.store.connected,error:'',busy:false,refresh:()=>{},invalidate:()=>{}});`,
  './patch': `export const emptyPullLineDraft={selection:null,destination:'agent'};export const PullPatch=({file})=><pre>{file.patch}</pre>;`,
  './pipeline-runs': `export const PullPipelineRuns=()=>null;`,
  '../list/start-task': `export const StartPullTask=()=> <button>New task</button>;`,
  './create': `export const CreatePull=()=>null;`,
  '../../connections/forge-connections': `export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[],loading:false,error:''});`,
  '../../connections/source-picker': `export const SourcePicker=()=>null;`,
}
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {TitleBar} from '${root}/packages/studio-shell/src/title-bar.tsx';import {SidebarHeaderLayout,HeaderFallback,TooltipProvider} from '@dovo/studio-ui';import {pullFileFingerprint,pullOverviewStacks} from '@dovo/protocol';import {createRoot} from 'react-dom/client';import {PullDetail} from '${root}/packages/extension-scm/src/pulls/detail/detail.tsx';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';
const pull={number:7,title:'Improve pull request reviews',url:'https://github.com/team/project/pull/7',state:'open',draft:false,author:'dominic',authorAvatarUrl:'https://avatars.example/dominic.png',updatedAt:'2026-10-04',head:'feature',base:'main',labels:['feature'],checksState:'SUCCESS',reviewDecision:'REVIEW_REQUIRED',additions:24,deletions:8,commentCount:3,viewerIsAuthor:true,viewerIsAssigned:true,viewerIsInvolved:true,viewerReviewRequested:true};
window.pulls=[pull,{...pull,number:8,url:'https://github.com/team/project/pull/8',title:'Other author',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerIsAuthor:false,viewerIsAssigned:false,viewerReviewRequested:false},{...pull,number:9,url:'https://github.com/team/project/pull/9',title:'Draft feature',draft:true,viewerIsAuthor:false,viewerReviewRequested:false}];
window.source={key:'repo',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project'}};
window.detail={pull:{...pull,body:'Review workflow description',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',mergeable:true,reviewers:['reviewer'],assignees:['dominic'],additions:2,deletions:0,changedFiles:2},files:['src/first.ts','src/second.ts'].map(path=>({path,status:'modified',additions:1,deletions:0,patch:'@@ -1 +1,2 @@\\n old\\n+new'})),comments:[{id:'comment',kind:'comment',author:'reviewer',body:'Please add a test',url:pull.url,date:'2026-10-04'},{id:'review',kind:'review',author:'teammate',state:'APPROVED',body:'Looks good to me',url:pull.url,date:'2026-10-04'}],checks:[{name:'Tests',status:'SUCCESS',summary:'All tests passed',details:'2 tests completed'}],warnings:[],capabilities:{actions:['comment','review'],reviewDecisions:['comment','approve','request-changes'],mergeMethods:[]}};
window.writes=[];window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>window.copied.push(value)}});window.store={connected:true,activeRuntimeId:'mac',runtimes:[],workspace:{repositories:[window.source.repository],tasks:[]},switchRuntime:async()=>{},request:async(path,input)=>{window.writes.push({path,input});return {status:'updated'}}};const originalRequest = window.store.request; const marks = new Map();
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
const rootView=createRoot(document.getElementById('app'));window.showBasicList=(complete=true,native=false)=>{window.pullError=undefined;window.source.repository.name='Project';const basic={number:7,title:'Base change',url:pull.url,state:'open',draft:false,author:pull.author,authorAvatarUrl:pull.authorAvatarUrl,updatedAt:pull.updatedAt,head:'feature',base:'main',labels:[]};window.pulls=[basic,{...basic,number:8,url:'https://github.com/team/project/pull/8',title:'Dependent change',head:'child',base:'feature'}];if(native)window.pulls=[{...window.pulls[1],stack:{nativeId:99,nativeNumber:12,position:3,size:5,baseRef:'main',complete:false}}];window.pulls=pullOverviewStacks(window.pulls,complete);rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><View key={'basic-'+complete+'-'+native}/></main></div></div>)};window.showLongList=()=>{window.pullError='Command failed: gh repo view '+('https://github.example/'+ 'long-repository-name'.repeat(70));window.source.repository.name='project-name'.repeat(40);window.pulls=Array.from({length:180},(_,i)=>({...pull,number:i+1,title:'Scroll regression '+i,url:'https://github.com/team/project/pull/'+(i+1)}));rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key="long-list"/></div></div></main></div></div>)};window.showDestination=(tab,fragment)=>rootView.render(<main className="studio flex flex-col" style={{height:'100vh'}}><PullDetail key={tab+fragment} repositoryId="repo" number={7} initialTab={tab} initialFragment={fragment} onBack={()=>{}} onChanged={()=>{}}/></main>);window.showEmbedded=()=>rootView.render(<main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main>);rootView.render(<TooltipProvider><SidebarHeaderLayout brand={<TitleBar sidebar platform="darwin" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>}><div className="studio dark" data-platform="darwin"><HeaderFallback><TitleBar platform="darwin" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/></HeaderFallback><div className="studio-body"><nav className="studio-navigation" aria-label="Main navigation"/><main className="studio-main"><View/></main></div></div></SidebarHeaderLayout></TooltipProvider>);`,
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
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://avatars.example/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#417daa"/><text x="10" y="14" text-anchor="middle" font-size="12" fill="white">D</text></svg>',
    }),
  )
  await page.setContent('<div id="app"></div>')
  const assets = root + '/apps/desktop/dist/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  if (process.env.DOVO_BROWSER_STYLE_PATH)
    await page.addStyleTag({ content: await readFile(process.env.DOVO_BROWSER_STYLE_PATH, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const list = page.getByRole('navigation', { name: 'Pull request sidebar' })
  const row = (title) => list.getByRole('button').filter({ hasText: title }).first()
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
  const fullWidthList = async () =>
    assert.equal(
      await list.evaluate(
        (element) =>
          Math.abs(
            element.getBoundingClientRect().width -
              element.parentElement.getBoundingClientRect().width,
          ) < 2,
      ),
      true,
    )
  const filterToggle = list.getByRole('button', { name: 'Filters', exact: true })
  assert.equal(await filterToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await list.getByRole('textbox', { name: 'Search pull requests' }).isVisible(), true)
  for (const name of ['PR repository', 'PR state', 'PR sort', 'PR draft status'])
    assert.equal(await list.getByRole('button', { name, exact: true }).isVisible(), false)
  await list.getByRole('button', { name: 'Authored by me', exact: true }).waitFor()
  assert.equal(await list.getByText(/loaded pull requests?/).count(), 0)
  const avatar = row('Improve pull request reviews').locator('img')
  assert.equal(await avatar.getAttribute('src'), 'https://avatars.example/dominic.png')
  await avatar.evaluate((element) => element.decode())
  await page.screenshot({ path: '/tmp/dovo-pull-list-clean.png' })
  // Failed profile images retain a compact author initial without breaking the row.
  await avatar.dispatchEvent('error')
  assert.equal(await row('Improve pull request reviews').locator('img').count(), 0)
  assert.equal(
    await row('Improve pull request reviews')
      .locator('span[aria-hidden][title="dominic"]')
      .innerText(),
    'D',
  )
  await filterToggle.click()
  await page.getByRole('textbox', { name: 'Search pull requests' }).waitFor()
  for (const name of [
    'PR repository',
    'PR state',
    'PR sort',
    'Refresh pull requests',
    'Create pull request',
  ])
    await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' })
  await fullWidthList()
  await noOverflow()
  assert.equal(
    await row('Improve pull request reviews').evaluate((element) => element.clientHeight < 90),
    true,
  )
  await page.screenshot({ path: '/tmp/dovo-pull-list.png' })
  await list.getByRole('button', { name: 'Actions for PR #7', exact: true }).click()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Open in browser', exact: true }).getAttribute('href'),
    'https://github.com/team/project/pull/7',
  )
  await page.getByRole('menuitem', { name: 'Copy PR link', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.copied), [
    'https://github.com/team/project/pull/7',
  ])
  assert.equal(await page.locator('[aria-label="Pull request details"]').count(), 0)
  await row('Improve pull request reviews').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open PR details', exact: true }).waitFor()
  assert.equal(await page.locator('[aria-label="Pull request details"]').count(), 0)
  await page.keyboard.press('Escape')
  await row('Improve pull request reviews').click({ modifiers: ['ControlOrMeta'] })
  await row('Other author').click({ modifiers: ['Shift'] })
  await page.getByText('2 PRs selected', { exact: true }).waitFor()
  await list.getByRole('button', { name: 'Actions for PR #7', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add to thread (2 PRs)', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await row('Improve pull request reviews').focus()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByText('2 PRs selected', { exact: true }).count(), 0)
  const search = list.getByRole('textbox', { name: 'Search pull requests' })
  await search.fill('Other author')
  assert.equal(await row('Improve pull request reviews').count(), 0)
  await row('Other author').waitFor()
  await filterToggle.click()
  assert.equal(await search.isVisible(), true)
  assert.match(await filterToggle.innerText(), /1/)
  assert.equal(await row('Improve pull request reviews').count(), 0)
  await filterToggle.click()
  assert.equal(await search.inputValue(), 'Other author')
  await search.fill('')
  await list.getByRole('button', { name: 'PR draft status', exact: true }).click()
  await page.getByRole('option', { name: 'Drafts', exact: true }).click()
  assert.equal(await row('Other author').count(), 0)
  await row('Draft feature').waitFor()
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  assert.match(await list.getByRole('button', { name: 'Filters', exact: true }).innerText(), /1/)
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  await list.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await list.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Authored by me', exact: true }).click()
  assert.equal(await page.getByRole('button').filter({ hasText: 'Other author' }).count(), 0)
  await page.getByRole('button').filter({ hasText: 'Improve pull request reviews' }).first().click()
  await page.getByText('Review workflow description', { exact: true }).waitFor()
  await page.getByText('Please add a test', { exact: true }).waitFor()
  const detail = page.locator('[aria-label="Pull request details"]')
  const content = detail.locator('[aria-label="Pull request content"]')
  const heading = detail.getByRole('heading', { name: /Improve pull request reviews/ })
  assert.equal(await list.evaluate((element) => element.clientWidth <= 416), true)
  await detail
    .locator('[aria-label="Pull request status"]')
    .getByText('No merge conflicts', { exact: true })
    .waitFor()
  assert.equal(
    (await detail.locator('.studio-pull-header').boundingBox()).y,
    (await page.locator('.studio-titlebar').boundingBox()).y,
    'PR and sidebar branding share one row',
  )
  await page.screenshot({ path: '/tmp/dovo-pull-overview.png' })
  await detail.getByRole('button', { name: 'Reviews 1', exact: true }).click()
  assert.equal(await detail.getByText('Please add a test', { exact: true }).isVisible(), false)
  await detail.getByText('Looks good to me', { exact: true }).waitFor()
  await detail.getByRole('button', { name: 'All activity 2', exact: true }).click()
  const form = page.getByRole('form', { name: 'Add a pull request comment' })
  await form.getByRole('textbox').fill('Draft feedback')
  const headingTop = await heading.evaluate((element) => element.getBoundingClientRect().top)
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  assert.equal(await heading.evaluate((element) => element.getBoundingClientRect().top), headingTop)
  await detail.getByRole('button', { name: 'View pull request checks', exact: true }).click()
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).waitFor()
  assert.equal(
    await detail
      .getByRole('tab', { name: 'Checks (1)', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await detail.getByText('All tests passed', { exact: true }).waitFor()
  await detail.getByText('Check output', { exact: true }).click()
  await detail.getByText('2 tests completed', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-pull-checks.png' })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).press('Home')
  assert.equal(
    await detail.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  assert.equal(await form.getByRole('textbox').inputValue(), 'Draft feedback')
  await page.getByRole('tab', { name: /Changes/ }).click()
  await page.locator('[aria-label="Code changes"] article').first().waitFor()
  assert.equal(await page.locator('[aria-label="Code changes"] article').count(), 2)
  await page.getByRole('checkbox', { name: 'File viewed', exact: true }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Code changes"] [aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await page.getByText('1 of 2 viewed', { exact: true }).waitFor()
  assert.equal(await heading.isVisible(), true)
  await page
    .getByRole('navigation', { name: 'Changed files' })
    .getByRole('button', { name: /second.ts/ })
    .click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('radio', { name: /Approve merging/ }).check()
  await page.getByRole('dialog').getByRole('textbox', { name: 'PR action body' }).fill('Looks good')
  await page.getByRole('dialog').getByRole('button', { name: 'Submit review', exact: true }).click()
  assert.equal((await page.evaluate(() => window.writes[0])).input.event, 'approve')
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  await form.getByRole('textbox').fill('Feedback')
  await form.getByRole('button', { name: 'Bold', exact: true }).click()
  await form.getByRole('button', { name: 'Preview', exact: true }).click()
  await form.getByText(/\*\*text\*\*/).waitFor()
  await form.getByRole('button', { name: 'Comment', exact: true }).click()
  assert.equal((await page.evaluate(() => window.writes.at(-1))).input.action, 'comment')
  await page.evaluate(() => {
    window.detail.capabilities = {
      ...window.detail.capabilities,
      actions: ['comment', 'review', 'merge'],
      mergeMethods: ['squash'],
    }
  })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await detail.getByRole('button', { name: 'Merge', exact: true }).click()
  const mergeDialog = page.getByRole('dialog')
  const mergeConfirm = mergeDialog.getByRole('button', { name: 'Merge pull request', exact: true })
  assert.equal(await mergeConfirm.isDisabled(), true)
  await mergeDialog.getByRole('checkbox', { name: 'Confirm merge of reviewed commit' }).check()
  await mergeConfirm.click()
  await mergeDialog.waitFor({ state: 'detached' })
  const merged = await page.evaluate(() =>
    window.writes.find((write) => write.input.action === 'merge'),
  )
  assert.equal(merged.input.headSha, 'a'.repeat(40))
  assert.equal(merged.input.method, 'squash')
  await page.screenshot({ path: '/tmp/dovo-pull-workspace.png' })
  await page.getByRole('tab', { name: /Changes/ }).click()
  await page.getByText('1 of 2 viewed', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-pull-changes.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const name of ['Overview', 'Changes (2)', 'Checks (1)']) {
    await detail.getByRole('tab', { name, exact: true }).click()
    await noOverflow()
    assert.equal(await heading.isVisible(), true)
    assert.equal(await content.evaluate((element) => element.clientHeight > 100), true)
  }
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await content.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: '/tmp/dovo-pull-overview-narrow.png' })
  await page.evaluate(() => {
    window.detail.pull.title = 'A very long pull request title '.repeat(12)
    window.detail.pull.head = 'feature/' + 'long-branch-name'.repeat(12)
  })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await noOverflow()
  assert.equal(await content.evaluate((element) => element.clientHeight > 100), true)
  await page.evaluate(() => {
    window.store.connected = false
    window.source.connected = false
  })
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await detail.getByText('Offline · showing last loaded details.', { exact: true }).waitFor()
  assert.equal(await detail.getByRole('button', { name: 'Review', exact: true }).isDisabled(), true)
  assert.equal(await form.getByRole('button', { name: 'Comment', exact: true }).isDisabled(), true)
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await fullWidthList()
  await noOverflow()
  assert.equal(await list.getByRole('textbox', { name: 'Search pull requests' }).isVisible(), true)
  await page.screenshot({ path: '/tmp/dovo-pull-list-narrow.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.store.connected = true
    window.source.connected = true
    window.detail.pull.title = 'Improve pull request reviews'
    window.detail.pull.head = 'feature'
    window.detail.checks[0] = { name: 'Tests', status: 'FAILURE', summary: 'One test failed' }
    window.showEmbedded()
  })
  const embedded = page.locator('[aria-label="Pull request details"]')
  await embedded.getByRole('button', { name: 'Close preview', exact: true }).waitFor()
  await embedded.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await embedded.getByText('One test failed', { exact: true }).waitFor()
  assert.equal(
    await embedded
      .getByRole('tabpanel')
      .filter({ visible: true })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  )
  await noOverflow()
  await embedded.getByRole('tab', { name: 'Changes (2)', exact: true }).click()
  await noOverflow()
  await embedded.getByRole('button', { name: 'Close preview', exact: true }).click()
  assert.equal(await page.evaluate(() => window.embeddedClosed), true)
  await page.evaluate(() => window.showLongList())
  await list
    .getByRole('button')
    .filter({ hasText: 'Scroll regression 179' })
    .waitFor({ state: 'attached' })
  const scroll = list.locator('[aria-label="Pull request rows"]')
  assert.equal(
    await scroll.evaluate(
      (element) => element.scrollHeight > element.clientHeight && element.clientHeight > 100,
    ),
    true,
  )
  const headerTop = await list
    .locator('header')
    .evaluate((element) => element.getBoundingClientRect().top)
  await scroll.hover()
  await page.mouse.wheel(0, 2000)
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Pull request rows"]').scrollTop > 0,
  )
  assert.equal(
    await list.locator('header').evaluate((element) => element.getBoundingClientRect().top),
    headerTop,
  )
  await list.getByRole('button').filter({ hasText: 'Scroll regression 179' }).first().focus()
  assert.equal(
    await list.locator('header').evaluate((element) => element.getBoundingClientRect().top),
    headerTop,
  )
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0)
  assert.equal(await page.evaluate(() => document.querySelector('.studio').scrollTop), 0)
  assert.equal(await page.getByRole('textbox', { name: 'Search pull requests' }).isVisible(), true)
  const overflow = await scroll.evaluate((element) => ({
    width: element.scrollWidth,
    visible: element.clientWidth,
  }))
  assert.ok(
    overflow.width <= overflow.visible + 1,
    `Hidden PR overflow: ${JSON.stringify(overflow)}`,
  )
  for (const selector of [
    '.studio',
    '.studio-body',
    '.studio-main',
    '[aria-label="Pull request sidebar"]',
  ]) {
    assert.equal(
      await page
        .locator(selector)
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      true,
      `Hidden height overflow in ${selector}`,
    )
  }
  await page.setViewportSize({ width: 360, height: 650 })
  assert.equal(
    await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    true,
    'Narrow PR list must not hide horizontal overflow',
  )
  for (const selector of [
    '.studio',
    '.studio-body',
    '.studio-main',
    '[aria-label="Pull request sidebar"]',
  ]) {
    assert.equal(
      await page
        .locator(selector)
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      true,
      `Narrow hidden height overflow in ${selector}`,
    )
  }
  // Exercise destination handling in the real detail, including a comment far down the page.
  await page.evaluate(() => {
    window.detail.comments = Array.from({ length: 30 }, (_, i) => ({
      id: 'comment-' + i,
      kind: 'comment',
      author: 'reviewer',
      body: 'Discussion ' + i,
      url: window.detail.pull.url + '#issuecomment-' + i,
      date: '2026-10-04',
    }))
    window.showDestination('overview', '#issuecomment-29')
  })
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-comment-fragment="#issuecomment-29"]')
    const content = document.querySelector('[aria-label="Pull request content"]')
    return (
      target &&
      content &&
      content.scrollTop > 0 &&
      target.getBoundingClientRect().top < content.getBoundingClientRect().bottom
    )
  })
  await page.evaluate(() => window.showDestination('changes', ''))
  await page.waitForFunction(
    () => document.querySelector('#pr-tab-changes')?.getAttribute('aria-selected') === 'true',
  )
  await page.evaluate(() => {
    window.detail.comments.push({
      id: 'inline-1',
      kind: 'inline',
      path: 'src/second.ts',
      author: 'reviewer',
      body: 'Inline destination',
      url: window.detail.pull.url + '#discussion_r1',
      date: '2026-10-04',
    })
    window.showDestination('overview', '#discussion_r1')
  })
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-comment-fragment="#discussion_r1"]')
    const content = document.querySelector('[aria-label="Pull request content"]')
    return (
      document.querySelector('#pr-tab-changes')?.getAttribute('aria-selected') === 'true' &&
      target?.getClientRects().length &&
      content &&
      target.getBoundingClientRect().top < content.getBoundingClientRect().bottom
    )
  })
  await page.evaluate(() => window.showDestination('checks', ''))
  await page.waitForFunction(
    () => document.querySelector('#pr-tab-checks')?.getAttribute('aria-selected') === 'true',
  )
  // Basic list data must show dependencies without inventing unloaded status signals.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.showBasicList())
  await list.getByRole('button', { name: 'All PRs', exact: true }).click()
  const backToList = page.getByRole('button', { name: 'Back to PRs', exact: true })
  if (await backToList.isVisible()) await backToList.click()
  await row('Base change').getByText('Stack 1/2 · #7', { exact: true }).waitFor()
  await row('Base change').getByText('Base PR', { exact: true }).waitFor()
  await row('Dependent change').getByText('Stack 2/2 · #7', { exact: true }).waitFor()
  await row('Dependent change').getByText('#7 → #8', { exact: true }).waitFor()
  assert.doesNotMatch(await row('Dependent change').innerText(), /No checks|No review|approved/i)
  assert.equal(
    await row('Dependent change')
      .locator('div.grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    2,
    'Basic rows must not reserve an empty status column',
  )
  assert.equal(await list.getByText('Checks & review', { exact: true }).count(), 0)
  const basicAvatar = row('Base change').locator('img')
  await basicAvatar.evaluate((element) => element.decode())
  await noOverflow()
  await page.screenshot({ path: '/tmp/dovo-pull-basic-stacks-desktop.png' })
  await page.evaluate(() => window.showBasicList(false))
  await row('Dependent change').getByText('Stack · partial · #7', { exact: true }).waitFor()
  for (const width of [760, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await noOverflow()
    await row('Dependent change').getByText('#7 → #8', { exact: true }).waitFor()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.showBasicList(false, true))
  await row('Dependent change').getByText('Stack 3/5 · Stack #12', { exact: true }).waitFor()
  await row('Dependent change').getByText('onto main', { exact: true }).waitFor()
  assert.doesNotMatch(await row('Dependent change').innerText(), /Base PR|undefined|#7 → #8/)
  await noOverflow()
  await page.screenshot({ path: '/tmp/dovo-pull-native-stack-desktop.png' })
  assert.deepEqual(errors, [])
  console.log(
    'PR workspace: full-width and compact lists, visible controls, row actions, multi-selection, filters, overview activity, persistent title, checks, tab keyboard navigation, draft and review preservation, review submission, Markdown comments, offline state, narrow layouts and embedded previews passed.',
  )
} finally {
  await browser.close()
}
