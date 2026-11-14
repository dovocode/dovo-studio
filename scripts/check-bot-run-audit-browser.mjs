import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const useTheme=()=>({styles:{muted:{}}});`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import{createRoot}from'react-dom/client';import{useState}from'react';import{Effect}from'effect';
import{RunAudit as Desktop}from'./packages/extension-jobs/src/run-audit';import{RunAudit as Mobile}from'./apps/mobile/src/jobs/run-audit';
window.calls=[];window.copied='';window.hold=false;
window.result=(input)=>({runId:'run',automationId:'flow',generatedAt:'2026-11-14T00:00:00Z',threads:[],events:[{id:'event',time:'2026-11-14',taskId:'worker',kind:'tool',summary:'Scoped command',...(input.output?{payload:'EXACT-OUTPUT'}:{})}],tokens:42,estimatedCostUsd:.01,usageIncomplete:true,...(!input.offset?{nextOffset:100}:{})});
const request=async(path,input)=>{window.calls.push({path,input});if(window.hold)return new Promise(resolve=>window.release=()=>resolve(window.result(input)));return window.result(input)};
function App(){const[mode,setMode]=useState('desktop'),[scope,setScope]=useState('a');window.mode=setMode;window.switch=()=>setScope(s=>s==='a'?'b':'a');window.store={connected:true,connection:scope,request};window.runtime={connected:true,profile:{id:scope},callEffect:(path,input)=>Effect.tryPromise(()=>request(path,input))};return <main data-scope={scope} key={mode+scope}>{mode==='desktop'?<Desktop runId="run"/>:<Mobile runId="run"/>}</main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.store;' },
    { path: '@dovo/studio-ui', contents: controls },
    { path: 'react-native', contents: controls },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'jobs/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    { path: '../screens/settings-controls', importer: mobile + 'jobs/', contents: controls },
    { path: '../ui/content/text', importer: mobile, contents: controls },
    { path: '../ui/theme', importer: mobile, contents: controls },
    {
      path: '../ui/content/clipboard',
      importer: mobile,
      contents: 'export const copyText=async text=>{window.copied=text;return "copied"};',
    },
    {
      path: '../../runtime/state/application-state',
      importer: mobile + 'ui/',
      contents: "export {useState as useApplicationState} from 'react';",
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => window.mode(mode), mode)
    await page
      .getByRole('button', {
        name: mode === 'desktop' ? 'Load audit' : 'Load run audit',
        exact: true,
      })
      .click()
    await page.getByText('42 reported tokens', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.at(-1).input.output), false)
    await page.getByRole('button', { name: 'Load output for this page', exact: true }).click()
    await page.waitForFunction(() => window.calls.at(-1).input.output === true)
    if (mode === 'desktop')
      await page.waitForFunction(() =>
        document.querySelector('textarea')?.value.includes('EXACT-OUTPUT'),
      )
    else {
      await page.getByRole('button', { name: 'Copy audit page', exact: true }).click()
      await page.waitForFunction(() => window.copied.includes('EXACT-OUTPUT'))
    }
    await page
      .getByRole('button', {
        name: mode === 'desktop' ? 'Next page' : 'Next audit page',
        exact: true,
      })
      .click()
    await page.waitForFunction(() => window.calls.at(-1).input.offset === 100)
    await page.getByRole('button', { name: 'Load output for this page', exact: true }).waitFor()
    await page.evaluate(() => (window.hold = true))
    await page.getByRole('button', { name: 'Load output for this page', exact: true }).click()
    await page.waitForFunction(() => typeof window.release === 'function')
    const previousScope = await page.locator('main').getAttribute('data-scope')
    await page.evaluate(() => window.switch())
    await page.waitForFunction(
      (previous) => document.querySelector('main')?.dataset.scope !== previous,
      previousScope,
    )
    await page
      .getByRole('button', {
        name: mode === 'desktop' ? 'Load audit' : 'Load run audit',
        exact: true,
      })
      .waitFor()
    await page.evaluate(() => {
      window.release()
      window.hold = false
    })
    assert.equal(await page.locator('textarea').count(), 0)
    assert.equal(await page.getByText('42 reported tokens', { exact: false }).count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Run audit: web/mobile scoped loading, output opt-in, pagination, export and stale computer replies pass. Native controls and transport are fixtures.',
  )
} finally {
  await browser.close()
}
