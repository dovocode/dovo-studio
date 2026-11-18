import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/scm/connections/project-deletion.tsx'
const mocks = [
  {
    path: '../work/work-menu',
    importer,
    contents: `import {useState} from 'react';export const WorkMenu=({actions,label})=>{const[open,setOpen]=useState(false);return <div><button onClick={()=>setOpen(!open)}>{label}</button>{open&&actions.map(action=><button key={action.label} disabled={action.disabled} onClick={()=>{setOpen(false);action.onPress()}}>{action.label}</button>)}</div>};`,
  },
  {
    path: 'expo-router',
    contents: 'export const router={push:destination=>window.automationLinks.push(destination)};',
  },
  {
    path: 'react-native',
    contents:
      'export const View=({children,style})=><div style={style}>{children}</div>;export const Alert={alert:(title,message)=>window.alerts.push({title,message})};export const Keyboard={dismiss(){}};',
  },
  {
    path: '../../runtime/state/application-state',
    importer,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../../ui/controls/action',
    importer,
    contents:
      'export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
  },
  {
    path: '../../ui/layout/sheet',
    importer,
    contents: `import {useImperativeHandle} from 'react';
export function Sheet({ref,title,onClose,busy,children}){
  useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));
  return <section role="dialog" aria-label={title} style={{maxHeight:'80vh',overflow:'auto'}}>
    <h1>{title}</h1><button disabled={busy} onClick={onClose}>Close</button>{children}
  </section>
}`,
  },
  {
    path: '../../runtime/state/native-effect',
    importer,
    contents:
      "import {Effect} from 'effect';export const mobileWorkflow=work=>Effect.gen(work);export const nativeEffect=run=>Effect.sync(run);",
  },
  {
    path: '../../runtime/connection/provider',
    importer,
    contents: 'export const useRuntime=()=>window.runtime;',
  },
  {
    path: '../../shell/navigation',
    importer,
    contents: 'export const useNavigation=()=>window.navigation;',
  },
  {
    path: '../../tasks/list/task-list-view',
    importer,
    contents: 'export const useTaskListView=()=>window.taskListView;',
  },
  {
    path: '../../ui/content/text',
    importer,
    contents:
      'export const Text=({children,accessibilityRole})=><div role={accessibilityRole} aria-level={accessibilityRole==="header"?2:undefined}>{children}</div>;',
  },
  {
    path: '../../ui/controls/use-action',
    importer,
    contents:
      "import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:run=>{setBusy(true);setError('');void Effect.runPromise(run()).catch(cause=>setError(cause instanceof Error?cause.message:String(cause))).finally(()=>setBusy(false))}}};",
  },
  {
    path: '../../ui/theme',
    importer,
    contents: "export const useTheme=()=>({styles:{error:{color:'red'}}});",
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {DeleteProjectAction} from './apps/mobile/src/scm/connections/project-deletion';
window.alerts=[];window.calls=[];window.refreshes=[];window.navigations=[];window.automationLinks=[];window.view={project:'repo-1',source:'machine'};
const snapshot=(workspace={},activity={})=>({workspace:{tasks:[],automations:[],...workspace},questions:[],approvals:[],terminals:[],runs:[],...activity});
window.runtime={connected:true,profile:{id:'machine',name:'Test computer',nameIsCustom:true},snapshot:snapshot(),readRuntimeEffect:(profile,path,input)=>Effect.tryPromise({try:()=>new Promise((resolve,reject)=>{window.calls.push({runtimeId:profile.id,path,input});window.finish=error=>error?reject(Error(error)):resolve({ok:true})}),catch:error=>error}),refreshRuntimeEffect:profile=>Effect.try({try:()=>{window.refreshes.push(profile.id);if(window.failRefresh)throw Error('Computer disconnected')},catch:error=>error})};
window.navigation={navigate:(...target)=>window.navigations.push(target)};
window.taskListView={setView:update=>{window.view=update(window.view)}};
function App(){const [,render]=useState(0);const update=()=>render(value=>value+1);window.setConnected=connected=>{window.runtime.connected=connected;update()};window.setActivity=(workspace,activity)=>{window.runtime.snapshot=snapshot(workspace,activity);update()};return <DeleteProjectAction repository={{id:'repo-1',name:'My project',path:'/project'}}/>}createRoot(document.getElementById('app')).render(<App/>);`,
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
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>html{font-size:150%}button{font:inherit}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const open = async () => {
    await page.getByRole('button', { name: 'Actions for My project', exact: true }).click()
    await page.getByRole('button', { name: 'Delete project…', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Delete “My project”?', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Delete project and history', exact: true })
  await open()
  const explanation = await dialog.innerText()
  assert.match(explanation, /Test computer only/)
  assert.match(explanation, /Will be removed\nThe project entry/)
  assert.match(explanation, /Will change\nDovo disables affected automations/)
  assert.match(explanation, /Will stay\nFiles stay on disk.*Hosted artifact copies remain/)
  await confirm.waitFor()

  const showBlockers = () =>
    window.setActivity(
      {
        tasks: [
          { id: 'thread', title: 'Build app', repositoryId: 'repo-1', status: 'running' },
          {
            id: 'linked',
            title: 'Verify checkout',
            repositoryId: 'other',
            pendingLinkedCheckouts: [{ repositoryId: 'repo-1' }],
          },
          { id: 'unrelated', title: 'Other work', repositoryId: 'other', status: 'running' },
        ],
        automations: [
          {
            id: 'flow',
            name: 'Nightly checks',
            nodes: [{ data: { linkedCheckouts: [{ repositoryId: 'repo-1' }] } }],
          },
        ],
      },
      {
        approvals: [{ taskId: 'linked' }],
        terminals: [{ taskId: 'linked', exited: false }],
        runs: [{ id: 'run-2', automationId: 'flow', status: 'waiting', taskIds: [] }],
      },
    )
  await page.evaluate(showBlockers)
  await dialog.getByText('Deletion blocked', { exact: true }).waitFor()
  assert.equal(await confirm.count(), 0)
  assert.match(await dialog.innerText(), /Stop active turns and agents/)
  assert.match(await dialog.innerText(), /Finish pending questions or approvals/)
  assert.match(await dialog.innerText(), /Close active terminals/)
  assert.doesNotMatch(await dialog.innerText(), /Other work/)
  await page.evaluate(() => window.setConnected(false))
  await dialog.getByText('Last known blockers', { exact: true }).waitFor()
  assert.match(await dialog.innerText(), /Connect to Test computer/)
  assert.equal(await confirm.count(), 0)
  await page.evaluate(() => window.setConnected(true))
  await dialog.getByRole('button', { name: 'Open thread: Verify checkout', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.navigations), [['tasks', 'linked', 'machine']])
  await open()
  await dialog
    .getByRole('button', { name: 'Open automation run: Nightly checks', exact: true })
    .click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.automationLinks), [
    {
      pathname: '/settings/automations/[runtimeId]/[automationId]',
      params: { runtimeId: 'machine', automationId: 'flow', runId: 'run-2' },
    },
  ])
  await open()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.calls.length), 0)

  await page.evaluate(() => window.setActivity({}, {}))
  await open()
  await confirm.click()
  await page.waitForFunction(() => window.calls.length === 1)
  await page.evaluate(() => window.finish('Project has active work'))
  await dialog.getByText('Project has active work', { exact: true }).waitFor()
  await page.evaluate(showBlockers)
  await confirm.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.setActivity({}, {}))
  await confirm.click()
  await page.waitForFunction(() => window.calls.length === 2)
  await page.evaluate(() => {
    window.setConnected(false)
    window.finish('Connection lost during request')
  })
  await dialog.getByText('Connection lost during request', { exact: true }).waitFor()
  assert.equal(await confirm.count(), 0)
  assert.deepEqual(await page.evaluate(() => window.view), { project: 'repo-1', source: 'machine' })
  await page.evaluate(() => {
    window.failRefresh = true
    window.setConnected(true)
  })
  await confirm.waitFor()
  assert.equal(await page.evaluate(() => window.calls.length), 2)
  await confirm.click()
  await page.waitForFunction(() => window.calls.length === 3)
  await page.evaluate(() => window.finish())
  await page.waitForFunction(() => window.alerts.length === 1)
  assert.deepEqual(
    await page.evaluate(() => window.calls),
    Array.from({ length: 3 }, () => ({
      runtimeId: 'machine',
      path: '/api/scm/repositories/delete',
      input: { repositoryId: 'repo-1' },
    })),
  )
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['machine'])
  assert.deepEqual(await page.evaluate(() => window.navigations), [
    ['tasks', 'linked', 'machine'],
    ['tasks'],
  ])
  assert.deepEqual(await page.evaluate(() => window.view), { project: 'scratch', source: 'all' })
  assert.match(
    await page.evaluate(() => window.alerts[0].message),
    /removed from Dovo.*could not refresh/,
  )
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log(
    'Mobile project deletion links live blockers, suppresses deletion offline, preserves runtime errors, and returns to General only after success.',
  )
} finally {
  await browser.close()
}
