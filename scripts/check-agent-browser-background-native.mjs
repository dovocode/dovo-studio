#!/usr/bin/env node
/** Drive the real desktop CDP host while another tab/window owns user focus. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
const require = createRequire(join(desktop, 'package.json'))
const work = mkdtempSync(join(tmpdir(), 'dovo-agent-background-'))
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')
mkdirSync(join(work, 'studio'))
writeFileSync(
  join(work, 'studio/index.html'),
  '<!doctype html><title>Studio</title><input id="draft" value="Studio draft">',
)
writeFileSync(
  join(work, 'studio/preload.cjs'),
  `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('bridge',{browser:command=>ipcRenderer.invoke('preview:browser',command)});`,
)
writeFileSync(
  join(work, 'main.ts'),
  String.raw`
import assert from 'node:assert/strict'
import { app, BrowserWindow, WebContentsView, webContents } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { registerBrowser } from ${JSON.stringify(join(desktop, 'electron/browser.ts'))}
void (async () => {
const work = process.env.SMOKE_DIR!
app.setPath('userData', join(work, 'user-data'))
await app.whenReady()
const runtimeModule = ${JSON.stringify(pathToFileURL(join(root, 'packages/runtime/dist/previews/desktop-browser.js')).href)}
const { desktopBrowserCommand, desktopWorkspaceTargets } = await import(/* @vite-ignore */ runtimeModule)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (check: () => boolean | Promise<boolean>, message: string) => {
  const end = Date.now() + 5000
  while (!(await check())) { assert(Date.now() < end, message); await wait(20) }
}
const server = createServer((_request,response) => {
  response.setHeader('Content-Type','text/html')
  response.end('<!doctype html><title>Background form</title><label>Name<input id="name"></label><input id="other" value="Other field"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'#name\').value">Save</button><output></output><div id="scroll" role="region" aria-label="Results" style="height:80px;overflow:auto"><div style="height:2000px">Results</div></div><div style="height:2500px"></div>')
})
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const origin = 'http://127.0.0.1:' + address.port
writeFileSync(process.env.DOVO_SETTINGS_PATH!,JSON.stringify({app:{browserWorkspaceEnabled:true,browserProfiles:[{id:'default',name:'Default'}]}}))
const index = join(work,'studio/index.html')
const studio = new BrowserWindow({width:900,height:700,webPreferences:{preload:join(work,'studio/preload.cjs'),sandbox:true,contextIsolation:true}})
const editor = new BrowserWindow({width:500,height:300,show:false,webPreferences:{sandbox:true,contextIsolation:true}})
const bridge = registerBrowser(index,work)
const clients: WebSocket[] = []
try {
  await studio.loadFile(index)
  await editor.loadURL('data:text/html,<title>Editor</title><input id="draft" value="Unsaved editor draft">')
  const call = (command: object) => studio.webContents.executeJavaScript('window.bridge.browser('+JSON.stringify(command)+')')
  const show = {action:'show',key:'studio:browser:background',taskId:'studio:browser',tabId:'background',agentAccess:true,workspaceBrowser:true,keepAwake:false,url:origin,bounds:{x:0,y:40,width:850,height:600}}
  await call(show)
  const view = studio.contentView.children.find(child => child instanceof WebContentsView) as WebContentsView
  assert(view)
  const page = view.webContents
  await until(() => !page.isLoading(),'Background page loaded')
  await call({...show,key:'studio:browser:foreground',tabId:'foreground',agentAccess:false,url:origin+'/foreground'})
  const foreground = studio.contentView.children.find(child => child instanceof WebContentsView && child !== view) as WebContentsView
  assert(foreground)
  await until(() => !foreground.webContents.isLoading(),'Foreground page loaded')
  foreground.webContents.focus()
  await foreground.webContents.executeJavaScript('document.querySelector("#other").focus()')
  const refFor = (state: {snapshot:string}, role: string, name: string) => {
    const line = state.snapshot.split('\n').find(line => line.includes('- '+role+' '+JSON.stringify(name)))
    const ref = line && /\[ref=([^\]]+)\]/.exec(line)?.[1]
    assert(ref,'Missing reference for '+name)
    return 'ref='+ref
  }
  const command = (input: object) => desktopBrowserCommand('desktop:background',input,()=>{})
  const focusEvents: string[] = []
  studio.on('focus',()=>focusEvents.push('studio'))
  page.on('focus',()=>focusEvents.push('page'))
  const exercise = async (label: string, owner: Electron.WebContents) => {
    const expectedWindow = owner === editor.webContents ? editor : studio
    await until(() => BrowserWindow.getFocusedWindow()?.id === expectedWindow.id && webContents.getFocusedWebContents()?.id === owner.id, label+': fixture focus settled')
    const ownerWindow = BrowserWindow.getFocusedWindow()?.id
    const ownerContents = webContents.getFocusedWebContents()?.id
    const selectedVisible = foreground.getVisible()
    assert.equal(ownerContents,owner.id,label+': fixture owns input focus')
    focusEvents.length = 0
    const initial = await command({action:'snapshot'})
    assert(!('image' in initial))
    const filled = await command({action:'fill',selector:refFor(initial,'textbox','Name'),text:label})
    // Deliberately focus another element inside the background page. The named key target must win.
    await page.executeJavaScript('document.querySelector("#other").focus()')
    const keyed = await command({action:'key',selector:refFor(filled,'textbox','Name'),key:'!'})
    assert.equal(await page.executeJavaScript('document.querySelector("#name").value'),label+'!')
    await command({action:'click',selector:refFor(keyed,'button','Save')})
    assert.equal(await page.executeJavaScript('document.querySelector("output").textContent'),label+'!')
    const shortened = await command({action:'key',selector:'#name',key:'Backspace'})
    assert.equal(await page.executeJavaScript('document.querySelector("#name").value'),label)
    await command({action:'scroll',selector:refFor(shortened,'region','Results'),deltaY:200})
    assert((await page.executeJavaScript('document.querySelector("#scroll").scrollTop')) > 0)
    await command({action:'scroll',deltaY:200})
    assert((await page.executeJavaScript('window.scrollY')) > 0)
    await assert.rejects(command({action:'key',selector:refFor(initial,'textbox','Name'),key:'X'}),/stale/)
    await command({action:'reload'})
    await command({action:'navigate',url:origin+'/next'})
    await command({action:'back'})
    await command({action:'forward'})
    assert.equal(view.getVisible(),false,label+': background tab stays hidden')
    assert.equal(foreground.getVisible(),selectedVisible,label+': selected tab stays selected')
    assert.equal(BrowserWindow.getFocusedWindow()?.id,ownerWindow,label+': window focus preserved')
    assert.equal(webContents.getFocusedWebContents()?.id,ownerContents,label+': input focus preserved')
    assert.deepEqual(focusEvents,[],label+': no temporary focus transfer')
    assert.equal(await page.executeJavaScript('document.visibilityState'),'hidden')
    assert.equal(await owner.executeJavaScript('document.activeElement.id'),owner === foreground.webContents?'other':'draft')
    assert.equal(await owner.executeJavaScript('document.activeElement.value'),owner === foreground.webContents?'Other field':owner === editor.webContents?'Unsaved editor draft':'Studio draft')
  }
  await exercise('Other tab',foreground.webContents)
  await call({action:'hide',key:'studio:browser:foreground'})
  studio.webContents.focus()
  await studio.webContents.executeJavaScript('document.querySelector("#draft").focus()')
  await exercise('Studio editor',studio.webContents)
  editor.show(); editor.focus(); editor.webContents.focus()
  await editor.webContents.executeJavaScript('document.querySelector("#draft").focus()')
  await until(()=>webContents.getFocusedWebContents()?.id === editor.webContents.id,'Editor focused')
  await exercise('Other window',editor.webContents)
  studio.hide()
  await exercise('Hidden window',editor.webContents)
  assert.equal(studio.isVisible(),false,'Agent does not show Studio')
  studio.showInactive(); studio.minimize()
  await until(()=>studio.isMinimized(),'Studio minimized')
  editor.focus(); editor.webContents.focus()
  await until(()=>webContents.getFocusedWebContents()?.id === editor.webContents.id,'Editor focused after minimize')
  await exercise('Minimized window',editor.webContents)
  assert.equal(studio.isMinimized(),true,'Agent does not restore Studio')
  // Multiple clients keep background scheduling enabled until the final disconnect.
  const endpoint = desktopWorkspaceTargets().find((target: {tabId?:string})=>target.tabId === 'background')!.endpoint
  const connect = async () => {
    const socket = new WebSocket(endpoint); clients.push(socket)
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
    return socket
  }
  const disconnect = async (socket: WebSocket) => {
    const closed = new Promise<void>(resolve=>socket.once('close',()=>resolve()))
    socket.close(); await closed
  }
  const first = await connect()
  assert.equal(page.getBackgroundThrottling(),false)
  const second = await connect()
  await disconnect(first)
  assert.equal(page.getBackgroundThrottling(),false)
  await disconnect(second)
  await until(()=>page.getBackgroundThrottling(),'Throttling restored after final client')
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:true}))
  console.log('Native background browser passed: tree refs, fill, targeted keys, clicks and scroll with a Studio draft, another tab/window focused and Studio hidden/minimized; no focus transfer or draft changes; connection scheduling restored.')
} catch(error) {
  writeFileSync(join(work,'result.json'),JSON.stringify({ok:false,error:error instanceof Error?error.stack:String(error)}))
} finally {
  for (const client of clients) client.terminate()
  await bridge.dispose(); editor.destroy(); studio.destroy(); server.close(); app.exit()
}
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
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron', '@dovo/runtime/browser-favicon'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
const args = [
  require('electron'),
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  join(work, 'out/main.cjs'),
]
const needsDisplay =
  process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
const child = spawnSync(
  needsDisplay ? 'xvfb-run' : args[0],
  needsDisplay ? ['-a', ...args] : args.slice(1),
  {
    env: {
      ...process.env,
      SMOKE_DIR: work,
      DOVO_SETTINGS_PATH: join(work, 'settings.json'),
      DOVO_RELEASE_DISTRIBUTION: 'desktop',
      DOVO_DATABASE_PATH: join(work, 'runtime.sqlite'),
      VITE_DEV_SERVER_URL: '',
    },
    encoding: 'utf8',
    timeout: 60000,
  },
)
let result
try {
  result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'))
} catch {
  result = { ok: false, error: child.error?.message ?? 'No native result' }
}
if (!result.ok) {
  console.error(result, child.stdout?.slice(-2500), child.stderr?.slice(-2500))
  console.error('Harness retained:', work)
  process.exitCode = 1
} else {
  console.log(child.stdout.trim())
  rmSync(work, { recursive: true, force: true })
}
