import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `import {createContext,useContext} from 'react';
export {useAppPreferences,updateAppPreferences,readAppPreferences,useStudioTheme,useResolvedTheme,useDiffOptions} from '${root}/packages/studio-core/src/preferences.ts';
export {importCodeTheme,maxCodeThemeBytes} from '${root}/packages/studio-core/src/code-themes.ts';
export {browserModelCatalogCache} from '${root}/packages/studio-core/src/workspace/model-catalog-cache.ts';
export {SettingsTargetProvider,useSettingsTarget,useOptionalSettingsTarget,useSettingsDraft,useConfirmSettingsNavigation} from '${root}/packages/studio-core/src/settings-target.tsx';
export * from '@dovo/protocol';
export * from '${root}/packages/studio-core/src/themes.ts';
export * from '${root}/packages/studio-core/src/accessibility.ts';
export * from '${root}/packages/studio-core/src/fonts.ts';
export {useRemoteBrowserProfiles} from '${root}/packages/studio-core/src/browser-profiles.ts';
export {providers} from '${root}/packages/studio-core/src/providers.ts';
export const defineStudioExtension=(manifest,views)=>({manifest,views});
export const formatDateTime=value=>new Date(value).toLocaleString();
export const useRuntimeSources=()=>window.sources;
export const taskSortOptions=[{id:'priority',name:'Priority'},{id:'activity',name:'Last activity'}];
export const useStudioHost=()=>({appInfo:{version:'0.0.7',channel:window.headerScreenshots?'nightly':'stable'},browser:()=>{},updates:window.updates,taskLauncher:{configure:async shortcut=>({})},navigate:target=>window.changeView(target.viewId)});
const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;
export const WorkspaceScope=({profile,children})=>{const source=window.sources.find(source=>source.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,...source,snapshot:source.snapshot,workspace:source.snapshot.workspace}}>{children}</Scope.Provider>};`
const ui = `
export * as Popover from '@radix-ui/react-popover';
export * from '${root}/packages/studio-ui/src/sidebar-header.tsx';
export * from '${root}/packages/studio-ui/src/components/ui/dialog.tsx';
export * from '${root}/packages/studio-ui/src/components/ui/tooltip.tsx';
export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';
export * from '${root}/packages/studio-ui/src/components/ui/select.tsx';
export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';
export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea.tsx';
export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';
export {AgentAvatar,agentIconChoices} from '${root}/packages/studio-ui/src/agent-avatar.tsx';
export {ChoicePicker} from '${root}/packages/studio-ui/src/choice-picker.tsx';
export {SettingSource} from '${root}/packages/studio-ui/src/setting-source.tsx';
export {ModelSettings} from '${root}/packages/studio-ui/src/model-settings.tsx';
export {PermissionPolicyFields,permissionPolicyUIIssue} from '${root}/packages/studio-ui/src/permission-policy-fields.tsx';
export {HostSettingsPage} from '${root}/packages/studio-ui/src/host-settings-page.tsx';
export {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';
export {TaskDefaultSettings} from '${root}/packages/studio-ui/src/task-default-settings.tsx';
export {TaskBehaviorSettings} from '${root}/packages/studio-ui/src/task-behavior-settings.tsx';
export * from '${root}/packages/studio-ui/src/settings-layout.tsx';`
const mocks = {
  '@dovo/studio-core': core,
  './workspace/context': `export const useWorkspace=()=>window.runtime;`,
  './workspace/provider': `export const useWorkspace=()=>window.runtime;`,
  './workspace/runtime-sources': `export const useRuntimeSources=()=>window.sources;`,
  './runtime/application-state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': ui,
  './harness-updates': `export const HarnessUpdates=()=>null;`,
  './acp-registry': `export const AcpRegistry=()=>null;export const AcpRegistrySettings=()=>null;`,
  './provider-check': `export const ProviderCheck=()=>null;`,
  'pull-request-preferences': `export const PullRequestPreferences=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {builtInAgentPresets,defaultTaskHarness} from '@dovo/protocol';
import {SettingsTargetProvider,useConfirmSettingsNavigation,useDiffOptions} from '@dovo/studio-core';
import {SettingsNav} from '${root}/packages/studio-shell/src/settings-nav.tsx';
import {SidebarHeaderLayout,HeaderFallback} from '${root}/packages/studio-ui/src/sidebar-header.tsx';
import {TitleBar} from '${root}/packages/studio-shell/src/title-bar.tsx';
import {TooltipProvider} from '@dovo/studio-ui';
import General from '${root}/packages/studio-shell/src/app-settings/general.tsx';
import TaskList from '${root}/packages/studio-shell/src/app-settings/task-list.tsx';
import {appSettingsExtension} from '${root}/packages/studio-shell/src/app-extension.ts';
import {agentsExtension} from '${root}/packages/extension-agents/src/index.ts';
import {runtimeExtension} from '${root}/packages/extension-runtime/src/index.ts';
import {scmExtension} from '${root}/packages/extension-scm/src/index.ts';
import {tasksExtension} from '${root}/packages/extension-tasks/src/index.ts';
import Conversation from '${root}/packages/studio-shell/src/app-settings/conversation.tsx';
import About from '${root}/packages/studio-shell/src/app-settings/about.tsx';
import Appearance from '${root}/packages/studio-shell/src/app-settings/appearance.tsx';
import {useAppearance} from '${root}/packages/studio-shell/src/appearance.ts';
import Notifications from '${root}/packages/studio-shell/src/app-settings/notifications.tsx';
import Shortcuts from '${root}/packages/studio-shell/src/app-settings/shortcuts.tsx';
import Browser from '${root}/packages/studio-shell/src/app-settings/browser.tsx';
import PullRequests from '${root}/packages/extension-runtime/src/pull-request-settings-view.tsx';
import Diffs from '${root}/packages/studio-shell/src/app-settings/diffs.tsx';
import Usage from '${root}/packages/studio-shell/src/app-settings/usage.tsx';
import Agents from '${root}/packages/extension-agents/src/view.tsx';
import TaskDefaults from '${root}/packages/extension-runtime/src/task-defaults-view.tsx';
import TaskBehavior from '${root}/packages/extension-runtime/src/task-behavior-view.tsx';
window.repo={id:'project',name:'Dovo',gitIdentity:'github.com/team/dovo',path:'/repo',branch:'main'};
const global={taskDefaults:{setupCommand:'pnpm install'},resources:{skills:[],mcpServers:[]},taskBehavior:{quotaResume:true}};
window.sources=[{profile:{id:'computer',name:'MacBook Pro',connection:{address:'http://computer.local',token:'test-token'}},name:'MacBook Pro',scope:'computer',connected:true,snapshot:{scopedAgentsSupported:true,taskBehaviorSupported:true,threadBehaviorSupported:true,defaults:{scopedSettings:{environment:{},shared:[{key:'global',updatedAt:1,changeId:'global',value:global}]}},workspace:{agents:[],tasks:[],planLimits:[],repositories:[window.repo]}}}];
window.documents={global};window.writes=[];
window.request=async(path,input)=>{
 if(path==='/api/previews/browser/profiles/read')return {profiles:[{id:'default',name:'Default'}]};
 if(path==='/api/previews/browser/profiles/save'){window.browserWrites=input.profiles;return {profiles:input.profiles}};
 if(path==='/api/usage/history/read')return {sourceId:'computer',records:[],notices:[]};
 if(path==='/api/usage/limits/read')return {accounts:[]};
 if(path==='/api/runtime/preferences/read')return {autoContinueAfterRestart:false,settleOnPullClose:false};
 if(path==='/api/agents/models')return {models:[{id:'gpt-6.1-sol',name:'GPT-6.1',reasoning:['low','medium','high'].map(id=>({id,name:id}))},{id:'claude-sonnet-4-6',name:'Claude Sonnet 4.6',reasoning:['low','medium','high'].map(id=>({id,name:id}))}],reasoning:['low','medium','high'].map(id=>({id,name:id}))};
 const key=input.scope;
 const inherited={...(key==='global'?{}:window.documents.global),agents:builtInAgentPresets()};
 if(path.endsWith('/read'))return {value:window.documents[key]||{},inherited,projectKey:'project:github.com/team/dovo'};
 if(path.endsWith('/save')){window.documents[key]=input.after;window.writes.push(input);return {value:input.after,inherited}};
 throw Error(path);
};
window.runtime={...window.sources[0],runtimes:window.sources,request:window.request,activeRuntimeId:'computer',refreshRuntimes:async()=>{},refreshRuntime:async()=>{},readRuntime:(profile,path,input)=>window.request(path,input),runtimeReadCache:()=>({read:async()=>null,write:async()=>{}})};
window.updateState={status:'idle',channel:'stable'};window.updateCalls=[];window.updateListeners=new Set();window.publishUpdate=value=>{window.updateState=value;for(const fn of window.updateListeners)fn(value)};
window.updates={state:async()=>window.updateState,subscribe:fn=>{window.updateListeners.add(fn);return()=>window.updateListeners.delete(fn)},check:async()=>window.updateCalls.push('check'),install:async()=>window.updateCalls.push('install'),setChannel:async channel=>{window.updateCalls.push(channel);window.publishUpdate({...window.updateState,channel})}};
const localPages={appearance:Appearance,notifications:Notifications,shortcuts:Shortcuts,'browser-settings':Browser,'pull-request-monitoring-settings':PullRequests,diffs:Diffs,usage:Usage,'task-list-settings':TaskList};
const views=[appSettingsExtension,agentsExtension,runtimeExtension,scmExtension,tasksExtension].flatMap(extension=>extension.views).filter(view=>view.navigationGroup==='settings');
function Content(){useAppearance();window.diffOptions=useDiffOptions();const [view,setView]=useState('general');const Local=localPages[view];const confirm=useConfirmSettingsNavigation();window.changeView=id=>{if(id!==view&&confirm())setView(id)};return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground md:flex-row"><SettingsNav views={views} activeId={view} onSelect={window.changeView}/><main data-settings-content className="flex min-h-0 min-w-0 flex-1 flex-col">{view==='task-behavior'?<TaskBehavior/>:Local?<Local/>:view==='general'?<General/>:view==='conversation-settings'?<Conversation/>:view==='updates-settings'?<About/>:view==='agents'?<Agents/>:<TaskDefaults/>}</main></div>}
createRoot(document.getElementById('app')).render(<SettingsTargetProvider><TooltipProvider><SidebarHeaderLayout brand={<TitleBar sidebar platform={window.headerScreenshots ? 'darwin' : undefined} online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>}><div className="studio" data-platform={window.headerScreenshots ? 'darwin' : undefined}><HeaderFallback><TitleBar platform={window.headerScreenshots ? 'darwin' : undefined} section="Settings" online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/></HeaderFallback><Content/></div></SidebarHeaderLayout></TooltipProvider></SettingsTargetProvider>);`,
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
        // Read shipped navigation metadata without bundling every extension page into this fixture.
        b.onResolve({ filter: /.*/ }, ({ path, kind, importer }) => {
          if (
            kind === 'dynamic-import' &&
            /\/(studio-shell\/src\/app-extension|extension-(agents|runtime|scm|tasks)\/src\/index|extension-runtime\/src\/settings-views)\.ts$/.test(
              importer,
            )
          )
            return { path, external: true }
        })
        b.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => ({
          path: new URL(path.replace(/\?raw$/, ''), 'file://' + resolveDir + '/').pathname,
          namespace: 'raw',
        }))
        b.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
          contents: await readFile(path, 'utf8'),
          loader: 'text',
        }))
        b.onResolve({ filter: /^\.\/runtime-preferences$/ }, ({ importer }) =>
          importer.endsWith('/pull-request-settings-view.tsx')
            ? { path: 'pull-request-preferences', namespace: 'mock' }
            : undefined,
        )
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
  await page.route('http://settings.local/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://settings.local/')
  const assetDir = root + '/apps/web/dist/client/assets'
  const cssFiles = (await readdir(assetDir)).filter((file) => file.endsWith('.css'))
  for (const file of cssFiles)
    await page.addStyleTag({ content: await readFile(assetDir + '/' + file, 'utf8') })
  if (process.env.DOVO_BROWSER_STYLE_PATH)
    await page.addStyleTag({ content: await readFile(process.env.DOVO_BROWSER_STYLE_PATH, 'utf8') })
  await page.evaluate((value) => {
    window.headerScreenshots = value
  }, !!process.env.DOVO_HEADER_SCREENSHOTS)
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
  const screenshotThemes = async (name) => {
    if (!process.env.DOVO_SETTINGS_SCREENSHOTS) return
    for (const mode of ['light', 'dark']) {
      await page.evaluate(async (mode) => {
        document.documentElement.dataset.theme = mode
        void document.body.offsetHeight
        await Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
      }, mode)
      await screenshot(`${name}-${mode}`)
    }
  }
  if (process.env.DOVO_HEADER_SCREENSHOTS) {
    const brand = await page.locator('.studio-titlebar').boundingBox()
    const heading = await page.locator('.studio-page-header').first().boundingBox()
    assert.equal(brand.y, heading.y, 'Settings and sidebar branding share one row')
  }
  if (process.env.DOVO_HEADER_SCREENSHOTS)
    await page.screenshot({ path: '/tmp/dovo-shared-header-settings-desktop.png' })
  assert.equal(
    await page.locator('.studio-titlebar-brand img, .studio-titlebar-brand svg').count(),
    0,
  )
  // The brand, title and search stay in place while only the settings links scroll.
  await page.setViewportSize({ width: 1280, height: 420 })
  const navigation = page.getByRole('region', { name: 'Settings navigation', exact: true })
  const settingsSidebar = page.getByRole('navigation', { name: 'Settings sections', exact: true })
  const brandBefore = await page.locator('.studio-titlebar').boundingBox()
  const storageBefore = await settingsSidebar.getByLabel('Settings storage').boundingBox()
  assert.ok(
    storageBefore.y + storageBefore.height <= 420,
    'Storage explanation fits a short window',
  )
  const searchBefore = await page
    .getByRole('textbox', { name: 'Search settings', exact: true })
    .boundingBox()
  const titleBefore = await settingsSidebar
    .getByRole('heading', { name: 'Settings', exact: true })
    .boundingBox()
  await navigation.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  assert.ok(
    await navigation.evaluate((element) => element.scrollTop > 0),
    'Settings links actually scroll',
  )
  assert.deepEqual(
    await page.locator('.studio-titlebar').boundingBox(),
    brandBefore,
    'Sidebar brand stays fixed',
  )
  assert.deepEqual(
    await page.getByRole('textbox', { name: 'Search settings', exact: true }).boundingBox(),
    searchBefore,
    'Settings search stays fixed',
  )
  assert.deepEqual(
    await settingsSidebar.getByRole('heading', { name: 'Settings', exact: true }).boundingBox(),
    titleBefore,
    'Settings title stays fixed',
  )
  assert.deepEqual(
    await settingsSidebar.getByLabel('Settings storage').boundingBox(),
    storageBefore,
    'Storage explanation stays visible while settings links scroll',
  )
  await page.getByRole('textbox', { name: 'Search settings', exact: true }).fill('General')
  await settingsSidebar.getByRole('button', { name: 'General', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clear settings search', exact: true }).click()
  await navigation.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  // Scope indicators stay available on unselected navigation entries and never navigate.
  const defaultScope = settingsSidebar.getByRole('button', {
    name: 'Settings scope for Task defaults',
    exact: true,
  })
  await defaultScope.scrollIntoViewIfNeeded()
  assert.equal(await defaultScope.innerText(), '')
  await defaultScope.click()
  await page
    .getByRole('dialog')
    .getByText('Task defaults · Computer & project', { exact: true })
    .waitFor()
  await page.getByRole('heading', { name: 'General', exact: true, level: 1 }).waitFor()
  await page
    .getByRole('dialog')
    .getByText('All projects · All computers', { exact: true })
    .waitFor()
  await page.keyboard.press('Escape')
  const deviceScope = settingsSidebar.getByRole('button', {
    name: 'Settings scope for General',
    exact: true,
  })
  await deviceScope.click()
  await page.getByRole('dialog').getByText('General · This device', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
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
    const select = page.getByRole('combobox', { name: label, exact: true })
    if (await select.count()) {
      await select.click()
      await page.getByRole('option', { name: option, exact: true }).click()
    } else {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.getByRole('dialog').getByRole('option', { name: option, exact: true }).click()
    }
  }
  const search = page.getByRole('textbox', { name: 'Search settings', exact: true })
  const agentsCategory = settingsSidebar.getByRole('heading', {
    name: 'Agents & tools',
    exact: true,
  })
  await agentsCategory.waitFor()
  assert.equal(
    await settingsSidebar.getByRole('button', { name: 'Agents & tools', exact: true }).count(),
    0,
    'Settings groups stay expanded without toggle state',
  )
  await settingsSidebar.getByRole('button', { name: 'Agents', exact: true }).waitFor()
  await search.fill('memory')
  await settingsSidebar.getByRole('button', { name: 'Memory', exact: true }).waitFor()
  await search.press('Escape')
  await settingsSidebar.getByRole('button', { name: 'Agents', exact: true }).waitFor()
  await page.evaluate(() => window.changeView('agents'))
  await settingsSidebar.getByRole('button', { name: 'Agents', exact: true }).waitFor()
  await page.evaluate(() => window.changeView('general'))
  for (const [category, titles] of [
    ['App preferences', ['General', 'Conversation', 'Browser', 'Task list & projects']],
    ['New task defaults', ['Task defaults']],
    ['Running task behavior', ['Running tasks', 'Task lifecycle']],
    ['Agents & tools', ['Agents', 'CLI commands & shell', 'Studio Tools', 'Memory']],
    ['Tasks & projects', ['Worktrees', 'Artifacts']],
    ['Computers', ['Devices & runtime', 'Device previews']],
    ['History', ['Activity & message history', 'Archived tasks']],
  ]) {
    const group = settingsSidebar
      .getByRole('heading', { name: category, exact: true })
      .locator('..')
    for (const title of titles) {
      assert.equal(await group.getByRole('button', { name: title, exact: true }).count(), 1)
    }
  }
  await search.fill('Agents & tools')
  await settingsSidebar.getByRole('button', { name: 'Studio Tools', exact: true }).waitFor()
  assert.equal(
    await settingsSidebar.getByRole('button', { name: 'General', exact: true }).count(),
    0,
  )
  await search.fill('no-such-setting')
  await settingsSidebar.getByRole('status').filter({ hasText: 'No settings match' }).waitFor()
  await search.press('Escape')
  assert.equal(await search.inputValue(), '')
  // Search opens the exact control, including inside collapsed advanced groups.
  await search.fill('long lines')
  await search.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Long lines')
  await page.keyboard.press('Enter')
  await page.locator('[data-search-highlight][data-setting-label="Long lines"]').waitFor()
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.settingLabel),
    'Long lines',
  )
  await search.fill('preferred computer')
  await search.press('Enter')
  await settingsSidebar.getByRole('status').filter({ hasText: 'Choose a project first.' }).waitFor()
  await search.fill('submodules')
  await search.press('Enter')
  const advancedSetup = page.locator(
    'details:has(> summary[data-setting-label="Advanced workspace setup"])',
  )
  await page.locator('[data-search-highlight][data-setting-label="Submodules"]').waitFor()
  assert.equal(await advancedSetup.getAttribute('open'), '')
  const writesBeforeDiscard = await page.evaluate(() => window.writes.length)
  await choose('Working directory', 'New worktree')
  const actions = await page
    .getByRole('group', { name: 'Settings save actions', exact: true })
    .boundingBox()
  assert.ok(
    actions && actions.y >= 0 && actions.y + actions.height <= 901,
    'Save and Discard stay inside the visible settings area',
  )
  // Rejecting search navigation preserves the draft and never highlights another page.
  page.once('dialog', (dialog) => dialog.dismiss())
  await search.fill('time format')
  await search.press('Enter')
  await page.getByRole('heading', { name: 'Task defaults', level: 1, exact: true }).waitFor()
  assert.equal(
    await page.getByRole('combobox', { name: 'Working directory', exact: true }).innerText(),
    'New worktree',
  )
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  assert.equal(await page.evaluate(() => window.writes.length), writesBeforeDiscard)
  assert.equal(
    await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
    true,
  )
  await search.press('Enter')
  await page.locator('[data-search-highlight][data-setting-label="Time format"]').waitFor()
  await page.getByRole('button', { name: 'Clear settings search', exact: true }).click()
  assert.equal(await page.locator('[data-search-highlight]').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await search.fill('long lines')
  await settingsSidebar.getByRole('button', { name: 'Long lines', exact: true }).click()
  await page.locator('[data-search-highlight][data-setting-label="Long lines"]').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await search.press('Escape')
  await page.setViewportSize({ width: 1280, height: 900 })
  await search.fill('confirmation')
  await search.press('Enter')
  await page.getByRole('heading', { name: 'Task list & projects', exact: true, level: 1 }).waitFor()
  await search.press('Escape')
  await search.fill('composer')
  assert.equal(await page.getByRole('button', { name: 'General', exact: true }).count(), 0)
  await search.press('Enter')
  await page.getByRole('heading', { name: 'Conversation', exact: true, level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Clear settings search', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  assert.equal(await page.getByLabel('Inherited settings target').count(), 0)
  await settingsSidebar.getByRole('button', { name: 'Task list & projects', exact: true }).click()
  await page.getByRole('heading', { name: 'Task list & projects', exact: true, level: 1 }).waitFor()
  await choose('Project order', 'Last user message')
  await page.getByRole('textbox', { name: 'Add project starts in', exact: true }).fill('~/Code')
  await page.getByRole('switch', { name: 'Confirm before deleting a task', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.app-preferences.v1')).projectOrder,
    ),
    'user-message',
  )
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.app-preferences.v1')).addProjectStartsIn,
    ),
    '~/Code',
  )
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.app-preferences.v1')).confirmDelete,
    ),
    false,
  )
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await settingsSidebar.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('heading', { name: 'Agents', exact: true, level: 1 }).waitFor()
  await settingsSidebar.getByLabel('Inherited settings target').waitFor()
  assert.equal(
    await settingsSidebar
      .getByLabel('Inherited settings target')
      .locator('button, a, input, select, [tabindex]')
      .count(),
    0,
    'Scope summary contains no controls',
  )
  const profiles = page.getByRole('navigation', { name: 'Provider configurations' })
  await profiles.getByRole('button', { name: /Claude Code/ }).waitFor()
  assert.equal(await profiles.getByRole('button').count(), 9, 'Providers are present before setup')
  await profiles.getByRole('button', { name: /Mistral Vibe/ }).waitFor()
  await screenshot('agents-dark')
  await profiles.getByRole('button', { name: /Claude Code/ }).click()
  await page.getByLabel('Instructions', { exact: true }).fill('Always explain your changes.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Claude Code saved' }).waitFor()
  assert.equal((await page.evaluate(() => window.writes.at(-1))).after.agents[0].id, 'dovo:claude')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.getByText(/Saving creates an override/).waitFor()
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1).after.agents), [])
  await page.getByRole('button', { name: 'Open task defaults', exact: true }).click()
  await settingsSidebar.getByRole('button', { name: 'Task lifecycle', exact: true }).click()
  await page.getByRole('combobox', { name: 'Auto-resume limited tasks', exact: true }).waitFor()
  await screenshot('task-defaults-dark')
  await choose('Auto-resume limited tasks', 'Off')
  await choose('Auto-archive settled tasks', 'On')
  await page
    .getByRole('textbox', { name: 'Days in Settled before archiving', exact: true })
    .fill('12')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Changes saved.' }).waitFor()
  let writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'global')
  assert.equal(writes.at(-1).after.taskBehavior.quotaResume, false)
  assert.equal(writes.at(-1).after.taskBehavior.autoArchiveSettled, true)
  assert.equal(writes.at(-1).after.taskBehavior.archiveAfterSettledDays, 12)
  assert.deepEqual(writes.at(-1).after.resources, { skills: [], mcpServers: [] })
  await choose('Settings project', 'Dovo')
  assert.equal(await page.getByRole('button', { name: 'Settings machine', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Edit computer overrides', exact: true }).click()
  await settingsSidebar
    .getByLabel('Inherited settings target')
    .getByText('Dovo · MacBook Pro', { exact: true })
    .waitFor()
  await page.getByText('Dovo on MacBook Pro', { exact: true }).waitFor()
  if (process.env.DOVO_SETTINGS_SCREENSHOTS)
    await page
      .getByRole('heading', { name: 'Task lifecycle', exact: true, level: 2 })
      .evaluate((element) => {
        element.scrollIntoView({ block: 'start' })
      })
  await screenshotThemes('task-defaults-project-computer-desktop')
  await choose('Auto-resume limited tasks', 'On')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Changes saved.' }).waitFor()
  writes = await page.evaluate(() => window.writes)
  assert.equal(writes.at(-1).scope, 'environment-project')
  assert.equal(writes.at(-1).repositoryId, 'project')
  await page
    .getByRole('button', { name: 'Use inherited auto-resume limited tasks: Off', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(
    () => window.writes.at(-1).after.taskBehavior.quotaResume === undefined,
  )
  await settingsSidebar.getByRole('button', { name: 'Task defaults', exact: true }).click()
  await choose('Working directory', 'New worktree')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).count(),
    1,
  )
  assert.equal(
    await page.getByRole('combobox', { name: 'Working directory', exact: true }).innerText(),
    'New worktree',
  )
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Task list & projects', exact: true }).click()
  await page.getByRole('heading', { name: 'Task defaults', exact: true, level: 1 }).waitFor()
  assert.equal(
    await settingsSidebar
      .getByRole('button', { name: 'Task defaults', exact: true })
      .getAttribute('aria-current'),
    'page',
  )
  await page.getByText('Dovo on MacBook Pro', { exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  await page.getByRole('switch', { name: 'Formatted composer preview', exact: true }).click()
  assert.equal(
    await page
      .getByRole('switch', { name: 'Formatted composer preview', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )
  await choose('Response streaming', 'Finished paragraphs')
  const openLocal = async (title) => {
    await page.getByRole('button', { name: title, exact: true }).click()
    await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor()
  }
  const preference = (key) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem('dovo.app-preferences.v1'))[key], key)
  await openLocal('General')
  await choose('Global new task shortcut', 'Disabled')
  assert.equal(await preference('taskLauncherShortcut'), '')
  await choose('Time format', '24-hour')
  assert.equal(await preference('timeFormat'), '24h')
  await openLocal('Appearance')
  await choose('Status colors', 'GitHub colorblind · higher contrast')
  assert.equal(await preference('colorVision'), 'blue-orange')
  const success = page.getByLabel('Status color preview').getByText('Finished', { exact: true })
  assert.equal(await success.evaluate((el) => getComputedStyle(el).color), 'rgb(173, 220, 255)')
  await page.getByRole('switch', { name: 'Higher contrast', exact: true }).click()
  assert.equal(await preference('highContrast'), true)
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
    ),
    '#888888',
  )
  assert.equal(await page.evaluate(() => window.diffOptions.options.diffIndicators), 'classic')
  assert.ok((await page.evaluate(() => window.diffOptions.options.unsafeCSS)).includes('#addcff'))
  await page.getByLabel('VS Code theme file', { exact: true }).setInputFiles({
    name: 'Accessibility light.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        name: 'Accessibility light',
        type: 'light',
        colors: { 'editor.background': '#ffffff', 'editor.foreground': '#111111' },
        tokenColors: [],
      }),
    ),
  })
  await page.waitForFunction(() => window.diffOptions.options.themeType === 'light')
  assert.ok((await page.evaluate(() => window.diffOptions.options.unsafeCSS)).includes('#023b95'))
  assert.ok((await page.evaluate(() => window.diffOptions.options.unsafeCSS)).includes('#404040'))
  await page.getByRole('button', { name: 'Remove theme', exact: true }).click()
  await page.waitForFunction(() => window.diffOptions.options.themeType === 'dark')
  await choose('Color scheme', 'Light')
  assert.equal(await success.evaluate((el) => getComputedStyle(el).color), 'rgb(2, 59, 149)')
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
    ),
    '#777777',
  )
  await page.getByRole('switch', { name: 'Higher contrast', exact: true }).click()
  await page.emulateMedia({ forcedColors: 'active' })
  await page.getByRole('combobox', { name: 'App font', exact: true }).focus()
  await page.keyboard.press('Tab')
  const codeFont = page.getByRole('combobox', { name: 'Code font', exact: true })
  assert.equal(await codeFont.evaluate((el) => document.activeElement === el), true)
  assert.equal(await codeFont.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid')
  assert.equal(await codeFont.evaluate((el) => getComputedStyle(el).outlineWidth), '2px')
  await page.emulateMedia({ forcedColors: 'none' })
  await choose('Status colors', 'GitHub colorblind')
  await choose('Color scheme', 'Dark')
  await choose('Text size', 'Large')
  await choose('Chat width', 'Full width')
  await choose('Animations', 'Reduce')
  assert.equal(await preference('textSize'), 'large')
  assert.equal(await preference('chatWidth'), 'full')
  assert.equal(await preference('motion'), 'reduce')
  await choose('Text size', 'Default')
  await openLocal('Notifications')
  await page.evaluate(() => {
    const MockNotification = class {
      static permission = 'default'
      static requestPermission = () =>
        new Promise((resolve) => {
          window.resolvePermission = resolve
        })
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: MockNotification })
  })
  const inputNotice = page.getByRole('switch', {
    name: 'Notify when a task needs your input',
    exact: true,
  })
  await inputNotice.click()
  await page
    .getByRole('status')
    .filter({ hasText: 'Waiting for notification permission' })
    .waitFor()
  assert.equal(await inputNotice.isDisabled(), true)
  await page.evaluate(() => window.resolvePermission('denied'))
  await page.getByRole('alert').filter({ hasText: 'Notifications are blocked' }).waitFor()
  assert.equal(await inputNotice.getAttribute('aria-checked'), 'false')
  await page.evaluate(() => {
    Notification.permission = 'granted'
  })
  await inputNotice.click()
  assert.equal(await preference('notifyInput'), true)
  await openLocal('Keyboard shortcuts')
  assert.equal(await page.getByRole('table').count(), 4)
  assert.equal(
    await page.getByRole('rowheader', { name: 'Cycle tool activity views', exact: true }).count(),
    1,
  )
  await openLocal('Browser')
  await page
    .getByText(
      'Preview defaults and local profiles stay on this device. Remote profiles and logins stay on the selected computer.',
      { exact: true },
    )
    .waitFor()
  assert.equal(
    await page.getByText('This device · saved automatically', { exact: true }).count(),
    0,
  )
  await settingsSidebar
    .getByLabel('Settings storage')
    .getByText('This device + computer', { exact: true })
    .waitFor()
  assert.equal(await settingsSidebar.getByLabel('Inherited settings target').count(), 0)
  await choose('Default viewport', 'Phone')
  assert.equal(await preference('browserViewport'), 'phone')
  const localProfiles = page
    .getByRole('heading', { name: 'Local browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  await localProfiles.getByRole('textbox', { name: 'New profile name' }).fill('Local work')
  await localProfiles.getByRole('button', { name: 'Add profile', exact: true }).click()
  await localProfiles.getByRole('textbox', { name: 'Name for Local work' }).waitFor()
  assert.equal((await preference('browserProfiles')).at(-1).name, 'Local work')
  const remoteProfiles = page
    .getByRole('heading', { name: 'Remote browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  await remoteProfiles.getByRole('textbox', { name: 'New profile name' }).fill('Remote work')
  await remoteProfiles.getByRole('button', { name: 'Add profile', exact: true }).click()
  await remoteProfiles.getByRole('textbox', { name: 'Name for Remote work' }).waitFor()
  assert.equal(await page.evaluate(() => window.browserWrites.at(-1).name), 'Remote work')
  assert.equal((await preference('browserProfiles')).at(-1).name, 'Local work')
  await openLocal('Pull requests & pipelines')
  await page
    .getByText(
      'Creation defaults are saved on this device. Lifecycle and monitoring settings are saved on the selected computer.',
      { exact: true },
    )
    .waitFor()
  await page.getByText('Computer settings on MacBook Pro', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('This device · saved automatically', { exact: true }).count(),
    0,
  )
  await choose('Merge method', 'Squash and merge')
  assert.equal(await preference('mergeMethod'), 'squash')
  await openLocal('Review & diffs')
  await choose('Default diff layout', 'Split (side by side)')
  await choose('Changes within a line', 'Characters')
  assert.equal(await preference('diffLayout'), 'split')
  assert.equal(await preference('diffHighlight'), 'char')
  await openLocal('Usage & limits')
  await settingsSidebar
    .getByLabel('Settings storage')
    .getByText('Across computers', { exact: true })
    .waitFor()
  await choose('Period', 'Last 30 days')
  await page.getByRole('radio', { name: 'Limits', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'No account limits reported' }).waitFor()
  await screenshot('usage-limits-empty')
  await page.getByRole('button', { name: 'Updates & about', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await choose('Release channel', 'Nightly')
  assert.deepEqual(await page.evaluate(() => window.updateCalls), ['check', 'nightly'])
  await page.evaluate(() =>
    window.publishUpdate({ status: 'downloaded', channel: 'nightly', version: '0.0.8' }),
  )
  await page.getByRole('button', { name: 'Restart to update', exact: true }).click()
  assert.equal(await page.evaluate(() => window.updateCalls.at(-1)), 'install')
  await page.evaluate(() =>
    window.publishUpdate({
      status: 'error',
      channel: 'nightly',
      error: 'Update server unavailable',
    }),
  )
  await page.getByRole('alert').filter({ hasText: 'Update server unavailable' }).waitFor()
  await page.getByRole('button', { name: 'View notices', exact: true }).click()
  await page.getByRole('dialog').getByText('Open source notices', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  if (process.env.DOVO_SETTINGS_SCREENSHOTS) {
    for (const title of [
      'General',
      'Task list & projects',
      'Appearance',
      'Conversation',
      'Notifications',
      'Keyboard shortcuts',
      'Browser',
      'Updates & about',
      'Pull requests & pipelines',
      'Review & diffs',
      'Usage & limits',
    ]) {
      await openLocal(title)
      await screenshot(title.toLowerCase().replaceAll(/[^a-z]+/g, '-') + '-desktop')
      if (title === 'Task list & projects') await screenshotThemes('task-list-projects-desktop')
    }
  }
  // Keep the medium-width sidebar compact while allowing longer page and storage labels to wrap.
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('nav[aria-label="Settings sections"]')
    return innerWidth === 900 && sidebar && getComputedStyle(sidebar).width === '208px'
  })
  assert.equal((await settingsSidebar.boundingBox()).width, 208)
  for (const title of [
    'Task list & projects',
    'Pull requests & pipelines',
    'Agents',
    'Task defaults',
  ]) {
    await openLocal(title)
    assert.deepEqual(
      await navigation
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => button.scrollWidth > button.clientWidth)
            .map((button) => button.getAttribute('aria-label')),
        ),
      [],
      `${title}: navigation labels fit the 208px sidebar`,
    )
    assert.ok(
      (await navigation.getByRole('button', { name: title, exact: true }).boundingBox()).height <=
        90,
      `${title}: selected label stays compact`,
    )
    if (['Pull requests & pipelines', 'Task defaults'].includes(title))
      await screenshotThemes(
        title === 'Task defaults' ? 'scope-sidebar-208px' : 'mixed-storage-sidebar-208px',
      )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Settings should fit a narrow viewport',
  )
  await page.getByRole('combobox', { name: 'Settings section', exact: true }).click()
  const sectionChoices = page.getByRole('listbox')
  for (const [category, title] of [
    ['App preferences', 'General'],
    ['Agents & tools', 'Agents'],
    ['New task defaults', 'Task defaults'],
    ['Computers', 'Devices & runtime'],
    ['History', 'Archived tasks'],
  ]) {
    assert.equal(
      await sectionChoices
        .getByRole('group', { name: category, exact: true })
        .getByRole('option', { name: title, exact: true })
        .count(),
      1,
      `${title} keeps its category in the narrow chooser`,
    )
  }
  await page.keyboard.press('Home')
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('role') === 'option' &&
      document.activeElement.textContent === 'General',
  )
  await screenshotThemes('settings-section-groups-narrow')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'General', exact: true, level: 1 }).waitFor()
  for (const title of [
    'General',
    'Task list & projects',
    'Appearance',
    'Conversation',
    'Notifications',
    'Keyboard shortcuts',
    'Browser',
    'Updates & about',
    'Pull requests & pipelines',
    'Review & diffs',
    'Usage & limits',
  ]) {
    await choose('Settings section', title)
    await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${title} fits a narrow viewport`,
    )
    await screenshot(title.toLowerCase().replaceAll(/[^a-z]+/g, '-') + '-narrow')
    if (['General', 'Task list & projects'].includes(title))
      await screenshotThemes(title.toLowerCase().replaceAll(/[^a-z]+/g, '-') + '-narrow')
  }
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
    () => !document.querySelector('[role="combobox"][aria-label="Working directory"]').disabled,
  )
  await screenshotThemes('task-defaults-project-computer-narrow')
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
    'Settings: permanently expanded navigation, shared page frames, category/control search, storage labels, all app pages, persisted preferences, notification permissions, local/remote profiles, update states, scoped agents/lifecycle, navigation and narrow layouts passed.',
  )
} finally {
  await browser.close()
}
