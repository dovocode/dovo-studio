import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const mobile = root + 'apps/mobile'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {ChatImageEditProvider} from './src/tasks/composer/chat-image-edit';import {EditChatImage} from './src/tasks/composer/chat-image-edit-context';import {useState} from 'react';import {useScreenshotAttachment} from './src/tasks/preview/screenshot-attachment';import {createRoot} from 'react-dom/client';import {useAttachmentPicker} from './src/tasks/composer/attachment-picker';
window.data={};window.deleted=[];window.calls=[];window.rows=[];window.stored={};window.fail=false;
window.request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/read')return window.stored[input.id];if(path==='/api/tasks/images/read')return {uri:'data:image/png;base64,'+window.data['photo.png']};if(window.fail)throw Error('Mobile upload rejected');const attachment={id:input.id,name:input.name,mime:input.name.endsWith('.png')?'image/png':'application/octet-stream',size:atob(input.data).length};window.stored[input.id]={attachment,data:input.data};window.rows=input.replaceId?window.rows.map(f=>f.id===input.replaceId?attachment:f):[...window.rows,attachment];return {attachment,revision:1}};
function App(){const[revision,setRevision]=useState(0);window.refresh=()=>setRevision(v=>v+1);const[loading,setLoading]=useState(false);const picker=useAttachmentPicker('task');const screenshots=useScreenshotAttachment('task');window.capture=screenshots.attach;window.captureBusy=screenshots.busy;window.captureError=screenshots.error;window.upload=picker.upload;window.edit=picker.edit;window.busy=picker.busy;return <ChatImageEditProvider upload={picker.upload} busy={loading||picker.busy} onBusy={setLoading} disabled={false}><EditChatImage source={{taskId:"source-thread",attachmentId:"sent"}} label="Sent image"/><EditChatImage source={{taskId:"source-thread",eventId:"generated",index:0}} label="Tool image"/><EditChatImage source={{taskId:"source-thread",path:"/output/chart.png"}} label="Inline image"/>{picker.editor}{screenshots.editor}<div role="alert">{picker.error}</div><textarea aria-label="Message" defaultValue="Keep mobile draft"/></ChatImageEditProvider>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
  },
  [
    { path: 'expo/fetch', contents: 'export const fetch=(...args)=>window.fetch(...args);' },
    {
      path: '../../ui/controls/icon-button',
      importer: mobile + '/src/tasks/composer',
      contents:
        'export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}/>;',
    },
    {
      path: './optimize-attachment-image',
      importer: mobile,
      contents: `export const optimizeAttachmentImage=async asset=>asset;`,
    },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,snapshot:{workspace:{tasks:[{id:'task',draftAttachments:window.rows}]}},readEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error}),callEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error})});`,
    },
    {
      path: '../../ui/controls/use-action',
      importer: mobile,
      contents: `import {useState} from 'react';import {runClientEffect} from '@dovo/client-runtime';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const run=async work=>{setBusy(true);setError('');try{await runClientEffect(work())}catch(error){setError(error.message)}finally{setBusy(false)}};return {busy,error,run,act:work=>{void run(work)}}}`,
    },
    {
      path: '../../ui/layout/safe-modal',
      importer: mobile,
      contents: `export const SafeModal=({children})=><section style={{height:780,display:"flex",flexDirection:"column",background:"#18181b",color:"white"}}>{children}</section>;`,
    },
    {
      path: '../../ui/theme',
      importer: mobile,
      contents: `export const useTheme=()=>({colors:{text:'#eee',muted:'#aaa',background:'#18181b',accent:'#38bdf8',selection:'#164e63',border:'#555',error:'#f44'},styles:{title:{fontSize:19},muted:{fontSize:13,color:'#aaa'},error:{color:'#f44'}}});`,
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents: `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;`,
    },
    {
      path: 'lucide-react-native',
      contents: `const icon=name=>({color,size})=><span aria-hidden="true" data-icon={name} style={{color,width:size,height:size}}>◇</span>;export const Pencil=icon('pen'),Highlighter=icon('highlight'),ArrowUpRight=icon('arrow'),Square=icon('rectangle'),Crop=icon('crop'),Undo2=icon('undo'),Redo2=icon('redo'),RotateCcw=icon('reset');`,
    },
    {
      path: 'react-native-svg',
      contents: `import {forwardRef,useImperativeHandle,useLayoutEffect,useRef} from 'react';
