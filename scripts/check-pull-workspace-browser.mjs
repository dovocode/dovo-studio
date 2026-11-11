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
  `export {Disclosure} from '${uiDir}/disclosure.tsx';export {IconButton} from '${uiDir}/components/icon-button.tsx';export {ProjectIcon} from '${uiDir}/project-icon.tsx';export * from '${uiDir}/sidebar-header.tsx';export const OrganizeReview=()=>null;export {ChangeSummary} from '${uiDir}/review/change-summary.tsx';export {ChangeTypeFilters} from '${uiDir}/review/change-types.tsx';export {FileReviewControls,ReviewFiles} from '${uiDir}/review/file-review.tsx';export {ChoicePicker} from '${uiDir}/choice-picker.tsx';export {PageHeader} from '${uiDir}/page-header.tsx';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const FormField=({label,children})=><label>{label}{children}</label>;export const MessageResponse=({children})=><div>{children}</div>;`
const mocks = {
  '@dovo/studio-ui': controls,
  '@dovo/studio-core': `export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export const updateAppPreferences=()=>{};export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({appInfo:{channel:'nightly'},navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});export {useFileReview} from '${root}/packages/studio-core/src/review/use-file-review.ts';export const useAppPreferences=()=>({pullProjectVisibility:{},hideWhitespaceChanges:false});export const whitespaceOnlyPatch=()=>false;export const readAppPreferences=()=>({diffLayout:'unified',mergeMethod:'auto',importedCodeThemes:[],theme:'dark',themePalette:'dovo',codeTheme:'app'});export const formatDateTime=value=>value;export const repositorySourceKey=(r,p)=>r+':'+p;`,
  '../workspace/context': `export const useWorkspace=()=>window.store;export const useStudioHost=()=>({appInfo:{channel:'nightly'},navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  './use-pulls': `export const usePulls=()=>({sources:[window.source],pages:[{source:window.source,reader:window.source,pulls:window.pulls,error:window.pullError}],connected:window.store.connected,busy:false,refresh:()=>{},more:()=>{}});`,
  './use-pull-detail': `export const usePullDetail=(_repositoryId,_number,_connectionId,options)=>({sections:Object.fromEntries(['overview','status','discussion','changes','checks','stack'].map(key=>[key,{ready:key!=='checks'||!window.checksPending,busy:key==='checks'&&!!window.checksPending,enabled:true,readConnected:window.store.connected,error:key==='checks'?(window.checksError??''):'',detail:window.detail,refresh:()=>{window.checkRefreshes=(window.checkRefreshes??0)+1}}])),detail:window.detail,readConnected:window.store.connected,error:'',busy:false,refresh:()=>{},invalidate:()=>{}});`,
  './patch': `export const emptyPullLineDraft={selection:null,destination:'agent'};export const PullPatch=({file})=><pre>{file.patch}</pre>;`,
  './pipeline-runs': `export {PullPipelineRunsContent} from '${root}/packages/extension-scm/src/pulls/detail/pipeline-runs.tsx';export const usePullPipelineRuns=()=>({runs:(window.pipelineRuns??[]).map((run,index)=>({id:String(index),number:String(index+1),title:'Pipeline build',url:'https://github.com/team/project/actions/runs/'+index,updatedAt:'2026-10-04',...run})),connected:window.store.connected,busy:false,selected:null,setSelected:()=>{},load:()=>{window.pipelineRefreshes=(window.pipelineRefreshes??0)+1}});`,
  '../../work/content': `export const WorkContent=()=>null;`,
  '../list/start-task': `export const StartPullTask=()=> <button>New thread</button>;`,
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
  if (path === '/api/scm/pulls/action' && input.action === 'review' && window.partialReview) {
    window.writes.push({path,input});window.partialReview=false;
    return {status:'updated',pendingReviewDecision:input.event,message:'Your review comment was posted, but Bitbucket did not confirm the review decision.'};
  }
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
const rootView=createRoot(document.getElementById('app'));window.showBasicList=(complete=true,native=false)=>{window.pullError=undefined;window.source.repository.name='Project';const basic={number:7,title:'Base change',url:pull.url,state:'open',draft:false,author:pull.author,authorAvatarUrl:pull.authorAvatarUrl,updatedAt:pull.updatedAt,head:'feature',base:'main',labels:[]};window.pulls=[basic,{...basic,number:8,url:'https://github.com/team/project/pull/8',title:'Dependent change',head:'child',base:'feature'}];if(native)window.pulls=[{...window.pulls[1],stack:{nativeId:99,nativeNumber:12,position:3,size:5,baseRef:'main',complete:false}}];window.pulls=pullOverviewStacks(window.pulls,complete);rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><View key={'basic-'+complete+'-'+native}/></main></div></div>)};window.showLongList=()=>{window.pullError='Command failed: gh repo view '+('https://github.example/'+ 'long-repository-name'.repeat(70));window.source.repository.name='project-name'.repeat(40);window.pulls=Array.from({length:180},(_,i)=>({...pull,number:i+1,title:'Scroll regression '+i,url:'https://github.com/team/project/pull/'+(i+1)}));rootView.render(<div className="studio dark"><header className="studio-titlebar">Dovo</header><div className="studio-body"><main className="studio-main"><div className="flex min-h-0 min-w-0 flex-1"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><View key="long-list"/></div></div></main></div></div>)};window.showDestination=(tab,fragment)=>rootView.render(<TooltipProvider><main className="studio flex flex-col" style={{height:'100vh'}}><PullDetail key={tab+fragment} repositoryId="repo" number={7} initialTab={tab} initialFragment={fragment} onBack={()=>{}} onChanged={()=>{}}/></main></TooltipProvider>);window.showEmbedded=()=>rootView.render(<TooltipProvider><main className="studio dark flex flex-col" style={{width:352,height:'100vh'}}><PullDetail repositoryId="repo" number={7} embedded onBack={()=>{window.embeddedClosed=true}} onChanged={()=>{}}/></main></TooltipProvider>);rootView.render(<TooltipProvider><SidebarHeaderLayout brand={<TitleBar sidebar platform="darwin" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>}><div className="studio dark" data-platform="darwin"><HeaderFallback><TitleBar platform="darwin" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/></HeaderFallback><div className="studio-body"><nav className="studio-navigation" aria-label="Main navigation"/><main className="studio-main"><View/></main></div></div></SidebarHeaderLayout></TooltipProvider>);`,
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
  const screenshot = (options) =>
    process.env.DOVO_BROWSER_SCREENSHOTS === '0' ? Promise.resolve() : page.screenshot(options)
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
  const checkActionFooter = async (dialog, submitName) => {
    const originalViewport = page.viewportSize()
    const body = dialog.locator('[data-pull-action-body]')
    const disclosure = dialog.locator('details').filter({ hasText: 'Status sources' })
    const summary = disclosure.locator('summary')
    const writeCount = await page.evaluate(() => window.writes.length)
    const measureFooter = async (state) => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      const geometry = await dialog.evaluate((element, name) => {
        const body = element.querySelector('[data-pull-action-body]')
        const form = element.querySelector('form')
        const cancel = Array.from(form.querySelectorAll('button')).find(
          (button) => button.textContent.trim() === 'Cancel',
        )
        const submit = form.querySelector('button[type="submit"]')
        if (!body || !cancel || !submit || submit.textContent.trim() !== name) return null
        const rect = (node) => {
          const { top, right, bottom, left, width, height } = node.getBoundingClientRect()
          return { top, right, bottom, left, width, height }
        }
        return {
          dialog: rect(element),
          body: rect(body),
          bodyContentRight:
            body.getBoundingClientRect().right -
            (body.offsetWidth - body.clientWidth) -
            parseFloat(getComputedStyle(body).paddingRight),
          cancel: rect(cancel),
          submit: rect(submit),
          viewport: { width: innerWidth, height: innerHeight },
        }
      }, submitName)
      assert.ok(geometry, `${submitName}: footer controls exist (${state})`)
      const label = `${submitName} ${geometry.viewport.width}×${geometry.viewport.height} ${state}`
      for (const name of ['cancel', 'submit']) {
        const button = geometry[name]
        assert.ok(button.width > 0 && button.height > 0, `${label}: ${name} has area`)
        assert.ok(
          button.left >= Math.max(geometry.dialog.left, 0) - 1 &&
            button.right <= Math.min(geometry.dialog.right, geometry.viewport.width) + 1 &&
            button.top >= Math.max(geometry.dialog.top, 0) - 1 &&
            button.bottom <= Math.min(geometry.dialog.bottom, geometry.viewport.height) + 1,
          `${label}: ${name} is fully inside the visible dialog`,
        )
        assert.ok(
          button.top >= geometry.body.bottom - 1,
          `${label}: ${name} does not overlap the scrolling form body`,
        )
      }
      assert.ok(
        Math.abs(geometry.submit.right - geometry.bodyContentRight) <= 1,
        `${label}: submit aligns with the scroll body's content edge`,
      )
      assert.ok(
        geometry.cancel.right <= geometry.submit.left + 1,
        `${label}: Cancel and submit do not overlap`,
      )
    }
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 1100, height: 960 },
      { width: 1440, height: 720 },
    ]) {
      await page.setViewportSize(viewport)
      await body.evaluate((element) => {
        element.scrollTop = 0
      })
      assert.equal(await disclosure.getAttribute('open'), null)
      await measureFooter('sources collapsed')
      await summary.click()
      assert.equal(await disclosure.getAttribute('open'), '')
      await body.evaluate((element) => {
        element.scrollTop = 0
      })
      await measureFooter('sources expanded, body at top')
      const scroll = await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight
        return {
          overflow: element.scrollHeight - element.clientHeight,
          position: element.scrollTop,
        }
      })
      if (viewport.height === 720) {
        assert.ok(scroll.overflow > 0, `${submitName}: short desktop exercises body overflow`)
        assert.ok(scroll.position > 0, `${submitName}: short desktop form body actually scrolls`)
      }
      await measureFooter('sources expanded, body at bottom')
      await summary.click()
      await body.evaluate((element) => {
        element.scrollTop = 0
      })
    }
    await page.setViewportSize(originalViewport)
    assert.equal(await page.evaluate(() => window.writes.length), writeCount)
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
  }
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
  await row('Improve pull request reviews')
    .getByText('Repository CI: passed', { exact: true })
    .waitFor()
  const avatar = row('Improve pull request reviews').locator('img')
  assert.equal(await avatar.getAttribute('src'), 'https://avatars.example/dominic.png')
  await avatar.evaluate((element) => element.decode())
  await screenshot({ path: '/tmp/dovo-pull-list-clean.png' })
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
  await screenshot({ path: '/tmp/dovo-pull-list.png' })
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
  const waitForCheckFailure = (label) =>
    page.waitForFunction(
      (expected) => document.querySelector('#pr-tab-checks')?.title === expected,
      label,
    )
  const heading = detail.getByRole('heading', { level: 2, name: /Improve pull request reviews/ })
  assert.equal(await list.evaluate((element) => element.clientWidth <= 416), true)
  await detail
    .getByLabel('Pull request status', { exact: true })
    .getByText('Repository merge status: Waiting for required reviews', { exact: true })
    .waitFor()
  assert.equal(await detail.getByText('Mergeability', { exact: true }).count(), 0)
  assert.equal(
    (await detail.locator('.studio-pull-header').boundingBox()).y,
    (await page.locator('.studio-titlebar').boundingBox()).y,
    'PR and sidebar branding share one row',
  )
  await screenshot({ path: '/tmp/dovo-pull-overview.png' })
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
  const neutralCheckCountColor = await detail
    .getByRole('tab', { name: 'Checks (1)', exact: true })
    .getByText('1', { exact: true })
    .evaluate((node) => getComputedStyle(node).color)
  assert.equal(
    await detail
      .getByRole('tab', { name: 'Checks (1)', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await detail.getByText('All tests passed', { exact: true }).waitFor()
  await detail.getByText('Check output', { exact: true }).click()
  await detail.getByText('2 tests completed', { exact: true }).waitFor()
  await screenshot({ path: '/tmp/dovo-pull-checks.png' })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).press('Home')
  assert.equal(
    await detail.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'),
    'true',
  )
  assert.equal(await form.getByRole('textbox').inputValue(), 'Draft feedback')
  await page.getByRole('tab', { name: /Changes/ }).click()
  const changes = page.getByRole('region', { name: 'Code changes' })
  await changes.locator('article').first().waitFor()
  assert.equal(await changes.locator('article').count(), 2)
  const summaryToggle = changes.locator('button[aria-expanded]').first()
  assert.equal(await summaryToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await changes.getByRole('navigation', { name: 'Changed files' }).count(), 0)
  await summaryToggle.click()
  assert.equal(await summaryToggle.getAttribute('aria-expanded'), 'true')
  await changes.getByRole('navigation', { name: 'Changed files' }).waitFor()
  await changes
    .getByRole('navigation', { name: 'Changed files' })
    .getByText('2 files', { exact: true })
    .waitFor()
  await screenshot({ path: '/tmp/dovo-pull-summary-expanded.png' })
  await changes.getByRole('button', { name: 'Filter Code: 2 files', exact: true }).click()
  assert.equal(
    await changes
      .getByRole('button', { name: 'Filter Code: 2 files', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await changes.locator('article').count(), 2)
  await changes.getByRole('button', { name: 'Filter Code: 2 files', exact: true }).click()
  await page.getByRole('checkbox', { name: 'File viewed', exact: true }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Code changes"] [aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await page.getByRole('button', { name: '2 files · 1 viewed', exact: true }).waitFor()
  assert.equal(await heading.isVisible(), true)
  await page
    .getByRole('navigation', { name: 'Changed files' })
    .getByRole('button', { name: /second.ts/ })
    .click()
  await summaryToggle.click()
  assert.equal(await summaryToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await changes.locator('article').count(), 2)
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
    window.pipelineRuns = [{ status: 'failure' }]
  })
  await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).click()
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  assert.equal(
    await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).getAttribute('title'),
    'Pipeline failed',
  )
  assert.equal(
    await detail.getByRole('tab', { name: 'Checks (1)', exact: true }).innerText(),
    'Checks\n1',
  )
  assert.match(
    await detail
      .getByRole('tab', { name: 'Checks (1)', exact: true })
      .getAttribute('aria-description'),
    /Pipeline runs: 1 failed/,
    'Failure badge explains which check source failed',
  )
  assert.equal(
    await detail.getByRole('button', { name: 'Merge', exact: true }).getAttribute('data-variant'),
    'outline',
    'Failed pipelines and a missing review must not promote Merge as the primary action',
  )
  assert.equal(await detail.getByRole('button', { name: 'Merge', exact: true }).isEnabled(), true)
  await detail.getByRole('button', { name: 'Merge', exact: true }).click()
  const mergeDialog = page.getByRole('dialog')
  const mergeReadiness = mergeDialog.getByRole('region', { name: 'Merge readiness' })
  await mergeReadiness
    .getByRole('heading', { name: 'Repository merge status', exact: true })
    .waitFor()
  assert.equal(
    await mergeReadiness
      .getByRole('heading')
      .evaluate((element) => element === document.activeElement),
    true,
    'Merge opens on the readiness heading, without accepting consent or submitting',
  )
  await mergeReadiness.getByText('Waiting for required reviews', { exact: true }).waitFor()
  const statusDisclosure = mergeReadiness.locator('details').filter({ hasText: 'Status sources' })
  assert.equal(await statusDisclosure.getAttribute('open'), null)
  const currentMergeFailures = mergeReadiness.getByRole('list', { name: 'Current merge failures' })
  await currentMergeFailures.getByText('Linked pipelines: 1 failed', { exact: true }).waitFor()
  assert.equal(await currentMergeFailures.getByRole('listitem').count(), 1)
  assert.equal(
    await mergeDialog.getByRole('button', { name: 'Merge pull request', exact: true }).isDisabled(),
    true,
    'Visible failures do not bypass the acknowledgement guard',
  )
  await checkActionFooter(mergeDialog, 'Merge pull request')
  await mergeReadiness.getByRole('button', { name: 'Refresh checks', exact: true }).click()
  assert.equal(await page.evaluate(() => window.checkRefreshes), 1)
  assert.equal(await statusDisclosure.getByText('1 failed', { exact: true }).isVisible(), false)
  await statusDisclosure.locator('summary').click()
  const sourceValue = (scope, name, value) =>
    scope.getByText(name, { exact: true }).locator('..').getByText(value, { exact: true })
  for (const [name, value] of [
    ['Repository CI', 'passed'],
    ['Check reports', '1 check passed'],
    ['Linked pipeline runs', '1 failed'],
    ['Review status', 'Review required'],
  ])
    await sourceValue(statusDisclosure, name, value).waitFor()
  const headerStatus = detail.getByLabel('Pull request status', { exact: true })
  await headerStatus
    .getByText('Repository merge status: Waiting for required reviews', { exact: true })
    .waitFor()
  await headerStatus.getByText('Review required', { exact: true }).waitFor()
  for (const status of [
    'Pipeline runs: 1 failed',
    'Check reports: 1 check passed',
    'CI status: passed',
  ])
    assert.equal(await headerStatus.getByText(status, { exact: true }).count(), 0)
  await mergeDialog.getByText(/I acknowledge the failures listed above\./).waitFor()
  const mergeConfirm = mergeDialog.getByRole('button', { name: 'Merge pull request', exact: true })
  assert.equal(
    await mergeDialog
      .getByRole('checkbox', {
        name: 'Confirm merge of reviewed commit. Acknowledge current failures: Linked pipelines: 1 failed',
        exact: true,
      })
      .count(),
    1,
    'Failure acknowledgement is part of the accessible consent label',
  )
  assert.equal(await mergeConfirm.isDisabled(), true)
  await mergeDialog.getByRole('checkbox', { name: 'Confirm merge of reviewed commit' }).check()
  assert.equal(
    await mergeConfirm.isEnabled(),
    true,
    'Status warnings must preserve provider merge policy',
  )
  await mergeConfirm.click()
  await mergeDialog.waitFor({ state: 'detached' })
  const merged = await page.evaluate(() =>
    window.writes.find((write) => write.input.action === 'merge'),
  )
  assert.equal(merged.input.headSha, 'a'.repeat(40))
  assert.equal(merged.input.method, 'squash')
  await page.evaluate(() => {
    window.pipelineRuns = []
  })
  await screenshot({ path: '/tmp/dovo-pull-workspace.png' })
  await page.getByRole('tab', { name: /Changes/ }).click()
  await page.getByRole('button', { name: '2 files · 1 viewed', exact: true }).waitFor()
  await screenshot({ path: '/tmp/dovo-pull-changes.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const name of ['Overview', 'Changes (2)', 'Checks (1)']) {
    await detail.getByRole('tab', { name, exact: true }).click()
    await noOverflow()
    await heading.waitFor({ state: 'visible' })
    assert.equal(await heading.isVisible(), true)
    assert.equal(await content.evaluate((element) => element.clientHeight > 100), true)
  }
  await detail.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Submit review', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await detail.getByRole('tab', { name: 'Changes (2)', exact: true }).click()
  await summaryToggle.click()
  await changes.getByRole('navigation', { name: 'Changed files' }).waitFor()
  await noOverflow()
  await screenshot({ path: '/tmp/dovo-pull-summary-narrow.png' })
  await summaryToggle.click()
  await detail.getByRole('tab', { name: 'Overview', exact: true }).click()
  await content.evaluate((element) => {
    element.scrollTop = 0
  })
  await screenshot({ path: '/tmp/dovo-pull-overview-narrow.png' })
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
  await detail.getByText('Offline · reconnect to refresh.', { exact: true }).waitFor()
  assert.equal(
    await detail.getByRole('button', { name: 'PR actions', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await form.getByRole('button', { name: 'Comment', exact: true }).isDisabled(), true)
  await detail.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await fullWidthList()
  await noOverflow()
  assert.equal(await list.getByRole('textbox', { name: 'Search pull requests' }).isVisible(), true)
  await screenshot({ path: '/tmp/dovo-pull-list-narrow.png' })
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
  // Pipeline failures remain visible beside independently passed check reports.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.pipelineRuns = [{ status: 'failure' }]
    window.pipelineTestChecks = window.detail.checks
    window.pipelineTestPull = window.detail.pull
    window.detail.pull = {
      ...window.detail.pull,
      checksState: 'SUCCESS',
      reviewDecision: 'APPROVED',
      mergeStateStatus: 'CLEAN',
    }
    window.detail.checks = [{ name: 'Tests', status: 'SUCCESS' }]
    window.showDestination('overview', 'pipeline-failure')
  })
  const checksTab = page.getByRole('tab', { name: 'Checks (1)', exact: true })
  await waitForCheckFailure('Pipeline failed')
  assert.equal(
    await checksTab
      .getByText('1', { exact: true })
      .evaluate((node) => getComputedStyle(node).color),
    neutralCheckCountColor,
    'Passed check-report count stays neutral when a linked pipeline fails',
  )
  assert.equal(await checksTab.locator('svg.lucide-circle-alert').count(), 1)
  await headerStatus.getByText('Repository merge status: Ready to merge', { exact: true }).waitFor()
  assert.equal(
    await detail.getByRole('button', { name: 'Merge', exact: true }).getAttribute('data-variant'),
    'outline',
    'An independent pipeline failure still prevents primary-action promotion',
  )
  await checksTab.click()
  const checkPanel = detail.locator('#pr-panel-checks')
  const repositoryCI = checkPanel.getByRole('region', { name: 'Repository CI', exact: true })
  const pipelineSection = checkPanel.getByRole('region', { name: 'Pull request pipeline runs' })
  const reportsSection = checkPanel
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Check reports 1', exact: true }) })
  await repositoryCI.getByRole('heading', { name: 'Repository CI', exact: true }).waitFor()
  await repositoryCI.getByText('Passed', { exact: true }).waitFor()
  assert.equal(await repositoryCI.getByText('Tests', { exact: true }).count(), 0)
  assert.equal(await repositoryCI.getByText('Pipeline build', { exact: true }).count(), 0)
  assert.equal(
    await checkPanel.getByRole('heading', { name: 'Status sources', exact: true }).count(),
    0,
  )
  await pipelineSection
    .getByRole('heading', { name: 'Linked pipeline runs', exact: true })
    .waitFor()
  const repositoryCIBox = await repositoryCI.boundingBox()
  const pipelineBox = await pipelineSection.boundingBox()
  assert.ok(
    repositoryCIBox.y + repositoryCIBox.height <= pipelineBox.y,
    'Repository CI occupies its own section before linked pipeline runs',
  )
  await pipelineSection.getByText('Pipeline build', { exact: true }).waitFor()
  await pipelineSection.getByText('Failed', { exact: true }).waitFor()
  await pipelineSection.getByRole('button', { name: 'Refresh runs', exact: true }).click()
  assert.equal(await page.evaluate(() => window.pipelineRefreshes), 1)
  await reportsSection.getByText('Tests', { exact: true }).waitFor()
  await reportsSection.getByText('Passed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.pipelineRuns = []
    window.detail.pull = window.pipelineTestPull
    window.detail.checks = [{ name: 'Tests', status: 'FAILURE' }]
    window.showDestination('overview', 'report-failure')
  })
  await waitForCheckFailure('Checks failed')
  await checksTab.click()
  await reportsSection.getByText('Failed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.pipelineRuns = [{ status: 'failure' }]
    window.showDestination('overview', 'both-failed')
  })
  await waitForCheckFailure('CI failed')
  await checksTab.click()
  // Saved failures retain their source, and explicitly disclose offline data.
  await page.evaluate(() => {
    window.store.connected = false
    window.showDestination('overview', 'offline-failures')
  })
  await waitForCheckFailure('CI failed')
  await checksTab.click()
  await reportsSection.getByText('Failed', { exact: true }).waitFor()
  assert.match(
    await checksTab.getAttribute('aria-description'),
    /Check reports: 1 failed · offline/,
  )
  await page.getByText('Offline · reconnect to refresh.', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.store.connected = true
    window.checksError = 'Reports unavailable'
    window.showDestination('overview', 'unavailable-reports')
  })
  await checksTab.click()
  await checkPanel.getByText('Check reports: Reports unavailable', { exact: true }).waitFor()
  // A report read error cannot suppress an independently known pipeline failure.
  await waitForCheckFailure('Pipeline failed')
  await page.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Merge pull request', exact: true }).click()
  const unavailableMerge = page.getByRole('dialog')
  await unavailableMerge.getByText('Reports unavailable', { exact: true }).waitFor()
  assert.equal(await unavailableMerge.locator('details').getAttribute('open'), null)
  await unavailableMerge
    .getByRole('list', { name: 'Current merge failures' })
    .getByText('Linked pipelines: 1 failed', { exact: true })
    .waitFor()
  await unavailableMerge.getByRole('button', { name: 'Retry checks', exact: true }).click()
  assert.equal(await page.evaluate(() => window.checkRefreshes), 2)
  await unavailableMerge.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    window.checksError = ''
    window.pipelineRuns = []
    window.detail.checks = [{ name: 'Tests', status: 'UNKNOWN' }]
    window.showDestination('overview', 'unknown-report')
  })
  await checksTab.click()
  await reportsSection.getByText('Unknown', { exact: true }).waitFor()
  assert.equal(await checksTab.getByText(/failed/i).count(), 0)
  assert.equal(await checksTab.locator('svg.lucide-circle-alert').count(), 0)
  await page.evaluate(() => {
    window.detail.checks = window.pipelineTestChecks
  })
  // Overview loads check reports too, and never substitutes an aggregate passed state.
  await page.evaluate(() => {
    window.checksPending = true
    window.savedChecksState = window.detail.pull.checksState
    delete window.detail.pull.checksState
    window.pipelineRuns = [{ status: 'failure' }]
    window.showDestination('overview', 'checks-pending')
  })
  const checkSummary = page.getByRole('button', {
    name: 'View pull request checks',
    exact: true,
  })
  await checkSummary.click()
  await checkPanel.getByText('Loading check reports…', { exact: true }).waitFor()
  await repositoryCI.getByText('CI status not loaded', { exact: true }).waitFor()
  assert.equal(await checkSummary.getByText(/checks? passed/i).count(), 0)
  await pipelineSection.getByText('Failed', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Merge pull request', exact: true }).click()
  const unloadedMerge = page.getByRole('dialog')
  await unloadedMerge.locator('summary').filter({ hasText: 'Status sources' }).click()
  await unloadedMerge.getByText('Loading checks…', { exact: true }).waitFor()
  assert.equal(
    await unloadedMerge.getByRole('button', { name: 'Loading…', exact: true }).isDisabled(),
    true,
  )
  await sourceValue(unloadedMerge, 'Linked pipeline runs', '1 failed').waitFor()
  assert.equal(await unloadedMerge.getByText(/checks? passed/i).count(), 0)
  await unloadedMerge.getByRole('button', { name: 'Cancel', exact: true }).click()
  await checkSummary.click()
  await page.waitForFunction(
    () => document.querySelector('#pr-tab-checks')?.getAttribute('aria-selected') === 'true',
  )
  await checkPanel.getByText('Loading check reports…', { exact: true }).waitFor()
  await pipelineSection.getByText('Failed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.checksPending = false
    window.detail.pull.checksState = window.savedChecksState
    window.detail.checks = [{ name: 'Tests', status: 'SUCCESS', summary: 'Checks loaded' }]
    window.showDestination('checks', 'checks-loaded')
  })
  await reportsSection.getByText('Passed', { exact: true }).waitFor()
  await page.getByText('Checks loaded', { exact: true }).waitFor()
  assert.equal(await checkPanel.getByText('Loading check reports…', { exact: true }).count(), 0)
  await pipelineSection.getByText('Failed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.pipelineRuns = []
    window.detail.checks = window.pipelineTestChecks
    window.showDestination('checks', '')
  })
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
    await row('Dependent change').evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
    2,
    'Basic rows must not reserve an empty status column',
  )
  assert.equal(await list.getByText('Checks & review', { exact: true }).count(), 0)
  const basicAvatar = row('Base change').locator('img')
  await basicAvatar.evaluate((element) => element.decode())
  await noOverflow()
  await screenshot({ path: '/tmp/dovo-pull-basic-stacks-desktop.png' })
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
  await screenshot({ path: '/tmp/dovo-pull-native-stack-desktop.png' })
  await page.evaluate(() => {
    window.detail.pull.provider = 'bitbucket'
    window.detail.capabilities = {
      actions: ['review', 'merge'],
      reviewDecisions: ['comment', 'approve', 'request-changes'],
      mergeMethods: ['merge'],
    }
    window.showDestination('overview', '')
  })
  for (const event of ['approve', 'request-changes']) {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const review = page.getByRole('dialog')
    await review.locator(`input[value="${event}"]`).check()
    await review.getByRole('textbox', { name: 'PR action body' }).fill('Post this feedback once')
    const before = await page.evaluate(() => {
      window.partialReview = true
      return window.writes.length
    })
    await review.getByRole('button', { name: 'Submit review', exact: true }).click()
    await review
      .getByRole('alert')
      .getByText(/Your review comment was posted/)
      .waitFor()
    assert.equal(await review.getByRole('textbox', { name: 'PR action body' }).inputValue(), '')
    assert.equal(await review.locator(`input[value="${event}"]`).isChecked(), true)
    assert.equal(
      await review.getByRole('button', { name: 'Submit review', exact: true }).isEnabled(),
      true,
    )
    await review.getByRole('button', { name: 'Submit review', exact: true }).click()
    await review.waitFor({ state: 'detached' })
    const writes = await page.evaluate((offset) => window.writes.slice(offset), before)
    assert.deepEqual(
      writes.map((write) => [write.input.body, write.input.event]),
      [
        ['Post this feedback once', event],
        ['', event],
      ],
    )
    assert.ok(writes.every((write) => write.input.headSha === 'a'.repeat(40)))
  }
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  const bitbucketMerge = page.getByRole('dialog')
  await bitbucketMerge
    .getByRole('checkbox', {
      name: /^Confirm merge of current source branch\. Studio checks viewed revision aaaaaaaa before submitting; later pushes may also be merged(?:\. Acknowledge current failures: .+)?$/,
    })
    .waitFor()
  await bitbucketMerge
    .getByText(
      /Studio checks viewed revision aaaaaaaa before submitting; later pushes may also be merged/,
    )
    .waitFor()
  assert.equal(
    await bitbucketMerge
      .getByRole('checkbox', { name: 'Confirm merge of reviewed commit' })
      .count(),
    0,
  )
  await bitbucketMerge.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.evaluate(() => {
    window.detail.pull = {
      ...window.detail.pull,
      provider: 'github',
      draft: true,
      mergeStateStatus: 'DRAFT',
      autoMergeEnabled: false,
    }
    window.detail.capabilities = {
      actions: ['draft'],
      mergeMethods: ['squash'],
      reviewDecisions: [],
    }
    window.showDestination('overview', 'draft-lifecycle')
  })
  await page.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark ready for review', exact: true }).click()
  const readyDialog = page.getByRole('dialog')
  await page.evaluate(() => {
    window.detail = { ...window.detail, pull: { ...window.detail.pull, draft: false } }
    window.showDestination('overview', 'draft-lifecycle')
  })
  await readyDialog.getByRole('button', { name: 'Mark ready for review', exact: true }).click()
  await readyDialog.waitFor({ state: 'detached' })
  const readyWrite = await page.evaluate(() => window.writes.at(-1).input)
  assert.equal(readyWrite.action, 'draft')
  assert.equal(readyWrite.draft, false)
  assert.equal(readyWrite.headSha, 'a'.repeat(40))
  await page.evaluate(() => {
    window.detail.pull = { ...window.detail.pull, draft: false, mergeStateStatus: 'BLOCKED' }
    window.detail.capabilities.actions = ['draft', 'auto-merge']
    window.detail.pull.checksState = 'FAILURE'
    window.detail.checks = [{ name: 'Tests', status: 'FAILURE' }]
    window.pipelineRuns = [{ status: 'failure' }]
    window.showDestination('overview', 'enable-auto-merge')
  })
  await page.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Enable auto-merge', exact: true }).click()
  const autoDialog = page.getByRole('dialog')
  assert.equal(await autoDialog.locator('details').getAttribute('open'), null)
  const autoFailures = autoDialog.getByRole('list', { name: 'Current merge failures' })
  for (const failure of [
    'Check reports: 1 failed',
    'Linked pipelines: 1 failed',
    'Repository CI: failed',
  ])
    await autoFailures.getByText(failure, { exact: true }).waitFor()
  assert.equal(await autoFailures.getByRole('listitem').count(), 3)
  assert.equal(
    await autoDialog.getByRole('button', { name: 'Enable auto-merge', exact: true }).isDisabled(),
    true,
  )
  await checkActionFooter(autoDialog, 'Enable auto-merge')
  await autoDialog.locator('summary').filter({ hasText: 'Status sources' }).click()
  for (const [name, value] of [
    ['Repository CI', 'failed'],
    ['Check reports', '1 failed'],
    ['Linked pipeline runs', '1 failed'],
    ['Review status', 'Review required'],
  ])
    await sourceValue(autoDialog, name, value).waitFor()
  await autoDialog.getByText(/I acknowledge the failures listed above\./).waitFor()
  assert.equal(await autoDialog.getByRole('checkbox').count(), 1)
  await autoDialog
    .getByRole('checkbox', {
      name: 'Confirm automatic merge when GitHub’s requirements pass, including later commits pushed to this PR. Acknowledge current failures: Check reports: 1 failed; Linked pipelines: 1 failed; Repository CI: failed',
      exact: true,
    })
    .waitFor()
  const autoSubmit = autoDialog.getByRole('button', { name: 'Enable auto-merge', exact: true })
  await page.evaluate(() => {
    window.detail = { ...window.detail, pull: { ...window.detail.pull, autoMergeEnabled: true } }
    window.showDestination('overview', 'enable-auto-merge')
  })
  assert.equal(await autoSubmit.isDisabled(), true)
  await autoDialog.getByText(/including later commits/).waitFor()
  await autoDialog.getByRole('checkbox').check()
  await page.evaluate(() => {
    window.detail = { ...window.detail, stale: true }
    window.showDestination('overview', 'enable-auto-merge')
  })
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"] button[type="submit"]')?.disabled,
  )
  assert.equal(await autoSubmit.isDisabled(), true)
  await page.evaluate(() => {
    window.detail = { ...window.detail, stale: false }
    window.showDestination('overview', 'enable-auto-merge')
  })
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"] button[type="submit"]')?.disabled,
  )
  assert.equal(
    await autoDialog.getByRole('checkbox').isChecked(),
    false,
    'Changed readiness invalidates prior consent',
  )
  await autoDialog.getByRole('checkbox').check()
  await autoSubmit.click()
  await autoDialog.waitFor({ state: 'detached' })
  const autoWrite = await page.evaluate(() => window.writes.at(-1).input)
  assert.equal(autoWrite.action, 'auto-merge')
  assert.equal(autoWrite.enabled, true)
  assert.equal(autoWrite.method, 'squash')
  await page.evaluate(() => {
    window.detail.pull.autoMergeEnabled = true
    window.showDestination('overview', 'disable-auto-merge')
  })
  await page.getByText('Auto-merge enabled', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'PR actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Disable auto-merge', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Disable auto-merge', exact: true })
    .click()
  assert.equal((await page.evaluate(() => window.writes.at(-1).input)).enabled, false)
  assert.deepEqual(errors, [])
  console.log(
    'PR workspace: full-width and compact lists, visible controls, row actions, multi-selection, filters, overview activity, persistent title, checks, tab keyboard navigation, draft and review preservation, review submission, Markdown comments, offline state, narrow layouts, embedded previews and visible merge/auto-merge footers at 1440×960, 1100×960 and 1440×720 passed.',
  )
} finally {
  await browser.close()
}
