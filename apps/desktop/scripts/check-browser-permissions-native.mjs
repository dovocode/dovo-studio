#!/usr/bin/env node
// Real native web APIs through Studio website permission handlers.
// Only native dialog answers are supplied by the harness; no web API is replaced.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const work = mkdtempSync(join(tmpdir(), 'dovo-browser-permissions-native-'))
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')
writeFileSync(
  join(work, 'main.ts'),
  `import assert from 'node:assert/strict'
import { app, BrowserWindow, dialog } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createBrowserMedia, type MediaTab } from ${JSON.stringify(join(desktop, 'electron/browser-media.ts'))}
import { browserPermissions } from ${JSON.stringify(join(desktop, 'electron/browser-permissions.ts'))}
import { openBrowserDeviceChooser } from ${JSON.stringify(join(desktop, 'electron/browser-device-chooser.ts'))}

app.setPath('userData', ${JSON.stringify(join(work, 'user-data'))})
const server = createServer((request, response) => {
  if(request.url === '/worker.js') { response.setHeader('content-type','application/javascript');response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(clients.claim()));self.addEventListener('message',event=>event.ports[0].postMessage(['sync','periodicSync','backgroundFetch'].map(name=>name in ServiceWorkerRegistration.prototype)))"); return }
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>Device presence permission test</title><p>Idle Detection</p>')
})
let answer = 0
let prompts = 0
Object.assign(dialog, { showMessageBox: async () => {
  prompts++
  return { response: answer, checkboxChecked: false }
} })

const watchdog = setTimeout(()=>{writeFileSync(${JSON.stringify(join(work, 'result.json'))},JSON.stringify({ok:false,error:'Native permission smoke timed out'}));app.exit(1)},15_000)
watchdog.unref()
app.whenReady().then(async () => {
  let ok = false
  let error: string | undefined
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address === 'object')
    const origin = 'http://127.0.0.1:' + address.port
    const tabs: MediaTab[] = []
    const media = createBrowserMedia({
      tabFor: (contents) => tabs.find((tab) => tab.contents === contents),
      tabs: () => tabs,
      canFullscreen: () => true,
      prepareFullscreen: () => {},
    })
    const page = async (profileId: string) => {
      const window = new BrowserWindow({
        width: 500, height: 400,
        webPreferences: { partition: profileId, sandbox: true, contextIsolation: true },
      })
      tabs.push({ key: profileId, profileId, windowId: window.id, contents: window.webContents })
      media.attachSession(window.webContents.session, profileId)
      media.attachTab(window.webContents)
      await window.loadURL(origin)
      return window
    }
    const workPage = await page('work')
    const run = (source: string, window = workPage): Promise<unknown> =>
      window.webContents.executeJavaScript(source, true)
    workPage.show(); workPage.focus()
    await run('Promise.all(["camera","microphone","geolocation"].map(name=>navigator.permissions.query({name}))).then(()=>true)')
    assert.deepEqual(browserPermissions('work').site(origin).requested,[], 'Passive permission queries do not fill the menu')
    const results: Record<string, unknown> = {}
    const stage = (name: string) => writeFileSync(${JSON.stringify(join(work, 'stage.txt'))},name)
    const check = async (name: string, source: string) => {
      stage(name)
      results[name] = await run('(async()=>{try{return {value:await ('+source+')}}catch(error){return {error:error.name,message:error.message}}})()')
    }
    workPage.webContents.debugger.attach('1.3')
    await workPage.webContents.debugger.sendCommand('Emulation.setGeolocationOverride',{latitude:52,longitude:4,accuracy:10})
    await check('location','new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(position=>resolve(position.coords.latitude),reject,{timeout:3000}))')
    workPage.webContents.debugger.detach()
    await check('fonts', 'queryLocalFonts().then(fonts=>fonts.length)')
    await check('midi', 'navigator.requestMIDIAccess().then(access=>({inputs:access.inputs.size,outputs:access.outputs.size}))')
    await check('midiSysex', 'navigator.requestMIDIAccess({sysex:true}).then(access=>access.sysexEnabled)')
    await check('displays', 'getScreenDetails().then(details=>details.screens.length)')
    await check('pointer', 'document.body.requestPointerLock().then(()=>!!document.pointerLockElement)')
    await run('document.exitPointerLock();true')
    await check('keyboard', 'navigator.keyboard.lock(["KeyW"]).then(()=>true)')
    await run('navigator.keyboard.unlock();true')
    stage('service-worker registration')
    await run('navigator.serviceWorker.register("/worker.js").then(()=>navigator.serviceWorker.ready).then(()=>true)')
    assert.deepEqual(await run('(["sync","periodicSync","backgroundFetch"].map(name=>name in ServiceWorkerRegistration.prototype))'),[false,false,false])
    stage('service-worker feature detection')
    assert.deepEqual(await run('navigator.serviceWorker.ready.then(registration=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=event=>resolve(event.data);registration.active.postMessage(null,[channel.port2])}))'),[false,false,false])
    for (const key of ['location','fonts','midi','midiSysex','displays','pointer','keyboard']) {
      const result = results[key]
      assert(result && typeof result === 'object' && 'value' in result, key + ': ' + JSON.stringify(result))
    }
    assert.equal(prompts,6)
    const requested = browserPermissions('work').site(origin).requested
    for (const permission of ['geolocation','local-fonts','midi','window-management','pointerLock','keyboardLock'])
      assert(requested.includes(permission), 'Native request recorded: '+permission)
    assert(!requested.includes('microphone') && !requested.includes('camera'))
    assert.equal(browserPermissions('work').site(origin).permissions['local-fonts'],'ask')
    const personal = await page('personal')
    answer = 2
    personal.focus()
    const denied = await run('queryLocalFonts().then(()=>"bad",error=>error.name)', personal)
    assert.equal(denied,'NotAllowedError')
    assert.equal(browserPermissions('personal').site(origin).permissions['local-fonts'],'block')
    assert.deepEqual(browserPermissions('personal').site(origin).requested,['local-fonts'])
    assert.equal(browserPermissions('work').site(origin).permissions['local-fonts'],'ask')
    stage('device chooser')
    const chooser = openBrowserDeviceChooser({ title: 'Native chooser smoke', message: origin, devices: [{id:'first',label:'<img src=x onerror=alert(1)>',remember:true}] })
    const chooserWindow = BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Native chooser smoke')!
    await new Promise(resolve=>chooserWindow.webContents.once('did-finish-load',resolve))
    const choose = (code: string) => chooserWindow.webContents.executeJavaScript(code)
    assert.equal(await choose('document.querySelector("option").textContent'),'<img src=x onerror=alert(1)>')
    assert.equal(await choose('document.querySelector("img") === null'),true)
    writeFileSync(${JSON.stringify(join(work, 'chooser.png'))},(await chooserWindow.webContents.capturePage()).toPNG())
    chooser.update([{id:'updated',label:'Updated device',remember:true}])
    await choose('new Promise(resolve=>{const select=document.querySelector("select");if(select.querySelector("option")?.value==="updated")return resolve(true);const observer=new MutationObserver(()=>{if(select.querySelector("option")?.value==="updated"){observer.disconnect();resolve(true)}});observer.observe(select,{childList:true})})')
    await choose('document.querySelector("select").value="updated";document.querySelector("select").dispatchEvent(new Event("change"));document.querySelector("#remember input").checked=true;document.querySelector("#connect").click();true')
    assert.deepEqual(await chooser.answer,{id:'updated',remember:true})
    writeFileSync(${JSON.stringify(join(work, 'apis.json'))},JSON.stringify(results,null,2))
    ok = true
  } catch (cause) {
    error = cause instanceof Error ? cause.stack : String(cause)
  }
  writeFileSync(${JSON.stringify(join(work, 'result.json'))}, JSON.stringify({ ok, error, prompts }))
  app.exit(ok ? 0 : 1)
})
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
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
const electron = require('electron')
const display = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
const command = display ? 'xvfb-run' : electron
const args = [...(display ? ['-a', electron] : []), join(work, 'out', 'main.cjs')]
const child = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 })
let result
try {
  result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'))
} catch {
  result = {
    ok: false,
    error:
      (child.error?.message ?? 'No native result was written.') +
      ' at ' +
      readFileSync(join(work, 'stage.txt'), 'utf8'),
  }
}
if (!result.ok) {
  console.error(result, child.stderr?.slice(-3000), child.stdout?.slice(-3000))
  console.error('Smoke files kept in ' + work)
} else {
  console.log('Native permissions smoke passed.')
  console.log(readFileSync(join(work, 'apis.json'), 'utf8'))
  if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true })
}
process.exit(result.ok ? 0 : 1)
