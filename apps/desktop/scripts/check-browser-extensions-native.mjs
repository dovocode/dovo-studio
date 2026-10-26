#!/usr/bin/env node
/**
 * Real Electron smoke for shared-browser Chrome extensions.
 *
 * Builds a harness around the production `registerBrowser` and drives it through the same IPC a
 * trusted Studio window uses (`preview:browser`, `browser:extensions`, `app:settings-write`).
 * Only Electron's folder picker and message boxes are scripted, because no person answers them.
 *
 * Covers a small MV3 fixture, not arbitrary extensions: review before load, nativeMessaging
 * removal, content script and popup messaging, tabs/windows/storage/action APIs, extension tab
 * adoption, runtime permission prompts, profile isolation, opt-out stopping workers, restart
 * persistence and removal. Run after upgrading electron-chrome-extensions or Electron.
 *
 * Usage: node apps/desktop/scripts/check-browser-extensions-native.mjs [--keep]
 * Linux without a display needs `xvfb-run`. The Chromium sandbox must be available.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const write = (path, contents) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
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
write(join(fixture, 'popup.html'), '<!doctype html><p>smoke</p><script src="popup.js"></script>')
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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowser } from ${JSON.stringify(browserModule)}

const work = process.env.SMOKE_DIR!
const run = process.env.SMOKE_RUN!
const settings = process.env.DOVO_SETTINGS_PATH!
app.setPath('userData', join(work, 'user-data'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const setBrowser = (enabled: boolean) =>
  writeFileSync(settings, JSON.stringify({ app: { browserWorkspaceEnabled: enabled } }))
const prompts: { message: string; detail?: string }[] = []
const loads: string[] = []
const report: Record<string, unknown> = { run }
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<title>page</title>hello')
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
    const bridge = registerBrowser(index)
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
      await show(tab, 'work')
      const installed = await call('extensions', { action: 'install', profileId: 'work' })
      const [extension] = installed.extensions
      assert.equal(installed.installed, extension.id)
      assert.equal(extension.loaded, true)
      assert.deepEqual(extension.removedPermissions, ['nativeMessaging'])
      assert.deepEqual(installed.capabilities, {
        unpackedFolders: true,
        nativeMessaging: false,
        chromeWebStore: true,
        remoteRuntimes: false,
      })
      assert.match(prompts[0]!.message, /^Add “Dovo native smoke” to this browser profile\\?$/)
      assert.match(prompts[0]!.detail!, /Removed by Dovo: nativeMessaging/)
      assert.ok(
        readFileSync(join(work, 'fixture', 'manifest.json'), 'utf8').includes('nativeMessaging'),
        'The chosen folder must stay unchanged.',
      )
      const content = await contentTitle()
      assert.equal(content.activeTab, page)
      assert.equal(typeof content.window, 'number')
      assert.equal(content.badge, 'ok')
      report.contentRuns = content.runs
      if (process.env.SMOKE_WEBSITES === '1') {
        await show('teams-proof','teams-proof','https://teams.microsoft.com')
        let status
        for(let i=0;i<100;i++) {
          status=await call('browser',{action:'status',key:'teams-proof'})
          if(status?.url?.startsWith('https://login.microsoftonline.com/')) break
          await wait(300)
        }
        assert.ok(status?.url?.startsWith('https://login.microsoftonline.com/'), 'Teams must reach Microsoft sign-in; got '+status?.url)
        report.teamsSignIn=true
      }
      if (process.env.SMOKE_STORE === '1') {
        const added=await call('extensions',{action:'installStore',profileId:'store-proof',url:'https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh'})
        assert.equal(added.installed,'eimadpbcbfnmbkopoojfekhnkhdbieeh')
        assert.ok(added.extensions[0].loaded)
        await call('extensions',{action:'remove',profileId:'store-proof',id:added.installed})
        report.chromeWebStore=true
      }

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
      assert.notEqual(popup.nativeMessaging, true)
      const permissionPrompts = prompts.filter((p) => p.message.startsWith('Allow '))
      assert.deepEqual(
        permissionPrompts.map((p) => p.message),
        ['Allow “Dovo native smoke” more access in browser profile “work”?'],
      )

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
      await show(tab, 'work')
      const listed = await call('extensions', { action: 'list', profileId: 'work' })
      assert.equal(listed.extensions.length, 1)
      assert.equal(listed.extensions[0].loaded, true)
      assert.deepEqual(loads, ['Dovo native smoke'])
      const content = await contentTitle()
      assert.ok(content.runs > 2, 'chrome.storage.local did not persist across restarts.')
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
        await show('teams-proof','teams-proof','https://teams.microsoft.com')
        let status
        for(let i=0;i<100;i++) {
          status=await call('browser',{action:'status',key:'teams-proof'})
          if(status?.url?.startsWith('https://login.microsoftonline.com/')) break
          await wait(300)
        }
        assert.ok(status?.url?.startsWith('https://login.microsoftonline.com/'), 'Teams must reach Microsoft sign-in; got '+status?.url)
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
      external: ['electron'],
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
    if (result.output) console.error(result.output)
    failed = true
    break
  }
}
if (keep || failed) console.log(`Smoke files kept in ${work}`)
else rmSync(work, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
