import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const viewer = `<html><body><script>
let tab='',url='',back=true;
function state(){window.parent.postMessage({channel:'dovo-browser',type:'state',url,title:'Page '+tab,back,forward:false,loading:false,editable:false},'*')}
window.addEventListener('message',event=>{const m=event.data;
if(m.type==='connect'){const ticket=JSON.parse(new URL(m.url).searchParams.get('ticket'));tab=ticket.tabId;url=ticket.url;window.parent.postMessage({channel:'dovo-browser',type:'connection',online:true},'*');state()}
if(m.type==='input'){window.parent.postMessage({channel:'fixture',input:m.input},'*');if(m.input.type==='navigate')url=m.input.url;state()}
if(m.type==='viewport')window.parent.postMessage({channel:'fixture',viewport:m},'*');
});</script></body></html>`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {BrowserPane} from './src/browser/browser-pane.tsx';import BrowserView from './src/browser/browser-view.tsx';import {selectedBrowserText} from '@dovo/protocol';window.selectedBrowserText=selectedBrowserText;import {TooltipProvider} from '@dovo/studio-ui';window.renderBrowser=()=>root.render(<TooltipProvider>{window.fixtureGate ? <BrowserView navigationKey="fixture-gate"/> : <BrowserPane taskId="studio:browser" shared/>}</TooltipProvider>);const root=createRoot(document.getElementById('app'));window.renderBrowser();`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /^@dovo\/studio-core(\/state)?$|^\.\/workspace\/context$/ },
          ({ path }) => ({
            path: path.endsWith('/state') ? path : '@dovo/studio-core',
            namespace: 'fixture',
          }),
        )
        builder.onResolve(
          { filter: /^\.\/(device-list|physical-controls|screenshot-attachment)$/ },
          ({ path }) => ({
            path,
            namespace: 'fixture',
          }),
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'js',
          resolveDir: root + 'packages/extension-tasks',
          contents: path.endsWith('/state')
            ? `export {useState as useApplicationState} from 'react';`
            : path === './screenshot-attachment'
              ? 'export const useScreenshotAttachment=()=>({editor:null,error:"",busy:false,attach:async()=>{}});'
              : path === './device-list'
                ? 'export const DeviceList=()=>null;'
                : path === './physical-controls'
                  ? 'export const PhysicalControls=()=>null;'
                  : `
