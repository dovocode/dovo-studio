import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/jobs/'
const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;export const Alert={alert:()=>{}};export const useTheme=()=>({styles:{muted:{}}});export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Field=({label,value,onChangeText,editable})=><label>{label}<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)} disabled={!editable}/></label>;export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}><button onClick={onClose}>Cancel</button>{children}</div>;`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import{createRoot}from'react-dom/client';import{useState}from'react';
import{RestoreDefinition as Desktop}from'./packages/extension-jobs/src/restore-definition';
import{RestoreDefinition as Mobile}from'./apps/mobile/src/jobs/restore-definition';
import{decode,restorableAutomation}from'@dovo/protocol';
window.calls=[];window.current={id:'flow',name:'Current name',enabled:true,nodes:[],edges:[]};
window.old={...window.current,name:'Saved run',enabled:false};
const connection={address:'http://lan:4000',token:'test-token'};
const request=async(path,input,schema)=>{window.calls.push({path,input});if(path.endsWith('definition'))return decode(schema,{definition:window.old,expected:JSON.parse(JSON.stringify(window.current))});if(window.conflict)throw Error('Automation changed. Keep your draft and compare again.');window.saved=input;window.current=restorableAutomation(input.definition,window.current);return decode(schema,window.current)};
window.store={connected:true,connection,flush:async()=>{},request,snapshot:{automationRestoreSupported:false,workspace:{automations:[window.current]}}};
window.runtime={connected:true,profile:{id:'profile',connection},call:request,snapshot:window.store.snapshot};
function App(){const[mode,setMode]=useState('desktop'),[version,setVersion]=useState(0);window.mode=setMode;window.reload=()=>setVersion(v=>v+1);return <main data-mode={mode} key={mode+version}>{mode==='desktop'?<Desktop runId="run"/>:<Mobile runId="run" automationId="flow"/>}</main>};createRoot(document.getElementById('app')).render(<App/>);`,
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
    {
      path: '@dovo/studio-ui',
      contents: `export * from '${root}packages/studio-ui/src/components/ui/button.tsx';export * from '${root}packages/studio-ui/src/components/ui/dialog.tsx';export * from '${root}packages/studio-ui/src/components/ui/textarea.tsx';`,
    },
    { path: 'react-native', contents: controls },
    {
      path: '../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    ...[
      '../ui/layout/sheet',
      '../ui/controls/field',
      '../ui/controls/action',
      '../ui/content/text',
      '../ui/theme',
    ].map((path) => ({ path, importer: mobile, contents: controls })),
    ...['../controls/action', '../theme', './text'].map((path) => ({
      path,
      importer: root + 'apps/mobile/src/ui/content/draft-storage-notice.tsx',
      contents: controls,
    })),
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent(
    '<style>textarea{width:100%;height:250px} [role=dialog]{background:white}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => {
      window.store.snapshot.automationRestoreSupported = false
      window.mode(mode)
      window.reload()
    }, mode)
    await page.locator('main[data-mode="' + mode + '"]').waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Restore definition from this run' && button.disabled,
      ),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Restore definition from this run' }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.store.snapshot.automationRestoreSupported = true
      window.reload()
    })
    await page.getByRole('button', { name: 'Restore definition from this run' }).click()
    const draft = page.getByRole('textbox', { name: 'Restored automation definition' })
    await draft.waitFor()
    const edited = JSON.parse(await draft.inputValue())
    edited.name = 'Edited restore ' + mode
    await draft.fill(JSON.stringify(edited, null, 2))
    await page.evaluate(() => {
      window.conflict = true
    })
    await page.getByRole('button', { name: 'Save restored definition' }).click()
    await page.getByRole('alert').filter({ hasText: 'Automation changed' }).waitFor()
    assert.equal(JSON.parse(await draft.inputValue()).name, edited.name)
    await page.evaluate(() => window.reload())
    await draft.waitFor()
    assert.equal(
      JSON.parse(await draft.inputValue()).name,
      edited.name,
      'Navigation keeps restore draft',
    )
    await page.evaluate(() => {
      window.current.name = 'Concurrent change'
      window.conflict = false
    })
    await page.getByRole('button', { name: 'Compare with current definition' }).click()
    await page.getByText(/Concurrent change/).waitFor()
    assert.equal(JSON.parse(await draft.inputValue()).name, edited.name)
    await page.evaluate(() => {
      window.store.connected = false
      window.runtime.connected = false
      window.reload()
    })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Save restored definition' && button.disabled,
      ),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Save restored definition' }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.store.connected = true
      window.runtime.connected = true
      window.reload()
    })
    await page.getByRole('button', { name: 'Save restored definition' }).click()
    await draft.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.current.enabled), false)
    assert.equal(await page.evaluate(() => window.saved.expected.name), 'Concurrent change')
    assert.equal(await page.evaluate(() => window.saved.definition.name), edited.name)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Automation restore: desktop and mobile draft editing, old runtime, conflict, navigation, compare, offline/reconnect and paused save pass. Transport and native controls are fixtures.',
  )
} finally {
  await browser.close()
}
