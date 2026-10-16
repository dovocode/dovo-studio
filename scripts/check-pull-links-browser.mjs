import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `import {useState} from 'react';export const useApplicationState=useState;`
const controls = `import {useImperativeHandle} from "react";export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as ContextMenu from '@radix-ui/react-context-menu';export const Button=({children,onClick,disabled,...props})=><button disabled={disabled} onClick={onClick} {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id} disabled={item.disabled}>{item.name}</option>)}</select>;export const ChoicePicker=({children,value,onValueChange,...props})=><select value={value} onChange={e=>onValueChange(e.target.value)} {...props}>{children}</select>;export const Badge=({children})=><span>{children}</span>;export const SidebarHeader=()=>null;export const useLeftSidebar=()=>[true];export const PageHeader=({title,children})=><header><h1>{title}</h1>{children}</header>;export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;export const DialogHeader=DialogContent;export const Text=({children})=><div>{children}</div>;export const View=Text;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SearchField=({label,value,onChangeText,...props})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)} {...props}/>;export const FlatList=({data,renderItem,ListEmptyComponent})=><div>{data.length?data.map((item,i)=><div key={i}>{renderItem({item})}</div>):ListEmptyComponent}</div>;export const Pressable=({children,onPress,disabled,accessibilityRole})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const useSheetNavigation=()=>(navigate)=>navigate();export const Sheet=({title,children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose?.();after?.()}}));return <section><h2>{title}</h2>{children}</section>};export const SafeModal=()=>null;export const Keyboard={dismiss:()=>{}};export const colors={};export const useTheme=()=>({styles:{},colors,mode:'dark'});export const Alert={alert:(...args)=>window.alerts.push(args)};export const Linking={openURL:async url=>window.external.push(url)};`
const setup = `const pull=number=>({number,title:'PR '+number,url:'https://github.com/team/project/pull/'+number,state:'open',draft:false,author:'Dominic',updatedAt:'2026-10-03',head:'branch'+number,base:'main',labels:[]});window.pulls=[pull(1),pull(2),pull(3)];const source={key:'source',scope:'scope',runtimeId:'mac',runtimeName:'Mac',connected:true,repository:{id:'repo',name:'Project',gitIdentity:'github.com/team/project'}};const remote={profile:{id:'linux',name:'Linux',connection:{address:'http://linux.local',token:'paired'}},connected:true,snapshot:{workspace:{repositories:[{id:'other',name:'Other project'}],tasks:[{id:'remote-thread',title:'Foreign thread',repositoryId:'other'}]}}};window.sources=[source];window.writes=[];window.alerts=[];window.external=[];window.routes=[];window.store={activeRuntimeId:'mac',profile:{id:'mac'},workspace:{repositories:[source.repository],tasks:[]},runtimes:[remote],overviews:[remote,{profile:{id:'mac',name:'Mac',connection:{address:'http://mac.local',token:'paired'}},snapshot:{workspace:{repositories:[source.repository]}}}],switchRuntime:async()=>{},readRuntime:async(profile,path,input)=>{window.writes.push({profile,path,input});return {ok:true}},refreshRuntime:async()=>{}};`
const browser = await chromium.launch()
async function bundle(contents, mobile = false) {
  const mocks = {
    '@dovo/studio-core': `export const WorkspaceRuntimeScope=({children})=>children;export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({goBack:()=>window.goBack?.()??false,navigate:target=>{(window.prNavigations??=[]).push(target);window.onNavigate?.(target)}});export const repositorySourceKey=(r,p)=>JSON.stringify([r,p]);export const formatDateTime=x=>x;`,
    '@dovo/studio-core/state': state,
    '@dovo/studio-ui': controls,
    './use-pulls': `export const usePulls=()=>({sources:window.sources,pages:[{source:window.sources[0],reader:window.sources[0],pulls:window.pulls}],busy:false,connected:true,more:()=>{},refresh:()=>{}});`,
    '../detail/status': `export const Signal=()=>null;`,
    '../detail/detail': `export const PullDetail=({number,initialTab,initialFragment,onBack})=><section data-testid="detail" data-tab={initialTab} data-fragment={initialFragment}><p>Native PR detail {number}</p><button onClick={onBack}>Back to PRs</button></section>;`,
    './create': `export const CreatePull=()=>null;`,
    '../../connections/forge-connections': `export const ForgeConnections=()=>null;export const useForgeConnections=()=>({connections:[]});`,
    '../../connections/source-picker': `export const SourcePicker=()=>null;`,
    'react-native': controls,
    'react-native-webview': `export default function WebView(){return null}`,
    'expo-clipboard': `export const setStringAsync=async()=>{};`,
    'expo-router': `export const usePathname=()=>'/pull';export const router={push:href=>window.routes.push(href)};`,
  }
  const output = await build({
    stdin: { contents, loader: 'tsx', resolveDir: root },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
    plugins: [
      {
        name: 'mocks',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            if (mocks[path]) return { path, namespace: 'mock' }
            if (mobile && /runtime\/state\/application-state$/.test(path))
              return { path: 'state', namespace: 'mock' }
            if (mobile && /runtime\/connection\/provider$/.test(path))
              return { path: 'runtime', namespace: 'mock' }
            if (
              mobile &&
              path.startsWith('.') &&
              /ui\/|^\.\.\/(layout|controls)\/|^\.\/text$|^\.\.\/theme$/.test(path)
            )
              return { path: 'controls', namespace: 'mock' }
          })
          b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'state'
                ? state
                : path === 'runtime'
                  ? 'export const useRuntime=()=>window.store;'
                  : path === 'controls'
                    ? controls
                    : mocks[path],
            loader: 'tsx',
            resolveDir: root + '/packages/studio-ui',
          }))
        },
      },
    ],
  })
  return output.outputFiles[0].text
}
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({
    content: await bundle(
      `import {createRoot} from 'react-dom/client';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';${setup}createRoot(document.getElementById('app')).render(<View/>);`,
    ),
  })
  const rows = page.getByRole('button').filter({ hasText: /PR [123]/ })
  await rows.nth(0).click({ modifiers: ['Meta'] })
  await rows.nth(2).click({ modifiers: ['Shift'] })
  await page.getByText('3 PRs selected', { exact: true }).waitFor()
  await rows.nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to thread (3 PRs)', exact: true }).click()
  await page.getByRole('button', { name: /Foreign thread/ }).click()
  await page.waitForFunction(() => window.writes.length === 1)
  let write = await page.evaluate(() => window.writes[0])
  assert.equal(write.profile.id, 'linux')
  assert.equal(write.input.id, 'remote-thread')
  assert.deepEqual(
    write.input.pulls.map((p) => p.number).sort((a, b) => a - b),
    [1, 2, 3],
  )
  assert.equal(write.path, '/api/scm/pulls/link-thread')
  assert.deepEqual(errors, [])
  console.log(
    'Desktop: modifier/range selection, real right-click menu and cross-project/computer thread linking passed.',
  )
  await page.close()
  const linkedPage = await browser.newPage()
  await linkedPage.setContent('<div id="app"></div>')
  await linkedPage.addScriptTag({
    content: await bundle(
      `import {createRoot} from 'react-dom/client';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';${setup}const rootView=createRoot(document.getElementById('app'));window.entity='https://github.com/team/project/pull/42/files#note';window.nonce=0;window.mount=()=>rootView.render(<View entityId={window.entity} pullTarget={window.pullTarget} navigationKey={window.nonce++}/>);window.onNavigate=target=>{window.entity=target.entityId;window.pullTarget=target.pullTarget;window.mount()};window.mount();`,
    ),
  })
  await linkedPage.getByText('Native PR detail 42', { exact: true }).waitFor()
  assert.equal(await linkedPage.getByTestId('detail').getAttribute('data-tab'), 'changes')
  assert.equal(await linkedPage.getByTestId('detail').getAttribute('data-fragment'), '#note')
  await linkedPage.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await linkedPage.getByTestId('detail').waitFor({ state: 'detached' })
  assert.deepEqual(await linkedPage.evaluate(() => window.prNavigations.at(-1)), {
    viewId: 'pulls',
  })
  await linkedPage.evaluate(() => {
    window.pullTarget = undefined
    window.entity = 'https://github.com/team/project/pull/42/checks'
    window.mount()
  })
  await linkedPage.getByText('Native PR detail 42', { exact: true }).waitFor()
  assert.equal(await linkedPage.getByTestId('detail').getAttribute('data-tab'), 'checks')
  await linkedPage.getByRole('button').filter({ hasText: 'PR 2' }).first().click()
  await linkedPage.getByText('Native PR detail 2', { exact: true }).waitFor()
  assert.equal(
    await linkedPage.evaluate(() => window.prNavigations.at(-1).entityId),
    'https://github.com/team/project/pull/2',
  )
  await linkedPage.evaluate(() => {
    window.pullTarget = undefined
    window.entity = 'https://github.com/team/project/pull/42/checks'
    window.mount()
  })
  await linkedPage.getByText('Native PR detail 42', { exact: true }).waitFor()
  // Explicit navigation to the same target still reopens it.
  await linkedPage.evaluate(() => window.mount())
  await linkedPage.getByText('Native PR detail 42', { exact: true }).waitFor()

  await linkedPage.evaluate(() => {
    window.pullTarget = undefined
    window.entity = undefined
    window.mount()
  })
  await linkedPage.getByTestId('detail').waitFor({ state: 'detached' })
  await linkedPage.evaluate(() => {
    window.pullTarget = undefined
    window.entity = 'https://github.com/team/project/pull/42/checks'
    window.mount()
  })
  await linkedPage.getByText('Native PR detail 42', { exact: true }).waitFor()

  await linkedPage.evaluate(() => {
    window.pullTarget = undefined
    window.entity = 'https://github.com/unlinked/project/pull/123/files#note'
    window.mount()
  })
  await linkedPage.getByText('Native PR detail 123', { exact: true }).waitFor()
  assert.equal(await linkedPage.getByTestId('detail').getAttribute('data-tab'), 'changes')
  assert.equal(await linkedPage.getByTestId('detail').getAttribute('data-fragment'), '#note')

  const navigationsBeforeBack = await linkedPage.evaluate(() => window.prNavigations.length)
  await linkedPage.evaluate(() => {
    window.goBack = () => {
      window.historyReturned = true
      return true
    }
  })
  await linkedPage.getByRole('button', { name: 'Back to PRs', exact: true }).click()
  await linkedPage.waitForFunction(() => window.historyReturned === true)
  assert.equal(
    await linkedPage.evaluate(() => window.prNavigations.length),
    navigationsBeforeBack,
    'Back ignored shell history',
  )

  await linkedPage.close()
  const foreign = await browser.newPage()
  await foreign.setContent('<div id="app"></div>')
  await foreign.addScriptTag({
    content: await bundle(
      `import {createRoot} from 'react-dom/client';import View from '${root}/packages/extension-scm/src/pulls/list/view.tsx';${setup}createRoot(document.getElementById('app')).render(<View entityId="https://github.com/unlinked/project/pull/123/files#note" pullTarget={{runtimeId:"linux",number:123,url:"https://github.com/unlinked/project/pull/123/files#note"}}/>);`,
    ),
  })
  await foreign.getByText('Native PR detail 123', { exact: true }).waitFor()
  await foreign.close()
  console.log(
    'Desktop: URL navigation opens linked and unlinked PRs not present in the loaded list.',
  )
  const mobile = await browser.newPage()
  mobile.setDefaultTimeout(8000)
  await mobile.setContent('<div id="app"></div>')
  await mobile.addScriptTag({
    content: await bundle(
      `import {createRoot} from 'react-dom/client';import {AddPullsToThread} from '${root}/apps/mobile/src/scm/pulls/list/add-to-thread.tsx';import {LinkBrowser,openAppLink} from '${root}/apps/mobile/src/ui/content/open-link.tsx';${setup}window.openAppLink=openAppLink;createRoot(document.getElementById('app')).render(<><AddPullsToThread pulls={window.pulls.slice(0,2)} onClose={()=>{}}/><LinkBrowser/></>);`,
      true,
    ),
  })
  await mobile.getByRole('button', { name: /Foreign thread/ }).click()
  await mobile.waitForFunction(() => window.writes.length === 1)
  write = await mobile.evaluate(() => window.writes[0])
  assert.equal(write.profile.id, 'linux')
  assert.deepEqual(
    write.input.pulls.map((p) => p.number),
    [1, 2],
  )
  await mobile.evaluate(() =>
    window.openAppLink('https://github.com/team/project/pull/7/files#note'),
  )
  await mobile.getByRole('button', { name: 'Open PR details', exact: true }).click()
  const route = await mobile.evaluate(() => window.routes[0])
  assert.equal(route.params.runtimeId, 'mac')
  assert.equal(route.params.repositoryId, 'repo')
  assert.equal(route.params.number, '7')
  assert.equal(await mobile.evaluate(() => window.alerts.length), 0)
  await mobile.evaluate(() =>
    window.openAppLink('https://github.com/unlinked/project/pull/123/files#note', false, {
      runtimeId: 'mac',
    }),
  )
  await mobile.getByRole('button', { name: 'Open PR details', exact: true }).click()
  assert.equal(
    await mobile.evaluate(() => window.routes.at(-1).params.repositoryId),
    'https://github.com/unlinked/project/pull/123',
  )
  assert.equal(await mobile.evaluate(() => window.alerts.length), 0)
  await mobile.evaluate(() => window.openAppLink('https://github.com/team/project/pull/7', true))
  assert.equal(await mobile.evaluate(() => window.external.length), 1)
  console.log(
    'Mobile: cross-project/computer thread picker, native GitHub link routing and explicit external browser passed.',
  )
  await mobile.close()
} finally {
  await browser.close()
}
