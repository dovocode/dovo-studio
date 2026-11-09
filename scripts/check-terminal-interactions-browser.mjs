import assert from 'node:assert/strict'
import { createServer } from 'vite-plus'
import { chromium } from 'playwright'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeTerminalStreamFrame } from '../packages/protocol/dist/index.js'

const contextMenu = realpathSync(
  'packages/studio-ui/node_modules/@radix-ui/react-context-menu/dist/index.mjs',
)
const sockets = new WebSocketServer({ port: 0, host: '127.0.0.1' })
await once(sockets, 'listening')
const port = sockets.address().port
const peers = new Set()
const inputs = []
let connections = 0
const output = (text) => {
  for (const peer of peers)
    peer.send(encodeTerminalStreamFrame({ type: 'data', data: new TextEncoder().encode(text) }))
}
sockets.on('connection', (socket) => {
  connections++
  peers.add(socket)
  socket.send(encodeTerminalStreamFrame({ type: 'replayStart' }))
  socket.send(
    encodeTerminalStreamFrame({
      type: 'data',
      data: new TextEncoder().encode('pointer-select-me\r\nSESSION_PRESERVED\r\n'),
    }),
  )
  socket.send(encodeTerminalStreamFrame({ type: 'replayEnd' }))
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'input') inputs.push(message.data)
    if (message.type === 'ping')
      socket.send(encodeTerminalStreamFrame({ type: 'pong', nonce: message.nonce }))
  })
  socket.on('close', () => peers.delete(socket))
})
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export * as ContextMenu from '/@fs/${contextMenu}';`,
  '@dovo/studio-core': `