export default forwardRef(function Svg({children,pointerEvents,onLayout,accessible,...props},ref){const node=useRef(null);useLayoutEffect(()=>{onLayout?.()},[]);useImperativeHandle(ref,()=>({toDataURL(callback,size){if(window.exportFail){callback('');return}const element=node.current.cloneNode(true);const width=(size?.width??Number(element.getAttribute('width')))*3,height=(size?.height??Number(element.getAttribute('height')))*3;element.removeAttribute('style');element.setAttribute('width',width);element.setAttribute('height',height);const image=new window.Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);callback(canvas.toDataURL().split(',')[1])};image.src='data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(element))}}));return <svg xmlns="http://www.w3.org/2000/svg" {...props} ref={node} style={{pointerEvents}}>{children}</svg>});
export const Image=({href,onLoad,...props})=><image {...props} href={'data:image/png;base64,'+window.data[href]} onLoad={onLoad}/>;
export const Path=props=><path {...props}/>;export const Rect=props=><rect {...props}/>;`,
    },
    {
      path: 'expo-image-manipulator',
      contents: `let sequence=0;export const SaveFormat={PNG:'png'};export const ImageManipulator={manipulate(uri){let size;return {resize(next){size=next;return this},release(){},async renderAsync(){return {release(){},async saveAsync(){const image=new window.Image();image.src='data:image/png;base64,'+window.data[uri];await image.decode();const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;canvas.getContext('2d').drawImage(image,0,0,size.width,size.height);const output='cache/normalized-'+ ++sequence+'.png';window.data[output]=canvas.toDataURL().split(',')[1];return {uri:output}}}}}}};`,
    },
    {
      path: 'expo-file-system',
      contents: `export const Paths={cache:'cache'};export class File{constructor(...parts){this.uri=parts.join('/')}get exists(){return this.uri in window.data}get size(){return atob(window.data[this.uri]??'').length}async bytes(){return Uint8Array.from(atob(window.data[this.uri]),c=>c.charCodeAt(0))}async base64(){return window.data[this.uri]}async write(data){await Promise.resolve();window.data[this.uri]=data}delete(){delete window.data[this.uri];window.deleted.push(this.uri)}}`,
    },
    {
      path: 'expo-crypto',
      contents: `let sequence=0;export const randomUUID=()=> '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');`,
    },
    {
      path: 'react-native',
      contents: `import {useLayoutEffect,useRef} from 'react';
const flatten=s=>Array.isArray(s)?Object.assign({},...s):s;
export function View({children,style,onLayout,accessibilityLabel,onStartShouldSetResponder,onMoveShouldSetResponder,onResponderGrant,onResponderMove,onResponderRelease,onResponderTerminate,onResponderTerminationRequest,pointerEvents}){const ref=useRef(null);useLayoutEffect(()=>{if(!onLayout)return;const observer=new ResizeObserver(()=>{const box=ref.current.getBoundingClientRect();onLayout({nativeEvent:{layout:{width:box.width,height:box.height}}})});observer.observe(ref.current);return()=>observer.disconnect()},[onLayout]);const active=useRef(false);const event=e=>{const box=ref.current.getBoundingClientRect();return {nativeEvent:{locationX:e.clientX-box.x,locationY:e.clientY-box.y}}};return <div ref={ref} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minHeight:0,boxSizing:'border-box',...flatten(style),pointerEvents,touchAction:onResponderGrant?'none':undefined}} onPointerDown={e=>{if(onStartShouldSetResponder?.()){active.current=true;e.currentTarget.setPointerCapture(e.pointerId);onResponderGrant(event(e))}}} onPointerMove={e=>{if(active.current)onResponderMove?.(event(e))}} onPointerUp={e=>{if(active.current){active.current=false;onResponderRelease?.(event(e))}}} onPointerCancel={()=>{active.current=false;onResponderTerminate?.()}}>{children}</div>}
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} style={{border:0,font:'inherit',...flatten(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ScrollView=({children,style,contentContainerStyle})=><div style={{...flatten(style),overflowX:'auto',flexShrink:0}}><div style={{display:'flex',...contentContainerStyle}}>{children}</div></div>;
export const ActivityIndicator=({accessibilityLabel})=><span aria-label={accessibilityLabel}/>;
export const Image={getSize:async uri=>{const img=new window.Image();img.src='data:image/png;base64,'+window.data[uri];await img.decode();return {width:img.width,height:img.height}}};
export const PixelRatio={get:()=>3};export const Alert={alert(){}};export const Keyboard={dismiss(){}};export const Linking={openSettings:async()=>{}};export const Platform={OS:'ios'};`,
    },
    {
      path: 'expo-image-picker',
      contents: `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;`,
    },
    {
      path: 'expo-document-picker',
      contents: `export const getDocumentAsync=async()=>({canceled:true});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.upload)
  await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 240
    c.getContext('2d').fillRect(0, 0, 400, 240)
    window.data['photo.png'] = c.toDataURL().split(',')[1]
    window.asset = { uri: 'photo.png', name: 'photo.png', mimeType: 'image/png' }
    window.operation = window.upload([window.asset])
  })
  const editor = page.locator('section')
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.busy && window.rows.length === 1)
  const originalId = await page.evaluate(() => window.rows[0].id)
  await page.evaluate(() => {
    window.operation = window.edit(window.rows[0].id)
  })
  for (const label of ['Draw', 'Highlight', 'Arrow', 'Box', 'Crop', 'Undo', 'Redo', 'Reset']) {
    const button = editor.getByRole('button', { name: label, exact: true })
    await button.waitFor()
    assert.equal(await button.locator('[data-icon]').count(), 1)
    assert.equal(await button.innerText(), '◇')
  }
  await editor.getByRole('button', { name: 'Crop', exact: true }).click()
  const box = await editor.getByLabel('Image drawing area').boundingBox()
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 10 })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await editor.locator('svg').first().getAttribute('viewBox'), '0 0 400 240')
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await editor.locator('svg').first().getAttribute('viewBox'), '100 60 200 120')
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForFunction(
    () => !window.busy && window.calls.some((c) => c.path === '/api/attachments/replace'),
  )
  assert.equal(await page.evaluate(() => window.rows.length), 1)
  assert.notEqual(await page.evaluate(() => window.rows[0].id), originalId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Keep mobile draft',
  )
  assert.deepEqual(
    await page.evaluate(async () => {
      const blob = await (
        await fetch('data:image/png;base64,' + window.stored[window.rows[0].id].data)
      ).blob()
      const image = await createImageBitmap(blob)
      return [image.width, image.height]
    }),
    [200, 120],
  )
  await page.evaluate(() => {
    window.operation = window.edit(window.rows[0].id)
  })
  for (const tool of ['Draw', 'Highlight', 'Arrow', 'Box']) {
    await editor.getByRole('button', { name: tool, exact: true }).click()
    const area = await editor.getByLabel('Image drawing area').boundingBox()
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(area.x + area.width * 0.8, area.y + area.height * 0.6, { steps: 8 })
    await page.mouse.up()
  }
  assert.equal(await editor.locator('path').count(), 4)
  assert.equal(await editor.locator('path').nth(1).getAttribute('opacity'), '0.35')
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await editor.locator('path').count(), 3)
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await editor.locator('path').count(), 4)
  await editor.getByRole('button', { name: 'Reset', exact: true }).click()
  assert.equal(await editor.locator('path').count(), 0)
  await editor.getByRole('button', { name: 'Draw', exact: true }).click()
  await editor.getByRole('button', { name: 'Blue', exact: true }).click()
  await editor.getByRole('button', { name: 'Thick', exact: true }).click()
  const drawing = await editor.getByLabel('Image drawing area').boundingBox()
  await page.mouse.move(drawing.x + drawing.width * 0.2, drawing.y + drawing.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(drawing.x + drawing.width * 0.8, drawing.y + drawing.height * 0.5, {
    steps: 8,
  })
  await page.mouse.up()
  await page.screenshot({ path: '/tmp/dovo-native-image-editor.png' })
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  assert.equal(
    await page.evaluate(async () => {
      const image = await createImageBitmap(
        await (
          await fetch('data:image/png;base64,' + window.stored[window.rows[0].id].data)
        ).blob(),
      )
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const pixel = ctx.getImageData(100, 60, 1, 1).data
      return pixel[2] > 200 && pixel[0] < 100
    }),
    true,
  )
  const editedId = await page.evaluate(() => window.rows[0].id)
  await page.evaluate(() => {
    window.operation = window.edit(window.rows[0].id)
  })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  assert.equal(await page.evaluate(() => window.rows[0].id), editedId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(() => {
    window.fail = true
    window.operation = window.edit(window.rows[0].id)
  })
  await editor.getByRole('button', { name: 'Draw', exact: true }).click()
  const b = await editor.getByLabel('Image drawing area').boundingBox()
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await page.evaluate(() => {
    window.exportFail = true
  })
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await editor.getByRole('alert').filter({ hasText: 'Could not export this image' }).waitFor()
  assert.equal(await page.evaluate(() => window.rows[0].id), editedId)
  assert.equal(
    await page.evaluate(
      () => Object.keys(window.data).filter((key) => key.startsWith('cache/image-edit-')).length,
    ),
    1,
  )
  await page.evaluate(() => {
    window.exportFail = false
  })
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  await page.getByRole('alert').filter({ hasText: 'Mobile upload rejected' }).waitFor()
  await page.waitForFunction(() => !window.busy)
  assert.equal(await page.evaluate(() => window.rows[0].id), editedId)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(() => {
    window.fail = false
    window.operation = window.capture('data:image/png;base64,' + window.data['photo.png'])
  })
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.captureBusy && window.rows.length === 2)
  assert.match(await page.evaluate(() => window.rows[1].name), /^screenshot-/)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(() => {
    window.operation = window.capture('data:image/png;base64,' + window.data['photo.png'])
  })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.captureBusy)
  assert.equal(await page.evaluate(() => window.rows.length), 2)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(async () => {
    await window.capture('https://external.test/image.png')
  })
  await page.waitForFunction(() => window.captureError.includes('Could not read the screenshot'))
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  // Reuse a sent image without changing the original message or composer text.
  await page.evaluate(() => {
    window.rows = []
    window.stored.sent = {
      attachment: { id: 'sent', name: 'sent.png', mime: 'image/png', size: 100 },
      data: window.data['photo.png'],
    }
  })
  await page.getByRole('button', { name: 'Edit and attach Sent image', exact: true }).click()
  await editor.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.waitForFunction(() => !window.busy && window.rows.length === 1)
  assert.equal(await page.evaluate(() => window.calls.at(-1).path), '/api/attachments/upload')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.replaceId), undefined)
  assert.equal(
    await page.evaluate(() => window.stored.sent.data === window.data['photo.png']),
    true,
  )
  assert.equal(
    await page.getByRole('textbox', { name: 'Message' }).inputValue(),
    'Keep mobile draft',
  )
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.getByRole('button', { name: 'Edit and attach Inline image', exact: true }).click()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => !window.busy)
  assert.equal(await page.evaluate(() => window.rows.length), 1)
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.filter((c) => c.path === '/api/tasks/images/read').at(-1).input,
    ),
    { taskId: 'source-thread', path: '/output/chart.png' },
  )
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.getByRole('button', { name: 'Edit and attach Tool image', exact: true }).click()
  await editor.getByRole('button', { name: 'Draw', exact: true }).click()
  const chatDrawing = await editor.getByLabel('Image drawing area').boundingBox()
  await page.mouse.move(
    chatDrawing.x + chatDrawing.width * 0.2,
    chatDrawing.y + chatDrawing.height * 0.5,
  )
  await page.mouse.down()
  await page.mouse.move(
    chatDrawing.x + chatDrawing.width * 0.8,
    chatDrawing.y + chatDrawing.height * 0.5,
    { steps: 8 },
  )
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForFunction(() => !window.busy && window.rows.length === 2)
  assert.match(await page.evaluate(() => window.rows.at(-1).name), /-edited\.png$/)
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.filter((c) => c.path === '/api/tasks/images/read').at(-1).input,
    ),
    { taskId: 'source-thread', eventId: 'generated', index: 0 },
  )
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  await page.evaluate(() => {
    window.rows = Array.from({ length: 5 }, (_, i) => ({
      id: 'full-' + i,
      name: 'full.png',
      mime: 'image/png',
      size: 1,
    }))
    window.refresh()
  })
  await page.getByRole('button', { name: 'Edit and attach Sent image', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'attach up to 5 files' }).waitFor()
  assert.deepEqual(await page.evaluate(() => Object.keys(window.data)), ['photo.png'])
  assert.deepEqual(errors, [])
  console.log(
    'Mobile image editor: real native picker/editor with SVG and touch adapters, drawing pixels, all tools, crop bounds, undo/redo/reset, composer replacement, asynchronous writes, export/upload failures, cancellation, screenshot edit/attach/cancel/validation, chat-image reuse/drawing/cancel/limits, original preservation and cache cleanup passed.',
  )
} finally {
  await browser.close()
}
