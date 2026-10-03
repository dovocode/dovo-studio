import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const viewer = `<html><body><script>window.addEventListener('message',event=>{const m=event.data;if(m.type==='connect'){const tab=new URL(m.url).searchParams.get('ticket');window.parent.postMessage({channel:'dovo-browser',type:'state',url:'http://localhost:3000/'+tab,title:'Page '+tab,back:false,forward:false,loading:false,editable:false},'*')}})</script></body></html>`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {BrowserPane} from './src/browser/browser-pane.tsx';import {TooltipProvider} from '@dovo/studio-ui';createRoot(document.getElementById('app')).render(<TooltipProvider><BrowserPane taskId="task"/></TooltipProvider>);`,
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
        builder.onResolve({ filter: /^@dovo\/studio-core(\/state)?$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        builder.onResolve({ filter: /^\.\/(device-list|physical-controls)$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'js',
          resolveDir: root + 'packages/extension-tasks',
          contents: path.endsWith('/state')
            ? `export {useState as useApplicationState} from 'react';`
            : path === './device-list'
              ? 'export const DeviceList=()=>null;'
              : path === './physical-controls'
                ? 'export const PhysicalControls=()=>null;'
                : `
import {createContext,createElement,useContext,useState} from 'react';
import {resolveSettingsTarget} from '@dovo/protocol';
export * from '@dovo/protocol';
export const providers=[];export const useResolvedTheme=()=> 'dark';
export const remoteBrowserHtml=${JSON.stringify(viewer)};
window.calls=[]; const request=async(path,body)=>{window.calls.push({path,body});return {ok:true,ticket:body.tabId,tabId:body.tabId,profileId:body.profileId}};
const browser=async(command)=>{window.calls.push(command)};
const profile={id:'runtime',name:'LAN runtime',connection:{address:'http://runtime.local',token:'paired-device'}};
const snapshot={workspace:{tasks:[],repositories:[]}};
const sources=[{profile,name:profile.name,scope:'runtime',connected:true,snapshot}];
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
  for (const file of readdirSync(root + 'apps/web/dist/client/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/web/dist/client/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  mkdirSync(root + 'work/browser-tabs', { recursive: true })
  await page.setViewportSize({ width: 380, height: 700 })
  if (await page.getByRole('tablist').count()) throw new Error('Single-tab browser has a tab strip')
  if (await page.getByRole('combobox', { name: 'Profile for this tab' }).isVisible())
    throw new Error('Profile picker is outside options')
  const toolbar = page.getByRole('form', { name: 'Browser navigation' })
  const toolbarBox = await toolbar.boundingBox()
  if (!toolbarBox || toolbarBox.height > 45) throw new Error('Browser toolbar is not compact')
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
  await page.getByRole('button', { name: 'Reload preview', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'reload'))
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.getByRole('button', { name: 'Hard reload', exact: true }).click()
  await page.getByRole('button', { name: 'Open DevTools', exact: true }).click()
  await page.getByRole('button', { name: 'Open in default browser', exact: true }).click()
  const browserActions = await page.evaluate(() => window.calls.map((call) => call.action))
  if (!['hard-reload', 'devtools', 'external'].every((action) => browserActions.includes(action)))
    throw new Error('Advanced browser actions stopped working')
  await page.getByRole('button', { name: 'Close current tab', exact: true }).click()
  await page.getByLabel('Browser options', { exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'close'))
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New remote tab · Remote Work', exact: true }).click()
  await page.getByRole('tab', { name: /Page/ }).waitFor()
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
  console.log(
    'Compact toolbar, hidden single-tab strip, Enter navigation, HTTP LAN addresses, browser options, plus menu, mixed tab strip, remote indicators, title updates, retained sessions, per-tab local/remote profile choices, profile switching, and scoped close passed.',
  )
} finally {
  await browser.close()
}
