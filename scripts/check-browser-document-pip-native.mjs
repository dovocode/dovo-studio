import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
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
  const child = await documentPictureInPicture.requestWindow({width: 420, height: 280, disallowReturnToOpener: !!window.disallowReturn});
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
import { authorizeDocumentPip, createDocumentPipWindow } from './electron/browser-document-pip';
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async () => {
  const owner = new BrowserWindow({show:true, webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,disableBlinkFeatures:'DocumentPictureInPictureAPI'}});
  const tab = {key:'call',profileId:'work',windowId:owner.id,contents:owner.webContents};
  const media = createBrowserMedia({tabFor: contents => contents.id === owner.webContents.id ? tab : undefined, tabs: () => [tab], canFullscreen: () => false, prepareFullscreen: () => {}});
  media.attachSession(owner.webContents.session, 'work');
  media.attachTab(owner.webContents);
  for (const permission of ['clipboard-read','speaker-selection','persistent-storage'])
    browserPermissions('work').setSite(${JSON.stringify(origin)}, permission, 'allow');
  globalThis.pipAutoAllowed = false;
  globalThis.pipHostVisible = true;
  globalThis.reportPipVisibility = visible => {globalThis.pipHostVisible=visible;owner.webContents.send('browser:document-pip-visibility', visible)};
  const pipOptions = authorizeDocumentPip(owner.webContents, () => globalThis.pipAutoAllowed && !globalThis.pipHostVisible);
  owner.webContents.setWindowOpenHandler(details => {
    if (details.frameName === 'consume-activation') return {action:'allow',overrideBrowserWindowOptions:{show:false}};
    const options = pipOptions(details);
    if (!options) return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:options,createWindow: options => {
      const pip = createDocumentPipWindow(options, owner.webContents.getURL(), details.features.includes('dovo-disallow-return=1') ? undefined : () => { globalThis.pipReturned = true; owner.show(); owner.focus() });
      const child = pip.window;
      pip.contents.on('will-navigate', event => event.preventDefault());
      owner.webContents.once('did-navigate', () => {if (!child.isDestroyed()) child.close()});
      owner.once('closed', () => {if (!child.isDestroyed()) child.destroy()});
      return pip.contents;
    }};
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
  const headerPage = async () => {
    const header = await new Promise((resolve, reject) => {
      const context = app.context()
      const watched = new Map()
      const cleanup = () => {
        clearTimeout(timer)
        context.off('page', watch)
        for (const [page, check] of watched) page.off('framenavigated', check)
      }
      const watch = (page) => {
        const check = () => {
          if (!page.url().startsWith('data:text/html')) return
          cleanup()
          resolve(page)
        }
        watched.set(page, check)
        page.on('framenavigated', check)
        check()
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('PiP header did not open'))
      }, 10000)
      context.on('page', watch)
      for (const page of context.pages()) watch(page)
    })
    await header.getByRole('toolbar').waitFor({ timeout: 10000 })
    return header
  }
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
  assert.equal(
    (
      await cdp.send('Runtime.evaluate', {
        expression:
          'window.open("about:blank", "consume-activation").close(); navigator.userActivation.isActive',
        returnByValue: true,
        userGesture: false,
      })
    ).result.value,
    false,
    'An ordinary popup consumes transient activation',
  )
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
  const popup = app.windows().find((page) => page !== owner && page.url() === 'about:blank')
  assert.ok(popup)
  await popup.waitForFunction(() => innerWidth === 420 && innerHeight === 280)
  assert.deepEqual(await popup.evaluate(() => [innerWidth, innerHeight]), [420, 280])
  assert.equal(
    await popup.evaluate(() => document.getElementById('call').srcObject.getTracks()[0].readyState),
    'live',
  )
  assert.equal(
    await popup.evaluate(() => !!window.opener && !window.documentPictureInPicture),
    true,
  )
  const header = await headerPage()
  assert.equal(await header.locator('.domain').textContent(), new URL(origin).hostname)
  assert.equal(await popup.locator('[data-dovo-pip-controls]').count(), 0)
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isAlwaysOnTop())
        .contentView.children.map((view) => view.getBounds()),
    ),
    [{ x: 0, y: 36, width: 420, height: 280 }],
  )
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isAlwaysOnTop())
      .setContentSize(500, 356),
  )
  await popup.waitForFunction(() => innerWidth === 500 && innerHeight === 320)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isAlwaysOnTop())
      .setContentSize(420, 316),
  )
  await popup.waitForFunction(() => innerWidth === 420 && innerHeight === 280)
  await mkdir(join(root, 'work/browser-pip'), { recursive: true })
  await header.screenshot({ path: join(root, 'work/browser-pip/compact-controls.png') })
  await header.getByRole('button', { name: 'Close picture-in-picture', exact: true }).click()
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
  const returned = app.windows().find((page) => page !== owner && page.url() === 'about:blank')
  assert.ok(returned)
  const returnHeader = await headerPage()
  await returnHeader.getByRole('button', { name: 'Back to tab', exact: true }).click()
  await owner.waitForFunction(() => !documentPictureInPicture.window)
  assert.equal(await app.evaluate(() => globalThis.pipReturned), true)
  await owner.click('#open')
  await owner.waitForFunction(() => window.entered === 3)
  await headerPage()
  await owner.evaluate(() => documentPictureInPicture.window.close())
  await owner.waitForFunction(() => !documentPictureInPicture.window, null, {
    polling: 100,
    timeout: 10000,
  })
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
    'Website close also destroys trusted header',
  )
  await owner.evaluate(() => {
    window.disallowReturn = true
  })
  await owner.click('#open')
  await owner.waitForFunction(() => window.entered === 4)
  const restrictedHeader = await headerPage()
  assert.equal(
    await restrictedHeader.getByRole('button', { name: 'Back to tab', exact: true }).count(),
    0,
  )
  await owner.reload({ waitUntil: 'domcontentloaded' })
  await owner.waitForFunction(() => !!documentPictureInPicture)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await cdp.send('Runtime.evaluate', {
    expression: `window.autoCount = 0; navigator.mediaSession.setActionHandler('enterpictureinpicture', async details => {window.autoReason = details.reason; window.autoCount++; await Promise.resolve(); try {window.autoWindow = await documentPictureInPicture.requestWindow()} catch(error) {window.autoError = error.message}})`,
    userGesture: false,
  })
  assert.equal(
    (
      await cdp.send('Runtime.evaluate', {
        expression:
          'window.open("about:blank", "consume-activation").close(); navigator.userActivation.isActive',
        returnByValue: true,
        userGesture: false,
      })
    ).result.value,
    false,
    'An ordinary popup consumes transient activation',
  )
  // Studio tab/section changes do not hide the containing native window. The page
  // may even stay natively visible while media or a live-preview subscription runs.
  await app.evaluate(() => {
    globalThis.reportPipVisibility(false)
  })
  await owner.waitForFunction(() => document.visibilityState === 'hidden', null, {
    polling: 100,
    timeout: 10000,
  })
  assert.equal(
    await owner.evaluate(() => !!documentPictureInPicture.window),
    false,
    'Permission is still required',
  )
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.pipAutoAllowed = true
    const owner = BrowserWindow.getAllWindows()[0]
    owner.show()
    owner.focus()
    globalThis.reportPipVisibility(true)
  })
  await owner.waitForFunction(() => document.visibilityState === 'visible', null, {
    polling: 100,
    timeout: 10000,
  })
  await app.evaluate(() => {
    globalThis.reportPipVisibility(false)
  })
  await owner.waitForFunction(() => !!window.autoWindow || !!window.autoError, null, {
    polling: 100,
    timeout: 10000,
  })
  assert.equal(await owner.evaluate(() => window.autoError), undefined)
  assert.equal(await owner.evaluate(() => window.autoReason), 'contentoccluded')
  assert.equal(
    await owner.evaluate(() => window.autoCount),
    1,
    'Async website handler can open PiP without user activation',
  )
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.isAlwaysOnTop())
        .isVisible(),
    ),
    true,
  )
  await app.evaluate(() => {
    globalThis.reportPipVisibility(false)
  })
  assert.equal(
    await owner.evaluate(() => window.autoCount),
    1,
    'Repeated hidden reports do not re-enter PiP',
  )
  await owner.evaluate(() => {
    documentPictureInPicture.window.close()
    window.autoWindow = undefined
  })
  await owner.waitForFunction(() => !documentPictureInPicture.window, null, {
    polling: 100,
    timeout: 10000,
  })
  await owner.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  assert.equal(
    await owner.evaluate(() => window.autoCount),
    1,
    'Closing PiP while away does not reopen it',
  )
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) => !w.isAlwaysOnTop())
    owner.show()
    owner.focus()
    globalThis.reportPipVisibility(true)
  })
  await owner.waitForFunction(() => document.visibilityState === 'visible', null, {
    polling: 100,
    timeout: 10000,
  })
  // Native minimize/hide still works as well as in-app navigation.
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]
    owner.hide()
    globalThis.reportPipVisibility(false)
  })
  await owner.waitForFunction(() => !!window.autoWindow || !!window.autoError, null, {
    polling: 100,
  })
  assert.equal(await owner.evaluate(() => window.autoError), undefined)
  assert.equal(await owner.evaluate(() => window.autoCount), 2)
  console.log(
    'Document PiP native fixture passed: activation, real Window/DOM/media, separate header, hostname, resize, close/restore, owner navigation, in-app visibility transitions and async automatic-PiP opt-in.',
  )
} catch (error) {
  console.error('Native test failure:', error)
  throw error
} finally {
  if (app && app.process().exitCode === null && app.context().pages().length) {
    await app.evaluate(() => {
      globalThis.pipAutoAllowed = false
    })
    await app.close()
  }
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
