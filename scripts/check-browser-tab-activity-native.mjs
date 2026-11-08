import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = new URL('../', import.meta.url).pathname
const require = createRequire(root + 'apps/desktop/package.json')
const directory = await mkdtemp(join(tmpdir(), 'dovo-tab-activity-'))
const entry = join(directory, 'main.cjs')
const server = createServer((_request, response) =>
  response.end(
    '<!doctype html><title>(3) Teams</title><button id="share">Share</button><script>share.onclick=async()=>{window.display=await navigator.mediaDevices.getDisplayMedia({video:true})}</script>',
  ),
)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let app
try {
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root + 'apps/desktop',
      contents: `
import {app,BrowserWindow,ipcMain} from 'electron';
import {writeFileSync} from 'node:fs';
import {BROWSER_TAB_ACTIVITY_PRELOAD,createBrowserTabActivity} from './electron/browser-tab-activity';
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{
  const preload=${JSON.stringify(join(directory, 'activity.cjs'))};
  writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('activityFixture',{read:()=>ipcRenderer.invoke('fixture:read')});"+BROWSER_TAB_ACTIVITY_PRELOAD);
  const owner=new BrowserWindow({webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const read=createBrowserTabActivity(owner.webContents);
  ipcMain.handle('fixture:read',()=>read());
  owner.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(true));
  owner.webContents.session.setPermissionCheckHandler(()=>true);
  owner.webContents.session.setDisplayMediaRequestHandler((_request,callback)=>callback({video:owner.webContents.mainFrame}));
  await owner.loadURL(${JSON.stringify(`http://127.0.0.1:${server.address().port}`)});
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
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', entry],
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const state = () => page.evaluate(() => activityFixture.read())
  const devices = async (expected) => {
    await page.waitForFunction(
      async (expected) => {
        const state = await activityFixture.read()
        return Object.entries(expected).every(([key, value]) => state[key] === value)
      },
      expected,
      { timeout: 10000, polling: 100 },
    )
  }
  await page.waitForFunction(() => !!window.activityFixture)
  assert.equal((await state()).badge, 3)
  await page.evaluate(() => navigator.setAppBadge(7))
  await devices({ badge: 7 })
  await page.evaluate(() => navigator.setAppBadge())
  await devices({ badge: 'unread' })
  await page.evaluate(() => {
    document.title = 'Teams'
    return navigator.clearAppBadge()
  })
  await devices({ badge: undefined })
  await page.evaluate(async () => {
    window.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  })
  await devices({ camera: true, microphone: true, screenSharing: false })
  await page.evaluate(() => (stream.getVideoTracks()[0].enabled = false))
  await devices({ camera: false, microphone: true })
  await page.evaluate(() => {
    const track = stream.getVideoTracks()[0]
    track.enabled = true
    window.clone = track.clone()
    track.stop()
  })
  await devices({ camera: true, microphone: true })
  await page.evaluate(() => {
    clone.stop()
    stream.getTracks().forEach((track) => track.stop())
  })
  await devices({ camera: false, microphone: false })
  await page.click('#share')
  await devices({ camera: false, microphone: false, screenSharing: true })
  await page.waitForFunction(() => !!window.display)
  await page.evaluate(() => display.getTracks().forEach((track) => track.stop()))
  await devices({ screenSharing: false })
  await page.reload()
  await devices({ camera: false, microphone: false, screenSharing: false, badge: 3 })
  assert.deepEqual(errors, [])
  console.log(
    'Native tab activity passed: title counts, app badges, unread dots, real camera/microphone tracks, disabled/ended/cloned tracks, screen sharing and navigation reset.',
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
