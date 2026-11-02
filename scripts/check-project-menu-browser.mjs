import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mocks = {
  '@dovo/studio-core': `export const useAppPreferences=()=>({projectGrouping:'name',projectOrder:'name'});export const projectActivity=()=>0;export const useWorkspace=()=>window.store;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {Button} from './src/components/ui/button';export {Input} from './src/components/ui/input';export {ProjectIcon} from './src/project-icon';export * from './src/components/ui/dialog';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as Popover from '@radix-ui/react-popover';export const TaskDefaultSettings=()=>null;export const ProjectOrganizationSettings=()=>null;`,
  './repository-dialog': `export const RepositoryDialog=({onClose})=><div role="dialog" aria-label="Add project"><button onClick={onClose}>Close adding</button></div>;`,
  './import-codex-session': 'export const ImportCodexSession=()=>null;',
  './import-pi-session': 'export const ImportPiSession=()=>null;',
  './repository-checkouts': 'export const RepositoryCheckouts=()=>null;',
  './forge-repository': 'export const ProjectForgeBinding=()=>null;',
  './project-icon-settings': 'export const ProjectIconSettings=()=>null;',
  './project-transfer': 'export const ProjectTransferSettings=()=>null;',
  './project-deletion': 'export const ProjectDeletion=()=>null;',
}
const built = await build({
  stdin: {
    resolveDir: root + '/packages/studio-ui',
    loader: 'tsx',
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {ProjectsMenu} from '../extension-scm/src/connections/projects-menu';function App(){const [multiple,setMultiple]=useState(false),[connected,setConnected]=useState(true),[repositories,setRepositories]=useState([]);window.setRepositories=setRepositories;window.configure=(multiple,connected=true)=>{setMultiple(multiple);setConnected(connected)};window.store={workspace:{repositories,tasks:[]},activeRuntimeId:'local',connected,runtimes:[{profile:{id:'local',name:'Desktop',nameIsCustom:true},connected,snapshot:null},...(multiple?[{profile:{id:'remote',name:'Remote',nameIsCustom:true},connected:false,snapshot:null}]:[])],switchRuntime:async()=>{throw Error('Unexpected switch')}};return <ProjectsMenu value="" onChange={()=>{}} allDevices/>};createRoot(document.getElementById('app')).render(<App/>);`,
  },
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const open = () =>
    page.getByRole('button', { name: 'Filter threads by project', exact: true }).click()
  const add = () => page.getByRole('button', { name: 'Add project', exact: true })
  await open()
  assert.equal(await add().getAttribute('aria-haspopup'), null)
  await add().click()
  await page.getByRole('dialog', { name: 'Add project', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close adding' }).click()
  await page.evaluate(() => window.configure(false, false))
  await open()
  assert.equal(await add().isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.configure(true))
  await open()
  assert.equal(await add().getAttribute('aria-haspopup'), 'menu')
  await add().click()
  await page.getByRole('menuitem', { name: 'Desktop', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Remote', exact: true }).getAttribute('data-disabled'),
    '',
  )
  await page.getByRole('menuitem', { name: 'Desktop', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add project', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close adding' }).click()

  // Favorites lead; archived projects stay reachable in a collapsed section for unarchiving.
  await page.evaluate(() =>
    window.setRepositories(
      [
        { id: 'alpha', name: 'Alpha' },
        { id: 'zulu', name: 'Zulu', pinned: true },
        { id: 'old', name: 'Old', archived: true },
      ].map((project) => ({ ...project, path: `/${project.id}`, branch: 'main' })),
    ),
  )
  await open()
  const filters = page.getByLabel('Project filters', { exact: true })
  const projectButtons = () =>
    filters
      .locator('button[aria-pressed]')
      .evaluateAll((items) =>
        items.map((item) => (item.querySelector('.truncate') ?? item).textContent?.trim()),
      )
  await filters.getByLabel('Pinned', { exact: true }).waitFor()
  assert.deepEqual(await projectButtons(), ['All projects', 'Zulu', 'Alpha'])
  const archived = filters.getByRole('button', { name: 'Archived (1)', exact: true })
  assert.equal(await archived.getAttribute('aria-expanded'), 'false')
  await archived.click()
  await filters.getByRole('button', { name: 'Old', exact: true }).waitFor()
  assert.deepEqual(await projectButtons(), ['All projects', 'Zulu', 'Alpha', 'Old'])
  await filters.getByRole('button', { name: 'Settings for Old', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Single computer: direct project creation and offline protection. Multiple computers: picker retained, including offline hosts. Pinned projects first; archived projects collapsed but reachable. Passed.',
  )
} finally {
  await browser.close()
}
