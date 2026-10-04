import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `import {useState} from 'react';
export {useAppPreferences,updateAppPreferences} from '${root}/packages/studio-core/src/preferences.ts';
export const formatDateTime=value=>new Date(value).toLocaleString();
export const taskSortOptions=[{id:'priority',name:'Priority'},{id:'activity',name:'Last activity'}];
export const useStudioHost=()=>({appInfo:{version:'0.0.7',channel:'dev'},navigate:target=>window.navigation=target});
export const useWorkspace=()=>({connected:true,snapshot:{taskBehaviorSupported:true,defaults:{},workspace:{repositories:[]}},request:window.request});
export const useSettingsTarget=()=>{const [target,setTarget]=useState({projectId:'',environmentId:''});return {target,setTarget,sources:window.sources,source:window.sources[0],scope:target.projectId?(target.environmentId?'environment-project':'project'):(target.environmentId?'environment':'global'),repository:target.projectId?window.repo:undefined}};
export const WorkspaceScope=({children})=><>{children}</>;`
const ui = `export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}/packages/studio-ui/src/components/ui/dialog.tsx';export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';export {ChoicePicker} from '${root}/packages/studio-ui/src/choice-picker.tsx';export {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';export {TaskDefaultSettings} from '${root}/packages/studio-ui/src/task-default-settings.tsx';export {TaskBehaviorSettings} from '${root}/packages/studio-ui/src/task-behavior-settings.tsx';export {HarnessUpdates} from '${root}/packages/studio-ui/src/harness-updates.tsx';export * from '${root}/packages/studio-ui/src/settings-layout.tsx';`
const mocks = {
  '@dovo/studio-core': core,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': ui,
  './model-settings': `export const ModelSettings=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import General from '${root}/packages/studio-shell/src/app-settings/general.tsx';window.repo={id:'project',name:'Dovo',gitIdentity:'github.com/team/dovo',path:'/repo',branch:'main'};window.sources=[{profile:{id:'computer'},name:'Computer',scope:'computer',connected:true,snapshot:{workspace:{repositories:[window.repo]}}}];window.documents={};window.writes=[];window.request=async(path,input)=>{if(path==='/api/runtime/preferences/read')return {autoContinueAfterRestart:false,settleOnPullClose:false};if(path==='/api/agents/updates')return [];const key=input.scope;if(path.endsWith('/read'))return {value:window.documents[key]||{taskDefaults:{},resources:{skills:[],mcpServers:[]}},inherited:{taskBehavior:{quotaResume:true}},projectKey:'project:github.com/team/dovo'};if(path.endsWith('/save')){window.documents[key]=input.after;window.writes.push(input);return {value:input.after,inherited:{taskBehavior:{quotaResume:true}}}}};createRoot(document.getElementById('app')).render(<div className="studio dark h-screen"><General/></div>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => ({
          path: new URL(path.replace(/\?raw$/, ''), 'file://' + resolveDir + '/').pathname,
          namespace: 'raw',
        }))
        b.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
          contents: await readFile(path, 'utf8'),
          loader: 'text',
        }))
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
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  const assetDir = root + '/apps/web/dist/client/assets'
  const cssFiles = (await readdir(assetDir)).filter((file) => file.endsWith('.css'))
  for (const file of cssFiles)
    await page.addStyleTag({ content: await readFile(assetDir + '/' + file, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Auto-resume limited tasks', exact: true }).waitFor()
  const choose = async (label, option) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('dialog').getByRole('option', { name: option, exact: true }).click()
  }
  await choose('Auto-resume limited tasks', 'Off')
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  let writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'global')
  assert.equal(writes.at(-1).after.taskBehavior.quotaResume, false)
  assert.deepEqual(writes.at(-1).after.resources, { skills: [], mcpServers: [] })
  await choose('Settings project', 'Dovo')
  await choose('Settings environment', 'Computer')
  await choose('Auto-resume limited tasks', 'On')
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'environment-project')
  assert.equal(writes.at(-1).repositoryId, 'project')
  await choose('Auto-resume limited tasks', 'Inherit (On)')
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.waitForFunction(
    () => window.writes.at(-1).after.taskBehavior.quotaResume === undefined,
  )
  await page.getByRole('switch', { name: 'Formatted composer preview', exact: true }).click()
  assert.equal(
    await page
      .getByRole('switch', { name: 'Formatted composer preview', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )
  await page.getByRole('radio', { name: 'Finished paragraphs', exact: true }).click()
  await choose('Project order', 'Last user message')
  await page.getByLabel('Add project starts in', { exact: true }).fill('~/Code')
  await page.getByRole('button', { name: 'View notices', exact: true }).click()
  await page.getByRole('dialog').getByText('Open source notices', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'General should fit a narrow viewport',
  )
  if (process.env.DOVO_GENERAL_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_GENERAL_SCREENSHOT, fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'General settings: scoped save/reset, neighboring settings, device preferences and narrow viewport passed.',
  )
} finally {
  await browser.close()
}
