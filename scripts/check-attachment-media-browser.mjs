import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname
const component = root + 'packages/extension-tasks/src/chat/composer'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: component,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {MessageAttachments} from './message-attachments';import {ConversationVisibilityContext} from '../conversation-visibility';
const files=[{id:'image',name:'picture.png',mime:'image/png',size:2000000},{id:'audio',name:'sound.wav',mime:'audio/wav',size:44},{id:'video',name:'movie.webm',mime:'video/webm',size:641},{id:'bad',name:'broken.mp4',mime:'video/mp4',size:1},{id:'unknown',name:'unknown.bin',mime:'application/octet-stream',size:1}];
const wav=new Uint8Array(8044);const view=new DataView(wav.buffer);for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<text.length;i++)wav[offset+i]=text.charCodeAt(i);view.setUint32(4,8036,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,8000,true);view.setUint16(32,1,true);view.setUint16(34,8,true);view.setUint32(40,8000,true);wav.fill(128,44);
window.reads=[];window.thumbURI=document.createElement('canvas').toDataURL('image/webp');window.store={connected:true,connection:{address:'http://host.local',token:'token'},request:async (_path,input)=>{window.reads.push({path:_path,...input});if(_path==='/api/tasks/images/read'){const uri=window.thumbURI;if(window.holdThumb)await new Promise(resolve=>window.releaseThumb=resolve);return {uri}};const {id}=input;if(window.holdRead)await new Promise(resolve=>window.releaseRead=resolve);return {attachment:files.find(file=>file.id===id),data:id==='audio'?btoa(String.fromCharCode(...wav)):id==='video'?'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJREU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggI77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhAj0AAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIbYS6ln5m7NKcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgRC6gRCagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/pzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAyc3PVY8CLY8WIbYS6ln5m7NJnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAhOeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiFhIgCAgAMDWAA/v+rUICjlYEAyACxAQAFEKwAGAAYWC/0AAgAAKOVgQGQALEBAAUQrAAYABhYL/QACAAAo5WBAlgAsQEABRCsABgAGFgv9AAIAACjlYEDIACxAQAFEKwAGAAYWC/0AAgAABxTu2uRu4+zgQC3iveBAfGCAbHwgQM=':btoa('not media')}}};
function App(){const [version,setVersion]=useState(0);window.bump=()=>setVersion(value=>value+1);const [visible,setVisible]=useState(true);window.setVisible=setVisible;return <ConversationVisibilityContext.Provider value={visible}><div data-visible={visible}><MessageAttachments taskId="task" files={files}/></div></ConversationVisibilityContext.Provider>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const attachmentReadSchema={};export const isImageAttachment=file=>file.mime.startsWith('image/');export const fileSizeLabel=()=>'';export const useWorkspace=()=>window.store;`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: './chat-image-edit-context',
      importer: component,
      contents: `export const EditChatImage=()=>null;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `import {createContext,useContext} from 'react';const C=createContext(()=>{});export const Dialog=({open,onOpenChange,children})=>open?<C.Provider value={onOpenChange}>{children}</C.Provider>:null;export const DialogContent=({children})=>{const close=useContext(C);return <div role="dialog">{children}<button onClick={()=>close(false)}>Close</button></div>};export const DialogFooter=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h1>{children}</h1>;export const DialogDescription=({children})=><p>{children}</p>;export const Button=({children,...props})=><button {...props}>{children}</button>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('img', { name: 'picture.png', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.reads), [
    { path: '/api/tasks/images/read', taskId: 'task', attachmentId: 'image', maxSize: 128 },
  ])
  assert.equal(
    await page.getByRole('img', { name: 'picture.png', exact: true }).getAttribute('src'),
    await page.evaluate(() => window.thumbURI),
  )
  await page.getByRole('button', { name: 'Preview picture.png', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.deepEqual(await page.evaluate(() => window.reads.at(-1)), {
    path: '/api/attachments/read',
    taskId: 'task',
    id: 'image',
  })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  for (const [name, tag] of [
    ['sound.wav', 'audio'],
    ['movie.webm', 'video'],
    ['broken.mp4', 'video'],
  ]) {
    await page.getByRole('button', { name: `Preview ${name}` }).click()
    const media = page.locator(tag)
    await media.waitFor()
    assert.equal(await media.getAttribute('controls'), '')
    assert.equal(await media.getAttribute('autoplay'), null)
    if (name !== 'broken.mp4') {
      await media.evaluate(async (element) => {
        await element.play()
      })
      assert.equal(await media.evaluate((element) => element.paused), false)
      if (tag === 'audio')
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true })
          document.dispatchEvent(new Event('visibilitychange'))
        })
      if (tag === 'audio') await media.waitFor({ state: 'detached' })
      if (tag === 'audio')
        await page.evaluate(() => {
          delete document.hidden
        })
    } else {
      await page
        .getByRole('alert')
        .getByText('Unable to play this file. Download it to open elsewhere.')
        .waitFor()
    }
    if (tag !== 'audio') {
      assert.equal(await page.getByRole('button', { name: 'Download file' }).count(), 1)
      await page.getByRole('button', { name: 'Close' }).click()
    }
    await media.waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: 'Preview unknown.bin' }).click()
  await page.getByText('not media').waitFor()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Preview movie.webm' }).click()
  await page.locator('video').evaluate(async (media) => {
    await media.play()
  })
  await page.evaluate(() => window.setVisible(false))
  await page.locator('video').waitFor({ state: 'detached' })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.setVisible(true)
    window.holdRead = true
  })
  await page.getByRole('button', { name: 'Preview sound.wav' }).click()
  await page.waitForFunction(() => !!window.releaseRead)
  await page.evaluate(() => window.setVisible(false))
  await page.locator('[data-visible="false"]').waitFor()
  await page.evaluate(() => window.setVisible(true))
  await page.evaluate(() => window.releaseRead())
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Preview sound.wav"]').disabled,
  )
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => {
    window.holdThumb = true
    window.thumbURI += '#old'
    window.store.connection = { ...window.store.connection, token: 'new-pairing' }
    window.bump()
  })
  await page.waitForFunction(() => !!window.releaseThumb)
  await page.evaluate(() => {
    window.holdThumb = false
    window.thumbURI += '#new'
    window.store.connection = { ...window.store.connection, address: 'http://new-host.local' }
    window.bump()
  })
  await page.waitForFunction(
    () => document.querySelector('img[alt="picture.png"]')?.src === window.thumbURI,
  )
  await page.evaluate(() => window.releaseThumb())
  assert.equal(
    await page.getByRole('img', { name: 'picture.png', exact: true }).getAttribute('src'),
    await page.evaluate(() => window.thumbURI),
  )
  console.log(
    'Bounded image previews, full original reads, stale connection replies, and desktop attachment media controls, errors, close and unknown fallback passed.',
  )
} finally {
  await browser.close()
}
