import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `import {createContext,useContext} from 'react';
export {useAppPreferences,updateAppPreferences} from '${root}/packages/studio-core/src/preferences.ts';
export {SettingsTargetProvider,useSettingsTarget,useSettingsDraft,useConfirmSettingsNavigation} from '${root}/packages/studio-core/src/settings-target.tsx';
export {agentSchema,modelCatalogSchema,selectableAccessModes,supportsAccess} from '@dovo/protocol';
export const providers={codex:{name:'Codex'},claude:{name:'Claude Code'},opencode:{name:'OpenCode'},acp:{name:'ACP'},cursor:{name:'Cursor'},copilot:{name:'GitHub Copilot'},hermes:{name:'Hermes'},grok:{name:'Grok Build'},muse:{name:'Muse'}};
export const formatDateTime=value=>new Date(value).toLocaleString();
export const taskSortOptions=[{id:'priority',name:'Priority'},{id:'activity',name:'Last activity'}];
export const useStudioHost=()=>({appInfo:{version:'0.0.7',channel:'dev'},navigate:target=>window.changeView(target.viewId)});
const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;
export const WorkspaceScope=({profile,children})=>{const source=window.sources.find(source=>source.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,...source,snapshot:source.snapshot,workspace:source.snapshot.workspace}}>{children}</Scope.Provider>};`
const ui = `
export * from '${root}/packages/studio-ui/src/components/ui/dialog.tsx';
export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';
export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';
export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea.tsx';
export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';
export {AgentAvatar,agentIconChoices} from '${root}/packages/studio-ui/src/agent-avatar.tsx';
export {ChoicePicker} from '${root}/packages/studio-ui/src/choice-picker.tsx';
export {SettingSource} from '${root}/packages/studio-ui/src/setting-source.tsx';
export {ModelSettings} from '${root}/packages/studio-ui/src/model-settings.tsx';
export {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';
export {TaskDefaultSettings} from '${root}/packages/studio-ui/src/task-default-settings.tsx';
export {TaskBehaviorSettings} from '${root}/packages/studio-ui/src/task-behavior-settings.tsx';
export * from '${root}/packages/studio-ui/src/settings-layout.tsx';`
const mocks = {
  '@dovo/studio-core': core,
  './workspace/provider': `export const useWorkspace=()=>window.runtime;`,
  './workspace/runtime-sources': `export const useRuntimeSources=()=>window.sources;`,
  './runtime/application-state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': ui,
  './harness-updates': `export const HarnessUpdates=()=>null;`,
  './acp-registry': `export const AcpRegistry=()=>null;export const AcpRegistrySettings=()=>null;`,
  './provider-check': `export const ProviderCheck=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {builtInAgentPresets,defaultTaskHarness} from '@dovo/protocol';
import {SettingsTargetProvider,useConfirmSettingsNavigation} from '@dovo/studio-core';
import {SettingsNav} from '${root}/packages/studio-shell/src/settings-nav.tsx';
import General from '${root}/packages/studio-shell/src/app-settings/general.tsx';
import Conversation from '${root}/packages/studio-shell/src/app-settings/conversation.tsx';
import About from '${root}/packages/studio-shell/src/app-settings/about.tsx';
import Agents from '${root}/packages/extension-agents/src/view.tsx';
import TaskDefaults from '${root}/packages/extension-runtime/src/task-defaults-view.tsx';
window.repo={id:'project',name:'Dovo',gitIdentity:'github.com/team/dovo',path:'/repo',branch:'main'};
const global={taskDefaults:{setupCommand:'pnpm install'},resources:{skills:[],mcpServers:[]},taskBehavior:{quotaResume:true}};
window.sources=[{profile:{id:'computer',name:'MacBook Pro'},name:'MacBook Pro',scope:'computer',connected:true,snapshot:{scopedAgentsSupported:true,taskBehaviorSupported:true,defaults:{scopedSettings:{environment:{},shared:[{key:'global',updatedAt:1,changeId:'global',value:global}]}},workspace:{agents:[],repositories:[window.repo]}}}];
window.documents={global};window.writes=[];
window.request=async(path,input)=>{
 if(path==='/api/runtime/preferences/read')return {autoContinueAfterRestart:false,settleOnPullClose:false};
 if(path==='/api/agents/models')return {models:[{id:'gpt-6.1-sol',name:'GPT-6.1',reasoning:['low','medium','high'].map(id=>({id,name:id}))},{id:'claude-sonnet-4-6',name:'Claude Sonnet 4.6',reasoning:['low','medium','high'].map(id=>({id,name:id}))}],reasoning:['low','medium','high'].map(id=>({id,name:id}))};
 const key=input.scope;
 const inherited={...(key==='global'?{}:window.documents.global),agents:builtInAgentPresets()};
 if(path.endsWith('/read'))return {value:window.documents[key]||{},inherited,projectKey:'project:github.com/team/dovo'};
 if(path.endsWith('/save')){window.documents[key]=input.after;window.writes.push(input);return {value:input.after,inherited}};
 throw Error(path);
};
window.runtime={...window.sources[0],request:window.request,activeRuntimeId:'computer',refreshRuntimes:async()=>{}};
const views=[
 {id:'general',title:'General',order:.1,settingsSection:'app',keywords:'organization navigation'},
 {id:'conversation-settings',title:'Conversation',order:.3,settingsSection:'app',keywords:'composer streaming markdown'},
 {id:'updates-settings',title:'Updates & about',order:.7,settingsSection:'app',keywords:'version licenses'},
 {id:'agents',title:'Agents',order:2,settingsSection:'agents',keywords:'codex claude models providers profiles'},
 {id:'task-defaults',title:'Task defaults',order:3,settingsSection:'coding',keywords:'inherit permissions setup lifecycle'},
];
function Content(){const [view,setView]=useState('general');const confirm=useConfirmSettingsNavigation();window.changeView=id=>{if(id!==view&&confirm())setView(id)};return <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row"><SettingsNav views={views} activeId={view} onSelect={window.changeView}/>{view==='general'?<General/>:view==='conversation-settings'?<Conversation/>:view==='updates-settings'?<About/>:view==='agents'?<Agents/>:<TaskDefaults/>}</div>}
createRoot(document.getElementById('app')).render(<SettingsTargetProvider><Content/></SettingsTargetProvider>);`,
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
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Settings inheritance').count(),
    0,
    'Device preferences have no inherited scope',
  )
  const screenshot = async (name) => {
    if (process.env.DOVO_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: process.env.DOVO_SETTINGS_SCREENSHOTS + '/' + name + '.png' })
      await page.screenshot({
        path: process.env.DOVO_SETTINGS_SCREENSHOTS + '/' + name + '.jpg',
        type: 'jpeg',
        quality: 80,
      })
    }
  }
  await screenshot('general-dark')
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'light'
    void document.body.offsetHeight
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
  })
  await screenshot('general-light')
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'dark'
    void document.body.offsetHeight
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
  })
  const choose = async (label, option) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('dialog').getByRole('option', { name: option, exact: true }).click()
  }
  const search = page.getByRole('textbox', { name: 'Search settings', exact: true })
  await search.fill('composer')
  assert.equal(await page.getByRole('button', { name: 'General', exact: true }).count(), 0)
  await search.press('Enter')
  await page.getByRole('heading', { name: 'Conversation', exact: true, level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Clear settings search', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await choose('Project order', 'Last user message')
  await page.getByLabel('Add project starts in', { exact: true }).fill('~/Code')
  await page.getByRole('button', { name: 'Set up your agents', exact: false }).click()
  await page.getByRole('heading', { name: 'Agents', exact: true, level: 1 }).waitFor()
  const profiles = page.getByRole('navigation', { name: 'Provider configurations' })
  await profiles.getByRole('button', { name: /Claude Code/ }).waitFor()
  assert.equal(await profiles.getByRole('button').count(), 8, 'Providers are present before setup')
  await screenshot('agents-dark')
  await profiles.getByRole('button', { name: /Claude Code/ }).click()
  await page.getByLabel('Instructions', { exact: true }).fill('Always explain your changes.')
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Claude Code saved' }).waitFor()
  assert.equal((await page.evaluate(() => window.writes.at(-1))).after.agents[0].id, 'dovo:claude')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.getByText(/Saving creates an override/).waitFor()
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1).after.agents), [])
  await page.getByRole('button', { name: 'Open task defaults', exact: true }).click()
  await page.getByRole('button', { name: 'Auto-resume limited tasks', exact: true }).waitFor()
  await screenshot('task-defaults-dark')
  await choose('Auto-resume limited tasks', 'Off')
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  let writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'global')
  assert.equal(writes.at(-1).after.taskBehavior.quotaResume, false)
  assert.deepEqual(writes.at(-1).after.resources, { skills: [], mcpServers: [] })
  await choose('Settings project', 'Dovo')
  await choose('Settings computer', 'MacBook Pro')
  await choose('Auto-resume limited tasks', 'On')
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'environment-project')
  assert.equal(writes.at(-1).repositoryId, 'project')
  await page
    .getByRole('button', { name: 'Use inherited auto-resume limited tasks', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save lifecycle settings', exact: true }).click()
  await page.waitForFunction(
    () => window.writes.at(-1).after.taskBehavior.quotaResume === undefined,
  )
  await choose('Working directory', 'New worktree')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Edit Global settings', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit Project on computer settings', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Working directory', exact: true })
      .getAttribute('data-value'),
    'worktree',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  await page.getByRole('switch', { name: 'Formatted composer preview', exact: true }).click()
  assert.equal(
    await page
      .getByRole('switch', { name: 'Formatted composer preview', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )
  await page.getByRole('radio', { name: 'Finished paragraphs', exact: true }).click()
  await page.getByRole('button', { name: 'Updates & about', exact: true }).click()
  await page.getByRole('button', { name: 'View notices', exact: true }).click()
  await page.getByRole('dialog').getByText('Open source notices', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Settings should fit a narrow viewport',
  )
  await choose('Settings section', 'Agents')
  await page.getByRole('button', { name: 'Agent profile', exact: true }).waitFor()
  await page.getByLabel('Name', { exact: true }).waitFor()
  await screenshot('agents-narrow')
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Agent editor fits a narrow viewport',
  )
  await choose('Agent profile', 'Claude Code · Inherited')
  await page.getByLabel('Name', { exact: true }).waitFor()
  await choose('Settings section', 'Task defaults')
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Working directory"]').disabled,
  )
  await screenshot('task-defaults-narrow')
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Task defaults fit a narrow viewport',
  )
  await choose('Settings section', 'General')
  if (process.env.DOVO_GENERAL_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_GENERAL_SCREENSHOT, fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'Settings redesign: built-in profiles, scoped save/reset, lifecycle, unsaved-change protection, app preferences, search/navigation and narrow layouts passed.',
  )
} finally {
  await browser.close()
}
