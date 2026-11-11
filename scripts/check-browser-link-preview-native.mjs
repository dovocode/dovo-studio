import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const directory = await mkdtemp(join(tmpdir(), 'dovo-link-preview-'))
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><title>${request.url}</title>
    <style>body{margin:0;background:#aee0ff;height:2000px}input{height:32px}</style>
    <input id="draft" value="Unsaved draft"><a target="_blank" rel="opener" href="/child">Open child</a>
    <script>window.ticks=0;window.presses=[];document.addEventListener('pointerdown',()=>presses.push('down'));document.addEventListener('pointerup',()=>presses.push('up'));function tick(){ticks++;document.body.style.backgroundColor=ticks%120<60?'#aee0ff':'#acecce';requestAnimationFrame(tick)}tick()</script>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const nativeInput = process.platform === 'linux' && !!process.env.DISPLAY
let app
try {
  await symlink(
    join(root, 'apps/desktop/node_modules'),
    join(directory, 'node_modules'),
    'junction',
  )
  await writeFile(
    join(directory, 'preload.cjs'),
    `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('bridge',{browser:command=>ipcRenderer.invoke('preview:browser',command)});`,
  )
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: join(root, 'packages/extension-tasks'),
      contents: `import {nativeBrowserHole,onNativeBrowserBackgroundClick} from './src/browser/native-browser-layout';
const source=document.getElementById('source');const child=document.getElementById('child');const frame=document.getElementById('frame');const menu=document.getElementById('menu');
const backgroundHole=nativeBrowserHole(source),childHole=nativeBrowserHole(child);
window.backgroundClicks=0;onNativeBrowserBackgroundClick(source,()=>{window.backgroundClicks++;window.layout(false);void window.bridge.browser(window.sourceCommand)});
window.layout=(preview,overlay=false)=>{frame.hidden=!preview;menu.hidden=!overlay;backgroundHole.update(preview?source.getBoundingClientRect():undefined);childHole.update(preview&&overlay?child.getBoundingClientRect():undefined);return {background:source.getBoundingClientRect().toJSON(),child:child.getBoundingClientRect().toJSON()}};`,
    },
    outfile: join(directory, 'ui.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
  })
  const index = join(directory, 'index.html')
  await writeFile(
    index,
    `<!doctype html><style>
    html,body{margin:0;background:transparent}#root{height:100vh;background:#f4f4f4}header{height:40px}button{height:30px}
    [hidden]{display:none!important}#viewport{position:relative;height:calc(100vh - 40px)}#source{position:absolute;inset:0;height:auto;width:100%}
    #frame{position:absolute;left:180px;top:100px;width:500px;height:360px;background:white;border:1px solid #777;z-index:40}
    #child{height:320px}#menu{position:fixed;left:200px;top:180px;width:180px;height:80px;background:white;z-index:99}
    </style><div id="root" data-native-browser-layout><header>Studio · live link preview</header><div id="viewport" data-browser-viewport><button id="source">Return to opener</button><section id="frame" data-preview-overlay="true" hidden><header>Link preview <button id="close">Close preview</button></header><div id="child"></div></section></div><div id="menu" role="menu" hidden><button>Overlay action</button></div></div><script src="./ui.js"></script>`,
  )
  await writeFile(
    join(directory, 'main.ts'),
    `import {app,WebContentsView} from 'electron';
import {writeFileSync} from 'node:fs';
import {registerBrowser} from ${JSON.stringify(join(root, 'apps/desktop/electron/browser.ts'))};
import {createStudioWindow,studioContents} from ${JSON.stringify(join(root, 'apps/desktop/electron/studio-window.ts'))};
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
globalThis.ready=app.whenReady().then(async()=>{
writeFileSync(process.env.DOVO_SETTINGS_PATH!,JSON.stringify({app:{browserWorkspaceEnabled:true,browserProfiles:[{id:'default',name:'Default'}]}}));
const host=createStudioWindow({width:900,height:700,frame:false,webPreferences:{preload:${JSON.stringify(join(directory, 'preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
void host.loadURL('about:blank');
registerBrowser(${JSON.stringify(index)});const ui=studioContents(host);globalThis.fixture={host,ui,views:()=>host.contentView.children.filter(v=>v instanceof WebContentsView&&v.webContents!==ui)};await ui.loadFile(${JSON.stringify(index)});
});`,
  )
  const { build: buildMain } = await import(require.resolve('vite'))
  await buildMain({
    configFile: false,
    root: join(root, 'apps/desktop'),
    logLevel: 'warn',
    build: {
      ssr: join(directory, 'main.ts'),
      outDir: join(directory, 'out'),
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      rollupOptions: {
        external: ['electron', '@dovo/runtime/browser-favicon'],
        output: { format: 'cjs', entryFileNames: 'main.cjs' },
      },
    },
    ssr: { noExternal: true, target: 'node' },
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ...(nativeInput ? ['--ozone-platform=x11'] : []),
      join(directory, 'out/main.cjs'),
    ],
    env: { ...process.env, DOVO_SETTINGS_PATH: join(directory, 'settings.json') },
  })
  app.process().stderr.on('data', (data) => process.stderr.write(data))
  await app.firstWindow()
  await app.evaluate(() => globalThis.ready)
  const ui = app
    .context()
    .pages()
    .find((page) => page.url().endsWith('/index.html'))
  assert(ui)
  ui.setDefaultTimeout(10000)
  const call = (command) => ui.evaluate((command) => window.bridge.browser(command), command)
  const layout = (preview, overlay = false) =>
    ui.evaluate(({ preview, overlay }) => window.layout(preview, overlay), { preview, overlay })
  const rect = ({ x, y, width, height }) => ({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  })
  const initial = await layout(false)
  const sourceCommand = {
    action: 'show',
    key: 'opener',
    taskId: 'studio:browser',
    workspaceBrowser: true,
    url: origin + '/source',
    bounds: rect(initial.background),
  }
  await call(sourceCommand)
  await ui.evaluate((command) => (window.sourceCommand = command), sourceCommand)
  const source = app
    .context()
    .pages()
    .find((page) => page.url() === origin + '/source')
  assert(source)
  await source.locator('#draft').fill('Keep this draft')
  const sourceId = await app.evaluate(() => globalThis.fixture.views()[0].webContents.id)
  const initialTicks = await source.evaluate(() => ticks)
  await source.getByText('Open child', { exact: true }).click()
  await ui.waitForFunction(async () => {
    const state = await window.bridge.browser({ action: 'status', key: 'opener' })
    window.created = state?.createdTabs?.[0] ?? window.created
    return !!window.created
  })
  const created = await ui.evaluate(() => window.created)
  const bounds = await layout(true)
  const childCommand = {
    ...sourceCommand,
    key: created.key,
    url: origin + '/child',
    bounds: rect(bounds.child),
    background: { key: 'opener', bounds: rect(bounds.background) },
  }
  await call(childCommand)
  const child = app
    .context()
    .pages()
    .find((page) => page.url() === origin + '/child')
  assert(child)
  const read = () =>
    app.evaluate(() =>
      globalThis.fixture.views().map((view) => ({
        id: view.webContents.id,
        url: view.webContents.getURL(),
        visible: view.getVisible(),
        bounds: view.getBounds(),
      })),
    )
  let views = await read()
  assert.equal(
    views.find((view) => view.id === sourceId).visible,
    true,
    'The original opener remains visible',
  )
  assert.equal(
    await child.evaluate(() => !!window.opener),
    true,
    'Chromium keeps the actual opener',
  )
  await source.waitForFunction((initial) => ticks > initial + 3, initialTicks)
  assert.equal(await source.locator('#draft').inputValue(), 'Keep this draft')
  assert.equal(await source.evaluate(() => document.visibilityState), 'visible')
  assert.equal(await ui.locator('img').count(), 0, 'No image replaces either live browser')
  const resized = { ...childCommand, bounds: { ...childCommand.bounds, width: 420, height: 280 } }
  await call(resized)
  assert.deepEqual(
    (await read()).find((view) => view.url.endsWith('/child')).bounds,
    resized.bounds,
  )
  await call(childCommand)
  // A menu overlays both live views. It must keep its real controls and input.
  await layout(true, true)
  await call({ action: 'hide', key: created.key, occluded: true, bounds: childCommand.bounds })
  assert((await read()).every((view) => view.visible))
  const backgroundBounds = { ...childCommand.background.bounds, width: 880, height: 620 }
  await call({
    action: 'hide',
    key: created.key,
    occluded: true,
    bounds: childCommand.bounds,
    background: { key: 'opener', bounds: backgroundBounds },
  })
  assert.deepEqual(
    (await read()).find((view) => view.id === sourceId).bounds,
    backgroundBounds,
    'Resizing beneath a menu updates the live opener too',
  )
  await ui.getByRole('button', { name: 'Overlay action', exact: true }).click()
  await layout(true)
  await call(childCommand)
  if (nativeInput) {
    const id = String(
      await app.evaluate(() => globalThis.fixture.host.getNativeWindowHandle().readUInt32LE()),
    )
    execFileSync('xdotool', ['windowactivate', '--sync', id])
    execFileSync('xdotool', [
      'mousemove',
      '--window',
      id,
      String(childCommand.bounds.x + 60),
      String(childCommand.bounds.y + 15),
      'click',
      '1',
    ])
    await child.waitForFunction(() => presses.includes('up'))
    assert.deepEqual(
      await child.evaluate(() => presses),
      ['down', 'up'],
      'The child gets the complete native pointer press',
    )
    execFileSync('xdotool', ['type', '--clearmodifiers', 'X'])
    await child.waitForFunction(() => document.querySelector('#draft').value.includes('X'))
    await app.evaluate(() =>
      globalThis.fixture
        .views()
        .find((view) => view.webContents.getURL().endsWith('/source'))
        .webContents.focus(),
    )
    const status = await call({ action: 'status', key: created.key, tabCount: 2 })
    assert.equal(
      status.focusedTabKey,
      'opener',
      'Focusing the live background returns selection to its opener',
    )
    execFileSync('xdotool', ['mousemove', '--window', id, '60', '55', 'click', '1'])
    await ui.waitForFunction(() => window.backgroundClicks === 1)
    assert.equal(
      await source.evaluate(() => presses.length),
      2,
      'The return click finishes before restoring the opener',
    )
  }
  await layout(false)
  await call(sourceCommand)
  assert.equal((await read()).find((view) => view.url.endsWith('/child')).visible, false)
  assert.equal((await read()).find((view) => view.id === sourceId).visible, true)
  assert.equal(await source.locator('#draft').inputValue(), 'Keep this draft')
  // Leaving the preview hides both native surfaces, including through an overlay.
  await layout(true)
  await call(childCommand)
  await call({ action: 'hide', key: created.key, occluded: true })
  await call({ action: 'hide', key: created.key })
  assert((await read()).every((view) => !view.visible))
  await call(childCommand)
  await call({ action: 'close', key: created.key })
  assert(
    (await read()).every((view) => !view.visible),
    'Closing the active preview retires its background too',
  )
  await call(childCommand)
  // Promotion removes the retained opener without replacing the child WebContents.
  const childId = (await read()).find((view) => view.url.endsWith('/child')).id
  await layout(false)
  await call({ ...childCommand, background: undefined, bounds: sourceCommand.bounds })
  views = await read()
  assert.equal(views.find((view) => view.id === sourceId).visible, false)
  assert.equal(views.find((view) => view.id === childId).visible, true)
  console.log(
    'Native live link previews passed: real _blank opener, live animation, drafts, overlay controls, resize, hide, close and promotion identity.' +
      (nativeInput
        ? ' X11 mouse presses, typing and background return passed.'
        : ' Native pointer and typing checks require Linux with X11.'),
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
