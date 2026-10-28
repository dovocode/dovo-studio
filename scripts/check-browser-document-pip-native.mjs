import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const require = createRequire(root + '/apps/desktop/package.json')
const directory = await mkdtemp(join(tmpdir(), 'dovo-document-pip-'))
const entry = join(directory, 'main.cjs')
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(`<title>Call fixture</title><button id="open">Float call</button><video id="call" autoplay muted></video>
<script>
const canvas = document.createElement('canvas');
window.stream = canvas.captureStream(10); call.srcObject = stream;
window.entered = 0;
documentPictureInPicture.onenter = event => { window.eventWindow = event.window; entered++ };
document.getElementById('open').onclick = async () => {
  const child = await documentPictureInPicture.requestWindow({width: 420, height: 280});
  const video = document.getElementById('call');
  child.document.body.append(video);
  child.addEventListener('pagehide', () => document.body.append(video), {once: true});
};
</script>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let app
try {
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root + '/apps/desktop',
      contents: `import { app, BrowserWindow } from 'electron';
import { createBrowserMedia } from './electron/browser-media';
import { browserPermissions } from './electron/browser-permissions';
import { authorizeDocumentPip } from './electron/browser-document-pip';
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async () => {
  const owner = new BrowserWindow({show:true, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,disableBlinkFeatures:'DocumentPictureInPictureAPI'}});
  const tab = {key:'call',profileId:'work',windowId:owner.id,contents:owner.webContents};
  const media = createBrowserMedia({tabFor: contents => contents.id === owner.webContents.id ? tab : undefined, tabs: () => [tab], canFullscreen: () => false, prepareFullscreen: () => {}});
  media.attachSession(owner.webContents.session, 'work');
  media.attachTab(owner.webContents);
  for (const permission of ['clipboard-read','speaker-selection','persistent-storage'])
    browserPermissions('work').setSite(${JSON.stringify(origin)}, permission, 'allow');
  globalThis.pipAutoAllowed = false;
  const pipOptions = authorizeDocumentPip(owner.webContents, () => globalThis.pipAutoAllowed);
  owner.webContents.setWindowOpenHandler(details => {
    const options = pipOptions(details);
    return options ? {action:'allow',overrideBrowserWindowOptions:options} : {action:'deny'};
  });
  owner.webContents.on('did-create-window', child => {
    child.webContents.on('will-navigate', event => event.preventDefault());
    owner.webContents.once('did-navigate', () => {if (!child.isDestroyed()) child.close()});
    owner.once('closed', () => {if (!child.isDestroyed()) child.destroy()});
  });
  await owner.loadURL(${JSON.stringify(origin)});
});`,
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    conditions: ['development'],
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', entry],
  })
  const owner = await app.firstWindow()
  owner.setDefaultTimeout(15000)
  owner.on('pageerror', (error) => console.error(error.message))
  owner.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await owner.waitForFunction(() => !!window.documentPictureInPicture)
  assert.equal(
    await owner.evaluate(
      async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state,
    ),
    'granted',
  )
  assert.equal(await owner.evaluate(async () => navigator.storage.persist()), true)
  assert.equal(
    await owner.evaluate(async () => {
      const lock = await navigator.wakeLock.request('screen')
      const active = !lock.released
      await lock.release()
      return active
    }),
    true,
  )
  assert.equal(await owner.evaluate(() => typeof HTMLMediaElement.prototype.setSinkId), 'function')
  const cdp = await owner.context().newCDPSession(owner)
  await new Promise((resolve) => setTimeout(resolve, 5500))
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {try {await documentPictureInPicture.requestWindow(); return 'allowed'} catch (error) {return error.name}})()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  })
  assert.equal(result.result.value, 'NotAllowedError')
  await owner.click('#open')
  await owner.waitForFunction(() => window.entered === 1)
  assert.equal(await owner.evaluate(() => documentPictureInPicture.window === eventWindow), true)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isAlwaysOnTop())
        ?.isAlwaysOnTop(),
    ),
    true,
  )
  const popup = app.windows().find((page) => page !== owner)
  assert.ok(popup)
  assert.deepEqual(await popup.evaluate(() => [innerWidth, innerHeight]), [420, 280])
  assert.equal(
    await popup.evaluate(() => document.getElementById('call').srcObject.getTracks()[0].readyState),
    'live',
  )
  assert.equal(
    await popup.evaluate(() => !!window.opener && !window.documentPictureInPicture),
    true,
  )
  await popup.evaluate(() => window.close())
  await owner.waitForFunction(
    () => !documentPictureInPicture.window && !!document.getElementById('call'),
  )
  assert.equal(
    await owner.evaluate(
      () =>
        document.getElementById('call').srcObject === stream &&
        stream.getTracks()[0].readyState === 'live',
    ),
    true,
  )
  await owner.click('#open')
  await owner.waitForFunction(() => window.entered === 2)
  await owner.reload({ waitUntil: 'domcontentloaded' })
  await owner.waitForFunction(() => !!documentPictureInPicture)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await cdp.send('Runtime.evaluate', {
    expression: `navigator.mediaSession.setActionHandler('enterpictureinpicture', details => {window.autoReason = details.reason; documentPictureInPicture.requestWindow().then(child => {window.autoWindow = child})})`,
    userGesture: false,
  })
  await new Promise((resolve) => setTimeout(resolve, 5500))
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]
    owner.hide()
    owner.webContents.send('browser:document-pip-visibility', false)
  })
  await owner.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 100 })
  assert.equal(await owner.evaluate(() => !!documentPictureInPicture.window), false)
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.pipAutoAllowed = true
    const owner = BrowserWindow.getAllWindows()[0]
    owner.show()
    owner.webContents.send('browser:document-pip-visibility', true)
  })
  await owner.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 100 })
  await new Promise((resolve) => setTimeout(resolve, 5500))
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]
    owner.hide()
    owner.webContents.send('browser:document-pip-visibility', false)
  })
  await owner.waitForFunction(() => !!window.autoWindow, null, { polling: 100 })
  assert.equal(await owner.evaluate(() => window.autoReason), 'contentoccluded')
  console.log(
    'Document PiP native fixture passed: activation, real Window/DOM/media, events, always-on-top, close/restore, owner navigation and automatic-PiP opt-in.',
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
