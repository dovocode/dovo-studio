import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
// Adapt native rendering/IO only. Screen, route gate, state model and draft append/storage are production.
const adapters = `
import React,{createContext,useContext,useSyncExternalStore,useImperativeHandle,useRef,forwardRef} from 'react';
window.calls=[];window.navigation=[];window.copied=null;window.failDraft=false;
export const storage={getItem:async k=>localStorage.getItem(k),setItem:async(k,v)=>{window.calls.push({storage:k});if(window.failDraft&&k.startsWith('dovo.draft.'))throw Error('disk full');localStorage.setItem(k,v)},removeItem:async k=>localStorage.removeItem(k)};
export default storage;
export const setStringAsync=async text=>{window.copied=text};let uuid=0;export const randomUUID=()=> '00000000-0000-4000-8000-'+String(++uuid).padStart(12,'0');
const clean=s=>Object.assign({},...([s].flat(Infinity).filter(Boolean)));const css=s=>{const v=clean(s);if(v.paddingHorizontal){v.paddingLeft=v.paddingRight=v.paddingHorizontal;delete v.paddingHorizontal}if(v.paddingVertical){v.paddingTop=v.paddingBottom=v.paddingVertical;delete v.paddingVertical}return v};
export const View=({children,style,pointerEvents})=><div style={{display:'flex',flexDirection:'column',pointerEvents,...css(style)}}>{children}</div>;
export const ScrollView=({children,style,contentContainerStyle})=><div style={{...css(style),overflow:'auto'}}><div style={{display:'flex',...css(contentContainerStyle)}}>{children}</div></div>;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityRole,accessibilityState})=><button role={accessibilityRole} aria-checked={accessibilityState?.checked} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const Text=({children,style,accessibilityRole})=><div role={accessibilityRole} style={css(style)}>{children}</div>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id} disabled={i.disabled}>{i.name}</option>)}</select></label>;
export const Field=({label,value,onChangeText,onSubmitEditing,onFocus,onBlur})=><label>{label}<input aria-label={label} value={value} onFocus={onFocus} onBlur={onBlur} onChange={e=>onChangeText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onSubmitEditing?.()}}/></label>;export const SearchField=Field;
export const Sheet=forwardRef(({title,children,onClose},ref)=>{useImperativeHandle(ref,()=>({dismiss:cb=>{onClose();cb?.()}}));return <section role="dialog" aria-label={title}><h2>{title}</h2><button aria-label="Dismiss sheet" onClick={onClose}>Done</button>{children}</section>});
export const ScreenHeader=({title})=><h1>{title}</h1>;
export const useTheme=()=>({mode:'dark',colors:{border:'#455063'},styles:{screen:{height:'100vh',display:'flex',flexDirection:'column'},content:{padding:12},muted:{color:'#b8c4d8'},error:{color:'#ff9999'},title:{fontWeight:'bold'}}});
export const router={push:path=>window.navigation.push(path)};
let enabled=false;const listeners=new Set();window.setExperimental=value=>{enabled=value;listeners.forEach(f=>f())};export const useMobilePreferences=()=>({browserWorkspaceEnabled:useSyncExternalStore(f=>{listeners.add(f);return ()=>listeners.delete(f)},()=>enabled)});
const profiles=[{id:'lan',name:'LAN computer'},{id:'mac',name:'Mac computer'}];
const scope=createContext('lan');export const RuntimeScope=({runtimeId,children})=><scope.Provider value={runtimeId}>{children}</scope.Provider>;
const overviews=profiles.map(profile=>({profile,connected:true,snapshot:{workspace:{tasks:[{id:'target',title:'Destination',draft:'Server fallback'}]}}}));
const readRuntime=async(owner,path,body)=>{window.calls.push({owner:owner.id,path,body});if(path.endsWith('profiles/read'))return {profiles:[{id:'default',name:'Default'},{id:'work',name:'Work'}]};if(path.endsWith('selection'))return {text:'  remote exact\\ntext ',url:'http://localhost:4000',title:'Remote page'};return {ok:true,ticket:'fixture-ticket',tabId:body.tabId,profileId:body.profileId}};
export const useRuntime=()=>{const id=useContext(scope);return {activeId:id,connection:{address:'http://'+id+'.fixture',token:'paired'},profiles,overviews,readRuntime,readEffect:(path,body)=>Effect.tryPromise(()=>readRuntime(profiles.find(p=>p.id===id),path,body))}};export const useNavigation=()=>({navigate:(...args)=>window.navigation.push(args)});export const usePreviewActive=()=>true;
export const WebView=forwardRef(({source,onMessage,onError},ref)=>{const frame=useRef();const owner=useContext(scope);useImperativeHandle(ref,()=>({reload:()=>window.calls.push({reload:true}),goBack:()=>{},goForward:()=>{},injectJavaScript:code=>frame.current.contentWindow.eval(code)}));window.webError=()=>onError?.({nativeEvent:{description:'Fixture page failed'}});return <iframe title={source.html?'Remote page':'Device page'} ref={frame} data-url={source.uri} onLoad={()=>{const w=frame.current.contentWindow;w.ReactNativeWebView={postMessage:data=>onMessage({nativeEvent:{data}})};if(source.html){let url='about:blank';const emit=m=>w.ReactNativeWebView.postMessage(JSON.stringify({channel:'dovo-browser',...m}));const state=()=>emit({type:'state',url,title:'Remote page',back:false,forward:false,loading:false,editable:false});w.addEventListener('message',e=>{const m=e.data;if(m.type==='connect'){const call=window.calls.findLast(c=>c.owner===owner&&c.path?.endsWith('/open'));url=call?.body.url||'about:blank';emit({type:'connection',online:true});state()}if(m.type==='input'&&m.input.type==='navigate'){url=m.input.url;setTimeout(state,25)}});emit({type:'ready'})}}} srcDoc={source.html?'Remote viewer fixture':'<title>Local fixture</title><pre id="selection">  Keep  spaces\\nSecond line </pre>'}/>});
export const Glass=View;export const Icon=()=>null;export const IconButton=Action;export const TextInput='input';export const StyleSheet={hairlineWidth:1};export const AppState={currentState:'active'};export const Alert={alert:(...args)=>window.calls.push({alert:args})};export const useOpenAppLink=()=>()=>{throw Error('Unexpected external navigation')};export const remoteBrowserHtml='fixture';export const deviceHostMessage=message=>message;export const useScreenshotAttachment=()=>{throw Error('Shared browser must not create screenshot attachment')};
window.nativeCalls=[];const nativeListeners=new Map(),nativeTabs=new Map(),nativeProfiles=new Set(['device']);let nativeEnabled=false;let installed=[];let nativeInstance=0;
const emit=(name,event)=>{for(const f of nativeListeners.get(name)||[])f(event)};window.nativeEmit=(name,page)=>{if(name==='onTabCreated')nativeTabs.set(page.tabId,page);if(name==='onTabClosed'&&nativeTabs.get(page.tabId)?.instanceId===page.instanceId)nativeTabs.delete(page.tabId);emit(name,page)};
const nativeStatus=()=>({enabled:nativeEnabled,browsingAvailable:window.nativeBrowsing!==false,extensionsAvailable:true,websiteTabCaptureAvailable:false,websiteTabCaptureUnavailableReason:'No public arbitrary-tab capture API.',systemVersion:'mock',maxTabs:100,profiles:[...nativeProfiles].map(profileId=>({profileId,dataStoreIdentifier:profileId})),tabs:[...nativeTabs.values()]});
const nativeModule={
addListener:(name,f)=>{const listeners=nativeListeners.get(name)||new Set();nativeListeners.set(name,listeners);listeners.add(f);return {remove:()=>listeners.delete(f)}},
setEnabled:async enabled=>{window.nativeCalls.push({enabled});nativeEnabled=enabled;if(!enabled)nativeTabs.clear();return nativeStatus()},getStatus:async()=>nativeStatus(),
ensureProfile:async profileId=>{nativeProfiles.add(profileId);return {profileId,dataStoreIdentifier:profileId}},
openTab:async options=>{window.nativeCalls.push({open:options});if(nativeTabs.has(options.tabId)){const existing=nativeTabs.get(options.tabId);if(existing.profileId===options.profileId)return existing;throw Error('Native fixture profile conflict')};const page={...options,instanceId:'instance-'+(++nativeInstance),openerTabId:null,url:options.url||'about:blank',title:'Native page',loadState:'loaded',progress:1,canGoBack:false,canGoForward:false,secure:false,error:null};nativeTabs.set(page.tabId,page);emit('onTabCreated',{...page,reason:'api'});return page},
activateTab:async tabId=>{window.nativeCalls.push({activate:tabId})},
closeTab:async tabId=>{const tab=nativeTabs.get(tabId);nativeTabs.delete(tabId);if(tab)setTimeout(()=>emit('onTabClosed',{...tab,reason:'api'}),20)},
navigate:async(tabId,url)=>{if(window.nativeFail)throw Error('Native fixture navigation failed');const tab={...nativeTabs.get(tabId),url,title:'Native page'};nativeTabs.set(tabId,tab);emit('onTabUpdated',tab)},
reload:async tabId=>window.nativeCalls.push({reload:tabId}),goBack:async()=>{},goForward:async()=>{},getSelection:async()=>({text:'  Native exact\\nselection ',truncated:false}),
pickExtensionFolder:async()=>({stagingId:'stage',name:'Fixture extension',version:'1',description:'Review fixture',manifestVersion:3,hasAction:true,hasPopup:true,hasBackground:true,hasContentScripts:false,hasOptionsPage:false,requestedPermissions:['tabs','nativeMessaging'],optionalPermissions:[],requestedMatchPatterns:['http://localhost/*'],optionalMatchPatterns:[],unsupportedPermissions:['nativeMessaging'],warnings:['Fixture warning']}),
discardStagedExtension:async id=>window.nativeCalls.push({discard:id}),
installExtension:async options=>{window.nativeCalls.push({install:options});const extension={extensionId:'ext',profileId:options.profileId,name:'Fixture extension',version:'1',enabled:true,loaded:true,hasAction:true,grantedPermissions:options.grant.permissions,grantedMatchPatterns:options.grant.matchPatterns,requestedPermissions:['tabs','nativeMessaging'],optionalPermissions:[],requestedMatchPatterns:['http://localhost/*'],optionalMatchPatterns:[],unsupportedPermissions:['nativeMessaging'],unsupportedApis:['nativeMessaging'],errors:[]};installed=[extension];emit('onExtensionsChanged',{profileId:options.profileId});return extension},
listExtensions:async profileId=>installed.filter(e=>e.profileId===profileId),
setExtensionEnabled:async(profileId,id,enabled)=>{window.nativeCalls.push({extensionEnabled:enabled});installed=installed.map(e=>({...e,enabled}));return installed[0]},
setExtensionGrant:async(profileId,id,grant)=>{window.nativeCalls.push({grant});installed=installed.map(e=>({...e,grantedPermissions:grant.permissions,grantedMatchPatterns:grant.matchPatterns}));return installed[0]},
removeExtension:async()=>{window.nativeCalls.push({removeExtension:true});installed=[]},
performExtensionAction:async(profileId,extensionId,tabId)=>window.nativeCalls.push({popup:{profileId,extensionId,tabId}}),closeExtensionPopup:async()=>{},
resolveExtensionPermissionPrompt:async(requestId,grant)=>window.nativeCalls.push({prompt:requestId,grant}),
};export const requireOptionalNativeModule=()=>window.fixtureNative?nativeModule:null;export const requireNativeView=()=>({tabId})=><div data-native-tab={tabId}>Native view adapter</div>;
export const useApplicationState=React.useState;
export const runClientEffect=effect=>Effect.runPromise(effect);import {Effect} from 'effect';
`
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Screen from './screens/browser';import {NativeBrowserProvider} from './browser/native-browser';import {useMobilePreferences} from './runtime/preferences/app-preferences';import {saveRuntimeDraft} from './tasks/draft/use-draft';window.saveRuntimeDraft=saveRuntimeDraft;function FixtureShell(){const prefs=useMobilePreferences();const [visible,setVisible]=React.useState(true);window.showBrowser=setVisible;return <NativeBrowserProvider enabled={prefs.browserWorkspaceEnabled}>{visible?<Screen/>:<div>Thread fixture</div>}</NativeBrowserProvider>}createRoot(document.getElementById('app')).render(<FixtureShell/>);`,
    resolveDir: mobile,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'native-adapters',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const p = args.path
          if (
            p === './use-preview-active' ||
            p === './screenshot-attachment' ||
            p === '../../screens/device-host-form' ||
            p === '@dovo/protocol/browser-viewer' ||
            p === 'expo' ||
            p === 'react-native' ||
            p === 'react-native-webview' ||
            p === 'expo-router' ||
            p === 'expo-clipboard' ||
            p === 'expo-crypto' ||
            p === '@react-native-async-storage/async-storage' ||
            p === '@dovo/client-runtime' ||
            /\/(?:ui\/|shell\/navigation|runtime\/connection\/provider|runtime\/preferences\/app-preferences|runtime\/state\/application-state|tasks\/preview\/use-preview-active)/.test(
              p,
            )
          )
            return { path: 'adapters', namespace: 'fixture' }
        })
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: adapters,
          loader: 'tsx',
          resolveDir: mobile,
        }))
        b.onLoad({ filter: /tasks\/draft\/use-draft\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').split('export function useDraft(')[0],
          loader: 'ts',
          resolveDir: mobile + 'tasks/draft',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.error(e.message)
  })
  await page.route('http://mobile.fixture/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<html><head><style>*{box-sizing:border-box}body{margin:0;background:#111827;color:#eef2ff;font:14px system-ui}button,input,select{font:inherit;color:inherit;background:#243247;border:1px solid #607089;border-radius:6px;padding:8px;max-width:100%}button{cursor:pointer}label{display:block}input,select{width:100%}iframe{width:100%;min-height:120px;background:white;border:0;flex:1}section{position:fixed;inset:30px 8px;background:#172235;padding:16px;overflow:auto;border:1px solid #607089;border-radius:12px}section button{margin:4px}h1{margin:8px;font-size:22px}</style></head><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://mobile.fixture/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  page.setDefaultTimeout(7000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const state = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')))
  await page.getByText('Experimental Browser is off.').waitFor()
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  assert.equal(await page.locator('iframe').count(), 0)
  await page.evaluate(() => window.setExperimental(true))
  await button('Tabs (1)').waitFor()
  const address = page.getByLabel('Search or enter address', { exact: true })
  await address.fill('http://192.168.1.7:3000/dev')
  await button('Go').click()
  await page.locator('iframe').waitFor()
  assert.equal(await page.locator('iframe').getAttribute('data-url'), 'http://192.168.1.7:3000/dev')
  await button('Star page').click()
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).bookmarks.length === 1,
  )
  await page.locator('iframe').evaluate((frame) => {
    const d = frame.contentDocument
    const range = d.createRange()
    range.selectNodeContents(d.getElementById('selection'))
    const s = frame.contentWindow.getSelection()
    s.removeAllRanges()
    s.addRange(range)
  })
  await button('Copy selection').click()
  await page.waitForFunction(() => window.copied !== null)
  assert.equal(await page.evaluate(() => window.copied), '  Keep  spaces\nSecond line ')
  await page.evaluate(() => window.saveRuntimeDraft('mac', 'target', 'Existing phone edits'))
  await button('Add selection to thread').click()
  await button('Destination · Mac computer').click()
  await page.waitForFunction(() => window.navigation.length === 1)
  assert.match(
    await page.evaluate(() => localStorage.getItem('dovo.draft.mac.target')),
    /^Existing phone edits[\s\S]*Keep  spaces\n> Second line/,
  )
  assert.equal(await page.evaluate(() => localStorage.getItem('dovo.draft.lan.target')), null)
  await button('Add page to thread').click()
  await page.evaluate(() => (window.failDraft = true))
  await button('Destination · LAN computer').click()
  await page.getByText(/quote may already be in the composer/).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.navigation.length), 1)
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.storage === 'dovo.draft.lan.target').length,
    ),
    1,
  )
  await page.evaluate(() => (window.failDraft = false))
  await page.evaluate(() => window.webError())
  await page.getByText('Fixture page failed').waitFor()
  await address.fill('useful browser search')
  await button('Go').click()
  assert.match((await state()).tabs[0].url, /google.com\/search\?q=useful/)
  await button('Tabs (1)').click()
  await page.getByLabel('Computer for new tab').selectOption('lan')
  await button('New tab').click()
  await page.getByLabel('Profile for this tab').selectOption('work')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Keyboard' && !button.disabled,
    ),
  )
  await page.getByLabel('Preview URL', { exact: true }).fill('http://localhost:4000')
  await button('Go to address').click()
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    const tab = s.tabs.find((t) => t.id === s.active)
    return tab.url === 'http://localhost:4000/' && tab.title === 'Remote page'
  })
  await button('Tabs (2)').click()
  await page.getByLabel('Computer for new tab').selectOption('mac')
  await button('New tab').click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Keyboard' && !button.disabled,
    ),
  )
  await page.getByLabel('Preview URL', { exact: true }).fill('http://localhost:5000')
  await button('Go to address').click()
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    const tab = s.tabs.find((t) => t.id === s.active)
    return tab.url === 'http://localhost:5000/' && tab.title === 'Remote page'
  })
  const remoteState = await state()
  assert.equal(remoteState.tabs.find((t) => t.id === remoteState.active).runtimeId, 'mac')
  await button('Tabs (3)').click()
  const opens = page.getByRole('button', { name: /^Open / })
  assert.match(await opens.first().getAttribute('aria-label'), /Remote page/)
  assert.equal(
    remoteState.tabs.toSorted((a, b) => b.visitedAt - a.visitedAt)[0].id,
    remoteState.active,
  )
  const lanTab = () =>
    page
      .getByRole('button', { name: 'Open Remote page', exact: true })
      .filter({ hasText: 'LAN computer · work' })
  await lanTab().click()
  assert.equal(
    (await state()).tabs.find((t) => t.kind === 'remote' && t.profileId === 'work').runtimeId,
    'lan',
  )
  assert.equal(
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
      return s.tabs.find((t) => t.id === s.active).profileId
    }),
    'work',
  )
  await button('Tabs (3)').click()
  await lanTab()
    .locator('..')
    .getByRole('button', { name: 'Close Remote page', exact: true })
    .click()
  await page.getByRole('button', { name: 'Dismiss sheet' }).click()
  await button('Bookmarks and history').click()
  await button('Reopen last closed tab').click()
  assert.equal(
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
      return s.tabs.find((t) => t.id === s.active).profileId
    }),
    'work',
  )
  await button('Bookmarks and history').click()
  await page.getByLabel('Search browser pages').fill('192.168')
  assert.ok(await page.getByRole('button', { name: /Open http:\/\/192/ }).count())
  await page
    .getByRole('button', { name: /Open http:\/\/192/ })
    .first()
    .click()
  assert.equal(await page.locator('iframe').getAttribute('data-url'), 'http://192.168.1.7:3000/dev')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.length === 4,
  )
  assert.equal((await state()).tabs.length, 4)
  assert.ok((await state()).history.length >= 3)
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((c) => c.path?.includes('workspace') || c.path?.includes('send')),
    ),
    false,
  )
  const beforeReload = await state()
  await page.reload()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  await page.evaluate(() => window.setExperimental(true))
  await button('Tabs (4)')
    .waitFor({ timeout: 5000 })
    .catch(async (e) => {
      console.error(await page.locator('body').innerText())
      throw e
    })
  assert.deepEqual((await state()).tabs, beforeReload.tabs)
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path?.endsWith('/open')).length),
    0,
  )
  mkdirSync(root + 'work/mobile-shared-browser', { recursive: true })
  await page.screenshot({ path: root + 'work/mobile-shared-browser/narrow.png' })
  await button('Bookmarks and history').click()
  await page.screenshot({ path: root + 'work/mobile-shared-browser/narrow-library.png' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('button', { name: 'Dismiss sheet' }).click()
  const callCount = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => window.setExperimental(false))
  await page.getByText('Experimental Browser is off.').waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(await page.evaluate(() => window.calls.length), callCount)
  assert.deepEqual(errors, [])
  // Separate optional-native case: proves UI contracts only, never a real WebKit engine.
  const nativePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  nativePage.on('pageerror', (error) => errors.push(error.message))
  await nativePage.route('http://mobile.fixture/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="app"></div></body></html>',
    }),
  )
  await nativePage.goto('http://mobile.fixture/')
  await nativePage.evaluate(() => (window.fixtureNative = true))
  await nativePage.addScriptTag({ content: built.outputFiles[0].text })
  const nativeButton = (name) => nativePage.getByRole('button', { name, exact: true })
  await nativePage.getByText('Experimental Browser is off.').waitFor()
  assert.deepEqual(await nativePage.evaluate(() => window.nativeCalls), [])
  await nativePage.evaluate(() => window.setExperimental(true))
  await nativePage.locator('[data-native-tab]').waitFor()
  await nativeButton('Browser options').click()
  await nativePage.getByText('Engine limitations', { exact: true }).waitFor()
  await nativePage.getByText('No public arbitrary-tab capture API.', { exact: true }).waitFor()
  await nativePage
    .getByText(/sharing an arbitrary browser tab and its audio is unsupported/)
    .waitFor()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  assert.equal(await nativePage.getByText('Engine limitations', { exact: true }).count(), 0)
  const originalTab = await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab')
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/native')
  await nativeButton('Go').click()
  const openedBeforeThread = await nativePage.evaluate(
    () => window.nativeCalls.filter((c) => c.open).length,
  )
  await nativePage.evaluate(() => window.showBrowser(false))
  await nativePage.getByText('Thread fixture', { exact: true }).waitFor()
  assert.equal(await nativePage.locator('[data-native-tab]').count(), 0)
  assert.equal(
    await nativePage.evaluate(() => window.nativeCalls.some((c) => c.enabled === false)),
    false,
  )
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabCreated', {
      tabId: 'worker-tab',
      instanceId: 'worker-instance',
      profileId: 'device',
      url: 'http://localhost:3000/worker',
      title: 'Worker tab',
      reason: 'extension',
      openerTabId: null,
      loadState: 'loaded',
      progress: 1,
      canGoBack: false,
      canGoForward: false,
      secure: false,
      error: null,
    }),
  )
  await nativePage.evaluate(() => window.showBrowser(true))
  await nativePage.locator('[data-native-tab]').waitFor()
  await nativeButton('Tabs (2)').waitFor()
  assert.equal(
    await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab'),
    originalTab,
  )
  await nativePage.evaluate(() => window.showBrowser(false))
  await nativePage.getByText('Thread fixture', { exact: true }).waitFor()
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabClosed', {
      tabId: 'worker-tab',
      instanceId: 'worker-instance',
      profileId: 'device',
    }),
  )
  await nativePage.evaluate(() => window.showBrowser(true))
  await nativeButton('Tabs (1)').waitFor()
  await nativePage.locator('[data-native-tab]').waitFor()
  assert.equal(
    await nativePage.evaluate(() => window.nativeCalls.filter((c) => c.open).length),
    openedBeforeThread,
  )
  await nativePage.getByLabel('New local profile ID').fill('Work_1')
  await nativeButton('Use new local profile').click()
  await nativePage.waitForFunction(() =>
    window.nativeCalls.some((c) => c.open?.profileId === 'Work_1'),
  )
  await nativePage.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    return s.tabs.length === 1 && s.tabs[0].profileId === 'Work_1'
  })
  await nativeButton('Copy selection').click()
  await nativePage.waitForFunction(() => window.copied !== null)
  assert.equal(await nativePage.evaluate(() => window.copied), '  Native exact\nselection ')
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabCreated', {
      tabId: 'popup',
      instanceId: 'popup-instance',
      profileId: 'Work_1',
      url: 'http://localhost:3000/popup',
      title: 'Native popup',
      reason: 'targetBlank',
      openerTabId: null,
      loadState: 'loaded',
      progress: 1,
      canGoBack: false,
      canGoForward: false,
      secure: false,
      error: null,
    }),
  )
  await nativeButton('Tabs (2)').waitFor()
  assert.equal(
    await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab'),
    originalTab,
  )
  await nativeButton('Tabs (2)').click()
  await nativePage.getByRole('button', { name: 'Open Native popup', exact: true }).click()
  await nativePage.locator('[data-native-tab="popup"]').waitFor()
  await nativeButton('Tabs (2)').click()
  await nativePage
    .getByRole('button', { name: 'Open Native page', exact: true })
    .filter({ hasText: 'http://localhost:3000/native' })
    .click()
  await nativePage.locator(`[data-native-tab="${originalTab}"]`).waitFor()
  assert.equal(
    await nativePage.evaluate(
      (id) => window.nativeCalls.filter((c) => c.open?.tabId === id).length,
      originalTab,
    ),
    2,
  )
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabClosed', {
      tabId: 'popup',
      instanceId: 'popup-instance',
      profileId: 'Work_1',
    }),
  )
  await nativeButton('Tabs (1)').waitFor()
  await nativePage.evaluate(
    (id) =>
      window.nativeEmit('onTabClosed', {
        tabId: id,
        instanceId: 'stale-instance',
        profileId: 'Work_1',
        reason: 'api',
      }),
    originalTab,
  )
  await nativePage.getByLabel('Local profile for this tab').selectOption('Work_1')
  assert.equal(
    await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab'),
    originalTab,
  )
  await nativeButton('Tabs (1)').waitFor()
  await nativePage.evaluate(() => (window.nativeFail = true))
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/fail')
  await nativeButton('Go').click()
  await nativePage.getByText('Native fixture navigation failed', { exact: true }).waitFor()
  await nativeButton('WebKit WebExtensions').click()
  await nativeButton('Choose extension folder').click()
  await nativePage.getByRole('dialog', { name: 'Review Fixture extension' }).waitFor()
  assert.equal(
    await nativePage
      .getByRole('checkbox', { name: 'tabs', exact: true })
      .getAttribute('aria-checked'),
    'false',
  )
  assert.equal(
    await nativePage.getByRole('checkbox', { name: 'nativeMessaging', exact: true }).count(),
    0,
  )
  await nativeButton('Cancel review').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.discard === 'stage'))
  assert.equal(await nativePage.evaluate(() => window.nativeCalls.some((c) => c.install)), false)
  await nativeButton('Choose extension folder').click()
  await nativePage.getByRole('checkbox', { name: 'tabs', exact: true }).click()
  await nativeButton('Install with selected grants').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.install))
  assert.deepEqual(
    await nativePage.evaluate(() => window.nativeCalls.find((c) => c.install).install.grant),
    { permissions: ['tabs'], matchPatterns: [] },
  )
  await nativeButton('Review permissions for Fixture extension').click()
  await nativePage.getByRole('checkbox', { name: 'tabs', exact: true }).click()
  await nativeButton('Save selected grants').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.grant && !c.prompt))
  assert.deepEqual(
    await nativePage.evaluate(() => window.nativeCalls.find((c) => c.grant && !c.prompt).grant),
    { permissions: [], matchPatterns: [] },
  )
  await nativePage
    .getByText('Permission changes apply on the next page load. Reload the page to apply them.', {
      exact: true,
    })
    .waitFor()
  await nativeButton('Open Fixture extension action').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.popup))
  await nativeButton('Disable Fixture extension').click()
  assert.equal(
    await nativePage.evaluate(() => window.nativeCalls.some((c) => 'extensionEnabled' in c)),
    false,
  )
  await nativeButton('Confirm extension change').click()
  await nativePage.waitForFunction(() =>
    window.nativeCalls.some((c) => c.extensionEnabled === false),
  )
  await nativeButton('Remove Fixture extension').click()
  assert.equal(
    await nativePage.evaluate(() => window.nativeCalls.some((c) => c.removeExtension)),
    false,
  )
  await nativeButton('Confirm extension change').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.removeExtension))
  await nativePage.evaluate(() =>
    window.nativeEmit('onExtensionPermissionPrompt', {
      requestId: 'request',
      profileId: 'Work_1',
      extensionId: 'ext',
      tabId: null,
      permissions: ['tabs'],
      matchPatterns: ['http://localhost/*'],
      urls: ['http://localhost/'],
    }),
  )
  await nativePage.getByRole('checkbox', { name: 'http://localhost/*', exact: true }).click()
  await nativeButton('Allow checked access').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.prompt))
  assert.deepEqual(
    await nativePage.evaluate(() => window.nativeCalls.find((c) => c.prompt).grant),
    { permissions: [], matchPatterns: ['http://localhost/*'] },
  )
  await nativePage.evaluate(() =>
    window.nativeEmit('onExtensionPermissionPrompt', {
      requestId: 'deny',
      profileId: 'Work_1',
      extensionId: 'ext',
      tabId: null,
      permissions: ['tabs'],
      matchPatterns: [],
      urls: [],
    }),
  )
  await nativePage
    .getByRole('dialog', { name: 'Extension requests more access' })
    .getByRole('button', { name: 'Dismiss sheet', exact: true })
    .click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.prompt === 'deny'))
  assert.deepEqual(
    await nativePage.evaluate(() => window.nativeCalls.find((c) => c.prompt === 'deny').grant),
    { permissions: [], matchPatterns: [] },
  )
  await nativePage.evaluate(() =>
    window.nativeEmit('onExtensionPermissionPrompt', {
      requestId: 'url-only',
      profileId: 'Work_1',
      extensionId: 'ext',
      tabId: null,
      permissions: [],
      matchPatterns: [],
      urls: ['http://localhost:3000/exact'],
    }),
  )
  await nativePage
    .getByRole('checkbox', { name: 'http://localhost:3000/exact', exact: true })
    .click()
  await nativeButton('Allow checked access').click()
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.prompt === 'url-only'))
  assert.deepEqual(
    await nativePage.evaluate(() => window.nativeCalls.find((c) => c.prompt === 'url-only').grant),
    { permissions: [], matchPatterns: ['http://localhost:3000/exact'] },
  )
  await nativePage.evaluate(() => window.setExperimental(false))
  await nativePage.waitForFunction(() => window.nativeCalls.some((c) => c.enabled === false))
  assert.equal(await nativePage.locator('[data-native-tab]').count(), 0)
  assert.deepEqual(errors, [])
  // An older binary must not reopen a saved named profile in its shared cookie session.
  await nativePage.reload()
  await nativePage.evaluate(() => (window.fixtureNative = false))
  await nativePage.addScriptTag({ content: built.outputFiles[0].text })
  await nativePage.evaluate(() => window.setExperimental(true))
  await nativePage.getByText(/This tab requires its native WebKit profile/).waitFor()
  assert.equal(await nativePage.locator('iframe').count(), 0)
  // A registered but unsupported module must use the baseline without calling setEnabled(true).
  await nativePage.reload()
  await nativePage.evaluate(() => {
    localStorage.clear()
    window.fixtureNative = true
    window.nativeBrowsing = false
  })
  await nativePage.addScriptTag({ content: built.outputFiles[0].text })
  await nativePage.evaluate(() => window.setExperimental(true))
  await nativePage.getByText(/one shared device session/).waitFor()
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/legacy')
  await nativeButton('Go').click()
  await nativePage.locator('iframe').waitFor()
  assert.equal(await nativePage.locator('[data-native-tab]').count(), 0)
  assert.deepEqual(await nativePage.evaluate(() => window.nativeCalls), [])
  assert.deepEqual(errors, [])
  await nativePage.close()
  console.log(
    'Mobile shared Browser UI checks passed; screenshots: work/mobile-shared-browser/{narrow,narrow-library}.png. Native engines not exercised.',
  )
} finally {
  await browser.close()
}
