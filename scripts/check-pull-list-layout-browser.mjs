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
window.prPreferences={pullProjectVisibility:{}};window.sources=['mac','backup'].map(id=>({key:id,scope:id,runtimeId:id,runtimeName:id==='mac'?'Mac Studio':'MacBook',computerName:id==='mac'?'Mac Studio':'MacBook',connected:true,repository:{id:'repo',name:'Dovo Studio',path:'/repo'},profile:{id,connection:{address:'http://'+id,token:'paired'}}}));
const base={state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-23T12:00:00Z',head:'feature',base:'main',labels:['ui'],additions:24,deletions:8,commentCount:3,viewerIsAuthor:true};
window.pulls=[{...base,number:1,title:'Fix connection',head:'fix/runtime-reconnection-and-queued-thread-continuity-with-a-long-qualified-branch',base:'feature/preserve-active-thread-context',checksState:'FAILURE',reviewDecision:'CHANGES_REQUESTED',viewerReviewRequested:true,labels:['runtime','needs-review','ui'],stack:{position:2,size:3,rootNumber:6,parentNumber:6,complete:true}},{...base,number:2,title:'Ready to ship',head:'patch/focus',checksState:'SUCCESS',reviewDecision:'APPROVED'},{...base,number:3,title:'Draft feature',draft:true,head:'feature/long-project-selection-state-when-the-runtime-reconnects'},{...base,number:4,title:'Waiting for checks',checksState:'PENDING'},{...base,number:5,title:'Shipped change',state:'merged'}].map(pull=>({...pull,url:'https://github.com/team/studio/pull/'+pull.number}));
window.pages=()=>window.sources.map((source,index)=>({source,reader:source,error:window.sourceErrors?.[source.key],pulls:window.emptySources?.includes(source.key)?[]:index?window.pulls.slice(0,2).map(pull=>({...pull,url:pull.url+'/'})):window.pulls,runtimeId:source.runtimeId,runtimeName:source.runtimeName,sourceKey:source.key,connected:source.connected,readConnected:source.connected,repositoryId:'repo',name:source.repository.name}));
window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.copied.push(value)}});
`
const native = `
const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style??{};
const nativeStyle=style=>{const result={...flat(style)};for(const[key,axes]of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(key in result){for(const axis of axes)result[axis]=result[key];delete result[key]}};return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined))};
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minWidth:0,...nativeStyle(style)}}>{children}</div>;
export const Text=({children,style,numberOfLines,accessibilityLabel})=><span aria-label={accessibilityLabel} style={{minWidth:0,overflowWrap:'anywhere',...nativeStyle(style),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}}>{children}</span>;
export const Pressable=({children,onPress,onLongPress,style,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress} onContextMenu={event=>{event.preventDefault();onLongPress?.()}} style={{display:'flex',flexDirection:'column',textAlign:'left',color:'inherit',font:'inherit',backgroundColor:'transparent',border:0,...nativeStyle(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent,ListEmptyComponent,contentContainerStyle})=><div style={nativeStyle(contentContainerStyle)}>{ListHeaderComponent}<div data-rows>{data.map((item,index)=><div key={keyExtractor(item)} style={{display:'flex',flexDirection:'column'}}>{renderItem({item,index})}</div>)}</div>{!data.length&&ListEmptyComponent}{ListFooterComponent}</div>;
export const Keyboard={dismiss:()=>{}};export const Alert={alert:(title,text,actions)=>window.alertActions=actions};
export const useTheme=()=>({colors:{text:'#24292f',surface:'#f6f8fa',selection:'#ddf4ff',accent:'#0969da',done:'#8250df',border:'#d0d7de',muted:'#57606a',error:'#cf222e',success:'#1a7f37',warning:'#9a6700'},styles:{screen:{padding:16,gap:12},row:{flexDirection:'row',alignItems:'center',gap:8},text:{fontSize:15,color:'#24292f'},muted:{fontSize:12,color:'#57606a'},empty:{padding:16,gap:8}}});
export const Icon=()=>null;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)} style={{boxSizing:'border-box',width:'100%',padding:10,font:'inherit'}}/>;
export const Choice=({label,value,onChange,items})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select>;
export const Sheet=({title,children,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close filters</button></section>;
export const ScreenHeader=({title,subtitle,buttons})=><header><h1 style={{fontSize:20}}>{title}</h1><p>{subtitle}</p>{buttons.map(button=><button key={button.label} onClick={button.onPress}>{button.label}</button>)}</header>;
`
async function bundle(isMobile) {
  const mocks = isMobile
    ? {
        'react-native': native,
        '../runtime/preferences/app-preferences': `export const useMobilePreferences=()=>window.prPreferences;export const updateMobilePreferences=changes=>{window.prPreferences={...window.prPreferences,...changes};window.render()};`,
        'expo-router': `export const router={push:href=>window.opened=href};`,
        '../../../ui/content/markdown': `export const Markdown=()=>null;`,
        '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
        '../runtime/connection/provider': `export const useRuntime=()=>({overviews:window.sources.map(source=>({profile:source.profile})),cacheForRuntime:()=>({})});`,
        '../shell/navigation': `export const useNavigation=()=>({focused:true});`,
        '../shell/source-route': `export const pullHref=(runtime,repo,number)=>'/'+runtime+'/pull/'+number;`,
        '../scm/pulls/list/use-pulls': `export const usePulls=(repositoryId)=>({sources:window.sources,pages:window.pages().filter(page=>!repositoryId||page.sourceKey===repositoryId),busy:false,connected:window.sources.some(source=>source.connected),refresh:()=>{window.refreshed=true},more:async key=>{window.retried=key},chooseSource:async()=>{}});`,
        '../runtime/state/collection-sources': `export const collectionSources=()=>window.sources;`,
        '../ui/layout/use-list-scroll': `export const useListScroll=()=>({retainPosition:()=>{}});`,
        '../scm/pulls/list/add-to-thread': `export const AddPullsToThread=()=>null;`,
        '../scm/pulls/list/create-pull': `export const CreatePull=()=>null;`,
        '../scm/pulls/list/pull-list-invalidation': `export const invalidatePullList=()=>{};`,
        '../runtime/connection/creation-target': `export const CreationTarget=()=>null;`,
        '../ui/content/open-link': `export const openAppLink=()=>{};`,
        '../ui/content/pull-request-icon': `export const PullRequestIcon=()=>null;`,
        '../scm/pulls/author-avatar': `export const AuthorAvatar=()=>null;`,
        '../scm/pulls/detail/pull-tabs': `export const PullTabs=({items,value,onChange})=><div>{items.map(item=><button key={item.id} aria-pressed={item.id===value} onClick={()=>onChange(item.id)}>{item.name}</button>)}</div>;`,
        ...Object.fromEntries(
          [
            '../theme',
            './text',
            '../controls/icon',
            '../ui/content/text',
            '../ui/theme',
            '../ui/controls/choice',
            '../ui/controls/action',
            '../ui/controls/icon',
            '../ui/layout/screen-header',
            '../ui/controls/field',
            '../ui/layout/sheet',
            '../../../ui/content/text',
            '../../../ui/controls/icon',
            '../../../ui/theme',
          ].map((path) => [path, native]),
        ),
      }
    : {
        '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
        '@dovo/studio-core': `export const useAppPreferences=()=>window.prPreferences;export const updateAppPreferences=changes=>{window.prPreferences={...window.prPreferences,...changes};window.render()};export * from '@dovo/protocol';export const useStudioHost=()=>({navigate:target=>window.opened=target});export const useWorkspace=()=>({activeRuntimeId:'mac',runtimes:window.sources.map(source=>({profile:source.profile})),workspace:{repositories:[],tasks:[]}});export const WorkspaceRuntimeScope=({children})=>children;export const repositorySourceKey=()=>'';export const formatDateTime=value=>'Oct 23';`,
        '@dovo/studio-ui': `export const MessageResponse=()=>null;export {PageHeader} from '${ui}page-header';export * from '${ui}sidebar-header';export {Button} from '${ui}components/ui/button';export {Input} from '${ui}components/ui/input';export {Badge} from '${ui}components/ui/badge';export {Disclosure} from '${ui}disclosure';export * from '${ui}components/ui/dialog';export {ChoicePicker} from '${ui}choice-picker';export * as ContextMenu from '@radix-ui/react-context-menu';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
        './use-pulls': `export const usePulls=()=>({sources:window.sources,pages:window.pages(),busy:!!window.refreshing,connected:window.sources.some(source=>source.connected),refresh:()=>{window.refreshed=true},more:async key=>{window.retried=key}});`,
        './add-to-thread': `export const AddPullsToThread=()=>null;`,
        '../detail/detail': `export const PullDetail=()=>null;`,
        './create': `export const CreatePull=()=>null;`,
        '../../connections/forge-connections': `export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[]});`,
        '../../connections/source-picker': `export const SourcePicker=()=>null;`,
        '../author-avatar': `export const AuthorAvatar=()=>null;`,
      }
  return build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import Screen from '${isMobile ? mobile + 'screens/pulls' : root + 'packages/extension-scm/src/pulls/list/view'}';${data}function App(){const[revision,setRevision]=useState(0);window.render=()=>setRevision(value=>value+1);return <Screen/>}createRoot(document.getElementById('app')).render(<App/>);`,
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
await mkdir('/tmp/dovo-pr-overhaul', { recursive: true })
const browser = await chromium.launch()
try {
  for (const isMobile of [false, true])
    for (const width of isMobile ? [320, 390, 1280] : [320, 390, 1100, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html><body style="margin:0;font-family:system-ui"><div id="app" style="height:100vh;display:flex;flex-direction:column"></div></body></html>',
      )
      if (!isMobile) await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: (isMobile ? mobileBundle : desktop).outputFiles[0].text })
      const search = page.getByRole('textbox', {
        name: isMobile ? 'Search PRs' : 'Search pull requests',
        exact: true,
      })
      await search.waitFor()
      if (!isMobile) {
        const metadata = page.locator('.studio-collection-meta').first()
        await metadata.waitFor()
        for (const [size, expected] of [
          ['small', 10.3125],
          ['large', 12.03125],
        ]) {
          await page.evaluate((size) => (document.documentElement.dataset.textSize = size), size)
          const rendered = await metadata.evaluate((node) =>
            parseFloat(getComputedStyle(node).fontSize),
          )
          assert.ok(
            Math.abs(rendered - expected) < 0.05,
            `${size}: collection metadata follows text size`,
          )
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          )
        }
        await page.evaluate(() => delete document.documentElement.dataset.textSize)
      }
      const rows = isMobile
        ? page.locator('[data-rows] > div > button')
        : page
            .locator(
              '[aria-label="Pull request rows"] button[aria-current], [aria-label="Pull request rows"] button',
            )
            .filter({ has: page.locator('p[title]') })
      const expectRows = async (count, message) => {
        await page.waitForFunction(
          ({ native, count }) =>
            document.querySelectorAll(
              native
                ? '[data-rows] > div > button'
                : '[aria-label="Pull request rows"] button:has(p[title])',
            ).length === count,
          { native: isMobile, count },
        )
        assert.equal(await rows.count(), count, message)
      }
      await expectRows(4, 'Duplicate source rows are merged')
      const first = rows.filter({ hasText: 'Fix connection' }).first()
      const title = first.getByText('Fix connection', { exact: true })
      assert.ok(
        (await first.getByText('Open', { exact: true }).boundingBox()).y <
          (await title.boundingBox()).y,
      )
      assert.ok(
        (
          await first
            .getByText(isMobile ? 'Dovo Studio' : 'Dovo Studio · Mac Studio', { exact: true })
            .boundingBox()
        ).y < (await title.boundingBox()).y,
      )
      for (const label of ['24 lines added', '8 lines deleted', '3 comments'])
        assert.equal(await first.getByLabel(label, { exact: true }).count(), 1)
      if (!isMobile) {
        const readiness = first.getByLabel('PR readiness', { exact: true })
        await readiness.getByText('Your review requested', { exact: true }).waitFor()
        await readiness.getByText('Changes requested', { exact: true }).waitFor()
        await first.getByText('Stack 2/3 · #6', { exact: true }).waitFor()
        const failure = readiness.getByText('Repository CI: failed', { exact: true })
        assert.notEqual(
          await failure.evaluate((node) => getComputedStyle(node).color),
          await failure.locator('svg').evaluate((node) => getComputedStyle(node).color),
          'Readiness reserves semantic color for its icon',
        )
        assert.equal(
          await first
            .getByLabel('24 lines added', { exact: true })
            .evaluate((node) => getComputedStyle(node).color),
          await first
            .locator('.studio-collection-context')
            .evaluate((node) => getComputedStyle(node).color),
          'Supporting metrics inherit neutral context color',
        )
        assert.equal(
          await first.getByLabel('Labels', { exact: true }).innerText(),
          'runtime\nneeds-review\n+1',
        )
        const assertReadinessBounds = async (wide) => {
          const context = await first.locator('[data-pull-context]').boundingBox()
          const status = await readiness.boundingBox()
          const body = await first.locator('.studio-collection-body').boundingBox()
          assert.ok(status.x >= body.x && status.x + status.width <= body.x + body.width + 1)
          if (wide) {
            assert.ok(status.x >= context.x + context.width, 'Readiness gets its own wide column')
            const other = await rows
              .filter({ hasText: 'Ready to ship' })
              .getByLabel('PR readiness', { exact: true })
              .boundingBox()
            assert.ok(Math.abs(status.x - other.x) < 1, 'Varied branches keep readiness aligned')
          } else {
            assert.ok(
              status.y >= context.y + context.height,
              'Readiness stacks below context in a narrow pane',
            )
          }
          const branch = first.locator(
            '[title="fix/runtime-reconnection-and-queued-thread-continuity-with-a-long-qualified-branch → feature/preserve-active-thread-context"]',
          )
          assert.ok(
            await branch
              .locator('[data-pull-branch-head]')
              .evaluate((node) => node.scrollWidth > node.clientWidth),
            'Long branches truncate with complete hover context',
          )
          const destination = await branch.locator('[data-pull-branch-base]').boundingBox()
          const branchBounds = await branch.boundingBox()
          assert.ok(destination.width > 16, 'Target branch remains independently visible')
          assert.ok(
            destination.x + destination.width <= branchBounds.x + branchBounds.width + 1,
            'Target branch stays within the row at narrow and wide sizes',
          )
        }
        await assertReadinessBounds(width >= 1100)
        if (width === 1100 || width === 1440) {
          const originalPulls = await page.evaluate(() => {
            const original = window.pulls
            window.pulls = window.pulls.map((pull) =>
              pull.number === 2
                ? {
                    ...window.pulls[0],
                    number: pull.number,
                    url: pull.url,
                    title: pull.title,
                    viewerReviewRequested: false,
                  }
                : pull,
            )
            window.render()
            return original
          })
          const other = rows.filter({ hasText: 'Ready to ship' })
          await other.getByText('Repository CI: failed', { exact: true }).waitFor()
          const requested = readiness.getByText('Your review requested', { exact: true })
          const review = readiness.getByText('Changes requested', { exact: true })
          const firstBounds = await first.boundingBox()
          const otherBounds = await other.boundingBox()
          assert.ok(
            Math.abs(firstBounds.height - otherBounds.height) < 1,
            `${width}px: alignment fixture has matching row heights`,
          )
          const ciBounds = await failure.boundingBox()
          const otherCiBounds = await other
            .getByText('Repository CI: failed', { exact: true })
            .boundingBox()
          assert.ok(
            Math.abs(ciBounds.x - otherCiBounds.x) < 1 &&
              Math.abs(ciBounds.y - firstBounds.y - (otherCiBounds.y - otherBounds.y)) < 1,
            `${width}px: CI aligns across rows with and without a viewer review request`,
          )
          assert.ok(ciBounds.y < (await review.boundingBox()).y, 'Repository CI appears first')
          assert.ok(
            (await review.boundingBox()).y < (await requested.boundingBox()).y,
            'Review decision precedes the viewer request flag',
          )
          assert.equal(await other.getByText('Your review requested', { exact: true }).count(), 0)
          await page.evaluate((pulls) => {
            window.pulls = pulls
            window.render()
          }, originalPulls)
          await other.getByText('Repository CI: passed', { exact: true }).waitFor()
        }
        if (width === 1280) {
          const sidebar = page.getByRole('navigation', {
            name: 'Pull request sidebar',
            exact: true,
          })
          await sidebar.evaluate((node) => {
            node.style.width = '420px'
            node.style.flex = '0 0 auto'
          })
          await assertReadinessBounds(false)
          await sidebar.evaluate((node) => {
            node.style.removeProperty('width')
            node.style.removeProperty('flex')
          })
          await assertReadinessBounds(true)
        }
      }
      await page.evaluate(() => {
        window.sourceErrors = { backup: 'Forge access expired' }
        window.emptySources = ['backup']
        window.render()
      })
      await expectRows(4, 'A failed source preserves healthy results')
      const failure = page.getByText('Dovo Studio · MacBook: Forge access expired', { exact: true })
      assert.equal(await failure.isVisible(), false, 'Transient source errors stay collapsed')
      if (isMobile)
        await page.getByRole('button', { name: 'Sources · 1 pending', exact: true }).click()
      else await page.locator('summary').filter({ hasText: 'Sources · 1 pending' }).click()
      await failure.waitFor()
      assert.ok(
        (await failure.boundingBox()).y < (await first.boundingBox()).y,
        'Source errors appear before results',
      )
      const retry = page.getByRole('button', { name: 'Retry · Dovo Studio · MacBook', exact: true })
      assert.equal(await retry.count(), 1, 'Retry is not duplicated below the list')
      await retry.click()
      assert.equal(await page.evaluate(() => window.refreshed), true)
      await page.evaluate(() => {
        window.sourceErrors.mac = 'Network unavailable'
        window.emptySources = ['mac', 'backup']
        window.render()
      })
      await expectRows(0)
      await page
        .getByText(isMobile ? 'Waiting for project sources' : 'Waiting for project sources.', {
          exact: true,
        })
        .waitFor()
      await page.evaluate(() => {
        window.sources[1].connected = false
        window.render()
      })
      assert.equal(await retry.isDisabled(), true, 'Offline sources cannot retry until reconnected')
      await page.getByText('Reconnect this source to retry.', { exact: true }).waitFor()
      await page.evaluate(() => {
        window.sourceErrors = {}
        window.emptySources = []
        window.sources[1].connected = true
        window.render()
      })
      await expectRows(4)
      assert.equal(await retry.count(), 0, 'Recovered sources clear their error actions')
      if (isMobile) {
        assert.equal(
          await page
            .getByRole('button', { name: 'Show PRs needing attention', exact: true })
            .innerText(),
          '2 need attention',
        )
        await search.fill('Fix')
        await page
          .getByRole('button', { name: 'Show PRs needing attention', exact: true })
          .getByText('1 needs attention', { exact: true })
          .waitFor()
        await page.getByRole('button', { name: 'Show PRs needing attention', exact: true }).click()
        await search.fill('Waiting')
        const toggle = page.getByRole('button', { name: 'Show all PRs', exact: true })
        await toggle.getByText('0 need attention', { exact: true }).waitFor()
        await expectRows(0)
        await toggle.click()
        await expectRows(1, 'An empty attention filter can be cleared without opening a sheet')
        await search.fill('Impossible match')
        await expectRows(0)
        await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
        await expectRows(4, 'Clear filters recovers from zero results')
        assert.equal(await search.inputValue(), '')
        await page.getByRole('button', { name: 'Merged', exact: true }).click()
        await expectRows(1)
        assert.equal(
          await rows.first().getByText('Merged', { exact: true }).count(),
          1,
          'Closed states appear once',
        )
        await page.getByRole('button', { name: 'Open', exact: true }).click()
        await page.getByRole('button', { name: 'PR filters', exact: true }).click()
        const visibility = page.getByRole('combobox', {
          name: 'PR visibility for Dovo Studio · Mac Studio',
          exact: true,
        })
        await visibility.selectOption('mine')
        assert.equal(
          await page.evaluate(() => window.prPreferences.pullProjectVisibility.mac),
          'mine',
        )
        await visibility.selectOption('hidden')
        assert.equal(
          await page.evaluate(() => window.prPreferences.pullProjectVisibility.mac),
          'hidden',
        )
        await page.getByRole('button', { name: 'Show all projects', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.prPreferences.pullProjectVisibility), {})
        await page.getByRole('combobox', { name: 'Repository', exact: true }).selectOption('mac')
        await page.getByRole('button', { name: 'Close filters', exact: true }).click()
        assert.ok(
          (await page.getByText('Dovo Studio', { exact: true }).count()) > 0,
          'Source caption reflects selected repository',
        )
      } else {
        const initialRow = await first.boundingBox()
        await page.evaluate(() => {
          window.refreshing = true
          window.render()
        })
        await page.getByRole('status').filter({ hasText: 'Updating pull requests…' }).waitFor()
        assert.deepEqual(
          await first.boundingBox(),
          initialRow,
          'Refreshing keeps visible PR rows in place',
        )
        await page.evaluate(() => {
          window.refreshing = false
          window.render()
        })
        if (width === 1280) {
          const grid = first
          const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
          await page.evaluate(() => {
            window.pulls = window.pulls.map((pull) =>
              pull.number === 1
                ? { ...pull, checksState: undefined, reviewDecision: undefined }
                : pull,
            )
            window.render()
          })
          await first
            .getByText('Repository CI: failed', { exact: true })
            .waitFor({ state: 'detached' })
          assert.equal(
            await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns),
            columns,
            'Delayed check data keeps the same title and date columns',
          )
          assert.equal(
            await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns),
            await rows
              .filter({ hasText: 'Draft feature' })
              .first()
              .evaluate((node) => getComputedStyle(node).gridTemplateColumns),
            'PR rows align with and without check data',
          )
          await page.evaluate(() => {
            window.pulls = window.pulls.map((pull) =>
              pull.number === 1 ? { ...pull, checksState: 'FAILURE' } : pull,
            )
            window.render()
          })
        }
        assert.equal(
          await page
            .getByRole('button', { name: 'Filters', exact: true })
            .getAttribute('aria-expanded'),
          'false',
        )
        await search.fill('Fix')
        await expectRows(1)
        await page.getByRole('button', { name: 'Clear PR search', exact: true }).click()
        assert.equal(await search.inputValue(), '')
        assert.equal(await search.evaluate((el) => el === document.activeElement), true)
        await page.getByRole('button', { name: 'Filters', exact: true }).click()
        const visibility = page.getByRole('button', {
          name: 'PR visibility for Dovo Studio · Mac Studio',
          exact: true,
        })
        await visibility.click()
        await page.getByRole('option', { name: 'My PRs', exact: true }).click()
        assert.equal(
          await page.evaluate(() => window.prPreferences.pullProjectVisibility.mac),
          'mine',
        )
        await visibility.click()
        await page.getByRole('option', { name: 'Hidden', exact: true }).click()
        assert.equal(
          await page.evaluate(() => window.prPreferences.pullProjectVisibility.mac),
          'hidden',
        )
        await page.getByRole('button', { name: 'Show all projects', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.prPreferences.pullProjectVisibility), {})
        await page.getByRole('button', { name: 'Filters', exact: true }).click()
        assert.equal(await search.isVisible(), true)
        await first.focus()
        await first.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'Copy title', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Actions for PR #1', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Copy PR link', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.copied), [
          'https://github.com/team/studio/pull/1',
        ])
      }
      await page.evaluate(() => {
        window.sources.forEach((source) => (source.connected = false))
        window.render()
      })
      await search.fill('Ready')
      await expectRows(1, 'Saved rows remain searchable offline')
      await search.fill('')
      await expectRows(4)
      await page.screenshot({
        path: `/tmp/dovo-pr-overhaul/${isMobile ? 'mobile' : 'desktop'}-${width}.png`,
        fullPage: true,
      })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      for (const button of await page.getByRole('button').all()) {
        if (!(await button.isVisible())) continue
        if (
          !isMobile &&
          (await button.evaluate(
            (el) => !!el.closest('[aria-label="Personal pull request filters"]'),
          ))
        )
          continue
        const bounds = await button.boundingBox()
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          `Action fits at ${width}px: ${(await button.getAttribute('aria-label')) ?? (await button.innerText())}`,
        )
      }
      assert.deepEqual(errors, [])
      if (!isMobile && width === 1280) {
        await first.click()
        await first.and(page.locator('[aria-current="true"]')).waitFor()
        assert.equal(
          await first.getAttribute('aria-current'),
          'true',
          'Opening a row preserves its selection',
        )
        assert.equal(
          await first.getByLabel('Labels', { exact: true }).count(),
          0,
          'Compact overview preserves its label policy',
        )
        const context = await first.locator('[data-pull-context]').boundingBox()
        const readiness = await first.getByLabel('PR readiness', { exact: true }).boundingBox()
        assert.ok(
          readiness.y >= context.y + context.height,
          'A compact overview stacks readiness at a wide viewport',
        )
        for (const label of ['24 lines added', '8 lines deleted', '3 comments'])
          assert.equal(await first.getByLabel(label, { exact: true }).count(), 1)
        await page.screenshot({
          path: '/tmp/dovo-pr-overhaul/desktop-compact-1280.png',
          fullPage: true,
        })
      }
      await page.close()
    }
  console.log(
    'PR lists: project/state hierarchy, visible search, clear-search focus, change metrics, CI-first status alignment at 1440/1100px, source menus, deduplicated attention counts, zero-count recovery, offline search and narrow layouts passed.',
  )
} finally {
  await browser.close()
}
