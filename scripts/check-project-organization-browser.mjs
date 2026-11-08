import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'packages/studio-ui/src/project-organization.tsx'
const mocks = [
  {
    path: '@dovo/studio-core',
    importer,
    contents: 'export const useWorkspace=()=>window.store;',
  },
  {
    path: '@dovo/studio-core/state',
    importer,
    contents: "export {useState as useApplicationState} from 'react';",
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProjectOrganizationSettings} from './packages/studio-ui/src/project-organization';
window.calls=[];window.refreshes=0;window.stored={projectPinned:undefined,projectArchived:undefined};
const shared={id:'repo',name:'App',path:'/app',branch:'main',gitIdentity:'github.com/team/app'};
function App(){
  const [state,setState]=useState({repository:shared,supported:true,compact:false});
  window.set=next=>setState(current=>({...current,...next}));
  window.store={connected:true,activeRuntimeId:'mac',runtimes:[{profile:{id:'mac'}}],
    snapshot:{projectOrganizationSupported:state.supported||undefined},
    request:async(path,input)=>{window.calls.push({path,input});
      if(path.endsWith('/save'))Object.assign(window.stored,input.after);
      return {value:{...window.stored,taskDefaults:{setupCommand:'pnpm i'}},inherited:{}}},
    refreshRuntime:async()=>{window.refreshes++;
      setState(current=>({...current,repository:{...current.repository,pinned:window.stored.projectPinned,archived:window.stored.projectArchived}}))}};
  return <ProjectOrganizationSettings repository={state.repository} compact={state.compact}/>}
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
  const section = page.getByRole('region', { name: 'Project organization' })
  await section.waitFor()
  assert.match(await section.innerText(), /Syncs across paired computers/)

  // A confirmed Git identity saves one shared category through the project scope CAS.
  await page.getByRole('button', { name: 'Pin project', exact: true }).click()
  await page.getByRole('button', { name: 'Unpin project', exact: true }).waitFor()
  const [read, save] = await page.evaluate(() => window.calls)
  assert.deepEqual(read, {
    path: '/api/agents/settings/read',
    input: { scope: 'project', repositoryId: 'repo' },
  })
  assert.equal(save.path, '/api/agents/settings/save')
  assert.equal(save.input.scope, 'project')
  assert.equal(save.input.projectKey, 'project:github.com/team/app')
  assert.equal(save.input.before.projectPinned, undefined)
  assert.equal(save.input.after.projectPinned, true)
  assert.equal(save.input.after.projectArchived, undefined)
  assert.deepEqual(save.input.after.taskDefaults, { setupCommand: 'pnpm i' })
  assert.equal(
    await page
      .getByRole('button', { name: 'Unpin project', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )

  await page.getByRole('button', { name: 'Archive project', exact: true }).click()
  await page.getByRole('button', { name: 'Unarchive project', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.calls)).at(-1).input.after.projectArchived, true)

  // Settings pages offer only the restore action, and only for archived projects.
  await page.evaluate(() => window.set({ compact: true }))
  const status = page.getByRole('status')
  await status.getByText(/Archived/).waitFor()
  await status.getByRole('button', { name: 'Unarchive project', exact: true }).click()
  await status.waitFor({ state: 'detached' })
  assert.equal((await page.evaluate(() => window.calls)).at(-1).input.after.projectArchived, false)
  assert.equal(await page.getByRole('button').count(), 0)

  // Local-only projects stay on their computer through the project-on-machine scope.
  await page.evaluate(() => {
    window.calls = []
    window.stored = { projectPinned: undefined, projectArchived: undefined }
    window.set({
      compact: false,
      repository: { id: 'folder', name: 'Notes', path: '/notes', branch: '', kind: 'folder' },
    })
  })
  await section.getByText(/Applies to this project on this computer/).waitFor()
  await page.getByRole('button', { name: 'Pin project', exact: true }).click()
  await page.getByRole('button', { name: 'Unpin project', exact: true }).waitFor()
  const localSave = (await page.evaluate(() => window.calls)).at(-1)
  assert.equal(localSave.input.scope, 'environment-project')
  assert.equal(localSave.input.repositoryId, 'folder')
  assert.equal(localSave.input.projectKey, undefined)

  // Older runtimes and unconfirmed checkouts cannot silently drop the change.
  await page.evaluate(() => window.set({ supported: false }))
  await section.getByText(/Update this computer/).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Archive project', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() =>
    window.set({
      supported: true,
      repository: {
        id: 'repo',
        name: 'App',
        path: '/app',
        branch: 'main',
        gitIdentityError: 'Checkout unavailable',
      },
    }),
  )
  await section.getByText(/confirm its Git remote/).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Pin project', exact: true }).isDisabled(),
    true,
  )
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
console.log('project organization browser check passed')