import {createContext,useContext} from 'react';
export const responses={ticket:{},terminalPaths:{}};
export const Context=createContext(null);
export const useWorkspace=()=>useContext(Context);
export const connection={address:'http://127.0.0.1:${port}',token:'fixture'};
export const request=async(path,input)=>{
  if(path==='/api/terminals/ticket')return {ticket:'fixture'};
  if(path==='/api/terminals/quote-paths'){
    window.pathRequests.push(input);
    if(window.delayDrop)await new Promise(resolve=>window.finishDrop=resolve);
    return {text:window.quoted};
  }
  throw new Error(path);
};
export const startReconnecting=run=>{const controller=new AbortController();void run(controller.signal,()=>{}).catch(()=>{});return {stop:async()=>controller.abort(),restart:()=>{}}};
export const systemMonoFont='monospace';export const fontStack=()=>systemMonoFont;
export const useAppPreferences=()=>({terminalFontFamily:'',terminalFontSize:12});
export const useStudioTheme=()=>({card:'#101113',foreground:'#eeeeee',primary:'#88aaff',background:'#101113',selection:'#446688','muted-foreground':'#999999',pink:'#ff88cc',signal:'#88ffff'});
export const useResolvedTheme=()=> 'dark';`,
}
const cacheDir = mkdtempSync(join(tmpdir(), 'dovo-terminal-interactions-'))
const server = await createServer({
  cacheDir,
  configFile: false,
  root: new URL('../packages/extension-tasks', import.meta.url).pathname,
  logLevel: 'error',
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      '@dovo/protocol',
      '@dovo/client-runtime',
    ],
    exclude: ['@dovo/studio-core', '@dovo/studio-ui', '@dovo/terminal'],
  },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'terminal-interaction-fixture',
      configureServer(vite) {
        vite.middlewares.use('/terminal-interactions', (_request, response) => {
          response.setHeader('content-type', 'text/html')
          response.end(
            `<!doctype html><style>html,body{margin:0;background:#101113;color:#eee}#terminal{width:793.3px;height:307.7px}#terminal>div,#terminal>div>div{height:100%}</style><div id="terminal"></div><script type="module" src="/terminal-interactions-entry.jsx"></script>`,
          )
        })
      },
    },
    {
      name: 'terminal-interaction-modules',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('/packages/')) return process.cwd() + id
        if (id === '/terminal-interactions-entry.jsx') return '\0terminal-interactions-entry'
        if (Object.hasOwn(mocks, id)) return '\0fixture:' + id
      },
      load(id) {
        if (id.startsWith('\0fixture:')) return mocks[id.slice('\0fixture:'.length)]
        if (id === '\0terminal-interactions-entry')
          return `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Context,connection,request} from '@dovo/studio-core';
import {TerminalSession} from '/packages/extension-tasks/src/terminal/terminal-session.tsx';
import '/packages/terminal/src/browser/styles.css';
function App(){const [state,setState]=useState({active:true,readOnly:false,connected:true});window.state=state;window.setState=change=>setState(old=>({...old,...change}));return React.createElement(Context.Provider,{value:{connection,request,connected:state.connected}},React.createElement(TerminalSession,{id:'terminal',active:state.active,readOnly:state.readOnly}));}
createRoot(document.getElementById('terminal')).render(React.createElement(App));`
      },
    },
  ],
})
await server.listen()
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
  const errors = []
  page.on('requestfailed', (request) =>
    console.error('Request failed:', request.url(), request.failure()),
  )
  page.on('response', (response) => {
    if (response.status() >= 400) console.error('HTTP', response.status(), response.url())
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Page:', error.name, error.message, error.stack)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.addInitScript(() => {
    window.copied = []
    window.clipboard = 'pasted text\nsecond line'
    window.dovoCopyText = async (text) => window.copied.push(text)
    window.dovoReadText = async () => {
      if (window.delayPaste) await new Promise((resolve) => (window.finishPaste = resolve))
      return window.clipboard
    }
    window.pathRequests = []
    window.quoted = "'/tmp/with spaces.txt' '/tmp/it'\\''s.txt' "
    window.dovoTerminalFilePath = (file) =>
      file.name === 'one.txt' ? '/tmp/with spaces.txt' : "/tmp/it's.txt"
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'viewport') window.terminalViewport = data.viewport
          if (data.type === 'selection') window.terminalSelection = data.text
        })
      }
    }
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/terminal-interactions`)
  await page
    .waitForFunction(
      () => window.terminalViewport?.lines?.some((line) => line.text.includes('SESSION_PRESERVED')),
      {},
      { timeout: 10000 },
    )
    .catch(async (error) => {
      console.error(
        await page.evaluate(() => ({
          body: document.body.innerText,
          html: document.body.innerHTML.slice(0, 1500),
          state: window.state,
          viewport: window.terminalViewport,
        })),
      )
      throw error
    })
  const canvas = page.locator('.dovo-terminal-canvas')
  assert.equal(await canvas.evaluate((el) => getComputedStyle(el).cursor), 'text')
  const drop = async () =>
    page.evaluate(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['one'], 'one.txt'))
      dataTransfer.items.add(new File(['two'], 'two.txt'))
      document
        .querySelector('.dovo-terminal-canvas')
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })
  await drop()
  await assertEventually(() => inputs.join('') === "'/tmp/with spaces.txt' '/tmp/it'\\''s.txt' ")
  assert.deepEqual(await page.evaluate(() => window.pathRequests[0]), {
    id: 'terminal',
    paths: ['/tmp/with spaces.txt', "/tmp/it's.txt"],
  })
  assert.ok(!inputs.join('').includes('\n'), 'Drop inserts paths without submitting the command')
  inputs.length = 0
  await page.evaluate(() => {
    window.delayDrop = true
  })
  await drop()
  await page.waitForFunction(() => !!window.finishDrop)
  await page.evaluate(() => window.setState({ readOnly: true }))
  await page.waitForFunction(() => window.state.readOnly)
  await page.evaluate(() => {
    window.finishDrop()
    window.delayDrop = false
  })
  await drop()
  await page.getByRole('alert').filter({ hasText: 'Terminal is not writable' }).waitFor()
  assert.deepEqual(inputs, [], 'A pending drop cannot write after read-only is enabled')
  assert.equal(await page.evaluate(() => window.pathRequests.length), 2)
  await page.evaluate(() => window.setState({ readOnly: false }))
  await page.waitForFunction(() => !window.state.readOnly)
  output('\x1b[?1000h\x1b[?1006h')
  await page.waitForFunction(() => window.terminalViewport.mouseTracking)
  assert.equal(await canvas.evaluate((el) => getComputedStyle(el).cursor), 'default')
  const point = await page.evaluate(() => {
    const rect = document.querySelector('.dovo-terminal-canvas').getBoundingClientRect()
    return {
      x: rect.left + window.terminalViewport.metrics.cellWidth * 2.5,
      y: rect.top + window.terminalViewport.metrics.cellHeight * 1.5,
    }
  })
  await page.mouse.click(point.x, point.y)
  await assertEventually(() => inputs.includes('\x1b[<0;3;2M') && inputs.includes('\x1b[<0;3;2m'))
  inputs.length = 0
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  const edge = await canvas.boundingBox()
  await page.mouse.move(edge.x + edge.width + 30, point.y)
  await page.mouse.up()
  const cols = await page.evaluate(() => window.terminalViewport.cols)
  await assertEventually(() => inputs.includes(`\x1b[<0;${cols};2m`))
  inputs.length = 0
  await page.keyboard.down('Control')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.up('Control')
  await assertEventually(() => inputs.includes('\x1b[<16;3;2M'))
  inputs.length = 0
  await page.keyboard.down('Shift')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 40, point.y)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForFunction(() => window.terminalSelection?.length > 0)
  assert.deepEqual(inputs, [], 'Shift-drag selects without sending mouse reports')
  const selected = await page.evaluate(() => window.terminalSelection)
  output('\x1b[?1000l\x1b[?1006l')
  await page.waitForFunction(() => !window.terminalViewport.mouseTracking)
  for (const [index, shortcut] of ['Control+Shift+C', 'Meta+C', 'Control+C'].entries()) {
    await page.keyboard.press(shortcut)
    await page.waitForFunction((count) => window.copied.length === count, index + 1)
  }
  assert.deepEqual(await page.evaluate(() => window.copied), [selected, selected, selected])
  await canvas.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.waitForFunction(() => window.copied.length === 4)
  assert.equal(await page.evaluate(() => window.copied[3]), selected)
  assert.deepEqual(inputs, [], 'Copy shortcuts do not send terminal input')
  for (const shortcut of ['Control+Shift+V', 'Meta+V', 'Shift+Insert']) {
    await page.keyboard.press(shortcut)
    await assertEventually(() => inputs.length > 0)
    assert.equal(inputs.join(''), 'pasted text\rsecond line', 'Keyboard paste writes once')
    inputs.length = 0
  }
  await canvas.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await assertEventually(() => inputs.length > 0)
  assert.equal(inputs.join(''), 'pasted text\rsecond line', 'Menu paste writes once')
  inputs.length = 0
  await page.evaluate(() => {
    window.delayPaste = true
  })
  await page.keyboard.press('Control+Shift+V')
  await page.waitForFunction(() => !!window.finishPaste)
  await page.evaluate(() => window.setState({ readOnly: true }))
  await page.waitForFunction(() => window.state.readOnly)
  await page.evaluate(() => {
    window.finishPaste()
    window.delayPaste = false
  })
  await page.evaluate(() => window.setState({ readOnly: false }))
  await page.waitForFunction(() => !window.state.readOnly)
  assert.deepEqual(inputs, [], 'Delayed paste respects a changed input scope')
  const cdp = await page.context().newCDPSession(page)
  for (const [index, deviceScaleFactor] of [1.25, 1.5, 2, 1].entries()) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: index % 2 === 0 ? 1001 : 1000,
      height: 600,
      deviceScaleFactor,
      mobile: false,
    })
    await page
      .waitForFunction(
        (dpr) => {
          const c = document.querySelector('.dovo-terminal-canvas'),
            rect = c.getBoundingClientRect(),
            m = window.terminalViewport.metrics
          return (
            window.devicePixelRatio === dpr &&
            c.width === Math.round(rect.width * dpr) &&
            c.height === Math.round(rect.height * dpr) &&
            Math.abs(m.cellWidth * dpr - Math.round(m.cellWidth * dpr)) < 1e-6 &&
            Math.abs(m.cellHeight * dpr - Math.round(m.cellHeight * dpr)) < 1e-6
          )
        },
        deviceScaleFactor,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        console.error(
          'DPI check',
          deviceScaleFactor,
          await page.evaluate(() => {
            const canvas = document.querySelector('.dovo-terminal-canvas'),
              rect = canvas.getBoundingClientRect()
            return {
              dpr: devicePixelRatio,
              width: canvas.width,
              height: canvas.height,
              rect: { width: rect.width, height: rect.height },
              metrics: window.terminalViewport.metrics,
            }
          }),
        )
        throw error
      })
    assert.deepEqual(
      await page.evaluate(() => window.terminalViewport.lines.map((line) => line.text.trimEnd())),
      await page.evaluate(() =>
        Array.from(
          { length: window.terminalViewport.rows },
          (_, row) => ['pointer-select-me', 'SESSION_PRESERVED'][row] ?? '',
        ),
      ),
      `DPI ${deviceScaleFactor} preserves text and blank cells`,
    )
  }
  const altClick = async (x, y) => {
    const point = await page.evaluate(
      ({ x, y }) => {
        const rect = document.querySelector('.dovo-terminal-canvas').getBoundingClientRect()
        const m = window.terminalViewport.metrics
        return { x: rect.left + (x + 0.5) * m.cellWidth, y: rect.top + (y + 0.5) * m.cellHeight }
      },
      { x, y },
    )
    await page.keyboard.down('Alt')
    await page.mouse.click(point.x, point.y)
    await page.keyboard.up('Alt')
  }
  output('\x1b[2J\x1b[H$ abcdef')
  await page.waitForFunction(
    () => window.terminalViewport.cursor.x === 8 && window.terminalViewport.cursor.y === 0,
  )
  await altClick(3, 0)
  await assertEventually(() => inputs.join('') === '\x1b[D'.repeat(5))
  assert.equal(
    await page.evaluate(() => window.terminalSelection),
    '',
    'Alt-click moves without selecting',
  )
  inputs.length = 0
  await page.keyboard.press('Control+c')
  await assertEventually(() => inputs.join('') === '\x03')
  inputs.length = 0
  output('\x1b[2J\x1b[H' + 'w'.repeat(cols + 8))
  await page.waitForFunction(
    () => window.terminalViewport.cursor.x === 8 && window.terminalViewport.cursor.y === 1,
  )
  await altClick(cols - 2, 0)
  await assertEventually(() => inputs.join('') === '\x1b[D'.repeat(10))
  inputs.length = 0
  output('\x1b[2J\x1b[H$ a中b')
  await page.waitForFunction(
    () => window.terminalViewport.cursor.x === 6 && window.terminalViewport.cursor.y === 0,
  )
  await altClick(4, 0)
  await assertEventually(() => inputs.join('') === '\x1b[D'.repeat(2))
  inputs.length = 0
  output('\x1b[3G')
  await page.waitForFunction(() => window.terminalViewport.cursor.x === 2)
  await altClick(5, 0)
  await assertEventually(() => inputs.join('') === '\x1b[C'.repeat(2))
  inputs.length = 0
  output('\x1b[?1h\x1b[2J\x1b[H$ abcdef')
  await page.waitForFunction(() => window.terminalViewport.cursor.x === 8)
  await altClick(3, 0)
  await assertEventually(() => inputs.join('') === '\x1bOD'.repeat(5))
  inputs.length = 0
  output('\x1b[?1l\x1b[?1049h\x1b[5;9H')
  await page.waitForFunction(
    () => window.terminalViewport.cursor.x === 8 && window.terminalViewport.cursor.y === 4,
  )
  await altClick(3, 2)
  await assertEventually(() => inputs.join('') === '\x1b[A'.repeat(2) + '\x1b[D'.repeat(5))
  inputs.length = 0
  output('\x1b[?1049l')
  await page.waitForFunction(
    () => window.terminalViewport.cursor.x === 8 && window.terminalViewport.cursor.y === 0,
  )
  inputs.length = 0
  await page.evaluate(() => window.setState({ readOnly: true }))
  await page.waitForFunction(() => window.state.readOnly)
  await altClick(3, 0)
  assert.deepEqual(inputs, [], 'Alt-click respects read-only terminals')
  await page.evaluate(() => window.setState({ readOnly: false }))
  await page.waitForFunction(() => !window.state.readOnly)
  output('\x1b[?1l\x1b[?1000h\x1b[?1006h')
  await page.waitForFunction(() => window.terminalViewport.mouseTracking)
  await altClick(3, 0)
  await assertEventually(() => inputs.includes('\x1b[<8;4;1M') && inputs.includes('\x1b[<8;4;1m'))
  inputs.length = 0
  output('\x1b[?1000l\x1b[?1006l')
  await page.waitForFunction(() => !window.terminalViewport.mouseTracking)
  assert.equal(connections, 1, 'DPI changes preserve the terminal session')
  await canvas.screenshot({ path: '/tmp/dovo-terminal-sharp-text.png' })
  for (const field of ['connected', 'active']) {
    await page.evaluate(() => {
      window.delayDrop = true
      window.finishDrop = undefined
    })
    await drop()
    await page.waitForFunction(() => !!window.finishDrop)
    await page.evaluate((field) => window.setState({ [field]: false }), field)
    await page.waitForFunction((field) => !window.state[field], field)
    const requests = await page.evaluate(() => window.pathRequests.length)
    await drop()
    await page.getByRole('alert').filter({ hasText: 'Terminal is not writable' }).waitFor()
    assert.equal(await page.evaluate(() => window.pathRequests.length), requests)
    await page.evaluate((field) => window.setState({ [field]: true }), field)
    await page.waitForFunction((field) => window.state[field], field)
    await page.evaluate(() => {
      window.finishDrop()
      window.delayDrop = false
    })
  }
  // A later successful drop also flushes the earlier cancelled requests.
  await drop()
  await assertEventually(() => inputs.join('') === "'/tmp/with spaces.txt' '/tmp/it'\\''s.txt' ")
  assert.deepEqual(errors, [])
  console.log(
    'Terminal: clipboard shortcuts and menus, single paste, read-only cancellation, Ctrl+C interrupt, file drops, pointer reporting, cursor movement, selection and live DPI changes passed.',
  )
} finally {
  await browser.close()
  for (const peer of peers) peer.terminate()
  await new Promise((resolve) => sockets.close(resolve))
  await server.close()
  rmSync(cacheDir, { recursive: true, force: true })
}
async function assertEventually(condition) {
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 5000
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Expected terminal input did not arrive')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
}
