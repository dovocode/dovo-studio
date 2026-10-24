import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
// Real adaptive layout and index route; native controls and the route navigator are adapters.
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState,useRef} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TaskPaneLayout} from './src/shell/task-pane-layout';
import Index from './src/app/(tabs)/(tasks)/index';
import {useTaskPanes} from './src/shell/task-panes';
window.fixture={params:{runtimeId:'mac',taskId:'same'},scale:1,insets:{left:0,right:0,top:24},car:false,online:true};
window.routes=[];window.mounts=0;
function Detail(){const [text,setText]=useState('Keep this draft');const mount=useRef(null);mount.current??=++window.mounts;const panes=useTaskPanes();return <div data-testid='conversation' data-mount={mount.current}><textarea aria-label='Message' value={text} onChange={e=>setText(e.target.value)}/><output>{panes.detailWidth}</output></div>}
function App(){const [version,setVersion]=useState(0);window.update=patch=>{window.fixture={...window.fixture,...patch};flushSync(()=>setVersion(v=>v+1))};return <TaskPaneLayout>{window.fixture.index?<Index/>:<Detail/>}</TaskPaneLayout>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: { react: mobile + 'node_modules/react', 'react-dom': mobile + 'node_modules/react-dom' },
  },
  [
    {
      path: 'react-native',
      contents: `
import {useSyncExternalStore} from 'react';
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
export const View=({children,style,testID})=><div data-testid={testID} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',...flat(style)}}>{children}</div>;
export const useWindowDimensions=()=>{useSyncExternalStore(cb=>{window.addEventListener('resize',cb);return()=>window.removeEventListener('resize',cb)},()=>innerWidth+':'+innerHeight);return{width:innerWidth,height:innerHeight,fontScale:window.fixture.scale}};
`,
    },
    {
      path: 'expo-router',
      contents: `export const useGlobalSearchParams=()=>window.fixture.params;export const router={push:(...args)=>window.routes.push(args)};`,
    },
    {
      path: 'react-native-safe-area-context',
      contents: `import {View} from 'react-native';export const useSafeAreaInsets=()=>window.fixture.insets;export const SafeAreaView=({edges,style,...props})=><View {...props} style={[style,{paddingTop:edges.includes('top')?window.fixture.insets.top:0}]}/>;`,
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'src/shell/',
      contents: 'export const useRuntime=()=>({profiles:window.fixture.unpaired?[]:[{id:"mac"}]});',
    },
    {
      path: '../runtime/preferences/app-preferences',
      importer: mobile + 'src/shell/',
      contents: 'export const useCarMode=()=>window.fixture.car;',
    },
    {
      path: '../ui/theme',
      importer: mobile + 'src/shell/',
      contents: `export const useTheme=()=>({colors:{background:'#111',border:'#333'}});`,
    },
    {
      path: '../ui/layout/screen-header',
      importer: mobile + 'src/shell/',
      contents: `import {createContext} from 'react';export const InlineScreenHeaderContext=createContext(false);`,
    },
    {
      path: './workbench',
      importer: mobile + 'src/shell/',
      contents: `
import {useTaskPanes} from './src/shell/task-panes';
export const WorkbenchScene=()=>{const panes=useTaskPanes();return <aside aria-label='Threads'><input aria-label='Filter threads' defaultValue='Keep filter'/>{['mac','laptop'].map(runtimeId=><button key={runtimeId} aria-pressed={panes.selected?.runtimeId===runtimeId&&panes.selected?.taskId==='same'}>{runtimeId}</button>)}</aside>};
`,
    },
    {
      path: '../../../shell/workbench',
      importer: mobile + 'src/app/',
      contents: `export const WorkbenchScene=()=> <p>Phone thread list</p>;`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: mobile + 'src/app/',
      contents: `export const useRuntime=()=>({overviews:[{connected:window.fixture.online}]});`,
    },
    {
      path: '../../../ui/theme',
      importer: mobile + 'src/app/',
      contents: `export const useTheme=()=>({styles:{screen:{flex:1},title:{},muted:{}}});`,
    },
    {
      path: '../../../ui/controls/action',
      importer: mobile + 'src/app/',
      contents: `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    },
    {
      path: '../../../ui/content/text',
      importer: mobile + 'src/app/',
      contents: `export const Text=({children})=><p>{children}</p>;`,
    },
    {
      path: '../../../ui/layout/screen-header',
      importer: mobile + 'src/app/',
      contents: `export const ScreenHeader=()=>null;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0}#app{display:flex;height:100vh}textarea{max-width:100%}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const sidebar = page.getByTestId('Thread sidebar')
  const detail = page.getByTestId('Thread detail pane')
  await sidebar.waitFor()
  const mount = await page.getByTestId('conversation').getAttribute('data-mount')
  await page.getByRole('textbox', { name: 'Message' }).fill('Preserve this while rotating')
  assert.equal(
    await page.getByRole('button', { name: 'mac', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await page.getByRole('textbox', { name: 'Filter threads' }).fill('Changed filter')
  await page.evaluate(() => window.update({ params: { runtimeId: 'laptop', taskId: 'same' } }))
  assert.equal(
    await page.getByRole('button', { name: 'laptop', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(
    await page.getByRole('button', { name: 'mac', exact: true }).getAttribute('aria-pressed'),
    'false',
  )
  assert.equal(
    await page.getByRole('textbox', { name: 'Filter threads' }).inputValue(),
    'Changed filter',
  )
  for (const [width, height, expanded] of [
    [1366, 1024, true],
    [768, 1024, true],
    [390, 844, false],
    [844, 390, true],
    [544, 1024, false],
    [1024, 768, true],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await sidebar.waitFor({ state: expanded ? 'visible' : 'detached' })
    const bounds = await detail.boundingBox()
    assert.ok(bounds.width >= 440 || !expanded, JSON.stringify({ width, height, bounds }))
    assert.ok(Math.abs(bounds.x + bounds.width - width) < 1)
    assert.equal(await page.getByTestId('conversation').getAttribute('data-mount'), mount)
    assert.equal(
      await page.getByRole('textbox', { name: 'Message' }).inputValue(),
      'Preserve this while rotating',
    )
  }
  await page.evaluate(() => window.update({ unpaired: true }))
  await sidebar.waitFor({ state: 'detached' })
  await page.evaluate(() => window.update({ unpaired: false }))
  await sidebar.waitFor()
  await page.evaluate(() => window.update({ scale: 2 }))
  await sidebar.waitFor({ state: 'detached' })
  await page.evaluate(() => window.update({ scale: 1, car: true }))
  assert.equal(await sidebar.count(), 0)
  await page.evaluate(() => window.update({ car: false, insets: { left: 59, right: 59, top: 0 } }))
  await page.setViewportSize({ width: 844, height: 390 })
  await sidebar.waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 1024, height: 768 })
  await sidebar.waitFor()
  await page.evaluate(() => window.update({ index: true, params: {} }))
  await page.getByText('Select a thread', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), ['/new', { withAnchor: true }])
  await page.evaluate(() => window.update({ online: false }))
  await page.waitForFunction(
    () =>
      document.querySelector('button')?.disabled ||
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'New thread' && button.disabled,
      ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'New thread', exact: true }).isDisabled(),
    true,
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Phone thread list', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Adaptive thread panes: owner-qualified selection, sidebar state, narrow/landscape/tablet windows, safe areas, text scaling, car mode, offline creation and mounted draft preservation passed with native adapters.',
  )
} finally {
  await browser.close()
}
