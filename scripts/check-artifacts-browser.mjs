import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const uiRoot = root + 'packages/studio-ui/src/'
const screenshotDirectory = process.env.DOVO_ARTIFACT_SCREENSHOTS
const css = screenshotDirectory
  ? readdirSync(root + 'apps/web/dist/client/assets')
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(root + 'apps/web/dist/client/assets/' + file, 'utf8'))
      .join('\n')
  : ''
if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true })
async function prepareView(page, native = false) {
  page.setDefaultTimeout(10000)
  await page.setContent(
    `<html class="dark"><body style="${native ? 'margin:0;background:#0a0a0a;color:#e8e9ed;font-family:system-ui' : 'margin:0'}"><div id="app" style="height:100dvh"></div></body></html>`,
  )
  if (css && !native) await page.addStyleTag({ content: css })
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
  // The real markdown renderer now follows the selected Studio palette.
  '@dovo/studio-core': `export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes.ts';export const useAppPreferences=()=>({themePalette:'dovo'});import React,{createContext,useContext} from 'react';const Context=createContext(null);export const useResolvedTheme=()=> 'dark';export const useWorkspace=()=>useContext(Context)??window.artifactWorkspace??({request:window.artifactRequest,connected:true,activeRuntimeId:'runtime',snapshot:{artifactsEnabled:window.artifactsEnabled}});export const WorkspaceScope=({profile,children})=><Context.Provider value={{...useWorkspace(),activeRuntimeId:profile.id,snapshot:{artifactsEnabled:true},request:(path,input)=>window.artifactRequest(path,input,profile.id)}}>{children}</Context.Provider>;`,
  '@dovo/studio-ui': `
import React from 'react';import {Button} from '${uiRoot}components/ui/button.tsx';
export {Button};export {cn} from '${uiRoot}lib/utils.ts';
export {Input} from '${uiRoot}components/ui/input.tsx';
export {Dialog,DialogContent,DialogDescription,DialogTitle} from '${uiRoot}components/ui/dialog.tsx';
export {EmptyState} from '${uiRoot}components/empty-state.tsx';
export {MessageResponse} from '${uiRoot}components/ai-elements/message.tsx';
export const IconButton=({label,...props})=><Button variant="ghost" size="icon" aria-label={label} {...props}/>;
export const Tooltip=({children})=><>{children}</>;export const TooltipTrigger=({children})=>children;export const TooltipContent=()=>null;
`,
  '../../runtime/connection/provider': `import {useWorkspace} from '@dovo/studio-core';export const useRuntime=()=>{const value=useWorkspace();return {...value,read:value.request,activeId:value.activeRuntimeId}};`,
  'react-native': `
import React from 'react';
export const flatten=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
const webStyle=style=>{const value=flatten(style);if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';if(value.paddingHorizontal!==undefined){value.paddingLeft=value.paddingRight=value.paddingHorizontal;delete value.paddingHorizontal}if(value.paddingVertical!==undefined){value.paddingTop=value.paddingBottom=value.paddingVertical;delete value.paddingVertical}if(value.marginVertical!==undefined){value.marginTop=value.marginBottom=value.marginVertical;delete value.marginVertical}return value};
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,...webStyle(style)}}>{children}</div>;
export const ScrollView=({children,style,contentContainerStyle,horizontal})=><View style={[{overflow:'auto',flexShrink:1},style]}><View style={[horizontal?{flexDirection:'row'}:{},contentContainerStyle]}>{children}</View></View>;
export const Modal=({children})=><View style={{position:'fixed',inset:0}}>{children}</View>;export const ActivityIndicator=()=> <p>Loading</p>;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityState,disabled,style})=><button onClick={onPress} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',color:'#e8e9ed',textAlign:'left',fontFamily:'system-ui',flexShrink:0,...webStyle(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style})=><span style={webStyle(style)}>{children}</span>;
export const FlatList=({data,renderItem,ListEmptyComponent,contentContainerStyle})=><ScrollView contentContainerStyle={contentContainerStyle}>{data.length?data.map((item,index)=><React.Fragment key={index}>{renderItem({item})}</React.Fragment>):ListEmptyComponent}</ScrollView>;
export const Alert={alert:()=>{}};export const StyleSheet={create:x=>x};export const Platform={OS:'ios'};
`,
  'react-native-safe-area-context': `import {View} from 'react-native';export const SafeAreaProvider=({children})=><View style={{flex:1,minHeight:0}}>{children}</View>;export const SafeAreaView=View;`,
  'react-native-webview': `import React from 'react';export default ({source})=><iframe title="Mobile preview" sandbox="allow-scripts" srcDoc={source.html}/>;`,
  'expo-file-system': `export class File {};export const Paths={cache:''};`,
  'expo-sharing': `export const isAvailableAsync=async()=>false;export const shareAsync=async()=>{};`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  './text': `export {Text} from 'react-native';`,
  '../ui/content/text': `export {Text} from 'react-native';`,
  './markdown': `import React from 'react';export const Markdown=({text})=><p>{text}</p>;`,
  './open-link': `export const openAppLink=async url=>{window.openedArtifactLinks.push(url)};`,
  '../controls/action': `import React from 'react';export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`,
  '../controls/icon': `import {FileText,Files,CodeXml,Eye,Globe,ChevronRight,ArrowUpRight,History,Share2,RotateCw,X,Check} from 'lucide-react';const icons={artifact:FileText,artifactList:Files,code:CodeXml,preview:Eye,web:Globe,next:ChevronRight,external:ArrowUpRight,history:History,share:Share2,refresh:RotateCw,close:X,check:Check};export const Icon=({name,size=20,color='#a0a1a8'})=>{const Glyph=icons[name];return Glyph?<Glyph aria-hidden="true" size={size} color={color}/>:null};`,
  '../ui/controls/icon': `export {Icon} from '../controls/icon';`,
  '../controls/icon-button': `import React from 'react';import {Icon} from '../controls/icon';export const IconButton=({label,icon,onPress,disabled})=><button aria-label={label} data-icon={icon} disabled={disabled} onClick={onPress} style={{width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:0,opacity:disabled?0.4:1}}><Icon name={icon}/></button>;`,
  '../runtime/connection/provider': `import {useWorkspace,WorkspaceScope} from '@dovo/studio-core';export const useRuntime=()=>useWorkspace();export const RuntimeScope=({runtimeId,children})=><WorkspaceScope profile={window.artifactWorkspace.overviews.find(x=>x.profile.id===runtimeId).profile}>{children}</WorkspaceScope>;`,
  '../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title,subtitle,buttons})=><header><h1>{title}</h1><p>{subtitle}</p>{buttons.map(button=><button key={button.label} aria-label={button.label} disabled={button.disabled} onClick={button.onPress}>{button.label}</button>)}</header>;`,
  '../ui/controls/field': `export const SearchField=({label,value,onChangeText,placeholder})=><input aria-label={label} value={value} placeholder={placeholder} onChange={event=>onChangeText(event.target.value)}/>;`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  '../ui/controls/action': `export {Action} from '../controls/action';`,
}
const interfaces = await Promise.all(
  ['desktop', 'mobile', 'library', 'mobile-library'].map(async (platform) => {
    const contents =
      platform === 'library'
        ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import ArtifactsView from './src/artifacts-view.tsx';function App(){const[tick,setTick]=useState(0);window.updateLibrary=()=>setTick(x=>x+1);return <ArtifactsView/>}createRoot(document.getElementById('app')).render(<App/>);`
        : platform === 'mobile-library'
          ? `import {createRoot} from 'react-dom/client';import ArtifactsScreen from './src/screens/artifacts.tsx';createRoot(document.getElementById('app')).render(<ArtifactsScreen/>);`
          : platform === 'desktop'
            ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {ThreadArtifacts,ArtifactCard} from './src/chat/artifacts.tsx';import {ArtifactOpenContext} from './src/chat/artifact-open-context.ts';import {TaskTools} from './src/detail/task-tools.tsx';function App(){const[surface,setSurface]=useState('chat'),[taskId,setTaskId]=useState('thread'),[selection,setSelection]=useState();window.switchArtifactThread=setTaskId;return <div style={{height:'100%',display:'flex'}}><div style={{flex:1,padding:24}}><ArtifactOpenContext value={reference=>{setSelection(previous=>({taskId:reference.taskId,id:reference.id,key:(previous?.key??0)+1}));setSurface('artifacts')}}><ArtifactCard reference={{id:'interactive',taskId,title:'Counter',format:'html',revision:1}}/></ArtifactOpenContext></div>{surface==='artifacts'&&<div style={{width:480,height:'100%'}}><ThreadArtifacts key={taskId+':'+selection?.key} taskId={taskId} initialId={selection?.taskId===taskId?selection.id:undefined} onClose={()=>{setSurface('chat');setSelection(undefined)}}/></div>}<TaskTools surface={surface} onSelect={setSurface} hasDiff={false} artifactsEnabled={window.artifactsEnabled}/></div>}createRoot(document.getElementById('app')).render(<App/>);`
            : `import {createRoot} from 'react-dom/client';import {ArtifactCard} from './src/ui/content/artifacts.tsx';createRoot(document.getElementById('app')).render(<ArtifactCard reference={{id:'notes',taskId:'thread',title:'Notes',format:'markdown',revision:2}}/>);`
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
    frame.sandbox = 'allow-scripts'
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
      window.artifactRequest = async (path, input) => {
        window.artifactCalls.push({ path, input })
        if (path.endsWith('/list'))
          return {
            artifacts: window.artifactLinksOnly ? [] : [notes, interactive],
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
        const metadata = { ...(input.id === 'notes' ? notes : interactive), taskId: input.taskId }
        if (path.endsWith('/versions'))
          return {
            versions: metadata.id === 'notes' ? [notes, { ...notes, revision: 1 }] : [interactive],
          }
        return {
          artifact: {
            ...metadata,
            revision: input.revision ?? metadata.revision,
            content:
              metadata.id === 'notes'
                ? input.revision === 1
                  ? 'Earlier notes'
                  : input.taskId === 'other-thread'
                    ? 'Other thread notes'
                    : 'Current notes'
                : '<button id="interactive">Interactive artifact</button>',
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
    assert.equal(
      await view.evaluate(() => window.artifactCalls.length),
      0,
      'Closed cards must not fetch artifact bodies',
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
      await view.frameLocator('iframe').frameLocator('iframe').locator('#interactive').waitFor()
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
    await view.getByText('Current notes', { exact: true }).waitFor()
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
      await view.setViewportSize({ width: 320, height: 700 })
      const boxes = await Promise.all(
        [
          'Choose artifact',
          'Choose version · latest version',
          'View artifact source code',
          'Share artifact',
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
    await view.getByText('Earlier notes', { exact: true }).waitFor()
    if (ui.platform === 'desktop') {
      await view.getByRole('button', { name: 'Expand artifact', exact: true }).click()
      await view.getByRole('dialog').waitFor()
      await view.getByText('Earlier notes', { exact: true }).waitFor()
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
    await view.frameLocator('iframe').frameLocator('iframe').locator('#interactive').waitFor()
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Source' : 'View artifact source code',
        exact: true,
      })
      .click()
    await view
      .getByText('<button id="interactive">Interactive artifact</button>', { exact: true })
      .waitFor()

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
        formats.map((item, index) => ({
          ...metadata,
          ...item,
          id: `${host}-${item.format}`,
          updatedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
        }))
      const sources = profiles.map((profile, index) => ({
        profile,
        connected: index !== 2,
        snapshot: { artifactsEnabled: true },
      }))
      window.libraryCalls = []
      window.previewHosts = []
      window.artifactWorkspace = {
        connected: true,
        activeRuntimeId: '0',
        snapshot: { artifactsEnabled: true },
        runtimes: sources,
        overviews: sources,
        readRuntime: async (profile) => {
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
    assert.equal(
      await cards.first().getAttribute('aria-label'),
      'Open artifact API client',
      'Library must show recently updated artifacts first',
    )
    if (!native) assert.match(await library.getByRole('alert').textContent(), /Offline host/)
    else await library.getByText(/Offline host/).waitFor()
    assert.deepEqual(await library.evaluate(() => window.libraryCalls), ['0', '1'])
    assert.deepEqual(
      await library.evaluate(() => window.previewHosts),
      [],
      'Browsing the gallery must not fetch artifact bodies',
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
    await library.getByLabel('Search artifacts').fill('document')
    assert.equal(await cards.count(), 2, 'Search must match the format labels shown on cards')
    await library.getByLabel('Search artifacts').fill('Host B')
    assert.equal(await cards.count(), 4)
    await library.getByRole('button', { name: 'Code', exact: true }).click()
    assert.equal(await cards.count(), 1)
    await library.getByLabel('Artifact thread state').selectOption('archived')
    await library.getByText('No matching artifacts', { exact: true }).waitFor()
    await library.getByRole('button', { name: 'Clear filters', exact: true }).click()
    assert.equal(await cards.count(), 8)
    await library.getByLabel('Search artifacts').fill('Host B')
    await library.getByRole('button', { name: 'Document', exact: true }).click()
    assert.equal(await cards.count(), 1)
    await cards.click()
    await library.getByText('Content from Host 1', { exact: true }).waitFor()
    assert.ok((await library.evaluate(() => window.previewHosts)).every((host) => host === '1'))
    if (!native) {
      await library.getByRole('button', { name: 'Copy source', exact: true }).click()
      await library.getByRole('button', { name: 'Copied source', exact: true }).waitFor()
      assert.equal(await library.evaluate(() => window.copiedSource), 'Content from Host 1')
      if (screenshotDirectory)
        await library.screenshot({ path: `${screenshotDirectory}/library-preview.png` })
      await library.getByRole('button', { name: 'Close', exact: true }).click()
    } else
      await library.getByRole('button', { name: 'Close artifact preview', exact: true }).click()
    assert.deepEqual(
      await library.evaluate(() => window.libraryCalls),
      ['0', '1'],
      'Snapshot rerenders and previews must not reload the global library',
    )
    await library.close()
  }
  assert.deepEqual(pageErrors, [], 'Artifact interfaces must not raise browser errors')
  console.log(
    'Artifacts: thread cards open beside chat, expanded versions, desktop/mobile galleries and filters, hosted links, thread and host isolation, interactive HTML/SVG, sandbox, lazy loading, versions, copy and source views passed.',
  )
} finally {
  await browser.close()
}
