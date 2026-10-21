import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'packages/extension-scm/src/connections/project-deletion.tsx'
const mocks = [
  {
    path: '@dovo/studio-core',
    importer,
    contents:
      "export {responses} from './packages/protocol/src/index';export const useWorkspace=()=>window.store;",
  },
  {
    path: '@dovo/studio-core/state',
    importer,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '@dovo/studio-ui',
    importer,
    contents:
      "export {Button} from './packages/studio-ui/src/components/ui/button';export {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './packages/studio-ui/src/components/ui/dialog';",
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProjectDeletion} from './packages/extension-scm/src/connections/project-deletion';
window.calls=[];window.refreshes=[];window.deleted=[];window.fail=false;
window.store={connected:true,activeRuntimeId:'machine',runtimes:[{profile:{id:'machine'}},{profile:{id:'other-machine'}}],
readRuntime:async(profile,path,input)=>{window.calls.push({runtimeId:profile.id,path,input});if(window.fail)throw Error('Project has active work');return {ok:true}},
refreshRuntime:async profile=>{window.refreshes.push(profile.id)}};
function App(){const [general,setGeneral]=useState(false),[repositoryId,setRepositoryId]=useState('repo-1'),[,render]=useState(0);window.setGeneral=setGeneral;window.setRepository=setRepositoryId;window.setRuntime=id=>{window.store.activeRuntimeId=id;render(value=>value+1)};const repository=general?{id:'scratch',name:'General',path:'/general',kind:'scratch'}:{id:repositoryId,name:repositoryId==='repo-1'?'My project':'Other project',path:'/project'};return <ProjectDeletion repository={repository} onDeleted={error=>window.deleted.push(error??'ok')}/>}
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Delete My project…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete “My project”?', exact: true })
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /task and conversation history from Dovo/)
  assert.match(await dialog.innerText(), /files remain on disk/)
  assert.match(await dialog.innerText(), /Active work must finish/)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.calls.length), 0)

  await page.getByRole('button', { name: 'Delete My project…', exact: true }).click()
  await page.evaluate(() => window.setRepository('repo-2'))
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await page.evaluate(() => window.setRepository('repo-1'))
  await page.getByRole('button', { name: 'Delete My project…', exact: true }).click()
  await page.evaluate(() => window.setRuntime('other-machine'))
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await page.getByRole('button', { name: 'Delete My project…', exact: true }).click()
  await page.evaluate(() => {
    window.fail = true
  })
  await dialog.getByRole('button', { name: 'Delete My project and history', exact: true }).click()
  assert.equal(await dialog.getByRole('alert').innerText(), 'Project has active work')
  await page.evaluate(() => {
    window.fail = false
  })
  await dialog.getByRole('button', { name: 'Delete My project and history', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.calls), [
    {
      runtimeId: 'other-machine',
      path: '/api/scm/repositories/delete',
      input: { repositoryId: 'repo-1' },
    },
    {
      runtimeId: 'other-machine',
      path: '/api/scm/repositories/delete',
      input: { repositoryId: 'repo-1' },
    },
  ])
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['other-machine'])
  assert.deepEqual(await page.evaluate(() => window.deleted), ['ok'])
  await page.evaluate(() => window.setGeneral(true))
  assert.equal(await page.getByRole('button', { name: /Delete General/ }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Project deletion names the project, explains history/file behavior, preserves conflict errors, refreshes after success, and protects General.',
  )
} finally {
  await browser.close()
}
