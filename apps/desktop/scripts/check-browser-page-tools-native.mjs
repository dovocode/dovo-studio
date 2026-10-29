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
import { app, BrowserWindow, WebContentsView } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
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
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:true}))
  console.log('Native browser page tools: literal/regex/case, next/previous/wrap, hidden text, open shadow DOM, cross-origin frames, native Cmd/Ctrl+F, cleanup, strict-CSP JSON highlighting, raw toggle, safe markup and original POST response passed.')
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
