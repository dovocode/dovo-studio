import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = new URL('../', import.meta.url).pathname
const require = createRequire(root + 'apps/desktop/package.json')
const directory = await mkdtemp(join(tmpdir(), 'dovo-video-pip-'))
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<button id="open">Open PiP</button><video id="video" autoplay muted></video><script>
const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
window.draw=setInterval(()=>{canvas.getContext('2d').fillStyle='green';canvas.getContext('2d').fillRect(0,0,320,180)},50);
const stream=canvas.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
recorder.ondataavailable=event=>chunks.push(event.data);
recorder.onstop=()=>{video.loop=true;video.src=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));stream.getTracks().forEach(track=>track.stop())};
recorder.start();setTimeout(()=>recorder.stop(),800);
document.getElementById('open').onclick=()=>{window.lastRequest='requested';video.requestPictureInPicture().then(()=>window.lastRequest='opened',error=>window.lastRequest=error.message)};
</script>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let app
try {
  const entry = join(directory, 'main.cjs')
  await build({
    stdin: {
      resolveDir: root + 'apps/desktop',
      loader: 'ts',
      contents: `import {app,BrowserWindow} from 'electron';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {installVideoPipTracking} from './electron/browser-video-pip';
import {createBrowserVisibility} from './electron/browser-visibility';
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{
 const preload=join(${JSON.stringify(directory)},'preload.cjs');
 writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.executeInMainWorld({func:"+installVideoPipTracking.toString()+",args:[active=>ipcRenderer.send('pip-state',active),()=>ipcRenderer.send('pip-return')]})");
 const window=new BrowserWindow({width:800,height:600,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,preload}});
 globalThis.owner=window;globalThis.returns=0;globalThis.active=false;
 globalThis.visible=true;const visibility=createBrowserVisibility(contents=>contents===window.webContents?globalThis.visible:undefined);visibility.attachSession(window.webContents.session);globalThis.setVisible=value=>{globalThis.visible=value;visibility.report(window.webContents)};
 window.webContents.ipc.on('pip-state',(_event,active)=>globalThis.active=active);
 window.webContents.ipc.on('pip-return',()=>{globalThis.returns++;window.show();window.focus();globalThis.setVisible(true)});
 await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.address().port}`)});
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
    args: ['--no-sandbox', entry],
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const open = async () => {
    await app.evaluate(() => {
      globalThis.owner.show()
      globalThis.setVisible(true)
    })
    await page.getByRole('button', { name: 'Open PiP' }).click()
    await page
      .waitForFunction(() => !!document.pictureInPictureElement)
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            request: window.lastRequest,
            paused: document.querySelector('video').paused,
            ready: document.querySelector('video').readyState,
            hidden: document.hidden,
          })),
        )
        throw error
      })
    await app.evaluate(() => {
      globalThis.owner.hide()
      globalThis.setVisible(false)
    })
    await page.waitForFunction(() => document.hidden)
  }
  await open()
  await page.evaluate(() => document.exitPictureInPicture())
  assert.equal(
    await app.evaluate(() => globalThis.returns),
    0,
    'Programmatic exits do not steal tab focus',
  )
  await open()
  await page.evaluate(async () => {
    const other = document.querySelector('video').cloneNode()
    other.src = document.querySelector('video').src
    document.body.append(other)
    await other.play()
    await other.requestPictureInPicture()
  })
  assert.equal(
    await app.evaluate(() => globalThis.returns),
    0,
    'Replacing a PiP video does not return to the old source',
  )
  await page.evaluate(() => document.exitPictureInPicture())
  if (process.argv.includes('--native-controls')) {
    assert.equal(process.platform, 'linux', 'Native button driving uses X11')
    const clickControl = async (right) => {
      const id = execFileSync('xdotool', ['search', '--name', '^Picture in picture$'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .at(-1)
      const geometry = execFileSync('xdotool', ['getwindowgeometry', '--shell', id], {
        encoding: 'utf8',
      })
      const fields = Object.fromEntries(
        geometry
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      )
      const x = Number(fields.X) + Number(fields.WIDTH) - right,
        y = Number(fields.Y) + 18
      execFileSync('xdotool', ['mousemove', String(x), String(y)])
      // Native controls appear on hover; wait for a painted frame before clicking.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
      execFileSync('xdotool', ['click', '1'])
      await page.waitForFunction(() => !document.pictureInPictureElement)
    }
    await app.evaluate(() => {
      globalThis.owner.show()
      globalThis.setVisible(true)
    })
    await page.reload()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
    await open()
    await clickControl(16)
    await page.waitForFunction(() => document.querySelector('video').paused)
    assert.equal(
      await app.evaluate(() => globalThis.returns),
      0,
      'Native X closes without selecting the source tab',
    )
    await app.evaluate(() => {
      globalThis.owner.show()
      globalThis.setVisible(true)
    })
    await page.evaluate(() => document.querySelector('video').play())
    await open()
    await clickControl(40)
    await page.waitForFunction(() => !document.hidden)
    assert.equal(
      await app.evaluate(() => globalThis.returns),
      1,
      'Native Return restores its source',
    )
  }
  console.log(
    'Native video PiP: API exits and video replacement preserve focus; native X and Return checked when --native-controls is enabled.',
  )
} finally {
  if (app) {
    const kill = setTimeout(() => app.process().kill('SIGKILL'), 5000)
    try {
      await app.close()
    } finally {
      clearTimeout(kill)
    }
  }
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
