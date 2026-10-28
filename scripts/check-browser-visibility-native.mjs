import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const directory = await mkdtemp(join(tmpdir(), 'dovo-visibility-'))
const entry = join(directory, 'main.cjs')
// Plain HTTP deliberately exercises visibility outside secure contexts and the PiP polyfill.
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><script>
window.initial = {state: document.visibilityState, hidden: document.hidden};
window.events = []; window.windowEvents = 0;
document.addEventListener('visibilitychange', event => events.push({state: document.visibilityState, hidden: document.hidden, trusted: event.isTrusted}));
window.addEventListener('visibilitychange', () => windowEvents++);
</script>${
    request.url?.startsWith('/frame')
      ? ''
      : `<iframe src="/frame"></iframe><iframe src="http://frames.visibility.test:${server.address().port}/frame"></iframe>`
  }`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://visibility.test:${server.address().port}`
let app
try {
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: join(root, 'apps/desktop'),
      contents: `import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createBrowserVisibility } from './electron/browser-visibility';
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async () => {
  const host = new BrowserWindow({width:600,height:500,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await host.loadURL('data:text/html,Studio header');
  const views: Electron.WebContentsView[] = [];
  let selected = 0;
  const visibility = createBrowserVisibility(contents => {
    const index = views.findIndex(view => view.webContents === contents);
    return index < 0 ? undefined : index === selected && host.isVisible() && !host.isMinimized();
  });
  const profile = session.fromPartition('visibility');
  visibility.attachSession(profile);
  for (let index=0; index<2; index++) {
    const view = new WebContentsView({webPreferences:{session:profile,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,backgroundThrottling:false}});
    views.push(view);
    host.contentView.addChildView(view);
    view.setBounds({x:0,y:40,width:600,height:460});
    view.setVisible(index === selected);
    await view.webContents.loadURL(${JSON.stringify(origin)} + '/tab-' + index);
  }
  const report = () => {for (const view of views) visibility.report(view.webContents)};
  for (const event of ['minimize','restore','hide','show'] as const) host.on(event, report);
  Object.assign(globalThis, {
    ready: true,
    select: (index: number) => { selected=index; for (const [i, view] of views.entries()) view.setVisible(i === index); report() },
    overlay: (open: boolean) => { views[selected].setVisible(!open); report() },
    read: async (index: number) => Promise.all(views[index].webContents.mainFrame.framesInSubtree.map(async frame => ({url:frame.url,...await frame.executeJavaScript('({initial, state:document.visibilityState, hidden:document.hidden, events, windowEvents, secure:isSecureContext, node:typeof require, proto:Object.getOwnPropertyDescriptor(Document.prototype,"visibilityState").get.call(document)})')}))),
    reloadHidden: () => views[0].webContents.loadURL(${JSON.stringify(origin)} + '/reloaded'),
    newHiddenFrame: () => views[0].webContents.executeJavaScript('new Promise(resolve => {const frame=document.createElement("iframe");frame.onload=resolve;frame.src="/frame?new";document.body.append(frame)})'),
    showWindow: () => {host.show();host.focus()},
    hideWindow: () => host.hide(),
    minimizeWindow: () => host.minimize(),
    restoreWindow: () => host.restore(),
    finish: () => visibility.dispose(),
  });
  await host.webContents.executeJavaScript('globalThis.ready = true');
});`,
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      '--site-per-process',
      '--no-proxy-server',
      '--host-resolver-rules=MAP visibility.test 127.0.0.1, MAP frames.visibility.test 127.0.0.1',
      entry,
    ],
  })
  const host = await app.firstWindow()
  host.setDefaultTimeout(10000)
  await host.waitForFunction(() => globalThis.ready === true, null, { polling: 100 })
  const read = (index) => app.evaluate((_electron, index) => globalThis.read(index), index)
  let reloaded = false
  const states = async (index, state, count) => {
    const page = app
      .context()
      .pages()
      .find(
        (page) =>
          page.url() === `${origin}/${index === 0 && reloaded ? 'reloaded' : 'tab-' + index}`,
      )
    assert.ok(page, 'Missing tab page')
    for (const frame of page.frames())
      await frame.waitForFunction((expected) => document.visibilityState === expected, state, {
        polling: 100,
        timeout: 10000,
      })
    const frames = await read(index)
    assert.equal(frames.length, count)
    for (const frame of frames) {
      assert.equal(frame.state, state, frame.url)
      assert.equal(frame.hidden, state === 'hidden', frame.url)
      assert.equal(frame.proto, state, 'Prototype getters must agree')
      assert.equal(frame.node, 'undefined', 'Subframes must never expose Node')
      assert.equal(frame.secure, false, 'Visibility must work on ordinary HTTP sites')
    }
    return frames
  }
  for (const [index, state] of [
    [0, 'visible'],
    [1, 'hidden'],
  ]) {
    const frames = await states(index, state, 3)
    for (const frame of frames)
      assert.deepEqual(frame.initial, { state, hidden: state === 'hidden' })
  }
  await app.evaluate(() => globalThis.overlay(true))
  for (const frame of await states(0, 'visible', 3)) assert.equal(frame.events.length, 0)
  await app.evaluate(() => globalThis.overlay(false))
  await app.evaluate(() => globalThis.select(1))
  for (const frame of await states(0, 'hidden', 3)) {
    assert.deepEqual(frame.events, [{ state: 'hidden', hidden: true, trusted: false }])
    assert.equal(frame.windowEvents, 1, 'Visibility events bubble to window')
  }
  for (const frame of await states(1, 'visible', 3)) assert.equal(frame.events.length, 1)
  // Repeated state reports and native paint changes must not create duplicate events.
  await app.evaluate(() => globalThis.select(1))
  for (const frame of await states(1, 'visible', 3)) assert.equal(frame.events.length, 1)
  await app.evaluate(() => globalThis.newHiddenFrame())
  const added = (await states(0, 'hidden', 4)).find((frame) => frame.url.endsWith('?new'))
  assert.deepEqual(added.initial, { state: 'hidden', hidden: true })
  await app.evaluate(() => globalThis.reloadHidden())
  reloaded = true
  for (const frame of await states(0, 'hidden', 3)) {
    assert.deepEqual(frame.initial, { state: 'hidden', hidden: true })
    assert.deepEqual(frame.events, [])
  }
  await app.evaluate(() => globalThis.hideWindow())
  await states(1, 'hidden', 3)
  await app.evaluate(() => globalThis.showWindow())
  await states(1, 'visible', 3)
  await app.evaluate(() => globalThis.minimizeWindow())
  await states(1, 'hidden', 3)
  await app.evaluate(() => globalThis.restoreWindow())
  await states(1, 'visible', 3)
  await app.evaluate(() => globalThis.select(0))
  await states(0, 'visible', 3)
  await states(1, 'hidden', 3)
  await app.evaluate(() => globalThis.finish())
  console.log(
    'Native Electron visibility passed: initial/changed selection, same/cross-origin frames, Node isolation, HTTP, hidden-frame creation and reload, overlay preservation, window hide/minimize/restore, bubbling and deduplication with background throttling disabled.',
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
