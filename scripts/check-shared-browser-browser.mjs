import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const viewer = `<html><body><script>
let tab='',url='',back=true,favicon;
function state(){window.parent.postMessage({channel:'dovo-browser',type:'state',url,title:'Page '+tab,favicon,back,forward:false,loading:false,editable:false},'*')}
window.addEventListener('message',event=>{const m=event.data;
if(m.type==='connect'){const ticket=JSON.parse(new URL(m.url).searchParams.get('ticket'));tab=ticket.tabId;url=ticket.url;window.parent.postMessage({channel:'dovo-browser',type:'connection',online:true},'*');state()}
if(m.type==='fixture-favicon'){favicon=m.favicon;state()}
if(m.type==='snapshot')window.parent.postMessage({channel:'dovo-browser',type:'snapshot',id:m.id,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='},'*');
if(m.type==='input'){window.parent.postMessage({channel:'fixture',input:m.input},'*');if(m.input.type==='navigate')url=m.input.url;state()}
if(m.type==='viewport')window.parent.postMessage({channel:'fixture',viewport:m},'*');
});</script></body></html>`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {BrowserPane} from './src/browser/browser-pane.tsx';import BrowserView from './src/browser/browser-view.tsx';import {selectedBrowserText} from '@dovo/protocol';window.selectedBrowserText=selectedBrowserText;import {TooltipProvider} from '@dovo/studio-ui';window.renderBrowser=()=>root.render(<TooltipProvider>{window.fixtureGate ? <BrowserView navigationKey="fixture-gate"/> : <BrowserPane taskId="studio:browser" shared openLink={window.fixtureOpenLink}/>}</TooltipProvider>);const root=createRoot(document.getElementById('app'));window.renderBrowser();`,
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
        builder.onResolve({ filter: /^\.\.\/detail\/task-conversation$/ }, () => ({
          path: 'conversation',
          namespace: 'fixture-conversation',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture-conversation' }, () => ({
          loader: 'tsx',
          resolveDir: root + 'packages/extension-tasks',
          contents: `import {useEffect} from 'react';import {useWorkspace} from '@dovo/studio-core';import {useComposerDraft} from './src/chat/composer/use-composer-draft';export function TaskConversation({task,composerInsert,onComposerInsertApplied}){const store=useWorkspace();const draft=useComposerDraft(task);useEffect(()=>{if(composerInsert){window.agentDraft=composerInsert.text;onComposerInsertApplied()}},[composerInsert]);return <div data-testid="tab-conversation" data-runtime={store.activeRuntimeId}>{task.title}<textarea aria-label="Thread draft" defaultValue={task.draft} onChange={event=>draft.update(event.target.value)}/>{draft.error&&<p role="alert">{draft.error}</p>}</div>}`,
        }))

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
            ? `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,setValue]=useState(initial);const current=useRef(value);current.current=value;const set=next=>{current.current=typeof next==='function'?next(current.current):next;setValue(current.current)};return [value,set,current]}`
            : path === './screenshot-attachment'
              ? 'export const useScreenshotAttachment=()=>({editor:null,error:"",busy:false,attach:async()=>{}});'
              : path === './device-list'
                ? 'export const DeviceList=()=>null;'
                : path === './physical-controls'
                  ? 'export const PhysicalControls=()=>null;'
                  : `
