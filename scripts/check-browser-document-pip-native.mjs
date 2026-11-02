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
  window.childPagehideSync = false;
  window.childPagehideMicrotask = false;
  // Teams gates its return-to-call and close cleanup on API presence in the child.
  child.eval("if (window.documentPictureInPicture) window.addEventListener('pagehide', () => {opener.childPagehideSync = true;Promise.resolve().then(() => {opener.childPagehideMicrotask = true})})");
  const video = document.getElementById('call');
  child.document.body.append(video);
  child.addEventListener('pagehide', () => {window.callClosedWhileHidden=document.hidden;if(!document.hidden)document.body.append(video)}, {once: true});
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
import { createBrowserVisibility } from './electron/browser-visibility';
import { browserPermissions } from './electron/browser-permissions';
import { authorizeDocumentPip, createDocumentPipWindow, dismissDocumentPipWindow } from './electron/browser-document-pip';
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async () => {
  globalThis.dismissPip = dismissDocumentPipWindow;
  const owner = new BrowserWindow({show:true, webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,disableBlinkFeatures:'DocumentPictureInPictureAPI'}});
  const tab = {key:'call',profileId:'work',windowId:owner.id,contents:owner.webContents};
  const media = createBrowserMedia({tabFor: contents => contents.id === owner.webContents.id ? tab : undefined, tabs: () => [tab], canFullscreen: () => false, prepareFullscreen: () => {}});
  globalThis.pipHostVisible = true;
  const visibility = createBrowserVisibility(contents => contents === owner.webContents ? globalThis.pipHostVisible : undefined);
  visibility.attachSession(owner.webContents.session);
  media.attachSession(owner.webContents.session, 'work');
  media.attachTab(owner.webContents);
  for (const permission of ['clipboard-read','speaker-selection','persistent-storage'])
    browserPermissions('work').setSite(${JSON.stringify(origin)}, permission, 'allow');
  globalThis.pipAutoAllowed = false;
  globalThis.pipHostVisible = true;
  globalThis.reportPipVisibility = visible => {globalThis.pipHostVisible=visible;visibility.report(owner.webContents)};
  const pipOptions = authorizeDocumentPip(owner.webContents, () => globalThis.pipAutoAllowed && !globalThis.pipHostVisible);
  owner.webContents.setWindowOpenHandler(details => {
    if (details.frameName === 'consume-activation' || details.frameName === 'login-redirect') return {action:'allow',overrideBrowserWindowOptions:{show:false,webPreferences:{disableBlinkFeatures:'DocumentPictureInPictureAPI'}}};
    const options = pipOptions(details);
    if (!options) return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:options,createWindow: options => {
      const pip = createDocumentPipWindow(options, owner.webContents.getURL(), async () => { globalThis.pipReturned = true; owner.show(); owner.focus(); globalThis.reportPipVisibility(true); if (!(await owner.webContents.executeJavaScript('document.visibilityState === "visible"'))) throw Error('Call tab still hidden') }, !details.features.includes('dovo-disallow-return=1'));
      const child = pip.window;
      pip.contents.on('will-navigate', event => event.preventDefault());
      owner.webContents.once('did-navigate', () => dismissDocumentPipWindow(child));
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
  const clickClosingControl = async (header, name) => {
    const button = header.getByRole('button', { name, exact: true })
    await button.click({ trial: true })
    const bounds = await button.boundingBox()
    assert.ok(bounds, 'The PiP control must be visible')
    const popupWindow = await app.browserWindow(header)
    try {
      // The trusted click destroys its own renderer. Send native input from the
      // surviving main process instead of awaiting a click reply from that renderer.
      await Promise.all([
        header.waitForEvent('close'),
        popupWindow.evaluate(
          (popup, point) => {
            popup.webContents.sendInputEvent({
              type: 'mouseDown',
              button: 'left',
              clickCount: 1,
              ...point,
            })
            popup.webContents.sendInputEvent({
              type: 'mouseUp',
              button: 'left',
              clickCount: 1,
              ...point,
            })
          },
          {
            x: Math.round(bounds.x + bounds.width / 2),
            y: Math.round(bounds.y + bounds.height / 2),
          },
        ),
      ])
    } finally {
      await popupWindow.dispose()
    }
  }
  const owner = await app.firstWindow()
  owner.setDefaultTimeout(15000)
  owner.on('pageerror', (error) => console.error(error.message))
  owner.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await owner.waitForFunction(() => !!window.documentPictureInPicture)
  const [login] = await Promise.all([
    app.waitForEvent('window', { predicate: (page) => page !== owner }),
    owner.evaluate(() => {
      window.open(location.href, 'login-redirect')
    }),
  ])
  await login.waitForLoadState('domcontentloaded')
  assert.equal(await login.evaluate(() => !!window.opener), true)
  assert.equal(
    await login.evaluate(() => typeof documentPictureInPicture?.requestWindow),
    'function',
    'An ordinary tab that retains its login opener must still expose Document PiP',
  )
  await login.evaluate(() => window.close())
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
  assert.deepEqual(
    await popup.evaluate(() => ({
      opener: !!window.opener,
      api: typeof window.documentPictureInPicture,
      window: window.documentPictureInPicture?.window,
    })),
    { opener: true, api: 'object', window: null },
    'The PiP guest exposes the same interface as native Chromium',
  )
  assert.deepEqual(
    await popup.evaluate(async () => {
      window.name = 'Meeting compact view'
      try {
        await documentPictureInPicture.requestWindow()
        return { allowed: true }
      } catch (error) {
        return { name: error.name, message: error.message }
      }
    }),
    {
      name: 'NotAllowedError',
      message: 'Opening a PiP window from a PiP window is not allowed.',
    },
    'Renaming a PiP guest must not permit nested PiP windows',
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
  await clickClosingControl(header, 'Close picture-in-picture')
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
  await clickClosingControl(returnHeader, 'Back to tab')
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
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => document.hidden)
  await clickClosingControl(restrictedHeader, 'Close picture-in-picture')
  await owner.waitForFunction(
    () => !documentPictureInPicture.window && !!document.getElementById('call'),
  )
  assert.equal(
    await owner.evaluate(() => window.callClosedWhileHidden),
    false,
    'Closing restricted PiP reveals the call before pagehide',
  )
  assert.equal(
    await owner.evaluate(() => stream.getTracks()[0].readyState),
    'live',
    'Closing PiP keeps the call media alive',
  )
  // macOS Window > Close / Cmd+W closes the native header, bypassing its HTML buttons.
  await owner.click('#open')
  await headerPage()
  await owner.evaluate(() => {
    window.callClosedWhileHidden = undefined
  })
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.pipReturned = false
    globalThis.reportPipVisibility(false)
    BrowserWindow.getAllWindows()
      .find((w) => w.isAlwaysOnTop())
      .close()
  })
  await owner.waitForFunction(() => !documentPictureInPicture.window)
  assert.equal(
    await app.evaluate(() => globalThis.pipReturned),
    true,
    'Native window dismissal must restore the call just like the Close header button',
  )
  assert.equal(
    await owner.evaluate(() => window.callClosedWhileHidden),
    false,
    'Native close must deliver pagehide to the call document',
  )
  assert.equal(
    await owner.evaluate(() => !!document.getElementById('call')),
    true,
    'Native close must return the live call content to its owner',
  )
  assert.equal(await owner.evaluate(() => window.childPagehideSync), true)
  assert.equal(
    await owner.evaluate(() => window.childPagehideMicrotask),
    true,
    'The closing child must finish its pagehide microtasks',
  )
  // App cleanup and replacing a PiP window must not behave like a user returning.
  await owner.click('#open')
  await headerPage()
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.pipReturned = false
    globalThis.reportPipVisibility(false)
    globalThis.dismissPip(BrowserWindow.getAllWindows().find((w) => w.isAlwaysOnTop()))
  })
  await owner.waitForFunction(() => !documentPictureInPicture.window)
  assert.equal(await app.evaluate(() => globalThis.pipReturned), false)
  assert.equal(await owner.evaluate(() => document.hidden), true)
  await app.evaluate(() => globalThis.reportPipVisibility(true))
  await owner.reload({ waitUntil: 'domcontentloaded' })
  await owner.waitForFunction(() => !!documentPictureInPicture)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await cdp.send('Runtime.evaluate', {
    expression: `window.autoCount = 0; navigator.mediaSession.setActionHandler('enterpictureinpicture', async details => {
      window.autoReason = details.reason; window.autoCount++; await Promise.resolve();
      try {
        const child = await documentPictureInPicture.requestWindow();
        // Call applications can replace the initial about:blank document before rendering.
        child.document.open(); child.document.write('<!doctype html><title>Floating call</title>'); child.document.close();
        if (!child.documentPictureInPicture || child.documentPictureInPicture.window !== null)
          throw new Error('PiP interface was lost when replacing the document');
        const video = document.getElementById('call');
        child.document.body.append(video);
        child.addEventListener('pagehide', () => {window.callClosedWhileHidden=document.hidden;document.body.append(video)}, {once: true});
        window.autoWindow = child;
      } catch(error) {window.autoError = error.message}
    })`,
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
  for (let cycle = 1; cycle <= 3; cycle++) {
    const automaticHeader = await headerPage()
    await clickClosingControl(automaticHeader, 'Back to tab')
    await owner.waitForFunction(
      () =>
        !documentPictureInPicture.window &&
        document.visibilityState === 'visible' &&
        !!document.getElementById('call'),
      null,
      { polling: 100 },
    )
    assert.equal(
      await owner.evaluate(() => window.callClosedWhileHidden),
      false,
      'Back to tab restores Teams visibility before its PiP pagehide',
    )
    assert.equal(
      await owner.evaluate(
        () =>
          document.getElementById('call').srcObject === stream &&
          stream.getTracks()[0].readyState === 'live',
      ),
      true,
      'Returning to the tab preserves the live call across repeated automatic PiP cycles',
    )
    await owner.evaluate(() => {
      window.autoWindow = undefined
    })
    await app.evaluate(() => globalThis.reportPipVisibility(false))
    await owner.waitForFunction(() => !!window.autoWindow || !!window.autoError, null, {
      polling: 100,
    })
    assert.equal(await owner.evaluate(() => window.autoError), undefined)
    assert.equal(await owner.evaluate(() => window.autoCount), cycle + 1)
  }
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
    4,
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
  assert.equal(await owner.evaluate(() => window.autoCount), 5)
  // Ordinary video sites have no Media Session handler. Use Chromium's native PiP.
  await owner.evaluate(() => documentPictureInPicture.window.close())
  await owner.waitForFunction(() => !!document.getElementById('call'))
  await owner.evaluate(() => {
    navigator.mediaSession.setActionHandler('enterpictureinpicture', null)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    window.drawVideo = setInterval(() => {
      context.fillStyle = 'red'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }, 50)
    const video = document.getElementById('call')
    video.srcObject = canvas.captureStream(20)
    video.style.cssText = 'width:320px;height:180px'
    video.play()
  })
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) => !w.isAlwaysOnTop())
    owner.show()
    owner.focus()
    globalThis.pipAutoAllowed = false
    globalThis.reportPipVisibility(true)
  })
  await owner.waitForFunction(() => {
    const video = document.getElementById('call')
    return !document.hidden && !video.paused && video.readyState >= 2 && video.videoWidth > 0
  })
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => document.hidden)
  assert.equal(
    await owner.evaluate(() => !!document.pictureInPictureElement),
    false,
    'Unapproved sites cannot enter native video PiP automatically',
  )
  await app.evaluate(() => {
    globalThis.pipAutoAllowed = true
    globalThis.reportPipVisibility(true)
  })
  await owner.waitForFunction(() => !document.hidden)
  for (let cycle = 0; cycle < 2; cycle++) {
    await app.evaluate(() => globalThis.reportPipVisibility(false))
    await owner.waitForFunction(() => document.pictureInPictureElement?.id === 'call')
    await owner.evaluate(() => document.exitPictureInPicture())
    await owner.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    assert.equal(
      await owner.evaluate(() => !!document.pictureInPictureElement),
      false,
      'Closing native PiP while hidden does not immediately reopen it',
    )
    await app.evaluate(() => globalThis.reportPipVisibility(true))
    await owner.waitForFunction(() => !document.hidden)
  }
  await owner.evaluate(() => document.getElementById('call').pause())
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => document.hidden)
  assert.equal(
    await owner.evaluate(() => !!document.pictureInPictureElement),
    false,
    'Paused videos do not enter automatic PiP',
  )
  await app.evaluate(() => globalThis.reportPipVisibility(true))
  await owner.waitForFunction(() => !document.hidden)
  await owner.evaluate(() => document.getElementById('call').play())
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => !!document.pictureInPictureElement)
  await app.evaluate(() => globalThis.reportPipVisibility(true))
  await owner.waitForFunction(() => !document.pictureInPictureElement)
  // A delayed site's handler must not open after return, or swallow a newer leave.
  await owner.evaluate(() => {
    window.raceAttempts = 0
    window.raceOpened = 0
    navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
      window.raceAttempts++
      await new Promise((resolve) => {
        window.releasePip = resolve
      })
      const child = await documentPictureInPicture.requestWindow({ width: 420, height: 280 })
      window.raceOpened++
      child.document.body.innerHTML =
        '<div style="position:fixed;inset:0;background:rgb(30,150,60)">Live call</div>'
    })
  })
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => window.raceAttempts === 1)
  await app.evaluate(() => globalThis.reportPipVisibility(true))
  await owner.waitForFunction(() => !document.hidden)
  await owner.evaluate(() => window.releasePip())
  await owner.waitForFunction(() => !document.hidden && !documentPictureInPicture.window)
  await app.evaluate(() => globalThis.reportPipVisibility(false))
  await owner.waitForFunction(() => window.raceAttempts === 2)
  await app.evaluate(() => {
    globalThis.reportPipVisibility(true)
    globalThis.reportPipVisibility(false)
  })
  await owner.evaluate(() => window.releasePip())
  await owner.waitForFunction(() => window.raceAttempts === 3)
  assert.equal(await owner.evaluate(() => window.raceOpened), 0, 'Stale handlers cannot open PiP')
  await owner.evaluate(() => window.releasePip())
  await owner.waitForFunction(() => !!documentPictureInPicture.window)
  assert.equal(
    await owner.evaluate(() => window.raceOpened),
    1,
    'A new leave survives the canceled handler',
  )
  await headerPage()
  await app.evaluate(() => globalThis.reportPipVisibility(true))
  await owner.waitForFunction(() => !documentPictureInPicture.window)
  await owner.evaluate(() => clearInterval(window.drawVideo))
  console.log(
    'Document PiP native fixture passed: activation, real Window/DOM/media, separate header, hostname, resize, close/restore, owner navigation, in-app visibility transitions, async automatic-PiP opt-in, repeated Back-to-tab cycles after document replacement and automatic native video PiP without a site handler, automatic return cleanup, canceled delayed handlers and fast leave/return/leave races.',
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
