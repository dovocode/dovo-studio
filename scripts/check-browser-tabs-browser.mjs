import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const viewer = `<html><body><script>
let tab='',url='',back=true;
function state(){window.parent.postMessage({channel:'dovo-browser',type:'state',url,title:'Page '+tab,back,forward:false,loading:false,editable:false},'*')}
window.addEventListener('message',event=>{const m=event.data;
if(m.type==='connect'){tab=new URL(m.url).searchParams.get('ticket');url='http://localhost:3000/'+tab;window.parent.postMessage({channel:'dovo-browser',type:'connection',online:true},'*');state()}
if(m.type==='input'){window.parent.postMessage({channel:'fixture',input:m.input},'*');if(m.input.type==='navigate')url=m.input.url;state()}
if(m.type==='viewport')window.parent.postMessage({channel:'fixture',viewport:m},'*');
});</script></body></html>`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {BrowserPane} from './src/browser/browser-pane.tsx';import {TooltipProvider,Tooltip,TooltipTrigger,TooltipContent} from '@dovo/studio-ui';createRoot(document.getElementById('app')).render(<TooltipProvider><BrowserPane taskId="task"/></TooltipProvider>);window.mountTooltip=()=>{const node=document.createElement('div');document.body.append(node);const root=createRoot(node);root.render(<TooltipProvider><Tooltip delayDuration={0}><TooltipTrigger asChild><button id="tooltip-trigger" style={{position:'fixed',left:5,top:200,zIndex:100}}>Details</button></TooltipTrigger><TooltipContent side="right" style={{width:100,height:60}}>Thread details</TooltipContent></Tooltip></TooltipProvider>);window.unmountTooltip=()=>{root.unmount();node.remove()}};`,
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
        // This fixture covers the per-thread browser. Shared-browser panels are
        // exercised with their real components in check-shared-browser-browser.
        builder.onResolve(
          { filter: /^(\.\/browser-thread-panel|\.\.\/detail\/resizable-sidebar)$/ },
          ({ path, importer }) =>
            importer === root + 'packages/extension-tasks/src/browser/browser-pane.tsx'
              ? { path, namespace: 'shared-panel-fixture' }
              : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'shared-panel-fixture' }, ({ path }) => ({
          contents: `export function ${path === './browser-thread-panel' ? 'BrowserThreadPanel' : 'ResizableSidebar'}(){throw new Error('Shared browser panel rendered in per-thread browser fixture')}`,
        }))
        builder.onResolve({ filter: /^@dovo\/studio-core(\/state)?$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
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
import {createContext,createElement,useContext,useState} from 'react';
import {resolveSettingsTarget} from '@dovo/protocol';
export * from '@dovo/protocol';
export {updateTask,createTask} from '${root}packages/studio-core/src/workspace/actions.ts';
export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes.ts';
export {DiscoveryCache} from '${root}packages/client-runtime/src/index.ts';
export {browserModelCatalogCache} from '${root}packages/studio-core/src/workspace/model-catalog-cache.ts';
export {useSettingsDraft,useConfirmSettingsNavigation,useOptionalSettingsTarget} from '${root}packages/studio-core/src/settings-target.tsx';
export const providers=[];export const useResolvedTheme=()=> 'dark';export const reducedMotion=()=>false;
export const remoteBrowserHtml=${JSON.stringify(viewer)};
window.browserInputs=[];window.browserViewports=[];window.addEventListener('message',event=>{if(event.data?.channel==='fixture'){if(event.data.input)window.browserInputs.push(event.data.input);if(event.data.viewport)window.browserViewports.push(event.data.viewport)}});
window.calls=[]; const request=async(path,body)=>{window.calls.push({path,body});return {ok:true,ticket:body.tabId,tabId:body.tabId,profileId:body.profileId}};
const browser=async(command)=>{window.calls.push(command)};
const profile={id:'runtime',name:'LAN runtime',connection:{address:'http://runtime.local',token:'paired-device'}};
const snapshot={workspace:{tasks:[],repositories:[]}};
const sources=[{profile,name:profile.name,scope:'runtime',connected:true,snapshot}];
export const useRuntimeSources=()=>sources;
const workspace={activeRuntimeId:profile.id,connection:profile.connection,request,connected:true,snapshot,runtimes:sources};
const WorkspaceContext=createContext(null);
export const useWorkspace=()=>useContext(WorkspaceContext)||workspace;
export const WorkspaceScope=({profile,children})=>{
  const source=sources.find(entry=>entry.profile.id===profile.id&&entry.profile.connection.address===profile.connection.address&&entry.profile.connection.token===profile.connection.token);
  if(!source)return null;
  return createElement(WorkspaceContext.Provider,{value:{...workspace,activeRuntimeId:source.profile.id,connection:source.profile.connection,snapshot:source.snapshot,connected:source.connected}},children);
};
export const useSettingsTarget=()=>{
  const [target,setTarget]=useState({environmentId:'',projectId:''});
  return {target,setTarget,sources,...resolveSettingsTarget(sources,target,workspace.activeRuntimeId)};
};
export const useStudioHost=()=>({browser});
export const useAppPreferences=()=>({browserProfiles:[{id:'default',name:'Local Default'},{id:'local-work',name:'Local Work'}],browserProfileByThread:{},browserAgentAccess:{}});
export const useRemoteBrowserProfiles=()=>({profiles:[{id:'default',name:'Remote Default'},{id:'remote-work',name:'Remote Work'},{id:'remote-personal',name:'Remote Personal'}],error:'',loading:false});
export const readAppPreferences=()=>({browserViewport:'fill'});
window.preferences=[];export const updateAppPreferences=change=>window.preferences.push(change);export const startPolling=()=>({stop:async()=>{}});
`,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.setDefaultTimeout(10000)
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app" style="height:700px"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  mkdirSync(root + 'work/browser-tabs', { recursive: true })
  await page.setViewportSize({ width: 380, height: 700 })
  if (await page.getByRole('tablist').count()) throw new Error('Single-tab browser has a tab strip')
  if (await page.getByRole('combobox', { name: 'Profile for this tab' }).isVisible())
    throw new Error('Profile picker is outside options')
  const toolbar = page.getByRole('form', { name: 'Browser navigation' })
  const toolbarBox = await toolbar.boundingBox()
  if (!toolbarBox || toolbarBox.height > 100)
    throw new Error('Browser toolbar should fit in two compact rows at narrow widths')
  const input = page.getByRole('textbox', { name: 'Preview URL' })
  if (await input.inputValue()) throw new Error('New tab should have an empty address')
  const inputBox = await input.boundingBox()
  if (!inputBox || inputBox.width < 160) throw new Error('Address bar is squeezed by controls')
  await page.screenshot({ path: root + 'work/browser-tabs/compact-browser.png' })
  await input.fill('http://localhost:3000')
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.getByRole('button', { name: 'Agent browser access', exact: true }).click()
  await page.getByRole('combobox', { name: 'Viewport', exact: true }).selectOption('phone')
  if ((await page.evaluate(() => window.calls)).some((call) => call.action === 'show'))
    throw new Error('Browser options submitted the address form')
  if (!(await page.evaluate(() => window.preferences.length)))
    throw new Error('Agent browser access control stopped working')
  await page.getByLabel('Browser options', { exact: true }).click()
  await input.press('Enter')
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'show'))
  const shown = await page.evaluate(() => window.calls.find((call) => call.action === 'show'))
  if (shown.url !== 'http://runtime.local:3000/')
    throw new Error('HTTP LAN navigation changed: ' + shown.url)
  if (shown.viewport?.width !== 390) throw new Error('Responsive viewport stopped working')
  // Disclosures in the retained conversation and hidden dialogs must not hide the native page.
  await page.evaluate(() => {
    const retained = document.createElement('div')
    retained.id = 'retained-chat'
    retained.hidden = true
    retained.innerHTML =
      '<details open><summary>Tool output</summary>Done</details><div role="dialog">Closed dialog</div>'
    document.body.append(retained)
    const details = document.createElement('details')
    details.id = 'sidebar-details'
    details.open = true
    details.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px'
    details.innerHTML = '<summary>Info</summary>Project info'
    document.body.append(details)
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  if (
    (
      await page.evaluate(() =>
        window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1),
      )
    ).action !== 'show'
  )
    throw new Error('Unrelated disclosures or hidden dialogs blacked out the native browser')
  await page.evaluate(() => {
    document.getElementById('retained-chat').remove()
    document.getElementById('sidebar-details').remove()
  })
  // Real overlays must still hide the native layer, then restore it without navigation.
  const nativeAction = async (action) => {
    await page.waitForFunction(
      (action) =>
        window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1)?.action ===
        action,
      action,
    )
  }
  // A real tooltip at the page edge must appear over the native view even though
  // it does not cover the slot's center. Closing it must restore the live page.
  await page.evaluate(() => window.mountTooltip())
  await page.locator('#tooltip-trigger').hover()
  const tooltip = page.getByRole('tooltip', { name: 'Thread details', exact: true })
  await tooltip.waitFor()
  const tooltipBox = await tooltip.boundingBox()
  const nativeBounds = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'show').at(-1).bounds,
  )
  if (
    !tooltipBox ||
    tooltipBox.x >= nativeBounds.x + nativeBounds.width ||
    tooltipBox.x + tooltipBox.width <= nativeBounds.x ||
    tooltipBox.y >= nativeBounds.y + nativeBounds.height ||
    tooltipBox.y + tooltipBox.height <= nativeBounds.y ||
    tooltipBox.x + tooltipBox.width >= nativeBounds.x + nativeBounds.width / 2
  )
    throw new Error('Tooltip fixture must overlap the browser edge without covering its center')
  await nativeAction('hide')
  await page.waitForFunction(
    () =>
      window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1)
        ?.preserveFocus === true,
  )
  // A modal must take priority over passive tooltip focus, even if its own box is elsewhere.
  await page.evaluate(() => {
    const modal = document.createElement('div')
    modal.id = 'tooltip-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;z-index:100'
    document.body.append(modal)
  })
  await page.waitForFunction(
    () =>
      window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1)
        ?.preserveFocus !== true,
  )
  await page.locator('#tooltip-modal').evaluate((element) => element.remove())
  await page.waitForFunction(
    () =>
      window.calls.filter((call) => ['show', 'hide'].includes(call.action)).at(-1)
        ?.preserveFocus === true,
  )
  await page.mouse.move(370, 10, { steps: 5 })
  await tooltip.waitFor({ state: 'hidden' })
  await nativeAction('show')
  await page.locator('#tooltip-trigger').hover()
  await tooltip.waitFor()
  await nativeAction('hide')
  await page.keyboard.press('Escape')
  await tooltip.waitFor({ state: 'hidden' })
  await nativeAction('show')
  await page.evaluate(() => window.unmountTooltip())
  await page.addStyleTag({ content: '#browser-overlay[data-state="closed"] { display: none }' })
  for (const role of ['menu', 'listbox', 'dialog']) {
    await page.evaluate((role) => {
      const overlay = document.createElement('div')
      overlay.id = 'browser-overlay'
      overlay.setAttribute('role', role)
      overlay.style.cssText = 'position:fixed;inset:100px 10px 10px;background:black;z-index:100'
      document.body.append(overlay)
    }, role)
    await nativeAction('hide')
    // Changing hidden alone must be observed, including when an overlay stays mounted.
    await page.evaluate(() => {
      document.getElementById('browser-overlay').hidden = true
    })
    await nativeAction('show')
    await page.evaluate(() => {
      document.getElementById('browser-overlay').hidden = false
    })
    await nativeAction('hide')
    // Mounted menus may change visibility using Radix's data-state alone.
    await page.locator('#browser-overlay').evaluate((element) => {
      element.setAttribute('data-state', 'closed')
    })
    await nativeAction('show')
    await page.locator('#browser-overlay').evaluate((element) => {
      element.setAttribute('data-state', 'open')
    })
    await nativeAction('hide')
    await page.evaluate(() => document.getElementById('browser-overlay').remove())
    await nativeAction('show')
  }
  await page.evaluate(() => {
    const modal = document.createElement('div')
    modal.id = 'modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.style.cssText = 'position:fixed;top:0;left:0;width:20px;height:20px'
    document.body.append(modal)
  })
  await nativeAction('hide')
  await page.evaluate(() => document.getElementById('modal').remove())
  await nativeAction('show')
  // Retained panes can have a full layout box while visibility:hidden. Their native
  // child must not cover the active screen or take its clicks.
  await page.locator('#app').evaluate((element) => {
    element.style.visibility = 'hidden'
  })
  await nativeAction('hide')
  await page.locator('#app').evaluate((element) => {
    element.style.visibility = ''
  })
  await nativeAction('show')
  // Expanded/floating previews can overlap open disclosures and persistent panels
  // underneath them. Those must not replace the interactive page with a picture.
  for (const tag of ['details', 'div']) {
    await page.evaluate((tag) => {
      const app = document.getElementById('app')
      app.style.position = 'relative'
      app.style.zIndex = '10'
      const panel = document.createElement(tag)
      panel.id = 'behind-browser'
      if (tag === 'details') {
        panel.open = true
        panel.innerHTML = '<summary>Tool output</summary>'
      } else panel.setAttribute('role', 'dialog')
      panel.style.cssText = 'position:fixed;inset:100px 10px 10px;z-index:1;background:black'
      document.body.append(panel)
    }, tag)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await nativeAction('show')
    await page.locator('#behind-browser').evaluate((element) => {
      element.style.zIndex = '100'
    })
    await nativeAction('hide')
    await page.locator('#behind-browser').evaluate((element) => element.remove())
    await nativeAction('show')
  }
  await page.evaluate(() => {
    const backdrop = document.createElement('div')
    backdrop.id = 'backdrop'
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:100;background:#0008'
    document.body.append(backdrop)
  })
  await nativeAction('hide')
  await page.locator('#backdrop').evaluate((element) => element.remove())
  await nativeAction('show')
  await page.locator('#app').evaluate((element) => {
    element.style.height = '180px'
    element.style.overflow = 'hidden'
  })
  await page.waitForFunction(() => {
    const last = window.calls.filter((call) => call.action === 'show').at(-1)
    return last && last.bounds.y + last.bounds.height <= 180
  })
  await page.locator('#app').evaluate((element) => {
    element.style.height = '700px'
    element.style.overflow = ''
    element.style.position = ''
    element.style.zIndex = ''
  })
  await nativeAction('show')
  // The browser's own floating container must hide the native layer while dragging.
  await page.getByRole('region', { name: 'Browser previews' }).evaluate((element) => {
    element.setAttribute('data-preview-dragging', 'true')
  })
  await nativeAction('hide')
  await page.getByRole('region', { name: 'Browser previews' }).evaluate((element) => {
    element.removeAttribute('data-preview-dragging')
  })
  await nativeAction('show')
  // Streaming text elsewhere on the page must not resend identical native view bounds.
  const beforeStreaming = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'show').length,
  )
  await page.evaluate(async () => {
    const stream = document.createElement('div')
    stream.style.position = 'fixed'
    document.body.append(stream)
    for (let i = 0; i < 100; i++) stream.append(document.createTextNode('token'))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    stream.remove()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  if (
    (await page.evaluate(() => window.calls.filter((call) => call.action === 'show').length)) !==
    beforeStreaming
  )
    throw new Error('Unrelated streaming mutations resent native browser bounds')
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'reload'))
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.getByRole('button', { name: 'Hard reload', exact: true }).click()
  await page.getByRole('button', { name: 'Open DevTools', exact: true }).click()
  await page.getByRole('button', { name: 'Open in default browser', exact: true }).click()
  const browserActions = await page.evaluate(() => window.calls.map((call) => call.action))
  if (!['hard-reload', 'devtools', 'external'].every((action) => browserActions.includes(action)))
    throw new Error('Advanced browser actions stopped working')
  await page.getByText('Tab & page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Close current tab', exact: true }).click()
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'close'))
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New remote tab · Remote Work', exact: true }).click()
  await page.getByRole('tab', { name: /Page/ }).waitFor()
  if ((await toolbar.count()) !== 1)
    throw new Error('Remote browser must use the shared navigation toolbar')
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.waitForFunction(() => window.browserInputs.some((input) => input.type === 'reload'))
  await page.evaluate(() => {
    const frame = [...document.querySelectorAll('iframe')].find(
      (frame) => frame.getBoundingClientRect().height > 0,
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { channel: 'dovo-browser', type: 'focusAddress' },
      }),
    )
  })
  if (
    !(await input.evaluate(
      (node) =>
        node === document.activeElement &&
        node.selectionStart === 0 &&
        node.selectionEnd === node.value.length,
    ))
  )
    throw new Error('Remote address shortcut did not select the shared address field')
  await input.fill('http://localhost:4321/shared-ui')
  await input.press('Enter')
  await page.waitForFunction(() =>
    window.browserInputs.some(
      (input) => input.type === 'navigate' && input.url === 'http://localhost:4321/shared-ui',
    ),
  )
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Viewport', exact: true }).selectOption('tablet')
  await page.waitForFunction(() =>
    window.browserViewports.some((viewport) => viewport.preset === 'tablet'),
  )
  await page.getByLabel('Browser options', { exact: true }).click()
  if (await page.getByText('Choose a device', { exact: true }).count())
    throw new Error('Device panel leaked into remote browser')
  const first = await page.getByRole('tab', { name: /Page/ }).textContent()
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New remote tab · Remote Default', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((c) => c.path === '/api/previews/browser/open').length === 2,
  )
  await page.getByRole('tab', { name: new RegExp(first.trim()) }).click()
  if (
    (await page
      .getByRole('tab', { name: new RegExp(first.trim()) })
      .getAttribute('aria-selected')) !== 'true'
  )
    throw new Error('Remote tab not selected')
  if ((await page.getByLabel('Remote tab', { exact: true }).count()) !== 2)
    throw new Error('Missing remote indicators')
  await page.getByLabel('Browser options', { exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'Profile for this tab' })
  if ((await picker.inputValue()) !== 'remote-work')
    throw new Error('Tab lost its selected remote profile')
  if (await picker.getByRole('option', { name: 'Local Work' }).count())
    throw new Error('Local profiles appeared in a remote tab')
  await picker.selectOption('remote-personal')
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((c) => c.path === '/api/previews/browser/open').length === 3,
  )
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New local tab · Local Work', exact: true }).click()
  await page.getByLabel('Browser options', { exact: true }).click()
  if ((await picker.inputValue()) !== 'local-work')
    throw new Error('New local tab did not use its selected profile')
  if (await picker.getByRole('option', { name: 'Remote Work' }).count())
    throw new Error('Remote profiles appeared in a local tab')
  await page.getByLabel('Browser options', { exact: true }).click()
  if (await page.getByRole('button', { name: 'Profiles', exact: true }).count())
    throw new Error('Profile settings stayed in the thread')

  if ((await page.getByRole('tab').count()) !== 4)
    throw new Error('Local and remote tabs not sharing strip')
  await page.getByRole('button', { name: 'Close tab ' + first.trim(), exact: true }).click()
  mkdirSync(root + 'work/browser-tabs', { recursive: true })
  await page.screenshot({ path: root + 'work/browser-tabs/tabs.png' })
  const calls = await page.evaluate(() => window.calls)
  const opens = calls.filter((c) => c.path === '/api/previews/browser/open')
  const closes = calls.filter((c) => c.path === '/api/previews/browser/close')
  if (
    opens.length !== 3 ||
    opens[0].body.tabId === opens[1].body.tabId ||
    closes.length !== 2 ||
    closes[0].body.tabId !== opens[0].body.tabId ||
    closes[0].body.profileId !== 'remote-work' ||
    closes[1].body.profileId !== 'remote-personal' ||
    opens[0].body.profileId !== 'remote-work' ||
    opens[1].body.profileId !== 'default' ||
    opens[2].body.profileId !== 'remote-personal' ||
    errors.length
  )
    throw new Error(JSON.stringify({ calls, errors }))
  const browserTabs = page.getByRole('tab')
  await page.getByRole('tab', { selected: true }).press('Home')
  if ((await browserTabs.first().getAttribute('aria-selected')) !== 'true')
    throw new Error('Home did not select the first tab')
  await browserTabs.first().press('End')
  if ((await browserTabs.last().getAttribute('aria-selected')) !== 'true')
    throw new Error('End did not select the last tab')
  const previousTab = await browserTabs.nth((await browserTabs.count()) - 2).textContent()
  await browserTabs.last().locator('..').getByRole('button').click()
  if ((await page.getByRole('tab', { selected: true }).textContent()) !== previousTab)
    throw new Error('Closing the current tab should select its neighbor')
  console.log(
    'Compact toolbar, native browser visibility with retained chat, real tooltips and overlays, hidden single-tab strip, Enter navigation, HTTP LAN addresses, browser options, plus menu, mixed tab strip, remote indicators, title updates, retained sessions, per-tab local/remote profile choices, profile switching, and scoped close passed.',
  )
} finally {
  await browser.close()
}
