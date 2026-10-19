import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `
export const Button=({children,onClick})=><button onClick={onClick}>{children}</button>;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const Text=({children})=><span>{children}</span>;export const View=({children})=><div>{children}</div>;
export const PageHeader=({title})=><h1>{title}</h1>;
export const ScreenHeader=({title,leading})=><header>{leading}<h1>{title}</h1></header>;
export const ActivityIndicator=()=> <span>Loading</span>;export const Keyboard={dismiss:()=>{}};
export const Dialog=()=>null;export const DialogContent=()=>null;export const DialogHeader=()=>null;export const DialogTitle=()=>null;export const DialogDescription=()=>null;
export const useTheme=()=>({styles:{},colors:{}});
`
async function bundle(mobile) {
  const mocks = {
    '@dovo/studio-core': `export const useWorkspace=()=>window.store;export const useRuntimeSources=()=>window.store.runtimes;export const useStudioHost=()=>window.host;export const WorkspaceScope=({children})=>children;`,
    '@dovo/studio-core/state': `import {useState} from 'react';export const useApplicationState=useState;`,
    '@dovo/studio-ui': controls,
    'react-native': controls,
    'expo-crypto': 'export const randomUUID=()=>"draft-id";',
    'expo-router': `export const Redirect=()=>null;export const useLocalSearchParams=()=>window.params;export const router={setParams:changes=>{window.params={...window.params,...changes};window.render();},replace:target=>window.routes.push(target),push:target=>window.routes.push(target),canGoBack:()=>false};`,
    './account-panel': 'export const AccountPanel=()=>null;',
    './runtime-icon-settings': 'export const RuntimeIconSettings=()=>null;',
    './runtime-diagnostics': 'export const RuntimeDiagnosticsPanel=()=>null;',
    './index': 'export const runtimeExtension={views:[]};',
    './windows-runtime': 'export const WindowsRuntimeSettings=()=>null;',
    './device-manager': 'export const DeviceManager=()=>null;',
    './pairing-client': `export const PairingClient=({discovered})=>discovered?<div>Pairing credentials required {window.store.runtimeRegistry.profiles.map(p=><span key={p.id}>{p.name}</span>)}</div>:null;`,
    '../../runtime/connection/pair-computer': `export const PairComputer=()=> <div>Pairing credentials required {window.store.profiles.map(p=><span key={p.id}>{p.name}</span>)}</div>;`,
    '../../runtime/connection/provider': 'export const useRuntime=()=>window.store;',
    '../../shell/navigation':
      'export const useNavigation=()=>({focused:window.focused??true,navigate:()=>{}});',
    '../runtime/connection/provider': 'export const useRuntime=()=>window.store;',
    './navigation': 'export const useNavigation=()=>({focused:window.focused??true});',
    '../runtime/state/application-state': `import {useState} from 'react';export const useApplicationState=useState;`,
    '../runtime/state/native-effect':
      'import {Effect} from "effect";export const nativeEffect=fn=>Effect.tryPromise(fn);',
    '../creation/startup-thread': 'export const StartupThread=()=>null;',
    './task-detail':
      'export const TaskDetail=({task,parentNavigation})=><div><h2>{task.title}</h2>{parentNavigation}</div>;',
    '../../ui/controls/use-action':
      'export const useAction=()=>({busy:false,error:"",act:fn=>fn()});',
  }
  const code = `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
    ${mobile ? `import {TaskRouteScreen as Screen} from '${root}/apps/mobile/src/tasks/detail/task-route-screen.tsx';` : `import Screen from '${root}/packages/extension-runtime/src/view.tsx';`}
    window.destination={runtimeId:'foreign-profile',runtimeIdentity:'child-identity',threadId:'selected-child',title:'Selected child',parent:{runtimeId:'parent-profile',runtimeIdentity:'parent-identity',threadId:'coordinator',title:'Parent thread'}};
    window.params={runtimeId:'foreign-profile',runtimeIdentity:'child-identity',taskId:'selected-child',parentRuntimeId:'parent-profile',parentRuntimeIdentity:'parent-identity',parentTaskId:'coordinator',parentTitle:'Parent thread'};
    window.routes=[];window.switches=[];window.host={openThread:target=>window.routes.push(target),navigate:target=>window.routes.push(target)};
    window.store={runtimeRegistry:{profiles:[]},runtimes:[],profiles:[],overviews:[],ready:true,activeId:'local',snapshot:null,connected:true,selectRuntime:()=>{},selectRuntimeEffect:id=>Effect.sync(()=>{window.switches.push(id);window.store={...window.store,activeId:id,snapshot:window.store.overviews.find(s=>s.profile.id===id)?.snapshot};window.render()})};
    const root=createRoot(document.getElementById('app'));
    window.render=()=>root.render(${mobile ? '<Screen/>' : '<Screen threadConnection={window.destination}/>'});
    window.pair=(id,identity,name)=>{
      const profile={id,name,connection:{address:'http://computer.lan:51464',token:'pairing-remains-required',runtimeId:identity}};
      const snapshot={runtimeId:identity,workspace:{tasks:[{id:'selected-child',title:'Opened selected child',repositoryId:'repo',status:'review'}]},questions:[],approvals:[]};
      const source={profile,snapshot,connected:true,name};
      window.store={...window.store,profiles:[...window.store.profiles,profile],runtimeRegistry:{profiles:[...window.store.profiles,profile]},runtimes:[...window.store.runtimes,source],overviews:[...window.store.overviews,source]};window.render();
    };window.render();`
  const result = await build({
    stdin: { contents: code, loader: 'tsx', resolveDir: root },
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
        name: 'boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            if (mocks[path]) return { path, namespace: 'mock' }
            if (path.startsWith('.') && /\/ui\//.test(path))
              return { path: 'controls', namespace: 'mock' }
          })
          b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path] ?? controls,
            loader: 'tsx',
            resolveDir: root + '/packages/studio-ui',
          }))
        },
      },
    ],
  })
  return result.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    await page.getByRole('button', { name: 'Pair thread computer', exact: true }).click()
    await page.getByText(/Pairing credentials required/).waitFor()
    await page.evaluate(() => window.pair('foreign-profile', 'wrong-identity', 'Wrong computer'))
    await page.getByText('Wrong computer', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.routes), [])
    assert.deepEqual(await page.evaluate(() => window.switches), [])
    if (mobile)
      await page.evaluate(() => {
        window.focused = false
      })
    await page.evaluate(() => window.pair('new-profile', 'child-identity', 'Correct computer'))
    if (mobile) {
      await page.getByText('Opening on Correct computer…', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.params.runtimeId), 'foreign-profile')
      assert.deepEqual(await page.evaluate(() => window.switches), [])
      await page.evaluate(() => {
        window.focused = true
        window.render()
      })
    }
    if (mobile) {
      await page.getByRole('heading', { name: 'Opened selected child' }).waitFor()
      assert.equal(await page.evaluate(() => window.params.runtimeId), 'new-profile')
      assert.deepEqual(await page.evaluate(() => window.switches), ['new-profile'])
      await page
        .getByRole('button', { name: 'Back to parent · Parent thread', exact: true })
        .click()
      assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
        pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
        params: {
          runtimeId: 'parent-profile',
          runtimeIdentity: 'parent-identity',
          taskId: 'coordinator',
        },
      })
    } else {
      await page.waitForFunction(() => window.routes.length === 1)
      assert.deepEqual(await page.evaluate(() => window.routes[0]), {
        runtimeId: 'new-profile',
        runtimeIdentity: 'child-identity',
        threadId: 'selected-child',
        title: 'Selected child',
        parent: {
          runtimeId: 'parent-profile',
          runtimeIdentity: 'parent-identity',
          threadId: 'coordinator',
          title: 'Parent thread',
        },
      })
    }
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'}: contextual pairing, wrong-computer isolation and selected child/parent preservation passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
