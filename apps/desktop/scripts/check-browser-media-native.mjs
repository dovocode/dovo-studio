#!/usr/bin/env node
/**
 * Real Electron smoke for shared-browser tab sharing with audio, and camera/microphone review.
 *
 * Builds a harness around the production `registerBrowser` and drives it through the same IPC a
 * trusted Studio window uses (`preview:browser`). Pages call the real `getDisplayMedia` and
 * `getUserMedia`; nothing is auto-picked. The shared tab plays a synthetic AudioContext tone and
 * animates a canvas, so no audio hardware is needed. Camera and microphone use Chromium's fake
 * devices. Checks: gesture and thread-preview refusal, explicit sources across profiles, real video
 * frames and tab audio in the capturing page, Stop ending the real tracks with `ended`, cancel,
 * and camera/microphone allow, remember and deny.
 *
 * Usage: node apps/desktop/scripts/check-browser-media-native.mjs [--keep] [--youtube]
 * The optional live YouTube check needs Linux/X11 and xdotool to select the native video menu.
 * Linux needs a display with a window manager (for example, Xvfb with Openbox) so Chromium can
 * discover shareable windows. Xvfb alone has no managed window sources. The sandbox must be available.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const keep = process.argv.includes('--keep')
const youtube = process.argv.includes('--youtube')
const work = mkdtempSync(join(tmpdir(), 'dovo-browser-media-native-'))
// Keep native image dependencies in their installed packages rather than bundling their loaders.
symlinkSync(join(desktop, 'node_modules'), join(work, 'node_modules'), 'junction')
const write = (path, contents) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

write(
  join(work, 'studio', 'index.html'),
  `<!doctype html><title>Studio</title><script>
if (location.hash.startsWith('#thread-share=')) {
  const settings = window.bridge.settingsRead()
  if (settings.error) throw new Error(settings.error)
  document.addEventListener('DOMContentLoaded',()=>{
    document.body.style.background='rgb(230,40,120)'
    document.body.dataset.threadShareReady=''
  })
}
</script>`,
)
write(
  join(work, 'studio', 'preload.js'),
  `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridge', {
  browser: (command) => ipcRenderer.invoke('preview:browser', command),
  settingsRead: () => ipcRenderer.sendSync('app:settings-read'),
  settingsWritten: () => ipcRenderer.send('app:settings-write', '{}'),
})
`,
)
const connectionModule = join(desktop, 'electron', 'connection-storage.ts')
const browserModule = join(desktop, 'electron', 'browser.ts')
write(
  join(work, 'harness', 'main.ts'),
  `import assert from 'node:assert/strict'
import { app, BrowserWindow, session, webContents, nativeImage } from 'electron'
import { createServer } from 'node:http'
import { WebSocketServer } from ${JSON.stringify(require.resolve('ws'))}
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { registerBrowser } from ${JSON.stringify(browserModule)}
import { registerConnectionStorage } from ${JSON.stringify(connectionModule)}

const work = process.env.SMOKE_DIR!
app.setPath('userData', join(work, 'user-data'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const report: Record<string, unknown> = {}
const stage = (name: string) => {report.stage=name;writeFileSync(join(work,'result.json'),JSON.stringify(report));console.log('[media-stage]',name)}
const pages: Record<string, string> = {
  '/source': \`<!doctype html><title>Tone source</title><canvas id=c width=320 height=180></canvas><script>
    const context = new AudioContext()
    const tone = context.createOscillator()
    tone.frequency.value = 440
    tone.connect(context.destination)
    tone.start()
    window.audioState = () => context.state
    const canvas = document.getElementById('c').getContext('2d')
    let hue = 0
    setInterval(() => { hue = (hue + 37) % 360; canvas.fillStyle = 'hsl(' + hue + ',90%,50%)'; canvas.fillRect(0, 0, 320, 180) }, 50)
  </script>\`,
  '/requester': \`<!doctype html><title>Call</title><form><input id=note></form><script>
    window.marker = Math.random()
    window.share = async (options) => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia(options)
        window.stream = stream
        window.endedEvents = 0
        for (const track of stream.getTracks()) track.addEventListener('ended', () => window.endedEvents++)
        return { ok: true, kinds: stream.getTracks().map((track) => track.kind).sort() }
      } catch (error) { return { ok: false, name: error.name } }
    }
    window.devices = async (constraints) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const kinds = stream.getTracks().map((track) => track.kind).sort()
        stream.getTracks().forEach((track) => track.stop())
        return { ok: true, kinds }
      } catch (error) { return { ok: false, name: error.name } }
    }
    window.trackStates = () => window.stream.getTracks().map((track) => track.readyState)
    window.audioLevel = async () => {
      const context = new AudioContext()
      const source = context.createMediaStreamSource(new MediaStream(window.stream.getAudioTracks()))
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      let peak = 0
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        analyser.getFloatTimeDomainData(samples)
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      }
      await context.close()
      return peak
    }
    window.videoFrame = async () => {
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = new MediaStream(window.stream.getVideoTracks())
      await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Shared video never produced a frame.')),15000))])
      await new Promise((resolve) => setTimeout(resolve, 500))
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      context.drawImage(video, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let colored = 0
      let vibrant = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) colored++
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) vibrant++
      }
      return { width: video.videoWidth, height: video.videoHeight, colored, vibrant }
    }
  </script>\`,
  '/custom': '<!doctype html><title>Custom</title><p>Original</p>',
  '/plain': '<!doctype html><title>Other profile</title>',
}
let remoteImage = Buffer.alloc(0)
let remoteOpens = 0
let remoteConnections = 0
const server = createServer(async (request, response) => {
  if (request.url === '/api/previews/browser/open') {
    assert.equal(request.headers.authorization, 'Bearer remote-test-device-token-at-least-32-characters')
    const parts = []
    for await (const part of request) parts.push(part)
    const body = JSON.parse(Buffer.concat(parts).toString())
    assert.equal(body.taskId, 'studio:browser')
    assert.equal(body.tabId, 'remote-source')
    remoteOpens++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ticket: 'remote-test-ticket', host: 'fixture', tabId: body.tabId, profileId: body.profileId }))
    return
  }
  if(request.url==='/custom')response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'")
  response.setHeader('content-type', 'text/html')
  response.end(pages[request.url ?? ''] ?? 'missing')
}).listen(0, '127.0.0.1')
const websocket = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  assert.equal(new URL(request.url!, 'http://fixture').searchParams.get('ticket'), 'remote-test-ticket')
  websocket.handleUpgrade(request, socket, head, (client) => {
    remoteConnections++
    const packet = Buffer.alloc(12 + remoteImage.length)
    packet.writeUInt32BE(1, 0); packet.writeUInt32BE(1200, 4); packet.writeUInt32BE(732, 8)
    remoteImage.copy(packet, 12)
    client.send(JSON.stringify({ type:'state', url:'http://remote.example', title:'Remote', back:false, forward:false, loading:false, editable:false }))
    client.send(packet)
    client.on('close', () => remoteConnections--)
  })
})

if (process.env.SMOKE_DEBUG) app.on('web-contents-created',(_event, contents)=>{contents.on('console-message',(_event,level,message)=>console.log('[page]',level,message))})
app.whenReady().then(async () => {
  try {
    if (process.env.SMOKE_DEBUG) {
      // Print what Chromium passes Dovo's handlers, to diagnose a failing run.
      const prototype = Object.getPrototypeOf(session.defaultSession)
      for (const name of ['setDisplayMediaRequestHandler', 'setPermissionRequestHandler', 'setPermissionCheckHandler']) {
        const original = prototype[name]
        prototype[name] = function (handler: any, ...rest: unknown[]) {
          return original.call(this, handler && ((...args: unknown[]) => {
            const shown = args.filter((arg) => typeof arg !== 'function' && !(arg as any)?.getURL)
            console.log('[media-debug]', name, JSON.stringify(shown, (_key, value) => value?.routingId !== undefined ? { url: value.url, parent: value.parent === null ? null : 'frame' } : value))
            const result = handler(...args.map((arg) => typeof arg === 'function' ? (...answer: unknown[]) => { console.log('[media-debug]', name, 'answered', JSON.stringify(answer, (_key, value) => value?.routingId !== undefined ? 'frame' : value)); return (arg as (...a: unknown[]) => unknown)(...answer) } : arg))
            if (name === 'setPermissionCheckHandler') console.log('[media-debug] check returned', result)
            return result
          }), ...rest)
        }
      }
    }
    const index = join(work, 'studio', 'index.html')
    registerConnectionStorage(index)
    const bridge = registerBrowser(index, undefined, join(work, 'studio', 'preload.js'))
    const studio = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: { preload: join(work, 'studio', 'preload.js'), sandbox: true, contextIsolation: true },
    })
    await studio.loadFile(index)
    const call = (command: object) =>
      studio.webContents.executeJavaScript(\`window.bridge.browser(\${JSON.stringify(command)})\`) as Promise<any>
    const port = (server.address() as { port: number }).port
    const url = (path: string) => \`http://127.0.0.1:\${port}\${path}\`
    const bounds = { x: 0, y: 40, width: 1200, height: 760 }
    const show = (key: string, path: string, profileId: string, workspaceBrowser = true) =>
      call({ action: 'show', key, url: url(path), profileId, bounds, ...(workspaceBrowser ? { workspaceBrowser } : {}) })
    // Pick pages by URL and storage partition; creation order is not guaranteed.
    const page = (path: string, partition: string) =>
      webContents
        .getAllWebContents()
        .find((item) => item.getURL() === url(path) && item.session === session.fromPartition(partition))!
    const WORK = 'persist:dovo-browser-workspace:work'
    const run = (path: string, code: string, gesture = true, partition = WORK) =>
      page(path, partition).executeJavaScript(code, gesture) as Promise<any>
    const requests = async (count: number) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const status = await call({ action: 'status', key: 'studio:browser:requester' })
        if ((status?.mediaRequests?.length ?? 0) === count) return status?.mediaRequests ?? []
        await wait(100)
      }
      throw new Error(\`Expected \${count} media request(s).\`)
    }
    // Electron reports a refused getDisplayMedia (callback(null)) as AbortError.
    const refused = (result: { ok: boolean; name?: string }, message: string) =>
      assert.ok(!result.ok && ['NotAllowedError', 'AbortError'].includes(result.name ?? ''), \`\${message} \${JSON.stringify(result)}\`)
    const captures = async (predicate: (list: any[]) => boolean) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = await call({ action: 'status', key: 'studio:browser:requester' })
        const list = status?.captures ?? []
        if (predicate(list)) return list
        await wait(100)
      }
      throw new Error('Capture state never reached the expected value.')
    }

    if (process.env.YOUTUBE_SMOKE) {
      stage('youtube-load')
      const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      await call({action:'show',key:'youtube',url:youtubeUrl,profileId:'work',workspaceBrowser:true,bounds})
      const youtubePage = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://www.youtube.com/watch'))
      assert.ok(youtubePage, 'YouTube did not load in the browser view')
      await wait(8000)
      report.consent = await youtubePage.executeJavaScript('Array.from(document.querySelectorAll("ytd-consent-bump-v2-lightbox button")).map(e=>({text:e.innerText,aria:e.getAttribute("aria-label")}))')
      const point = async (selector: string) => youtubePage.executeJavaScript('(e => {if (!e) return null; const r=e.getBoundingClientRect();return r.width>0 && r.height>0 ? {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} : null})(document.querySelector(' + JSON.stringify(selector) + '))')
      const click = (position: {x:number,y:number}, button: 'left' | 'right' = 'left') => {
        youtubePage.sendInputEvent({type:'mouseMove',...position})
        youtubePage.sendInputEvent({type:'mouseDown',...position,button,clickCount:1})
        youtubePage.sendInputEvent({type:'mouseUp',...position,button,clickCount:1})
      }
      youtubePage.focus()
      const rejectSelector = 'ytd-consent-bump-v2-lightbox button[aria-label^="Reject"]'
      await youtubePage.executeJavaScript('document.querySelector(' + JSON.stringify(rejectSelector) + ')?.scrollIntoView({block:"center"})')
      await wait(200)
      const rejectCookies = await point(rejectSelector)
      if (rejectCookies) {
        assert.equal(await youtubePage.executeJavaScript('(()=>{const e=document.querySelector(' + JSON.stringify(rejectSelector) + '),hit=document.elementFromPoint(' + rejectCookies.x + ',' + rejectCookies.y + ');return !!e && !!hit && (hit===e || e.contains(hit))})()'),true,'The cookie choice must be visible before clicking')
        click(rejectCookies)
        await wait(3000)
      }
      const videoState = () => youtubePage.executeJavaScript('(()=>{const v=document.querySelector("video"),c=document.querySelector("ytd-consent-bump-v2-lightbox .body");return {paused:v?.paused,muted:v?.muted,time:v?.currentTime,ready:v?.readyState,mediaError:v?.error?.message,pageError:document.querySelector(".ytp-error-content-wrap")?.innerText,consentVisible:!!c && c.getBoundingClientRect().width>0 && getComputedStyle(c).visibility!=="hidden"}})()')
      const failureScreenshot = async () => {
        try {
          writeFileSync(join(work, 'youtube-failure.png'), (await youtubePage.capturePage()).toPNG())
          report.screenshot = join(work, 'youtube-failure.png')
        } catch (error) { report.screenshotError = String(error) }
      }
      const beforeMute = await videoState()
      const mute = await point('.ytp-mute-button')
      if (mute && !(await youtubePage.executeJavaScript('document.querySelector("video")?.muted'))) click(mute)
      await wait(1000)
      const afterMute = await videoState()
      const play = await point('.ytp-play-button')
      const clickedPlay = !!play && afterMute.paused === true
      if (clickedPlay) click(play)
      await wait(5000)
      const initial = await videoState()
      const playbackOk = initial.paused === false && initial.time > afterMute.time + 1
      report.playback = {ok:playbackOk,beforeMute,afterMute,clickedPlay,afterPlay:initial}
      let fullscreenOk = false
      try {
        const videoPoint = await youtubePage.executeJavaScript('(()=>{const v=document.querySelector("video");if(!v)return null;const r=v.getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2),width:r.width,height:r.height}})()')
        assert.ok(videoPoint && videoPoint.width > 0 && videoPoint.height > 0, 'YouTube video unavailable for control hover')
        youtubePage.sendInputEvent({type:'mouseMove',x:videoPoint.x,y:videoPoint.y})
        await wait(500)
        const fullscreenButton = await youtubePage.executeJavaScript('(()=>{const e=document.querySelector(".ytp-fullscreen-button");if(!e)return null;const r=e.getBoundingClientRect(),x=Math.floor(r.left+r.width/2),y=Math.floor(r.top+r.height/2),hit=document.elementFromPoint(x,y),style=getComputedStyle(e);return {x,y,width:r.width,height:r.height,visible:style.visibility,display:style.display,hit:hit?.outerHTML.slice(0,300),target:!!hit&&(hit===e||e.contains(hit)),inViewport:x>=0&&y>=0&&x<innerWidth&&y<innerHeight}})()')
        report.fullscreenTarget = fullscreenButton
        assert.ok(fullscreenButton && fullscreenButton.width > 0 && fullscreenButton.height > 0 && fullscreenButton.inViewport && fullscreenButton.target && fullscreenButton.visible === 'visible' && fullscreenButton.display !== 'none', 'YouTube fullscreen control is hidden, offscreen or obstructed')
        click({x:fullscreenButton.x,y:fullscreenButton.y})
        await wait(1000)
        assert.equal(await youtubePage.executeJavaScript('!!document.fullscreenElement'), true, 'YouTube fullscreen control')
        assert.equal(studio.isFullScreen(), true)
        youtubePage.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        youtubePage.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await wait(1000)
        assert.equal(await youtubePage.executeJavaScript('!!document.fullscreenElement'), false)
        fullscreenOk = true
        report.fullscreen = {ok:true}
      } catch (error) {
        report.fullscreen = {ok:false,error:String(error)}
        await failureScreenshot()
        youtubePage.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        youtubePage.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await wait(500)
      }
      if ((!playbackOk || !fullscreenOk) && !report.screenshot) await failureScreenshot()
      let pipOk = false
      let backgroundOk = false
      try {
        const videoPoint = await point('video')
        assert.ok(videoPoint, 'YouTube video unavailable')
        let context: unknown
        youtubePage.on('context-menu', (_event, params) => { context = {mediaType:params.mediaType,flags:params.mediaFlags, x:params.x,y:params.y} })
        click(videoPoint, 'right')
        await wait(500)
        click(videoPoint, 'right')
        await wait(500)
        report.context = context ?? null
        assert.ok(context, 'YouTube did not open the native video menu')
        execFileSync('xdotool', ['key', 'Home', 'Return'])
        await wait(1200)
        pipOk = await youtubePage.executeJavaScript('!!document.pictureInPictureElement')
        assert.equal(pipOk, true, 'The native menu opens video PiP')
        const before = await videoState()
        await call({action:'hide',key:'youtube'})
        await wait(2500)
        const after = await videoState()
        backgroundOk = after.time > before.time + 1
        const active = await youtubePage.executeJavaScript('!!document.pictureInPictureElement')
        pipOk = pipOk && active
        report.pip = {ok:pipOk,before,after,backgroundPlayback:backgroundOk,active}
      } catch (error) {
        report.pip = {ok:false,error:String(error)}
        await failureScreenshot()
      }
      report.youtube = await youtubePage.executeJavaScript('({url:location.href,title:document.title})')
      report.ok = playbackOk && fullscreenOk && pipOk && backgroundOk
      if (!report.ok) {
        report.page = await videoState()
        if (!report.screenshot) await failureScreenshot()
      }
      writeFileSync(join(work, 'result.json'), JSON.stringify(report, null, 2))
      await bridge.dispose()
      app.exit(report.ok ? 0 : 1)
      return
    }

    stage('website-customization')
    const website = {origin:new URL(url('')).origin, enabled:true, css:'p { color: rgb(123, 45, 67); }', script:'document.querySelector("p").textContent = "Customized";'}
    const settings = (websites: object[]) => writeFileSync(process.env.DOVO_SETTINGS_PATH!, JSON.stringify({app:{browserWorkspaceEnabled:true,browserProfiles:[{id:'default',name:'Default'},{id:'work',name:'Work',websites},{id:'personal',name:'Personal'}]}}))
    settings([website])
    await show('custom-work', '/custom', 'work')
    await show('custom-personal', '/custom', 'personal')
    assert.equal(await run('/custom','document.querySelector("p").textContent',false),'Customized')
    assert.equal(await run('/custom','getComputedStyle(document.querySelector("p")).color',false),'rgb(123, 45, 67)')
    assert.equal(await run('/custom','document.querySelector("p").textContent',false,'persist:dovo-browser-workspace:personal'),'Original')
    settings([])
    const reloaded = new Promise(resolve=>page('/custom',WORK).once('did-finish-load',resolve))
    await call({action:'reload',key:'custom-work'})
    await reloaded
    assert.equal(await run('/custom','document.querySelector("p").textContent',false),'Original')
    await call({action:'close',key:'custom-work'})
    await call({action:'close',key:'custom-personal'})
    report.websiteCustomization='profile-isolated-and-removed'
    stage('gesture')
    await show('thread', '/requester', 'work', false)
    refused(
      await run('/requester', 'window.share({ video: true, audio: true })', true, 'persist:dovo-preview:work'),
      'Thread previews never share.',
    )
    await show('studio:browser:personal', '/plain', 'personal')
    await show('studio:browser:source', '/source', 'work')
    await show('studio:browser:requester', '/requester', 'work')
    refused(
      await run('/requester', 'window.share({ video: true, audio: true })', false),
      'A request without a user gesture must be refused.',
    )
    await requests(0)
    report.threadAndGesture = 'refused'

    stage('tab')
    const sharing = run('/requester', 'window.share({ video: true, audio: true })', true)
    const [request] = await requests(1)
    assert.equal(request.kind, 'display')
    assert.equal(request.origin, url('').replace(/\\/$/, ''))
    assert.equal(request.audio, true)
    assert.deepEqual(
      request.sources.filter((source: { kind: string }) => source.kind === 'tab').map((source: { key: string }) => source.key).sort(),
      ['studio:browser:personal', 'studio:browser:requester', 'studio:browser:source'],
    )
    await assert.rejects(
      call({ action: 'media', key: request.key, requestId: request.id, decision: 'allow', source: 'missing', audio: true }),
      /Choose an available tab/,
    )
    await call({ action: 'media', key: request.key, requestId: request.id, decision: 'allow', source: 'studio:browser:source', audio: true })
    assert.deepEqual(await sharing, { ok: true, kinds: ['audio', 'video'] })
    const [capture] = await captures((list) => list[0]?.state === 'active')
    const source = page('/source', WORK)
    assert.equal(source.isBeingCaptured(), true, 'Chromium must count the shared tab as captured.')
    assert.equal(capture.sourceKey, 'studio:browser:source')
    assert.equal(capture.sourceTitle, 'Tone source')
    assert.equal(capture.sourceUrl, url('/source'))
    assert.equal(capture.audio, true)
    // Calls usually share a background tab. Evict ordinary idle pages without dropping either
    // side of this capture, then return to the call without reloading it.
    const marker = await run('/requester', 'window.marker', false)
    for (let index = 0; index < 7; index++)
      await show('studio:browser:idle-' + index, '/plain', 'work')
    assert.equal(page('/source', WORK), source)
    assert.equal(await run('/requester', 'window.marker', false), marker)
    await show('studio:browser:requester', '/requester', 'work')
    const frame = await run('/requester', 'window.videoFrame()', false)
    assert.ok(frame.width > 0 && frame.height > 0 && frame.vibrant > 1000, JSON.stringify(frame))
    const level = await run('/requester', 'window.audioLevel()', false)
    assert.ok(level > 0.05, \`Tab audio peak was \${level}.\`)
    report.capture = { frame, level }

    stage('fullscreen')
    const fullscreenPage = page('/requester', WORK)
    const fullscreenView = studio.contentView.children.find((child) => child.webContents === fullscreenPage)!
    const originalBounds = fullscreenView.getBounds()
    assert.equal(studio.isFullScreen(), false)
    await run('/requester', 'document.body.insertAdjacentHTML("afterbegin", "<button id=full>Fullscreen</button>");document.querySelector("#full").onclick=()=>document.documentElement.requestFullscreen().catch(error=>window.fullscreenError=error.name);true', false)
    fullscreenPage.focus()
    fullscreenPage.sendInputEvent({type:'mouseDown',x:20,y:15,button:'left',clickCount:1})
    fullscreenPage.sendInputEvent({type:'mouseUp',x:20,y:15,button:'left',clickCount:1})
    await wait(500)
    assert.equal(await run('/requester', 'window.fullscreenError || !!document.fullscreenElement', false), true, 'A real click enters HTML fullscreen')
    assert.equal(studio.isFullScreen(), true, 'The Studio window enters fullscreen')
    const [fullscreenWidth, fullscreenHeight] = studio.getContentSize()
    assert.deepEqual(fullscreenView.getBounds(), { x: 0, y: 0, width: fullscreenWidth, height: fullscreenHeight }, 'The browser fills the fullscreen window')
    const latestBounds = {x: 20, y: 60, width: 900, height: 600}
    await call({action:'show',key:'studio:browser:requester',url:url('/requester'),profileId:'work',workspaceBrowser:true,bounds:latestBounds})
    assert.deepEqual(fullscreenView.getBounds(), { x: 0, y: 0, width: fullscreenWidth, height: fullscreenHeight }, 'Layout updates do not shrink fullscreen')
    fullscreenPage.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    fullscreenPage.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(500)
    assert.equal(await run('/requester', '!!document.fullscreenElement', false), false, 'Escape exits HTML fullscreen')
    assert.equal(studio.isFullScreen(), false, 'Escape restores the Studio window')
    assert.deepEqual(fullscreenView.getBounds(), latestBounds, 'Escape restores the latest browser layout')
    await show('studio:browser:requester', '/requester', 'work')
    assert.deepEqual(fullscreenView.getBounds(), originalBounds)
    studio.setFullScreen(true)
    await wait(500)
    fullscreenPage.focus()
    fullscreenPage.sendInputEvent({type:'mouseDown',x:20,y:15,button:'left',clickCount:1})
    fullscreenPage.sendInputEvent({type:'mouseUp',x:20,y:15,button:'left',clickCount:1})
    await wait(500)
    assert.equal(await run('/requester', '!!document.fullscreenElement', false), true)
    fullscreenPage.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    fullscreenPage.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(500)
    assert.equal(studio.isFullScreen(), true, 'Exiting website fullscreen preserves a pre-existing fullscreen window')
    studio.setFullScreen(false)
    await wait(500)
    fullscreenPage.focus()
    fullscreenPage.sendInputEvent({type:'mouseDown',x:20,y:15,button:'left',clickCount:1})
    fullscreenPage.sendInputEvent({type:'mouseUp',x:20,y:15,button:'left',clickCount:1})
    await wait(500)
    assert.equal(await run('/requester', '!!document.fullscreenElement', false), true)
    await call({action:'hide',key:'studio:browser:requester'})
    await wait(500)
    assert.equal(await run('/requester', '!!document.fullscreenElement', false), false, 'Hiding a tab exits its fullscreen')
    assert.equal(studio.isFullScreen(), false)
    await show('studio:browser:requester', '/requester', 'work')

    stage('fullscreen-lifecycle')
    const lifecycleKey = 'studio:browser:fullscreen-lifecycle'
    await show(lifecycleKey, '/custom', 'work')
    const lifecyclePage = page('/custom', WORK)
    const lifecycleView = studio.contentView.children.find((child) => child.webContents === lifecyclePage)!
    const lifecycleBounds = lifecycleView.getBounds()
    const enterLifecycle = async () => {
      await lifecyclePage.executeJavaScript('document.documentElement.requestFullscreen()', true)
      await wait(500)
      assert.equal(await lifecyclePage.executeJavaScript('!!document.fullscreenElement'), true)
    }
    await enterLifecycle()
    await show('studio:browser:requester', '/requester', 'work')
    await wait(500)
    assert.equal(await lifecyclePage.executeJavaScript('!!document.fullscreenElement'), false, 'Switching tabs exits fullscreen')
    assert.equal(studio.isFullScreen(), false)
    assert.deepEqual(lifecycleView.getBounds(), lifecycleBounds, 'Switching restores the old view bounds')
    await show(lifecycleKey, '/custom', 'work')
    await enterLifecycle()
    await lifecyclePage.loadURL(url('/plain?fullscreen-navigation'))
    await wait(500)
    assert.equal(studio.isFullScreen(), false, 'Navigating exits fullscreen')
    assert.deepEqual(lifecycleView.getBounds(), lifecycleBounds, 'Navigating restores view bounds')
    await enterLifecycle()
    await call({action:'close',key:lifecycleKey})
    await wait(500)
    assert.equal(studio.isFullScreen(), false, 'Closing a fullscreen tab restores the window')
    await show(lifecycleKey, '/custom', 'work')
    const destroyedPage = page('/custom', WORK)
    studio.setFullScreen(true)
    await wait(500)
    await destroyedPage.executeJavaScript('document.documentElement.requestFullscreen()', true)
    await wait(500)
    assert.equal(await destroyedPage.executeJavaScript('!!document.fullscreenElement'), true)
    destroyedPage.close()
    await wait(500)
    assert.equal(studio.isFullScreen(), true, 'Destroying a fullscreen page preserves a previously fullscreen window')
    studio.setFullScreen(false)
    await wait(500)
    await show('studio:browser:requester', '/requester', 'work')
    report.fullscreenLifecycle = 'switch-navigation-close-destroy-preexisting-fullscreen'

    stage('picture-in-picture')
    const pipKey = 'studio:browser:requester'
    assert.equal(await run('/requester', 'typeof documentPictureInPicture', false), 'undefined',
      'Do not advertise the unsupported Document PiP API: websites must choose their fallback.')
    assert.equal(await run('/requester', 'document.pictureInPictureEnabled', false), true)

    await run('/requester', '(async()=>{window.pipVideo=document.createElement("video");pipVideo.muted=true;pipVideo.srcObject=new MediaStream(window.stream.getVideoTracks());document.body.append(pipVideo);await pipVideo.play()})()')
    // A video's own native control must be tracked and survive focusing its tab.
    await run('/requester', 'pipVideo.requestPictureInPicture()')
    for (let attempt=0; attempt<20; attempt++) {
      if ((await call({ action:'media-status',key:'activity' })).callTabs.some(tab=>tab.key===pipKey && tab.pictureInPicture)) break
      await wait(50)
    }
    await call({ action:'focus-tab',key:pipKey })
    assert.equal(await run('/requester', 'document.pictureInPictureElement === window.pipVideo',false),true)
    await run('/requester', 'document.exitPictureInPicture()')
    await run('/requester', 'pipVideo.pause();pipVideo.remove()', false)
    await run('/requester', '(async()=>{window.pipFrame=document.createElement("iframe");document.body.append(pipFrame);const doc=pipFrame.contentDocument;const video=doc.createElement("video");video.muted=true;video.srcObject=new MediaStream(window.stream.getVideoTracks());doc.body.append(video);await video.play()})()')
    await run('/requester', 'pipFrame.contentDocument.querySelector("video").requestPictureInPicture()')
    assert.equal(await run('/requester','!!pipFrame.contentDocument.pictureInPictureElement',false),true,'Embedded video uses native PiP too.')
    await run('/requester', 'pipFrame.contentDocument.exitPictureInPicture()')
    assert.equal(await run('/requester','pipFrame.contentDocument.pictureInPictureElement === null',false),true)
    await run('/requester','pipFrame.contentDocument.querySelector("video").pause();pipFrame.remove()',false)

    // Exercise PiP without an active call/capture protecting the tab on its behalf.
    const standaloneKey = 'studio:browser:native-video'
    await show(standaloneKey, '/plain', 'work')
    const standalone = studio.contentView.children.find((child) => child.getVisible() && child.webContents?.getURL() === url('/plain'))!.webContents
    await standalone.executeJavaScript(\`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const context=canvas.getContext('2d');let hue=0;
      window.pipTimer=setInterval(()=>{context.fillStyle='hsl('+(hue+=20)+',90%,50%)';context.fillRect(0,0,160,90)},30);
      window.nativeVideo=document.createElement('video');nativeVideo.muted=true;nativeVideo.srcObject=canvas.captureStream(30);
      document.body.append(nativeVideo);await nativeVideo.play();
      window.pipFrames=0;const next=()=>{window.pipFrames++;nativeVideo.requestVideoFrameCallback(next)};next();
      await nativeVideo.requestPictureInPicture();
    })()\`, true)
    for(let attempt=0;attempt<20;attempt++) {
      if((await call({action:'tab-activity',key:'activity'})).protectedKeys.includes(standaloneKey)) break
      await wait(50)
    }
    assert.ok((await call({action:'tab-activity',key:'activity'})).protectedKeys.includes(standaloneKey))
    const framesBefore=await standalone.executeJavaScript('pipFrames')
    await call({action:'hide',key:standaloneKey})
    for(let index=0;index<7;index++) await show('studio:browser:pip-idle-'+index, '/plain', 'work')
    assert.equal(standalone.isDestroyed(),false,'Inactive page eviction must preserve native video PiP.')
    assert.equal(standalone.getBackgroundThrottling(),false)
    await wait(250)
    assert.ok(await standalone.executeJavaScript('pipFrames')>framesBefore,'Native PiP video keeps producing frames in the background.')
    assert.equal(await standalone.executeJavaScript('document.pictureInPictureElement===nativeVideo'),true)
    await standalone.executeJavaScript('document.exitPictureInPicture()',true)
    await call({action:'close',key:standaloneKey})
    await show(pipKey, '/requester', 'work')

    report.pictureInPicture = 'website-native-video-api-with-live-call-retention-and-document-fallback'

    stage('keep-awake')
    const beforeAwake = new Set(webContents.getAllWebContents().map(contents => contents.id))
    await call({ action: 'keep-awake', key: 'awake-tab', enabled: true, url: url('/plain'), profileId: 'work' })
    const awake = webContents.getAllWebContents().find(contents => !beforeAwake.has(contents.id) && contents.getURL() === url('/plain'))!
    assert.ok(awake, 'Keep awake restores the saved tab in the background.')
    assert.equal(awake.getBackgroundThrottling(), false)
    assert.ok((await call({ action: 'tab-activity', key: 'activity' })).protectedKeys.includes('awake-tab'))
    await call({ action: 'keep-awake', key: 'awake-tab', enabled: false, url: url('/plain'), profileId: 'work' })
    assert.equal(awake.getBackgroundThrottling(), true)
    await call({ action: 'close', key: 'awake-tab' })

    const before = await run(
      '/requester',
      "document.getElementById('note').value = 'unsent draft'; [location.href, window.marker]",
      false,
    )
    await call({ action: 'stop-capture', key: capture.key, captureId: capture.id })
    await captures((list) => list.length === 0)
    assert.deepEqual(await run('/requester', 'window.trackStates()', false), ['ended', 'ended'])
    assert.equal(await run('/requester', 'window.endedEvents', false), 2)
    assert.equal(source.isBeingCaptured(), false, 'Stop must end the real capture.')
    assert.deepEqual(
      await run('/requester', "[location.href, window.marker, document.getElementById('note').value]", false),
      [...before, 'unsent draft'],
      'Stop must not navigate or reload the requesting page.',
    )

    const silentShare = run('/requester', 'window.share({ video: true, audio: true })', true)
    const [silentRequest] = await requests(1)
    await call({ action: 'media', key: silentRequest.key, requestId: silentRequest.id, decision: 'allow', source: 'studio:browser:source', audio: false })
    assert.deepEqual(await silentShare, { ok: true, kinds: ['video'] }, 'Requested audio is absent unless explicitly approved.')
    const [silentCapture] = await captures((list) => list[0]?.state === 'active')
    await call({ action: 'stop-capture', key: silentCapture.key, captureId: silentCapture.id })
    await captures((list) => list.length === 0)

    const cancelled = run('/requester', 'window.share({ video: true })', true)
    const [second] = await requests(1)
    assert.equal(second.audio, false)
    await call({ action: 'media', key: second.key, requestId: second.id, decision: 'deny' })
    refused(await cancelled, 'A denied request must reject.')
    await captures((list) => list.length === 0)
    report.stopAndCancel = 'ok'

    stage('devices')
    const camera = run('/requester', 'window.devices({ audio: true, video: true })', false)
    const [devices] = await requests(1)
    assert.equal(devices.kind, 'user-media')
    assert.equal(devices.audio && devices.video, true)
    assert.equal(devices.sources, undefined)
    await call({ action: 'media', key: devices.key, requestId: devices.id, decision: 'allow' })
    assert.deepEqual(await camera, { ok: true, kinds: ['audio', 'video'] })
    assert.deepEqual(
      await run('/requester', 'window.devices({ audio: true })', false),
      { ok: true, kinds: ['audio'] },
      'An approved live page can reuse its microphone grant.',
    )
    await requests(0)
    await show('studio:browser:personal', '/requester', 'personal')
    const other = run(
      '/requester',
      'window.devices({ audio: true })',
      false,
      'persist:dovo-browser-workspace:personal',
    )
    for (let attempt = 0; attempt < 40; attempt++) {
      const status = await call({ action: 'status', key: 'studio:browser:personal' })
      const [ask] = status?.mediaRequests ?? []
      if (ask) {
        assert.equal(ask.profileId, 'personal')
        await call({ action: 'media', key: ask.key, requestId: ask.id, decision: 'deny' })
        break
      }
      await wait(100)
    }
    assert.deepEqual(await other, { ok: false, name: 'NotAllowedError' })
    report.devices = 'ok'

    stage('remote')
    // A remote tab is captured through an isolated viewer, over real authenticated HTTP/WS.
    // Capturing an invisible WebContentsView can wait indefinitely for a compositor frame.
    // This HTTP/WS fixture owns its pixels; a fixed image verifies the remote transport directly.
    const remotePixels = Buffer.alloc(320 * 180 * 4)
    for (let i=0; i<remotePixels.length; i+=4) { remotePixels[i]=30; remotePixels[i+1]=220; remotePixels[i+2]=90; remotePixels[i+3]=255 }
    remoteImage = nativeImage.createFromBitmap(remotePixels,{width:320,height:180}).toJPEG(90)
    await call({ action: 'remote-media-sources', key: 'studio-media', sources: [{ key: 'remote-source', tabId: 'remote-source', profileId: 'work', title: 'Remote source', url: 'http://remote.example', connection: { address: url(''), token: 'remote-test-device-token-at-least-32-characters' } }] })
    const remoteShare = run('/requester', 'window.share({ video: true })', true)
    const [remoteRequest] = await requests(1)
    assert.equal(remoteOpens, 0, 'Remote source opens only after explicit selection.')
    await call({ action: 'media', key: remoteRequest.key, requestId: remoteRequest.id, decision: 'allow', source: 'remote-source' })
    assert.deepEqual(await remoteShare, { ok: true, kinds: ['video'] })
    const [remoteCapture] = await captures((list) => list[0]?.state === 'active')
    assert.equal(remoteCapture.sourceKind, 'remote')
    // The fixture sent its only image before capture attached. A late consumer
    // must still receive frames from this static, hidden source.
    await wait(500)
    const remoteFrame = await run('/requester', 'window.videoFrame()', false)
    assert.ok(remoteFrame.vibrant > 1000, 'Remote viewer must produce real video frames: ' + JSON.stringify(remoteFrame))
    await call({ action: 'stop-capture', key: remoteCapture.key, captureId: remoteCapture.id })
    await captures((list) => list.length === 0)
    for (let attempt=0; attempt<20 && remoteConnections; attempt++) await wait(100)
    assert.equal(remoteConnections, 0, 'Stopping sharing releases the remote viewer connection.')
    report.remoteCapture = remoteFrame

    stage('thread')
    await call({action:'thread-media-sources',key:'studio-media',sources:[{runtimeId:'fixture',taskId:'thread',title:'Shared thread'}]})
    const threadShare = run('/requester', 'window.share({video:true})', true)
    const [threadRequest] = await requests(1)
    await call({action:'media',key:threadRequest.key,requestId:threadRequest.id,decision:'allow',source:'thread:fixture:thread'})
    stage('thread-approved')
    assert.deepEqual(await threadShare,{ok:true,kinds:['video']})
    stage('thread-stream')
    const [threadCapture] = await captures(list=>list[0]?.state==='active')
    assert.equal(threadCapture.sourceKind,'thread')
    stage('thread-frame')
    await wait(500)
    const threadFrame = await run('/requester','window.videoFrame()',false)
    assert.ok(threadFrame.vibrant>1000,'Shared thread must render real frames: '+JSON.stringify(threadFrame))
    await call({action:'stop-capture',key:threadCapture.key,captureId:threadCapture.id})
    await captures(list=>list.length===0)
    report.threadCapture = threadFrame

    stage('desktop')
    for (const kind of ['screen', 'window']) {
      const sharing = run('/requester', 'window.share({ video: true })', true)
      let ask, chosen
      for (let attempt=0; attempt<40; attempt++) {
        [ask] = await requests(1)
        chosen = ask.sources.find((source: {kind: string}) => source.kind === kind)
        if (chosen) break
        await wait(100)
      }
      assert.ok(chosen, kind + ' must be available in the picker.')
      await call({ action:'media', key:ask.key, requestId:ask.id, decision:'allow', source:chosen.key })
      assert.deepEqual(await sharing, {ok:true,kinds:['video']})
      const [capture] = await captures((list) => list[0]?.state === 'active')
      assert.equal(capture.sourceKind, kind)
      const frame = await run('/requester', 'window.videoFrame()', false)
      assert.ok(frame.width > 0 && frame.height > 0)
      await call({action:'stop-capture',key:capture.key,captureId:capture.id})
      await captures((list) => list.length === 0)
      report[kind+'Capture'] = {width:frame.width,height:frame.height}
    }

    stage('profile-routing')
    const beforeRouting = new Set(webContents.getAllWebContents().map(contents=>contents.id))
    await show('routing-source','/plain','work')
    const routeSource=webContents.getAllWebContents().find(contents=>!beforeRouting.has(contents.id)&&contents.getURL()===url('/plain'))!
    await routeSource.executeJavaScript('window.routeMarker="retained-source"')
    writeFileSync(process.env.DOVO_SETTINGS_PATH!,JSON.stringify({app:{browserWorkspaceEnabled:true,browserProfiles:[{id:'default',name:'Default'},{id:'work',name:'Work'},{id:'personal',name:'Personal',linkDomains:['127.0.0.1']}]}}))
    await routeSource.executeJavaScript(\`location.href=\${JSON.stringify(url('/custom?routed=1'))};true\`)
    let routed
    for(let attempt=0;attempt<40&&!routed;attempt++) {
      routed=(await call({action:'status',key:'routing-source',tabCount:4})).createdTabs?.find(tab=>tab.profileId==='personal')
      if(!routed) await wait(50)
    }
    assert.ok(routed,'A link must open in its configured profile.')
    assert.equal(routed.openerKey,'routing-source')
    assert.equal(routeSource.getURL(),url('/plain'))
    assert.equal(await routeSource.executeJavaScript('window.routeMarker'),'retained-source')
    await call({action:'show',key:routed.key,url:routed.url,profileId:'personal',workspaceBrowser:true,bounds})
    const routedContents=webContents.getAllWebContents().find(contents=>contents.getURL()===url('/custom?routed=1'))!
    assert.equal(routedContents.session,session.fromPartition('persist:dovo-browser-workspace:personal'))
    assert.equal(await routedContents.executeJavaScript('window.opener===null'),true,'Different profiles must not share a script opener.')
    const externalUrls=[url('/plain?external=1'),url('/plain?external=2')]
    assert.deepEqual(await Promise.all(externalUrls.map(url=>bridge.openRoutedLink(studio,url))),[true,true])
    assert.equal((await call({action:'status',key:'thread-preview'}))?.movedTabs,undefined,'Thread previews must not consume external-link handoffs.')
    const externalTabs=(await call({action:'status',key:'routing-source',tabCount:4})).movedTabs
    assert.equal(externalTabs?.length,2,'External-link bursts retain both tabs until workspace adoption.')
    assert.deepEqual(externalTabs.map(({tab})=>tab.url).sort(),externalUrls.sort())
    assert.ok(externalTabs.every(({key,tab})=>key.startsWith('external:') && tab.kind==='web' && tab.profileId==='personal'))
    assert.equal(new Set(externalTabs.map(({key})=>key)).size,2,'Each external link has its own tab identity.')
    assert.equal((await call({action:'status',key:'routing-source',tabCount:6})).movedTabs,undefined,'Workspace adoption consumes each handoff once.')
    for (const tab of externalTabs) await call({action:'close',key:tab.key})
    await call({action:'close',key:routed.key})
    await call({action:'close',key:'routing-source'})
    settings([])
    await show('studio:browser:requester','/requester','work')
    report.profileRouting='native-navigation-preserves-opener-and-isolates-target-session'

    stage('endings')
    // Closing the capturing tab, or turning Browser off, really ends a capture.
    const approve = async () => {
      const pending = run('/requester', 'window.share({ video: true, audio: true })', true)
      const [ask] = await requests(1)
      await call({ action: 'media', key: ask.key, requestId: ask.id, decision: 'allow', source: 'studio:browser:source', audio: true })
      assert.equal((await pending).ok, true)
      await captures((list) => list[0]?.state === 'active')
    }
    await approve()
    await call({ action: 'close', key: 'studio:browser:requester' })
    await captures((list) => list.length === 0)
    assert.equal(page('/source', WORK).isBeingCaptured(), false)
    await show('studio:browser:requester', '/requester', 'work')
    await approve()
    writeFileSync(process.env.DOVO_SETTINGS_PATH!, JSON.stringify({ app: { browserWorkspaceEnabled: false } }))
    await studio.webContents.executeJavaScript('window.bridge.settingsWritten()')
    for (let attempt = 0; attempt < 40 && page('/source', WORK); attempt++) await wait(100)
    assert.equal(page('/source', WORK), undefined, 'Turning Browser off closes shared pages.')
    const status = await call({ action: 'media-status', key: 'studio-media' })
    assert.equal(status.captures, undefined)
    report.endings = 'ok'
    report.ok = true
    await bridge.dispose()
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  writeFileSync(join(work, 'result.json'), JSON.stringify(report, null, 2))
  app.exit(report.ok ? 0 : 1)
})
`,
)

const { build } = await import(require.resolve('vite'))
await build({
  configFile: false,
  root: desktop,
  logLevel: 'warn',
  build: {
    ssr: join(work, 'harness', 'main.ts'),
    outDir: join(work, 'out'),
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron', '@dovo/runtime/browser-favicon'],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})

const electron = require('electron')
const display = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
const args = [
  electron,
  '--disable-gpu',
  '--use-fake-device-for-media-stream',
  ...(youtube ? ['--mute-audio'] : []),
  ...(!youtube ? ['--autoplay-policy=no-user-gesture-required'] : []),
  join(work, 'out', 'main.cjs'),
]
const child = spawnSync(display ? 'xvfb-run' : args[0], display ? ['-a', ...args] : args.slice(1), {
  env: {
    ...process.env,
    YOUTUBE_SMOKE: youtube ? '1' : '',
    SMOKE_DIR: work,
    DOVO_SETTINGS_PATH: join(work, 'settings.json'),
    VITE_DEV_SERVER_URL: '',
  },
  encoding: 'utf8',
  timeout: 180_000,
})
let result
try {
  result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'))
} catch {
  result = {
    error: child.error?.message ?? 'No result was written.',
    output: child.stderr?.slice(-4000),
  }
}
console.log(
  result.ok
    ? `media smoke passed ${JSON.stringify(youtube ? result : result.capture)}`
    : 'media smoke FAILED',
)
if (process.env.SMOKE_DEBUG)
  console.log(
    child.stdout
      .split('\n')
      .filter((line) => line.includes('[media-debug]'))
      .slice(0, 40)
      .join('\n'),
  )
if (!result.ok) {
  console.error(
    JSON.stringify({
      ...result,
      processError: child.error?.message,
      exitCode: child.status,
      signal: child.signal,
    }),
  )
  console.error(child.stdout?.slice(-4000))
  console.error(child.stderr?.slice(-4000))
  if (result.output) console.error(result.output)
}
if (keep || !result.ok) console.log(`Smoke files kept in ${work}`)
else rmSync(work, { recursive: true, force: true })
process.exit(result.ok ? 0 : 1)
