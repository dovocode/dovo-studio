import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/screens/jobs.tsx'
const controls = `
export const View=({children})=><div>{children}</div>;
export const Keyboard={dismiss:()=>{}};
export const FlatList=({data,renderItem,ListHeaderComponent,ListEmptyComponent,refreshing,onRefresh})=><section aria-busy={refreshing}>{ListHeaderComponent}<button onClick={onRefresh}>Refresh</button>{data.map((item,index)=><div key={item.key}>{renderItem({item,index})}</div>)}{!data.length&&ListEmptyComponent}</section>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const SettingsPage=View;
export const useSettingsTheme=()=>({styles:{},colors:{}});
export const SettingsSearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const ScreenHeader=({title})=><h1>{title}</h1>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Icon=()=>null;
export const AutomationRow=({flow})=><span>{flow.name}</span>;
export const AutomationEditor=()=>null;
export const CreationTarget=()=>null;
`
const mocks = [
  {
    path: '../runtime/connection/provider',
    importer,
    contents: 'export const useRuntime=()=>window.runtime;',
  },
  {
    path: '../runtime/state/application-state',
    importer,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../shell/navigation',
    importer,
    contents: 'export const useNavigation=()=>({focused:true});',
  },
  {
    path: '../ui/layout/use-list-scroll',
    importer,
    contents: 'export const useListScroll=()=>({retainPosition:()=>{}});',
  },
  { path: 'expo-router', contents: 'export const router={push:()=>{}};' },
  ...[
    'react-native',
    '../ui/content/text',
    './settings-theme',
    './settings-controls',
    '../ui/layout/screen-header',
    '../ui/controls/action',
    '../ui/controls/icon',
    '../jobs/automation-row',
    '../jobs/automation-editor',
    '../runtime/connection/creation-target',
  ].map((path) => ({ path, ...(path === 'react-native' ? {} : { importer }), contents: controls })),
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';
import JobsScreen from './apps/mobile/src/screens/jobs';
const source={profile:{id:'owner',name:'Mac Studio',nameIsCustom:true,connection:{address:'http://mac-studio.lan:8787',token:'token'}},connected:true,error:'',snapshot:{workspace:{automations:[{id:'job',name:'Saved automation'}]}}};
window.mode='reject';window.calls=0;
function App(){const[overviews,setOverviews]=useState([source]);window.publish=entries=>flushSync(()=>setOverviews(entries));window.source=source;window.runtime={overviews,refreshAll:async()=>{window.calls++;if(window.mode==='reject')throw Error('Connection interrupted');setOverviews([{...source,error:window.mode==='stored'?'Mac Studio refresh failed':''}])}};return <JobsScreen/>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  mocks,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Connection interrupted' }).waitFor()
  assert.equal(await page.locator('section').getAttribute('aria-busy'), 'false')
  assert.equal(await page.getByText('Saved automation', { exact: true }).count(), 1)
  await page.evaluate(() => (window.mode = 'stored'))
  await page.getByRole('button', { name: 'Retry loading automations', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Mac Studio refresh failed' }).waitFor()
  assert.equal(await page.getByText('Saved automation', { exact: true }).count(), 1)
  await page.evaluate(() => (window.mode = 'success'))
  await page.getByRole('button', { name: 'Retry loading automations', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.calls), 3)
  await page.evaluate(() =>
    window.publish([{ ...window.source, connected: false, snapshot: null }]),
  )
  await page.getByText('Connect a computer', { exact: true }).waitFor()
  assert.equal(await page.getByText('Create an automation', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile automations retain cached results, show rejected and stored refresh failures, retry cleanly and explain offline empty state.',
  )
} finally {
  await browser.close()
}
