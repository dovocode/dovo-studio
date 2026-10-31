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
export const Switch=({accessibilityLabel,value,onValueChange})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} onChange={event=>onValueChange(event.target.checked)}/>;
export const ScrollView=({children,style,contentContainerStyle})=><div style={{...css(style),overflow:'auto'}}><div style={{display:'flex',...css(contentContainerStyle)}}>{children}</div></div>;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityRole,accessibilityState})=><button role={accessibilityRole} aria-checked={accessibilityState?.checked} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const Text=({children,style,accessibilityRole})=><div role={accessibilityRole} style={css(style)}>{children}</div>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id} disabled={i.disabled}>{i.name}</option>)}</select></label>;
export const Field=({label,value,onChangeText,onSubmitEditing,onFocus,onBlur})=><label>{label}<input aria-label={label} value={value} onFocus={onFocus} onBlur={onBlur} onChange={e=>onChangeText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onSubmitEditing?.()}}/></label>;export const SearchField=Field;
export const Sheet=forwardRef(({title,children,onClose},ref)=>{useImperativeHandle(ref,()=>({dismiss:cb=>{onClose();cb?.()}}));return <section role="dialog" aria-label={title}><h2>{title}</h2><button aria-label="Dismiss sheet" onClick={onClose}>Done</button>{children}</section>});
export const ScreenHeader=({title,onBack})=><header><h1>{title}</h1>{onBack&&<button onClick={onBack}>Back</button>}</header>;
export const useTheme=()=>({mode:'dark',colors:{border:'#455063'},styles:{screen:{height:'100vh',display:'flex',flexDirection:'column'},content:{padding:12},muted:{color:'#b8c4d8'},error:{color:'#ff9999'},title:{fontWeight:'bold'}}});
export const router={push:path=>window.navigation.push(path)};
let prefs={browserProfiles:[{id:'default',name:'Default'},{id:'device',name:'Device'}],browserWorkspaceEnabled:false,browserAutoSettleMinutes:0,browserCloseSettledMinutes:0};const listeners=new Set();window.setCleanup=change=>{prefs={...prefs,...change};listeners.forEach(f=>f())};export const updateMobilePreferences=change=>window.setCleanup(change);window.setExperimental=value=>window.setCleanup({browserWorkspaceEnabled:value});export const useMobilePreferences=()=>useSyncExternalStore(f=>{listeners.add(f);return ()=>listeners.delete(f)},()=>prefs);
const profiles=[{id:'lan',name:'LAN computer'},{id:'mac',name:'Mac computer'}];
const scope=createContext('lan');export const RuntimeScope=({runtimeId,children})=><scope.Provider value={runtimeId}>{children}</scope.Provider>;
const overviews=profiles.map(profile=>({profile,connected:true,snapshot:{workspace:{tasks:[{id:'target',title:'Destination',messages:[],draft:'Server fallback'}]}}}));
const websiteProfilesByOwner={};const readRuntime=async(owner,path,body)=>{window.calls.push({owner:owner.id,path,body});if(path.endsWith('profiles/read')){if(window.holdProfileReads)await new Promise(resolve=>(window.profileResumes??=[]).push(resolve));return {profiles:websiteProfilesByOwner[owner.id]??[{id:'default',name:'Default'},{id:'work',name:'Work'}]}};if(path.endsWith('profiles/save')){websiteProfilesByOwner[owner.id]=body.profiles;return {profiles:body.profiles}};if(path.endsWith('selection'))return {text:'  remote exact\\ntext ',url:'http://localhost:4000',title:'Remote page'};return {ok:true,ticket:'fixture-ticket',tabId:body.tabId,profileId:body.profileId}};
export const useRuntime=()=>{const id=useContext(scope);return {activeId:id,snapshot:overviews.find(entry=>entry.profile.id===id)?.snapshot,connection:{address:'http://'+id+'.fixture',token:'paired'},profiles,overviews,readRuntime,readEffect:(path,body)=>Effect.tryPromise(()=>readRuntime(profiles.find(p=>p.id===id),path,body))}};export const useNavigation=()=>({navigate:(...args)=>window.navigation.push(args)});let previewActive=true;const focusListeners=new Set();window.setPreviewActive=value=>{previewActive=value;focusListeners.forEach(f=>f())};export const usePreviewActive=()=>useSyncExternalStore(f=>{focusListeners.add(f);return ()=>focusListeners.delete(f)},()=>previewActive);
export const WebView=forwardRef(({source,onMessage,onError},ref)=>{const frame=useRef();const owner=useContext(scope);useImperativeHandle(ref,()=>({reload:()=>window.calls.push({reload:true}),goBack:()=>{},goForward:()=>{},injectJavaScript:code=>frame.current.contentWindow.eval(code)}));window.webError=()=>onError?.({nativeEvent:{description:'Fixture page failed'}});return <iframe title={source.html?'Remote page':'Device page'} ref={frame} data-url={source.uri} onLoad={()=>{const w=frame.current.contentWindow;w.ReactNativeWebView={postMessage:data=>onMessage({nativeEvent:{data}})};if(source.html){let url='about:blank';const emit=m=>w.ReactNativeWebView.postMessage(JSON.stringify({channel:'dovo-browser',...m}));const state=()=>emit({type:'state',url,title:'Remote page',back:false,forward:false,loading:false,editable:false});w.addEventListener('message',e=>{const m=e.data;if(m.type==='connect'){const call=window.calls.findLast(c=>c.owner===owner&&c.path?.endsWith('/open'));url=call?.body.url||'about:blank';emit({type:'connection',online:true});state()}if(m.type==='input'&&m.input.type==='navigate'){url=m.input.url;setTimeout(state,25)}});emit({type:'ready'})}}} srcDoc={source.html?'Remote viewer fixture':'<title>Local fixture</title><pre id="selection">  Keep  spaces\\nSecond line </pre>'}/>});
export const Glass=View;export const Icon=()=>null;export const IconButton=Action;export const TextInput=({accessibilityLabel,value,onChangeText,onSubmitEditing,onFocus,onBlur,style})=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onSubmitEditing?.()}} onFocus={onFocus} onBlur={onBlur} style={css(style)}/>;export const Keyboard={dismiss:()=>{}};export const KeyboardAvoidingView=View;export const Platform={OS:'ios'};export const Share={share:async value=>window.calls.push({share:value})};export const StyleSheet={hairlineWidth:1};export const AppState={currentState:'active'};export const Alert={alert:(...args)=>window.calls.push({alert:args})};export const useOpenAppLink=()=>()=>{throw Error('Unexpected external navigation')};export const remoteBrowserHtml='fixture';export const deviceHostMessage=message=>message;export const useScreenshotAttachment=()=>{throw Error('Shared browser must not create screenshot attachment')};
window.nativeCalls=[];const nativeListeners=new Map(),nativeTabs=new Map(),nativeProfiles=new Set(['device']);let nativeEnabled=false;let nativeInstance=0;
const emit=(name,event)=>{for(const f of nativeListeners.get(name)||[])f(event)};window.nativeEmit=(name,page)=>{if(name==='onTabCreated')nativeTabs.set(page.tabId,page);if(name==='onTabClosed'&&nativeTabs.get(page.tabId)?.instanceId===page.instanceId)nativeTabs.delete(page.tabId);emit(name,page)};
const nativeStatus=()=>({enabled:nativeEnabled,browsingAvailable:window.nativeBrowsing!==false,websiteTabCaptureAvailable:false,websiteTabCaptureUnavailableReason:'No public arbitrary-tab capture API.',systemVersion:'mock',maxTabs:100,profiles:[...nativeProfiles].map(profileId=>({profileId,dataStoreIdentifier:profileId})),tabs:[...nativeTabs.values()]});
const nativeModule={
addListener:(name,f)=>{const listeners=nativeListeners.get(name)||new Set();nativeListeners.set(name,listeners);listeners.add(f);return {remove:()=>listeners.delete(f)}},
setEnabled:async enabled=>{window.nativeCalls.push({enabled});nativeEnabled=enabled;if(!enabled)nativeTabs.clear();return nativeStatus()},getStatus:async()=>nativeStatus(),getActiveMediaTabIds:async()=>window.activeMedia||[],
setWebsiteCustomizationScripts:async(profileId,scripts)=>window.nativeCalls.push({websiteProfile:profileId,websiteScripts:scripts}),
ensureProfile:async profileId=>{nativeProfiles.add(profileId);return {profileId,dataStoreIdentifier:profileId}},
openTab:async options=>{window.nativeCalls.push({open:options});if(nativeTabs.has(options.tabId)){const existing=nativeTabs.get(options.tabId);if(existing.profileId===options.profileId)return existing;throw Error('Native fixture profile conflict')};const page={...options,instanceId:'instance-'+(++nativeInstance),openerTabId:null,url:options.url||'about:blank',title:'Native page',loadState:'loaded',progress:1,canGoBack:false,canGoForward:false,secure:false,error:null};nativeTabs.set(page.tabId,page);emit('onTabCreated',{...page,reason:'api'});return page},
activateTab:async tabId=>{window.nativeCalls.push({activate:tabId})},
closeTab:async tabId=>{const tab=nativeTabs.get(tabId);nativeTabs.delete(tabId);if(tab)setTimeout(()=>emit('onTabClosed',{...tab,reason:'api'}),20)},
navigate:async(tabId,url)=>{if(window.nativeFail)throw Error('Native fixture navigation failed');const tab={...nativeTabs.get(tabId),url,title:'Native page'};nativeTabs.set(tabId,tab);emit('onTabUpdated',tab)},
reload:async tabId=>window.nativeCalls.push({reload:tabId}),goBack:async()=>{},goForward:async()=>{},getSelection:async()=>({text:'  Native exact\\nselection ',truncated:false}),
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
        // Download transport and OS sharing are native boundaries, outside this fixture.
        b.onResolve({ filter: /^\.\/browser-download$/ }, ({ importer }) =>
          importer === mobile + 'tasks/preview/remote-browser.tsx'
            ? { path: 'browser-download', namespace: 'native-download-fixture' }
            : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'native-download-fixture' }, () => ({
          contents: `export const shareBrowserDownload=async()=>{throw new Error('Unexpected native download in shared browser fixture')};`,
        }))
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
        b.onLoad({ filter: /tasks\/detail\/task-detail\.tsx$/ }, () => ({
          loader: 'tsx',
          resolveDir: mobile,
          contents: `import {useRuntime} from '../runtime/connection/provider';export function TaskDetail({task,parentNavigation}){const runtime=useRuntime();return <div data-testid="tab-thread" data-task={task.id}>{parentNavigation}{task.title}</div>}`,
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
  await page
    .locator('iframe')
    .evaluate((frame) => (frame.contentWindow.retainedDraft = 'Unsubmitted form'))
  await page.evaluate(() => window.setPreviewActive(false))
  assert.equal(
    await page.locator('iframe').evaluate((frame) => frame.contentWindow.retainedDraft),
    'Unsubmitted form',
  )
  await page.evaluate(() => window.setPreviewActive(true))
  assert.equal(
    await page.locator('iframe').evaluate((frame) => frame.contentWindow.retainedDraft),
    'Unsubmitted form',
    'Backgrounding retains the live fallback page',
  )
  await button('Page actions').click()
  await button('Bookmark page').click()
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
  await button('Page actions').click()
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
  await button('Browser options').click()
  await page.getByLabel('Default search engine', { exact: true }).selectOption('duckduckgo')
  await button('Save search engine').click()
  await button('Save search engine').waitFor({ state: 'detached' })
  await button('Dismiss sheet').click()
  await address.fill('café & tabs')
  await button('Go').click()
  assert.equal((await state()).tabs[0].url, 'https://duckduckgo.com/?q=caf%C3%A9%20%26%20tabs')
  await button('Browser options').click()
  await page.getByLabel('Default search engine', { exact: true }).selectOption('custom')
  await page.getByLabel('Search URL', { exact: true }).fill('https://example.com/no-placeholder')
  assert.equal(await button('Save search engine').isDisabled(), true)
  await page.getByLabel('Search URL', { exact: true }).fill('http://search.lan/find?q=%s')
  await button('Save search engine').click()
  await button('Save search engine').waitFor({ state: 'detached' })
  await button('Dismiss sheet').click()
  await address.fill('a&b')
  await button('Go').click()
  assert.equal((await state()).tabs[0].url, 'http://search.lan/find?q=a%26b')
  await button('Tabs (1)').click()
  await page.getByLabel('Computer for new tab').selectOption('lan')
  await page.evaluate(() => (window.holdProfileReads = true))
  await button('New tab').click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Keyboard' && !button.disabled,
    ),
  )
  await page.getByLabel('Preview URL', { exact: true }).fill('wait for my configured provider')
  await button('Go to address').click()
  assert.match(
    await page.evaluate(() => window.calls.filter((call) => call.alert).at(-1).alert[1]),
    /profiles are still loading/,
  )
  assert.ok(!(await state()).tabs.some((tab) => tab.url.includes('wait%20for%20my')))
  await page.evaluate(() => {
    window.holdProfileReads = false
    for (const resume of window.profileResumes ?? []) resume()
  })
  await button('Browser options').click()
  await page.getByLabel('Profile for this tab').selectOption('work')
  await page.getByLabel('Default search engine', { exact: true }).selectOption('kagi')
  await button('Save search engine').click()
  await button('Save search engine').waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path?.endsWith('profiles/save')).at(-1).owner,
    ),
    'lan',
  )
  await page.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Keyboard' && !button.disabled,
    ),
  )
  await page.getByLabel('Preview URL', { exact: true }).fill('remote search')
  await button('Go to address').click()
  await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    return (
      state.tabs.find((tab) => tab.id === state.active).url ===
      'https://kagi.com/search?q=remote%20search'
    )
  })
  await page.getByLabel('Preview URL', { exact: true }).fill('http://localhost:4000')
  await button('Go to address').click()
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    const tab = s.tabs.find((t) => t.id === s.active)
    return tab.url === 'http://localhost:4000/' && tab.title === 'Remote page'
  })
  await page
    .locator('iframe')
    .evaluate((frame) => (frame.contentWindow.retainedViewer = 'Same viewer'))
  await page.evaluate(() => window.setPreviewActive(false))
  await page.evaluate(() => window.setPreviewActive(true))
  assert.equal(
    await page.locator('iframe').evaluate((frame) => frame.contentWindow.retainedViewer),
    'Same viewer',
    'Route focus changes retain the remote viewer while refreshing its ticket',
  )
  await button('Page actions').click()
  await button('Thread for this tab').click()
  assert.equal(
    await button('Destination · Mac computer').count(),
    0,
    'Remote tabs only link threads on their owner',
  )
  await button('Destination · LAN computer').click()
  await page.getByTestId('tab-thread').waitFor()
  await page.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
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
  await button('Browser options').click()
  await button('History').click()
  await button('Reopen last closed tab').click()
  assert.equal(
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
      return s.tabs.find((t) => t.id === s.active).profileId
    }),
    'work',
  )
  await button('Bookmarks').click()
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
  await button('Bookmarks').click()
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
  await nativePage.getByText(/Sharing another browser tab and its audio is unavailable/).waitFor()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  assert.equal(await nativePage.getByText('Engine limitations', { exact: true }).count(), 0)
  const originalTab = await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab')
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/native')
  await nativeButton('Go').click()
  const opensBeforeFocus = await nativePage.evaluate(
    () => window.nativeCalls.filter((c) => c.open).length,
  )
  await nativePage.evaluate(() => window.setPreviewActive(false))
  await nativePage.locator('[data-native-tab]').waitFor({ state: 'hidden' })
  await nativePage.evaluate(() => window.setPreviewActive(true))
  await nativePage.locator('[data-native-tab]').waitFor()
  assert.equal(
    await nativePage.evaluate(() => window.nativeCalls.filter((c) => c.open).length),
    opensBeforeFocus,
    'Native focus resumes the live page without reopening',
  )
  const openedBeforeThread = await nativePage.evaluate(
    () => window.nativeCalls.filter((c) => c.open).length,
  )
  await nativePage.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click()
  assert.deepEqual(await nativePage.evaluate(() => window.navigation.at(-1)), ['tasks'])
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
      reason: 'windowOpen',
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
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabUpdated', {
      tabId: 'worker-tab',
      instanceId: 'worker-instance',
      profileId: 'device',
      url: 'http://localhost:3000/worker',
      title: 'Failed background page',
      canGoBack: false,
      canGoForward: false,
      error: 'Background page failed',
    }),
  )
  await nativePage.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.some(
      (tab) => tab.title === 'Failed background page',
    ),
  )
  assert.equal(await nativePage.getByText('Background page failed', { exact: true }).count(), 0)
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
  assert.equal(await nativePage.getByLabel('New local profile ID').count(), 0)
  await nativeButton('Browser options').click()
  await nativePage.getByLabel('New local profile ID').fill('Work_1')
  await nativeButton('Use new local profile').click()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  await nativePage.waitForFunction(() =>
    window.nativeCalls.some((c) => c.open?.profileId === 'Work_1'),
  )
  await nativePage.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('dovo.mobile-browser.v1'))
    return s.tabs.length === 1 && s.tabs[0].profileId === 'Work_1'
  })
  await nativeButton('Page actions').click()
  await nativeButton('Copy selection').click()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
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
  // Target-blank links preview the existing native child. Keeping it must not reopen it.
  await nativePage.evaluate(
    (openerTabId) =>
      window.nativeEmit('onTabCreated', {
        tabId: 'link-preview',
        instanceId: 'link-instance',
        profileId: 'Work_1',
        openerTabId,
        url: 'http://localhost:3000/quick',
        title: 'Quick link',
        reason: 'targetBlank',
        loadState: 'loaded',
        progress: 1,
        canGoBack: false,
        canGoForward: false,
        secure: false,
        error: null,
      }),
    originalTab,
  )
  await nativeButton('Keep as tab').waitFor()
  await nativePage.locator('[data-native-tab="link-preview"]').waitFor()
  assert.equal(
    await nativePage.evaluate(
      () => JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.length,
    ),
    1,
  )
  const previewOpens = await nativePage.evaluate(
    () => window.nativeCalls.filter((call) => call.open?.tabId === 'link-preview').length,
  )
  await nativeButton('Keep as tab').click()
  await nativeButton('Tabs (2)').waitFor()
  assert.equal(
    await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab'),
    'link-preview',
  )
  assert.equal(
    await nativePage.evaluate(
      () => window.nativeCalls.filter((call) => call.open?.tabId === 'link-preview').length,
    ),
    previewOpens,
  )
  await nativePage.evaluate(() =>
    window.nativeEmit('onTabClosed', {
      tabId: 'link-preview',
      instanceId: 'link-instance',
      profileId: 'Work_1',
      reason: 'page',
    }),
  )
  await nativeButton('Tabs (1)').waitFor()
  await nativePage.locator(`[data-native-tab="${originalTab}"]`).waitFor()
  await nativePage.evaluate(
    (openerTabId) =>
      window.nativeEmit('onTabCreated', {
        tabId: 'dismiss-preview',
        instanceId: 'dismiss-instance',
        profileId: 'Work_1',
        openerTabId,
        url: 'http://localhost:3000/discard',
        title: 'Discard',
        reason: 'windowOpen',
        loadState: 'loaded',
        progress: 1,
        canGoBack: false,
        canGoForward: false,
        secure: false,
        error: null,
      }),
    originalTab,
  )
  await nativeButton('Close preview').click()
  await nativePage.locator(`[data-native-tab="${originalTab}"]`).waitFor()
  assert.equal(await nativeButton('Keep as tab').count(), 0)
  assert.equal(
    await nativePage.evaluate(() =>
      JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).closed.some(
        (tab) => tab.id === 'dismiss-preview',
      ),
    ),
    false,
  )
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
  await nativeButton('Browser options').click()
  await nativePage.getByLabel('Local profile for this tab').selectOption('Work_1')
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  assert.equal(
    await nativePage.locator('[data-native-tab]').getAttribute('data-native-tab'),
    originalTab,
  )
  await nativeButton('Tabs (1)').waitFor()
  const opensBeforeSettle = await nativePage.evaluate(
    (id) => window.nativeCalls.filter((c) => c.open?.tabId === id).length,
    originalTab,
  )
  await nativeButton('Browser options').click()
  await nativeButton('Settle tab').click()
  await nativeButton('Tabs (2)').click()
  await nativePage.getByLabel('Tab category').selectOption('settled')
  const settledId = await nativePage.evaluate(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.find((t) => t.settledAt).id,
  )
  assert.equal(settledId, originalTab)
  await nativePage
    .getByRole('button', { name: /^Open / })
    .first()
    .click()
  await nativePage.locator('[data-native-tab="' + originalTab + '"]').waitFor()
  await nativeButton('Browser options').click()
  await nativeButton('Snooze for 1 hour').click()
  await nativeButton('Tabs (2)').click()
  await nativePage.getByLabel('Tab category').selectOption('snoozed')
  await nativePage
    .getByRole('button', { name: /^Open / })
    .first()
    .click()
  await nativePage.locator('[data-native-tab="' + originalTab + '"]').waitFor()
  assert.equal(
    await nativePage.evaluate(
      (id) => window.nativeCalls.filter((c) => c.open?.tabId === id).length,
      originalTab,
    ),
    opensBeforeSettle,
    'Restore keeps original native page',
  )
  // Close the blank fallback so the existing single-tab checks remain meaningful.
  await nativeButton('Tabs (2)').click()
  await nativePage.getByLabel('Tab category').selectOption('active')
  await nativePage.getByRole('button', { name: 'Close tab', exact: true }).click()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  await nativePage.evaluate(() => (window.nativeFail = true))
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/fail')
  await nativeButton('Go').click()
  await nativePage.getByText('Native fixture navigation failed', { exact: true }).waitFor()
  assert.equal(await nativeButton('WebKit WebExtensions').count(), 0)
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
  await nativeButton('Browser options').click()
  await nativePage.getByText(/one shared device session/).waitFor()
  await nativePage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  await nativePage
    .getByLabel('Search or enter address', { exact: true })
    .fill('http://localhost:3000/legacy')
  await nativeButton('Go').click()
  await nativePage.locator('iframe').waitFor()
  assert.equal(await nativePage.locator('[data-native-tab]').count(), 0)
  assert.deepEqual(await nativePage.evaluate(() => window.nativeCalls), [])
  assert.deepEqual(errors, [])
  await nativePage.close()
  const cleanupPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  cleanupPage.on('pageerror', (error) => errors.push(error.message))
  await cleanupPage.route('http://mobile.fixture/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await cleanupPage.goto('http://mobile.fixture/cleanup')
  await cleanupPage.clock.install({ time: new Date('2026-10-26T12:00:00Z') })
  await cleanupPage.evaluate(() => {
    window.fixtureNative = true
    window.activeMedia = ['media']
    const base = {
      kind: 'local',
      profileId: 'device',
      url: 'http://localhost/',
      title: 'Page',
      visitedAt: Date.now() - 600000,
      lastActiveAt: Date.now() - 600000,
    }
    localStorage.setItem(
      'dovo.mobile-browser.v1',
      JSON.stringify({
        version: 1,
        active: 'current',
        bookmarks: [],
        history: [],
        closed: [],
        tabs: [
          { ...base, id: 'current' },
          { ...base, id: 'unused' },
          { ...base, id: 'pinned', pinned: true },
          { ...base, id: 'media' },
        ],
      }),
    )
  })
  await cleanupPage.addScriptTag({ content: built.outputFiles[0].text })
  await cleanupPage.evaluate(() => window.setExperimental(true))
  await cleanupPage.locator('[data-native-tab="current"]').waitFor()
  await cleanupPage.getByRole('button', { name: 'Browser options', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Pin tab', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  const opensBeforePageClose = await cleanupPage.evaluate(
    () => window.nativeCalls.filter((c) => c.open).length,
  )
  await cleanupPage.evaluate(() =>
    window.nativeEmit('onTabClosed', {
      tabId: 'current',
      profileId: 'device',
      instanceId: 'instance-1',
      reason: 'page',
    }),
  )
  await cleanupPage.waitForFunction(
    (count) => window.nativeCalls.filter((c) => c.open).length === count + 1,
    opensBeforePageClose,
  )
  await cleanupPage.locator('[data-native-tab="current"]').waitFor()
  await cleanupPage.getByRole('button', { name: 'Browser options', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Unpin tab', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Dismiss sheet', exact: true }).click()
  await cleanupPage.clock.fastForward(120000)
  assert.equal(
    await cleanupPage.evaluate(() =>
      JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.some((t) => t.settledAt),
    ),
    false,
  )
  await cleanupPage.evaluate(() =>
    window.setCleanup({ browserAutoSettleMinutes: 1, browserCloseSettledMinutes: 1 }),
  )
  await cleanupPage.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.find((t) => t.id === 'unused')
        ?.settledAt,
  )
  await cleanupPage.clock.fastForward(60000)
  await cleanupPage.waitForFunction(
    () =>
      !JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')).tabs.some(
        (t) => t.id === 'unused',
      ),
  )
  const cleaned = await cleanupPage.evaluate(() =>
    JSON.parse(localStorage.getItem('dovo.mobile-browser.v1')),
  )
  assert.deepEqual(
    cleaned.tabs.map((t) => t.id),
    ['current', 'pinned', 'media'],
  )
  assert.equal(cleaned.closed[0].id, 'unused')
  await cleanupPage.getByRole('button', { name: 'Page actions', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Customize website', exact: true }).click()
  assert.equal(
    await cleanupPage.getByRole('button', { name: 'Customize with agent…', exact: true }).count(),
    0,
    'Device-local tabs cannot link to a computer-owned agent',
  )
  await cleanupPage.getByLabel('Website CSS', { exact: true }).fill('body { color: red; }')
  await cleanupPage.getByRole('button', { name: 'Save and reload', exact: true }).click()
  await cleanupPage.waitForFunction(() =>
    window.nativeCalls.some(
      (call) =>
        call.websiteProfile === 'device' &&
        call.websiteScripts.some((script) => script.includes('color: red')),
    ),
  )
  await cleanupPage.getByRole('button', { name: 'Page actions', exact: true }).click()
  await cleanupPage.getByRole('button', { name: 'Thread for this tab', exact: true }).click()
  await cleanupPage.getByText('Thread panels require a browser tab on a paired computer.').waitFor()
  assert.equal(
    await cleanupPage
      .getByRole('button', { name: 'Destination · Mac computer', exact: true })
      .count(),
    0,
  )
  await cleanupPage.close()
  console.log(
    'Mobile shared Browser UI checks passed; screenshots: work/mobile-shared-browser/{narrow,narrow-library}.png. Native engines not exercised.',
  )
} finally {
  await browser.close()
}
