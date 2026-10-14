import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm, mkdir, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const mocks = {
  '@dovo/studio-ui': `export {MessageResponse} from '${ui}/components/ai-elements/message.tsx';export {FileTypeIcon} from '${ui}/file-tree.tsx';export {Button} from '${ui}/components/ui/button.tsx';export {IconButton} from '${ui}/components/icon-button.tsx';export {TooltipProvider} from '${ui}/components/ui/tooltip.tsx';export {RepositoryOpenItems} from '${ui}/repository-open-items.tsx';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {cn} from '${ui}/lib/utils.ts';export {Dialog,DialogContent,DialogTitle} from '${ui}/components/ui/dialog.tsx';`,
  '@dovo/studio-core': `export {responses} from '@dovo/protocol';export {studioSyntaxTheme} from '${root}/packages/studio-core/src/themes.ts';export const useResolvedTheme=()=> 'dark';export const useAppPreferences=()=>({themePalette:'dovo'});export const useWorkspace=()=>window.runtime;const openExternalLink=async url=>window.opened.push(url);export const useStudioHost=()=>({openExternalLink});`,
  '../../runtime/connection/provider': 'export const useRuntime=()=>window.runtime;',
  '../theme': `export const useTheme=()=>({mode:'dark',colors:{surface:'#181818',text:'#eee',muted:'#999',border:'#333',background:'#111',accent:'#88bbee'},styles:{muted:{color:'#999'}}});`,
  '../../runtime/preferences/app-preferences':
    'export const carZoom=1;export const useCarMode=()=>false;',
  '../layout/safe-modal':
    'export const SafeModal=({children})=><div role="dialog">{children}</div>;',
  './text': 'export const Text=({children,style})=><span style={style}>{children}</span>;',
  './server-image':
    'export const ServerImage=({label,source})=><img alt={label} data-image-source={JSON.stringify(source)} src={window.imageURI} style={{maxWidth:"100%",borderRadius:10}}/>;',
  '../layout/sheet':
    'export const useSheetNavigation=()=>navigate=>navigate();export const Sheet=({children,title,onClose})=><div role="dialog" aria-label={title}><button onClick={onClose}>Close preview</button>{children}</div>;',
  '../controls/action':
    'export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
  '../../runtime/state/application-state': "export {useState as useApplicationState} from 'react';",
  '@dovo/studio-core/state': "export {useState as useApplicationState} from 'react';",
  './file-tree': `export {FileTypeIcon as MobileFileTypeIcon} from '${ui}/file-tree.tsx';`,
  'expo-clipboard': 'export const setStringAsync=async value=>{window.copied=value};',
  'react-native-webview':
    'export default ({source})=>source.html?<iframe title="Native visualization" sandbox="allow-scripts" srcDoc={source.html}/>:<div data-video-preview={source.uri}><video src={window.fakeVideo} controls style={{width:"100%",borderRadius:10}}/></div>;',

  './mermaid-diagram': 'export const MermaidDiagram=()=>null;',
  './open-link':
    'export const openAppLink=async(url,external)=>{window.opened.push(url);window.external=external};export const useOpenAppLink=()=>openAppLink;',
  'react-native': `export const useWindowDimensions=()=>({height:844,width:390});export const ActivityIndicator=()=>null;export const ScrollView=({children})=><div>{children}</div>;export const Platform={OS:'ios'};export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',minWidth:0,...style}}>{children}</div>;export const Pressable=({children,onPress,accessibilityLabel,style})=><button aria-label={accessibilityLabel} onClick={onPress} style={{display:'flex',font:'inherit',textAlign:'left',color:'inherit',background:'transparent',...style}}>{children}</button>;export const Alert={alert:(title,message)=>window.alerts.push(title+': '+message)};`,
  'react-native-enriched-markdown': `import {fromMarkdown} from 'mdast-util-from-markdown';const nativeStyle=style=>{const {underline,...rest}=style??{};return {...rest,textDecoration:underline?'underline':undefined,lineHeight:style?.lineHeight?style.lineHeight+'px':undefined}};export const EnrichedMarkdownText=({markdown,onLinkPress,markdownStyle})=>{const render=node=>node.type==='link'?<a style={nativeStyle({...markdownStyle.link,...Object.entries(markdownStyle.linkVariants??{}).find(([pattern])=>new RegExp(pattern).test(node.url))?.[1]})} href={node.url} onClick={event=>{event.preventDefault();onLinkPress({url:node.url})}}>{node.children.map(render)}</a>:node.type==='paragraph'?<p style={nativeStyle(markdownStyle.paragraph)}>{node.children.map(render)}</p>:node.type==='heading'?<h2 style={nativeStyle(markdownStyle['h'+node.depth])}>{node.children.map(render)}</h2>:node.children?<>{node.children.map((child,index)=><span key={index}>{render(child)}</span>)}</>:node.value??'';return <div>{render(fromMarkdown(markdown))}</div>};`,
}
const built = await build({
  stdin: {
    resolveDir: root + '/packages/studio-ui',
    loader: 'tsx',
    contents: `import {TooltipProvider} from '@dovo/studio-ui';import {useState} from 'react';import {createRoot} from 'react-dom/client';import {TaskMessageResponse} from '${root}/packages/extension-tasks/src/chat/thread/task-message-response.tsx';import {Markdown} from '${root}/apps/mobile/src/ui/content/markdown.tsx';window.opened=[];window.alerts=[];window.reads=[];window.prompts=[];window.runtime={connected:true,connection:{address:'http://remote-runtime.test:7777',token:'device-secret'},request:async(path,input)=>{window.reads.push({path,input});if(window.fail)throw new Error('File is no longer available');return path.endsWith('/visualizations/read')?{path:input.path,contents:'<button id="sample-counter" onclick="this.textContent=Number(this.textContent)+1">0</button>'}:path.endsWith('/open-targets')?{targets:['vscode']}:path.endsWith('/open')?{ok:true,revision:1}:path.endsWith('/share')?{url:'/api/tasks/files/shared/scoped-ticket'}:{uri:window.imageURI??'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6K0sAAAAASUVORK5CYII='}}};window.runtime.read=window.runtime.request;const richText='## Release preview\\n\\nScreenshot ready:\\n[New interface](/tmp/interface.png)\\n\\n[Demo video](/tmp/demo.mp4)\\n\\n[Design report](/tmp/report.pdf)\\n\\nImplementation: :codex-file-citation{path="/tmp/app.ts" line_range_start="12" line_range_end="18"}.\\n\\n::artifact-template{artifact_kind="site" display_name="Product landing page" skill_name="artifact-template-site" skill_directory="/tmp/skills/site"}';const visualText=String.fromCharCode(0xe200)+'visualize'+String.fromCharCode(0xe202)+JSON.stringify({path:'/tmp/demo.html',title:'Interactive demo',mode:'wide'})+String.fromCharCode(0xe201);function App(){const [visual,setVisual]=useState(false);window.renderVisualization=()=>setVisual(true);const [rich,setRich]=useState(false);window.renderRich=()=>setRich(true);const [revision,setRevision]=useState(0),[suffix,setSuffix]=useState(''),[connectionRevision,setConnectionRevision]=useState(0);window.setConnected=value=>{window.runtime.connected=value;setConnectionRevision(v=>v+1)};window.append=()=>setSuffix(String.fromCharCode(10,10)+'More response text');window.refresh=()=>setRevision(value=>value+1);return <main key={revision} className="studio" style={{padding:24,background:'var(--background)',color:'var(--foreground)',fontFamily:'system-ui'}}>{rich ? <><section data-client="desktop"><TaskMessageResponse taskId="task" onUseTemplate={value=>window.prompts.push(value)}>{visual?visualText:richText}</TaskMessageResponse></section><section data-client="mobile"><Markdown taskId="task" text={visual?visualText:richText} onUseTemplate={value=>window.prompts.push(value)}/></section></> : <><section data-client="desktop"><TaskMessageResponse taskId="task">{'[Source](</Users/dominic/a b.ts:12>) · [File](file:///tmp/report.pdf) · [Website](https://example.com)\\n\\n![Screenshot](/tmp/shot.png)'+suffix}</TaskMessageResponse></section><section data-client="mobile"><Markdown taskId="task" text={'[Source](</Users/dominic/a b.ts:12>) · [File](file:///tmp/report.pdf) · [Website](https://example.com)'}/></section></>}</main>}createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);`,
  },
  nodePaths: [root + '/apps/desktop/node_modules', root + '/packages/runtime/node_modules'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/apps/desktop/node_modules/react',
    'react-dom': root + '/apps/desktop/node_modules/react-dom',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
    '@dovo/studio-ui/code-themes': ui + '/code-themes.ts',
  },
  plugins: [
    {
      name: 'mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
let server
let directory
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const localNetwork = []
  page.on('request', (request) => {
    if (request.url().includes('dovo-local-file.invalid')) localNetwork.push(request.url())
  })
  const media = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 300
    const context = canvas.getContext('2d')
    context.fillStyle = '#151820'
    context.fillRect(0, 0, 640, 300)
    context.fillStyle = '#9bbaff'
    context.font = 'bold 24px system-ui'
    context.fillText('Dovo · Release preview', 30, 45)
    context.fillStyle = '#242a38'
    context.fillRect(24, 70, 592, 204)
    context.fillStyle = '#dbe4ff'
    context.font = '18px system-ui'
    context.fillText('Rich thread rendering', 48, 112)
    context.fillStyle = '#8cddb3'
    context.fillRect(48, 138, 220, 10)
    context.fillStyle = '#7886a2'
    context.fillRect(48, 164, 440, 8)
    context.fillRect(48, 190, 350, 8)
    const image = canvas.toDataURL('image/png')
    const stream = canvas.captureStream(10),
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }),
      chunks = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const done = new Promise((resolve) => {
      recorder.onstop = resolve
    })
    recorder.start()
    let frame = 0
    const animation = setInterval(() => {
      context.fillStyle = '#242a38'
      context.fillRect(48, 240, 500, 12)
      context.fillStyle = '#8cddb3'
      context.fillRect(48, 240, 20 + frame++ * 15, 12)
    }, 80)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    clearInterval(animation)
    recorder.stop()
    await done
    stream.getTracks().forEach((track) => track.stop())
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
    return { image, video: btoa(String.fromCharCode(...bytes)) }
  })
  await page.route(
    'http://remote-runtime.test:7777/api/tasks/files/shared/scoped-ticket?content=1',
    (route) =>
      route.fulfill({ contentType: 'video/webm', body: Buffer.from(media.video, 'base64') }),
  )
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate((media) => {
    window.imageURI = media.image
    window.fakeVideo = 'data:video/webm;base64,' + media.video
  }, media)
  const desktop = page.locator('[data-client="desktop"]')
  await desktop.getByRole('img', { name: 'Screenshot' }).waitFor()
  assert.equal(await desktop.getByText('[blocked]', { exact: false }).count(), 0)
  await desktop.getByRole('button', { name: 'Website', exact: true }).waitFor()
  await desktop.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('dialog').locator('iframe').waitFor()
  const sharesBeforeRefresh = await page.evaluate(
    () => window.reads.filter((row) => row.path.endsWith('/share')).length,
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Refresh preview', exact: true })
    .click()
  await page.waitForFunction(
    (count) => window.reads.filter((row) => row.path.endsWith('/share')).length > count,
    sharesBeforeRefresh,
  )
  await page.getByRole('dialog').locator('iframe').waitFor()
  assert.equal(await page.evaluate(() => window.opened.length), 0)
  assert.equal(
    await page.getByRole('dialog').locator('iframe').getAttribute('src'),
    'http://remote-runtime.test:7777/api/tasks/files/shared/scoped-ticket',
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.append())
  await desktop.getByText('More response text', { exact: false }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.reads.filter((row) => row.path.endsWith('/images/read')).length,
    ),
    1,
  )
  const mobile = page.locator('[data-client="mobile"]')
  await mobile.getByRole('link', { name: 'File', exact: true }).click()
  await mobile.getByRole('dialog').locator('[data-video-preview]').waitFor()
  assert.equal(await page.evaluate(() => window.opened.length), 0)
  await mobile.getByRole('button', { name: 'Close preview', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() =>
      window.reads.filter((row) => row.path.endsWith('/share')).map((row) => row.input),
    ),
    [
      { taskId: 'task', path: '/Users/dominic/a%20b.ts' },
      { taskId: 'task', path: '/Users/dominic/a%20b.ts' },
      { taskId: 'task', path: 'file:///tmp/report.pdf' },
    ],
  )
  await page.evaluate(() => {
    window.fail = true
  })
  await desktop.getByRole('button', { name: 'File', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('alert')
    .filter({ hasText: 'File is no longer available' })
    .waitFor()
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Retry preview', exact: true }).click()
  await page.getByRole('dialog').locator('iframe').waitFor()
  assert.equal(await page.evaluate(() => window.opened.length), 0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => {
    window.fail = true
  })
  await mobile.getByRole('link', { name: 'Source', exact: true }).click()
  await mobile
    .getByRole('dialog')
    .getByText('Error: File is no longer available', { exact: true })
    .waitFor()
  await mobile.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.evaluate(() => {
    window.runtime.connected = false
    window.refresh()
  })
  await page
    .locator('[data-client="desktop"]')
    .getByRole('button', { name: 'Source', exact: true })
    .click()
  await page.getByRole('alert').filter({ hasText: 'Reconnect' }).waitFor()
  assert.deepEqual(localNetwork, [])
  assert.deepEqual(errors, [])
  await page.evaluate(() => {
    window.runtime.connected = true
    window.fail = false
    window.renderRich()
  })
  await desktop.getByRole('button', { name: 'Preview New interface', exact: true }).waitFor()
  await desktop.getByRole('button', { name: 'Preview Design report', exact: true }).click()
  await page.getByRole('dialog').locator('iframe').waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await desktop.getByRole('button', { name: 'Download', exact: true }).click()
  await page.waitForFunction(() => window.opened.some((url) => url.endsWith('?download=1')))
  await desktop.getByRole('button', { name: 'Use template', exact: true }).click()
  await desktop.getByRole('button', { name: 'app.ts:12–18', exact: true }).click()
  await page.getByRole('dialog').locator('iframe').waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await desktop.getByRole('button', { name: 'Open in…', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open in VS Code', exact: true }).click()
  await page.waitForFunction(() =>
    window.reads.some(
      (row) => row.path.endsWith('/files/open') && row.input.path === '/tmp/report.pdf',
    ),
  )
  assert.equal(await desktop.locator('video[controls]').count(), 1)
  assert.equal(await mobile.locator('[data-image-source]').count(), 1)
  await mobile.getByRole('button', { name: 'Use template', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.prompts),
    Array(2).fill('Use $artifact-template-site to create a site about…'),
  )
  await mobile.getByRole('button', { name: 'Preview Design report', exact: true }).click()
  await mobile.getByRole('dialog').locator('[data-video-preview]').waitFor()
  const mobileSharesBeforeRefresh = await page.evaluate(
    () => window.reads.filter((row) => row.path.endsWith('/share')).length,
  )
  await mobile.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await page.waitForFunction(
    (count) => window.reads.filter((row) => row.path.endsWith('/share')).length > count,
    mobileSharesBeforeRefresh,
  )
  await mobile.getByRole('button', { name: 'Download original', exact: true }).click()
  await mobile.getByRole('button', { name: 'Open on runtime computer…', exact: true }).click()
  await mobile.getByRole('button', { name: 'Open in VS Code', exact: true }).click()
  await mobile.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.evaluate(() => {
    window.fail = true
    window.refresh()
  })
  await mobile.getByRole('button', { name: 'Retry preview', exact: true }).waitFor()
  await page.evaluate(() => {
    window.fail = false
  })
  await mobile.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await mobile.locator('[data-video-preview]').waitFor()
  await desktop.getByRole('button', { name: 'Preview New interface', exact: true }).count()
  await page.evaluate(() => window.refresh())
  await desktop.getByRole('button', { name: 'Preview New interface', exact: true }).waitFor()

  await mkdir(root + '/work/screenshots', { recursive: true })
  for (const file of (await readdir(root + '/apps/desktop/dist/assets')).filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: await readFile(root + '/apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addStyleTag({
    content:
      'body{margin:0;background:#111}#app{width:100%;min-height:100vh;display:block}.studio{display:block!important;width:100%;max-width:none;min-height:100vh}section[data-client]{max-width:760px;margin:auto}section[data-client="mobile"]{display:none}',
  })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.classList.add('dark')
  })
  await page.setViewportSize({ width: 1000, height: 1100 })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await page.evaluate(async () => {
    const video = document.querySelector('video')
    await video.play()
    video.pause()
  })
  await page.screenshot({
    path: root + '/work/screenshots/rich-thread-desktop.png',
    fullPage: true,
  })
  await page.addStyleTag({
    content:
      'section[data-client="desktop"]{display:none}section[data-client="mobile"]{display:block}main.studio{padding:16px!important}',
  })
  await page.setViewportSize({ width: 390, height: 1100 })
  await page.screenshot({
    path: root + '/work/screenshots/rich-thread-mobile-preview.png',
    fullPage: true,
  })
  assert.equal(
    await page.locator('body').evaluate((element) => element.scrollWidth <= innerWidth),
    true,
  )
  assert.deepEqual(localNetwork, [])
  assert.deepEqual(errors, [])
  // Check the real runtime page, not only the clients' URL routing.
  const { startRuntime } = await import('../packages/runtime/dist/index.js')
  const credential = 'chat-files-browser-paired-token-at-least-32-characters'
  await page.evaluate(() => {
    window.fail = false
    window.renderVisualization()
  })
  await page.addStyleTag({
    content:
      'section[data-client="desktop"],section[data-client="mobile"]{display:block!important}',
  })
  await page.setViewportSize({ width: 1000, height: 1100 })
  for (const client of ['desktop', 'mobile']) {
    const section = page.locator(`[data-client="${client}"]`)
    const preview = section.frameLocator('iframe').frameLocator('iframe')
    await preview
      .locator('#sample-counter')
      .click({ timeout: 5000 })
      .catch(async (error) => {
        throw new Error(
          JSON.stringify({
            client,
            text: await page.locator('body').innerText(),
            reads: await page.evaluate(() => window.reads.slice(-5)),
            frames: page.frames().map((frame) => frame.url()),
            errors,
          }) +
            ' ' +
            error.message,
        )
      })
    assert.equal(await preview.locator('#sample-counter').innerText(), '1')
    assert.equal((await section.innerText()).includes('visualize'), false)
  }
  await page
    .locator('[data-client="mobile"]')
    .getByRole('button', { name: 'Expand visualization', exact: true })
    .click()
  assert.equal(
    await mobile
      .frameLocator('iframe')
      .frameLocator('iframe')
      .locator('#sample-counter')
      .innerText(),
    '1',
  )
  await page
    .locator('[data-client="mobile"]')
    .getByRole('button', { name: 'Collapse visualization', exact: true })
    .click()
  const mobileCounter = mobile
    .frameLocator('iframe')
    .frameLocator('iframe')
    .locator('#sample-counter')
  assert.equal(await mobileCounter.innerText(), '1')
  await mobileCounter.click()
  assert.equal(await mobileCounter.innerText(), '2')
  await page.evaluate(() => window.setConnected(false))
  for (const client of ['desktop', 'mobile']) {
    const section = page.locator(`[data-client="${client}"]`)
    await section.getByText('Computer offline · Showing loaded preview', { exact: true }).waitFor()
    assert.equal(
      await section
        .frameLocator('iframe')
        .frameLocator('iframe')
        .locator('#sample-counter')
        .innerText(),
      client === 'mobile' ? '2' : '1',
    )
  }
  const visualizationReads = await page.evaluate(
    () => window.reads.filter((row) => row.path.endsWith('/visualizations/read')).length,
  )
  await page.evaluate(() => window.setConnected(true))
  await desktop.getByRole('button', { name: 'Refresh visualization', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.reads.filter((row) => row.path.endsWith('/visualizations/read')).length,
    ),
    visualizationReads,
  )
  assert.equal(await mobileCounter.innerText(), '2')
  await mobile.getByRole('button', { name: 'Refresh visualization', exact: true }).click()
  await page.waitForFunction(
    (count) =>
      window.reads.filter((row) => row.path.endsWith('/visualizations/read')).length === count + 1,
    visualizationReads,
  )
  await mobileCounter.waitFor()
  assert.equal(await mobileCounter.innerText(), '0')
  directory = await mkdtemp(join(tmpdir(), 'dovo-chat-files-browser-'))
  server = await startRuntime({ databasePath: ':memory:', ownerToken: credential, port: 0 })
  server.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Files', path: directory, branch: '', kind: 'folder' }],
    tasks: [
      {
        id: 'task',
        title: 'Files',
        agentId: '',
        repositoryId: 'repo',
        status: 'draft',
        createdAt: '2026-10-12',
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  await writeFile(
    join(directory, 'preview.html'),
    '<h1>Preview first</h1><script>window.executed=true</script>',
  )
  const origin = `http://127.0.0.1:${server.port}`
  const response = await fetch(origin + '/api/tasks/files/share', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'task', path: 'preview.html' }),
  })
  assert.equal(response.status, 200)
  const { url } = await response.json()
  await page.goto(origin)
  await page.setContent('<iframe title="App file dialog" src="' + origin + url + '"></iframe>')
  await page
    .frameLocator('iframe[title="App file dialog"]')
    .frameLocator('iframe')
    .getByRole('heading', { name: 'Preview first' })
    .waitFor()
  await page.goto(origin + url)
  await page.frameLocator('iframe').getByRole('heading', { name: 'Preview first' }).waitFor()
  assert.equal(await page.frames()[1].evaluate(() => window.executed), undefined)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download original' }).click()
  assert.equal((await download).suggestedFilename(), 'preview.html')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.frameLocator('iframe').getByRole('heading', { name: 'Preview first' }).waitFor()
  assert.equal(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
    true,
  )
  await writeFile(join(directory, 'demo.webm'), Buffer.from(media.video, 'base64'))
  const videoShare = await fetch(origin + '/api/tasks/files/share', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'task', path: 'demo.webm' }),
  })
  const videoURL = (await videoShare.json()).url
  await page.goto(origin + videoURL)
  await page.locator('video[controls]').waitFor()
  await page.evaluate(() => document.querySelector('video').play())
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['First page', 'Second page'].map((label) => {
      const content = `BT /F1 20 Tf 30 200 Td (${label}) Tj ET`
      return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    }),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await writeFile(join(directory, 'report.pdf'), pdf)
  const pdfShare = await fetch(origin + '/api/tasks/files/share', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'task', path: 'report.pdf' }),
  })
  const pdfURL = (await pdfShare.json()).url
  await page.goto(origin + pdfURL)
  await page.getByText('Page 1 of 2', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 0)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('Page 2 of 2', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByText('Page 1 of 2', { exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').textContent(), '')
  await page.screenshot({ path: root + '/work/screenshots/chat-pdf-preview.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'Rich chat: desktop and mobile media/file/template cards, citation links, downloads, runtime open actions, draft insertion and errors pass. Real runtime HTML stays sandboxed; video plays and PDF page navigation works on HTTP.',
  )
} finally {
  await browser.close()
  await server?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
}
