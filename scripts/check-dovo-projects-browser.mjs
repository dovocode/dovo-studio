import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'packages/extension-scm/src/connections/repository-dialog.tsx'
const mocks = {
  '@dovo/studio-core': `export * from './packages/protocol/src/index';export {clientScopeKey} from './packages/client-runtime/src/effects/request-scope';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({});export const useAppPreferences=()=>({});`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {Button} from './packages/studio-ui/src/components/ui/button';export {Input} from './packages/studio-ui/src/components/ui/input';export {FormField} from './packages/studio-ui/src/components/form-field';export * from './packages/studio-ui/src/components/ui/dialog';`,
  './create-github': `export const CreateGithub=()=>null;`,
  './directory-picker': `export const DirectoryPicker=()=>null;`,
  './github-repository-picker': `export const GithubRepositoryPicker=()=>null;`,
  './forge-repository': `export const ForgeRepositoryFields=()=>null;`,
}
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RepositoryDialog} from './packages/extension-scm/src/connections/repository-dialog';
window.requests=[];
window.added=[];
window.closeCount=0;
const connection={address:'http://runtime',token:'paired'};
function App(){
  const [connected,setConnected]=useState(true);
  window.setConnected=setConnected;
  window.store={
    connection,
    connected,
    request:async(path,input)=>{
      window.requests.push({path,input});
      if(window.fail)throw new Error('Could not create project');
      return {id:'notes',kind:'folder',name:input.name,path:'/runtime/.dovo/projects/notes-unique',branch:''};
    },
  };
  return <RepositoryDialog projectLabels onClose={()=>window.closeCount++} onAdded={project=>window.added.push(project)}/>;
}
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
  Object.entries(mocks).map(([path, contents]) => ({ path, contents, importer })),
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 650, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const create = page.getByRole('button', { name: 'Create project', exact: true })
  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  assert.equal(
    await page.getByRole('button', { name: 'Dovo Project' }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await page.getByRole('textbox').count(), 1)
  await name.fill('My notes')
  await page.evaluate(() => window.setConnected(false))
  await page.waitForFunction(() => document.querySelector('button[type=submit]').disabled)
  assert.equal(await create.isDisabled(), true)
  await page.evaluate(() => {
    window.setConnected(true)
    window.fail = true
  })
  await create.click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').innerText(), 'Could not create project')
  assert.equal(await name.inputValue(), 'My notes')
  assert.equal(await page.evaluate(() => window.closeCount), 0)
  await page.evaluate(() => {
    window.fail = false
  })
  await create.click()
  await page.waitForFunction(() => window.closeCount === 1)
  assert.deepEqual(await page.evaluate(() => window.requests[1]), {
    path: '/api/scm/repositories/add',
    input: { source: 'dovo', name: 'My notes' },
  })
  assert.equal(await page.evaluate(() => window.added[0].id), 'notes')
  await page.getByRole('button', { name: 'Local path', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Local path', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Dovo Project' }).click()
  assert.equal(await page.getByRole('textbox').count(), 1)
  assert.equal(await name.inputValue(), 'My notes')
  assert.deepEqual(errors, [])
  console.log(
    'Desktop Dovo Projects create with only a name, respect offline state and preserve errors for retry.',
  )
} finally {
  await browser.close()
}
