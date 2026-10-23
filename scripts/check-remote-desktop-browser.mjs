import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { getDiffieHellman, createDecipheriv, createHash } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { createServer } from 'node:http'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {decode,remoteDesktopResponseSchema,remoteDesktopRequestSchema} from '@dovo/protocol';
import {RemoteDesktopViewer} from '../extension-runtime/src/remote-desktop-view';
window.calls=[];window.enabled=false;window.connected=true;window.session=null;window.failStop=false;window.failInput=false;window.hold=false;window.locked=false;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#102030"/><text x="32" y="50" fill="white" font-size="24">DEMO · Remote desktop</text><rect x="100" y="100" width="800" height="400" rx="12" fill="#edf2f7"/><text x="140" y="160" font-size="24">Primary display — demo data</text></svg>';
window.frame=()=>({id:crypto.randomUUID(),width:1000,height:600,image:'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)))});
window.request=async(path,raw)=>{
 if(path==='/api/remote-desktop/unlock-ticket'){window.unlockTicketInput=raw;return {ticket:'single-use-demo-ticket'}}
 const input=decode(remoteDesktopRequestSchema,raw);window.calls.push(input);
 if(input.action==='stop'){if(window.failStop)throw Error('Computer unreachable');window.session=null;return {session:null}}
 if(!window.enabled)throw Error('Remote desktop is disabled');
 if(input.action==='start')window.session={id:input.id,viewer:'Desktop browser',control:false};
 if(input.action==='input'){if(window.failInput)throw Error('Native input refused; inspect before retrying');if(window.hold)await new Promise(resolve=>window.release=resolve)}
 if(window.locked){window.session.control=false;window.session.locked=true;return decode(remoteDesktopResponseSchema,{session:window.session})}
 delete window.session.locked;
 if(input.action==='control')window.session.control=input.enabled;
 return decode(remoteDesktopResponseSchema,{session:window.session,...(['start','frame','input'].includes(input.action)?{frame:window.frame()}:{})})
};
function App(){const[,render]=useState(0);window.update=changes=>{Object.assign(window,changes);render(x=>x+1)};window.store={request:window.request,connected:window.connected,connection:{address:location.origin,token:'demo-device-token'},snapshot:{remoteDesktopEnabled:window.enabled}};return <RemoteDesktopViewer/>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    loader: 'tsx',
    resolveDir: root + 'packages/studio-ui',
  },
  bundle: true,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'runtime',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          ['@dovo/studio-core', './runtime-preferences', './host-page'].includes(path)
            ? { path, namespace: 'fixture' }
            : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === '@dovo/studio-core'
              ? `export * from '${root}packages/studio-core/src/index.ts';export const useWorkspace=()=>window.store;`
              : path === './host-page'
                ? 'export const HostPage=({children})=>children;'
                : 'export const RemoteDesktopPreferences=()=>null;',
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const assets = root + 'apps/desktop/dist/assets'
const css = await readFile(
  assets +
    '/' +
    (await readdir(assets)).find((name) => name.startsWith('index-') && name.endsWith('.css')),
  'utf8',
)
const mobileHtml = JSON.parse(
  await readFile(root + 'apps/mobile/assets/remote-desktop.json', 'utf8'),
)
const http = createServer((_request, response) => {
  if (_request.url === '/mobile') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(mobileHtml)
    return
  }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(
    `<meta charset="utf-8"><style>${css}</style><div style="padding:24px;max-width:1000px;margin:auto" id="app"></div>`,
  )
})
const unlockServer = new WebSocketServer({ server: http })
http.listen(0, '127.0.0.1')
await once(http, 'listening')
const unlockAddress = `http://127.0.0.1:${http.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let unlockClosed = 0
  let authenticated = false
  let acceptAuthentication = false
  let remoteKeys = 0
  const dh = getDiffieHellman('modp14')
  dh.generateKeys()
  unlockServer.on('connection', (socket, request) => {
    assert.equal(request.url, '/ws/remote-desktop/unlock?ticket=single-use-demo-ticket')
    let phase = 0
    socket.on('close', () => {
      unlockClosed++
    })
    socket.on('message', (raw) => {
      const data = Buffer.from(raw)
      if (phase++ === 0) {
        assert.equal(data.toString(), 'RFB 003.008\n')
        socket.send(Buffer.from([1, 30]))
      } else if (phase === 2) {
        assert.deepEqual([...data], [30])
        socket.send(Buffer.concat([Buffer.from([0, 2, 1, 0]), dh.getPrime(), dh.getPublicKey()]))
      } else if (phase === 3) {
        assert.equal(data.length, 128 + 256)
        const secret = dh.computeSecret(data.subarray(128))
        const key = createHash('md5').update(secret).digest()
        const decipher = createDecipheriv('aes-128-ecb', key, null)
        decipher.setAutoPadding(false)
        const credentials = Buffer.concat([
          decipher.update(data.subarray(0, 128)),
          decipher.final(),
        ])
        assert.equal(credentials.subarray(0, 64).toString().split('\0')[0], 'demo-mac-user')
        assert.equal(credentials.subarray(64).toString().split('\0')[0], 'demo-mac-password')
        authenticated = true
        if (acceptAuthentication) {
          socket.send(Buffer.alloc(4))
          return
        }
        // Exercise rejection without a reconnect or retry of the supplied password.
        const reason = Buffer.from('Test account denied')
        const header = Buffer.alloc(8)
        header.writeUInt32BE(1)
        header.writeUInt32BE(reason.length, 4)
        socket.send(Buffer.concat([header, reason]))
      } else if (phase === 4) {
        assert.deepEqual([...data], [1]) // Share the existing desktop.
        const header = Buffer.alloc(24)
        header.writeUInt16BE(80)
        header.writeUInt16BE(50, 2)
        header.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0], 4)
        const name = Buffer.from('Demo macOS lock screen')
        header.writeUInt32BE(name.length, 20)
        socket.send(Buffer.concat([header, name]))
      } else if (data[0] === 3) {
        const header = Buffer.alloc(16)
        header.writeUInt16BE(1, 2)
        header.writeUInt16BE(80, 8)
        header.writeUInt16BE(50, 10)
        socket.send(Buffer.concat([header, Buffer.alloc(80 * 50 * 4, 127)]))
      } else if (data[0] === 4) {
        remoteKeys++
      }
    })
    socket.send(Buffer.from('RFB 003.889\n'))
  })
  await page.goto(unlockAddress)
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text })
  await page.getByText(/Enable experimental remote desktop above/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Connect to desktop' }).count(), 0)
  await page.evaluate(() => window.update({ enabled: true, locked: true }))
  await page.getByRole('button', { name: 'Connect to desktop' }).click()
  const image = page.getByRole('img', { name: 'Remote primary display' })
  const lockedNotice = page.getByRole('status').filter({ hasText: 'This Mac is locked.' })
  await lockedNotice.waitFor()
  await page.getByRole('button', { name: 'Unlock in Studio', exact: true }).click()
  const unlockPanel = page.getByRole('region', { name: 'Unlock desktop', exact: true })
  await unlockPanel.getByLabel('Mac username', { exact: true }).fill('demo-mac-user')
  const password = unlockPanel.getByLabel('Mac password', { exact: true })
  assert.equal(await password.getAttribute('type'), 'password')
  await password.fill('demo-mac-password')
  await unlockPanel.getByRole('button', { name: 'Authenticate', exact: true }).click()
  await unlockPanel.getByRole('alert').filter({ hasText: 'macOS refused authentication' }).waitFor()
  assert.ok(authenticated)
  assert.deepEqual(await page.evaluate(() => window.unlockTicketInput), {
    id: await page.evaluate(() => window.session.id),
  })
  await page.getByRole('button', { name: 'Close unlock', exact: true }).click()
  await unlockPanel.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Unlock in Studio', exact: true }).click()
  await unlockPanel.getByLabel('Mac username', { exact: true }).waitFor()
  acceptAuthentication = true
  await unlockPanel.getByLabel('Mac username', { exact: true }).fill('demo-mac-user')
  await unlockPanel.getByLabel('Mac password', { exact: true }).fill('demo-mac-password')
  await unlockPanel.getByRole('button', { name: 'Authenticate', exact: true }).click()
  const canvas = unlockPanel.locator('canvas')
  await canvas.waitFor({ state: 'visible' })
  await unlockPanel.getByRole('button', { name: 'Send Tab', exact: true }).click()
  // Keep Tab available to leave the embedded desktop with a keyboard.
  await canvas.focus()
  await page.keyboard.press('Tab')
  assert.equal(await canvas.evaluate((element) => element === document.activeElement), false)
  assert.ok(remoteKeys > 0)
  // Returning to the desktop closes the native connection and drops any entered credentials.
  assert.equal(await image.count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'Enable control', exact: true }).isDisabled(),
    true,
  )
  await page.waitForFunction(() => window.calls.some((call) => call.action === 'frame'))
  await page.evaluate(() => window.update({ locked: false }))
  // No reconnect or refresh is needed after unlocking; the existing session resumes view-only.
  await image.waitFor()
  await lockedNotice.waitFor({ state: 'detached' })
  await unlockPanel.waitFor({ state: 'detached' })
  assert.ok(unlockClosed > 0)
  assert.equal(await page.getByRole('button', { name: 'Type text', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Enable control', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to view only', exact: true }).waitFor()
  const idle = () =>
    page.waitForFunction(
      () =>
        window.calls.length &&
        document.querySelector('button') &&
        !Array.from(document.querySelectorAll('button')).find(
          (button) => button.textContent === 'Refresh desktop',
        )?.disabled,
    )
  await idle()
  const bounds = await image.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + 30, bounds.y + 30)
  await idle()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'click'))
  const click = await page.evaluate(
    () => window.calls.find((call) => call.input?.type === 'click').input,
  )
  assert.ok(Math.abs(click.x - 500) < 2 && Math.abs(click.y - 300) < 2)
  await idle()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: 'right',
  })
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.type === 'click' && call.input.button === 'right'),
  )
  await idle()
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.type === 'click' && call.input.count === 2),
  )
  await idle()
  await image.focus()
  await page.keyboard.type('hello')
  await page.waitForFunction(
    () =>
      window.calls
        .filter((call) => call.input?.type === 'text')
        .map((call) => call.input.text)
        .join('') === 'hello',
  )
  await idle()
  await page.evaluate(() => window.update({ hold: true }))
  await image.focus()
  await page.keyboard.type(' queued text')
  await page.waitForFunction(() => typeof window.release === 'function')
  await page.evaluate(() => {
    window.hold = false
    window.release()
  })
  await page.waitForFunction(
    () =>
      window.calls
        .filter((call) => call.input?.type === 'text')
        .map((call) => call.input.text)
        .join('') === 'hello queued text',
  )
  await idle()
  await page.keyboard.press('Control+a')
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.key === 'a' && call.input.modifiers?.includes('ctrl')),
  )
  await idle()
  await page.keyboard.press('Tab')
  assert.equal(await image.evaluate((node) => document.activeElement === node), false)
  await idle()
  await page.mouse.move(bounds.x + 100, bounds.y + 100)
  await idle()
  await page.mouse.down()
  await page.mouse.move(bounds.x + 200, bounds.y + 200, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'drag'))
  await idle()
  await image.hover()
  await idle()
  await page.mouse.wheel(0, 120)
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'scroll'))
  await idle()
  await page.getByLabel('Text for remote desktop').fill('Hallo wereld')
  await page.getByRole('button', { name: 'Type text', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.input?.text === 'Hallo wereld'))
  await idle()
  await page.evaluate(() => window.update({ failInput: true }))
  await page.getByRole('button', { name: 'Scroll down', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Native input refused' }).waitFor()
  const attempted = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'input').length,
  )
  await page.waitForTimeout(1000)
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'input').length),
    attempted,
  )
  await page.evaluate(() => window.update({ failInput: false }))
  await page.getByRole('button', { name: 'Refresh desktop', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  await page.evaluate(() => window.update({ failStop: true }))
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Stop not confirmed' }).waitFor()
  await page.evaluate(() => window.update({ failStop: false }))
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await page.getByRole('button', { name: 'Connect to desktop' }).waitFor()
  await page.getByRole('button', { name: 'Connect to desktop' }).click()
  await image.waitFor()
  await page.getByRole('button', { name: 'Enable control', exact: true }).click()
  await idle()
  await page.evaluate(() => {
    window.release = undefined
    window.update({ hold: true })
  })
  await image.focus()
  await page.keyboard.type('a')
  await page.waitForFunction(() => typeof window.release === 'function')
  await page.keyboard.type('discard this queued typing')
  await page.evaluate(() => {
    window.locked = true
    window.hold = false
    window.release()
  })
  await lockedNotice.waitFor()
  assert.equal(await image.count(), 0)
  const inputsAtLock = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'input').length,
  )
  await page.evaluate(() => window.update({ locked: false }))
  await image.waitFor()
  await idle()
  assert.equal(await page.getByRole('button', { name: 'Type text', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'input').length),
    inputsAtLock,
  )
  await mkdir(root + 'work/remote-desktop', { recursive: true })
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({
      path: root + 'work/remote-desktop/viewer-' + width + '.png',
      fullPage: true,
    })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  // Exercise the actual self-contained mobile document and its constrained native bridge.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  mobile.on('pageerror', (error) => errors.push(error.message))
  await mobile.addInitScript(
    ({ address }) => {
      window.messages = []
      window.locked = true
      window.session = null
      window.ReactNativeWebView = {
        postMessage(raw) {
          const message = JSON.parse(raw)
          window.messages.push(message)
          const post = (value) =>
            window.dispatchEvent(
              new MessageEvent('message', { data: { channel: 'dovo-desktop', ...value } }),
            )
          if (message.type === 'ready') {
            post({ type: 'configure', connected: true, enabled: true })
            return
          }
          if (message.action === 'unlock') {
            post({
              type: 'result',
              id: message.id,
              value:
                address.replace('http', 'ws') +
                '/ws/remote-desktop/unlock?ticket=single-use-demo-ticket',
            })
            return
          }
          const input = message.input
          if (input.action === 'start')
            window.session = { id: input.id, viewer: 'iPhone', control: false }
          if (input.action === 'stop') window.session = null
          else if (input.action === 'control') window.session.control = input.enabled
          if (window.session) window.session.locked = window.locked
          post({
            type: 'result',
            id: message.id,
            value: {
              session: window.session,
              ...(!window.locked && window.session
                ? {
                    frame: {
                      id: crypto.randomUUID(),
                      width: 1000,
                      height: 600,
                      image:
                        'data:image/svg+xml;base64,' +
                        btoa(
                          '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="blue"/></svg>',
                        ),
                    },
                  }
                : {}),
            },
          })
        },
      }
    },
    { address: unlockAddress },
  )
  await mobile.goto(unlockAddress + '/mobile')
  await mobile.getByRole('button', { name: 'Connect to desktop', exact: true }).tap()
  await mobile.getByRole('button', { name: 'Unlock in Studio', exact: true }).tap()
  await mobile.getByLabel('Mac username', { exact: true }).fill('demo-mac-user')
  await mobile.getByLabel('Mac password', { exact: true }).fill('demo-mac-password')
  await mobile.getByRole('button', { name: 'Authenticate', exact: true }).tap()
  await mobile
    .getByRole('region', { name: 'Unlock desktop', exact: true })
    .locator('canvas')
    .waitFor({ state: 'visible' })
  // Credentials must never enter the native bridge or any JSON API request.
  assert.equal(
    await mobile.evaluate(() => JSON.stringify(window.messages).includes('demo-mac-password')),
    false,
  )
  await mobile.evaluate(() => (window.locked = false))
  await mobile.getByRole('img', { name: 'Remote primary display' }).waitFor()
  await mobile
    .getByRole('region', { name: 'Unlock desktop', exact: true })
    .waitFor({ state: 'detached' })
  await mobile.getByRole('button', { name: 'Enable control', exact: true }).tap()
  const mobileImage = mobile.getByRole('img', { name: 'Remote primary display' })
  await mobileImage.tap()
  await mobile.waitForFunction(() =>
    window.messages.some((item) => item.input?.input?.type === 'click'),
  )
  assert.deepEqual(
    await mobile.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
        .map((e) => ({
          tag: e.tagName,
          classes: e.className,
          width: e.getBoundingClientRect().width,
          right: e.getBoundingClientRect().right,
        })),
    ),
    [],
  )
  await mobile.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'dovo-desktop', type: 'configure', connected: false, enabled: true },
      }),
    ),
  )
  await mobile.getByRole('alert').filter({ hasText: 'Computer offline' }).waitFor()
  await mobile.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'dovo-desktop', type: 'configure', connected: true, enabled: true },
      }),
    ),
  )
  await mobile.getByRole('button', { name: 'Stop sharing', exact: true }).tap()
  await mobile.getByRole('button', { name: 'Connect to desktop', exact: true }).waitFor()
  await mobile.close()
  assert.deepEqual(errors, [])
  console.log(
    'Remote desktop: embedded ARD authentication, rejection, lock-screen canvas/input, keyboard escape, automatic view-only recovery without replay, flag, scaled mouse/drag/wheel, queued typing/modifiers, input failure without replay, unconfirmed stop/retry and responsive layouts passed.',
  )
} finally {
  await browser.close()
  for (const socket of unlockServer.clients) socket.terminate()
  await new Promise((resolve) => unlockServer.close(resolve))
  await new Promise((resolve) => http.close(resolve))
}
