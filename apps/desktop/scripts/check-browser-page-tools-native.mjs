#!/usr/bin/env node
/** Real Electron coverage of find IPC, native shortcuts, cross-origin frames and JSON responses. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const work = mkdtempSync(join(tmpdir(), 'dovo-page-tools-'))
const screenshots = fileURLToPath(new URL('../../../work/browser-page-tools/', import.meta.url))
mkdirSync(screenshots, { recursive: true })
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')
mkdirSync(join(work, 'studio'))
writeFileSync(join(work, 'studio', 'index.html'), '<!doctype html><title>Studio</title>')
writeFileSync(
  join(work, 'studio', 'preload.cjs'),
  `const {contextBridge,ipcRenderer}=require('electron');const actions=[];ipcRenderer.on('browser:context-action',(_event,action)=>actions.push(action));contextBridge.exposeInMainWorld('bridge',{browser:command=>ipcRenderer.invoke('preview:browser',command),actions:()=>actions});`,
)
writeFileSync(
  join(work, 'main.ts'),
  String.raw`
import assert from 'node:assert/strict'
import { app, BrowserWindow, WebContentsView, dialog } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowser } from ${JSON.stringify(join(desktop, 'electron/browser.ts'))}
void (async () => {
const work = process.env.SMOKE_DIR!
app.setPath('userData', join(work, 'user-data'))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const payload = '{"id":900719925474099312345,"html":"<script>window.pwned=true</script>","ok":true,"items":[1,2]}'
let jsonRequests = 0
const server = createServer((request,response) => {
  if (request.url === '/json') {
    jsonRequests++
    response.writeHead(200, {'Content-Type':'application/problem+json','Content-Security-Policy':"default-src 'none'; style-src 'none'"}).end(payload)
  } else if (request.url === '/invalid') response.writeHead(200, {'Content-Type':'application/json'}).end('{broken')
  else if (request.url === '/download') {
    response.writeHead(200, {'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="native-test.bin"','Content-Length':655360})
    let sent = 0
    const timer = setInterval(() => {response.write(Buffer.alloc(65536));if (++sent === 10) {clearInterval(timer);response.end()}},100)
    response.on('close', () => clearInterval(timer))
  }
  else if (request.url === '/call') response.end('<!doctype html><title>Teams-style call</title><video id="call" autoplay muted></video><script>' +
    "const canvas=document.createElement('canvas');const context=canvas.getContext('2d');context.fillStyle='green';context.fillRect(0,0,300,150);const stream=canvas.captureStream(10);call.srcObject=stream;" +
    "navigator.mediaSession.setActionHandler('enterpictureinpicture',async()=>{const child=await documentPictureInPicture.requestWindow({width:420,height:280});child.document.body.append(document.getElementById('call'));child.addEventListener('pagehide',()=>{window.closedWhileHidden=document.hidden;if(!document.hidden)document.body.append(child.document.getElementById('call'))},{once:true})});</script>")
  else if (request.url === '/frame') response.end('<!doctype html><p>frame world</p>')
  else response.end('<!doctype html><p>Hello <b>world</b> world</p><p hidden>world hidden</p><div id="shadow"></div><iframe src="http://localhost:'+port+'/frame"></iframe><script>document.getElementById("shadow").attachShadow({mode:"open"}).innerHTML="<p>shadow world</p>"</script>')
})
await new Promise<void>(resolve => server.listen(0,'0.0.0.0',resolve))
const port = (server.address() as {port:number}).port
const origin = 'http://127.0.0.1:'+port
await app.whenReady()
const index = join(work,'studio','index.html')
const bridge = registerBrowser(index)
const studio = new BrowserWindow({width:1000,height:800,webPreferences:{preload:join(work,'studio','preload.cjs'),sandbox:true,contextIsolation:true}})
try {
  await studio.loadFile(index)
  const call = (command: object) => studio.webContents.executeJavaScript('window.bridge.browser('+JSON.stringify(command)+')')
  await call({action:'show',key:'page',url:origin+'/page',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  const view = studio.contentView.children.find(child => child instanceof WebContentsView) as WebContentsView
  const page = view.webContents
  for(let i=0;i<100 && (page.isLoading() || page.mainFrame.framesInSubtree.length < 2);i++) await wait(20)
  // Zoom applies from native focus, follows same-site navigation, and persists per profile.
  assert.equal((await call({action:'zoom',key:'page',direction:'in'})).zoomFactor,1.1)
  page.focus()
  page.sendInputEvent({type:'keyDown',keyCode:'=',modifiers:[process.platform==='darwin'?'meta':'control']})
  page.sendInputEvent({type:'keyUp',keyCode:'=',modifiers:[process.platform==='darwin'?'meta':'control']})
  await wait(100)
  assert.equal(page.getZoomFactor(),1.25)
  await page.loadURL(origin+'/page?again')
  assert.equal(page.getZoomFactor(),1.25)
  assert.equal(JSON.parse(readFileSync(join(work,'user-data','browser-zoom','default.json'),'utf8'))[origin],1.25)
  await call({action:'show',key:'other-profile',url:origin+'/page',profileId:'other',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  assert.equal((await call({action:'status',key:'other-profile'})).zoomFactor,1)
  await call({action:'close',key:'other-profile'})
  await call({action:'show',key:'page',url:origin+'/page?again',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  const privateProfile='private-00000000-0000-4000-8000-000000000008'
  await call({action:'show',key:'private-page',url:origin+'/page',profileId:privateProfile,workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  assert.equal((await call({action:'zoom',key:'private-page',direction:'in'})).zoomFactor,1.1)
  assert.equal(existsSync(join(work,'user-data','browser-zoom',privateProfile+'.json')),false)
  await call({action:'close',key:'private-page'})
  await call({action:'show',key:'private-page',url:origin+'/page',profileId:privateProfile,workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  assert.equal((await call({action:'status',key:'private-page'})).zoomFactor,1,'Private zoom is forgotten with its last tab')
  await call({action:'close',key:'private-page'})
  await call({action:'show',key:'page',url:origin+'/page?again',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  await call({action:'zoom',key:'page',direction:'reset'})
  assert.equal(page.getZoomFactor(),1)
  let printed = 0
  const originalPrint = page.print.bind(page)
  page.print = (_options, callback) => {printed++; callback?.(true,'')}
  await call({action:'print',key:'page'})
  page.focus()
  page.sendInputEvent({type:'keyDown',keyCode:'p',modifiers:[process.platform==='darwin'?'meta':'control']})
  page.sendInputEvent({type:'keyUp',keyCode:'p',modifiers:[process.platform==='darwin'?'meta':'control']})
  await wait(100)
  assert.equal(printed,2)
  page.print = originalPrint
  const originalSave = dialog.showSaveDialog
  dialog.showSaveDialog = async () => ({canceled:false,filePath:join(work,'page.pdf')})
  await call({action:'save-pdf',key:'page'})
  assert.equal(readFileSync(join(work,'page.pdf')).subarray(0,5).toString(),'%PDF-')
  dialog.showSaveDialog = originalSave
  const downloads = (operation = 'list', id?: number, profileId = 'default') => call({action:'downloads',key:'page',profileId,operation,...(id===undefined?{}:{id})})
  page.session.on('will-download', (_event,item) => item.setSavePath(join(work,'download-'+Date.now()+'.bin')))
  page.downloadURL(origin+'/download')
  let download
  for(let i=0;i<100;i++) {download = (await downloads()).downloads[0];if(download?.bytesReceived>0)break;await wait(30)}
  assert.equal((await downloads()).downloads.length,1,'Native and extension APIs share one download tracker')
  assert.equal(download.state,'in_progress')
  await downloads('pause',download.id)
  assert.equal((await downloads()).downloads[0].paused,true)
  await downloads('cancel',download.id)
  for(let i=0;i<50 && (await downloads()).downloads[0].state==='in_progress';i++)await wait(20)
  assert.equal((await downloads()).downloads[0].state,'interrupted')
  assert.equal((await downloads('list',undefined,'other')).downloads.length,0,'Downloads stay in their profile')
  await downloads('retry',download.id)
  let completed
  for(let i=0;i<100;i++){completed=(await downloads()).downloads.find(item=>item.id!==download.id);if(completed?.state==='complete')break;await wait(30)}
  assert.equal(completed.state,'complete')
  assert.equal(completed.bytesReceived,655360)
  assert.equal(completed.exists,true)
  const find = (text: string, options: object = {}) => call({action:'find',key:'page',text,regex:false,matchCase:false,...options})
  assert.equal((await find('world')).find.total,4)
  assert.equal(await page.executeJavaScript('CSS.highlights.get("dovo-find").size'),3)
  assert.equal((await find('world',{direction:'next'})).find.active,2)
  assert.equal((await find('world',{direction:'previous'})).find.active,1)
  assert.equal((await find('world',{direction:'previous'})).find.active,4)
  assert.equal((await find('Hello\\s+world',{regex:true})).find.total,1)
  assert.equal((await find('WORLD',{matchCase:true})).find.total,0)
  assert.ok((await find('[',{regex:true})).find.error)
  assert.equal((await find('world')).find.total,4)
  await call({action:'stop-find',key:'page'})
  assert.equal(await page.executeJavaScript('CSS.highlights.has("dovo-find")'),false)
  page.focus()
  const modifiers = [process.platform==='darwin'?'meta':'control']
  page.sendInputEvent({type:'keyDown',keyCode:'f',modifiers})
  page.sendInputEvent({type:'keyUp',keyCode:'f',modifiers})
  for(let i=0;i<50 && !(await studio.webContents.executeJavaScript('window.bridge.actions().length'));i++) await wait(20)
  assert.equal(await studio.webContents.executeJavaScript('window.bridge.actions().at(-1).action'),'find')
  page.focus()
  page.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  page.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  for(let i=0;i<50 && (await studio.webContents.executeJavaScript('window.bridge.actions().at(-1).action'))!=='close-find';i++) await wait(20)
  assert.equal(await studio.webContents.executeJavaScript('window.bridge.actions().at(-1).action'),'close-find')
  const overlapping = await Promise.all([find('Hello'),find('world')])
  assert.equal(overlapping[1].find.total,4)
  await page.loadURL(origin+'/json',{postData:[{type:'rawData',bytes:Buffer.from('request=original')}],extraHeaders:'Content-Type: application/x-www-form-urlencoded'})
  for(let i=0;i<100 && !(await page.executeJavaScript('document.documentElement.hasAttribute("data-dovo-json")'));i++) await wait(20)
  assert.equal(await page.executeJavaScript('document.querySelector("code")?.textContent'),'{\n  "id": 900719925474099312345,\n  "html": "<script>window.pwned=true</script>",\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}')
  assert.equal(jsonRequests,1,'JSON must use the response already loaded, including POST bodies')
  assert.equal(await page.executeJavaScript('!!window.pwned'),false)
  assert.ok(await page.executeJavaScript('document.querySelectorAll("code span").length>5'))
  assert.equal(await page.executeJavaScript('new Set([...document.querySelectorAll("code span")].map(node=>getComputedStyle(node).color)).size>1'),true,'Token colors must survive strict CSP')
  writeFileSync(join(process.env.SMOKE_SCREENSHOT_DIR!, 'json.png'), (await page.capturePage()).toPNG())
  assert.equal((await find('900719925474099312345')).find.total,1)
  await page.executeJavaScript('document.querySelector("button").click()')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),payload)
  await page.executeJavaScript('document.querySelector("button").click()')
  assert.equal((await find('"ok"')).find.total,1)
  await page.loadURL(origin+'/invalid')
  await wait(100)
  assert.equal(await page.executeJavaScript('document.documentElement.hasAttribute("data-dovo-json")'),false)
  await call({action:'show',key:'call',url:origin+'/call',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  const callPage = studio.contentView.children.find(child => child instanceof WebContentsView && child.webContents.getURL()===origin+'/call').webContents
  await call({action:'set-site-permission',key:'call',origin,permission:'automatic-pip',setting:'allow'})
  for (let cycle=0;cycle<2;cycle++) {
    await call({action:'hide',key:'call'})
    let header
    for(let i=0;i<100;i++){header=BrowserWindow.getAllWindows().find(window=>window.isAlwaysOnTop());if(header && !header.webContents.isLoading() && (await header.webContents.executeJavaScript("!!document.querySelector('[data-action=return]')")))break;await wait(20)}
    assert.ok(header,'Automatic call PiP opens when leaving its tab')
    const point = await header.webContents.executeJavaScript("(()=>{const rect=document.querySelector('[data-action=return]').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()")
    header.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    header.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    for(let i=0;i<100 && !(await callPage.executeJavaScript('!document.hidden && !!document.getElementById("call")'));i++)await wait(20)
    assert.equal(await callPage.executeJavaScript('window.closedWhileHidden'),false,'Production Back to tab makes Teams visible before the PiP pagehide')
    assert.equal(await callPage.executeJavaScript('document.getElementById("call").srcObject.getTracks()[0].readyState'),'live')
  }
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:true}))
  console.log('Native browser page tools: literal/regex/case, next/previous/wrap, hidden text, open shadow DOM, cross-origin frames, native Cmd/Ctrl+F, cleanup, strict-CSP JSON highlighting, raw toggle, safe markup, original POST response, remembered/profile-scoped zoom, native print shortcut, real PDF output and shared native download tracking/pause/cancel/retry passed.')
} catch(error) {
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:false,error:error instanceof Error?error.stack:String(error)}))
} finally { await bridge.dispose();studio.destroy();server.close();app.exit() }
})().catch(error=>{console.error(error);app.exit(1)})
`,
)
const { build } = await import(require.resolve('vite'))
await build({
  configFile: false,
  root: desktop,
  logLevel: 'warn',
  build: {
    ssr: join(work, 'main.ts'),
    outDir: join(work, 'out'),
    minify: false,
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['electron', '@dovo/runtime/browser-favicon'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
const electron = require('electron')
const useDisplay =
  process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
const args = [electron, '--disable-gpu', join(work, 'out', 'main.cjs')]
const child = spawnSync(
  useDisplay ? 'xvfb-run' : args[0],
  useDisplay ? ['-a', ...args] : args.slice(1),
  {
    env: {
      ...process.env,
      SMOKE_DIR: work,
      SMOKE_SCREENSHOT_DIR: screenshots,
      DOVO_SETTINGS_PATH: join(work, 'settings.json'),
      VITE_DEV_SERVER_URL: '',
    },
    encoding: 'utf8',
    timeout: 90000,
  },
)
let result
try {
  result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'))
} catch {
  result = { ok: false, error: child.error?.message ?? 'No native result' }
}
if (!result.ok) {
  console.error(result, child.stdout?.slice(-3000), child.stderr?.slice(-3000))
  console.error('Harness retained:', work)
  process.exitCode = 1
} else {
  console.log(child.stdout.trim())
  rmSync(work, { recursive: true, force: true })
}
