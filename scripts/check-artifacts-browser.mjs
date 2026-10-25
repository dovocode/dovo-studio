import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const uiRoot = root + 'packages/studio-ui/src/'
const screenshotDirectory = process.env.DOVO_ARTIFACT_SCREENSHOTS
const css = readdirSync(root + 'apps/web/dist/client/assets')
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(root + 'apps/web/dist/client/assets/' + file, 'utf8'))
  .join('\n')
if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true })
async function prepareView(page, native = false) {
  page.setDefaultTimeout(10000)
  await page.setContent(
    `<html class="dark"><body style="${native ? 'margin:0;background:#0a0a0a;color:#e8e9ed;font-family:system-ui' : 'margin:0'}"><div id="app" style="height:100dvh"></div></body></html>`,
  )
  if (css && !native) await page.addStyleTag({ content: css })
}
async function checkGeneratedDownloads(page, frame, native) {
  let externalRequests = 0
  await page.route('https://artifact-download.invalid/**', (route) => {
    externalRequests++
    return route.abort()
  })
  await frame.locator('body').evaluate((body) => {
    for (const kind of ['blob', 'data', 'empty']) {
      const button = document.createElement('button')
      button.id = 'download-' + kind
      button.textContent = 'Download ' + kind
      button.onclick = () => {
        const anchor = document.createElement('a')
        const blob = new Blob([kind === 'empty' ? '' : 'name,value\nDovo,42\n'], {
          type: 'text/csv',
        })
        anchor.href =
          kind === 'data'
            ? 'data:text/csv;charset=utf-8,name%2Cvalue%0ADovo%2C42%0A'
            : URL.createObjectURL(blob)
        anchor.download = 'report-' + kind + '.csv'
        if (kind === 'data') body.append(anchor)
        anchor.click()
        if (kind !== 'data') URL.revokeObjectURL(anchor.href)
        anchor.remove()
      }
      body.append(button)
    }
    const link = document.createElement('a')
    link.id = 'download-link'
    link.href = 'data:text/csv,name%2Cvalue%0ADovo%2C42%0A'
    link.download = 'report-link.csv'
    link.textContent = 'Download link'
    body.append(link)
    const external = document.createElement('a')
    external.id = 'download-external'
    external.href = 'https://artifact-download.invalid/file.csv'
    external.download = 'external.csv'
    external.textContent = 'External download'
    body.append(external)
    fetch('https://artifact-download.invalid/leak').catch(() => {
      body.dataset.downloadNetworkBlocked = 'yes'
    })
  })
  await frame.locator('body[data-download-network-blocked="yes"]').waitFor()
  for (const kind of ['blob', 'data', 'empty', 'link']) {
    const expected = kind === 'empty' ? '' : 'name,value\nDovo,42\n'
    if (native) {
      const count = await page.evaluate(() => window.sharedArtifacts?.length ?? 0)
      await frame.locator('#download-' + kind).click()
      await page.waitForFunction((count) => window.sharedArtifacts?.length === count + 1, count)
      const result = await page.evaluate(() => window.sharedArtifacts.at(-1))
      assert.equal(result.options.dialogTitle, 'report-' + kind + '.csv')
      assert.equal(Buffer.from(result.data).toString(), expected)
      await page.waitForFunction((uri) => window.deletedArtifactFiles.includes(uri), result.uri)
    } else {
      const [result] = await Promise.all([
        page.waitForEvent('download'),
        frame.locator('#download-' + kind).click(),
      ])
      assert.equal(result.suggestedFilename(), 'report-' + kind + '.csv')
      assert.equal(readFileSync(await result.path()).toString(), expected)
    }
  }
  if (native) {
    const alerts = await page.evaluate(() => window.artifactAlerts?.length ?? 0)
    await frame.locator('body').evaluate((body) => {
      const button = document.createElement('button')
      button.id = 'download-too-large'
      button.textContent = 'Download too large'
      button.onclick = () => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(21 * 1024 * 1024)]))
        const anchor = document.createElement('a')
        anchor.download = 'large.bin'
        anchor.href = url
        anchor.click()
        URL.revokeObjectURL(url)
      }
      body.append(button)
    })
    await frame.locator('#download-too-large').click()
    await page.waitForFunction((count) => window.artifactAlerts?.length === count + 1, alerts)
    assert.match(await page.evaluate(() => window.artifactAlerts.at(-1)[1]), /20 MB/)
    await page.evaluate(() => {
      window.failGeneratedDownload = true
    })
    await frame.locator('#download-blob').click()
    await page.waitForFunction((count) => window.artifactAlerts?.length === count + 2, alerts)
    assert.match(await page.evaluate(() => window.artifactAlerts.at(-1)[1]), /Sharing failed/)
    await page.evaluate(() => {
      window.failGeneratedDownload = false
    })
    const count = await page.evaluate(() => window.sharedArtifacts.length)
    await frame.locator('#download-blob').click()
    await page.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
  }
  const blocked = page.waitForEvent('console', {
    predicate: (message) =>
      message.text().includes('artifact-download.invalid') && message.text().includes('frame-src'),
  })
  await frame.locator('#download-external').click()
  await blocked
  assert.equal(externalRequests, 0, 'Downloads do not grant external network access')
  await page.unroute('https://artifact-download.invalid/**')
}
const built = await build({
  stdin: {
    contents: `import {artifactPreviewHtml} from './src/conversation/artifacts.ts';window.preview=artifactPreviewHtml;`,
    resolveDir: new URL('../packages/protocol/', import.meta.url).pathname,
  },
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
})
const mocks = {
  '../../runtime/connection/account-context': `import {useSyncExternalStore} from 'react';window.sharingAccount={directory:{},deletionPending:false};window.setSharingAccount=account=>{window.sharingAccount=account;window.dispatchEvent(new Event('sharing-account'))};const subscribe=notify=>{window.addEventListener('sharing-account',notify);return()=>window.removeEventListener('sharing-account',notify)};export const useOptionalMobileAccount=()=>useSyncExternalStore(subscribe,()=>window.sharingAccount);`,
  // Encrypted publication is covered separately; keep local artifact scenarios account-free.
  './artifact-sharing':
    'export const ArtifactSharing=({artifact,onClose})=>onClose?<section role="dialog" aria-label="Share artifact"><p>{artifact.title} · Version {artifact.revision}</p><button onClick={onClose}>Close sharing</button></section>:null;',
  './artifact-shared-badge': 'export const ArtifactSharedBadge=()=>null;',
  './chat/artifact-shared-badge': 'export const ArtifactSharedBadge=()=>null;',
  '../ui/content/artifact-shared-badge': 'export const ArtifactSharedBadge=()=>null;',
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  'expo-router': `export const router={canGoBack:()=>!!window.artifactHistory,back:()=>window.artifactBackRoute=window.artifactHistory,replace:href=>window.artifactBackRoute=href};`,
  // Keep account/feed hooks real; these local-artifact scenarios have no account host.
  '@dovo/studio-core': `export {useAccount} from '${root}packages/studio-core/src/use-account.ts';export {useArtifactFeed} from '${root}packages/studio-core/src/use-artifact-feed.ts';export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes.ts';export const useAppPreferences=()=>({themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});import React,{createContext,useContext} from 'react';const Context=createContext(null);export const useResolvedTheme=()=> 'dark';export const useStudioHost=()=>({navigate:target=>window.artifactNavigation=target,taskNavigationGuard:()=>{const epoch=window.navigationEpoch;return ()=>epoch===window.navigationEpoch}});export const useWorkspace=()=>useContext(Context)??window.artifactWorkspace??({workspace:{tasks:[]},request:window.artifactRequest,connected:true,activeRuntimeId:'runtime',snapshot:{artifactsEnabled:window.artifactsEnabled}});export const WorkspaceScope=({profile,children})=><Context.Provider value={{...useWorkspace(),activeRuntimeId:profile.id,snapshot:{artifactsEnabled:true},request:(path,input)=>window.artifactRequest(path,input,profile.id)}}>{children}</Context.Provider>;`,
  '@dovo/studio-ui': `
import React from 'react';import {Button} from '${uiRoot}components/ui/button.tsx';
export {Button};export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {cn} from '${uiRoot}lib/utils.ts';
export {Input} from '${uiRoot}components/ui/input.tsx';
export {Textarea} from '${uiRoot}components/ui/textarea.tsx';
export {PageHeader} from '${uiRoot}page-header.tsx';
export {Dialog,DialogContent,DialogDescription,DialogTitle} from '${uiRoot}components/ui/dialog.tsx';
export {EmptyState} from '${uiRoot}components/empty-state.tsx';
export {ChoicePicker} from '${uiRoot}choice-picker.tsx';
export {MessageResponse} from '${uiRoot}components/ai-elements/message.tsx';
export const IconButton=({label,...props})=><Button variant="ghost" size="icon" aria-label={label} {...props}/>;
export const SidebarHeader=()=>null;export const useLeftSidebar=()=>[true,()=>{}];
export const Tooltip=({children})=><>{children}</>;export const TooltipTrigger=({children})=>children;export const TooltipContent=()=>null;
`,
  // Stable dependencies keep the real account hook from reloading on each fixture render.
  '../../runtime/connection/account-provider': `import {useAccount} from '@dovo/studio-core';const storage={read:async()=>null,write:async()=>{throw Error('Local artifact fixture has no account storage')}};const open=async url=>window.openedArtifactLinks.push(url);export const useMobileAccount=()=>useAccount(storage,open);`,
  '../../runtime/connection/provider': `import {useWorkspace} from '@dovo/studio-core';export const useRuntime=()=>{const value=useWorkspace();return {...value,read:value.request,activeId:value.activeRuntimeId}};`,
  'react-native': `
import React from 'react';
export const flatten=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
const webStyle=style=>{const value=flatten(style);if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';if(value.paddingHorizontal!==undefined){value.paddingLeft=value.paddingRight=value.paddingHorizontal;delete value.paddingHorizontal}if(value.paddingVertical!==undefined){value.paddingTop=value.paddingBottom=value.paddingVertical;delete value.paddingVertical}if(value.marginVertical!==undefined){value.marginTop=value.marginBottom=value.marginVertical;delete value.marginVertical}return value};
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,...webStyle(style)}}>{children}</div>;
export const ScrollView=({children,style,contentContainerStyle,horizontal})=><View style={[{overflow:'auto',flexShrink:1},style]}><View style={[horizontal?{flexDirection:'row'}:{},contentContainerStyle]}>{children}</View></View>;
export const Modal=({children,visible=true})=>visible?<div role="dialog" style={{position:'fixed',inset:0,zIndex:100,background:'#0a0a0a',display:'flex',flexDirection:'column'}}>{children}</div>:null;export const ActivityIndicator=()=> <p>Loading</p>;export const Keyboard={dismiss(){}};
export const Pressable=({children,onPress,accessibilityLabel,accessibilityState,disabled,style})=><button onClick={onPress} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',backgroundColor:'transparent',border:0,padding:0,margin:0,color:'#e8e9ed',textAlign:'left',fontFamily:'system-ui',flexShrink:0,...webStyle(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} disabled={disabled} onChange={event=>onValueChange(event.target.checked)}/>;
export const Image=({source,style})=><img src={source.uri} style={webStyle(style)}/>;export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':accessibilityRole} style={webStyle(style)}>{children}</span>;
export const FlatList=({data,renderItem,ListHeaderComponent,ListEmptyComponent,contentContainerStyle})=><ScrollView contentContainerStyle={contentContainerStyle}>{ListHeaderComponent}{data.length?data.map((item,index)=><React.Fragment key={index}>{renderItem({item})}</React.Fragment>):ListEmptyComponent}</ScrollView>;
export const Linking={openURL:async url=>window.openedArtifactLinks.push(url)};export const Alert={alert:(...args)=>(window.artifactAlerts??=[]).push(args)};export const StyleSheet={create:x=>x,hairlineWidth:1};export const Platform={OS:'ios'};
`,
  'react-native-safe-area-context': `import {View} from 'react-native';export const SafeAreaProvider=({children})=><View style={{flex:1,minHeight:0}}>{children}</View>;export const SafeAreaView=View;`,
  'react-native-webview': `import React,{useEffect,useMemo,useRef} from 'react';export default ({source,onContentProcessDidTerminate,onRenderProcessGone,onMessage})=>{const frame=useRef(),callback=useRef(onMessage);callback.current=onMessage;const editor=source.html.includes('id="canvas"');const html=useMemo(()=>source.html.replace('<head>','<head><script>window.ReactNativeWebView={postMessage:data=>parent.postMessage({nativeArtifactMessage:data},"*")}</script>'),[source.html]);useEffect(()=>{if(!editor)window.mobilePreviewMounts=(window.mobilePreviewMounts||0)+1;const receive=event=>{if(event.source===frame.current?.contentWindow&&typeof event.data?.nativeArtifactMessage==='string')callback.current?.({nativeEvent:{data:event.data.nativeArtifactMessage}})};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[editor]);if(!editor){window.terminateMobilePreview=()=>onContentProcessDidTerminate?.();window.crashMobilePreview=()=>onRenderProcessGone?.()}return <iframe ref={frame} title={editor?'Export editor':'Mobile preview'} sandbox={editor?'allow-scripts allow-same-origin':'allow-scripts allow-downloads'} style={editor?{height:'100%',flex:1,border:0}:undefined} srcDoc={html}/>;};`,
  'expo-file-system': `export class File {constructor(path,name){this.uri='cache://'+name;this.exists=false}write(data){this.exists=true;(window.artifactFiles??={})[this.uri]=typeof data==='string'?data:Array.from(data)}delete(){this.exists=false;(window.deletedArtifactFiles??=[]).push(this.uri)}};export const Paths={cache:''};`,
  'expo-sharing': `export const isAvailableAsync=async()=>true;export const shareAsync=async(uri,options)=>{if(window.failGeneratedDownload)throw Error('Sharing failed');(window.sharedArtifacts??=[]).push({uri,options,data:window.artifactFiles[uri]})};`,
  'expo-crypto': `let id=0;export const randomUUID=()=> 'share-'+(++id);`,
  './text': `export {Text} from 'react-native';`,
  '../ui/content/text': `export {Text} from 'react-native';`,
  './markdown': `import React from 'react';export const Markdown=({text})=><p>{text}</p>;`,
  './open-link': `export const openAppLink=async url=>{window.openedArtifactLinks.push(url)};export const useOpenAppLink=()=>openAppLink;`,
  '../controls/action': `import React from 'react';export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`,
  '../controls/icon': `import {FileText,Files,CodeXml,Eye,Globe,ChevronRight,ArrowUpRight,History,Share2,RotateCw,X,Check,Ellipsis} from 'lucide-react';const icons={artifact:FileText,artifactList:Files,code:CodeXml,preview:Eye,web:Globe,next:ChevronRight,external:ArrowUpRight,history:History,share:Share2,refresh:RotateCw,close:X,check:Check,more:Ellipsis};export const Icon=({name,size=20,color='#a0a1a8'})=>{const Glyph=icons[name];return Glyph?<Glyph aria-hidden="true" size={size} color={color}/>:null};`,
  '../ui/controls/icon': `export {Icon} from '../controls/icon';`,
  '../controls/icon-button': `import React from 'react';import {Icon} from '../controls/icon';export const IconButton=({label,icon,onPress,disabled})=><button aria-label={label} data-icon={icon} disabled={disabled} onClick={onPress} style={{width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:0,opacity:disabled?0.4:1}}><Icon name={icon}/></button>;`,
  '../runtime/connection/provider': `import {useWorkspace,WorkspaceScope} from '@dovo/studio-core';export const useRuntime=()=>useWorkspace();export const RuntimeScope=({runtimeId,children})=><WorkspaceScope profile={window.artifactWorkspace.overviews.find(x=>x.profile.id===runtimeId).profile}>{children}</WorkspaceScope>;`,
  '../shell/navigation': `export const useNavigation=()=>({focused:true,navigate:(view,entityId,runtimeId)=>window.artifactNavigation={view,entityId,runtimeId}});`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title,subtitle,buttons,onBack})=><header>{onBack&&<button aria-label="Back" onClick={onBack}>Back</button>}<h1>{title}</h1><p>{subtitle}</p>{buttons.map(button=><button key={button.label} aria-label={button.label} aria-pressed={button.selected} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;`,
  '../ui/controls/field': `export const Field=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/></label>;export const SearchField=Field;`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  '../ui/controls/action': `export {Action} from '../controls/action';`,
  '../layout/sheet': `import {useImperativeHandle} from 'react';export const Sheet=({ref,title,children,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();queueMicrotask(()=>after?.())}}));return <div role="dialog" aria-label={title} style={{position:'fixed',inset:0,zIndex:100,background:'#101010',padding:20}}><h2>{title}</h2>{children}<button aria-label="Close artifact actions" onClick={onClose}>Close</button></div>};`,
}
mocks['../../shell/navigation'] = mocks['../shell/navigation']
mocks['../controls/choice'] = mocks['../ui/controls/choice']
mocks['../controls/field'] = mocks['../ui/controls/field']
const interfaces = await Promise.all(
  ['desktop', 'mobile', 'library', 'mobile-library'].map(async (platform) => {
    const contents =
      platform === 'library'
        ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import ArtifactsView from './src/artifacts-view.tsx';function App(){const[tick,setTick]=useState(0),[shown,setShown]=useState(true);window.updateLibrary=()=>setTick(x=>x+1);window.showLibrary=setShown;return shown?<ArtifactsView/>:null}createRoot(document.getElementById('app')).render(<App/>);`
        : platform === 'mobile-library'
          ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import ArtifactsScreen from './src/screens/artifacts.tsx';function App(){const[tick,setTick]=useState(0);window.updateLibrary=()=>setTick(x=>x+1);return <ArtifactsScreen/>}createRoot(document.getElementById('app')).render(<App/>);`
          : platform === 'desktop'
            ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {ThreadArtifacts,ArtifactCard} from './src/chat/artifacts.tsx';import {ArtifactOpenContext} from './src/chat/artifact-open-context.ts';import {TaskTools} from './src/detail/task-tools.tsx';function App(){const[surface,setSurface]=useState('chat'),[taskId,setTaskId]=useState('thread'),[selection,setSelection]=useState();window.switchArtifactThread=setTaskId;return <div style={{height:'100%',display:'flex'}}><div style={{flex:1,padding:24}}><ArtifactOpenContext value={reference=>{setSelection(previous=>({taskId:reference.taskId,id:reference.id,key:(previous?.key??0)+1}));setSurface('artifacts')}}><ArtifactCard reference={{id:'interactive',taskId,title:'Counter',format:'html',revision:1}}/></ArtifactOpenContext></div>{surface==='artifacts'&&<div style={{width:480,height:'100%'}}><ThreadArtifacts key={taskId+':'+selection?.key} taskId={taskId} initialId={selection?.taskId===taskId?selection.id:undefined} onClose={()=>{setSurface('chat');setSelection(undefined)}}/></div>}<TaskTools task={{id:taskId,status:'done'}} surface={surface} onSelect={setSurface} hasDiff={false} artifactsEnabled={window.artifactsEnabled}/></div>}createRoot(document.getElementById('app')).render(<App/>);`
            : `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {ArtifactCard} from './src/ui/content/artifacts.tsx';function App(){const [kind,setKind]=useState('notes');window.showInlineHtml=()=>setKind('interactive');window.showInlineFolder=()=>setKind('folder');return <ArtifactCard reference={kind==='folder'?{id:'folder',taskId:'thread',title:'Folder demo',format:'html',revision:2,fileCount:3}:kind==='interactive'?{id:'interactive',taskId:'thread',title:'Counter',format:'html',revision:1}:{id:'notes',taskId:'thread',title:'Notes',format:'markdown',revision:2}}/>}createRoot(document.getElementById('app')).render(<App/>);`
    const result = await build({
      stdin: {
        contents,
        loader: 'tsx',
        resolveDir: new URL(
          platform.startsWith('mobile') ? '../apps/mobile/' : '../packages/extension-tasks/',
          import.meta.url,
        ).pathname,
      },
      bundle: true,
      format: 'iife',
      write: false,
      target: 'es2022',
      jsx: 'automatic',
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        {
          name: 'artifact-fixtures',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixtures' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: new URL('../packages/studio-ui/', import.meta.url).pathname,
            }))
          },
        },
      ],
    })
    return { platform, code: result.outputFiles[0].text }
  }),
)
const browser = await chromium.launch({ headless: true })
const pageErrors = []
browser.on('page', (page) =>
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
    console.error(error.message)
  }),
)
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
  const requests = []
  const failures = []
  page.on('requestfailed', (request) =>
    failures.push({ url: request.url(), error: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/https?:/.test(request.url())) requests.push(request.url())
  })
  await page.setContent('<main>Trusted host</main>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const guest = `<button id="count">0</button><button id="navigate">Navigate</button><script>
let count=0;document.querySelector('#count').onclick=()=>document.querySelector('#count').textContent=++count;
document.querySelector('#navigate').onclick=()=>location.href='https://artifact-test.invalid/navigation';
try{parent.parent.document.querySelector('main').textContent='Compromised'}catch{document.body.dataset.isolated='yes'}
fetch('https://artifact-test.invalid/leak').catch(()=>document.body.dataset.networkBlocked='yes');
</script><img src="https://artifact-test.invalid/image"><iframe src="https://artifact-test.invalid/frame"></iframe>`
  await page.evaluate((content) => {
    const frame = document.createElement('iframe')
    frame.sandbox = 'allow-scripts allow-downloads'
    frame.srcdoc = window.preview(content)
    document.body.append(frame)
  }, guest)
  const frame = page.frameLocator('iframe').frameLocator('iframe')
  await frame.locator('#count').click()
  assert.equal(await frame.locator('#count').textContent(), '1')
  assert.equal(await page.locator('main').textContent(), 'Trusted host')
  assert.equal(await frame.locator('body').getAttribute('data-isolated'), 'yes')
  await frame.locator('body[data-network-blocked="yes"]').waitFor()
  const navigationBlocked = page.waitForEvent('console', {
    timeout: 5000,
    predicate: (message) =>
      message.text().includes('artifact-test.invalid') &&
      message.text().includes('frame-src about:'),
  })
  await frame.locator('#navigate').click()
  await navigationBlocked
  assert.ok(
    requests.every((url) =>
      failures.some((failure) => failure.url === url && /csp/i.test(failure.error ?? '')),
    ),
    JSON.stringify({ requests, failures }),
  )
  const themed = await browser.newPage()
  for (const theme of [
    {
      mode: 'dark',
      background: '#080808',
      foreground: '#ededed',
      surface: '#101010',
      border: '#282828',
      accent: '#7cc9ff',
    },
    {
      mode: 'light',
      background: '#f7f8fa',
      foreground: '#151515',
      surface: '#ffffff',
      border: '#dddddd',
      accent: '#0965b5',
    },
  ]) {
    const themedHtml = await page.evaluate(
      (theme) =>
        window.preview(
          '<h1>Preview heading</h1><button>Action</button><input placeholder="Name"><a href="#">Link</a>',
          theme,
        ),
      theme,
    )
    await themed.setContent(themedHtml)
    const themedFrame = themed.frameLocator('iframe')
    assert.equal(
      await themedFrame
        .locator('html')
        .evaluate((element) => getComputedStyle(element).colorScheme),
      theme.mode,
    )
    const outerBackground = await themed
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    assert.equal(
      await themedFrame
        .locator('html')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      outerBackground,
    )
    assert.equal(outerBackground, theme.mode === 'dark' ? 'rgb(8, 8, 8)' : 'rgb(247, 248, 250)')
    assert.equal(
      await themedFrame
        .getByRole('button', { name: 'Action' })
        .evaluate((element) => getComputedStyle(element).borderRadius),
      '8px',
    )
    assert.equal(
      await themedFrame
        .locator('body')
        .evaluate((element) => getComputedStyle(element).fontFamily.includes('system-ui')),
      true,
    )
  }
  await themed.setContent(
    await page.evaluate(() =>
      window.preview(
        '<style>body{background:#ffffff;color:#123456;font-family:Georgia}button{border-radius:0}</style><button>Custom</button>',
        {
          mode: 'dark',
          background: '#080808',
          foreground: '#ededed',
          surface: '#101010',
          border: '#282828',
          accent: '#7cc9ff',
        },
      ),
    ),
  )
  assert.equal(
    await themed
      .frameLocator('iframe')
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(255, 255, 255)',
  )
  assert.equal(
    await themed
      .frameLocator('iframe')
      .locator('body')
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(18, 52, 86)',
  )
  assert.equal(
    await themed
      .frameLocator('iframe')
      .getByRole('button', { name: 'Custom' })
      .evaluate((element) => getComputedStyle(element).borderRadius),
    '0px',
  )
  await themed.close()
  // Exercise the iOS shape: trusted WebView document directly hosts an opaque guest.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 700 } })
  const html = await page.evaluate(() =>
    window.preview(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>',
    ),
  )
  await mobile.setContent(html)
  await mobile.frameLocator('iframe').locator('circle').waitFor()
  assert.equal(await mobile.frameLocator('iframe').locator('circle').getAttribute('fill'), 'blue')
  for (const ui of interfaces.filter((ui) => !ui.platform.includes('library'))) {
    const view = await browser.newPage()
    await prepareView(view, ui.platform === 'mobile')
    await view.evaluate(() => {
      window.artifactsEnabled = true
      window.artifactCalls = []
      window.openedArtifactLinks = []
      window.artifactLinksOnly = false
      const notes = {
        id: 'notes',
        taskId: 'thread',
        title: 'Notes',
        format: 'markdown',
        revision: 2,
        createdAt: '2026-10-03T00:00:00Z',
        updatedAt: '2026-10-03T00:00:00Z',
      }
      const interactive = {
        ...notes,
        id: 'interactive',
        title: 'Counter',
        format: 'html',
        revision: 1,
      }
      const folder = {
        ...interactive,
        id: 'folder',
        title: 'Folder demo',
        fileCount: 3,
        entrypoint: 'index.html',
        revision: 2,
      }
      const folderFiles = [
        {
          path: 'index.html',
          content: '<button id="folder">0</button><script src="scripts/main.js"></script>',
        },
        {
          path: 'scripts/main.js',
          content:
            'document.querySelector("#folder").onclick=event=>event.target.textContent=Number(event.target.textContent)+1;',
        },
        { path: 'assets/logo.png', content: 'aW1hZ2U=', encoding: 'base64' },
      ]
      window.artifactRequest = async (path, input) => {
        window.artifactCalls.push({ path, input })
        if (path.endsWith('/html') || path.endsWith('/mhtml')) {
          if (window.failFolderExport) throw Error('Archive export failed')
          const mhtml = path.endsWith('/mhtml')
          return {
            name: 'Folder demo.' + (mhtml ? 'mhtml' : 'html'),
            mime: mhtml ? 'multipart/related' : 'text/html',
            data: btoa(
              mhtml
                ? 'MIME-Version: 1.0 Folder revision ' + input.revision
                : '<!doctype html><h1>Folder revision ' + input.revision + '</h1>',
            ),
          }
        }
        if (path.endsWith('/download'))
          return {
            name: 'Folder demo.zip',
            mime: 'application/zip',
            data: btoa('PK-Folder revision ' + input.revision),
          }
        if (path.endsWith('/export-preview')) {
          if (window.failEditorPreview) throw Error('Editor preparation failed')
          return {
            content:
              '<style>body{margin:16px;font-family:system-ui}section{padding:8px}</style><section id="keep"><h1>Editable export heading</h1><p>Keep this paragraph</p></section><section id="remove-me"><h2>Delete this section</h2></section><section id="exclude-me">Exclude this section</section><script>parent.editorGuestExecuted=true</script>',
          }
        }
        if (path.endsWith('/png')) {
          if (window.failArtifactPng) throw Error('PNG generation failed')
          return {
            name: 'Notes.png',
            mime: 'image/png',
            data: btoa('PNG revision ' + input.revision + ' width ' + input.width),
          }
        }
        if (path.endsWith('/pdf')) {
          if (window.failArtifactPdf) throw Error('PDF generation failed')
          return {
            name: 'Notes.pdf',
            mime: 'application/pdf',
            data: btoa('%PDF-1.7 Selected revision ' + input.revision),
          }
        }
        if (path.endsWith('/list'))
          return {
            artifacts: window.artifactLinksOnly ? [] : [notes, interactive, folder],
            links:
              input.taskId === 'thread'
                ? [
                    {
                      provider: 'claude',
                      title: 'Claude design',
                      url: 'https://claude.ai/code/artifact/design-id',
                    },
                    {
                      provider: 'chatgpt',
                      title: 'Sales dashboard',
                      url: 'https://sales.example.chatgpt.site/',
                    },
                  ]
                : [],
          }
        if (input.id.startsWith('http'))
          throw Error('Hosted links must not read Dovo artifact bodies')
        const metadata = {
          ...(input.id === 'notes' ? notes : input.id === 'folder' ? folder : interactive),
          taskId: input.taskId,
        }
        if (path.endsWith('/versions'))
          return {
            versions:
              metadata.id === 'notes'
                ? [notes, { ...notes, revision: 1 }]
                : metadata.id === 'folder'
                  ? [folder, { ...folder, revision: 1 }]
                  : [interactive],
          }
        return {
          artifact: {
            ...metadata,
            revision: input.revision ?? metadata.revision,
            ...(metadata.id === 'folder' ? { files: folderFiles } : {}),
            content:
              metadata.id === 'notes'
                ? input.revision === 1
                  ? 'Earlier notes'
                  : input.taskId === 'other-thread'
                    ? 'Other thread notes'
                    : 'Current notes'
                : metadata.id === 'folder'
                  ? '<button id="folder" onclick="this.textContent=Number(this.textContent)+1">0</button>'
                  : '<button id="interactive" onclick="this.textContent=Number(this.textContent)||1">Interactive artifact</button>',
          },
        }
      }
    })
    await view.addScriptTag({ content: ui.code })
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Artifacts' : 'Open artifact Notes',
        exact: true,
      })
      .waitFor()
    await view.waitForFunction(() =>
      window.artifactCalls.some((call) => call.path === '/api/artifacts/read'),
    )
    assert.ok(
      (await view.evaluate(() => window.artifactCalls)).every(
        (call) =>
          (ui.platform === 'desktop' && call.path === '/api/artifacts/list') ||
          (call.path === '/api/artifacts/read' &&
            call.input.revision === (call.input.id === 'interactive' ? 1 : 2)),
      ),
      'Inline previews read the version referenced by the message',
    )
    if (ui.platform === 'desktop') {
      assert.equal(
        await view
          .getByRole('button', { name: 'Artifacts', exact: true })
          .locator('svg.lucide-shapes')
          .count(),
        1,
        'Artifacts use their own Shapes icon',
      )
      await view.getByRole('button', { name: 'Open artifact Counter', exact: true }).click()
      await view
        .locator('[aria-label="Thread artifacts"], [role="dialog"]')
        .frameLocator('iframe')
        .frameLocator('iframe')
        .locator('#interactive')
        .waitFor()
      assert.equal(await view.getByRole('dialog').count(), 0, 'Thread cards must open beside chat')
      await view.getByRole('button', { name: 'Close artifacts', exact: true }).click()
      await view.getByLabel('Artifact', { exact: true }).waitFor({ state: 'hidden' })
      await view.evaluate(() => {
        window.artifactCalls = []
      })
    }
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Artifacts' : 'Open artifact Notes',
        exact: true,
      })
      .click()
    await view.getByText('Current notes', { exact: true }).last().waitFor()
    if (screenshotDirectory)
      await view.screenshot({ path: `${screenshotDirectory}/${ui.platform}-thread.png` })
    if (ui.platform === 'desktop') {
      assert.equal(await view.getByRole('region', { name: 'Thread artifacts' }).count(), 1)
      assert.equal(await view.getByRole('dialog').count(), 0)
      assert.ok(
        (await view.evaluate(() => window.artifactCalls)).every(
          (call) => call.input.taskId === 'thread',
        ),
      )
    }

    if (ui.platform === 'mobile') {
      await view.getByRole('button', { name: 'Share artifact', exact: true }).click()
      await view.getByRole('dialog', { name: 'Share artifact', exact: true }).waitFor()
      await view.evaluate(() => window.setSharingAccount(null))
      await view.getByRole('dialog', { name: 'Share artifact' }).waitFor({ state: 'hidden' })
      assert.equal(
        await view.getByRole('button', { name: 'Share artifact', exact: true }).count(),
        0,
      )
      await view.evaluate(() => window.setSharingAccount({ directory: {}, deletionPending: true }))
      assert.equal(
        await view.getByRole('button', { name: 'Share artifact', exact: true }).count(),
        0,
      )
      await view.evaluate(() => window.setSharingAccount({ directory: {}, deletionPending: false }))
      await view.getByRole('button', { name: 'Share artifact', exact: true }).waitFor()
      await view.getByRole('button', { name: 'Close sharing', exact: true }).click()
      await view
        .getByRole('dialog', { name: 'Share artifact', exact: true })
        .waitFor({ state: 'hidden' })
      await view.setViewportSize({ width: 320, height: 700 })
      const boxes = await Promise.all(
        [
          'Choose artifact',
          'Choose version · latest version',
          'View artifact source code',
          'Export artifact',
          'Refresh artifact',
          'Close artifact preview',
        ].map((name) => view.getByRole('button', { name, exact: true }).boundingBox()),
      )
      assert.ok(
        boxes.every(
          (box) =>
            box && Math.abs(box.y - boxes[0].y) < 1 && box.x >= 0 && box.x + box.width <= 320,
        ),
        'All artifact controls must share one row and fit a narrow phone',
      )
      assert.equal(
        await view
          .getByRole('button', { name: 'View artifact source code' })
          .getAttribute('data-icon'),
        'code',
      )
      if (screenshotDirectory)
        await view.screenshot({ path: `${screenshotDirectory}/mobile-thread-narrow.png` })
    }
    if (ui.platform === 'desktop') await view.getByLabel('Artifact version').selectOption('1')
    else {
      await view
        .getByRole('button', { name: 'Choose version · latest version', exact: true })
        .click()
      await view.getByText('Version 1', { exact: true }).click()
    }
    await view.getByText('Earlier notes', { exact: true }).last().waitFor()
    if (ui.platform === 'desktop')
      await view.getByRole('button', { name: 'Export PDF or PNG', exact: true }).click()
    const exportPdf = async () => {
      if (ui.platform === 'mobile') {
        await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
        await view.getByRole('button', { name: 'Export PDF', exact: true }).click()
        await view
          .waitForFunction(() => window.sharedArtifacts?.length === 1)
          .catch(async (error) => {
            throw new Error(
              JSON.stringify(
                await view.evaluate(() => ({
                  calls: window.artifactCalls,
                  alerts: window.artifactAlerts,
                })),
              ) + error.message,
            )
          })
        const shared = await view.evaluate(() => window.sharedArtifacts[0])
        assert.equal(shared.options.mimeType, 'application/pdf')
        assert.equal(shared.options.UTI, 'com.adobe.pdf')
        assert.ok(shared.uri.endsWith('Notes.pdf'))
        assert.ok(Buffer.from(shared.data).toString().startsWith('%PDF-'))
        assert.ok(
          await view.evaluate(() =>
            window.deletedArtifactFiles.includes(window.sharedArtifacts[0].uri),
          ),
        )
        await view.getByRole('button', { name: 'Share source', exact: true }).click()
        await view.waitForFunction(() => window.sharedArtifacts.length === 2)
        assert.equal(await view.evaluate(() => window.sharedArtifacts[1].data), 'Earlier notes')
        assert.equal(
          await view.evaluate(() => window.sharedArtifacts[1].options.mimeType),
          'text/markdown',
        )
      } else {
        const [download] = await Promise.all([
          view.waitForEvent('download'),
          view.getByRole('button', { name: 'Export PDF', exact: true }).click(),
        ])
        assert.equal(download.suggestedFilename(), 'Notes.pdf')
        assert.ok(
          readFileSync(await download.path())
            .toString()
            .startsWith('%PDF-'),
        )
      }
    }
    await exportPdf()
    const pdfRequest = await view.evaluate(() =>
      window.artifactCalls.findLast((call) => call.path === '/api/artifacts/pdf'),
    )
    assert.deepEqual(pdfRequest.input, {
      taskId: 'thread',
      id: 'notes',
      revision: 1,
      options: { paperSize: 'auto', landscape: false, marginMm: 16, scale: 100, background: true },
    })
    await view.evaluate(() => {
      window.failArtifactPdf = true
    })
    await view.getByRole('button', { name: 'Export PDF', exact: true }).click()
    if (ui.platform === 'mobile') {
      await view.waitForFunction(() =>
        window.artifactAlerts?.some((args) => args.join(' ').includes('PDF generation failed')),
      )
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    } else await view.getByText('PDF generation failed', { exact: true }).waitFor()
    await view.evaluate(() => {
      window.failArtifactPdf = false
    })
    assert.equal(
      await view
        .getByRole('button', {
          name: ui.platform === 'mobile' ? 'Export artifact' : 'Export PDF or PNG',
          exact: true,
        })
        .isDisabled(),
      false,
    )

    // A failed render must release the action guard so the same revision can be retried.
    if (ui.platform === 'mobile') {
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'Export PDF', exact: true }).click()
      await view.waitForFunction(() => window.sharedArtifacts.length === 3)
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    } else {
      const [retry] = await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('button', { name: 'Export PDF', exact: true }).click(),
      ])
      assert.equal(retry.suggestedFilename(), 'Notes.pdf')
    }
    // Non-default PDF settings, numeric validation and PNG dimensions use the selected saved revision.
    if (ui.platform === 'mobile')
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
    await view.getByLabel('Paper size', { exact: true }).selectOption('Letter')
    await view.getByLabel('Orientation', { exact: true }).selectOption('landscape')
    await view.getByLabel('Margins (mm)', { exact: true }).fill('8.5')
    await view.getByLabel('Scale (%)', { exact: true }).fill('75')
    await view.getByLabel('Include backgrounds', { exact: true }).uncheck()
    await view.getByLabel('Margins (mm)', { exact: true }).fill('')
    assert.equal(
      await view.getByRole('button', { name: 'Export PDF', exact: true }).isDisabled(),
      true,
    )
    await view.getByLabel('Margins (mm)', { exact: true }).fill('8.5')
    if (screenshotDirectory)
      await view.screenshot({ path: `${screenshotDirectory}/${ui.platform}-pdf-options.png` })
    const sharesBeforeOptions = await view.evaluate(() => window.sharedArtifacts?.length ?? 0)
    if (ui.platform === 'desktop') {
      await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('button', { name: 'Export PDF', exact: true }).click(),
      ])
    } else {
      await view.getByRole('button', { name: 'Export PDF', exact: true }).click()
      await view.waitForFunction(
        (count) => window.sharedArtifacts.length === count + 1,
        sharesBeforeOptions,
      )
    }
    const configuredPdf = await view.evaluate(() =>
      window.artifactCalls.findLast((call) => call.path === '/api/artifacts/pdf'),
    )
    assert.deepEqual(configuredPdf.input, {
      taskId: 'thread',
      id: 'notes',
      revision: 1,
      options: {
        paperSize: 'Letter',
        landscape: true,
        marginMm: 8.5,
        scale: 75,
        background: false,
      },
    })
    if (ui.platform === 'desktop')
      await view.getByRole('button', { name: 'PNG', exact: true }).click()
    else await view.getByLabel('Format', { exact: true }).selectOption('png')
    for (const value of ['', '319', '4097', '640.5']) {
      await view.getByLabel('Width (px)', { exact: true }).fill(value)
      assert.equal(
        await view.getByRole('button', { name: 'Export PNG', exact: true }).isDisabled(),
        true,
      )
    }
    await view.getByLabel('Width (px)', { exact: true }).fill('960')
    if (screenshotDirectory)
      await view.screenshot({ path: `${screenshotDirectory}/${ui.platform}-png-options.png` })
    await view.evaluate(() => (window.failArtifactPng = true))
    await view.getByRole('button', { name: 'Export PNG', exact: true }).click()
    if (ui.platform === 'desktop')
      await view.getByText('PNG generation failed', { exact: true }).waitFor()
    else
      await view.waitForFunction(() =>
        window.artifactAlerts.some((args) => args.join(' ').includes('PNG generation failed')),
      )
    await view.evaluate(() => (window.failArtifactPng = false))
    if (ui.platform === 'desktop') {
      const [download] = await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('button', { name: 'Export PNG', exact: true }).click(),
      ])
      assert.equal(download.suggestedFilename(), 'Notes.png')
      assert.equal(readFileSync(await download.path()).toString(), 'PNG revision 1 width 960')
      await view.getByRole('button', { name: 'Close export options', exact: true }).click()
    } else {
      const count = await view.evaluate(() => window.sharedArtifacts.length)
      await view.getByRole('button', { name: 'Export PNG', exact: true }).click()
      await view.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
      const png = await view.evaluate(() => window.sharedArtifacts.at(-1))
      assert.equal(png.options.mimeType, 'image/png')
      assert.equal(png.options.UTI, 'public.png')
      assert.equal(Buffer.from(png.data).toString(), 'PNG revision 1 width 960')
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    }
    assert.deepEqual(
      await view.evaluate(
        () => window.artifactCalls.findLast((call) => call.path === '/api/artifacts/png').input,
      ),
      { taskId: 'thread', id: 'notes', revision: 1, width: 960 },
    )
    // Temporary editing uses a separate, inert guest; apply, cancel and reset never write the artifact.
    if (ui.platform === 'mobile')
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
    else await view.getByRole('button', { name: 'Export PDF or PNG', exact: true }).click()
    await view.evaluate(() => (window.failEditorPreview = true))
    await view.getByRole('button', { name: 'Edit before export', exact: true }).click()
    if (ui.platform === 'desktop')
      await view.getByText('Editor preparation failed', { exact: true }).waitFor()
    else
      await view.waitForFunction(() =>
        window.artifactAlerts.some((args) => args.join(' ').includes('Editor preparation failed')),
      )
    await view.evaluate(() => (window.failEditorPreview = false))
    await view.getByRole('button', { name: 'Edit before export', exact: true }).click()
    const editor = view.frameLocator('iframe[title="Export editor"]')
    const editing = editor.frameLocator('iframe[title="Editable export content"]')
    await editing.locator('#keep h1').waitFor()
    assert.equal(
      await view.evaluate(() => window.editorGuestExecuted),
      undefined,
      'Editing guest scripts must never run',
    )
    assert.equal(await editing.locator('body').getAttribute('contenteditable'), 'true')
    const editHeading = async (value) => {
      const heading = editing.locator('#keep h1')
      await heading.click()
      await heading.evaluate((node) => {
        const range = node.ownerDocument.createRange()
        range.selectNodeContents(node)
        const selection = node.ownerDocument.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      })
      // Native keystrokes exercise contenteditable in a guest with scripts disabled.
      await view.keyboard.type(value)
    }
    await editHeading('Edited export heading')
    assert.equal(
      await editing.locator('#keep h1').textContent(),
      'Edited export heading',
      'Text editing must update the temporary copy immediately',
    )
    await editor.getByRole('button', { name: 'Select elements', exact: true }).click()
    await editing.locator('#remove-me h2').click()
    await editor.getByRole('button', { name: 'Select parent', exact: true }).click()
    await editor.getByRole('button', { name: 'Delete element', exact: true }).click()
    assert.equal(await editing.locator('#remove-me').count(), 0)
    await editor.getByRole('button', { name: 'Undo removal / exclusion', exact: true }).click()
    assert.equal(await editing.locator('#remove-me').count(), 1)
    await editing.locator('#remove-me h2').click()
    await editor.getByRole('button', { name: 'Select parent', exact: true }).click()
    await editor.getByRole('button', { name: 'Delete element', exact: true }).click()
    await editing.locator('#exclude-me').click()
    await editor.getByRole('button', { name: 'Exclude from export', exact: true }).click()
    assert.equal(await editing.locator('#exclude-me').getAttribute('data-no-print'), '')
    await editor.getByRole('button', { name: 'Include in export', exact: true }).click()
    assert.equal(await editing.locator('#exclude-me').getAttribute('data-no-print'), null)
    await editor.getByRole('button', { name: 'Undo removal / exclusion', exact: true }).click()
    assert.equal(await editing.locator('#exclude-me').getAttribute('data-no-print'), '')
    await editing.locator('#exclude-me').click()

    if (screenshotDirectory)
      await view.screenshot({ path: `${screenshotDirectory}/${ui.platform}-export-editor.png` })
    await editor.getByRole('button', { name: 'Use edited copy', exact: true }).click()
    if (ui.platform === 'desktop')
      await view.getByRole('button', { name: 'PDF', exact: true }).click()
    else await view.getByLabel('Format', { exact: true }).selectOption('pdf')
    if (ui.platform === 'desktop')
      await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('button', { name: 'Export PDF', exact: true }).click(),
      ])
    else {
      const count = await view.evaluate(() => window.sharedArtifacts.length)
      await view.getByRole('button', { name: 'Export PDF', exact: true }).click()
      await view.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
    }
    const editedPdf = await view.evaluate(() =>
      window.artifactCalls.findLast((call) => call.path === '/api/artifacts/pdf'),
    )
    assert.ok(editedPdf.input.draftHtml.includes('Edited export heading'))
    assert.ok(!editedPdf.input.draftHtml.includes('id="remove-me"'))
    assert.ok(editedPdf.input.draftHtml.includes('data-no-print'))
    assert.ok(!editedPdf.input.draftHtml.includes('data-dovo-export-selected'))
    assert.ok(!editedPdf.input.draftHtml.includes('contenteditable'))
    // Reopening the edit copy, then discarding, retains the previously applied draft.
    await view.getByRole('button', { name: 'Edit before export', exact: true }).click()
    await editHeading('Discard this change')
    await editor.getByRole('button', { name: 'Discard edits', exact: true }).click()
    await view.getByRole('button', { name: 'Edit before export', exact: true }).click()
    assert.equal(await editing.locator('#keep h1').textContent(), 'Edited export heading')
    await editor.getByRole('button', { name: 'Discard edits', exact: true }).click()
    await view.getByRole('button', { name: 'Reset edits', exact: true }).click()
    assert.equal(await view.getByRole('button', { name: 'Reset edits', exact: true }).count(), 0)
    assert.ok(
      await view.evaluate(
        () =>
          !window.artifactCalls.some((call) =>
            ['/api/artifacts/create', '/api/artifacts/update'].includes(call.path),
          ),
      ),
    )
    if (ui.platform === 'desktop')
      await view.getByRole('button', { name: 'Close export options', exact: true }).click()
    else await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await view.getByText('Earlier notes', { exact: true }).last().waitFor()
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Expand artifact', exact: true }).click()
      await view.getByRole('dialog').waitFor()
      await view.getByText('Earlier notes', { exact: true }).last().waitFor()
      await view.getByRole('button', { name: 'Close', exact: true }).click()
      await view.getByRole('region', { name: 'Thread artifacts' }).waitFor()
      assert.equal(
        await view.getByLabel('Artifact version').inputValue(),
        '1',
        'Expanding must preserve the selected version',
      )
    }
    if (ui.platform === 'desktop')
      await view.getByLabel('Artifact', { exact: true }).selectOption('interactive')
    else {
      await view.getByRole('button', { name: 'Choose artifact', exact: true }).click()
      await view.getByText('Counter', { exact: true }).click()
    }
    await view
      .locator('[aria-label="Thread artifacts"], [role="dialog"]')
      .frameLocator('iframe')
      .frameLocator('iframe')
      .locator('#interactive')
      .waitFor()
    if (ui.platform === 'mobile') {
      const mounts = await view.evaluate(() => window.mobilePreviewMounts)
      await view.evaluate(() => window.terminateMobilePreview())
      await view.waitForFunction((count) => window.mobilePreviewMounts === count + 1, mounts)
      await view
        .locator('[aria-label="Thread artifacts"], [role="dialog"]')
        .frameLocator('iframe')
        .frameLocator('iframe')
        .locator('#interactive')
        .waitFor()
      await view.evaluate(() => window.crashMobilePreview())
      await view.waitForFunction((count) => window.mobilePreviewMounts === count + 2, mounts)
      await view
        .locator('[aria-label="Thread artifacts"], [role="dialog"]')
        .frameLocator('iframe')
        .frameLocator('iframe')
        .locator('#interactive')
        .waitFor()
    }
    const interactiveFrame = view
      .locator('[aria-label="Thread artifacts"], [role="dialog"]')
      .frameLocator('iframe')
      .frameLocator('iframe')
    await interactiveFrame.locator('#interactive').click()
    assert.equal(await interactiveFrame.locator('#interactive').textContent(), '1')
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Source' : 'View artifact source code',
        exact: true,
      })
      .click()
    await view
      .getByText(/<button id="interactive"/)
      .last()
      .waitFor()
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Preview' : 'Show artifact preview',
        exact: true,
      })
      .click()
    assert.equal(
      await interactiveFrame.locator('#interactive').textContent(),
      '1',
      'Viewing source preserves artifact interaction',
    )

    if (ui.platform === 'desktop')
      await view.getByLabel('Artifact', { exact: true }).selectOption('folder')
    else {
      await view.getByRole('button', { name: 'Choose artifact', exact: true }).click()
      await view.getByText('Folder demo', { exact: true }).click()
    }
    const folderFrame = view
      .locator('[aria-label="Thread artifacts"], [role="dialog"]')
      .frameLocator('iframe')
      .frameLocator('iframe')
    await folderFrame.locator('#folder').click()
    assert.equal(await folderFrame.locator('#folder').textContent(), '1')
    if (ui.platform === 'desktop')
      await view.getByLabel('Artifact file', { exact: true }).selectOption('scripts/main.js')
    else {
      await view.getByRole('button', { name: 'Browse files · 3', exact: true }).click()
      await view.getByRole('button', { name: 'scripts/main.js', exact: true }).click()
    }
    await view
      .getByText(/document.querySelector\("#folder"\).onclick/)
      .last()
      .waitFor()
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Preview' : 'Show artifact preview',
        exact: true,
      })
      .click()
    assert.equal(
      await folderFrame.locator('#folder').textContent(),
      '1',
      'Browsing a folder preserves live preview state',
    )
    if (ui.platform === 'desktop') await view.getByLabel('Artifact version').selectOption('1')
    else {
      await view
        .getByRole('button', { name: 'Choose version · latest version', exact: true })
        .click()
      await view.getByText('Version 1', { exact: true }).click()
    }
    await folderFrame.locator('#folder').waitFor()
    if (ui.platform === 'desktop') {
      const [download] = await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('button', { name: 'Download folder', exact: true }).click(),
      ])
      assert.equal(download.suggestedFilename(), 'Folder demo.zip')
      assert.equal(readFileSync(await download.path()).toString(), 'PK-Folder revision 1')
    } else {
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'Share folder (ZIP)', exact: true }).click()
      await view.waitForFunction(() => window.sharedArtifacts.length === 7)
      const shared = await view.evaluate(() => window.sharedArtifacts.at(-1))
      assert.equal(shared.options.mimeType, 'application/zip')
      assert.equal(Buffer.from(shared.data).toString(), 'PK-Folder revision 1')
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
      await view.getByRole('button', { name: 'Browse files · 3', exact: true }).click()
      await view.getByRole('button', { name: 'assets/logo.png', exact: true }).click()
      await view
        .getByText(/Binary asset: assets\/logo.png/)
        .last()
        .waitFor()
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'Share source', exact: true }).click()
      await view.waitForFunction(() => window.sharedArtifacts.length === 8)
      assert.equal(
        Buffer.from(await view.evaluate(() => window.sharedArtifacts.at(-1).data)).toString(),
        'image',
      )
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    }
    assert.deepEqual(
      (
        await view.evaluate(() =>
          window.artifactCalls.findLast((call) => call.path === '/api/artifacts/download'),
        )
      ).input,
      { taskId: 'thread', id: 'folder', revision: 1 },
    )

    for (const format of ['html', 'mhtml']) {
      const label = format === 'html' ? 'Interactive HTML' : 'MHTML snapshot'
      if (ui.platform === 'desktop') {
        await view.getByRole('button', { name: 'Export folder', exact: true }).click()
        const [download] = await Promise.all([
          view.waitForEvent('download'),
          view.getByRole('menuitem', { name: new RegExp(label) }).click(),
        ])
        assert.equal(download.suggestedFilename(), `Folder demo.${format}`)
        assert.ok(
          readFileSync(await download.path())
            .toString()
            .includes('Folder revision 1'),
        )
      } else {
        const count = await view.evaluate(() => window.sharedArtifacts.length)
        await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
        await view.getByRole('button', { name: label, exact: true }).click()
        await view.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
        const shared = await view.evaluate(() => window.sharedArtifacts.at(-1))
        assert.equal(shared.options.mimeType, format === 'html' ? 'text/html' : 'multipart/related')
        assert.ok(shared.uri.endsWith(`Folder demo.${format}`))
        assert.ok(Buffer.from(shared.data).toString().includes('Folder revision 1'))
        await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
      }
      const call = await view.evaluate(
        (format) =>
          window.artifactCalls.findLast((call) => call.path === '/api/artifacts/' + format),
        format,
      )
      assert.deepEqual(call.input, { taskId: 'thread', id: 'folder', revision: 1 })
    }
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Export folder', exact: true }).click()
      await view.getByRole('menuitem', { name: 'Edit before export…', exact: true }).click()
    } else {
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'Edit before export', exact: true }).click()
    }
    await editing.locator('#keep h1').waitFor()
    await editHeading('Folder edited export')
    await editor.getByRole('button', { name: 'Use edited copy', exact: true }).click()
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Export folder', exact: true }).click()
      await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('menuitem', { name: /MHTML snapshot/ }).click(),
      ])
    } else {
      const count = await view.evaluate(() => window.sharedArtifacts.length)
      await view.getByRole('button', { name: 'MHTML snapshot', exact: true }).click()
      await view.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
    }
    const editedMhtml = await view.evaluate(() =>
      window.artifactCalls.findLast((call) => call.path === '/api/artifacts/mhtml'),
    )
    assert.equal(editedMhtml.input.id, 'folder')
    assert.equal(editedMhtml.input.revision, 1)
    assert.ok(editedMhtml.input.draftHtml.includes('Folder edited export'))
    await view.getByRole('button', { name: 'Reset edits', exact: true }).click()
    if (ui.platform === 'mobile')
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await view.evaluate(() => (window.failFolderExport = true))
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Export folder', exact: true }).click()
      await view.getByRole('menuitem', { name: /MHTML snapshot/ }).click()
      await view.getByText('Archive export failed', { exact: true }).waitFor()
      assert.equal(
        await view.getByRole('button', { name: 'Export folder', exact: true }).isDisabled(),
        false,
      )
    } else {
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'MHTML snapshot', exact: true }).click()
      await view.waitForFunction(() =>
        window.artifactAlerts.some((args) => args.join(' ').includes('Archive export failed')),
      )
      assert.equal(
        await view.getByRole('button', { name: 'MHTML snapshot', exact: true }).isDisabled(),
        false,
      )
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    }
    await view.evaluate(() => (window.failFolderExport = false))
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Export folder', exact: true }).click()
      const [retried] = await Promise.all([
        view.waitForEvent('download'),
        view.getByRole('menuitem', { name: /MHTML snapshot/ }).click(),
      ])
      assert.equal(retried.suggestedFilename(), 'Folder demo.mhtml')
    } else {
      const count = await view.evaluate(() => window.sharedArtifacts.length)
      await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
      await view.getByRole('button', { name: 'MHTML snapshot', exact: true }).click()
      await view.waitForFunction((count) => window.sharedArtifacts.length === count + 1, count)
      await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
    }
    if (screenshotDirectory) {
      if (ui.platform === 'desktop') {
        await view.getByRole('button', { name: 'Export folder', exact: true }).click()
        await view.screenshot({ path: `${screenshotDirectory}/desktop-folder-exports.png` })
        await view.keyboard.press('Escape')
      } else {
        await view.getByRole('button', { name: 'Export artifact', exact: true }).click()
        await view.screenshot({ path: `${screenshotDirectory}/mobile-folder-exports.png` })
        await view.getByRole('button', { name: 'Back to preview', exact: true }).click()
      }
    }

    if (screenshotDirectory)
      await view.screenshot({ path: `${screenshotDirectory}/${ui.platform}-folder.png` })

    const chooseLink = async (title, url) => {
      if (ui.platform === 'desktop')
        await view.getByLabel('Artifact', { exact: true }).selectOption(url)
      else {
        await view.getByRole('button', { name: 'Choose artifact', exact: true }).click()
        await view.getByText(title, { exact: true }).click()
      }
    }
    await chooseLink('Claude design', 'https://claude.ai/code/artifact/design-id')
    const openClaude = view.getByRole(ui.platform === 'desktop' ? 'link' : 'button', {
      name: 'Open Claude artifact',
      exact: true,
    })
    await openClaude.waitFor()
    if (ui.platform === 'desktop') {
      assert.equal(
        await openClaude.getAttribute('href'),
        'https://claude.ai/code/artifact/design-id',
      )
      assert.equal(await view.getByLabel('Artifact version').count(), 0)
      assert.equal(await view.getByRole('button', { name: 'Download', exact: true }).count(), 0)
    } else {
      assert.equal(
        await view
          .getByRole('button', { name: 'View artifact source code', exact: true })
          .isDisabled(),
        true,
      )
      await openClaude.click()
      assert.deepEqual(await view.evaluate(() => window.openedArtifactLinks), [
        'https://claude.ai/code/artifact/design-id',
      ])
    }
    await chooseLink('Sales dashboard', 'https://sales.example.chatgpt.site/')
    await view
      .getByRole(ui.platform === 'desktop' ? 'link' : 'button', {
        name: 'Open ChatGPT Site',
        exact: true,
      })
      .waitFor()
    assert.ok(
      !(await view.evaluate(() => window.artifactCalls)).some((call) =>
        call.input.id?.startsWith('http'),
      ),
    )
    await view.evaluate(() => (window.artifactLinksOnly = true))
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Refresh artifacts' : 'Refresh artifact',
        exact: true,
      })
      .click()
    await view
      .getByRole(ui.platform === 'desktop' ? 'link' : 'button', {
        name: 'Open ChatGPT Site',
        exact: true,
      })
      .waitFor()
    assert.equal(await view.getByText(/No artifacts yet/).count(), 0)
    await view.evaluate(() => (window.artifactLinksOnly = false))

    if (ui.platform === 'desktop') {
      await view.evaluate(() => {
        window.artifactCalls = []
        window.switchArtifactThread('other-thread')
      })
      await view.getByText('Other thread notes', { exact: true }).waitFor()
      assert.ok(
        (await view.evaluate(() => window.artifactCalls)).every(
          (call) => call.input.taskId === 'other-thread',
        ),
      )
      assert.equal(await view.getByLabel('Artifact', { exact: true }).inputValue(), 'notes')
      assert.equal(await view.getByLabel('Artifact version').inputValue(), '')
      assert.equal(
        await view.getByRole('link', { name: 'Open ChatGPT Site', exact: true }).count(),
        0,
      )
    }
    if (ui.platform === 'mobile') {
      await view.getByRole('button', { name: 'Close artifact preview', exact: true }).click()
      await view.evaluate(() => window.showInlineHtml())
      const inline = view.frameLocator('iframe').frameLocator('iframe')
      await inline.locator('#interactive').waitFor()
      await inline
        .locator('#interactive')
        .evaluate((button) => (button.onclick = () => (button.textContent = 'Clicked inline')))
      await inline.locator('#interactive').click()
      assert.equal(await inline.locator('#interactive').innerText(), 'Clicked inline')
      await view.getByRole('button', { name: 'View inline artifact source', exact: true }).click()
      await view
        .getByText(
          '```html\n<button id="interactive" onclick="this.textContent=Number(this.textContent)||1">Interactive artifact</button>\n```',
          { exact: true },
        )
        .waitFor()
      await view.getByRole('button', { name: 'Show rendered artifact', exact: true }).click()
      assert.equal(
        await inline.locator('#interactive').innerText(),
        'Clicked inline',
        'Source toggle preserves native WebView state',
      )
      await view.evaluate(() => window.showInlineFolder())
      const folderInline = view.frameLocator('iframe').frameLocator('iframe')
      await folderInline.locator('#folder').click()
      assert.equal(await folderInline.locator('#folder').textContent(), '1')
      await view.getByRole('button', { name: 'View inline artifact source', exact: true }).click()
      await view
        .getByText(/<script src="scripts\/main.js"><\/script>/)
        .last()
        .waitFor()
      await view.getByRole('button', { name: 'Show rendered artifact', exact: true }).click()
      assert.equal(await folderInline.locator('#folder').textContent(), '1')
      await checkGeneratedDownloads(view, folderInline, true)
      await view.getByRole('button', { name: 'Expand inline artifact', exact: true }).click()
      await view.getByRole('dialog').waitFor()
      await checkGeneratedDownloads(
        view,
        view.getByRole('dialog').frameLocator('iframe').frameLocator('iframe'),
        true,
      )
      await view.getByRole('button', { name: 'Close artifact preview', exact: true }).click()
    }
    if (ui.platform === 'desktop') {
      await checkGeneratedDownloads(
        view,
        view.locator('[data-inline-artifact]').frameLocator('iframe').frameLocator('iframe'),
        false,
      )
      await view.getByLabel('Artifact', { exact: true }).selectOption('interactive')
      await checkGeneratedDownloads(
        view,
        view
          .getByRole('region', { name: 'Thread artifacts' })
          .frameLocator('iframe')
          .frameLocator('iframe'),
        false,
      )
    }
    await view.close()
    const disabled = await browser.newPage()
    await disabled.setContent('<div id="app"></div>')
    await disabled.evaluate(() => {
      window.artifactsEnabled = false
      window.artifactRequest = () => {
        throw new Error('Disabled artifact UI must not request data')
      }
    })
    await disabled.addScriptTag({ content: ui.code })
    assert.equal(
      await disabled
        .getByRole('button', ui.platform === 'desktop' ? { name: 'Artifacts', exact: true } : {})
        .count(),
      0,
    )
    await disabled.close()
  }
  for (const platform of ['library', 'mobile-library']) {
    const native = platform === 'mobile-library'
    const library = await browser.newPage({
      viewport: native ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    })
    const chooseLibrary = async (label, value) => {
      if (native) return library.getByLabel(label, { exact: true }).selectOption(value)
      await library.getByRole('button', { name: label, exact: true }).click()
      await library.getByRole('dialog').locator(`[role="option"][data-value="${value}"]`).click()
      await library.getByRole('dialog').waitFor({ state: 'hidden' })
    }
    await prepareView(library, native)
    await library.evaluate(() => {
      const metadata = {
        taskId: 'thread',
        revision: 1,
        createdAt: '2026-10-01T00:00:00Z',
        threadTitle: 'Research',
        threadState: 'settled',
      }
      const profiles = ['Host A', 'Host B', 'Offline host'].map((name, index) => ({
        id: String(index),
        name,
        connection: { address: 'http://host' + index, token: 'test' },
      }))
      const formats = [
        { format: 'markdown', title: 'Launch brief' },
        { format: 'html', title: 'Budget calculator' },
        { format: 'svg', title: 'System diagram' },
        { format: 'code', title: 'API client' },
      ]
      const artifactsFor = (host) =>
        formats
          .map((item, index) => ({
            ...metadata,
            ...item,
            id: `${host}-${item.format}`,
            updatedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
          }))
          .filter((item) => !window.deletedArtifacts.includes(`${host}:${item.id}`))
      const sources = profiles.map((profile, index) => ({
        profile,
        connected: index !== 2,
        error: index === 2 ? 'Offline' : null,
        snapshot: {
          artifactsEnabled: true,
          workspace: {
            agents: [],
            repositories: [{ id: 'repo', name: 'Project' }],
            tasks: [{ id: 'destination', title: 'Destination thread', repositoryId: 'repo' }],
          },
        },
      }))
      window.libraryCalls = []
      window.previewHosts = []
      window.snapshotCalls = []
      window.artifactMutations = []
      window.deletedArtifacts = []
      window.artifactWorkspace = {
        connected: true,
        activeRuntimeId: '0',
        snapshot: { artifactsEnabled: true },
        runtimes: sources,
        overviews: sources,
        switchRuntime: async () => {
          if (window.holdRuntimeSwitch)
            await new Promise((resolve) => (window.finishRuntimeSwitch = resolve))
        },
        runtimeReadCache: () => ({ read: async () => null, write: async () => {} }),
        cacheForRuntime: () => ({ read: async () => null, write: async () => {} }),
        readRuntime: async (profile, path, input) => {
          if (path.endsWith('/snapshot')) {
            window.snapshotCalls.push([profile.id, input.id])
            if (window.holdSnapshots)
              await new Promise((resolve) => window.snapshotReplies.push(resolve))
            return { excerpt: 'Snapshot from Host ' + profile.id + (window.snapshotVersion ?? '') }
          }
          if (path.endsWith('/attach') || path.endsWith('/delete')) {
            window.artifactMutations.push({ profile: profile.id, path, input })
            if (window.failArtifactMutation) throw new Error('Artifact action failed')
            if (path.endsWith('/delete')) {
              window.deletedArtifacts.push(`${profile.id}:${input.id}`)
              return { ok: true }
            }
            return { artifact: { ...artifactsFor(profile.id)[0], taskId: input.targetTaskId } }
          }
          window.libraryCalls.push(profile.id)
          return { artifacts: artifactsFor(profile.id) }
        },
      }
      window.artifactRequest = async (path, input, host) => {
        window.previewHosts.push(host)
        const artifact = {
          ...artifactsFor(host).find((item) => item.id === input.id),
          content: 'Content from Host ' + host,
        }
        return path.endsWith('/versions')
          ? { versions: [artifact] }
          : path.endsWith('/list')
            ? { artifacts: artifactsFor(host) }
            : { artifact }
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (content) => {
            window.copiedSource = content
          },
        },
      })
    })
    await library.addScriptTag({ content: interfaces.find((ui) => ui.platform === platform).code })
    const cards = library.getByRole('button', { name: /^Open artifact / })
    await cards.first().waitFor()
    assert.equal(await cards.count(), 8)
    if (native) {
      const filters = library.getByRole('button', { name: 'Artifact filters', exact: true })
      const compactTop = (await cards.first().boundingBox()).y
      assert.equal(await library.getByLabel('Sort artifacts', { exact: true }).count(), 0)
      await filters.click()
      assert.ok(
        (await cards.first().boundingBox()).y > compactTop,
        'Secondary filters start collapsed',
      )
      await library.getByRole('button', { name: 'Document', exact: true }).click()
      assert.equal(await cards.count(), 2)
      await filters.click()
      assert.equal(
        await filters.getAttribute('aria-pressed'),
        'true',
        'Collapsed active filters remain indicated',
      )
      assert.equal(await library.getByLabel('Sort artifacts', { exact: true }).count(), 0)
      assert.equal(await cards.count(), 2, 'Collapsing filters preserves the selected format')
      await library.getByRole('button', { name: 'Clear filters', exact: true }).click()
      assert.equal(await cards.count(), 8)
      await filters.click()
      await library.getByRole('button', { name: 'Back', exact: true }).click()
      assert.equal(await library.evaluate(() => window.artifactBackRoute), '/')
      await library.evaluate(() => (window.artifactHistory = '/settings'))
      await library.getByRole('button', { name: 'Back', exact: true }).click()
      assert.equal(await library.evaluate(() => window.artifactBackRoute), '/settings')
    }
    assert.equal(
      await cards.first().getAttribute('aria-label'),
      'Open artifact API client',
      'Library must show recently updated artifacts first',
    )
    const previewHeight = (await cards.first().boundingBox()).height
    await library.getByRole('button', { name: 'List view', exact: true }).click()
    const listHeight = (await cards.first().boundingBox()).height
    assert.ok(listHeight < previewHeight, JSON.stringify({ platform, previewHeight, listHeight }))
    if (!native) {
      const actions = library
        .getByRole('button', { name: 'Artifact actions API client', exact: true })
        .first()
      await actions.focus()
      await actions.press('Enter')
      await library.getByRole('menuitem', { name: 'Delete artifact', exact: true }).click()
      await library
        .getByRole('dialog')
        .getByRole('heading', { name: 'Delete artifact?', exact: true })
        .waitFor()
      await library.getByRole('button', { name: 'Cancel', exact: true }).click()
      await library.getByRole('dialog').waitFor({ state: 'detached' })
      await library.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === 'Artifact actions API client',
      )
      assert.equal(await cards.count(), 8, 'Compact menu still confirms deletion')
      assert.equal(await library.evaluate(() => window.artifactMutations.length), 0)
      assert.equal(
        await actions.evaluate((node) => document.activeElement === node),
        true,
        'Keyboard focus returns to the actions control',
      )
    }
    const listSnapshots = await library.evaluate(() => window.snapshotCalls.length)
    await chooseLibrary('Sort artifacts', 'oldest')
    assert.equal(await cards.first().getAttribute('aria-label'), 'Open artifact Launch brief')
    await chooseLibrary('Sort artifacts', 'title')
    assert.deepEqual(
      await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
      ['API client', 'Budget calculator', 'Launch brief', 'System diagram'].flatMap((title) => [
        `Open artifact ${title}`,
        `Open artifact ${title}`,
      ]),
      'Title order works across computers',
    )
    assert.equal(
      await library.evaluate(() => window.snapshotCalls.length),
      listSnapshots,
      'Sorting compact rows does not fetch thumbnails',
    )
    for (const width of native ? [320, 390, 544, 768, 1024, 1366] : [320, 390, 1280]) {
      await library.setViewportSize({ width, height: 844 })
      assert.ok(
        await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${platform} list fits ${width}px`,
      )
      if (screenshotDirectory)
        await library.screenshot({ path: `${screenshotDirectory}/${platform}-list-${width}.png` })
    }
    await library.setViewportSize(
      native ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    )
    await chooseLibrary('Sort artifacts', 'updated')
    await library.getByRole('button', { name: 'Preview view', exact: true }).click()
    if (!native) {
      await library.getByRole('status').filter({ hasText: 'Offline host is offline.' }).waitFor()
      assert.equal(
        await library.getByRole('alert').count(),
        0,
        'A disconnected computer is a status, not a request failure',
      )
    } else await library.getByText(/Offline host/).waitFor()
    assert.deepEqual(await library.evaluate(() => window.libraryCalls), ['0', '1'])
    assert.deepEqual(
      await library.evaluate(() => window.previewHosts),
      [],
      'Browsing the gallery must fetch snapshots, not full artifact bodies',
    )
    if (screenshotDirectory) {
      await library.screenshot({
        path: `${screenshotDirectory}/${platform}.png`,
        animations: 'disabled',
      })
      if (!native) {
        await library.evaluate(() => {
          document.documentElement.dataset.theme = 'light'
          document.documentElement.classList.remove('dark')
        })
        await library.screenshot({
          path: `${screenshotDirectory}/library-light.png`,
          animations: 'disabled',
        })
        await library.evaluate(() => {
          delete document.documentElement.dataset.theme
          document.documentElement.classList.add('dark')
        })
        await library.setViewportSize({ width: 390, height: 844 })
        assert.ok(
          await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'The gallery must fit a narrow browser',
        )
        await library.screenshot({
          path: `${screenshotDirectory}/library-narrow.png`,
          animations: 'disabled',
        })
        await library.setViewportSize({ width: 1280, height: 800 })
      }
    }
    if (!native) await library.evaluate(() => window.updateLibrary())
    const galleryTop = (await cards.first().boundingBox()).y
    await library.getByLabel('Search artifacts').fill('document')
    assert.equal(await cards.count(), 2, 'Search must match the format labels shown on cards')
    assert.equal(
      (await cards.first().boundingBox()).y,
      galleryTop,
      'Clear filters appearing must not move the gallery',
    )
    await library.getByRole('button', { name: 'Clear filters', exact: true }).click()
    assert.equal(
      await cards.count(),
      8,
      'Visible results keep a direct way to clear active filters',
    )
    assert.equal(await library.getByLabel('Search artifacts').inputValue(), '')
    await library.getByLabel('Search artifacts').fill('Host B')
    assert.equal(await cards.count(), 4)
    await library.getByRole('button', { name: 'Code', exact: true }).click()
    assert.equal(await cards.count(), 1)
    await chooseLibrary('Artifact thread state', 'archived')
    await library.getByText('No matching artifacts', { exact: true }).waitFor()
    await library.getByRole('button', { name: 'Clear filters', exact: true }).click()
    assert.equal(await cards.count(), 8)
    await library.getByLabel('Search artifacts').fill('Host B')
    await library.getByRole('button', { name: 'Document', exact: true }).click()
    assert.equal(await cards.count(), 1)
    if (native) {
      await library.getByRole('button', { name: 'Open source thread', exact: true }).click()
      assert.equal(await library.evaluate(() => window.artifactNavigation.runtimeId), '1')
      assert.equal(await library.evaluate(() => window.artifactNavigation.view), 'tasks')
    }
    await cards.click()
    await library.getByText('Content from Host 1', { exact: true }).waitFor()
    assert.ok((await library.evaluate(() => window.previewHosts)).every((host) => host === '1'))
    if (!native) {
      await library.evaluate(() => {
        window.holdRuntimeSwitch = true
        window.artifactNavigation = null
      })
      await library.getByRole('button', { name: 'Open source thread', exact: true }).click()
      await library.waitForFunction(() => !!window.finishRuntimeSwitch)
      await library.evaluate(() => {
        window.navigationEpoch = 1
        window.finishRuntimeSwitch()
      })
      await library
        .getByRole('button', { name: 'Open source thread', exact: true })
        .waitFor({ state: 'visible' })
      await library.waitForFunction(
        () =>
          !document.querySelector('button:disabled')?.textContent?.includes('Open source thread'),
      )
      assert.equal(
        await library.evaluate(() => window.artifactNavigation),
        null,
        'A delayed switch must not override later navigation',
      )
      await library.evaluate(() => (window.holdRuntimeSwitch = false))
      await library.getByRole('button', { name: 'Open source thread', exact: true }).click()
      await library.waitForFunction(() => window.artifactNavigation?.viewId === 'tasks')
      assert.ok(await library.evaluate(() => window.artifactNavigation.entityId))
      assert.equal(
        await library.getByRole('dialog').count(),
        0,
        'The library opens artifacts beside its list, not in a modal',
      )
      assert.equal(
        await library.getByRole('heading', { level: 1 }).textContent(),
        'Launch brief',
        'The selected artifact owns the page header',
      )
      assert.equal(
        await library
          .getByRole('navigation', { name: 'Artifact library' })
          .getByRole('button', { name: 'Open artifact Launch brief' })
          .getAttribute('aria-current'),
        'true',
      )
      await library.getByRole('button', { name: 'Copy source', exact: true }).click()
      await library.getByRole('button', { name: 'Copied source', exact: true }).waitFor()
      assert.equal(await library.evaluate(() => window.copiedSource), 'Content from Host 1')
      if (screenshotDirectory)
        await library.screenshot({ path: `${screenshotDirectory}/library-preview.png` })
      await library.getByRole('button', { name: 'Expand artifact', exact: true }).click()
      await library.getByRole('dialog').waitFor()
      await library.keyboard.press('Escape')
      await library.getByRole('dialog').waitFor({ state: 'detached' })
      await library.setViewportSize({ width: 390, height: 844 })
      assert.equal(
        await library.getByLabel('Search artifacts').isVisible(),
        false,
        'Compact layouts stack the detail over the list',
      )
      await library.getByRole('button', { name: 'Back to artifacts', exact: true }).click()
      await library.getByLabel('Search artifacts').waitFor()
      await library.setViewportSize({ width: 1280, height: 800 })
    } else
      await library.getByRole('button', { name: 'Close artifact preview', exact: true }).click()
    assert.deepEqual(
      await library.evaluate(() => window.libraryCalls),
      ['0', '1'],
      'Snapshot rerenders and previews must not reload the global library',
    )
    await library.getByLabel('Search artifacts').fill('')
    await library.getByRole('button', { name: 'All formats', exact: true }).click()
    const firstCard = library.getByRole('button', { name: 'Open artifact API client' }).first()
    const cardContainer = firstCard.locator('..')
    await firstCard.scrollIntoViewIfNeeded()
    await firstCard.getByText('Snapshot from Host 0', { exact: true }).waitFor()
    await firstCard.focus()
    await firstCard.evaluate((node) => {
      window.cardBeforeRefresh = node
      window.holdSnapshots = true
      window.snapshotReplies = []
      window.snapshotVersion = ' refreshed'
    })
    const beforeRefresh = await firstCard.boundingBox()
    // Refresh without moving focus, as a background refresh would do.
    await library
      .getByRole('button', { name: native ? 'Refresh artifacts' : 'Refresh', exact: true })
      .evaluate((node) => node.click())
    await library.waitForFunction(() => window.snapshotReplies.length > 0)
    assert.equal(
      await firstCard.evaluate(
        (node) => node === window.cardBeforeRefresh && document.activeElement === node,
      ),
      true,
      'Refreshing preserves card identity and keyboard focus',
    )
    await firstCard.getByText('Snapshot from Host 0', { exact: true }).waitFor()
    assert.equal((await firstCard.boundingBox()).height, beforeRefresh.height)
    await library.evaluate(() => {
      window.holdSnapshots = false
      window.snapshotReplies.splice(0).forEach((resolve) => resolve())
    })
    await firstCard.getByText('Snapshot from Host 0 refreshed', { exact: true }).waitFor()
    assert.equal((await firstCard.boundingBox()).height, beforeRefresh.height)
    const chooseAction = async (label) => {
      if (native) {
        await cardContainer
          .getByRole('button', { name: 'Artifact actions API client', exact: true })
          .click()
        await library.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
        assert.equal(
          await library.getByRole('dialog').count(),
          1,
          'Action sheet closes before confirmation opens',
        )
      } else
        await cardContainer
          .getByRole('button', {
            name: label === 'Delete artifact' ? 'Delete artifact API client' : label,
            exact: true,
          })
          .click()
    }
    await chooseAction('Add to thread')
    await library.getByLabel('Destination thread', { exact: true }).selectOption('destination')
    await library
      .getByRole('dialog')
      .getByRole('button', { name: 'Add to thread', exact: true })
      .click()
    await library.getByText('Added to thread.', { exact: false }).first().waitFor()
    let mutations = await library.evaluate(() => window.artifactMutations)
    assert.equal(mutations[0].input.targetTaskId, 'destination')
    assert.equal(mutations[0].profile, '0')
    await chooseAction('Delete artifact')
    await library.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(
      (await library.evaluate(() => window.artifactMutations)).length,
      1,
      'Cancel must not delete',
    )
    await chooseAction('Delete artifact')
    await library.evaluate(() => (window.failArtifactMutation = true))
    await library
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete artifact', exact: true })
      .click()
    await library.getByText('Error: Artifact action failed', { exact: true }).waitFor()
    assert.equal(
      await library.locator('[aria-label^="Open artifact "]').count(),
      8,
      'Failed deletion keeps the artifact',
    )
    await library.evaluate(() => (window.failArtifactMutation = false))
    await library
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete artifact', exact: true })
      .click()
    await library.waitForFunction(
      () => document.querySelectorAll('[aria-label="Open artifact API client"]').length === 1,
    )
    assert.equal(await library.getByRole('button', { name: /^Open artifact / }).count(), 7)
    mutations = await library.evaluate(() => window.artifactMutations)
    assert.equal(mutations.at(-1).input.expectedRevision, 1)
    assert.ok(
      (await library.evaluate(() => window.snapshotCalls)).length > 0,
      'Visible cards request snapshots',
    )
    if (!native) {
      await chooseLibrary('Sort artifacts', 'title')
      await library.getByRole('button', { name: 'List view', exact: true }).click()
      await library.evaluate(() => window.showLibrary(false))
      await library.getByLabel('Search artifacts').waitFor({ state: 'hidden' })
      await library.evaluate(() => window.showLibrary(true))
      await cards.first().waitFor()
      assert.equal(await library.getByLabel('Sort artifacts').getAttribute('data-value'), 'title')
      assert.equal(
        await library
          .getByRole('button', { name: 'List view', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      )
    }
    await library.evaluate(() => {
      const sources = window.artifactWorkspace.runtimes.map((source, index) =>
        index === 0 ? { ...source, connected: false } : source,
      )
      window.artifactWorkspace.runtimes = sources
      window.artifactWorkspace.overviews = sources
      window.updateLibrary()
    })
    const offlineCard = library
      .getByRole('button', { name: 'Open artifact Budget calculator', exact: true })
      .first()
      .locator('..')
    await offlineCard
      .getByRole('button', { name: 'Artifact actions Budget calculator', exact: true })
      .click()
    if (native) {
      assert.equal(
        await library
          .getByRole('dialog')
          .getByRole('button', { name: 'Add to thread', exact: true })
          .isDisabled(),
        true,
      )
      assert.equal(
        await library
          .getByRole('dialog')
          .getByRole('button', { name: 'Delete artifact', exact: true })
          .isDisabled(),
        true,
      )
      await library.getByRole('button', { name: 'Close artifact actions', exact: true }).click()
    } else {
      assert.equal(
        await library
          .getByRole('menuitem', { name: 'Add to thread', exact: true })
          .getAttribute('aria-disabled'),
        'true',
      )
      assert.equal(
        await library
          .getByRole('menuitem', { name: 'Delete artifact', exact: true })
          .getAttribute('aria-disabled'),
        'true',
      )
      await library.keyboard.press('Escape')
    }
    assert.equal(await cards.count(), 7, 'Offline mode preserves saved rows')
    await library.close()
  }
  for (const platform of ['library', 'mobile-library']) {
    const native = platform === 'mobile-library'
    const recovery = await browser.newPage({
      viewport: { width: native ? 390 : 1280, height: 844 },
    })
    await prepareView(recovery, native)
    await recovery.evaluate(() => {
      window.recoveryMode = 'failed'
      window.recoveryReads = 0
      const source = {
        profile: {
          id: 'recovery',
          name: 'Recovery host',
          nameIsCustom: true,
          connection: { address: 'http://recovery.lan', token: 'first' },
        },
        connected: true,
        error: null,
        snapshot: {
          artifactsEnabled: true,
          workspace: { agents: [], repositories: [], tasks: [] },
        },
      }
      window.recoverySource = source
      window.artifactWorkspace = {
        runtimes: [source],
        overviews: [source],
        runtimeReadCache: () => ({ read: async () => null, write: async () => {} }),
        cacheForRuntime: () => ({ read: async () => null, write: async () => {} }),
        readRuntime: async (profile, path) => {
          if (path.endsWith('/snapshot')) return { excerpt: 'Saved preview' }
          window.recoveryReads++
          if (window.recoveryMode === 'failed') throw Error('Library temporarily unavailable')
          return {
            artifacts: [
              {
                id: 'saved',
                taskId: 'thread',
                title: 'Recovered document',
                format: 'markdown',
                revision: 1,
                createdAt: '2026-10-01',
                updatedAt: '2026-10-02',
                threadTitle: 'Research',
                threadState: 'active',
              },
            ],
          }
        },
      }
      window.changeRecovery = (patch) => {
        window.recoverySource = { ...window.recoverySource, ...patch }
        window.artifactWorkspace.runtimes = [window.recoverySource]
        window.artifactWorkspace.overviews = [window.recoverySource]
        window.updateLibrary()
      }
    })
    await recovery.addScriptTag({ content: interfaces.find((ui) => ui.platform === platform).code })
    await recovery.getByText('Couldn’t load artifacts', { exact: true }).waitFor()
    assert.equal(
      await recovery.getByText('Your next idea belongs here', { exact: true }).count(),
      0,
    )
    await recovery
      .getByRole('alert')
      .filter({ hasText: 'Library temporarily unavailable' })
      .waitFor()
    await recovery.evaluate(() => (window.recoveryMode = 'ready'))
    await recovery.getByRole('button', { name: 'Retry loading artifacts', exact: true }).click()
    const recovered = recovery.getByRole('button', {
      name: 'Open artifact Recovered document',
      exact: true,
    })
    await recovered.waitFor()
    assert.equal(await recovery.evaluate(() => window.recoveryReads), 2)
    await recovery.evaluate(() => window.changeRecovery({ connected: false, error: 'Offline' }))
    await recovery.getByText(/Recovery host is offline/).waitFor()
    assert.equal(await recovered.count(), 1, 'Disconnecting keeps the recovered artifacts')
    if (!native) {
      await recovery.evaluate(() => window.changeRecovery({ error: null }))
      await recovered.click()
      await recovery
        .getByRole('status')
        .filter({ hasText: 'Connecting to Recovery host…' })
        .waitFor()
      assert.equal(
        await recovery
          .getByRole('heading', { name: 'Recovery host is offline', exact: true })
          .count(),
        0,
      )
      await recovery.getByRole('button', { name: 'Back to artifacts', exact: true }).first().click()
      await recovery.evaluate(() => window.changeRecovery({ error: 'Offline' }))
      await recovery.getByText(/Recovery host is offline/).waitFor()
    }
    await recovery.getByLabel('Search artifacts').fill('not in saved results')
    await recovery
      .getByText('No matches in available artifacts. Some computers could not be checked.', {
        exact: true,
      })
      .waitFor()
    await recovery.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await recovery.evaluate(() =>
      window.changeRecovery({
        profile: {
          ...window.recoverySource.profile,
          connection: { address: 'http://recovery.lan', token: 'second' },
        },
      }),
    )
    await recovery.getByText('Connect a computer', { exact: true }).waitFor()
    assert.equal(await recovered.count(), 0, 'A new pairing cannot inherit saved artifacts')
    await recovery.evaluate(() => window.changeRecovery({ error: null }))
    await recovery.getByText(native ? 'Loading' : 'Loading artifacts…', { exact: true }).waitFor()
    assert.equal(
      await recovery.getByText('Connect a computer', { exact: true }).count(),
      0,
      'Connecting is not reported as offline',
    )
    assert.equal(await recovery.getByText(/Recovery host is offline/).count(), 0)
    await recovery.close()
  }
  {
    const owners = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await prepareView(owners)
    await owners.evaluate(() => {
      const artifact = (id, title) => ({
        id,
        taskId: 'thread',
        title,
        format: 'markdown',
        revision: 1,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
        threadTitle: 'Research',
        threadState: 'active',
      })
      const runtime = (id, name, token) => ({
        profile: {
          id,
          name,
          nameIsCustom: true,
          connection: { address: `http://${id}.lan`, token },
        },
        connected: true,
        snapshot: {
          artifactsEnabled: true,
          workspace: { agents: [], repositories: [], tasks: [] },
        },
      })
      window.ownerRuntimes = [runtime('a', 'Host A', 'first'), runtime('b', 'Host B', 'first')]
      window.ownerCalls = []
      window.pendingB = []
      window.replicas = new Map()
      const replica = (profile) => `${profile.id}:${profile.connection.token}`
      window.artifactWorkspace = {
        connected: true,
        activeRuntimeId: 'a',
        snapshot: { artifactsEnabled: true },
        get runtimes() {
          return window.ownerRuntimes
        },
        switchRuntime: async () => {},
        runtimeReadCache: (profile) => ({
          read: async () => window.replicas.get(replica(profile)) ?? null,
          write: async (_key, value) =>
            window.replicas.set(replica(profile), { value, cachedAt: '2026-10-14T09:00:00Z' }),
        }),
        readRuntime: (profile, path) => {
          if (path.endsWith('/snapshot')) return Promise.resolve({ excerpt: 'Snapshot' })
          window.ownerCalls.push(profile.id)
          if (profile.id === 'b') return new Promise((resolve) => window.pendingB.push(resolve))
          if (window.failA) return Promise.reject(new Error('403 Forbidden'))
          return Promise.resolve({ artifacts: [artifact('a1', 'Alpha notes')] })
        },
      }
      window.artifactRequest = async () => ({ artifacts: [] })
      window.setRuntime = (id, patch) => {
        window.ownerRuntimes = window.ownerRuntimes.map((entry) =>
          entry.profile.id === id
            ? {
                ...entry,
                ...patch,
                profile: { ...entry.profile, ...patch.profile },
              }
            : entry,
        )
        window.updateLibrary()
      }
      window.resolveB = (index, title) =>
        window.pendingB[index]({ artifacts: [artifact(`b${index}`, title)] })
    })
    await owners.addScriptTag({ content: interfaces.find((ui) => ui.platform === 'library').code })
    const row = (title) => owners.getByRole('button', { name: `Open artifact ${title}` })
    await row('Alpha notes').waitFor()
    // Host B is still loading; a newer read must win over the slower older reply.
    await owners.evaluate(() => window.setRuntime('b', { connected: false, error: 'Offline' }))
    await owners.getByText('Host B is offline.', { exact: false }).waitFor()
    await owners.evaluate(() => window.setRuntime('b', { connected: true }))
    await owners.waitForFunction(() => window.pendingB.length === 2)
    await owners.evaluate(() => window.resolveB(1, 'Fresh B'))
    await row('Fresh B').waitFor()
    await owners.evaluate(() => window.resolveB(0, 'Stale B'))
    await owners.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))
    assert.equal(
      await row('Stale B').count(),
      0,
      'Slow earlier results must not replace newer rows',
    )
    assert.equal(await row('Fresh B').count(), 1)

    const onlineCardHeight = (await row('Alpha notes').boundingBox()).height
    await owners.evaluate(() => window.setRuntime('a', { connected: false, error: 'Offline' }))
    await owners.getByText('Host A is offline. Showing artifacts saved', { exact: false }).waitFor()
    assert.equal(await row('Alpha notes').count(), 1, 'Disconnects keep the last healthy rows')
    assert.equal(
      (await row('Alpha notes').boundingBox()).height,
      onlineCardHeight,
      'Disconnecting preserves desktop preview space',
    )
    await row('Alpha notes').getByText('Snapshot', { exact: true }).waitFor()
    assert.equal(await owners.getByRole('alert').count(), 0)
    assert.deepEqual(await owners.evaluate(() => window.ownerCalls), ['a', 'b', 'b'])

    await owners.getByLabel('Search artifacts').fill('Alpha')
    await row('Alpha notes').click()
    await owners.getByRole('heading', { name: 'Host A is offline', exact: true }).waitFor()
    await owners.evaluate(() => window.showLibrary(false))
    await owners.getByLabel('Search artifacts').waitFor({ state: 'detached' })
    await owners.evaluate(() => window.showLibrary(true))
    await owners.waitForFunction(() => window.ownerCalls.length === 4)
    assert.equal(await owners.getByLabel('Search artifacts').inputValue(), 'Alpha')
    assert.equal(
      await owners.getByRole('heading', { level: 1 }).textContent(),
      'Alpha notes',
      'Section navigation keeps the selected artifact',
    )
    assert.deepEqual(
      await owners.evaluate(() => window.ownerCalls),
      ['a', 'b', 'b', 'b'],
      'Remounting reads connected computers again but never the offline one',
    )

    await owners.evaluate(() =>
      window.setRuntime('a', {
        profile: { connection: { address: 'http://a.lan', token: 'second' } },
      }),
    )
    await owners.getByText('Artifact unavailable', { exact: true }).first().waitFor()
    assert.equal(
      await row('Alpha notes').count(),
      0,
      'A re-paired computer must not borrow the previous pairing’s rows',
    )
    await owners.getByRole('button', { name: 'Back to artifacts', exact: true }).first().click()
    await owners.getByLabel('Search artifacts').fill('')
    await owners.evaluate(() => {
      window.failA = true
      window.setRuntime('a', { connected: true })
    })
    assert.match(
      await owners.getByRole('alert').textContent(),
      /Host A: 403 Forbidden/,
      'Request failures stay distinct from disconnects',
    )
    await owners.close()
  }
  {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await prepareView(mobile)
    await mobile.evaluate(() => {
      const artifact = (title) => ({
        id: title,
        taskId: 'source-thread',
        title,
        format: 'markdown',
        revision: 1,
        createdAt: '2026-10-01',
        updatedAt: '2026-10-02',
        threadTitle: 'Source thread',
        threadState: 'active',
      })
      const runtime = (id) => ({
        profile: {
          id,
          name: id,
          nameIsCustom: true,
          connection: { address: 'http://' + id + '.lan', token: 'first' },
        },
        connected: true,
        snapshot: {
          artifactsEnabled: true,
          workspace: { tasks: [], agents: [], repositories: [] },
        },
      })
      window.mobileSources = [runtime('Fast'), runtime('Slow')]
      window.mobileReads = []
      window.slowReplies = []
      window.replica = new Map()
      const cache = (profile) => ({
        read: async () => window.replica.get(profile.id + profile.connection.token) ?? null,
        write: async (_key, value) =>
          window.replica.set(profile.id + profile.connection.token, {
            value,
            cachedAt: '2026-10-23',
          }),
      })
      window.artifactWorkspace = {
        get overviews() {
          return window.mobileSources
        },
        cacheForRuntime: cache,
        readRuntime: (profile, path) => {
          if (path.endsWith('/snapshot')) return Promise.resolve({ excerpt: 'Snapshot' })
          window.mobileReads.push(profile.id)
          return profile.id === 'Slow'
            ? new Promise((resolve) => window.slowReplies.push(resolve))
            : Promise.resolve({ artifacts: [artifact('Fast notes')] })
        },
      }
      window.resolveSlow = (index, title) =>
        window.slowReplies[index]({ artifacts: [artifact(title)] })
      window.changeMobile = (id, patch) => {
        window.mobileSources = window.mobileSources.map((source) =>
          source.profile.id === id ? { ...source, ...patch } : source,
        )
        window.updateLibrary()
      }
    })
    await mobile.addScriptTag({
      content: interfaces.find((ui) => ui.platform === 'mobile-library').code,
    })
    const card = (title) =>
      mobile.getByRole('button', { name: 'Open artifact ' + title, exact: true })
    await card('Fast notes').waitFor()
    assert.deepEqual(await mobile.evaluate(() => window.mobileReads), ['Fast', 'Slow'])
    await mobile.evaluate(() => window.changeMobile('Slow', { connected: false, error: 'Offline' }))
    await mobile.getByText(/Slow is offline/).waitFor()
    await mobile.evaluate(() => window.changeMobile('Slow', { connected: true }))
    await mobile.waitForFunction(() => window.slowReplies.length === 2)
    await mobile.evaluate(() => window.resolveSlow(1, 'Fresh slow notes'))
    await card('Fresh slow notes').waitFor()
    await mobile.evaluate(() => window.resolveSlow(0, 'Stale notes'))
    assert.equal(await card('Stale notes').count(), 0)
    const onlineCardHeight = (await card('Fast notes').boundingBox()).height
    await mobile.evaluate(() => window.changeMobile('Fast', { connected: false, error: 'Offline' }))
    await mobile.getByText(/Fast is offline. Showing saved artifacts/).waitFor()
    assert.equal(await card('Fast notes').count(), 1)
    assert.equal(
      (await card('Fast notes').boundingBox()).height,
      onlineCardHeight,
      'Disconnecting preserves mobile preview space',
    )
    await card('Fast notes').getByText('Snapshot', { exact: true }).waitFor()
    await mobile.evaluate(() =>
      window.changeMobile('Fast', {
        profile: {
          ...window.mobileSources[0].profile,
          connection: { address: 'http://Fast.lan', token: 'repaired' },
        },
      }),
    )
    await card('Fast notes').waitFor({ state: 'detached' })
    await mobile.evaluate(() => {
      window.mobileSources = []
      window.updateLibrary()
    })
    await card('Fresh slow notes').waitFor({ state: 'detached' })
    await mobile.close()
  }
  assert.deepEqual(pageErrors, [], 'Artifact interfaces must not raise browser errors')
  console.log(
    'Artifacts: thread cards open beside chat, expanded versions, desktop/mobile galleries and filters, desktop sidebar detail, per-owner offline retention, re-pairing isolation, slow replies, remembered filters and selection, hosted links, thread and host isolation, interactive HTML/SVG, sandbox, lazy snapshots, versions, PDF/PNG configuration and downloads/mobile sharing/failure recovery, temporary export editing and exclusions, add to thread, deletion/cancellation/error recovery, copy and source views passed.',
  )
} finally {
  await browser.close()
}