import {createContext,createElement,useContext,useState,useSyncExternalStore} from 'react';
import {resolveSettingsTarget} from '@dovo/protocol';
import {Effect} from 'effect';
export * from '@dovo/protocol';
export {updateTask,createTask} from '${root}packages/studio-core/src/workspace/actions.ts';
export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes.ts';
export {DiscoveryCache} from '${root}packages/client-runtime/src/index.ts';
export {browserModelCatalogCache} from '${root}packages/studio-core/src/workspace/model-catalog-cache.ts';
export {useSettingsDraft,useConfirmSettingsNavigation,useOptionalSettingsTarget} from '${root}packages/studio-core/src/settings-target.tsx';
export const providers=[];export const useResolvedTheme=()=> 'dark';export const reducedMotion=()=>false;
export const remoteBrowserHtml=${JSON.stringify(viewer)};
const profileCatalogs={runtime:[{id:'default',name:'LAN Default'},{id:'remote-work',name:'LAN Work'},{id:'remote-personal',name:'LAN Personal'}],mac:[{id:'default',name:'Remote Default'},{id:'remote-work',name:'Remote Work'},{id:'remote-personal',name:'Remote Personal'}]};
window.browserInputs=[];window.browserViewports=[];window.addEventListener('message',event=>{if(event.data?.channel==='fixture'){if(event.data.input)window.browserInputs.push(event.data.input);if(event.data.viewport)window.browserViewports.push(event.data.viewport)}});
const remoteTicket=body=>({ok:true,ticket:JSON.stringify({tabId:body.tabId,url:body.url||'about:blank'}),tabId:body.tabId,profileId:body.profileId});
window.calls=[]; const request=async(path,body)=>{window.calls.push({path,body});if(path.endsWith('/profiles/read'))return {profiles:profileCatalogs.runtime};return remoteTicket(body)};
const nativePages=new Map();window.openedLinks=[];window.createdTabs=[];window.closedTabs=[];const browser=async(command)=>{window.calls.push(command);if(command.action==='show')nativePages.set(command.key,{url:command.url,title:'',back:false,forward:false});if(command.action==='status')return {...nativePages.get(command.key),openedLinks:window.openedLinks.splice(0),createdTabs:window.createdTabs.splice(0),closedTabs:window.closedTabs.splice(0)};if(command.action==='screenshot'){if(window.holdCapture)await new Promise(resolve=>window.finishCapture=resolve);return {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};}if(command.action==='selection')return {url:'http://localhost:3000/',title:'Source page',selection:window.fixtureSelection,back:false,forward:false};};
const browserExtensions=async command=>({extensions:[],capabilities:{unpackedFolders:true,nativeMessaging:true,chromeWebStore:true,remoteRuntimes:false}});
window.fixtureSelection='Keep  spaces\\nSecond line';
const profile={id:'runtime',name:'LAN runtime',connection:{address:'http://runtime.local',token:'paired-device'}};
const task={id:'target',title:'Destination thread',repositoryId:'repo',agentId:'',status:'draft',draft:'Existing draft',createdAt:'2026-10-25T00:00:00Z',messages:[],files:[],example:false};
const snapshot={runtimeHost:'LAN runtime',workspace:{tasks:[task],repositories:[{id:'repo',name:'Project'}],agents:[]}};
const otherProfile={id:'mac',name:'Mac Studio',connection:{address:'http://mac.local',token:'paired-mac'}};
const otherSnapshot={...snapshot,workspace:{...snapshot.workspace,tasks:[{...task,id:'remote-target',title:'Mac thread',draft:'Remote draft'}]}};
const sources=[{profile,name:profile.name,scope:'runtime',connected:true,snapshot},{profile:otherProfile,name:otherProfile.name,scope:'mac',connected:true,snapshot:otherSnapshot}];
export const useRuntimeSources=()=>sources;
const workspace={activeRuntimeId:profile.id,connection:profile.connection,request,connected:true,snapshot,workspace:snapshot.workspace,runtimes:sources,runtimeRegistry:{profiles:[profile,otherProfile]},
readRuntime:async(owner,path,body)=>{window.calls.push({owner:owner.id,path,body});if(path.endsWith('/profiles/read'))return {profiles:profileCatalogs[owner.id]??[]};if(path==='/api/workspace'){if(window.conflict)return {outcome:'reconciled',reason:'Draft changed elsewhere',recoveryId:'11223344-1122-4122-8122-112233445566'};otherSnapshot.workspace.tasks[0].draft=body.changes.draft.after;return {outcome:'applied'}};return remoteTicket(body)},
setWorkspace:update=>{workspace.workspace=typeof update==='function'?update(workspace.workspace):update;window.savedDraft=workspace.workspace.tasks[0].draft},flush:async()=>{if(window.hangFlush)await new Promise(()=>{});},refreshRuntime:async()=>{},};
window.fixtureStore=workspace;window.remoteDraft=()=>otherSnapshot.workspace.tasks[0].draft;
const WorkspaceContext=createContext(null);
export const useWorkspace=()=>useContext(WorkspaceContext)||workspace;
export const WorkspaceScope=({profile,children})=>{
  const source=sources.find(entry=>entry.profile.id===profile.id&&entry.profile.connection.address===profile.connection.address&&entry.profile.connection.token===profile.connection.token);
  if(!source)return null;
  return createElement(WorkspaceContext.Provider,{value:{...workspace,activeRuntimeId:source.profile.id,connection:source.profile.connection,snapshot:source.snapshot,connected:source.connected,request:(path,body)=>workspace.readRuntime(source.profile,path,body)}},children);
};
export const useSettingsTarget=()=>{
  const [target,setTarget]=useState({environmentId:'',projectId:''});
  return {target,setTarget,sources,...resolveSettingsTarget(sources,target,workspace.activeRuntimeId)};
};
export const useStudioHost=()=>({browser,browserExtensions,onBrowserContextAction:listener=>{window.contextAction=listener;return ()=>{window.contextAction=null}},browserWindowId:window.fixtureThreadWindow||window.testMainDraft||window.fixtureGate?undefined:'main',threadWindow:!!window.fixtureThreadWindow,navigate:(target,options)=>window.calls.push({navigate:target,options}),openBrowserWindow:async()=>{window.calls.push({openBrowserWindow:true})},openThread:target=>window.calls.push({openThread:target})});
const preferenceListeners=new Set();let appPreferences={browserWorkspaceEnabled:false,browserProfiles:[{id:'default',name:'Local Default'},{id:'local-work',name:'Local Work'}],browserProfileByThread:{},browserAgentAccess:{}};
window.setExperimental=enabled=>{appPreferences={...appPreferences,browserWorkspaceEnabled:enabled};for(const listener of preferenceListeners)listener()};
export const useAppPreferences=()=>useSyncExternalStore(listener=>{preferenceListeners.add(listener);return ()=>preferenceListeners.delete(listener)},()=>appPreferences);
export {useRemoteBrowserProfiles} from '${root}packages/studio-core/src/browser-profiles.ts';
export const readAppPreferences=()=>({browserViewport:'fill'});
window.preferences=[];export const updateAppPreferences=change=>window.preferences.push(change);const polls=new Set();window.pollBrowser=async()=>{for(const poll of [...polls])await Effect.runPromise(poll)};export const startPolling=poll=>{polls.add(poll);return {stop:async()=>{polls.delete(poll)}}};
`,
        }))
      },
    },
  ],
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app" style="height:800px"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  const loadStyles = async () => {
    for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
      file.endsWith('.css'),
    ))
      await page.addStyleTag({
        content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
      })
  }
  await loadStyles()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  // Direct BrowserPane coverage deliberately bypasses the experimental BrowserView gate.
  const recent = page.getByRole('complementary', { name: 'Recent browser tabs' })
  if (!(await recent.isVisible())) throw new Error('Missing vertical tab list')
  const url = page.getByRole('textbox', { name: 'Preview URL' })
  await url.fill('http://localhost:3000')
  await url.press('Enter')
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  if (
    (await page.evaluate(() => window.calls.find((call) => call.action === 'show'))).url !==
    'http://localhost:3000/'
  )
    throw new Error('Local tab rewrote localhost to runtime')
  const initialTabId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).active,
  )
  assert.equal(
    await page.evaluate(() => window.calls.find((call) => call.action === 'show').key),
    `studio:browser:main:${initialTabId}`,
    'Native session key includes its window and tab',
  )
  const nativeAction = (action) =>
    page.waitForFunction(
      (action) =>
        window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1)?.action ===
        action,
      action,
    )
  // A hung capture must never keep the native view over the real Extensions menu.
  await page.evaluate(() => {
    window.holdCapture = true
  })
  await page.getByRole('button', { name: 'Extensions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Manage extensions', exact: true }).waitFor()
  await page.waitForFunction(() => typeof window.finishCapture === 'function')
  await nativeAction('hide')
  await page.keyboard.press('Escape')
  await nativeAction('show')
  await page.evaluate(() => {
    window.holdCapture = false
    window.finishCapture()
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.locator('img[aria-hidden][src^="data:image/png"]').count(),
    0,
    'Late capture cannot freeze a restored page',
  )
  await page.getByRole('button', { name: 'Extensions', exact: true }).click()
  await nativeAction('hide')
  await page.getByRole('menuitem', { name: 'Manage extensions', exact: true }).click()
  const extensionsDialog = page.getByRole('dialog', { name: 'Browser extensions' })
  await extensionsDialog.waitFor()
  await nativeAction('hide')
  await extensionsDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await nativeAction('show')
  await recent.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New browser window', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.openBrowserWindow).length === 1,
  )
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.openBrowserWindow).length),
    1,
    'New window bridge called exactly once',
  )
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  // Exercise the production DOM extractor, rather than a fixture implementation.
  const extracted = await page.evaluate(() => {
    const fixture = document.createElement('section')
    document.activeElement?.blur()
    fixture.style.whiteSpace = 'pre-wrap'
    fixture.innerHTML = '<p></p><textarea></textarea><input type="password">'
    document.body.append(fixture)
    const paragraph = fixture.querySelector('p')
    const textarea = fixture.querySelector('textarea')
    const password = fixture.querySelector('input')
    const literal = '  Literal <tag> & spaces\nSecond line  '
    paragraph.textContent = literal
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    const documentText = window.selectedBrowserText()
    getSelection().removeAllRanges()
    textarea.value = literal
    textarea.focus()
    textarea.setSelectionRange(2, literal.length - 2)
    const textareaText = window.selectedBrowserText()
    password.value = 'private-password'
    password.focus()
    password.select()
    const passwordText = window.selectedBrowserText()
    textarea.value = 'x'.repeat(32001)
    textarea.focus()
    textarea.select()
    const textareaBound = window.selectedBrowserText()
    textarea.blur()
    paragraph.textContent = 'y'.repeat(32001)
    range.selectNodeContents(paragraph)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    const documentBound = window.selectedBrowserText()
    getSelection().removeAllRanges()
    fixture.remove()
    return { documentText, textareaText, passwordText, textareaBound, documentBound, literal }
  })
  assert.equal(extracted.documentText, extracted.literal, 'Document selection must remain literal')
  assert.equal(extracted.textareaText, extracted.literal.slice(2, -2), 'Textarea selection range')
  assert.equal(extracted.textareaBound, 'x'.repeat(32000), 'Textarea selection bound')
  assert.equal(extracted.documentBound, 'y'.repeat(32000), 'Document selection bound')
  assert.equal(
    await page.getByRole('button', { name: 'Copy selection', exact: true }).count(),
    0,
    'Page actions stay out of the toolbar',
  )
  const pageAction = async (name) => {
    const settings = page.getByRole('dialog', { name: 'Browser settings', exact: true })
    if (!(await settings.isVisible()))
      await page.getByRole('button', { name: 'Browser options', exact: true }).click()
    await settings.getByRole('button', { name, exact: true }).click()
  }
  await pageAction('Copy selection')
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    'Keep  spaces\nSecond line',
    'Clipboard must contain exact selection without source markup',
  )
  // A pending workspace sync must not block opening an unsent local draft.
  await page.evaluate(() => (window.hangFlush = window.testMainDraft = true))
  // Selection actions remain available from options and preserve an existing composer draft.
  await pageAction('Add selection to thread…')
  await page.getByRole('button', { name: 'Destination thread', exact: false }).click()
  await page.waitForFunction(() => window.savedDraft?.includes('> Keep  spaces'))
  if (
    !(await page.evaluate(() =>
      window.savedDraft.startsWith('Existing draft\n\nSource page\nhttp://localhost:3000/'),
    ))
  )
    throw new Error('Existing draft/source lost')
  if ((await page.evaluate(() => window.calls.filter((call) => call.openThread).length)) !== 1)
    throw new Error('Thread was not opened once')
  await page.evaluate(() => (window.hangFlush = window.testMainDraft = false))
  await page.evaluate(() => {
    window.testMainDraft = true
    window.contextAction({
      key: window.calls.find((call) => call.action === 'show').key,
      action: 'selection',
      text: 'Context selected text',
      url: 'https://example.com/source',
      title: 'Context page',
    })
  })
  // Native context-menu selection follows the same unsent draft flow.
  await page.getByRole('dialog', { name: 'Add selection to a thread' }).waitFor()
  await page.getByRole('combobox', { name: 'Project for new draft thread' }).click()
  await page.getByRole('option').first().click()
  await page.getByRole('button', { name: 'Create draft thread', exact: true }).click()
  await page.waitForFunction(() =>
    window.fixtureStore.workspace.tasks.some((task) => task.title === 'Context page'),
  )
  const created = await page.evaluate(() =>
    window.fixtureStore.workspace.tasks.find((task) => task.title === 'Context page'),
  )
  assert.deepEqual(created.messages, [])
  assert.equal(created.status, 'draft')
  assert.equal(created.draft.includes('> Context selected text'), true)
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => /send|start|queue/.test(call.path || '')),
    ),
    false,
    'Selection never sends a prompt',
  )
  await page.evaluate(() => (window.testMainDraft = false))
  await page.evaluate(() => (window.fixtureSelection = ''))
  await pageAction('Add selection to thread…')
  if (
    !(await page
      .getByRole('alert')
      .filter({ hasText: 'Select text on the page first.' })
      .isVisible())
  )
    throw new Error('Missing empty-selection feedback')
  // Each remote tab belongs to its chosen computer, independent of the active runtime.
  await recent.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mac Studio', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.owner === 'mac' && call.path === '/api/previews/browser/open'),
  )
  const opened = await page.evaluate(() =>
    window.calls.find((call) => call.owner === 'mac' && call.path === '/api/previews/browser/open'),
  )
  if (opened.body.taskId !== 'studio:browser') throw new Error('Remote tab borrowed a thread')
  const remoteTab = recent.locator('button[aria-current="page"]')
  await remoteTab.getByText('Remote · Mac Studio', { exact: true }).waitFor()
  assert.equal(
    await remoteTab.locator('[data-runtime-icon]').count(),
    1,
    'Tabs identify their owning computer',
  )
  // The viewer reports the opened address; navigate explicitly instead of inventing a page.
  await url.fill('http://localhost:3000/remote-page')
  await url.press('Enter')
  await page.waitForFunction(() =>
    window.browserInputs.some(
      (input) => input.type === 'navigate' && input.url === 'http://localhost:3000/remote-page',
    ),
  )
  await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
  const opensBeforeReselect = await page.evaluate(
    () => window.calls.filter((call) => call.path === '/api/previews/browser/open').length,
  )
  await remoteTab.click()
  assert.equal(await url.isEnabled(), true, 'Reselecting the current tab preserves address entry')
  assert.equal(
    await page.getByRole('button', { name: 'Keyboard', exact: true }).isEnabled(),
    true,
    'Reselecting the current tab preserves keyboard controls',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Back', exact: true }).isEnabled(),
    true,
    'Reselecting the current tab preserves navigation history',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/previews/browser/open').length,
    ),
    opensBeforeReselect,
    'Reselecting the current tab does not reopen its session',
  )
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('combobox', { name: 'Profile for this tab' }).selectOption('remote-work')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.owner === 'mac' &&
        call.path === '/api/previews/browser/open' &&
        call.body.profileId === 'remote-work',
    ),
  )
  const beforeSwitch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')),
  )
  await page.evaluate(() => {
    window.fixtureStore.activeRuntimeId = 'mac'
    window.fixtureStore.connection = window.fixtureStore.runtimes[1].profile.connection
    window.renderBrowser()
  })
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  assert.equal(
    await page.getByRole('combobox', { name: 'Profile for this tab' }).inputValue(),
    'remote-work',
  )
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.map(
        ({ id, runtimeId, profileId }) => ({ id, runtimeId, profileId }),
      ),
    ),
    beforeSwitch.tabs.map(({ id, runtimeId, profileId }) => ({ id, runtimeId, profileId })),
    'Active runtime switch must preserve tab ownership and profiles',
  )
  // Switch back, then reopen this profile while a different runtime is active.
  await page.evaluate(() => {
    window.fixtureStore.activeRuntimeId = 'runtime'
    window.fixtureStore.connection = window.fixtureStore.runtimes[0].profile.connection
    window.renderBrowser()
  })
  const switchCallIndex = await page.evaluate(() => window.calls.length)
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('combobox', { name: 'Profile for this tab' }).selectOption('remote-personal')
  await page.waitForFunction(
    (index) =>
      window.calls
        .slice(index)
        .some(
          (call) =>
            call.owner === 'mac' &&
            call.path === '/api/previews/browser/open' &&
            call.body.profileId === 'remote-personal',
        ),
    switchCallIndex,
  )
  await page.getByRole('combobox', { name: 'Profile for this tab' }).selectOption('remote-work')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.waitForFunction(
    (index) =>
      window.calls
        .slice(index)
        .some(
          (call) =>
            call.owner === 'mac' &&
            call.path === '/api/previews/browser/open' &&
            call.body.profileId === 'remote-work',
        ),
    switchCallIndex,
  )
  assert.equal(
    await page.evaluate(
      (index) =>
        window.calls
          .slice(index)
          .filter((call) => call.path === '/api/previews/browser/open')
          .every((call) => call.owner === 'mac'),
      switchCallIndex,
    ),
    true,
    'Profile reopen must use the tab owner',
  )
  const rows = recent.locator('button[aria-current]')
  if (
    !(await rows
      .first()
      .innerText()
      .then((text) => text.includes('Remote')))
  )
    throw new Error('Most recent tab not first')
  mkdirSync(root + 'work/shared-browser', { recursive: true })
  await page.screenshot({ path: root + 'work/shared-browser/desktop.png' })
  await page.setViewportSize({ width: 380, height: 800 })
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error(
      'Shared browser overflows phone width: ' +
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
              .map((el) => ({
                tag: el.tagName,
                cls: el.className,
                right: el.getBoundingClientRect().right,
              }))
              .slice(0, 12),
          ),
        ),
    )
  await page.screenshot({ path: root + 'work/shared-browser/narrow.png' })
  await page.setViewportSize({ width: 1200, height: 800 })
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')),
  )
  if (
    saved.tabs.length !== 2 ||
    !saved.tabs.some((tab) => tab.runtimeId === 'mac' && tab.profileId === 'remote-work')
  )
    throw new Error('Tab owner/profile not saved')
  const rowOrder = await recent
    .locator('button[aria-current], button[title]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')))
  const local = recent.getByRole('button', { name: /localhost:3000/ }).first()
  await local.click()
  assert.equal(
    (await recent.locator('button[aria-current]').innerText()).includes('localhost:3000'),
    true,
  )
  assert.equal(
    (await recent.locator('button[aria-current]').first().innerText()).includes('localhost:3000'),
    true,
  )
  assert.deepEqual(
    await recent
      .locator('button[aria-current], button[title]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title'))),
    rowOrder,
    'Selecting a tab keeps navigation order stable',
  )
  await page.reload()
  await loadStyles()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  // Restoring inactive remote tabs must not launch them.
  if (
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/previews/browser/open').length,
    )
  )
    throw new Error('Inactive restored remote tabs launched eagerly')
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  if (
    await page.evaluate(() =>
      window.calls.some((call) => call.path === '/api/previews/browser/open'),
    )
  )
    throw new Error('Inactive remote tab launched after restored local session became ready')
  if ((await recent.locator('button[aria-current]').count()) !== 1)
    throw new Error('Restored active tab missing')
  // Daily browsing: saved remote pages must retain their source, even on another active runtime.
  const persisted = () =>
    page.evaluate(() => ({
      ...JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')),
      ...JSON.parse(localStorage.getItem('dovo.shared-browser-library.v1')),
    }))
  const selected = async () => {
    const state = await persisted()
    return state.tabs.find((tab) => tab.id === state.active)
  }
  await recent.getByRole('button', { name: /Remote.*Remote Work/ }).click()
  const source = await selected()
  await page.keyboard.press('Control+d')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-library.v1')).bookmarks.length === 1,
  )
  await page.keyboard.press('Control+w')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 1,
  )
  await recent.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Bookmarks', exact: true })
  await library.getByRole('textbox', { name: 'Search bookmarks' }).fill('no-such-page-unique')
  assert.equal(await library.getByText('No matching pages.', { exact: true }).count(), 1)
  assert.equal(await library.getByRole('region', { name: 'History', exact: true }).count(), 0)
  await library.getByRole('textbox', { name: 'Search bookmarks' }).fill('Mac Studio')
  const bookmarks = library.getByRole('region', { name: 'Bookmarks', exact: true })
  assert.equal(
    await bookmarks.getByRole('button').count(),
    2,
    'Bookmark and removal controls remain searchable by source',
  )
  await bookmarks.getByRole('button').first().click()
  await library.waitFor({ state: 'hidden' })
  await url.click()
  let restoredSource = await selected()
  for (const key of ['url', 'kind', 'runtimeId', 'profileId'])
    assert.equal(restoredSource[key], source[key], 'Bookmark source ' + key)
  await page.keyboard.press('Control+w')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 1,
  )
  await page.keyboard.press('Control+Shift+t')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 2,
  )
  restoredSource = await selected()
  for (const key of ['url', 'kind', 'runtimeId', 'profileId'])
    assert.equal(restoredSource[key], source[key], 'Reopened source ' + key)
  await url.click()
  await page.keyboard.press('Control+t')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 3,
  )
  const newSourceTab = await selected()
  assert.equal(newSourceTab.runtimeId, 'mac')
  assert.equal(newSourceTab.profileId, 'remote-work')
  await page.keyboard.press('Control+w')
  await recent
    .getByRole('button', { name: /Local.*Local Default/ })
    .first()
    .click()
  await page.keyboard.press('Control+l')
  assert.equal(await url.evaluate((element) => document.activeElement === element), true)
  await page.keyboard.type('react hooks')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.action === 'show' && call.url === 'https://www.google.com/search?q=react%20hooks',
    ),
  )
  await page.keyboard.press('Control+r')
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'reload'))
  // Keep a screenshot in the DOM while native views are hidden beneath the menu.
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.locator('img[aria-hidden][src^="data:image/png"]').waitFor()
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.locator('img[aria-hidden][src^="data:image/png"]').waitFor({ state: 'detached' })
  // Simulate the native status queue consumed by production BrowserPane.
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('combobox', { name: 'Profile for this tab' }).selectOption('local-work')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'show' && call.profileId === 'local-work'),
  )
  const sourceBeforeOpen = await selected()
  await page.evaluate(async () => {
    window.openedLinks.push('http://localhost:3000/new-window')
    await window.pollBrowser()
  })
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some(
      (tab) => tab.url === 'http://localhost:3000/new-window',
    ),
  )
  assert.equal((await selected()).id, sourceBeforeOpen.id, 'Page-created tab must not steal focus')
  const openedPageTab = (await persisted()).tabs.find(
    (tab) => tab.url === 'http://localhost:3000/new-window',
  )
  assert.equal(openedPageTab.profileId, 'local-work', 'Native opened link retains source profile')
  assert.equal(openedPageTab.kind, 'web')
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  // Extension-created pages retain native identity/profile instead of opening a second view.
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'native-extension-tab',
      url: 'http://localhost:3000/extension-opened',
      profileId: 'default',
    })
    await window.pollBrowser()
  })
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some((tab) =>
      tab.url.endsWith('/extension-opened'),
    ),
  )
  assert.equal(
    (await persisted()).tabs.find((tab) => tab.url.endsWith('/extension-opened')).profileId,
    'default',
  )
  await recent.getByRole('button', { name: /^localhost:3000\/extension-opened Local/ }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.action === 'show' &&
        call.key === 'native-extension-tab' &&
        call.profileId === 'default',
    ),
  )
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'native-extension-options',
      url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/options.html',
      profileId: 'local-work',
    })
    await window.pollBrowser()
  })
  const optionsTab = recent.getByRole('button', { name: /chrome-extension:.*options.html Local/ })
  await optionsTab.waitFor()
  assert.equal(
    (await persisted()).tabs.some((tab) => tab.url.startsWith('chrome-extension:')),
    false,
    'Extension pages are session-only',
  )
  await optionsTab.click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.action === 'show' &&
        call.key === 'native-extension-options' &&
        call.profileId === 'local-work',
    ),
  )
  await page.evaluate(async () => {
    window.closedTabs.push('native-extension-options')
    await window.pollBrowser()
  })
  await optionsTab.waitFor({ state: 'hidden' })
  await recent.getByRole('button', { name: /^localhost:3000\/extension-opened Local/ }).click()
  await page.evaluate(async () => {
    window.closedTabs.push('native-extension-tab')
    await window.pollBrowser()
  })
  await page.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some((tab) =>
        tab.url.endsWith('/extension-opened'),
      ),
  )
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  await pageAction('Add page to thread…')
  await page.getByRole('button', { name: 'Destination thread', exact: false }).click()
  await page.waitForFunction(() => window.savedDraft?.includes('http://localhost:3000/new-window'))
  assert.equal(await page.evaluate(() => window.savedDraft.startsWith('Existing draft')), true)
  const beforeLibraryReload = await persisted()
  await page.reload()
  await loadStyles()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  const afterLibraryReload = await persisted()
  assert.deepEqual(afterLibraryReload.bookmarks, beforeLibraryReload.bookmarks, 'Bookmarks persist')
  assert.deepEqual(afterLibraryReload.closed, beforeLibraryReload.closed, 'Closed tabs persist')
  assert.equal(
    afterLibraryReload.visits.some((tab) => tab.url.includes('google.com/search')),
    true,
    'Search history persists',
  )
  await recent.getByRole('button', { name: 'History', exact: true }).click()
  const historyDialog = page.getByRole('dialog', { name: 'History', exact: true })
  assert.equal(await historyDialog.getByRole('region', { name: 'Bookmarks' }).count(), 0)
  await historyDialog.getByRole('button', { name: 'Clear history', exact: true }).click()
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-library.v1')).visits.length === 0,
  )
  await page.keyboard.press('Escape')
  await recent.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  await library.getByRole('button', { name: /Remove bookmark/ }).click()
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-library.v1')).bookmarks.length === 0,
  )
  await page.setViewportSize({ width: 380, height: 800 })
  await page.screenshot({ path: root + 'work/shared-browser/narrow-library.png' })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Narrow library document overflow',
  )
  await page.setViewportSize({ width: 1200, height: 800 })
  const closedSource = (await persisted()).closed[0]
  await page.keyboard.press('Escape')
  await recent.getByRole('button', { name: 'History', exact: true }).click()
  await historyDialog.getByRole('button', { name: 'Reopen last closed tab', exact: true }).click()
  const libraryReopened = await selected()
  for (const key of ['url', 'kind', 'runtimeId', 'profileId'])
    assert.equal(libraryReopened[key], closedSource[key], 'Library reopen source ' + key)
  await pageAction('Pin tab')
  const pinnedSource = await selected()
  assert.equal(pinnedSource.pinned, true)
  const pinnedCount = (await persisted()).tabs.length
  await page.keyboard.press('Control+w')
  assert.equal((await persisted()).tabs.length, pinnedCount, 'Pinned tabs resist accidental close')
  await pageAction('Unpin tab')
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  const beforePrivate = (await persisted()).tabs.length
  await recent.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New private tab', exact: true }).click()
  await page.getByLabel('Preview URL', { exact: true }).fill('http://localhost:3000/private-secret')
  await page.getByRole('button', { name: 'Go to address', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.action === 'show' && call.url === 'http://localhost:3000/private-secret',
    ),
  )
  const privateShow = await page.evaluate(() =>
    window.calls.findLast(
      (call) => call.action === 'show' && call.url === 'http://localhost:3000/private-secret',
    ),
  )
  assert.match(privateShow.profileId, /^private-/)
  assert.equal((await persisted()).tabs.length, beforePrivate, 'Private tabs are not saved')
  assert.equal(
    await page.getByRole('button', { name: 'Bookmark page', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await page.getByRole('button', { name: 'Extensions', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() => Object.values(localStorage).join('').includes('private-secret')),
    false,
    'Private URL never reaches saved tabs or history',
  )
  await page.keyboard.press('Control+w')
  await page.waitForFunction(
    (key) => window.calls.some((call) => call.action === 'close' && call.key === key),
    privateShow.key,
  )
  // Drain multiple page-created link batches against current state, without stealing focus.
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.action === 'show' && call.url === 'http://localhost:3000/new-window',
    ),
  )
  const floodSource = await selected()
  const tabsBeforeFlood = (await persisted()).tabs
  const showCountBeforeFlood = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'show').length,
  )
  await page.evaluate(async () => {
    window.openedLinks.push(
      ...Array.from({ length: 80 }, (_, index) => `http://localhost:3000/flood-a-${index}`),
    )
    await window.pollBrowser()
    window.openedLinks.push(
      ...Array.from({ length: 80 }, (_, index) => `http://localhost:3000/flood-b-${index}`),
    )
    await window.pollBrowser()
  })
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 100,
  )
  const flooded = await persisted()
  assert.equal(flooded.active, floodSource.id, 'Flood must retain active source tab')
  assert.equal(new Set(flooded.tabs.map((tab) => tab.id)).size, 100, 'Flood tabs have unique IDs')
  const addedTabs = flooded.tabs.filter(
    (tab) => !tabsBeforeFlood.some((previous) => previous.id === tab.id),
  )
  assert.equal(addedTabs.length, 100 - tabsBeforeFlood.length)
  assert.equal(
    addedTabs.every((tab) => tab.kind === 'web' && tab.profileId === floodSource.profileId),
    true,
    'Flood preserves source profile',
  )
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'show').length),
    showCountBeforeFlood,
    'Background flood tabs are not launched',
  )
  await page.evaluate(async () => {
    window.openedLinks.push('http://localhost:3000/over-cap')
    await window.pollBrowser()
  })
  assert.equal((await persisted()).tabs.length, 100, 'Further batches cannot exceed cap')
  assert.equal((await selected()).id, floodSource.id)
  // Exercise the real BrowserView gate in a fresh browser context, with reactive preferences.
  const gatePage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  gatePage.on('pageerror', (error) => errors.push(error.message))
  await gatePage.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app" style="height:800px"></div></body></html>',
    }),
  )
  await gatePage.goto('http://localhost/gate')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await gatePage.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await gatePage.evaluate(() => {
    window.fixtureGate = true
  })
  await gatePage.addScriptTag({ content: built.outputFiles[0].text })
  const gateHeading = gatePage.getByRole('heading', {
    name: 'Experimental Browser is off',
    exact: true,
  })
  await gateHeading.waitFor({ state: 'visible' })
  assert.equal(
    await gatePage.getByRole('complementary', { name: 'Recent browser tabs' }).count(),
    0,
    'Default-off BrowserView mounts no pane',
  )
  assert.equal(
    await gatePage.evaluate(() => window.calls.length),
    0,
    'Default-off BrowserView makes no host calls',
  )
  await gatePage.getByRole('button', { name: 'Open settings', exact: true }).click()
  assert.deepEqual(
    await gatePage.evaluate(() => window.calls.find((call) => call.navigate).navigate),
    { viewId: 'general' },
  )
  await gatePage.evaluate(() => window.setExperimental(true))
  await gatePage
    .getByRole('complementary', { name: 'Recent browser tabs' })
    .waitFor({ state: 'visible' })
  assert.equal(await gateHeading.count(), 0, 'Enabling preference mounts BrowserPane')
  const gateUrl = gatePage.getByRole('textbox', { name: 'Preview URL' })
  await gateUrl.fill('http://localhost:3000/gated-page')
  await gateUrl.press('Enter')
  await gatePage.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  const gateNativeKey = await gatePage.evaluate(
    () => window.calls.find((call) => call.action === 'show').key,
  )
  const gateCallIndex = await gatePage.evaluate(() => window.calls.length)
  await gatePage.evaluate(() => window.setExperimental(false))
  await gateHeading.waitFor({ state: 'visible' })
  assert.equal(
    await gatePage.getByRole('complementary', { name: 'Recent browser tabs' }).count(),
    0,
    'Disabling preference unmounts BrowserPane',
  )
  await gatePage.waitForFunction(
    ({ index, key }) =>
      window.calls.slice(index).some((call) => call.action === 'hide' && call.key === key),
    { index: gateCallIndex, key: gateNativeKey },
  )
  await gatePage.close()
  // A pop-out thread without an explicit browser window ID receives its own session UUID.
  const threadPage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  threadPage.on('pageerror', (error) => errors.push(error.message))
  await threadPage.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="app" style="height:800px"></div></body></html>',
    }),
  )
  await threadPage.goto('http://localhost/thread')
  const mainSeed = JSON.stringify({
    active: 'main-tab',
    tabs: [
      {
        id: 'main-tab',
        kind: 'web',
        url: 'http://localhost:3000/main-only',
        title: 'Main only',
        profileId: 'default',
      },
    ],
    closed: [],
  })
  await threadPage.evaluate((seed) => {
    localStorage.setItem('dovo.shared-browser-tabs.v1', seed)
    window.fixtureThreadWindow = true
  }, mainSeed)
  await threadPage.addScriptTag({ content: built.outputFiles[0].text })
  const threadUrl = threadPage.getByRole('textbox', { name: 'Preview URL' })
  await threadUrl.waitFor({ state: 'visible' })
  assert.equal(await threadUrl.inputValue(), '', 'Pop-out does not restore main tabs')
  await threadUrl.fill('http://localhost:3000/thread-only')
  await threadUrl.press('Enter')
  await threadPage.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  const threadNativeKey = await threadPage.evaluate(
    () => window.calls.find((call) => call.action === 'show').key,
  )
  assert.match(
    threadNativeKey,
    /^studio:browser:[0-9a-f-]{36}:[0-9a-f-]{36}$/i,
    'Pop-out native key uses session UUID',
  )
  const sessionKeys = await threadPage.evaluate(() =>
    Object.keys(sessionStorage).filter((key) =>
      key.startsWith('dovo.shared-browser-tabs.v1.window.'),
    ),
  )
  assert.equal(sessionKeys.length, 1, 'Pop-out tabs saved in separate session storage')
  const sessionId = sessionKeys[0].split('.window.')[1]
  assert.equal(
    threadNativeKey.split(':')[2],
    sessionId,
    'Native session and storage share window identity',
  )
  assert.equal(
    await threadPage.evaluate(() => localStorage.getItem('dovo.shared-browser-tabs.v1')),
    mainSeed,
    'Pop-out leaves main tabs untouched',
  )
  assert.equal(
    await threadPage.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)).tabs[0].url,
      sessionKeys[0],
    ),
    'http://localhost:3000/thread-only',
  )
  await threadPage.close()
  // Saved entries must resolve and search profile names on their own computer,
  // even when those profiles share IDs with the active tab's computer.
  const libraryPage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  libraryPage.on('pageerror', (error) => errors.push(error.message))
  await libraryPage.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body><div id="app" style="height:800px"></div></body></html>',
    }),
  )
  await libraryPage.goto('http://localhost/library')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await libraryPage.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await libraryPage.evaluate(() => {
    const local = {
      id: 'active-local',
      url: '',
      title: '',
      kind: 'web',
      profileId: 'default',
    }
    const lan = {
      id: 'lan-saved',
      url: 'http://localhost:3000/lan',
      title: 'LAN saved page',
      kind: 'remote',
      runtimeId: 'runtime',
      profileId: 'remote-work',
    }
    const mac = {
      id: 'mac-saved',
      url: 'http://localhost:3000/mac',
      title: 'Mac saved page',
      kind: 'remote',
      runtimeId: 'mac',
      profileId: 'remote-work',
    }
    const unpaired = {
      id: 'unpaired-saved',
      url: 'http://localhost:3000/unpaired',
      title: 'Unpaired saved page',
      kind: 'remote',
      runtimeId: 'removed',
      profileId: 'remote-work',
    }
    localStorage.setItem(
      'dovo.shared-browser-tabs.v1',
      JSON.stringify({
        tabs: [local],
        active: local.id,
        closed: [lan, mac, unpaired],
      }),
    )
    localStorage.setItem(
      'dovo.shared-browser-library.v1',
      JSON.stringify({
        bookmarks: [lan, mac, unpaired],
        visits: [lan, mac, unpaired],
      }),
    )
  })
  await libraryPage.addScriptTag({ content: built.outputFiles[0].text })
  for (const view of ['Bookmarks', 'History']) {
    await libraryPage.getByRole('button', { name: view, exact: true }).click()
    const sourceLibrary = libraryPage.getByRole('dialog', { name: view, exact: true })
    const sourceSearch = sourceLibrary.getByRole('textbox', {
      name: `Search ${view.toLowerCase()}`,
    })
    const sectionNames = view === 'Bookmarks' ? ['Bookmarks'] : ['History', 'Recently closed']
    for (const sectionName of sectionNames) {
      const section = sourceLibrary.getByRole('region', { name: sectionName, exact: true })
      assert.match(
        await section.getByRole('button', { name: /^LAN saved page/ }).innerText(),
        /LAN Work/,
      )
      assert.match(
        await section.getByRole('button', { name: /^Mac saved page/ }).innerText(),
        /Remote Work/,
      )
      assert.match(
        await section.getByRole('button', { name: /^Unpaired saved page/ }).innerText(),
        /Unavailable profile/,
      )
      assert.equal(
        await section
          .getByText(`No ${sectionName.toLowerCase()} yet.`, { exact: true })
          .isVisible(),
        false,
      )
    }
    for (const profileName of ['LAN Work', 'Remote Work']) {
      await sourceSearch.fill(profileName)
      for (const sectionName of sectionNames) {
        const section = sourceLibrary.getByRole('region', { name: sectionName, exact: true })
        const entry = section
          .locator('button[type="button"]')
          .filter({ hasText: 'saved page' })
          .first()
        assert.match(await entry.innerText(), new RegExp(profileName))
        assert.equal(
          await section.getByRole('button', { name: /^(LAN|Mac|Unpaired) saved page/ }).count(),
          1,
        )
        assert.equal(
          await section.getByText('No matching pages.', { exact: true }).isVisible(),
          false,
        )
      }
    }
    await sourceSearch.fill('no-profile-with-this-name')
    const emptySections = sourceLibrary.getByText('No matching pages.', { exact: true })
    assert.equal(await emptySections.count(), sectionNames.length)
    for (const message of await emptySections.all()) assert.equal(await message.isVisible(), true)
    await libraryPage.keyboard.press('Escape')
  }
  await libraryPage.close()
  await page.evaluate(() => (window.fixtureSelection = 'Remote selection'))
  await pageAction('Add selection to thread…')
  await page.evaluate(() => (window.conflict = true))
  await page.getByRole('button', { name: 'Mac thread', exact: false }).click()
  if (!(await page.getByRole('alert').filter({ hasText: 'Draft changed elsewhere' }).isVisible()))
    throw new Error('Draft conflict was hidden')
  await page.evaluate(() => (window.conflict = false))
  await page.getByRole('button', { name: 'Mac thread', exact: false }).click()
  await page.waitForFunction(() => window.remoteDraft().includes('> Remote selection'))
  if (!(await page.evaluate(() => window.remoteDraft().startsWith('Remote draft\n\n'))))
    throw new Error('Remote draft replaced')
  await page
    .getByRole('dialog', { name: 'Add selection to a thread', exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.openThread?.threadId === 'remote-target').length,
    ),
    1,
    'Applied remote save opens the thread once',
  )
  assert.equal(extracted.passwordText, '', 'Password selection must be excluded')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Shared vertical tabs, active-tab reselection, local localhost, source-preserving drafts across computers, conflicts, per-tab remote ownership/profiles, recent order, restore, lazy sessions, saved-page profile labels/search with real runtime catalogs, bookmarks/history, reopen, shortcuts, page drafts, opened-link source profiles, real BrowserView preference gate, bounded background opened links and pop-out isolation passed.',
  )
} finally {
  await browser.close()
}
