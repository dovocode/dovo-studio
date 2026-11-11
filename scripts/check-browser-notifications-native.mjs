/**
 * Linux integration check using real Electron and an isolated notification daemon.
 * Requires a display, dbus-run-session and system Python with dbus + PyGObject.
 * No notifications reach the user's desktop daemon. Only this test disables the sandbox.
 * Run: pnpm exec playwright install chromium
 *      node scripts/check-browser-notifications-native.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
assert.equal(process.platform, 'linux', 'This native notification fixture requires Linux')
if (!process.env.DOVO_NOTIFICATION_TEST_BUS) {
  const child = spawnSync(
    'dbus-run-session',
    ['--', process.execPath, fileURLToPath(import.meta.url)],
    {
      stdio: 'inherit',
      env: { ...process.env, DOVO_NOTIFICATION_TEST_BUS: '1' },
    },
  )
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(root + '/package.json')
const { _electron: electron } = require('playwright')
const { build } = require('esbuild')
const requireDesktop = createRequire(root + '/apps/desktop/package.json')
const eventually = async (read, expected) => {
  for (let n = 0; n < 100; n++) {
    if ((await read()) === expected) return
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.equal(await read(), expected)
}
const dir = await mkdtemp(join(tmpdir(), 'dovo-notify-native-'))
const daemon = spawn(
  '/usr/bin/python3',
  [fileURLToPath(new URL('./fixtures/notification-daemon.py', import.meta.url))],
  { stdio: ['ignore', 'pipe', 'inherit'] },
)
const received = []
let buffer = ''
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end('<title>Notification test</title>')
})
let app
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('The test notification daemon did not start')),
      5000,
    )
    daemon.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error('Notification daemon exited: ' + code))
    })
    daemon.stdout.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const i = buffer.indexOf('\n')
        if (i < 0) break
        const line = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        if (line === 'READY') {
          clearTimeout(timeout)
          resolve()
        } else {
          received.push(JSON.parse(line))
        }
      }
    })
    daemon.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root + '/apps/desktop',
      contents: `
import {app,BrowserWindow} from 'electron';
import {createBrowserMedia} from './electron/browser-media';
app.setPath('userData',${JSON.stringify(dir)});
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 globalThis.notificationWindow=w;globalThis.inView=true;globalThis.clicked=0;
 const tab={key:'source',profileId:'work',windowId:w.id,contents:w.webContents};
 const media=createBrowserMedia({tabFor:c=>c.id===w.webContents.id?tab:undefined,tabs:()=>[tab],canFullscreen:()=>false,prepareFullscreen:()=>{},notificationInView:()=>globalThis.inView});
 globalThis.media=media;
 media.attachSession(w.webContents.session,'work');media.attachTab(w.webContents);
 w.webContents.ipc.on('browser:notification-click',event=>{if(event.senderFrame===w.webContents.mainFrame)globalThis.clicked++});
 await w.loadURL(${JSON.stringify(origin)});
});`,
    },
    outfile: join(dir, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    conditions: ['development'],
  })
  app = await electron.launch({
    executablePath: requireDesktop('electron'),
    args: ['--no-sandbox', join(dir, 'main.cjs')],
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  await page.waitForLoadState()
  await page.evaluate(() => {
    window.permissionPromise = Notification.requestPermission()
    void window.permissionPromise.then((state) => {
      window.permissionResult = state
    })
  })
  await eventually(
    () =>
      app.evaluate(
        () => globalThis.media.snapshot(globalThis.notificationWindow.id).mediaRequests?.length,
      ),
    1,
  )
  await app.evaluate(async () => {
    const w = globalThis.notificationWindow
    const [r] = globalThis.media.snapshot(w.id).mediaRequests
    await globalThis.media.decide(w.id, { key: 'source', requestId: r.id, decision: 'allow' })
  })
  await page.waitForFunction(() => window.permissionResult === 'granted')
  assert.equal(await page.evaluate(() => Notification.permission), 'granted')
  const notify = async (title) =>
    page.evaluate(
      (title) =>
        new Promise((resolve) => {
          const n = new Notification(title, { body: 'native fixture' })
          window.notifications ??= []
          window.notifications.push(n)
          n.onclick = (event) => {
            window.siteClickTrusted = event.isTrusted
          }
          n.onshow = () => resolve('show')
          n.onerror = () => resolve('error')
          setTimeout(() => resolve('suppressed'), 500)
        }),
      title,
    )
  assert.equal(await notify('visible suppressed'), 'suppressed')
  assert.equal(received.filter((e) => e.type === 'notify').length, 0)
  assert.deepEqual(
    await page.evaluate(async () => {
      let callbackState
      const state = await Notification.requestPermission((value) => {
        callbackState = value
      })
      return { state, callbackState }
    }),
    { state: 'granted', callbackState: 'granted' },
  )
  assert.equal(await page.evaluate(() => Notification.permission), 'granted')
  await app.evaluate(() => {
    globalThis.inView = false
  })
  assert.equal(await notify('background delivered'), 'show')
  await eventually(() => received.filter((e) => e.type === 'notify').length, 1)
  execFileSync('dbus-send', [
    '--session',
    '--type=method_call',
    '--dest=org.freedesktop.Notifications',
    '/org/freedesktop/Notifications',
    'org.dovo.NotificationFixture.Activate',
    'uint32:1',
  ])
  await page.waitForFunction(() => window.siteClickTrusted === true)
  await eventually(() => app.evaluate(() => globalThis.clicked), 1)
  assert.equal(
    await page.evaluate(() => window.notifications.every((n) => n instanceof Notification)),
    true,
  )
  assert.equal(
    await page.evaluate(
      async () => (await navigator.permissions.query({ name: 'notifications' })).state,
    ),
    'granted',
  )
  await app.evaluate(() => {
    globalThis.inView = true
  })
  assert.equal(await notify('visible suppressed again'), 'suppressed')
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'granted')
  assert.equal(received.filter((e) => e.type === 'notify').length, 1)
  await app.evaluate(() => {
    globalThis.inView = false
  })
  assert.equal(await notify('background delivered again'), 'show')
  await eventually(() => received.filter((e) => e.type === 'notify').length, 2)
  console.log(
    'PASS: native background delivery, in-view suppression, stable permissions and trusted notification clicks',
  )
} finally {
  try {
    await app?.close()
  } finally {
    daemon.kill()
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}
