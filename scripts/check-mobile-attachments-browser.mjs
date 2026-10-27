import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname
const mobile = root + 'apps/mobile'
const component = mobile + '/src/tasks/conversation/components'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {MessageAttachments} from './src/tasks/conversation/components/message-attachments';
window.edited=[];window.calls=[];window.connected=true;window.disabled=false;window.thumbnailFail=false;window.fail=false;window.sharingAvailable=true;window.shared=[];window.writes=[];
const image={id:'photo',name:'Schermafbeelding 2026-10-24 om 09.01 — a very long filename.jpg',mime:'image/jpeg',size:2048};
const doc={id:'notes',name:'Notes for the release.txt',mime:'text/plain',size:32};
const zip={id:'archive',name:'Build artifacts and supporting reports.zip',mime:'application/zip',size:2048};
window.archiveEntries=[{path:'reports/deep/results.txt',size:15,directory:false},{path:'reports/other.txt',size:12,directory:false},{path:'image.png',size:32,directory:false},{path:'empty/',size:0,directory:true}];window.uploads=[];

window.files=[image,doc,zip];window.request=async(path,input)=>{window.calls.push({path,input});
if(path==='/api/attachments/archive/list'){if(window.archiveFail)throw Error('Expanded ZIP exceeds preview limits');return {entries:window.archiveEntries}};
if(path==='/api/attachments/archive/read'){if(window.holdEntry){window.holdEntry=false;await new Promise(resolve=>window.releaseEntry=resolve)}if(window.entryFail)throw Error('Entry unavailable');const image=input.path==='image.png';return {path:input.path,name:input.path.split('/').at(-1),mime:image?'image/png':'text/plain',size:15,data:image?window.png.split(',')[1]:btoa(input.path==='reports/other.txt'?'Other result':'Selected result')}};
if(path==='/api/attachments/upload'){window.uploads.push(input);if(window.uploadFail){window.uploadFail=false;throw Error('Upload response lost')}return {attachment:{id:input.id,name:input.name,mime:'text/plain',size:15}}};
if(window.fail)throw Error('Attachment unavailable');if(path==='/api/tasks/images/read'){if(window.thumbnailFail)throw Error('Thumbnail unavailable');return {uri:window.png}};return {attachment:window.files.find(file=>file.id===input.id),data:input.id==='photo'?window.png.split(',')[1]:btoa('Release notes')}};
function App(){const [files,setFiles]=useState([image]),[revision,setRevision]=useState(0);window.refresh=()=>setRevision(value=>value+1);window.setFiles=setFiles;return <main data-revision={revision} style={{padding:12}}><MessageAttachments taskId="task" files={files} removable edit={async id=>{window.edited.push(id)}} remove={id=>setFiles(files=>files.filter(file=>file.id!==id))} disabled={window.disabled}/><textarea aria-label="Message" defaultValue="Keep my draft"/></main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
  },
  [
    {
      path: '../../composer/chat-image-edit-context',
      importer: component,
      contents: 'export const EditChatImage=()=>null;',
    },
    {
      path: 'react-native',
      contents: `import {useEffect,useRef} from 'react';
const css=s=>{const value=Array.isArray(s)?Object.assign({},...s):s;return {...value,...(value?.paddingHorizontal!==undefined?{paddingLeft:value.paddingHorizontal,paddingRight:value.paddingHorizontal}:{}),...(value?.paddingVertical!==undefined?{paddingTop:value.paddingVertical,paddingBottom:value.paddingVertical}:{})}};
export const View=({children,style,accessibilityLabel,onLayout})=>{const ref=useRef(null),callback=useRef(onLayout);callback.current=onLayout;useEffect(()=>{if(!callback.current)return;const observer=new ResizeObserver(([entry])=>callback.current?.({nativeEvent:{layout:entry.contentRect}}));observer.observe(ref.current);return()=>observer.disconnect()},[]);return <div ref={ref} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minHeight:0,boxSizing:'border-box',borderStyle:'solid',borderWidth:0,...css(style)}}>{children}</div>};
export const Pressable=({children,onPress,disabled,style,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:'flex',border:0,font:'inherit',background:'transparent',boxSizing:'border-box',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ScrollView=({children,style,contentContainerStyle,accessibilityLabel,keyboardShouldPersistTaps,maximumZoomScale,minimumZoomScale})=><div aria-label={accessibilityLabel} data-keyboard-taps={keyboardShouldPersistTaps} data-max-zoom={maximumZoomScale} data-min-zoom={minimumZoomScale} style={{minHeight:0,overflowY:'auto',...css(style)}}><div style={{display:'flex',flexDirection:'column',...css(contentContainerStyle)}}>{children}</div></div>;
export const Image=({source,accessibilityLabel,style})=><img src={source?.uri} alt={accessibilityLabel} style={{objectFit:'contain',...css(style)}}/>;`,
    },
    {
      path: '../../../runtime/state/application-state',
      importer: component,
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '../../runtime/state/application-state',
      importer: mobile + '/src/ui/controls',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: component,
      contents: `import {Effect} from 'effect';const request=(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error});export const useRuntime=()=>({connected:window.connected,callEffect:request,readEffect:request});`,
    },
    {
      path: '../../../ui/theme',
      importer: component,
      contents: `export const useTheme=()=>({colors:{text:'#eee',muted:'#aaa',surface:'#202020',border:'#333',selection:'#444'},styles:{screen:{flex:1,backgroundColor:'#111'},content:{padding:16,gap:12},text:{color:'#eee'},error:{color:'#f88'}}});`,
    },
    {
      path: '../../../ui/content/text',
      importer: component,
      contents: `export const Text=({children,style,numberOfLines,accessibilityRole})=><span role={accessibilityRole} style={{...(Array.isArray(style)?Object.assign({},...style):style),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}}>{children}</span>;`,
    },
    {
      path: '../../../ui/controls/icon',
      importer: component,
      contents: `export const Icon=({name,size})=><svg aria-hidden="true" data-icon={name} width={size} height={size} style={{flexShrink:0}}/>;`,
    },
    {
      path: '../../../ui/controls/icon-button',
      importer: component,
      contents: `export const IconButton=({label,icon,onPress,disabled,variant})=><button aria-label={label} data-icon={icon} data-variant={variant} disabled={disabled} onClick={onPress} style={{width:44,height:44,flexShrink:0,borderRadius:22}}/>;`,
    },
    {
      path: '../../../ui/layout/safe-modal',
      importer: component,
      contents: `export const SafeModal=({visible,children})=>visible?<div role="dialog" style={{position:"fixed",inset:0,display:"flex",flexDirection:"column"}}>{children}</div>:null;`,
    },
    {
      path: 'expo-file-system',
      contents: `export const Paths={cache:'cache'};export class File{constructor(path,name){this.uri=path+'/'+name}write(data,options){this.exists=true;window.writes.push({uri:this.uri,data,options})}delete(){this.exists=false;window.deleted=(window.deleted||[]).concat(this.uri)}}`,
    },
    {
      path: 'expo-sharing',
      contents: `export const isAvailableAsync=async()=>window.sharingAvailable;export const shareAsync=async(uri,options)=>{window.shared.push({uri,options});if(window.holdShare)await new Promise(resolve=>window.finishShare=resolve);if(window.shareError)throw Error('Share cancelled by system')};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;background:#111;font-family:system-ui}button{padding:0}textarea{margin-top:8px}</style><div id="app"></div>',
  )
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    window.png = canvas.toDataURL()
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const rows = page.getByLabel('Draft attachments', { exact: true })
  const preview = rows.getByRole('button', { name: /^Preview / }).first()
  const edit = rows.getByRole('button', { name: /^Edit / })
  const remove = rows.getByRole('button', { name: /^Remove / }).first()
  await preview.waitFor()
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    const row = await preview.evaluate((node) => {
      const box = node.parentElement.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    assert.equal(row.width, width - 24)
    assert.equal(row.height, 46)
    assert.equal((await edit.boundingBox()).width, 44)
    assert.equal((await remove.boundingBox()).height, 44)
    assert.equal(await edit.innerText(), '')
    assert.equal(await remove.innerText(), '')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
  }
  assert.equal(await rows.getAttribute('data-keyboard-taps'), 'always')
  await edit.click()
  assert.deepEqual(await page.evaluate(() => window.edited), ['photo'])
  await preview.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const close = dialog.getByRole('button', { name: 'Close preview', exact: true })
  const share = dialog.getByRole('button', { name: 'Share file', exact: true })
  const imagePreview = dialog.getByLabel('Image preview', { exact: true })
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await page.waitForFunction(
      () =>
        Math.abs(document.querySelector('[aria-label="Image preview"] img').width - innerWidth) <
          1 &&
        Math.abs(
          document.querySelector('[aria-label="Image preview"] img').height - (innerHeight - 60),
        ) < 1,
    )
    const closeBox = await close.boundingBox()
    const shareBox = await share.boundingBox()
    const imageBox = await imagePreview.getByRole('img').boundingBox()
    assert.equal(closeBox.width, 44)
    assert.equal(closeBox.height, 44)
    assert.equal(closeBox.x + closeBox.width, size.width - 16)
    assert.equal(closeBox.y, 8)
    assert.equal(shareBox.y, closeBox.y)
    assert.equal(shareBox.x + shareBox.width + 8, closeBox.x)
    assert.equal(imageBox.y, 60)
    assert.equal(imageBox.height, size.height - 60)
    assert.equal(await close.innerText(), '')
    assert.equal(await share.innerText(), '')
    assert.equal(await close.getAttribute('data-variant'), 'glass')
    assert.equal(await share.getAttribute('data-variant'), 'glass')
    assert.equal(await dialog.evaluate((node) => node.scrollWidth), size.width)
  }
  assert.equal(await imagePreview.getAttribute('data-max-zoom'), '4')
  assert.equal(await imagePreview.getAttribute('data-min-zoom'), '1')
  assert.equal(
    await share.evaluate((node) => !!node.closest('[aria-label="Image preview"]')),
    false,
  )
  // Simulate image zoom/pan without changing the independent toolbar's frame.
  const toolbarBox = await close.boundingBox()
  await imagePreview.getByRole('img').evaluate((node) => {
    node.style.transform = 'scale(3) translate(-40px, 20px)'
  })
  assert.deepEqual(await close.boundingBox(), toolbarBox)
  await page.evaluate(() => {
    window.sharingAvailable = false
  })
  await share.click()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /sharing is unavailable/)
  await page.evaluate(() => {
    window.sharingAvailable = true
    window.holdShare = true
  })
  await share.click()
  await page.waitForFunction(() => !!window.finishShare)
  assert.equal(await share.isDisabled(), true)
  assert.equal(await close.isEnabled(), true)
  assert.deepEqual(await page.evaluate(() => window.shared), [
    {
      uri: 'cache/photo-Schermafbeelding 2026-10-24 om 09.01 — a very long filename.jpg',
      options: { mimeType: 'image/jpeg' },
    },
  ])
  assert.deepEqual(await page.evaluate(() => window.writes[0].options), { encoding: 'base64' })
  assert.equal(await page.evaluate(() => window.writes[0].data === window.png.split(',')[1]), true)
  await close.click()
  await dialog.waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.finishShare()
    window.holdShare = false
  })
  await page.waitForFunction(() => !document.querySelector('[aria-label^="Preview "]').disabled)
  await page.evaluate(() => window.setFiles(window.files.slice(0, 2)))
  await rows.getByRole('button', { name: 'Preview Notes for the release.txt' }).click()
  await dialog.getByText('Release notes').waitFor()
  assert.equal(await dialog.getByRole('img').count(), 0)
  await page.evaluate(() => {
    window.shareError = true
  })
  await share.click()
  await dialog
    .getByRole('alert')
    .getByText(/Share cancelled by system/)
    .waitFor()
  assert.equal(await share.isEnabled(), true)
  await close.click()
  await page.evaluate(() => {
    window.fail = true
  })
  await preview.click()
  await page
    .getByRole('alert')
    .getByText(/Attachment unavailable/)
    .waitFor()
  await page.evaluate(() => {
    window.fail = false
    window.disabled = true
    window.refresh()
  })
  await page.waitForFunction(() => document.querySelector('[aria-label^="Preview "]')?.disabled)
  assert.equal(await preview.isDisabled(), true)
  assert.equal(await edit.isDisabled(), true)
  await page.evaluate(() => {
    window.disabled = false
    window.connected = false
    window.refresh()
  })
  await page.waitForFunction(() => document.querySelector('[aria-label^="Remove "]')?.disabled)
  assert.equal(await remove.isDisabled(), true)
  await page.evaluate(() => {
    window.connected = true
    window.thumbnailFail = true
    window.setFiles([
      ...window.files.slice(0, 2),
      ...Array.from({ length: 5 }, (_, i) => ({ ...window.files[1], id: 'extra-' + i })),
    ])
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Draft attachments"]')?.scrollHeight > 146,
  )
  assert.equal((await rows.boundingBox()).height, 146)
  await page.getByLabel('Preview unavailable: Thumbnail unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Keep my draft')
  await remove.click()
  await edit.waitFor({ state: 'detached' })
  assert.equal(await edit.count(), 0)
  assert.equal(await rows.getByText('32 B').count(), 6)
  // ZIP browsing loads only directory metadata until an entry is selected.
  await page.evaluate(() => {
    window.thumbnailFail = false
    window.shareError = false
    window.setFiles(window.files)
  })
  await rows
    .getByRole('button', { name: 'Preview Build artifacts and supporting reports.zip' })
    .click()
  const archive = page.getByRole('dialog')
  await archive.getByRole('button', { name: 'Open folder reports' }).waitFor()
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) => call.path === '/api/attachments/read' && call.input.id === 'archive',
      ),
    ),
    false,
  )
  await archive.getByRole('button', { name: 'Open folder reports' }).click()
  await archive.getByRole('button', { name: 'Open folder deep' }).click()
  await archive.getByRole('button', { name: 'Preview file results.txt' }).click()
  await archive.getByText('Selected result', { exact: true }).waitFor()
  for (const size of [
    { width: 320, height: 400 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    assert.equal(await archive.evaluate((node) => node.scrollWidth), size.width)
    for (const label of [
      'Back to archive folder',
      'Share selected file',
      'Close archive',
      'Attach selected file to draft',
    ]) {
      const box = await archive.getByRole('button', { name: label, exact: true }).boundingBox()
      assert.ok(box.height >= 44)
      assert.ok(box.x >= 0 && box.x + box.width <= size.width)
      assert.ok(box.y >= 0 && box.y + box.height <= size.height)
    }
  }
  await page.evaluate(() => (window.uploadFail = true))
  await archive.getByRole('button', { name: 'Attach selected file to draft' }).click()
  await archive.getByRole('alert').getByText('Upload response lost').waitFor()
  await archive.getByRole('button', { name: 'Attach selected file to draft' }).click()
  await archive.getByRole('button', { name: 'Added to draft' }).waitFor()
  const uploads = await page.evaluate(() => window.uploads)
  assert.equal(uploads.length, 2)
  assert.equal(uploads[0].id, uploads[1].id)
  assert.equal(uploads[0].name, 'results.txt')
  assert.equal(uploads[0].data, Buffer.from('Selected result').toString('base64'))
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Keep my draft')
  await archive.getByRole('button', { name: 'Share selected file' }).click()
  await page.waitForFunction(() =>
    window.shared.some((share) => share.uri.endsWith('-results.txt')),
  )
  await page.waitForFunction(() => window.deleted?.some((uri) => uri.endsWith('-results.txt')))
  await archive.getByRole('button', { name: 'Back to archive folder' }).click()
  await archive.getByRole('button', { name: 'Parent archive folder' }).click()
  await archive.getByRole('button', { name: 'Preview file other.txt' }).waitFor()
  await page.evaluate(() => (window.holdEntry = true))
  await archive.getByRole('button', { name: 'Preview file other.txt' }).click()
  await page.waitForFunction(() => !!window.releaseEntry)
  await archive.getByRole('button', { name: 'Back to archive folder' }).click()
  await archive.getByRole('button', { name: 'Open folder deep' }).click()
  await archive.getByRole('button', { name: 'Preview file results.txt' }).click()
  await archive.getByText('Selected result', { exact: true }).waitFor()
  await page.evaluate(() => window.releaseEntry())
  await archive.getByText('Selected result', { exact: true }).waitFor()
  assert.equal(await archive.getByText('Other result', { exact: true }).count(), 0)
  await archive.getByRole('button', { name: 'Back to archive folder' }).click()
  await archive.getByRole('button', { name: 'Parent archive folder' }).click()
  await archive.getByRole('button', { name: 'Parent archive folder' }).click()
  await archive.getByRole('button', { name: 'Preview file image.png' }).click()
  await archive.getByRole('img', { name: 'image.png' }).waitFor()
  await page.evaluate(() => {
    window.connected = false
    window.refresh()
  })
  await archive.getByRole('alert').getByText('Reconnect to browse this ZIP.').waitFor()
  assert.equal(await archive.getByRole('button', { name: 'Share ZIP' }).isDisabled(), true)
  assert.equal(await archive.getByRole('button', { name: 'Close archive' }).isEnabled(), true)
  await archive.getByRole('button', { name: 'Close archive' }).click()
  await page.evaluate(() => {
    window.connected = true
    window.archiveFail = true
    window.refresh()
  })
  await rows
    .getByRole('button', { name: 'Preview Build artifacts and supporting reports.zip' })
    .click()
  await archive.getByRole('alert').getByText('Expanded ZIP exceeds preview limits').waitFor()
  await archive.getByRole('button', { name: 'Share ZIP' }).click()
  await page.waitForFunction(() =>
    window.shared.some((share) =>
      share.uri.endsWith('-Build artifacts and supporting reports.zip'),
    ),
  )
  await page.evaluate(() => (window.archiveFail = false))
  await archive.getByRole('button', { name: 'Retry archive' }).click()
  await archive.getByRole('button', { name: 'Open folder empty' }).click()
  await archive.getByText('This folder is empty.').waitFor()
  await archive.getByRole('button', { name: 'Close archive' }).click()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile attachment rows: responsive geometry, bounded list, icon actions, fixed glass preview toolbar, responsive zoom viewport, native sharing, bounded ZIP browsing, folder navigation, file/image previews, draft attachment retry identity, stale-reply isolation, fallbacks, disabled/offline controls and draft preservation passed (browser adapters).',
  )
} finally {
  await browser.close()
}
