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
    path: 'react-native',
    importer,
    contents:
      'export const View=({children})=><div>{children}</div>;export const Alert={alert:(title,message,buttons)=>window.alerts.push({title,message,buttons})};',
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
      'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
  },
  {
    path: '../../ui/controls/use-action',
    importer,
    contents:
      "import {useState} from 'react';import {Effect} from 'effect';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState('');return{busy,error,act:run=>{setBusy(true);void Effect.runPromise(run()).catch(cause=>setError(cause instanceof Error?cause.message:String(cause))).finally(()=>setBusy(false))}}};",
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
import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {DeleteProjectAction} from './apps/mobile/src/scm/connections/project-deletion';
window.alerts=[];window.calls=[];window.refreshes=[];window.navigations=[];window.view={project:'repo-1',source:'machine'};window.fail=false;
window.runtime={connected:true,profile:{id:'machine'},readRuntimeEffect:(profile,path,input)=>Effect.tryPromise({try:async()=>{window.calls.push({runtimeId:profile.id,path,input});if(window.fail)throw Error('Project has active work');return{ok:true}},catch:error=>error}),refreshRuntimeEffect:profile=>Effect.sync(()=>window.refreshes.push(profile.id))};
window.navigation={navigate:view=>window.navigations.push(view)};
window.taskListView={setView:update=>{window.view=update(window.view)}};
createRoot(document.getElementById('app')).render(<DeleteProjectAction repository={{id:'repo-1',name:'My project',path:'/project'}}/>);`,
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Actions for My project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project…', exact: true }).click()
  assert.equal(await page.evaluate(() => window.alerts[0].title), 'Delete “My project”?')
  const explanation = await page.evaluate(() => window.alerts[0].message)
  assert.match(explanation, /task and conversation history from Dovo/)
  assert.match(explanation, /files stay on disk/)
  assert.match(explanation, /Active work must finish/)
  // Native alerts dismiss automatically when the user taps Cancel; it has no action callback.
  assert.equal(await page.evaluate(() => window.calls.length), 0)

  await page.getByRole('button', { name: 'Actions for My project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project…', exact: true }).click()
  await page.evaluate(() => {
    window.fail = true
    window.alerts.at(-1).buttons[1].onPress()
  })
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').innerText(), 'Project has active work')
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Actions for My project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project…', exact: true }).click()
  await page.evaluate(() => window.alerts.at(-1).buttons[1].onPress())
  await page.waitForFunction(() => window.navigations.length === 1)
  assert.deepEqual(await page.evaluate(() => window.calls), [
    {
      runtimeId: 'machine',
      path: '/api/scm/repositories/delete',
      input: { repositoryId: 'repo-1' },
    },
    {
      runtimeId: 'machine',
      path: '/api/scm/repositories/delete',
      input: { repositoryId: 'repo-1' },
    },
  ])
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['machine'])
  assert.deepEqual(await page.evaluate(() => window.navigations), ['tasks'])
  assert.deepEqual(await page.evaluate(() => window.view), { project: 'scratch', source: 'all' })
  assert.deepEqual(errors, [])
  console.log(
    'Mobile project deletion confirms the named project and consequences, keeps conflicts visible, and returns to General after success.',
  )
} finally {
  await browser.close()
}
