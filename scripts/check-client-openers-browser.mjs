import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import * as Menu from '${root}packages/studio-ui/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs';
import {RepositoryOpenItems} from '${root}packages/studio-ui/src/repository-open-items.tsx';
import {useRepositoryOpen} from '${root}packages/studio-core/src/repository-open.ts';
window.calls=[];window.launched=[];window.local='client';window.server='remote';window.enabled=true;window.fail=false;
window.bridge={list:async()=>{if(window.fail)throw Error('Detection failed');return {localRuntimeId:window.local,targets:['finder','vscode','vscode-insiders','vscodium','cursor','windsurf','antigravity','devin','zed','idea','future-editor']}},open:async input=>window.launched.push(input)};
window.request=async(path,input)=>{window.calls.push({path,input});return {path:input.path??'/remote/project',runtimeId:window.server,sshAddress:'ssh://dominic@buildbox:2222',kind:input.path?'file':'folder'}};
function App(){const open=useRepositoryOpen();return <Menu.Root><Menu.Trigger>Open in</Menu.Trigger><Menu.Portal><Menu.Content><RepositoryOpenItems itemClass='item' onSelect={(target)=>open({repositoryId:'repo'},target).catch(e=>{window.error=e.message})}/></Menu.Content></Menu.Portal></Menu.Root>}
const app=createRoot(document.getElementById('app'));let n=0;window.render=()=>app.render(<App key={++n}/>);window.render();
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>({connected:true,snapshot:{runtimeId:window.server},request:window.request});export const useStudioHost=()=>({repositoryOpener:window.enabled?window.bridge:undefined});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const show = async () => {
    await page.getByRole('button', { name: 'Open in', exact: true }).click()
    await page.getByRole('menu').waitFor()
  }
  await show()
  for (const name of [
    'VS Code',
    'VS Code Insiders',
    'VSCodium',
    'Cursor',
    'Windsurf',
    'Antigravity',
    'Devin Desktop',
    'Zed',
  ])
    await page.getByRole('menuitem', { name: `Open in ${name}`, exact: true }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Open in Finder', exact: true }).count(), 0)
  assert.equal(await page.getByText('JetBrains', { exact: true }).count(), 0)
  await page.getByRole('menuitem', { name: 'Open in Cursor', exact: true }).click()
  await page.waitForFunction(() => window.launched.length === 1)
  assert.deepEqual(await page.evaluate(() => window.launched[0]), {
    path: '/remote/project',
    runtimeId: 'remote',
    sshAddress: 'ssh://dominic@buildbox:2222',
    kind: 'folder',
    target: 'cursor',
  })
  assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.path)), [
    '/api/scm/open-location',
  ])
  await page.evaluate(() => {
    window.server = 'client'
    window.render()
  })
  await show()
  await page.getByRole('menuitem', { name: 'Open in Finder', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.enabled = false
    window.render()
  })
  await show()
  await page
    .getByText('Use the Dovo Studio desktop app to open editors on your computer.')
    .waitFor()
  assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.path)), [
    '/api/scm/open-location',
  ])
  assert.deepEqual(errors, [])
  console.log(
    'Client editors: local discovery, SSH-only remote choices, client launch and truthful web fallback passed.',
  )
} finally {
  await browser.close()
}
