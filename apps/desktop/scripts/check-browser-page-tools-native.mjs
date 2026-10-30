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
import { app, BrowserWindow, WebContentsView, clipboard, dialog } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowser } from ${JSON.stringify(join(desktop, 'electron/browser.ts'))}
import { registerBrowserWindows } from ${JSON.stringify(join(desktop, 'electron/browser-window.ts'))}
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
    "const canvas=document.createElement('canvas');const context=canvas.getContext('2d');window.callColor='green';" +
    "function draw(){context.fillStyle=window.callColor;context.fillRect(0,0,300,150);requestAnimationFrame(draw)}draw();" +
    "window.callReady=(async()=>{const stream=canvas.captureStream(30);const sender=new RTCPeerConnection();const receiver=new RTCPeerConnection();window.callPeers=[sender,receiver];" +
    "receiver.ontrack=event=>{call.srcObject=event.streams[0]};for(const track of stream.getTracks())sender.addTrack(track,stream);" +
    "const gathered=peer=>new Promise(resolve=>{if(peer.iceGatheringState==='complete')return resolve();const ready=()=>{if(peer.iceGatheringState==='complete'){peer.removeEventListener('icegatheringstatechange',ready);resolve()}};peer.addEventListener('icegatheringstatechange',ready)});" +
    "await sender.setLocalDescription(await sender.createOffer());await gathered(sender);await receiver.setRemoteDescription(sender.localDescription);" +
    "await receiver.setLocalDescription(await receiver.createAnswer());await gathered(receiver);await sender.setRemoteDescription(receiver.localDescription)})();" +
    "navigator.mediaSession.setActionHandler('enterpictureinpicture',async()=>{const child=await documentPictureInPicture.requestWindow({width:420,height:280});child.document.body.append(document.getElementById('call'));child.addEventListener('pagehide',()=>{window.closedWhileHidden=document.hidden;if(!document.hidden)document.body.append(child.document.getElementById('call'))},{once:true})});</script>")
  else if (request.url === '/frame') response.end('<!doctype html><p>frame world</p>')
  else response.end('<!doctype html><p>Hello <b>world</b> world</p><p hidden>world hidden</p><div id="shadow"></div><iframe src="http://localhost:'+port+'/frame"></iframe><script>document.getElementById("shadow").attachShadow({mode:"open"}).innerHTML="<p>shadow world</p>"</script>')
})
await new Promise<void>(resolve => server.listen(0,'0.0.0.0',resolve))
const port = (server.address() as {port:number}).port
const origin = 'http://127.0.0.1:'+port
await app.whenReady()
const index = join(work,'studio','index.html')
writeFileSync(process.env.DOVO_SETTINGS_PATH!,JSON.stringify({app:{browserWorkspaceEnabled:true,browserProfiles:[{id:'default',name:'Default'}]}}))
const studio = new BrowserWindow({width:1000,height:800,webPreferences:{preload:join(work,'studio','preload.cjs'),sandbox:true,contextIsolation:true}})
const windows = registerBrowserWindows(index,join(work,'studio','preload.cjs'))
const placeholder = {action:'sync-tabs',key:'workspace',activeId:'empty',tabs:[{key:'empty-key',tab:{id:'empty',url:'',title:'',kind:'web',profileId:'default'}}]}
const bridge = registerBrowser(index,undefined,undefined,{
  ...windows,
  main:async()=>studio,
  create:async()=>{
    const target=await windows.create()
    await target.webContents.executeJavaScript('window.bridge.browser('+JSON.stringify(placeholder)+')')
    return target
  },
})
windows.onClose(bridge.returnWindowTabs)
const previousClipboard = await clipboard.readText()
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
  await page.executeJavaScript("document.querySelector('[aria-label=\"Show raw JSON\"]').click()")
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),payload)
  await page.executeJavaScript("document.querySelector('[aria-label=\"Show formatted JSON\"]').click()")
  assert.equal((await find('"ok"')).find.total,1)
  const filterJson = (path: string) => page.executeJavaScript('(() => {const input=document.querySelector("input");input.value='+JSON.stringify(path)+';input.closest("form").requestSubmit()})()')
  await filterJson('$.items[*]')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),'[\n  1,\n  2\n]')
  assert.equal(await page.executeJavaScript('document.querySelector("[role=status]").textContent'),'2 matches')
  assert.ok(await page.executeJavaScript('document.querySelectorAll("code span").length>0'))
  await filterJson('$.id')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),'900719925474099312345')
  page.focus()
  await page.executeJavaScript("document.querySelector('[aria-label=\"Copy JSON\"]').click()", true)
  for(let i=0;i<50 && (await page.executeJavaScript('document.querySelector("[aria-label=\\"Copy JSON\\"]").textContent'))!=='Copied';i++) await wait(20)
  assert.equal(await clipboard.readText(),'900719925474099312345','Copy uses the filtered result, preserving the original number')
  await filterJson('$.items[')
  assert.equal(await page.executeJavaScript('document.querySelector("input").getAttribute("aria-invalid")'),'true')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),'900719925474099312345')
  await filterJson('$.missing')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),'[]')
  assert.equal(await page.executeJavaScript('document.querySelector("[role=status]").textContent'),'No matches')
  await filterJson('$.html')
  assert.equal(await page.executeJavaScript('!!window.pwned'),false,'Filtered strings remain escaped')
  assert.equal(await page.executeJavaScript('document.querySelector("code").textContent'),'"<script>window.pwned=true</script>"')
  const fullBounds = view.getBounds()
  view.setBounds({...fullBounds,width:320})
  await wait(30)
  assert.equal(await page.executeJavaScript('document.querySelector("header").scrollWidth<=document.querySelector("header").clientWidth'),true,'JSONPath toolbar fits narrow tabs')
  view.setBounds(fullBounds)
  await page.executeJavaScript("document.querySelector('[aria-label=\"Clear JSONPath filter\"]').click()")
  assert.equal(await page.executeJavaScript('document.querySelector("input").value'),'')
  assert.equal(await page.executeJavaScript('document.querySelector("input").getAttribute("aria-invalid")'),null)
  assert.equal(jsonRequests,1,'Filtering never repeats the original request')
  await page.loadURL(origin+'/invalid')
  await wait(100)
  assert.equal(await page.executeJavaScript('document.documentElement.hasAttribute("data-dovo-json")'),false)
  await call({action:'show',key:'call',url:origin+'/call',workspaceBrowser:true,bounds:{x:0,y:40,width:1000,height:760}})
  const callPage = studio.contentView.children.find(child => child instanceof WebContentsView && child.webContents.getURL()===origin+'/call').webContents
  await callPage.executeJavaScript('window.callReady')
  await call({action:'set-site-permission',key:'call',origin,permission:'automatic-pip',setting:'allow'})
  const expectVideoColor = async (contents: Electron.WebContents, color: string, channel: number) => {
    await callPage.executeJavaScript('window.callColor='+JSON.stringify(color))
    for(let i=0;i<50;i++) {
      const pixel=(await contents.capturePage({x:20,y:20,width:1,height:1})).toBitmap()
      // NativeImage uses BGRA; allow the small color shifts from WebRTC video encoding.
      if(pixel[channel]>200 && pixel[(channel+2)%4]<40 && pixel[1]<40) return
      await wait(20)
    }
    assert.fail('PiP did not paint the incoming '+color+' WebRTC frame')
  }
  for (let cycle=0;cycle<2;cycle++) {
    await call({action:'hide',key:'call'})
    let header
    for(let i=0;i<100;i++){header=BrowserWindow.getAllWindows().find(window=>window.isAlwaysOnTop());if(header && !header.webContents.isLoading() && (await header.webContents.executeJavaScript("!!document.querySelector('[data-action=return]')")))break;await wait(20)}
    assert.ok(header,'Automatic call PiP opens when leaving its tab')
    const pipPage=header.contentView.children.find(child=>child instanceof WebContentsView).webContents
    assert.equal(pipPage.getBackgroundThrottling(),false,'The adopted PiP guest itself must be unthrottled')
    assert.equal(callPage.getBackgroundThrottling(),false,'The hidden call owner must remain unthrottled')
    await expectVideoColor(pipPage,'blue',0)
    const frames=await pipPage.executeJavaScript('document.getElementById("call").getVideoPlaybackQuality().totalVideoFrames')
    studio.hide()
    await expectVideoColor(pipPage,'red',2)
    assert.ok(await pipPage.executeJavaScript('document.getElementById("call").getVideoPlaybackQuality().totalVideoFrames')>frames,'Incoming video keeps decoding while the main window is hidden')
    studio.show()
    const point = await header.webContents.executeJavaScript("(()=>{const rect=document.querySelector('[data-action=return]').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()")
    header.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    header.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    for(let i=0;i<100 && !(await callPage.executeJavaScript('!document.hidden && !!document.getElementById("call")'));i++)await wait(20)
    assert.equal(await callPage.executeJavaScript('window.closedWhileHidden'),false,'Production Back to tab makes Teams visible before the PiP pagehide')
    assert.equal(await callPage.executeJavaScript('document.getElementById("call").srcObject.getTracks()[0].readyState'),'live')
  }
  await call({action:'close',key:'call'})
  await call({action:'close',key:'page'})
  await call({action:'show',key:'workspace-live',url:origin+'/workspace',workspaceBrowser:true,keepAwake:true,bounds:{x:0,y:40,width:1000,height:760}})
  const live = studio.contentView.children.find(child=>child instanceof WebContentsView && child.webContents.getURL()===origin+'/workspace') as WebContentsView
  const liveId = live.webContents.id
  await live.webContents.executeJavaScript('window.unsentDraft="keep this exact document"')
  const tabs = [
    {key:'workspace-live',tab:{id:'live',url:origin+'/workspace',title:'Pinned app',kind:'web',profileId:'default',pinned:true,homeUrl:origin+'/workspace',keepAwake:true}},
    {key:'workspace-sleeping',tab:{id:'sleeping',url:origin+'/later',title:'Read later',kind:'web',profileId:'default',settledAt:Date.now()}},
    {key:'workspace-remote',tab:{id:'remote',url:'http://lan.local/',title:'Remote app',kind:'remote',profileId:'default',runtimeId:'server',snoozedUntil:Date.now()+60000}},
  ]
  await call({action:'sync-tabs',key:'workspace',tabs,activeId:'live'})
  await call({action:'detach-tabs',key:'workspace',tabs,activeId:'live'})
  const detached = windows.list()[0]
  assert.ok(detached)
  assert.ok(detached.contentView.children.includes(live),'Detaching reparents the existing native view')
  assert.equal(live.webContents.id,liveId)
  assert.equal(await live.webContents.executeJavaScript('window.unsentDraft'),'keep this exact document')
  const moved = await detached.webContents.executeJavaScript('window.bridge.browser('+JSON.stringify({action:'status',key:'workspace-live',tabCount:1})+')')
  assert.deepEqual(moved.movedTabs.map(item=>item.tab.id),['live','sleeping','remote'])
  assert.equal(moved.movedTabs[0].tab.pinned,true)
  assert.equal(moved.focusedTabKey,'workspace-live')
  await call(placeholder)
  await detached.webContents.executeJavaScript('window.bridge.browser('+JSON.stringify({action:'sync-tabs',key:'workspace',tabs:moved.movedTabs,activeId:'live'})+')')
  const closed = new Promise<void>(resolve=>detached.once('closed',()=>resolve()))
  detached.close()
  for(let i=0;i<100 && !studio.contentView.children.includes(live);i++) await wait(20)
  assert.ok(studio.contentView.children.includes(live),'Closing returns the native page to the main window')
  assert.equal(live.webContents.id,liveId)
  assert.equal(await live.webContents.executeJavaScript('window.unsentDraft'),'keep this exact document')
  const returned = await call({action:'status',key:'workspace-live',tabCount:1})
  assert.equal(detached.isDestroyed(),false,'Source waits until main-window persistence is acknowledged')
  await call({action:'sync-tabs',key:'workspace',tabs:returned.movedTabs,activeId:'live',persisted:true})
  await closed
  assert.deepEqual(returned.movedTabs.map(item=>item.tab.id),['live','sleeping','remote'])
  assert.equal(returned.movedTabs[0].tab.pinned,true)
  assert.equal(returned.movedTabs[1].tab.settledAt,tabs[1].tab.settledAt)
  assert.equal(returned.movedTabs[2].tab.runtimeId,'server')
  // App quit/update use the same save-confirmed return, without closing windows prematurely.
  await call({action:'detach-tabs',key:'workspace',tabs:returned.movedTabs,activeId:'live'})
  await call(placeholder)
  const consolidating = windows.returnAll()
  for(let i=0;i<100 && !studio.contentView.children.includes(live);i++) await wait(20)
  const onQuit = await call({action:'status',key:'workspace-live',tabCount:1})
  await call({action:'sync-tabs',key:'workspace',tabs:onQuit.movedTabs,activeId:'live',persisted:true})
  await consolidating
  assert.ok(studio.contentView.children.includes(live),'Shutdown returns the live page before destroying any windows')
  assert.deepEqual(onQuit.movedTabs.map(item=>item.tab.id),['live','sleeping','remote'])
  // Explicit sleep releases a regular page immediately instead of keeping it in the five-minute cache.
  await call({action:'show',key:'workspace-live',url:origin+'/workspace',workspaceBrowser:true,keepAwake:true,bounds:{x:0,y:40,width:1000,height:760}})
  await call({action:'hide',key:'workspace-live'})
  const liveContents = live.webContents
  const destroyed = new Promise<void>(resolve=>liveContents.once('destroyed',()=>resolve()))
  await call({action:'sleep',key:'workspace-live'})
  await destroyed
  assert.equal(liveContents.isDestroyed(),true)
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:true}))
  console.log('Native browser page tools: find, JSON, zoom, print/PDF, downloads, unthrottled PiP guests and incoming WebRTC video pixels across repeated opens and hidden main windows, workspace detach/return and sleep passed.')
} catch(error) {
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:false,error:error instanceof Error?error.stack:String(error)}))
} finally { await clipboard.writeText(previousClipboard);await bridge.dispose();windows.dispose();studio.destroy();server.close();app.exit() }
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
