import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const directory = await mkdtemp(join(tmpdir(), 'dovo-live-overlays-'))
let app
try {
  await writeFile(
    join(directory, 'preload.cjs'),
    `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{overlay:(open,passive)=>ipcRenderer.invoke('fixture:overlay',open,passive),tooltip:(visible,regions)=>ipcRenderer.invoke('fixture:tooltip',visible,regions),onDismiss:listener=>{ipcRenderer.on('window:tooltip-dismiss',listener);return ()=>ipcRenderer.off('window:tooltip-dismiss',listener)}});`,
  )
  await build({
    stdin: {
      loader: 'tsx',
      resolveDir: join(root, 'packages/studio-ui'),
      contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {configureNativeTooltips} from './src/native-tooltip';
import {TooltipProvider,Tooltip,TooltipTrigger,TooltipContent} from './src/components/ui/tooltip';
import {Dialog,DialogContent,DialogTitle,DialogTrigger} from '../web-ui/src/dialog';
import {nativeBrowserHole} from '../extension-tasks/src/browser/native-browser-layout';
const hole=nativeBrowserHole();
configureNativeTooltips((visible,regions)=>window.fixture.tooltip(visible,regions),window.fixture.onDismiss);
function Fixture(){const [tip,setTip]=React.useState(false);window.setTooltip=setTip;const [open,setOpen]=React.useState(false);const [count,setCount]=React.useState(0);
React.useLayoutEffect(()=>{hole.update(open?new DOMRect(100,80,500,350):undefined);window.fixture.overlay(open)},[open]);
return <><TooltipProvider><Tooltip open={tip} onOpenChange={setTip}><TooltipTrigger>Tip</TooltipTrigger><TooltipContent>Passive page tooltip</TooltipContent></Tooltip></TooltipProvider><Menu.Root open={open} onOpenChange={setOpen}><Menu.Trigger id="menu">Options</Menu.Trigger><Menu.Portal><Menu.Content style={{background:'white',color:'black',padding:20}}><Menu.Item onSelect={()=>setCount(n=>n+1)}>Count</Menu.Item><Menu.Item>Second</Menu.Item></Menu.Content></Menu.Portal></Menu.Root><output>{count}</output><Dialog><DialogTrigger>Dialog</DialogTrigger><DialogContent><DialogTitle>Native dialog</DialogTitle><input aria-label="Dialog input"/><button>Last</button></DialogContent></Dialog><div id="slot" style={{position:'fixed',left:100,top:80,width:500,height:350}}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`,
    },
    outfile: join(directory, 'ui.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
  })
  await writeFile(
    join(directory, 'tooltip.css'),
    '.studio-tooltip{background:rgb(20,25,30);color:rgb(210,215,220)}',
  )
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><title>Native overlay fixture</title><link rel="stylesheet" href="./tooltip.css"><style>html,body{margin:0;background:transparent}#root{width:100vw;height:100vh;background:#f0f0f0}button{height:40px} [role=dialog]{position:fixed!important;left:150px!important;top:100px!important;transform:none!important;background:white!important;max-width:400px;z-index:99} [data-dialog-close]{position:static}</style><div id="root"></div><script src="./ui.js"></script>`,
  )
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: join(root, 'apps/desktop'),
      contents: `
import {app,BrowserWindow,WebContentsView,ipcMain,dialog,Menu} from 'electron';
import {createStudioWindow,studioContents,raiseStudioOverlay} from './electron/studio-window';
import {nativeTooltipWindow,setNativeTooltipVisible,dismissNativeTooltip} from './electron/native-tooltip';
import {registerWindowUnload} from './electron/window-unload';
globalThis.nativeErrors=[];process.on('uncaughtException',error=>globalThis.nativeErrors.push(String(error)));process.on('unhandledRejection',error=>globalThis.nativeErrors.push(String(error)));globalThis.promptAnswer=0;globalThis.promptCount=0;dialog.showMessageBoxSync=()=>{globalThis.promptCount++;return globalThis.promptAnswer};
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.on('window-all-closed',()=>{});
globalThis.readyPromise=app.whenReady().then(async()=>{Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'viewMenu'}]));
const host=createStudioWindow({width:700,height:500,frame:false,webPreferences:{preload:${JSON.stringify(join(directory, 'preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
void host.loadURL("about:blank");const ui=studioContents(host);ui.setWindowOpenHandler(details=>{return nativeTooltipWindow(host,details,${JSON.stringify(join(directory, 'index.html'))})??{action:'deny'}});registerWindowUnload(host);
const page=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
const pageContents=page.webContents;pageContents.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'&&input.key==='Escape')dismissNativeTooltip(host)});host.once('closed',()=>{if(!pageContents.isDestroyed())pageContents.close()});host.contentView.addChildView(page);page.setBounds({x:100,y:80,width:500,height:350});
await page.webContents.loadURL('data:text/html,<body style="background:blue;height:2000px"><input value="unsaved draft"><script>window.ticks=0;window.presses=[];window.wheels=0;document.addEventListener("wheel",()=>wheels++);document.addEventListener("pointerdown",e=>presses.push(e.type));document.addEventListener("pointerup",e=>presses.push(e.type));setInterval(()=>ticks++,10)</script>');
let overlayCount=0;ipcMain.handle('fixture:tooltip',(_event,visible,regions)=>setNativeTooltipVisible(host,visible,regions));ipcMain.handle('fixture:overlay',(_event,open,passive)=>{overlayCount++;if(open){raiseStudioOverlay(host);if(!passive)ui.focus()}else host.contentView.addChildView(page)});
globalThis.fixture={host,ui,page,pageContents,read:()=>({overlayCount,visible:page.getVisible(),top:host.contentView.children.at(-1)===page?'page':'ui',owner:BrowserWindow.fromWebContents(ui)===host,bounds:host.contentView.children.find(v=>v.webContents===ui).getBounds()}),raise:()=>raiseStudioOverlay(host)};
await ui.loadFile(${JSON.stringify(join(directory, 'index.html'))});
});`,
    },
    outfile: join(directory, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(directory, 'main.cjs')],
  })
  await app.evaluate(() => globalThis.readyPromise)
  const ui = app
    .context()
    .pages()
    .find((p) => p.url().endsWith('/index.html'))
  assert(ui, 'Studio UI has its own native view')
  ui.setDefaultTimeout(10000)
  const rendererErrors = []
  ui.on('pageerror', (error) => rendererErrors.push(error.message))
  await ui.getByText('Options', { exact: true }).waitFor()
  const read = () => app.evaluate(() => globalThis.fixture.read())
  const website = app
    .context()
    .pages()
    .find((page) => page.url().startsWith('data:text/html,'))
  assert.equal((await read()).owner, true, 'Native owner lookup must preserve IPC routing')
  if (process.platform === 'linux') {
    const id = String(
      await app.evaluate(() => globalThis.fixture.host.getNativeWindowHandle().readUInt32LE()),
    )
    execFileSync('xdotool', ['windowactivate', '--sync', id])
    await app.evaluate(() => {
      const contents = globalThis.fixture.pageContents
      contents.focus()
      return contents.executeJavaScript(
        'document.querySelector("input").focus();document.querySelector("input").setSelectionRange(3,3)',
      )
    })
    const created = app.waitForEvent('window', {
      predicate: (page) => page.url() === 'about:blank',
      timeout: 5000,
    })
    await ui.evaluate(() => window.setTooltip(true))
    const tip = await created
    await tip.getByRole('tooltip').waitFor()
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error('Tooltip native window did not show')),
            5000,
          )
          const window = BrowserWindow.getAllWindows().find(
            (window) => window !== globalThis.fixture.host,
          )
          const finish = () => {
            clearTimeout(timeout)
            resolve()
          }
          if (window.isVisible()) finish()
          else window.once('show', finish)
        }),
    )
    assert.equal(
      await tip.evaluate(() => document.head.querySelectorAll('style').length),
      (await ui.evaluate(() => document.head.querySelectorAll('style').length)) + 1,
      'Tooltip styles must survive the native about:blank commit',
    )
    assert.equal(
      await tip
        .getByRole('tooltip')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgb(20, 25, 30)',
      'External tooltip styles must load before the native layer shows',
    )
    assert.equal(
      await app.evaluate(() => globalThis.fixture.pageContents.isFocused()),
      true,
      'A passive tooltip keeps native page focus',
    )
    assert.equal(
      await app.evaluate(() =>
        globalThis.fixture.pageContents.executeJavaScript(
          'document.querySelector("input").selectionStart',
        ),
      ),
      3,
      'A tooltip keeps the page text cursor',
    )
    execFileSync('xdotool', ['type', '--clearmodifiers', 'X'])
    await website.waitForFunction(
      () => document.querySelector('input').value === 'unsXaved draft',
      null,
      { timeout: 10000 },
    )

    execFileSync('xdotool', ['mousemove', '--window', id, '150', '95', 'click', '1'])
    assert.deepEqual(
      await app.evaluate(() => globalThis.fixture.pageContents.executeJavaScript('presses')),
      ['pointerdown', 'pointerup'],
      'A passive tooltip must not consume the browser press',
    )
    await ui.evaluate(() => window.setTooltip(false))
    execFileSync('xdotool', ['mousemove', '--window', id, '150', '95', 'mousedown', '1'])
    await ui.evaluate(() => window.setTooltip(true))
    await tip.getByRole('tooltip').waitFor()
    execFileSync('xdotool', ['mousemove', '--window', id, '280', '95', 'mouseup', '1'])
    await website.waitForFunction(() => presses.filter((type) => type === 'pointerup').length === 2)
    assert.equal(
      await website.evaluate(
        () =>
          document.querySelector('input').selectionEnd >
          document.querySelector('input').selectionStart,
      ),
      true,
      'A tooltip must not break a held text-selection drag',
    )
    execFileSync('xdotool', ['mousemove', '--window', id, '350', '300', 'click', '5'])
    await website.waitForFunction(() => wheels > 0 && scrollY > 0)
    execFileSync('xdotool', ['key', 'Escape'])
    await tip.getByRole('tooltip').waitFor({ state: 'hidden' })
    await app.evaluate(() => globalThis.fixture.ui.setZoomFactor(1.25))
    await ui.evaluate(() => window.setTooltip(true))
    await tip.getByRole('tooltip').waitFor()
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window !== globalThis.fixture.host)
          .webContents.getZoomFactor(),
      ),
      1.25,
      'Native tooltip coordinates follow Studio zoom',
    )
    await tip.evaluate(() => (window.originalStyles = [...document.head.children]))
    await ui.evaluate(() => {
      document.title = 'Updated Studio title'
    })
    await ui.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    assert.equal(
      await tip.evaluate(() =>
        window.originalStyles.every((node, index) => node === document.head.children[index]),
      ),
      true,
      'Title changes must not rebuild tooltip styles',
    )
    await ui.evaluate(() => window.setTooltip(false))
    const oldTooltipClosed = tip.waitForEvent('close')
    await ui.reload()
    await oldTooltipClosed
    await ui.getByText('Options', { exact: true }).waitFor()
    const recreated = app.waitForEvent('window', {
      predicate: (page) => page.url() === 'about:blank',
    })
    await ui.evaluate(() => window.setTooltip(true))
    const newTooltip = await recreated
    await newTooltip.getByRole('tooltip').waitFor()
    await app.evaluate(() => globalThis.fixture.ui.focus())
    execFileSync('xdotool', ['key', 'Escape'])
    await newTooltip.getByRole('tooltip').waitFor({ state: 'hidden' })
    await app.evaluate(() => globalThis.fixture.ui.setZoomFactor(1))
  }
  await ui.getByText('Options', { exact: true }).click()
  await ui.getByRole('menu').waitFor()
  assert.equal((await read()).top, 'ui')
  assert.equal((await read()).visible, true)
  assert.equal(
    await app.evaluate(() =>
      globalThis.fixture.page.webContents.executeJavaScript('document.visibilityState'),
    ),
    'visible',
  )
  assert.equal(
    await app.evaluate(() =>
      globalThis.fixture.page.webContents.executeJavaScript(
        'document.querySelector("input").value',
      ),
    ),
    process.platform === 'linux' ? 'unsXaved draft' : 'unsaved draft',
  )
  const ticks = await app.evaluate(() =>
    globalThis.fixture.page.webContents.executeJavaScript('ticks'),
  )
  await ui.getByRole('menuitem', { name: 'Count', exact: true }).click()
  await ui.waitForFunction(() => document.querySelector('output').textContent === '1')
  assert.equal((await read()).top, 'page')
  assert.equal(
    (await app.evaluate(() => globalThis.fixture.page.webContents.executeJavaScript('ticks'))) >
      ticks,
    true,
    'Live page must keep running under the menu',
  )
  await ui.getByText('Options', { exact: true }).click()
  await ui.getByRole('menu').waitFor()
  await ui.keyboard.press('Escape')
  await ui.getByRole('menu').waitFor({ state: 'hidden' })
  await ui.waitForFunction(() => document.activeElement.id === 'menu')
  await ui.getByText('Options', { exact: true }).click()
  await ui.getByRole('menu').waitFor()
  await ui.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  if (process.platform === 'linux') {
    const id = await app.evaluate(() =>
      globalThis.fixture.host.getNativeWindowHandle().readUInt32LE(),
    )
    execFileSync('xdotool', ['mousemove', '--window', String(id), '50', '300', 'click', '1'])
  } else await ui.mouse.click(50, 300)
  await ui.getByRole('menu').waitFor({ state: 'hidden' })
  await app.evaluate(() => globalThis.fixture.raise())
  await ui.getByText('Dialog', { exact: true }).click()
  await ui.getByRole('dialog').waitFor()
  await ui.getByRole('textbox', { name: 'Dialog input' }).fill('dialog draft')
  await ui.keyboard.press('Escape')
  await ui.getByRole('dialog').waitFor({ state: 'hidden' })
  await app.evaluate(() => globalThis.fixture.host.setSize(850, 600))
  assert.equal((await read()).bounds.width, 850)
  assert.equal((await read()).bounds.height, 600)
  if (process.platform === 'linux') {
    await app.evaluate(() => {
      const { host, ui } = globalThis.fixture
      ui.focus()
      globalThis.menuTarget = new Promise((resolve) => {
        const timer = setTimeout(() => resolve('none'), 3000)
        ui.once('devtools-opened', () => {
          clearTimeout(timer)
          resolve('ui')
        })
        host.webContents.once('devtools-opened', () => {
          clearTimeout(timer)
          resolve('shell')
        })
      })
    })
    execFileSync('xdotool', ['key', 'ctrl+shift+i'])
    assert.equal(
      await app.evaluate(() => globalThis.menuTarget),
      'ui',
      'The standard View menu must target Studio, not the empty window shell',
    )
    await app.evaluate(() => {
      globalThis.fixture.ui.closeDevTools()
      globalThis.fixture.ui.focus()
    })
    execFileSync('xdotool', ['key', 'ctrl+plus'])
    assert(
      (await app.evaluate(() => globalThis.fixture.ui.getZoomFactor())) > 1,
      'Standard menu zoom must target the Studio view',
    )
    execFileSync('xdotool', ['key', 'ctrl+0'])
    assert.equal(await app.evaluate(() => globalThis.fixture.ui.getZoomFactor()), 1)
    const reloaded = ui.waitForEvent('load')
    execFileSync('xdotool', ['key', 'ctrl+r'])
    await reloaded
    await ui.getByText('Options', { exact: true }).waitFor()
    assert.equal(
      await website.locator('input').inputValue(),
      'unsXaved draft',
      'Reloading Studio controls must not replace the native page in this fixture',
    )
  }
  await ui.evaluate(() =>
    window.addEventListener('beforeunload', (event) => {
      event.preventDefault()
      event.returnValue = ''
    }),
  )
  await app.evaluate(() => globalThis.fixture.host.close())
  await ui.waitForFunction(() => true)
  assert.equal(await app.evaluate(() => globalThis.promptCount), 1)
  assert.equal(
    await app.evaluate(() => globalThis.fixture.host.isDestroyed()),
    false,
    'Keep editing must veto the native close',
  )
  await app.evaluate(() => {
    globalThis.promptAnswer = 1
  })
  const closed = ui.waitForEvent('close')
  const websiteClosed = website.waitForEvent('close')
  await app.evaluate(() => globalThis.fixture.host.close())
  await closed
  await websiteClosed
  assert.equal(
    await app.evaluate(() => globalThis.fixture.pageContents.isDestroyed()),
    true,
    'Closing Studio must release website contents',
  )
  assert.deepEqual(await app.evaluate(() => globalThis.nativeErrors), [])
  assert.deepEqual(rendererErrors, [])
  console.log(
    'Native live overlays passed: sibling view order, IPC owner, visible live page, draft retention, menu click, Escape, outside dismissal, dialog input, resize and close cleanup. Passive tooltip keeps text cursor, typing, clicks, held selection drag and wheel input; styles, zoom and reload pass; Keep editing/Discard honor unsaved changes. No overlay capture or frame stream.',
  )
} catch (error) {
  if (app)
    console.error(
      'Native fixture state',
      await app
        .evaluate(async ({ BrowserWindow, webContents }) => ({
          focused: webContents.getFocusedWebContents()?.id,
          page: globalThis.fixture?.pageContents.id,
          windows: BrowserWindow.getAllWindows().map((window) => ({
            id: window.id,
            visible: window.isVisible(),
            focused: window.isFocused(),
            focusable: window.isFocusable(),
          })),
          input: await globalThis.fixture?.pageContents.executeJavaScript(
            '({value:document.querySelector("input").value,focus:document.hasFocus(),active:document.activeElement.tagName})',
          ),
        }))
        .catch((error) => String(error)),
    )
  console.error(error)
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await app.close()
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
}