import {createContext,createElement,useContext,useState,useSyncExternalStore} from 'react';
import {resolveSettingsTarget,decode,browserCommandSchema} from '@dovo/protocol';
import {Effect} from 'effect';
export * from '@dovo/protocol';
export {updateTask,createTask} from '${root}packages/studio-core/src/workspace/actions.ts';
export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes.ts';
export {DiscoveryCache} from '${root}packages/client-runtime/src/index.ts';
export {browserModelCatalogCache} from '${root}packages/studio-core/src/workspace/model-catalog-cache.ts';
export {useSettingsDraft,useConfirmSettingsNavigation,useOptionalSettingsTarget} from '${root}packages/studio-core/src/settings-target.tsx';
export const useCachedTask=task=>({task,loaded:true,error:""});export const formatDateTime=()=>"";export const providers=[];export const useResolvedTheme=()=> 'dark';export const reducedMotion=()=>false;
export const remoteBrowserHtml=${JSON.stringify(viewer)};
const profileCatalogs={runtime:[{id:'default',name:'LAN Default'},{id:'remote-work',name:'LAN Work'},{id:'remote-personal',name:'LAN Personal'}],mac:[{id:'default',name:'Remote Default'},{id:'remote-work',name:'Remote Work'},{id:'remote-personal',name:'Remote Personal'}]};
window.browserInputs=[];window.browserViewports=[];window.addEventListener('message',event=>{if(event.data?.channel==='fixture'){if(event.data.input)window.browserInputs.push(event.data.input);if(event.data.viewport)window.browserViewports.push(event.data.viewport)}});
const remoteTicket=body=>({ok:true,ticket:JSON.stringify({tabId:body.tabId,url:body.url||'about:blank'}),tabId:body.tabId,profileId:body.profileId});
window.calls=[]; const request=async(path,body)=>{window.calls.push({path,body});if(path.endsWith('/profiles/read'))return {profiles:profileCatalogs.runtime};return remoteTicket(body)};
const nativePages=new Map();window.setNativePage=(key,state)=>nativePages.set(key,state);window.openedLinks=[];window.createdTabs=[];window.closedTabs=[];window.movedTabs=[];window.faviconUpdates=[];const sitePermissions=new Map();const browser=async(command)=>{if(command.action==='remote-media-sources')decode(browserCommandSchema,command);window.calls.push(command);if(command.action==='browser-windows')return {windows:[{id:2,title:'Other browser window'}]};if(command.action==='move-tab'){decode(browserCommandSchema,command);window.transferredTab=command;return;}if(command.action.includes('site-permission')||command.action==='clear-site-data'){decode(browserCommandSchema,command);const page=nativePages.get(command.key);const origin=new URL(page.url).origin;const key=page.profileId+':'+origin;const permissions=sitePermissions.get(key)||{notifications:'ask',microphone:'ask',camera:'ask'};if(command.action==='set-site-permission')permissions[command.permission]=command.setting;if(command.action==='request-site-permission')permissions[command.permission]='allow';sitePermissions.set(key,permissions);return {sitePermissions:{origin,permissions:{...permissions}}};}if(command.action==='keep-awake'){decode(browserCommandSchema,command);return;}if(command.action==='show')nativePages.set(command.key,{profileId:command.profileId,url:command.url,title:'',back:false,forward:false});if(command.action==='tab-activity')return {url:'',back:false,forward:false,protectedKeys:window.protectedKeys||[]};if(command.action==='status'){const focusedTabKey=window.focusedTabKey;if(command.tabCount!==undefined)window.focusedTabKey=undefined;return {...nativePages.get(command.key),focusedTabKey,openedLinks:window.openedLinks.splice(0),createdTabs:window.createdTabs.splice(0),closedTabs:window.closedTabs.splice(0),movedTabs:window.movedTabs.splice(0),faviconUpdates:window.faviconUpdates.splice(0)}};if(command.action==='hide'){window.lastHideHadFrame=!!document.querySelector('img[aria-hidden][src^="data:image/png"]');}if(command.action==='screenshot'){if(window.holdCapture)await new Promise(resolve=>window.finishCapture=resolve);return {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};}if(command.action==='selection')return {url:'http://localhost:3000/',title:'Source page',selection:window.fixtureSelection,back:false,forward:false};};
const browserExtensions=async command=>({extensions:[],capabilities:{unpackedFolders:true,nativeMessaging:true,chromeWebStore:true,remoteRuntimes:false}});
window.fixtureSelection='Keep  spaces\\nSecond line';
const profile={id:'runtime',name:'LAN runtime',connection:{address:'http://runtime.local',token:'paired-device-token-at-least-20-characters'}};
const task={id:'target',title:'Destination thread',repositoryId:'repo',agentId:'',status:'draft',draft:'Existing draft',createdAt:'2026-10-25T00:00:00Z',messages:[],files:[],example:false};
const snapshot={runtimeHost:'LAN runtime',workspace:{tasks:[task],repositories:[{id:'repo',name:'Project'}],agents:[]}};
const otherProfile={id:'mac',name:'Mac Studio',connection:{address:'http://mac.local',token:'paired-mac-token-at-least-20-characters'}};
const otherSnapshot={...snapshot,workspace:{...snapshot.workspace,tasks:[{...task,id:'remote-target',title:'Mac thread',draft:'Remote draft'}]}};
const sources=[{profile,name:profile.name,scope:'runtime',connected:true,snapshot},{profile:otherProfile,name:otherProfile.name,scope:'mac',connected:true,snapshot:otherSnapshot}];
export const useRuntimeSources=()=>sources;
const workspace={localRuntimeId:profile.id,activeRuntimeId:profile.id,connection:profile.connection,request,connected:true,snapshot,workspace:snapshot.workspace,runtimes:sources,runtimeRegistry:{profiles:[profile,otherProfile]},
switchRuntime:async id=>{const owner=sources.find(entry=>entry.profile.id===id);workspace.activeRuntimeId=id;workspace.connection=owner.profile.connection;workspace.snapshot=owner.snapshot;workspace.workspace=owner.snapshot.workspace;window.renderBrowser()},
readRuntime:async(owner,path,body)=>{window.calls.push({owner:owner.id,path,body});if(path.endsWith('/profiles/read'))return {profiles:profileCatalogs[owner.id]??[]};if(path.endsWith('/profiles/save')){profileCatalogs[owner.id]=body.profiles;return {profiles:body.profiles}};if(path.endsWith('/activity'))return {active:!!window.activeMedia?.includes(body.tabId)};if(path==='/api/workspace'){if(window.conflict)return {outcome:'reconciled',reason:'Draft changed elsewhere',recoveryId:'11223344-1122-4122-8122-112233445566'};otherSnapshot.workspace.tasks[0].draft=body.changes.draft.after;return {outcome:'applied'}};return remoteTicket(body)},
setWorkspace:update=>{workspace.workspace=typeof update==='function'?update(workspace.workspace):update;workspace.snapshot.workspace=workspace.workspace;window.savedDraft=workspace.workspace.tasks[0].draft;window.renderBrowser()},flush:async()=>{if(window.hangFlush)await new Promise(()=>{});},refreshRuntime:async()=>{},};
window.fixtureStore=workspace;window.remoteDraft=()=>otherSnapshot.workspace.tasks[0].draft;
const WorkspaceContext=createContext(null);
export const useWorkspace=()=>useContext(WorkspaceContext)||workspace;
export const WorkspaceScope=({profile,children})=>{
  const source=sources.find(entry=>entry.profile.id===profile.id&&entry.profile.connection.address===profile.connection.address&&entry.profile.connection.token===profile.connection.token);
  if(!source)return null;
  return createElement(WorkspaceContext.Provider,{value:{...workspace,activeRuntimeId:source.profile.id,connection:source.profile.connection,snapshot:source.snapshot,workspace:source.snapshot.workspace,connected:source.connected,request:(path,body)=>workspace.readRuntime(source.profile,path,body),setWorkspace:()=>{throw Error('Cannot edit a read-only runtime scope')}}},children);
};
export const useSettingsTarget=()=>{
  const [target,setTarget]=useState({environmentId:'',projectId:''});
  return {target,setTarget,sources,...resolveSettingsTarget(sources,target,workspace.activeRuntimeId)};
};
export const useStudioHost=()=>({browser,browserExtensions,onBrowserContextAction:listener=>{window.contextAction=listener;return ()=>{window.contextAction=null}},browserWindowId:window.fixtureThreadWindow||window.testMainDraft||window.fixtureGate?undefined:'main',threadWindow:!!window.fixtureThreadWindow,navigate:(target,options)=>window.calls.push({navigate:target,options}),openBrowserWindow:async()=>{window.calls.push({openBrowserWindow:true})},openThread:target=>window.calls.push({openThread:target})});
const preferenceListeners=new Set();let appPreferences={browserWorkspaceEnabled:false,browserProfiles:[{id:'default',name:'Local Default'},{id:'local-work',name:'Local Work'}],browserProfileByThread:{},browserAgentAccess:{},browserAutoSettleMinutes:0,browserCloseSettledMinutes:0};window.setCleanup=change=>{appPreferences={...appPreferences,...change};for(const listener of preferenceListeners)listener()};
window.setExperimental=enabled=>{appPreferences={...appPreferences,browserWorkspaceEnabled:enabled};for(const listener of preferenceListeners)listener()};
export const useAppPreferences=()=>useSyncExternalStore(listener=>{preferenceListeners.add(listener);return ()=>preferenceListeners.delete(listener)},()=>appPreferences);
export {useRemoteBrowserProfiles} from '${root}packages/studio-core/src/browser-profiles.ts';
export const defaultAppPreferences={browserSidebarWidth:224,toolsSidebarWidth:440};export const readAppPreferences=()=>({browserViewport:'fill',browserSidebarWidth:224,toolsSidebarWidth:440});
window.preferences=[];export const updateAppPreferences=change=>{window.preferences.push(change);appPreferences={...appPreferences,...change};for(const listener of preferenceListeners)listener()};const polls=new Set();window.pollBrowser=async()=>{for(const poll of [...polls])await Effect.runPromise(poll)};export const startPolling=poll=>{polls.add(poll);return {stop:async()=>{polls.delete(poll)}}};
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
  const preview = page.getByRole('region', { name: 'Link preview', exact: true })
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
  assert.equal(
    await page.getByRole('button', { name: 'Picture-in-Picture', exact: true }).count(),
    0,
  )
  const localRow = recent.getByRole('button', { name: /localhost:3000/ }).first()
  await localRow.click({ button: 'right' })
  await page.getByRole('menuitemcheckbox', { name: 'Keep awake', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((c) => c.action === 'keep-awake' && c.enabled))
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
          (t) => t.id === JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).active,
        ).keepAwake,
    ),
    true,
  )
  await localRow.click({ button: 'right' })
  assert.equal(
    await page
      .getByRole('menuitemcheckbox', { name: 'Keep awake', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )
  await page.getByRole('menuitemcheckbox', { name: 'Keep awake', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.findLast((c) => c.action === 'keep-awake')?.enabled === false,
  )
  await page.mouse.move(1190, 790)
  await nativeAction('show')
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'notification-other-tab',
      url: 'http://localhost:3000/notify',
      profileId: 'local-work',
      active: false,
    })
    window.focusedTabKey = 'notification-other-tab'
    await window.pollBrowser()
  })
  await recent.getByRole('button', { name: /^localhost:3000\/notify Local/ }).waitFor()
  assert.equal(
    await recent
      .getByRole('button', { name: /^localhost:3000\/notify Local/ })
      .getAttribute('aria-current'),
    'page',
  )
  await page.evaluate(async () => {
    window.closedTabs.push('notification-other-tab')
    await window.pollBrowser()
  })
  // External/Studio link requests choose the matching local profile before creating a page.
  await page.evaluate(() => {
    window.setCleanup({
      browserProfiles: [
        { id: 'default', name: 'Local Default' },
        { id: 'local-work', name: 'Local Work', linkDomains: ['teams.microsoft.com'] },
      ],
    })
    window.fixtureOpenLink = { id: 'routed-studio-link', url: 'https://teams.microsoft.com/call' }
    window.renderBrowser()
  })
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.action === 'show' &&
        c.url === 'https://teams.microsoft.com/call' &&
        c.profileId === 'local-work',
    ),
  )
  await page.evaluate(async () => {
    window.closedTabs.push(
      window.calls.findLast(
        (c) => c.action === 'show' && c.url === 'https://teams.microsoft.com/call',
      ).key,
    )
    await window.pollBrowser()
    window.fixtureOpenLink = undefined
    window.renderBrowser()
  })
  await nativeAction('show')
  // A hung capture must never keep the native view over the real Extensions menu.
  await page.evaluate(() => {
    window.holdCapture = true
  })
  await page.getByRole('button', { name: 'Extensions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Manage extensions', exact: true }).waitFor()
  await page.waitForFunction(() => typeof window.finishCapture === 'function')
  await nativeAction('hide')
  await page.keyboard.press('Escape')
  await page.mouse.move(1190, 790)
  await url.focus()
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
  assert.equal(
    await page.evaluate(() => window.lastHideHadFrame),
    true,
    'Fallback must be painted before the native page hides',
  )
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
  assert.match(await remoteTab.getAttribute('aria-label'), /Remote · Mac Studio/)
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
  // A remote child retains its owner/profile and the same viewer when promoted.
  const parentFrame = page.locator('iframe[title="Host browser"]').filter({ visible: true })
  await parentFrame
    .contentFrame()
    .locator('body')
    .evaluate(() =>
      window.parent.postMessage(
        {
          channel: 'dovo-browser',
          type: 'state',
          url: 'http://localhost:3000/remote-page',
          title: 'Remote source',
          back: true,
          forward: false,
          loading: false,
          editable: false,
          createdTabs: [
            {
              id: '00000000-0000-4000-8000-000000000999',
              url: 'http://localhost:3000/remote-preview',
            },
          ],
        },
        '*',
      ),
    )
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
  await page.locator('[data-browser-preview-background] img').waitFor()
  const remotePreviewFrame = preview
    .locator('iframe[title="Host browser"]')
    .filter({ visible: true })
  await remotePreviewFrame.waitFor()
  await remotePreviewFrame.evaluate((frame) => (frame.dataset.previewIdentity = 'retained-viewer'))
  const remoteOpens = await page.evaluate(
    () => window.calls.filter((call) => call.path === '/api/previews/browser/open').length,
  )
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).click()
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some(
      (tab) =>
        tab.id === '00000000-0000-4000-8000-000000000999' &&
        tab.runtimeId === 'mac' &&
        tab.profileId === 'remote-work',
    ),
  )
  assert.equal(
    await page.locator('iframe[data-preview-identity="retained-viewer"]').count(),
    1,
    'Promotion retains remote iframe identity',
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/previews/browser/open').length,
    ),
    remoteOpens,
    'Promotion does not reconnect remote page',
  )
  await page.keyboard.press('Control+w')
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.owner === 'mac' &&
        call.path === '/api/previews/browser/close' &&
        call.body.tabId === '00000000-0000-4000-8000-000000000999' &&
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
      .getAttribute('aria-label')
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
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
  const background = page.locator('[data-browser-preview-background]')
  await background.locator('img').waitFor()
  assert(
    (await background.textContent()).includes(sourceBeforeOpen.url),
    'The opener remains visible beneath the link',
  )
  const viewport = page.locator('[data-browser-viewport]')
  const assertContained = async () => {
    const area = await viewport.boundingBox()
    const box = await preview.boundingBox()
    assert(box.x >= area.x + 7 && box.y >= area.y + 7, 'Preview stays inside the browser page area')
    assert(box.x + box.width <= area.x + area.width - 7, 'Preview never covers the tab sidebar')
    assert(
      box.y + box.height <= area.y + area.height - 7,
      'Preview stays above the browser bottom edge',
    )
  }
  const area = await viewport.boundingBox()
  const centered = await preview.boundingBox()
  assert(
    centered.width >= area.width * 0.8 && centered.height >= area.height * 0.8,
    'Link preview uses most of the browser page area',
  )
  assert(
    Math.abs(centered.x + centered.width / 2 - area.x - area.width / 2) <= 1,
    'Link preview is horizontally centered within the browser',
  )
  assert(
    Math.abs(centered.y + centered.height / 2 - area.y - area.height / 2) <= 1,
    'Link preview is vertically centered within the browser',
  )
  await assertContained()

  // Resizing the pane without resizing the window also updates the preview bounds.
  await page.locator('#app').evaluate((app) =>
    Object.assign(app.style, {
      width: '1000px',
      height: '600px',
      marginLeft: '70px',
      marginTop: '40px',
    }),
  )
  await page.waitForFunction(() => {
    const area = document.querySelector('[data-browser-viewport]').getBoundingClientRect()
    const box = document.querySelector('[aria-label="Link preview"]').getBoundingClientRect()
    return (
      Math.abs(box.x + box.width / 2 - area.x - area.width / 2) <= 1 &&
      Math.abs(box.y + box.height / 2 - area.y - area.height / 2) <= 1 &&
      box.height < area.height
    )
  })
  await assertContained()
  await preview.getByRole('button', { name: 'Expand preview', exact: true }).click()
  await assertContained()
  const beforeContract = await page.evaluate(
    () =>
      window.calls.filter((c) => c.action === 'show' && c.url.endsWith('/new-window')).at(-1)?.key,
  )
  await preview.getByRole('button', { name: 'Contract preview', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.action === 'show' && c.url.endsWith('/new-window')).at(-1)
          ?.key,
    ),
    beforeContract,
    'Contract preserves the live page identity',
  )
  await preview.getByRole('button', { name: 'Expand preview', exact: true }).waitFor()
  const move = preview.getByRole('button', { name: 'Move Link preview', exact: true })
  await move.focus()
  for (let step = 0; step < 25; step++) await move.press('Shift+ArrowLeft')
  for (let step = 0; step < 25; step++) await move.press('Shift+ArrowUp')
  await assertContained()
  const resize = preview.getByRole('button', { name: 'Resize Link preview', exact: true })
  await resize.focus()
  for (let step = 0; step < 25; step++) await resize.press('Shift+ArrowRight')
  for (let step = 0; step < 25; step++) await resize.press('Shift+ArrowDown')
  await assertContained()
  await page.locator('#app').evaluate((app) => {
    app.style.cssText = 'height:700px'
  })
  await page.setViewportSize({ width: 380, height: 700 })
  await page.waitForFunction(() => {
    const area = document.querySelector('[data-browser-viewport]').getBoundingClientRect()
    const box = document.querySelector('[aria-label="Link preview"]').getBoundingClientRect()
    return box.x >= area.x + 7 && box.right <= area.right - 7 && box.bottom <= area.bottom - 7
  })
  await assertContained()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.locator('#app').evaluate((app) => {
    app.style.cssText = 'height:800px'
  })
  assert.equal(
    (await persisted()).tabs.some((tab) => tab.url.endsWith('/new-window')),
    false,
    'Previews are not saved as tabs',
  )
  assert.equal(
    (await selected()).id,
    sourceBeforeOpen.id,
    'Saved selection stays on source until promotion',
  )
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'show' && call.url.endsWith('/new-window')),
  )
  const previewKey = await page.evaluate(
    () =>
      window.calls
        .filter((call) => call.action === 'show' && call.url.endsWith('/new-window'))
        .at(-1)?.key,
  )
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).click()
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some(
      (tab) => tab.url === 'http://localhost:3000/new-window',
    ),
  )
  assert.notEqual(
    (await selected()).id,
    sourceBeforeOpen.id,
    'Promoted preview becomes the active tab',
  )
  const openedPageTab = (await persisted()).tabs.find(
    (tab) => tab.url === 'http://localhost:3000/new-window',
  )
  assert.equal(openedPageTab.profileId, 'local-work', 'Native opened link retains source profile')
  assert.equal(openedPageTab.kind, 'web')
  assert.equal(
    await page.evaluate(
      (key) => window.calls.some((call) => call.action === 'close' && call.key === key),
      previewKey,
    ),
    false,
    'Promotion keeps the existing native page',
  )
  await background.waitFor({ state: 'detached' })
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  // Clicking the opener dismisses the expanded preview and keeps its original native page.
  const openerKey = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'show').at(-1).key,
  )
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'outside-dismiss-preview',
      url: 'http://localhost:3000/outside-dismiss',
      profileId: 'local-work',
      openerKey: window.calls.filter((c) => c.action === 'show').at(-1).key,
    })
    await window.pollBrowser()
  })
  await preview.getByRole('button', { name: 'Expand preview', exact: true }).click()
  const openerBox = await page
    .getByRole('button', { name: 'Return to opener', exact: true })
    .boundingBox()
  await page.mouse.click(openerBox.x + openerBox.width / 2, openerBox.y + 4)
  await preview.waitFor({ state: 'hidden' })
  await page.waitForFunction(() =>
    window.calls.some((c) => c.action === 'close' && c.key === 'outside-dismiss-preview'),
  )
  await page.waitForFunction(
    (key) => window.calls.filter((c) => c.action === 'show').at(-1).key === key,
    openerKey,
  )
  assert.equal(
    await page.evaluate(
      (key) => window.calls.some((c) => c.action === 'close' && c.key === key),
      openerKey,
    ),
    false,
    'Dismissing leaves the opener alive',
  )

  // Command-click disposition still previews the original Chromium child; nested close returns
  // to its opener and promotion retains the exact key and profile.
  await page.evaluate(async () => {
    const source = window.calls.filter((call) => call.action === 'show').at(-1)
    window.createdTabs.push({
      key: 'native-link-preview',
      url: 'http://localhost:3000/cmd-link',
      profileId: 'local-work',
      active: false,
      openerKey: source.key,
    })
    await window.pollBrowser()
  })
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'show' && call.key === 'native-link-preview'),
  )
  const originalBackground = await page.locator('[data-browser-preview-background]').textContent()
  await page.screenshot({ path: root + 'work/shared-browser/link-preview.png' })
  assert.equal(
    (await persisted()).tabs.some((tab) => tab.url.endsWith('/cmd-link')),
    false,
  )
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'native-nested-preview',
      url: 'http://localhost:3000/nested-link',
      profileId: 'local-work',
      active: true,
      openerKey: 'native-link-preview',
    })
    await window.pollBrowser()
  })
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'show' && call.key === 'native-nested-preview'),
  )
  assert.equal(
    await page.locator('[data-browser-preview-background]').textContent(),
    originalBackground,
    'Nested previews retain the original source',
  )
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'close' && call.key === 'native-nested-preview'),
  )
  await page.waitForFunction(
    () =>
      window.calls.filter((call) => call.action === 'show').at(-1)?.key === 'native-link-preview',
  )
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).click()
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some((tab) =>
      tab.url.endsWith('/cmd-link'),
    ),
  )
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.action === 'close' && call.key === 'native-link-preview'),
    ),
    false,
  )
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'native-deferred-preview',
      url: '',
      profileId: 'local-work',
      openerKey: 'native-link-preview',
    })
    await window.pollBrowser()
  })
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
  await page.evaluate(async () => {
    window.setNativePage('native-deferred-preview', {
      url: 'http://localhost:3000/deferred-preview',
      title: 'Deferred',
      back: false,
      forward: false,
    })
    await window.pollBrowser()
  })
  await page.waitForFunction(() =>
    window.calls.some(
      (call) =>
        call.action === 'show' &&
        call.key === 'native-deferred-preview' &&
        call.url.endsWith('/deferred-preview'),
    ),
  )
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
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
  assert.equal(pinnedSource.homeUrl, pinnedSource.url, 'Pinning captures the current address')
  const pinnedTile = recent
    .getByLabel('Pinned browser tabs')
    .getByRole('button', { name: /Local|Remote/ })
    .first()
  await pinnedTile.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit home URL', exact: true }).click()
  const homeDialog = page.getByRole('dialog', { name: 'Edit pinned tab home' })
  await homeDialog.getByLabel('Home URL', { exact: true }).fill('http://vpn.local/pinned-home')
  await homeDialog.getByRole('button', { name: 'Save home', exact: true }).click()
  await homeDialog.waitFor({ state: 'hidden' })
  assert.equal((await selected()).homeUrl, 'http://vpn.local/pinned-home')
  const homeIdentity = (await selected()).id
  await page.getByRole('button', { name: 'Return to tab home', exact: true }).click()
  await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1'))
    return state.tabs.find((tab) => tab.id === state.active)?.url === 'http://vpn.local/pinned-home'
  })
  assert.equal((await selected()).id, homeIdentity, 'Going home preserves the tab and profile')
  await page.screenshot({ path: root + 'work/shared-browser/pinned-home.png' })
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
  // Repeated link batches retain one active preview and close the unused native pages.
  await recent.getByRole('button', { name: /^localhost:3000\/new-window Local/ }).click()
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.action === 'show' && call.url === 'http://localhost:3000/new-window',
    ),
  )
  const floodSource = await selected()
  const tabsBeforeFlood = (await persisted()).tabs
  await page.evaluate(async () => {
    window.openedLinks.push(
      ...Array.from({ length: 80 }, (_, index) => `http://localhost:3000/flood-a-${index}`),
    )
    await window.pollBrowser()
  })
  await preview.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.action === 'close').length >= 79,
  )
  const flooded = await persisted()
  assert.equal(flooded.active, floodSource.id, 'Saved selection retains the source tab')
  assert.equal(
    flooded.tabs.length,
    tabsBeforeFlood.length,
    'Preview batches do not fill saved tabs',
  )
  await page.evaluate(async () => {
    window.openedLinks.push('http://localhost:3000/flood-b-last')
    await window.pollBrowser()
  })
  await page.waitForFunction(() =>
    window.calls.some((call) => call.action === 'show' && call.url.endsWith('/flood-b-last')),
  )
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await preview.getByRole('button', { name: 'Close preview', exact: true }).waitFor()
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal((await persisted()).tabs.length, tabsBeforeFlood.length)
  assert.equal((await selected()).id, floodSource.id)
  // Links can skip the overlay and stay as regular tabs without a second navigation.
  const directOpenerLabel = await recent
    .locator('button[aria-current="page"]')
    .getAttribute('aria-label')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('combobox', { name: 'Open links in', exact: true }).selectOption('tab')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.evaluate(async () => {
    window.createdTabs.push({
      key: 'direct-tab',
      url: 'http://localhost:3000/direct-tab',
      profileId: 'default',
      active: true,
      openerKey: 'studio:browser:main:local',
    })
    await window.pollBrowser()
  })
  await recent.getByRole('button', { name: /^localhost:3000\/direct-tab Local/ }).waitFor()
  assert.equal(await preview.count(), 0, 'New-tab mode skips the floating preview')
  assert.equal((await selected()).previewOf, undefined)
  await page.keyboard.press('Control+w')
  await recent.getByRole('button', { name: directOpenerLabel, exact: true }).click()
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('combobox', { name: 'Open links in', exact: true }).selectOption('preview')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
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
  // Exercise manual categories and the real sweep with a controlled clock.
  const lifecycle = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  lifecycle.on('pageerror', (error) => errors.push(error.message))
  await lifecycle.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:800px"></div>' }),
  )
  await lifecycle.goto('http://localhost/lifecycle')
  await lifecycle.clock.install({ time: new Date('2026-10-26T12:00:00Z') })
  await lifecycle.evaluate(() => {
    const base = {
      kind: 'web',
      profileId: 'default',
      url: 'http://localhost/current',
      title: 'Current',
      visitedAt: Date.now() - 600000,
      lastActiveAt: Date.now() - 600000,
    }
    localStorage.setItem(
      'dovo.shared-browser-tabs.v1',
      JSON.stringify({
        active: 'current',
        closed: [],
        tabs: [
          { ...base, id: 'current' },
          { ...base, id: 'unused', title: 'Unused', url: 'http://localhost/unused' },
          { ...base, id: 'pinned', title: 'Pinned', pinned: true },
          { ...base, id: 'media', title: 'Media' },
          {
            ...base,
            id: 'remote-media',
            title: 'Remote media '.repeat(50),
            url: 'http://remote.local/' + 'x'.repeat(9000),
            kind: 'remote',
            runtimeId: 'mac',
          },
        ],
      }),
    )
    window.protectedKeys = ['studio:browser:main:media']
    window.activeMedia = ['remote-media']
  })
  await lifecycle.addScriptTag({ content: built.outputFiles[0].text })
  await lifecycle.waitForFunction(
    () =>
      window.calls.some(
        (c) =>
          c.action === 'remote-media-sources' && c.sources.some((s) => s.tabId === 'remote-media'),
      ) || !!document.querySelector('[role="alert"]'),
  )
  assert.deepEqual(
    await lifecycle.getByRole('alert').allTextContents(),
    [],
    'Remote sharing metadata passes native validation',
  )
  const remoteSharingSource = await lifecycle.evaluate(() =>
    window.calls
      .filter((c) => c.action === 'remote-media-sources')
      .at(-1)
      .sources.find((s) => s.tabId === 'remote-media'),
  )
  assert.equal(
    remoteSharingSource.title,
    'Remote media '.repeat(50).slice(0, 200),
    'Long page titles must fit the native sharing boundary',
  )
  assert.equal(
    remoteSharingSource.url,
    ('http://remote.local/' + 'x'.repeat(9000)).slice(0, 8192),
    'Descriptive URLs fit the command without changing the shared tab',
  )
  assert.equal(remoteSharingSource.profileId, 'default')
  assert.equal(remoteSharingSource.connection.address, 'http://mac.local')
  const lifecycleState = () =>
    lifecycle.evaluate(() => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')))
  assert.equal(
    (await lifecycleState()).tabs.find((t) => t.id === 'remote-media').title,
    'Remote media '.repeat(50),
    'Only sharing labels are shortened',
  )
  assert.equal(
    (await lifecycleState()).tabs.find((t) => t.id === 'remote-media').url,
    'http://remote.local/' + 'x'.repeat(9000),
  )
  await lifecycle.getByRole('button', { name: 'Current', exact: false }).first().waitFor()
  await lifecycle.clock.fastForward(120000)
  assert.equal(
    (await lifecycleState()).tabs.some((t) => t.settledAt),
    false,
    'Timers default off',
  )
  await lifecycle.evaluate(() =>
    window.setCleanup({ browserAutoSettleMinutes: 1, browserCloseSettledMinutes: 2 }),
  )
  await lifecycle.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (t) => t.id === 'unused',
      )?.settledAt,
  )
  assert.deepEqual(
    (await lifecycleState()).tabs.filter((t) => t.settledAt).map((t) => t.id),
    ['unused'],
  )
  await lifecycle.clock.fastForward(120000)
  await lifecycle.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.some(
        (t) => t.id === 'unused',
      ),
  )
  assert.equal(
    (await lifecycleState()).closed[0].id,
    'unused',
    'Auto-closed tabs remain recoverable',
  )
  assert.deepEqual(
    (await lifecycleState()).tabs.map((t) => t.id),
    ['current', 'pinned', 'media', 'remote-media'],
  )
  await lifecycle.evaluate(() =>
    window.setCleanup({ browserAutoSettleMinutes: 0, browserCloseSettledMinutes: 0 }),
  )
  const lifecycleMenu = () =>
    lifecycle.getByRole('button', { name: 'Browser options', exact: true })
  await lifecycleMenu().click()
  await lifecycle.getByRole('button', { name: 'Settle tab', exact: true }).click()
  await lifecycle.keyboard.press('Escape')
  await lifecycle.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (t) => t.id === 'current',
      )?.settledAt,
  )
  await lifecycle.locator('summary').filter({ hasText: 'Settled tabs' }).click()
  await lifecycle
    .getByRole('button', { name: /Current/ })
    .first()
    .click()
  await lifecycle.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1'))
    return s.active === 'current' && !s.tabs.find((t) => t.id === 'current').settledAt
  })
  await lifecycleMenu().click()
  await lifecycle.locator('summary').filter({ hasText: 'Snooze tab' }).click()
  await lifecycle.getByRole('button', { name: 'Snooze for 1 hour', exact: true }).click()
  await lifecycle.keyboard.press('Escape')
  await lifecycle.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (t) => t.id === 'current',
      )?.snoozedUntil,
  )
  await lifecycle.clock.fastForward(3600000)
  await lifecycle.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (t) => t.id === 'current',
      )?.snoozedUntil,
  )
  await lifecycle.close()
  const custom = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  custom.on('pageerror', (error) => errors.push(error.message))
  await custom.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:900px"></div>' }),
  )
  await custom.goto('http://localhost/customization')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await custom.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await custom.addScriptTag({ content: built.outputFiles[0].text })
  await custom.getByRole('button', { name: 'Thread for this tab', exact: true }).click()
  await custom.getByRole('button', { name: /Destination thread/ }).click()
  await custom.getByTestId('tab-conversation').waitFor()
  assert.equal(await custom.getByTestId('tab-conversation').getAttribute('data-runtime'), 'runtime')
  await custom.getByRole('button', { name: 'Change thread', exact: true }).click()
  assert.equal(
    await custom.getByRole('button', { name: /Mac thread/ }).count(),
    0,
    'Local tab only offers local threads',
  )
  await custom.getByRole('button', { name: /Destination thread/ }).click()
  assert.equal(await custom.getByTestId('tab-conversation').getAttribute('data-runtime'), 'runtime')
  await custom.getByRole('button', { name: 'Close tab thread panel' }).click()
  await custom.getByRole('textbox', { name: 'Preview URL' }).fill('http://example.test/page')
  await custom.getByRole('textbox', { name: 'Preview URL' }).press('Enter')
  await custom.getByRole('button', { name: 'Customize website', exact: true }).click()
  await custom.getByRole('textbox', { name: 'Website JavaScript' }).fill('if (')
  await custom.getByRole('button', { name: 'Save and reload', exact: true }).click()
  await custom.getByRole('alert').filter({ hasText: 'JavaScript:' }).waitFor()
  await custom.getByRole('textbox', { name: 'Website JavaScript' }).fill('')
  await custom.getByRole('textbox', { name: 'Website CSS' }).fill('body { color: red; }')
  await custom.getByRole('button', { name: 'Save and reload' }).click()
  await custom.waitForFunction(() =>
    window.preferences.some((change) =>
      change.browserProfiles?.some((profile) => profile.websites?.length),
    ),
  )
  const savedRules = await custom.evaluate(() => window.preferences.at(-1).browserProfiles)
  assert.deepEqual(savedRules.find((profile) => profile.id === 'default').websites, [
    { origin: 'http://example.test', enabled: true, css: 'body { color: red; }', script: '' },
  ])
  assert.equal(savedRules.find((profile) => profile.id === 'local-work').websites, undefined)
  await custom.getByRole('button', { name: 'Customize website', exact: true }).click()
  await custom.getByRole('button', { name: 'Customize with agent…', exact: true }).click()
  await custom.waitForFunction(() => window.agentDraft?.includes('dovo-website-customization'))
  assert.match(await custom.evaluate(() => window.agentDraft), /http:\/\/example.test/)
  const savedThreadTabs = await custom.evaluate(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')),
  )
  assert.deepEqual(savedThreadTabs.tabs.find((tab) => tab.id === savedThreadTabs.active).thread, {
    id: 'target',
    runtimeId: 'runtime',
  })
  await custom.evaluate(() => {
    const site = {
      origin: 'http://example.test',
      enabled: true,
      css: 'body { color: blue; }',
      script: '',
    }
    window.fixtureStore.runtimes[0].snapshot.workspace.tasks[0].messages.push({
      role: 'assistant',
      text: '```dovo-website-customization\n' + JSON.stringify(site) + '\n```',
    })
    window.renderBrowser()
  })
  await custom.getByRole('button', { name: 'Review website changes', exact: true }).click()
  assert.equal(
    await custom.getByRole('textbox', { name: 'Website CSS' }).inputValue(),
    'body { color: blue; }',
  )
  await custom.keyboard.press('Escape')
  await custom.setViewportSize({ width: 390, height: 844 })
  const threadBounds = await custom
    .getByRole('complementary', { name: 'Browser tab thread', exact: true })
    .boundingBox()
  assert.ok(threadBounds.x >= 0 && threadBounds.width <= 390, 'Thread panel fits a narrow window')
  await custom.screenshot({ path: root + 'work/shared-browser-thread-panel.png' })
  await custom.close()

  // A restored association cannot expose another computer's read-only editor.
  const ownership = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  ownership.on('pageerror', (error) => errors.push(error.message))
  await ownership.route('http://localhost/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:900px"></div>' }),
  )
  await ownership.goto('http://localhost/thread-ownership')
  await ownership.evaluate(() =>
    localStorage.setItem(
      'dovo.shared-browser-tabs.v1',
      JSON.stringify({
        active: 'owner-local',
        tabs: [
          {
            id: 'owner-local',
            kind: 'web',
            runtimeId: 'mac',
            profileId: 'default',
            url: 'http://local.test/',
            title: 'Owner local',
            thread: { id: 'remote-target', runtimeId: 'mac' },
          },
          {
            id: 'owner-remote',
            kind: 'remote',
            runtimeId: 'mac',
            profileId: 'remote-work',
            url: 'http://remote.test/',
            title: 'Owner remote',
            thread: { id: 'target', runtimeId: 'runtime' },
          },
        ],
      }),
    ),
  )
  await ownership.addScriptTag({ content: built.outputFiles[0].text })
  await ownership
    .getByText(
      'Choose a thread on this tab’s computer. The saved thread belongs to another computer.',
      { exact: true },
    )
    .waitFor()
  assert.equal(await ownership.getByRole('button', { name: /Mac thread/ }).count(), 0)
  await ownership.getByRole('button', { name: /Destination thread/ }).click()
  await ownership.getByRole('textbox', { name: 'Thread draft' }).fill('Local browser draft')
  await ownership.waitForFunction(
    () => window.fixtureStore.workspace.tasks[0].draft === 'Local browser draft',
  )
  await ownership.getByRole('button', { name: 'Close tab thread panel' }).click()
  await ownership.getByRole('button', { name: 'Thread for this tab', exact: true }).click()
  assert.equal(
    await ownership.getByRole('textbox', { name: 'Thread draft' }).inputValue(),
    'Local browser draft',
  )
  await ownership
    .getByRole('complementary', { name: 'Recent browser tabs' })
    .getByRole('button', { name: /Owner remote/ })
    .first()
    .click()
  await ownership.getByRole('button', { name: 'Use Mac Studio', exact: true }).click()
  await ownership.getByRole('button', { name: /Mac thread/ }).waitFor()
  assert.equal(await ownership.getByRole('button', { name: /Destination thread/ }).count(), 0)
  await ownership.getByRole('button', { name: /Mac thread/ }).click()
  assert.equal(await ownership.getByTestId('tab-conversation').getAttribute('data-runtime'), 'mac')
  await ownership.getByRole('textbox', { name: 'Thread draft' }).fill('Remote browser draft')
  await ownership.getByRole('button', { name: 'Close tab thread panel' }).click()
  await ownership.getByRole('button', { name: 'Thread for this tab', exact: true }).click()
  assert.equal(
    await ownership.getByRole('textbox', { name: 'Thread draft' }).inputValue(),
    'Remote browser draft',
    'Composer cleanup persists to the activated owner',
  )
  const ownedTabs = await ownership.evaluate(() =>
    JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')),
  )
  assert.equal(
    ownedTabs.tabs.find((tab) => tab.id === 'owner-local').runtimeId,
    'runtime',
    'Native tab identity follows its local computer',
  )
  assert.deepEqual(ownedTabs.tabs.find((tab) => tab.id === 'owner-remote').thread, {
    id: 'remote-target',
    runtimeId: 'mac',
  })
  assert.equal(ownedTabs.tabs.find((tab) => tab.id === 'owner-remote').profileId, 'remote-work')
  assert.equal(
    await ownership.evaluate(
      () => window.fixtureStore.runtimes[0].snapshot.workspace.tasks[0].draft,
    ),
    'Local browser draft',
    'Remote editing preserves the local draft',
  )
  const ownerFrame = ownership.locator('iframe').first().contentFrame().locator('body')
  const shortcut = (frame, key, shift = false) =>
    frame.evaluate(
      (_, { key, shift }) =>
        window.parent.postMessage({ channel: 'dovo-browser', type: 'shortcut', key, shift }, '*'),
      { key, shift },
    )
  await shortcut(ownerFrame, 't')
  await ownership.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 3,
  )
  const shortcutTab = await ownership.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1'))
    return state.tabs.find((tab) => tab.id === state.active)
  })
  assert.equal(shortcutTab.runtimeId, 'mac', 'Viewer new-tab shortcut keeps its computer')
  assert.equal(shortcutTab.profileId, 'remote-work', 'Viewer new-tab shortcut keeps its profile')
  await shortcut(ownerFrame, 'w')
  await ownership.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await ownership.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length,
    ),
    3,
    'Inactive viewers cannot close the selected tab',
  )
  await shortcut(ownership.locator('iframe').last().contentFrame().locator('body'), 'w')
  await ownership.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.length === 2,
  )
  await ownership.close()

  // Exercise the compact sidebar and site controls with the production components.
  const controlsPage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  controlsPage.on('pageerror', (error) => errors.push(error.message))
  await controlsPage.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app" style="height:800px"></div></body></html>',
    }),
  )
  await controlsPage.goto('http://localhost/')
  await controlsPage.evaluate(() => {
    const tabs = Array.from({ length: 5 }, (_, index) => ({
      id: 'compact-' + index,
      title: 'Website ' + index,
      url: 'https://example.test/' + index,
      kind: 'web',
      profileId: 'default',
      pinned: index < 4,
      favicon:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    }))
    localStorage.setItem(
      'dovo.shared-browser-tabs.v1',
      JSON.stringify({ tabs, active: 'compact-4' }),
    )
  })
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await controlsPage.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await controlsPage.addScriptTag({ content: built.outputFiles[0].text })
  const compactSidebar = controlsPage.getByRole('complementary', { name: 'Recent browser tabs' })
  const pins = compactSidebar
    .getByLabel('Pinned browser tabs')
    .getByRole('button', { name: / Local ·/ })
  await pins.nth(3).waitFor()
  await controlsPage.evaluate(async () => {
    window.setNativePage('studio:browser:main:compact-4', {
      profileId: 'default',
      url: 'https://example.test/4',
      title: 'Website 4',
      back: false,
      forward: false,
    })
    await window.pollBrowser()
  })
  assert.equal(
    await pins.first().locator('img').count(),
    1,
    'Restored pins retain cached favicons while native icons are loading',
  )
  assert.equal(
    await compactSidebar
      .getByRole('button', { name: /^Website 4 Local/ })
      .locator('img')
      .count(),
    1,
  )
  await controlsPage.evaluate(async () => {
    window.faviconUpdates.push({
      key: 'studio:browser:main:compact-2',
      url: 'https://example.test/2',
      favicon: null,
    })
    await window.pollBrowser()
  })
  await controlsPage.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (tab) => tab.id === 'compact-2',
      ).favicon,
  )
  const pinBounds = await Promise.all([0, 1, 2, 3].map((index) => pins.nth(index).boundingBox()))
  assert.equal(pinBounds[0].y, pinBounds[1].y)
  assert.equal(pinBounds[1].y, pinBounds[2].y)
  assert.ok(pinBounds[3].y > pinBounds[0].y, 'Exactly three pins share a row')
  assert.equal(
    await pins.first().getByText('Website 0', { exact: true }).count(),
    1,
    'Pins show a favicon and a readable title',
  )
  const separator = controlsPage.getByRole('separator', { name: 'Resize Browser tabs' })
  await separator.focus()
  await separator.press('ArrowRight')
  await separator.press('ArrowRight')
  await controlsPage.waitForFunction(() => window.preferences.at(-1)?.browserSidebarWidth === 244)
  assert.equal(Math.round((await compactSidebar.boundingBox()).width), 244)
  const currentRow = compactSidebar.getByRole('button', { name: /^Website 4 Local/ })
  const close = compactSidebar.getByRole('button', { name: 'Close tab Website 4', exact: true })
  await controlsPage.mouse.move(1000, 750)
  assert.equal(
    await close.evaluate((button) => getComputedStyle(button.parentElement).opacity),
    '0',
  )
  await currentRow.hover()
  await close.waitFor({ state: 'visible' })
  assert.equal(
    await close.evaluate((button) => getComputedStyle(button.parentElement).opacity),
    '1',
  )
  await compactSidebar.getByRole('button', { name: 'Settle tab Website 4', exact: true }).waitFor()
  await controlsPage.getByRole('button', { name: 'Website permissions and site data' }).click()
  await controlsPage.getByRole('combobox', { name: 'Microphone permission' }).selectOption('allow')
  await controlsPage.waitForFunction(() =>
    window.calls.some(
      (command) =>
        command.action === 'set-site-permission' &&
        command.origin === 'https://example.test' &&
        command.permission === 'microphone' &&
        command.setting === 'allow',
    ),
  )
  await controlsPage.getByRole('combobox', { name: 'Camera permission' }).selectOption('block')
  await controlsPage
    .getByRole('combobox', { name: 'Automatic call PiP permission' })
    .selectOption('allow')
  await controlsPage
    .getByRole('combobox', { name: 'Read clipboard permission' })
    .selectOption('block')
  await controlsPage.getByRole('button', { name: 'Request notifications permission' }).click()
  await controlsPage.waitForFunction(() =>
    window.calls.some(
      (command) =>
        command.action === 'request-site-permission' && command.permission === 'notifications',
    ),
  )
  await controlsPage.getByRole('button', { name: 'Website permissions and site data' }).click()
  assert.equal(
    await controlsPage.getByRole('combobox', { name: 'Camera permission' }).inputValue(),
    'block',
  )
  assert.equal(
    await controlsPage
      .getByRole('combobox', { name: 'Automatic call PiP permission' })
      .inputValue(),
    'allow',
  )
  assert.equal(
    await controlsPage.getByRole('combobox', { name: 'Read clipboard permission' }).inputValue(),
    'block',
  )
  await controlsPage.getByRole('button', { name: 'Cookies and site data…' }).click()
  assert.equal(
    await controlsPage.evaluate(() =>
      window.calls.some((command) => command.action === 'clear-site-data'),
    ),
    false,
  )
  await controlsPage.getByRole('button', { name: 'Clear site data', exact: true }).click()
  await controlsPage.waitForFunction(() =>
    window.calls.some(
      (command) =>
        command.action === 'clear-site-data' && command.origin === 'https://example.test',
    ),
  )
  await controlsPage.screenshot({ path: root + 'work/shared-browser/compact-site-controls.png' })
  await controlsPage.keyboard.press('Escape')
  await pins.first().click({ button: 'right' })
  await controlsPage.getByRole('menuitem', { name: 'Unpin tab', exact: true }).click()
  await controlsPage.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (tab) => tab.id === 'compact-0',
      ).pinned,
  )
  await compactSidebar.getByRole('button', { name: /^Website 0 Local/ }).click({ button: 'right' })
  await controlsPage.getByRole('menuitem', { name: 'Move to new window', exact: true }).click()
  await controlsPage.waitForFunction(() => window.transferredTab?.tab.id === 'compact-0')
  const transferred = await controlsPage.evaluate(() => window.transferredTab)
  assert.equal(transferred.targetWindowId, undefined)
  assert.equal(
    await controlsPage.evaluate(() =>
      window.calls.some(
        (command) => command.action === 'close' && command.key === window.transferredTab.key,
      ),
    ),
    false,
    'Moving retains the native page',
  )
  await compactSidebar.getByRole('button', { name: /^Website 1 Local/ }).click({ button: 'right' })
  await controlsPage.getByRole('menuitem', { name: 'Move to another window', exact: false }).hover()
  await controlsPage.getByRole('menuitem', { name: 'Other browser window', exact: true }).click()
  await controlsPage.waitForFunction(() => window.transferredTab?.targetWindowId === 2)
  await currentRow.click({ button: 'right' })
  await controlsPage.getByRole('menuitem', { name: 'Settle tab', exact: true }).click()
  await controlsPage.waitForFunction(
    () =>
      !!JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (tab) => tab.id === 'compact-4',
      ).settledAt,
  )
  // An empty destination consumes its move inbox and adopts the same native key.
  await controlsPage.evaluate(async (transferred) => {
    window.movedTabs.push({ key: transferred.key, tab: transferred.tab })
    window.createdTabs.push({
      key: 'concurrent-extension',
      url: 'https://example.test/extension',
      profileId: 'work',
      active: false,
    })
    window.closedTabs.push(transferred.key.replace('compact-0', 'compact-4'))
    await window.pollBrowser()
  }, transferred)
  await controlsPage.waitForFunction(
    (key) => window.calls.some((command) => command.action === 'show' && command.key === key),
    transferred.key,
  )
  assert.equal(
    await compactSidebar
      .getByRole('button', { name: /^Website 0 Local/ })
      .getAttribute('aria-current'),
    'page',
  )
  await compactSidebar.getByRole('button', { name: /^example.test\/extension Local/ }).waitFor()
  assert.equal(
    await compactSidebar.getByRole('button', { name: /^Website 4 Local/ }).count(),
    0,
    'Moves must not drop simultaneous extension creation or closure events',
  )
  await compactSidebar.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await controlsPage.getByRole('menuitem', { name: 'Mac Studio', exact: true }).click()
  await controlsPage
    .getByRole('textbox', { name: 'Preview URL' })
    .fill('http://localhost:3000/remote-icon')
  await controlsPage.getByRole('textbox', { name: 'Preview URL' }).press('Enter')
  await controlsPage.getByRole('button', { name: /^Page .*Remote · Mac Studio/ }).waitFor()
  const icon = await compactSidebar
    .getByLabel('Pinned browser tabs')
    .locator('img')
    .first()
    .getAttribute('src')
  await controlsPage.evaluate((favicon) => {
    document
      .querySelector('iframe')
      .contentWindow.postMessage({ type: 'fixture-favicon', favicon }, '*')
  }, icon)
  const remoteIconRow = compactSidebar.getByRole('button', { name: /^Page .*Remote · Mac Studio/ })
  await remoteIconRow.locator('img').waitFor()
  assert.equal(await remoteIconRow.locator('img').getAttribute('src'), icon)
  await controlsPage.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage({ type: 'fixture-favicon', favicon: null }, '*'),
  )
  await controlsPage.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.shared-browser-tabs.v1')).tabs.find(
        (tab) => tab.kind === 'remote',
      ).favicon,
  )
  assert.equal(
    await remoteIconRow.locator('img').count(),
    0,
    'A definitive missing icon clears the remote favicon',
  )
  await controlsPage.close()

  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Shared browser tabs, local/remote ownership and profiles, saved pages, private/pinned tabs, temporary link previews, native/remote promotion without page replacement, nested/deferred navigation, bounded cleanup, shortcuts, drafts, feature gate and pop-out isolation passed.',
  )
} finally {
  await browser.close()
}
