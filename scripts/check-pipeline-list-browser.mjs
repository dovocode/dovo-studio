import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = root + 'packages/studio-ui/src/'
const mobile = root + 'apps/mobile/src/'
const data = `
window.sources=[{key:'repo',scope:'mac',name:'Dovo Studio',runtimeId:'mac',runtimeName:'Mac Studio',computerName:'Mac Studio',connected:true,kind:'repository',repository:{id:'repo',name:'Dovo Studio',path:'/repo'},profile:{id:'mac',connection:{address:'http://mac',token:'paired'}}}];
window.runs=['success','succeeded','SUCCESSFUL','failure','failed','in_progress','skipped'].map((status,index)=>({id:String(index),number:index+1,title:['Release desktop','Typecheck','Browser checks','Release mobile','Unit tests','Native build','Other commit'][index],status,url:'https://github.com/team/repo/actions/runs/'+index,ref:'main',sha:index===6?'other':'head',actor:'Dominic',createdAt:'2026-10-23T12:00:00Z',updatedAt:'2026-10-23T12:00:00Z'}));
window.renderCount=0;window.readStates=[];window.refreshing=false;window.refreshes=0;window.refreshWork=()=>{window.refreshes++;window.refreshing=true;window.render()};window.finishRefresh=()=>{window.refreshing=false;window.render()};
`
const native = `
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
export const View=({children,style,accessibilityLabel,testID})=><div data-testid={testID} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minWidth:0,...flat(style)}}>{children}</div>;
export const Text=({children,style,numberOfLines})=><span style={{overflowWrap:'anywhere',...flat(style),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}}>{children}</span>;
export const Pressable=({children,onPress,style,accessibilityLabel,accessibilityState,testID})=><button data-testid={testID} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress} style={{display:'flex',flexDirection:'column',textAlign:'left',color:'inherit',font:'inherit',background:'transparent',border:0,...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent,ListEmptyComponent,contentContainerStyle})=><div style={{...flat(contentContainerStyle),minWidth:0}}>{ListHeaderComponent}<div data-rows>{data.map((item,index)=><div key={keyExtractor(item)}>{renderItem({item,index})}</div>)}</div>{!data.length&&ListEmptyComponent}{ListFooterComponent}</div>;
export const Keyboard={dismiss:()=>{}};
export const useTheme=()=>({colors:{text:'#24292f',background:'#fff',surface:'#f6f8fa',selection:'#ddf4ff',accent:'#0969da',border:'#d0d7de',muted:'#57606a',error:'#cf222e',success:'#1a7f37',warning:'#9a6700'},styles:{screen:{padding:12,gap:12},row:{flexDirection:'row',alignItems:'center',gap:8},text:{fontSize:15,color:'#24292f'},muted:{fontSize:12,color:'#57606a'},empty:{padding:16,gap:8}}});
export const Icon=()=>null;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)} style={{boxSizing:'border-box',width:'100%',padding:10,font:'inherit'}}/>;
export const Choice=()=>null;export const Sheet=()=>null;
export const ScreenHeader=({title,subtitle,buttons=[]})=><header><h1 style={{fontSize:20}}>{title}</h1><p>{subtitle}</p>{buttons.map(button=><button key={button.label} aria-label={button.label} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;
`
async function bundle(isMobile) {
  const mocks = isMobile
    ? {
        'react-native': native,
        'expo-router': `export const router={push:href=>window.opened=href};`,
        '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
        '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
        '../../../runtime/state/app-active': `export const useForegroundInterval=()=>{};`,
        '../../runtime/connection/provider': `export const RuntimeScope=({children})=>children;export const useRuntime=()=>({activeId:'mac',overviews:[{connected:true}]});`,
        '../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
        '../../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
        '../../shell/source-route': `export const backToCollection=()=>{};export const issueHref=()=>'/issue';export const jiraIssueHref=()=>'/jira';export const pipelineHref=(runtime,repo,id)=>'/pipeline/'+id;`,
        './work-sources': `export const jiraSourceKey=()=>'';export const workSources=()=>window.sources;export const workSourceName=source=>source.name;export const workSourceContentIdentity=source=>source.key;export const workSourceInput=()=>({});`,
        './use-work-collection': `export const useWorkCollection=(mode,id,state)=>{window.readStates.push(state);return {pages:window.sources.map(source=>({source,items:window.runs,stale:!source.connected,options:{provider:'github'},next:'page2'})),busy:window.refreshing,refresh:window.refreshWork,more:async()=>{window.runs.push({...window.runs[3],id:'more',title:'Earlier release'});window.render()}}};`,
        '../../ui/layout/use-list-scroll': `export const useListScroll=()=>({retainPosition:()=>{}});`,
        '../connections/jira-binding': `export const JiraProjectForm=()=>null;`,
        './work-form': `export const WorkForm=()=>null;`,
        './jira-browse-controls': `export const JiraBrowseControls=()=>null;`,
        './jira-filters': `export const JiraChip=()=>null;export const JiraQuickViews=()=>null;export const JiraFilterFields=()=>null;`,
        ...Object.fromEntries(
          [
            '../../ui/content/text',
            '../../ui/theme',
            '../../ui/controls/choice',
            '../../ui/controls/action',
            '../../ui/controls/icon',
            '../../ui/layout/screen-header',
            '../../ui/controls/field',
            '../../ui/layout/sheet',
            '../../../ui/content/text',
            '../../../ui/theme',
            '../../../ui/controls/action',
            '../../../ui/controls/icon',
          ].map((path) => [path, native]),
        ),
      }
    : {
        '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
        '@dovo/studio-core': `export * from '@dovo/protocol';export const useStudioHost=()=>({navigate:()=>{}});export const useWorkspace=()=>({activeRuntimeId:'mac',runtimes:[]});export const WorkspaceRuntimeScope=({children})=>children;export const repositorySourceKey=()=>'';`,
        '@dovo/studio-ui': `export {PageHeader} from '${ui}page-header';export * from '${ui}sidebar-header';export {Button} from '${ui}components/ui/button';export {Input} from '${ui}components/ui/input';export {ChoicePicker} from '${ui}choice-picker';export const useCompactLayout=()=>innerWidth<1024;`,
        './work-sources': `export const useIssueSources=()=>window.sources;export const jiraSourceKey=()=>'';export const workRemoteKey=source=>source.key;export const matchesWorkSource=(source,key)=>!key||source.key===key;`,
        './use-work-sources': `export const useWorkSources=()=>({sources:window.sources,pages:window.sources.map(source=>({source,reader:source,items:window.runs,stale:!source.connected,options:{provider:'github',pipelines:true,pipelineActions:[]},next:'page2'})),busy:window.refreshing,refresh:window.refreshWork,more:async()=>{window.runs.push({...window.runs[3],id:'more',title:'Earlier release'});window.render()}});`,
        './jira-toolbar': `export const JiraToolbar=()=>null;`,
        './jira-issue-list': `export const jiraIssueRowKey=()=>'';export const JiraIssueList=()=>null;`,
        './content': `export const WorkContent=({initialSelected})=><p>Opened run {initialSelected}</p>;`,
        './work-form': `export const WorkForm=()=>null;`,
        '../connections/jira-binding': `export const JiraSourcesDialog=()=>null;`,
        '../connections/source-picker': `export const SourcePicker=()=>null;`,
      }
  return build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';${isMobile ? `import {WorkScreen} from '${mobile}scm/work/work';` : `import IssuesView,{PipelinesView} from '${root}packages/extension-scm/src/work/work-view';`} ${data} const root=createRoot(document.getElementById('app'));function App(){const[revision,setRevision]=useState(0);window.render=()=>setRevision(value=>value+1);return ${isMobile ? '<WorkScreen mode={window.mode??"pipelines"} repositoryId="repo" commitSha="head"/>' : 'window.mode==="issues"?<IssuesView/>:<PipelinesView/>'}}root.render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'apps/mobile/node_modules', root + 'packages/studio-ui/node_modules'],
    plugins: [
      {
        name: 'boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
          )
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: root + 'apps/mobile',
          }))
        },
      },
    ],
  })
}
const [desktop, mobileBundle] = await Promise.all([bundle(false), bundle(true)])
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
await mkdir('/tmp/dovo-pipeline-overhaul', { recursive: true })
const browser = await chromium.launch()
try {
  for (const isMobile of [false, true])
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html><body style="margin:0;font-family:system-ui"><div id="app" style="height:100vh;display:flex;flex-direction:column"></div></body></html>',
      )
      if (!isMobile) await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: (isMobile ? mobileBundle : desktop).outputFiles[0].text })
      const count = isMobile ? 6 : 7
      const rows = isMobile
        ? page.locator('[data-testid^="Work item "]')
        : page.locator('nav button').filter({ has: page.locator('time') })
      await page.getByRole('button', { name: `All runs: ${count}`, exact: true }).waitFor()
      assert.equal(await rows.count(), count)
      const firstRowGeometry = () =>
        rows.first().evaluate((node) => {
          const box = node.getBoundingClientRect()
          const origin = (
            node.closest('nav') ?? document.querySelector('header').parentElement
          ).getBoundingClientRect()
          return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
        })
      const beforeRefresh = await firstRowGeometry()
      const refresh = page.getByRole('button', {
        name: isMobile ? 'Refresh pipelines' : 'Refresh',
        exact: true,
      })
      await rows.first().evaluate((node) => (window.firstRow = node))
      await refresh.click()
      await page.getByText('Updating pipelines…', { exact: true }).waitFor()
      assert.equal(await refresh.isDisabled(), true)
      assert.equal(await rows.count(), count, 'Refreshing keeps existing runs visible')
      assert.deepEqual(
        await firstRowGeometry(),
        beforeRefresh,
        'Refresh status keeps list geometry steady',
      )
      assert.equal(
        await rows.first().evaluate((node) => node === window.firstRow),
        true,
        'Refresh keeps rows mounted',
      )
      await page.evaluate(() => window.finishRefresh())
      await page.getByText('Updating pipelines…', { exact: true }).waitFor({ state: 'hidden' })
      assert.deepEqual(await firstRowGeometry(), beforeRefresh)
      assert.equal(
        await page.evaluate(() => window.refreshes),
        1,
        'Refresh control calls collection refresh once',
      )
      await page.getByRole('button', { name: 'Filter Failed: 2 runs', exact: true }).click()
      assert.equal(await rows.count(), 2)
      await page.getByRole('button', { name: 'Filter Passed: 3 runs', exact: true }).click()
      assert.equal(await rows.count(), 3, 'Cross-provider aliases share one filter')
      await page.getByRole('button', { name: 'Filter Passed: 3 runs', exact: true }).click()
      assert.equal(await rows.count(), count, 'Clicking the active filter restores all runs')
      await page.getByRole('textbox', { name: 'Search pipelines', exact: true }).fill('Release')
      await page.getByRole('button', { name: 'Filter Failed: 1 runs', exact: true }).waitFor()
      assert.equal(await rows.count(), 2)
      await page.getByRole('button', { name: 'Filter Failed: 1 runs', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await rows.count(), 1)
      await page.getByRole('textbox', { name: 'Search pipelines', exact: true }).fill('Typecheck')
      await page.getByRole('button', { name: 'Filter Failed: 0 runs', exact: true }).waitFor()
      assert.equal(await rows.count(), 0, 'Selected filter remains visible at zero')
      await page.getByRole('button', { name: 'All runs: 1', exact: true }).click()
      assert.equal(await rows.count(), 1)
      await page.getByRole('textbox', { name: 'Search pipelines', exact: true }).fill('')
      await page.getByRole('button', { name: 'Filter Failed: 2 runs', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Filter Failed: 2 runs', exact: true }).click()
      const more = page.getByRole('button', { name: /Load more/ }).first()
      await more.click()
      await page.getByRole('button', { name: 'Filter Failed: 3 runs', exact: true }).waitFor()
      assert.equal(
        await rows.count(),
        3,
        'Loading earlier runs updates both summary and filtered list',
      )
      await page.evaluate(() => {
        window.sources[0].connected = false
        window.render()
      })
      await page.getByText('Offline · showing saved results.', { exact: true }).waitFor()
      assert.equal(await refresh.isDisabled(), true, 'Offline sources disable refresh')
      await page.getByRole('button', { name: 'Filter Passed: 3 runs', exact: true }).click()
      assert.equal(await rows.count(), 3, 'Saved runs remain filterable offline')
      if (isMobile) {
        assert.equal(
          await page.evaluate(() => window.readStates.every((state) => state === 'all')),
          true,
          'Local status filtering does not change collection fetch state',
        )
        const title = rows.first().getByText('Release desktop', { exact: true })
        const status = rows.first().getByText('Passed', { exact: true })
        assert.ok(
          (await status.boundingBox()).y < (await title.boundingBox()).y,
          'Status precedes title',
        )
        await rows.first().click()
        assert.equal(await page.evaluate(() => window.opened), '/pipeline/0')
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${isMobile ? 'Mobile' : 'Desktop'} overflow at ${width}`,
      )
      if (width === 320) {
        await page.evaluate(() => {
          window.runs.push({
            ...window.runs[0],
            id: 'long',
            status: 'provider_' + 'status'.repeat(20),
            title: 'A_very_long_pipeline_title_'.repeat(12),
            ref: 'feature_branch_'.repeat(20),
          })
          window.render()
        })
        const unknown = page.getByRole('button', { name: /^Filter Provider / })
        await unknown.click()
        assert.equal(await rows.count(), 1)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          'Long provider states and run titles stay within narrow layouts',
        )
      }
      for (const button of await page.getByRole('button').all()) {
        if (!(await button.isVisible())) continue
        const bounds = await button.boundingBox()
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          `Action stays within ${width}px viewport: ${(await button.getAttribute('aria-label')) ?? (await button.innerText())}`,
        )
      }
      assert.deepEqual(errors, [])
      await page.screenshot({
        path: `/tmp/dovo-pipeline-overhaul/${isMobile ? 'mobile' : 'desktop'}-${width}.png`,
        fullPage: true,
      })
      await page.evaluate(() => {
        window.sources[0].connected = true
        window.mode = 'issues'
        window.runs = [
          {
            id: '42',
            title: 'Fix layout jumps',
            state: 'open',
            type: 'Issue',
            author: 'Dominic',
            assignees: [],
            labels: [],
            url: 'https://github.com/team/repo/issues/42',
            updatedAt: '2026-10-23T12:00:00Z',
          },
        ]
        window.render()
      })
      await rows.first().getByText('Fix layout jumps', { exact: true }).waitFor()
      const issueGeometry = await firstRowGeometry()
      const issueSubtitle = await page.locator('header p').allTextContents()
      await page
        .getByRole('button', { name: isMobile ? 'Refresh issues' : 'Refresh', exact: true })
        .click()
      await page.getByText('Updating issues…', { exact: true }).waitFor()
      assert.deepEqual(
        await firstRowGeometry(),
        issueGeometry,
        'Issue refresh preserves row geometry',
      )
      if (isMobile)
        assert.deepEqual(
          await page.locator('header p').allTextContents(),
          issueSubtitle,
          'Issue subtitle stays steady while updating',
        )
      await page.evaluate(() => window.finishRefresh())
      await page.getByText('Updating issues…', { exact: true }).waitFor({ state: 'hidden' })
      assert.deepEqual(await firstRowGeometry(), issueGeometry)
      await page.evaluate(() => {
        window.runs = []
        window.refreshing = true
        window.render()
      })
      await page.getByText('Loading issues…', { exact: true }).waitFor()
      assert.equal(
        await page.getByText('No issues found', { exact: true }).count(),
        0,
        'Initial loading does not flash empty results',
      )
      await page.evaluate(() => window.finishRefresh())
      await page
        .getByText(isMobile ? 'No issues found' : 'Your issues, in one place', { exact: true })
        .waitFor()
      assert.deepEqual(errors, [])
      await page.close()
    }
  console.log(
    'Pipeline lists: status aliases, search, keyboard filtering, zero results, pagination, offline rows, PR commit scope and narrow layouts passed.',
  )
} finally {
  await browser.close()
}
