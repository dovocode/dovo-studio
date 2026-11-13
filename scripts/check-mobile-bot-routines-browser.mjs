import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const jobs = root + 'apps/mobile/src/jobs/'
const controls = `
export const View=({children})=><div>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const SettingsField=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;
export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {StepFields} from './apps/mobile/src/jobs/step-fields';
window.snapshot={botsSupported:true,workspace:{agents:[],repositories:[{id:'project',name:'Project',path:'/project',branch:'main'}],tasks:[{id:'release-bot',title:'Release Bot',bot:{state:'active'}},{id:'paused-bot',title:'Paused Bot',bot:{state:'paused'}},{id:'archived-bot',title:'Archived Bot',archivedAt:'2026-11-12T00:00:00Z',bot:{state:'active'}},{id:'chat',title:'Normal thread'}]}};
function App(){const [data,setData]=useState({kind:'task',label:'Release',objective:'Check release readiness',repositoryId:'project',agentId:'',execution:'worktree'});const [disabled,setDisabled]=useState(false);const [version,setVersion]=useState(0);window.setStep=changes=>setData(value=>({...value,...changes}));window.setDisabled=setDisabled;window.updateCapability=value=>{window.snapshot.botsSupported=value;setVersion(version+1)};window.data=data;return <StepFields data={data} workspace={window.snapshot.workspace} disabled={disabled} onChange={patch=>setData(value=>({...value,...patch}))}/>};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: controls },
    { path: '../ui/content/text', importer: jobs, contents: controls },
    { path: '../screens/settings-controls', importer: jobs, contents: controls },
    {
      path: '../runtime/connection/provider',
      importer: jobs,
      contents: 'export const useRuntime=()=>({snapshot:window.snapshot});',
    },
    { path: '../ui/theme', importer: jobs, contents: 'export const useTheme=()=>({styles:{}});' },
    {
      path: '../agents/model-settings',
      importer: jobs,
      contents: 'export const ModelSettings=()=> <span>Model controls</span>;',
    },
    {
      path: '../tasks/detail/linked-projects',
      importer: jobs,
      contents: 'export const LinkedCheckoutEditor=()=> <span>Linked checkout controls</span>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), '')
  await page.getByLabel('Project', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Destination').locator('option').count(), 3)
  await page.getByLabel('Destination').selectOption('release-bot')
  assert.equal(await page.getByLabel('Project', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('Harness', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('Permissions', { exact: true }).count(), 0)
  await page.getByText(/This step uses the Bot’s persistent chat/).waitFor()
  await page.getByLabel('Instructions', { exact: true }).fill('Use the release checklist')
  assert.equal(await page.evaluate(() => window.data.botId), 'release-bot')
  assert.equal(await page.evaluate(() => window.data.repositoryId), 'project')
  assert.equal(await page.evaluate(() => window.data.execution), 'worktree')
  await page.getByLabel('Destination').selectOption('paused-bot')
  await page.getByText(/A paused Bot must resume/).waitFor()
  await page.getByLabel('Destination').selectOption('')
  await page.getByLabel('Project', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Instructions', { exact: true }).inputValue(),
    'Use the release checklist',
  )
  assert.equal(await page.getByLabel('Checkout', { exact: true }).inputValue(), 'worktree')
  assert.equal(await page.evaluate(() => window.data.botId), undefined)
  await page.evaluate(() => window.setStep({ botId: 'missing-bot' }))
  assert.equal(await page.getByLabel('Destination').inputValue(), 'missing-bot')
  assert.equal(
    await page.getByLabel('Destination').locator('option:checked').textContent(),
    'Unavailable Bot',
  )
  await page.evaluate(() => window.setStep({ botId: 'archived-bot' }))
  assert.equal(
    await page.getByLabel('Destination').locator('option:checked').textContent(),
    'Archived Bot · Archived',
  )
  await page.evaluate(() => window.setDisabled(true))
  assert.equal(await page.getByLabel('Destination').isDisabled(), true)
  await page.evaluate(() => {
    window.setDisabled(false)
    window.setStep({ botId: undefined })
    window.updateCapability(false)
  })
  await page.getByLabel('Destination').waitFor({ state: 'detached' })
  await page.getByLabel('Project', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Bot routines: existing-thread destination, inherited settings, preserved ordinary-step settings, paused/missing/archived targets and older runtime behavior pass.',
  )
} finally {
  await browser.close()
}
