#!/usr/bin/env node
/**
 * Real Electron smoke for shared-browser Chrome extensions.
 *
 * Builds a harness around the production `registerBrowser` and drives it through the same IPC a
 * trusted Studio window uses (`preview:browser`, `browser:extensions`, `app:settings-write`).
 * Only Electron's folder picker and message boxes are scripted, because no person answers them.
 *
 * Covers a small MV3 fixture, not arbitrary extensions: review before load, nativeMessaging
 * permission review, content script and popup messaging, tabs/windows/storage/action APIs, extension tab
 * adoption, runtime permission prompts, profile isolation, opt-out stopping workers, restart
 * persistence and removal. Run after upgrading electron-chrome-extensions or Electron.
 *
 * Usage: node apps/desktop/scripts/check-browser-extensions-native.mjs [--keep]
 * Linux without a display needs `xvfb-run`. The Chromium sandbox must be available.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const keep = process.argv.includes('--keep')
const websites = process.argv.includes('--websites')
const store = process.argv.includes('--store')
const work = mkdtempSync(join(tmpdir(), 'dovo-browser-extensions-native-'))
// Keep native image dependencies in their installed packages rather than bundling their loaders.
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')

const write = (path, contents) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}
if (process.platform !== 'win32') {
  write(
    join(work, 'native-echo.py'),
    `#!/usr/bin/env python3
import json,struct,sys
header=sys.stdin.buffer.read(4)
if len(header)==4:
    message=sys.stdin.buffer.read(struct.unpack('<I',header)[0])
    data=json.dumps({'echo':json.loads(message)}).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I',len(data))+data)
    sys.stdout.buffer.flush()
`,
  )
  chmodSync(join(work, 'native-echo.py'), 0o700)
}
const fixture = join(work, 'fixture')
const manifest = {
  manifest_version: 3,
  name: 'Dovo native smoke',
  version: '1.0.0',
  action: { default_popup: 'popup.html', default_title: 'Smoke' },
  background: { service_worker: 'sw.js' },
  permissions: ['storage', 'tabs'],
  optional_permissions: ['bookmarks', 'nativeMessaging'],
  content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['cs.js'] }],
}
write(join(fixture, 'manifest.json'), JSON.stringify(manifest, null, 2))
write(
  join(fixture, 'sw.js'),
  `chrome.runtime.onMessage.addListener((message, sender, reply) => {
  ;(async () => {
    const result = { from: message.from }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    result.activeTab = tab && tab.url
    result.window = (await chrome.windows.getCurrent()).id
    const { runs = 0 } = await chrome.storage.local.get('runs')
    await chrome.storage.local.set({ runs: runs + 1 })
    result.runs = runs + 1
    await chrome.action.setBadgeText({ text: 'ok' })
    result.badge = await chrome.action.getBadgeText({})
    if (message.openTab) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('page.html') })
      result.tabCreated = true
    }
    reply(result)
  })().catch((error) => reply({ error: String(error) }))
  return true
})
`,
)
write(
  join(fixture, 'popup.html'),
  '<!doctype html><meta charset="utf-8"><p>smoke</p><script src="popup.js"></script>',
)
write(
  join(fixture, 'popup.js'),
  `chrome.runtime.sendMessage({ from: 'popup', openTab: true }, async (result) => {
  const request = async (name, permissions) => {
    try { result[name] = await chrome.permissions.request(permissions) }
    catch (error) { result[name] = 'error: ' + String(error.message || error) }
  }
  await request('bookmarks', { permissions: ['bookmarks'] })
  await request('undeclaredSite', { origins: ['https://undeclared.example/*'] })
  await request('nativeMessaging', { permissions: ['nativeMessaging'] })
  if (navigator.platform !== 'Win32') {
    try { result.nativeEcho = await chrome.runtime.sendNativeMessage('com.dovo.smoke', {text:'Dovo naïve 🔑'}) }
    catch(error) { result.nativeEcho = String(error) }
  }
  document.title = 'POPUP:' + JSON.stringify(result)
})
`,
)
write(join(fixture, 'page.html'), '<!doctype html><title>extension page</title>')
write(
  join(fixture, 'cs.js'),
  `chrome.runtime.sendMessage({ from: 'content' }, (result) => { document.title = 'CS:' + JSON.stringify(result) })`,
)

write(join(work, 'studio', 'index.html'), '<!doctype html><title>Studio</title>')
write(
  join(work, 'studio', 'preload.js'),
  `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridge', {
  browser: (command) => ipcRenderer.invoke('preview:browser', command),
  extensions: (command) => ipcRenderer.invoke('browser:extensions', command),
  settingsWritten: () => ipcRenderer.send('app:settings-write', '{}'),
})
`,
)
const browserModule = join(desktop, 'electron', 'browser.ts')
write(
  join(work, 'harness', 'main.ts'),
  `import assert from 'node:assert/strict'
import { app, BrowserWindow, dialog, session } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowser } from ${JSON.stringify(browserModule)}
import { registerBrowserWindows } from ${JSON.stringify(join(desktop, 'electron', 'browser-window.ts'))}
import { workspacePartition } from ${JSON.stringify(join(desktop, 'electron', 'browser-extensions.ts'))}

const work = process.env.SMOKE_DIR!
const run = process.env.SMOKE_RUN!
const settings = process.env.DOVO_SETTINGS_PATH!
app.setPath('userData', join(work, 'user-data'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const setBrowser = (enabled: boolean) =>
  writeFileSync(settings, JSON.stringify({ app: { browserWorkspaceEnabled: enabled, browserProfiles: [{id:"default",name:"Default"},{id:"work",name:"Work",language:"nl-NL"},{id:"personal",name:"Personal"}] } }))
const prompts: { message: string; detail?: string }[] = []
const loads: string[] = []
const report: Record<string, unknown> = { run }
const stage = (name: string) => { report.stage=name; writeFileSync(join(work,'progress-'+run+'.json'),JSON.stringify(report)) }
process.on('uncaughtException',(error)=>{report.error=error.stack??error.message;report.liveWindows=BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),url:w.webContents.getURL()}));writeFileSync(join(work,'result-'+run+'.json'),JSON.stringify(report));app.exit(1)})
const watchdog = setTimeout(()=>{report.error='Native browser smoke timed out at '+report.stage;writeFileSync(join(work,'result-'+run+'.json'),JSON.stringify(report));app.exit(1)},90_000)
watchdog.unref()
const server = createServer((request, response) => {
  if(request.url==='/profile-icon.svg') {
    response.setHeader('content-type','image/svg+xml')
    const color=request.headers.cookie?.includes('icon=work')?'red':'blue'
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="'+color+'"/></svg>')
    return
  }
  if(request.url==='/language') { response.end(request.headers['accept-language']||''); return }
  response.setHeader('content-type', 'text/html')
  response.end('<title>page</title><link rel="icon" href="/profile-icon.svg">hello')
}).listen(0, '127.0.0.1')

app.whenReady().then(async () => {
  try {
    setBrowser(true)
    // No person answers these during the smoke; everything else is production code.
    Object.assign(dialog, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [join(work, 'fixture')] }),
      showMessageBox: async (...args: unknown[]) => {
        const options = args.at(-1) as { message: string; detail?: string }
        prompts.push({ message: options.message, detail: options.detail })
        return { response: 0, checkboxChecked: false }
      },
    })
    const index = join(work, 'studio', 'index.html')
    const browserWindows = registerBrowserWindows(index, join(work, 'studio', 'preload.js'))
    const bridge = registerBrowser(index, undefined, undefined, browserWindows)
    const studio = new BrowserWindow({
      width: 1100,
      height: 760,
      webPreferences: {
        preload: join(work, 'studio', 'preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    })
    await studio.loadFile(index)
    const call = (kind: 'browser' | 'extensions', command: object) =>
      studio.webContents.executeJavaScript(
        \`window.bridge.\${kind}(\${JSON.stringify(command)})\`,
      ) as Promise<any>
    const port = (server.address() as { port: number }).port
    const page = \`http://127.0.0.1:\${port}/\`
    const bounds = { x: 0, y: 40, width: 1100, height: 720 }
    const show = (key: string, profileId: string, url = page) =>
      call('browser', { action: 'show', key, url, profileId, workspaceBrowser: true, bounds })
    const tab = 'studio:browser:tab-1'
    const work_ = session.fromPartition('persist:dovo-browser-workspace:work')
    work_.extensions.on('extension-loaded', (_event, extension) => loads.push(extension.name))
    const contentTitle = async () => {
      await call('browser', { action: 'reload', key: tab })
      for (let attempt = 0; attempt < 40; attempt++) {
        const status = await call('browser', { action: 'status', key: tab })
        if (status?.title?.startsWith('CS:')) return JSON.parse(status.title.slice(3))
        await wait(250)
      }
      throw new Error('The content script never reported back.')
    }

    if (run === '1') {
      stage('show work')
      await work_.cookies.set({url:page,name:'icon',value:'work'})
      await show(tab, 'work')
      const contents = () => studio.contentView.children.map((view: any) => view.webContents).find((contents: any) => contents?.getURL() === page)
      const main = contents()!
      stage('profile-scoped favicons')
      const readFavicon=async(key:string)=>{
        for(let attempt=0;attempt<60;attempt++) {
          const state=await call('browser',{action:'status',key,tabCount:2})
          if(typeof state?.favicon==='string')return state.favicon
          await wait(50)
        }
        throw new Error('The native favicon was not decoded.')
      }
      const workIcon=await readFavicon(tab)
      assert.ok(workIcon.startsWith('data:image/png;base64,'))
      await show('favicon-personal','personal')
      const personalIcon=await readFavicon('favicon-personal')
      assert.notEqual(workIcon,personalIcon,'Icons must use their own profile cookies.')
      await call('browser',{action:'close',key:'favicon-personal'})
      await show(tab,'work')
      await main.executeJavaScript(\`document.querySelector('link[rel="icon"]').href='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle r="16" cx="16" cy="16" fill="green"/></svg>')\`)
      let dynamicIcon=workIcon
      for(let attempt=0;attempt<60&&dynamicIcon===workIcon;attempt++) {
        dynamicIcon=await readFavicon(tab)
        if(dynamicIcon===workIcon)await wait(50)
      }
      assert.notEqual(dynamicIcon,workIcon,'Dynamic inline favicons must replace the previous icon.')
      report.favicons=true
      stage('language')
      assert.deepEqual(await main.executeJavaScript('({language:navigator.language,languages:navigator.languages})'), {language:'nl-NL',languages:['nl-NL','nl']})
      stage('language header')
      assert.match(await main.executeJavaScript("fetch('/language').then(response=>response.text())"), /^nl-NL,nl/)
      stage('site permission controls')
      const origin = new URL(page).origin
      const readSite = () => call('browser', {action:'site-permissions', key:tab})
      assert.equal((await readSite()).sitePermissions.permissions.notifications, 'ask')
      const requestNotification = async (decision: 'allow' | 'deny') => {
        const asked = call('browser', {action:'request-site-permission', key:tab, origin, permission:'notifications'})
        let request: any
        for(let attempt=0;attempt<40&&!request;attempt++) {
          request = (await call('browser',{action:'media-status',key:tab}))?.mediaRequests?.find((item:any)=>item.kind==='notifications')
          if (!request) await wait(50)
        }
        assert.ok(request, 'Website controls must create a real notification permission request.')
        await call('browser',{action:'media',key:tab,requestId:request.id,decision})
        await asked
      }
      await requestNotification('allow')
      assert.equal((await readSite()).sitePermissions.permissions.notifications, 'allow')
      await requestNotification('deny')
      assert.equal((await readSite()).sitePermissions.permissions.notifications, 'block')
      report.sitePermissionControls = true
      stage('move page between windows')
      const marker = await main.executeJavaScript('window.moveMarker = Math.random()')
      const moving = {id:'native-moving',title:'Moving page',url:page,kind:'web',profileId:'work',pinned:true}
      await call('browser', {action:'move-tab',key:tab,tab:moving})
      const destination = browserWindows.list()[0]!
      assert.ok(destination, 'Moving to a new window must create a browser window.')
      const destinationCall = (command: object) => destination.webContents.executeJavaScript(\`window.bridge.browser(\${JSON.stringify(command)})\`)
      const moved = await destinationCall({action:'status',key:'blank',tabCount:0})
      assert.equal(moved.movedTabs[0].tab.pinned, true)
      await destinationCall({action:'show',key:tab,url:page,profileId:'work',workspaceBrowser:true,bounds})
      assert.ok(destination.contentView.children.some((view:any)=>view.webContents===main), 'Move must reparent the existing native view.')
      assert.equal(await main.executeJavaScript('window.moveMarker'), marker, 'Moving must retain live page state.')
      await destinationCall({action:'move-tab',key:tab,tab:moving,targetWindowId:studio.id})
      await call('browser', {action:'status',key:tab})
      await show(tab, 'work')
      destination.destroy()
      assert.equal(await main.executeJavaScript('window.moveMarker'), marker, 'Closing the former window must not close the moved page.')
      report.windowMoves = true
      stage('open blank')
      await main.executeJavaScript(\`window.child = window.open('', 'new'); setTimeout(() => child.location.href = '\${page}?child=1', 50)\`)
      let createdChild: any
      for (let i=0;i<60&&!createdChild;i++) { createdChild = (await call('browser',{action:'status',key:tab}))?.createdTabs?.[0]; if(!createdChild) await wait(50) }
      assert.ok(createdChild, 'Deferred named window must become a native tab.')
      assert.equal(createdChild.openerKey, tab, 'Preview records its native opener.')
      stage('show child')
      await show(createdChild.key, 'work', page+'?child=1')
      const child = studio.contentView.children.map((view: any) => view.webContents).find((contents: any) => contents?.getURL() === page+'?child=1')!
      stage('opener')
      await child.executeJavaScript('window.opener.document.title = "opener retained"')
      assert.equal(main.getTitle(), 'opener retained')
      stage('named reuse')
      await main.executeJavaScript(\`window.reused = window.open('\${page}?child=2', 'new'); window.sameChild = reused === child\`)
      assert.equal(await main.executeJavaScript('window.sameChild'), true, 'Named target must reuse its original page.')
      assert.equal((await call('browser',{action:'status',key:tab}))?.createdTabs, undefined)
      stage('close child')
      await new Promise<void>((resolve)=> { if(child.isLoading()) child.once('did-stop-loading',()=>resolve()); else resolve() })
      report.childId=child.id; report.mainId=main.id;report.studioId=studio.webContents.id
      stage('close child javascript')
      await main.executeJavaScript('window.child.close(); true')
      stage('close child status')
      let childClosed=false
      for(let i=0;i<60&&!childClosed;i++) { childClosed=!!(await call('browser',{action:'status',key:tab}))?.closedTabs?.includes(createdChild.key); if(!childClosed) await wait(50) }
      assert.ok(childClosed, 'window.close must release a page-created tab')
      stage('command-click preview')
      await show(tab, 'work')
      const linkPoint = await main.executeJavaScript(\`(() => {
        const link = document.createElement('a'); link.href = '\${page}?command-click=1';
        link.textContent = 'Quick navigation'; link.style.cssText = 'position:fixed;left:20px;top:20px;padding:20px;background:white;z-index:9999';
        document.body.append(link); const rect = link.getBoundingClientRect();
        return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}
      })()\`)
      const linkModifiers = [process.platform === 'darwin' ? 'meta' : 'control']
      main.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,modifiers:linkModifiers,...linkPoint})
      main.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,modifiers:linkModifiers,...linkPoint})
      let linkChild: any
      for(let i=0;i<60&&!linkChild;i++) { linkChild=(await call('browser',{action:'status',key:tab}))?.createdTabs?.[0]; if(!linkChild) await wait(50) }
      assert.ok(linkChild, 'Command/control-click creates a page for the preview.')
      assert.equal(linkChild.openerKey, tab)
      assert.equal(linkChild.profileId, 'work')
      await call('browser',{action:'close',key:linkChild.key})
      const privateId = 'private-00000000-0000-4000-8000-000000000001'
      assert.ok(!workspacePartition(privateId).startsWith('persist:'))
      stage('private profile')
      await show('private-proof', privateId)
      const privateSession = session.fromPartition(workspacePartition(privateId))
      assert.equal(privateSession.isPersistent(), false)
      await privateSession.cookies.set({url:page,name:'private',value:'temporary'})
      assert.equal((await work_.cookies.get({name:'private'})).length,0)
      await call('browser',{action:'close',key:'private-proof'})
      for(let i=0;i<60&&(await privateSession.cookies.get({name:'private'})).length;i++) await wait(50)
      assert.equal((await privateSession.cookies.get({name:'private'})).length,0,'Closing the last private tab must clear website data.')
      stage('show work')
      await show(tab, 'work')
      stage('install extension')
      const installed = await call('extensions', { action: 'install', profileId: 'work' })
      const [extension] = installed.extensions
      assert.equal(installed.installed, extension.id)
      assert.equal(extension.loaded, true)
      assert.deepEqual(extension.removedPermissions, [])
      assert.deepEqual(installed.capabilities, {
        unpackedFolders: true,
        nativeMessaging: true,
        chromeWebStore: true,
        remoteRuntimes: false,
      })
      assert.match(prompts[0]!.message, /^Add “Dovo native smoke” to this browser profile\\?$/)
      assert.match(prompts[0]!.detail!, /Desktop app access/)
      assert.ok(
        readFileSync(join(work, 'fixture', 'manifest.json'), 'utf8').includes('nativeMessaging'),
        'The chosen folder must stay unchanged.',
      )
      stage('content script')
      const content = await contentTitle()
      assert.equal(content.activeTab, page)
      assert.equal(typeof content.window, 'number')
      assert.equal(content.badge, 'ok')
      report.contentRuns = content.runs
      if (process.env.SMOKE_WEBSITES === '1') {
        await show('teams-proof','teams-proof','https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=5e3ce6c0-2b1f-4285-8d4b-75ee78787346&scope=openid%20profile%20offline_access&redirect_uri=https%3A%2F%2Fteams.microsoft.com%2Fv2%2Fauthv2&response_type=code&response_mode=fragment&code_challenge=SdIrOLcdSCEDAnJHmbRAR-UBd62i4fJ8CSVKngOlGF4&code_challenge_method=S256')
        let status
        for(let i=0;i<100;i++) {
          status=await call('browser',{action:'status',key:'teams-proof'})
          if(status?.url?.startsWith('https://login.microsoftonline.com/')) break
          await wait(300)
        }
        assert.ok(status?.url?.startsWith('https://login.microsoftonline.com/'), 'Teams must reach Microsoft sign-in; got '+status?.url)
        const login = studio.contentView.children.map((view: any) => view.webContents).find((contents: any) => contents?.getURL().startsWith('https://login.microsoftonline.com/'))
        assert.ok(login, 'The native sign-in view must exist.')
        let rect
        for (let attempt=0; attempt<100; attempt++) {
          rect = await login.executeJavaScript(\`(() => { const input=document.querySelector('input[type=email]'); if(!input || !input.checkVisibility() || input.disabled)return null; const box=input.getBoundingClientRect(); if(!box.width || !box.height)return null; return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)} })()\`)
          if (rect) break
          await wait(100)
        }
        assert.ok(rect, 'Microsoft sign-in must show its email input.')
        if (process.platform === 'linux' && process.env.SMOKE_NATIVE_INPUT === '1') {
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const inputCommand = promisify(execFile)
          studio.show(); studio.focus(); studio.webContents.focus()
          const nativeView = studio.contentView.children.find((view: any) => view.webContents === login)
          const content = studio.getContentBounds(), bounds = nativeView.getBounds()
          await inputCommand('xdotool', ['mousemove','--sync',String(content.x+bounds.x+rect.x),String(content.y+bounds.y+rect.y),'click','1'])
          await inputCommand('xdotool', ['type','--clearmodifiers','a'])
        } else {
        studio.show(); app.focus({steal:true}); studio.focus(); studio.webContents.focus()
        await wait(250)
        // Send genuine Chromium pointer/key events; do not fill or focus using page JavaScript.
        login.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect})
        login.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect})
        login.sendInputEvent({type:'keyDown',keyCode:'a'})
        login.sendInputEvent({type:'char',keyCode:'a'})
        login.sendInputEvent({type:'keyUp',keyCode:'a'})
        }
        await wait(200)
        report.teamsInput = { rect, windowFocus: studio.isFocused(), focus: login.isFocused(), active: await login.executeJavaScript(\`document.activeElement?.outerHTML\`) }
        writeFileSync(join(work,'result-'+run+'.json'),JSON.stringify(report,null,2))
        assert.ok(studio.isFocused(), 'Native input requires an active desktop window.')
        assert.equal(await login.executeJavaScript(\`document.querySelector('input[type=email]').value\`), 'a', 'Mouse and keyboard must enter text on Microsoft sign-in.')
        report.teamsSignIn=true
      }
      if (process.env.SMOKE_STORE === '1') {
        const added=await call('extensions',{action:'installStore',profileId:'store-proof',url:'https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh'})
        assert.equal(added.installed,'eimadpbcbfnmbkopoojfekhnkhdbieeh')
        assert.ok(added.extensions[0].loaded)
        await call('extensions',{action:'remove',profileId:'store-proof',id:added.installed})
        report.chromeWebStore=true
      }

      if (process.platform !== 'win32') {
        const hostDirectory = join(app.getPath('userData'), 'NativeMessagingHosts')
        mkdirSync(hostDirectory, {recursive:true})
        writeFileSync(join(hostDirectory,'com.dovo.smoke.json'), JSON.stringify({name:'com.dovo.smoke',type:'stdio',path:join(work,'native-echo.py'),allowed_origins:[\`chrome-extension://\${extension.id}/\`]}))
      }
      const screenshot = await call('browser',{action:'screenshot',key:tab})
      assert.ok(screenshot?.image?.startsWith('data:image/png;base64,'))
      const before = new Set(BrowserWindow.getAllWindows())
      await call('extensions', {
        action: 'open',
        profileId: 'work',
        id: extension.id,
        key: tab,
        anchor: { x: 1000, y: 0, width: 32, height: 32 },
      })
      let popup: Record<string, unknown> | undefined
      for (let attempt = 0; attempt < 40 && !popup; attempt++) {
        await wait(250)
        const title = BrowserWindow.getAllWindows()
          .find((window) => !before.has(window))
          ?.webContents.getTitle()
        if (title?.startsWith('POPUP:')) popup = JSON.parse(title.slice(6))
      }
      assert.ok(popup, 'The action popup never reported back.')
      assert.equal(popup.tabCreated, true)
      assert.equal(popup.bookmarks, true)
      assert.equal(popup.undeclaredSite, false)
      // The library refuses it as undeclared (no grant, no prompt); how it reports that varies.
      assert.equal(popup.nativeMessaging, true)
      if (process.platform !== 'win32') assert.deepEqual(popup.nativeEcho,{echo:{text:'Dovo naïve 🔑'}})
      const permissionPrompts = prompts.filter((p) => p.message.includes('more access in browser profile'))
      assert.deepEqual(
        permissionPrompts.map((p) => p.message),
        ['Allow “Dovo native smoke” more access in browser profile “Work”?', 'Allow “Dovo native smoke” more access in browser profile “Work”?'],
      )

      const helperPrompts = prompts.filter((prompt) => prompt.detail?.includes('Desktop helper:'))
      if (process.platform !== 'win32') assert.equal(helperPrompts.length, 1)
      const popupWindow = BrowserWindow.getAllWindows().find((window) => !before.has(window))!
      popupWindow.emit('blur')
      assert.equal(popupWindow.isDestroyed(), true, 'Popup must dismiss when focus moves outside Studio.')
      const status = await call('browser', { action: 'status', key: tab })
      const created = status?.createdTabs?.[0]
      assert.ok(created, 'The extension-created tab was not reported.')
      assert.equal(created.profileId, 'work')
      assert.equal(created.url, \`chrome-extension://\${extension.id}/page.html\`)
      await show(created.key, 'work', created.url)
      const adopted = await call('browser', { action: 'status', key: created.key })
      assert.equal(adopted.url, created.url)
      assert.equal(adopted.title, 'extension page')

      await show('studio:browser:tab-personal', 'personal')
      const personal = await call('extensions', { action: 'list', profileId: 'personal' })
      assert.deepEqual(personal.extensions, [])
      const personalSession = session.fromPartition('persist:dovo-browser-workspace:personal')
      assert.equal(personalSession.extensions.getAllExtensions().length, 0)
      const preview = session.fromPartition('persist:dovo-preview:work')
      assert.equal(preview.extensions.getAllExtensions().length, 0)

      stage('show work')
      await show(tab, 'work')
      await contentTitle()
      assert.ok(Object.keys(work_.serviceWorkers.getAllRunning()).length > 0)
      setBrowser(false)
      await studio.webContents.executeJavaScript('window.bridge.settingsWritten()')
      await wait(2000)
      assert.equal(work_.extensions.getAllExtensions().length, 0)
      assert.equal(Object.keys(work_.serviceWorkers.getAllRunning()).length, 0)
      assert.equal(await call('browser', { action: 'status', key: tab }), undefined)
      setBrowser(true)
      await studio.webContents.executeJavaScript('window.bridge.settingsWritten()')
      await wait(1000)
      const restored = await call('extensions', { action: 'list', profileId: 'work' })
      assert.equal(restored.extensions[0].loaded, true)
      report.extension = extension.id
    } else {
      stage('show work')
      await show(tab, 'work')
      const listed = await call('extensions', { action: 'list', profileId: 'work' })
      assert.equal(listed.extensions.length, 1)
      assert.equal(listed.extensions[0].loaded, true)
      assert.deepEqual(loads, ['Dovo native smoke'])
      stage('content script')
      const content = await contentTitle()
      assert.ok(content.runs > 2, 'chrome.storage.local did not persist across restarts.')
      const beforePopup = new Set(BrowserWindow.getAllWindows())
      await call('extensions', {action:'open',profileId:'work',id:listed.extensions[0].id,key:tab,anchor:{x:1000,y:0,width:32,height:32}})
      let reconnect: any
      for(let i=0;i<60&&!reconnect;i++) {
        const title=BrowserWindow.getAllWindows().find((window)=>!beforePopup.has(window))?.webContents.getTitle()
        if(title?.startsWith('POPUP:')) reconnect=JSON.parse(title.slice(6))
        else await wait(100)
      }
      assert.ok(reconnect, 'Restarted extension must connect to its desktop helper.')
      if(process.platform!=='win32') assert.deepEqual(reconnect.nativeEcho,{echo:{text:'Dovo naïve 🔑'}})
      assert.equal(prompts.filter((prompt)=>prompt.detail?.includes('Desktop helper:')).length,0,'Helper approval must survive restart for this profile.')
      const removed = await call('extensions', {
        action: 'remove',
        profileId: 'work',
        id: listed.extensions[0].id,
      })
      assert.deepEqual(removed.extensions, [])
      assert.equal(work_.extensions.getAllExtensions().length, 0)
      const copies = readdirSync(
        join(work, 'user-data', 'browser-extensions', 'profiles', 'work', 'installed'),
      )
      assert.deepEqual(copies, [])
      report.contentRuns = content.runs
      if (process.env.SMOKE_WEBSITES === '1') {
        await show('teams-proof','teams-proof','https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=5e3ce6c0-2b1f-4285-8d4b-75ee78787346&scope=openid%20profile%20offline_access&redirect_uri=https%3A%2F%2Fteams.microsoft.com%2Fv2%2Fauthv2&response_type=code&response_mode=fragment&code_challenge=SdIrOLcdSCEDAnJHmbRAR-UBd62i4fJ8CSVKngOlGF4&code_challenge_method=S256')
        let status
        for(let i=0;i<100;i++) {
          status=await call('browser',{action:'status',key:'teams-proof'})
          if(status?.url?.startsWith('https://login.microsoftonline.com/')) break
          await wait(300)
        }
        assert.ok(status?.url?.startsWith('https://login.microsoftonline.com/'), 'Teams must reach Microsoft sign-in; got '+status?.url)
        const login = studio.contentView.children.map((view: any) => view.webContents).find((contents: any) => contents?.getURL().startsWith('https://login.microsoftonline.com/'))
        assert.ok(login, 'The native sign-in view must exist.')
        let rect
        for (let attempt=0; attempt<100; attempt++) {
          rect = await login.executeJavaScript(\`(() => { const input=document.querySelector('input[type=email]'); if(!input || !input.checkVisibility() || input.disabled)return null; const box=input.getBoundingClientRect(); if(!box.width || !box.height)return null; return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)} })()\`)
          if (rect) break
          await wait(100)
        }
        assert.ok(rect, 'Microsoft sign-in must show its email input.')
        if (process.platform === 'linux' && process.env.SMOKE_NATIVE_INPUT === '1') {
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const inputCommand = promisify(execFile)
          studio.show(); studio.focus(); studio.webContents.focus()
          const nativeView = studio.contentView.children.find((view: any) => view.webContents === login)
          const content = studio.getContentBounds(), bounds = nativeView.getBounds()
          await inputCommand('xdotool', ['mousemove','--sync',String(content.x+bounds.x+rect.x),String(content.y+bounds.y+rect.y),'click','1'])
          await inputCommand('xdotool', ['type','--clearmodifiers','a'])
        } else {
        studio.show(); app.focus({steal:true}); studio.focus(); studio.webContents.focus()
        await wait(250)
        // Send genuine Chromium pointer/key events; do not fill or focus using page JavaScript.
        login.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect})
        login.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect})
        login.sendInputEvent({type:'keyDown',keyCode:'a'})
        login.sendInputEvent({type:'char',keyCode:'a'})
        login.sendInputEvent({type:'keyUp',keyCode:'a'})
        }
        await wait(200)
        report.teamsInput = { rect, windowFocus: studio.isFocused(), focus: login.isFocused(), active: await login.executeJavaScript(\`document.activeElement?.outerHTML\`) }
        writeFileSync(join(work,'result-'+run+'.json'),JSON.stringify(report,null,2))
        assert.ok(studio.isFocused(), 'Native input requires an active desktop window.')
        assert.equal(await login.executeJavaScript(\`document.querySelector('input[type=email]').value\`), 'a', 'Mouse and keyboard must enter text on Microsoft sign-in.')
        report.teamsSignIn=true
      }
      if (process.env.SMOKE_STORE === '1') {
        const added=await call('extensions',{action:'installStore',profileId:'store-proof',url:'https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh'})
        assert.equal(added.installed,'eimadpbcbfnmbkopoojfekhnkhdbieeh')
        assert.ok(added.extensions[0].loaded)
        await call('extensions',{action:'remove',profileId:'store-proof',id:added.installed})
        report.chromeWebStore=true
      }
    }
    report.ok = true
    await bridge.dispose()
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  writeFileSync(join(work, \`result-\${run}.json\`), JSON.stringify(report, null, 2))
  app.exit(report.ok ? 0 : 1)
})
`,
)

const { build } = await import(require.resolve('vite'))
await build({
  configFile: false,
  root: desktop,
  logLevel: 'warn',
  build: {
    ssr: join(work, 'harness', 'main.ts'),
    outDir: join(work, 'out'),
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron', '@dovo/runtime/browser-favicon'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})

const electron = require('electron')
const display = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
let failed = false
for (const run of ['1', '2']) {
  const args = [electron, '--disable-gpu', join(work, 'out', 'main.cjs')]
  const child = spawnSync(
    display ? 'xvfb-run' : args[0],
    display ? ['-a', ...args] : args.slice(1),
    {
      env: {
        ...process.env,
        SMOKE_DIR: work,
        SMOKE_RUN: run,
        SMOKE_WEBSITES: websites ? '1' : '0',
        SMOKE_STORE: store ? '1' : '0',
        DOVO_SETTINGS_PATH: join(work, 'settings.json'),
        VITE_DEV_SERVER_URL: '',
        ELECTRON_ENABLE_LOGGING: '',
      },
      encoding: 'utf8',
      timeout: 120_000,
    },
  )
  let result
  try {
    result = JSON.parse(readFileSync(join(work, `result-${run}.json`), 'utf8'))
  } catch {
    result = {
      error: child.error?.message ?? 'No result was written.',
      output: child.stderr?.slice(-4000),
    }
  }
  console.log(`run ${run}: ${result.ok ? 'passed' : 'FAILED'}`)
  if (!result.ok) {
    console.error(result.error)
    if (child.stderr) console.error(child.stderr.slice(-6000))
    if (result.output) console.error(result.output)
    failed = true
    break
  }
}
if (keep || failed) console.log(`Smoke files kept in ${work}`)
else rmSync(work, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
