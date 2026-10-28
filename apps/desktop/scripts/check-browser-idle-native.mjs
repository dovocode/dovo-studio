#!/usr/bin/env node
// Real Chromium IdleDetector requests and start checks through Studio's production handlers.
// Only native dialog answers are supplied by the harness; Studio uses real IdleDetector APIs.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const work = mkdtempSync(join(tmpdir(), 'dovo-browser-idle-native-'))
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')
writeFileSync(
  join(work, 'main.ts'),
  `import assert from 'node:assert/strict'
import { app, BrowserWindow, dialog } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createBrowserMedia, type MediaTab } from ${JSON.stringify(join(desktop, 'electron/browser-media.ts'))}
import { browserPermissions } from ${JSON.stringify(join(desktop, 'electron/browser-permissions.ts'))}

app.setPath('userData', ${JSON.stringify(join(work, 'user-data'))})
const server = createServer((request, response) => {
  if (request.url === '/policy-blocked') response.setHeader('Permissions-Policy', 'idle-detection=()')
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>Device presence permission test</title><p>Idle Detection</p>')
})
let answer = 0
let prompts = 0
Object.assign(dialog, { showMessageBox: async () => {
  prompts++
  return { response: answer, checkboxChecked: false }
} })

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
    const start = '(' + (async () => {
      const controller = new AbortController()
      try {
        const detector = new IdleDetector()
        await detector.start({ threshold: 60000, signal: controller.signal })
        const state = { user: detector.userState, screen: detector.screenState }
        controller.abort()
        return state
      } catch (error) { return { error: error.name } }
    }).toString() + ')()'
    const started = (state: unknown) => {
      assert(state && typeof state === 'object')
      assert('user' in state && ['active', 'idle'].includes(String(state.user)))
      assert('screen' in state && ['locked', 'unlocked'].includes(String(state.screen)))
    }
    assert.equal(await run('typeof IdleDetector'), 'function')
    assert.equal(await run(\`(async () => {
      window.permission = await navigator.permissions.query({name:'idle-detection'})
      window.changes = []
      permission.onchange = () => changes.push(permission.state)
      return permission instanceof PermissionStatus && permission.state
    })()\`), 'prompt', 'Ask must not be reported as blocked to Teams')
    assert.equal(browserPermissions('work').site(origin).permissions['idle-detection'], 'ask')
    assert.deepEqual(await run(start), { error: 'NotAllowedError' })
    assert.equal(await run('IdleDetector.requestPermission()'), 'granted')
    started(await run(start))
    assert.equal(await run('permission.state'), 'granted')
    assert.deepEqual(await run('changes'), ['granted'])
    assert.equal(browserPermissions('work').site(origin).permissions['idle-detection'], 'ask')
    assert.equal(await run('IdleDetector.requestPermission()'), 'granted')
    assert.equal(prompts, 1)

    const sibling = await page('work')
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status => {window.permission=status; window.changed=new Promise(resolve => status.addEventListener("change", () => resolve(status.state), {once:true})); return status.state})', sibling), 'prompt', 'Allow once belongs only to its document')

    // Even a same-origin navigation replaces an allow-once document grant.
    await workPage.loadURL(origin + '/next')
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)'), 'prompt')
    assert.deepEqual(await run(start), { error: 'NotAllowedError' })
    answer = 1
    assert.equal(await run('IdleDetector.requestPermission()'), 'granted')
    assert.equal(prompts, 2)
    assert.equal(await run('changed', sibling), 'granted', 'Saved approval updates other tabs in that profile')
    assert.equal(browserPermissions('work').site(origin).permissions['idle-detection'], 'allow')
    await workPage.loadURL(origin + '/reloaded')
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)'), 'granted')
    started(await run(start))
    assert.equal(prompts, 2)

    // A second profile must ask independently and its Block cannot affect work.
    const personal = await page('personal')
    assert.deepEqual(await run(start, personal), { error: 'NotAllowedError' })
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)', personal), 'prompt')
    answer = 2
    assert.equal(await run('IdleDetector.requestPermission()', personal), 'denied')
    assert.deepEqual(await run(start, personal), { error: 'NotAllowedError' })
    assert.equal(browserPermissions('personal').site(origin).permissions['idle-detection'], 'block')
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)', personal), 'denied')
    started(await run(start))

    await run('navigator.permissions.query({name:"idle-detection"}).then(status => {window.permission = status; window.changes = []; status.addEventListener("change", () => changes.push(status.state)); window.changed = new Promise(resolve => status.addEventListener("change", () => resolve(status.state), {once:true}))})')
    browserPermissions('work').setSite(origin, 'idle-detection', 'ask')
    media.revokeSite('work', origin)
    assert.equal(await run('changed'), 'prompt')
    assert.deepEqual(await run(start), { error: 'NotAllowedError' })
    answer = 0
    assert.equal(await run('IdleDetector.requestPermission()'), 'granted')
    started(await run(start))
    assert.deepEqual(await run('changes'), ['prompt', 'granted'])
    await run('window.changed = new Promise(resolve => permission.addEventListener("change", () => resolve(permission.state), {once:true})); undefined')
    media.revokeSite('work', origin)
    assert.equal(await run('changed'), 'prompt')
    assert.deepEqual(await run(start), { error: 'NotAllowedError' })
    await workPage.loadURL(origin + '/policy-blocked')
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)'), 'denied', 'Permissions Policy still blocks access')
    // Preloads also run in non-tab OAuth popups; native denial remains intact there.
    const unmanaged = new BrowserWindow({webPreferences:{partition:'work',sandbox:true,contextIsolation:true}})
    await unmanaged.loadURL(origin)
    assert.equal(await run('navigator.permissions.query({name:"idle-detection"}).then(status=>status.state)', unmanaged), 'denied')
    assert.equal(await run('IdleDetector.requestPermission()', unmanaged), 'denied')
    unmanaged.destroy()
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
const child = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 })
let result
try {
  result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'))
} catch {
  result = { ok: false, error: child.error?.message ?? 'No native result was written.' }
}
if (!result.ok) {
  console.error(result, child.stderr?.slice(-3000), child.stdout?.slice(-3000))
  console.error('Smoke files kept in ' + work)
} else {
  console.log(
    'Idle Detection native smoke passed: allow once, navigation, persistence, profiles and revocation.',
  )
  rmSync(work, { recursive: true, force: true })
}
process.exit(result.ok ? 0 : 1)
