import { stripTypeScriptTypes } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { fontStack, nerdFontFamily, systemMonoFont } from '@dovo/studio-core/fonts'
import { startSocketHeartbeat } from '@dovo/client-runtime'
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function fixture() {
  const messages: Array<{ type?: string; error?: string; attempt?: number }> = []
  const sockets: Socket[] = []
  let input: (text: string) => void = () => {}
  let resets = 0
  let fits = 0
  const options = { fontFamily: systemMonoFont, fontSize: 12 }
  const loads: Array<{ font: string; resolve: () => void; reject: (error: Error) => void }> = []
  class Socket {
    static OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onclose: ((event: { reason: string }) => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    sent: string[] = []
    closed = false
    constructor(readonly url: string) {
      sockets.push(this)
    }
    send(text: string) {
      this.sent.push(text)
    }
    close() {
      this.closed = true
    }
  }
  const window = {
    setTerminalFont: (_family: string, _size: number) => {},
    connectTerminal: (_url: string, _attempt: number) => {},
    disconnectTerminal: (_attempt: number) => {},
    ReactNativeWebView: {
      postMessage: (text: string) => {
        messages.push(JSON.parse(text))
      },
    },
  }
  // Execute the actual WebView entry with only its browser/xterm boundary replaced.
  const source = stripTypeScriptTypes(
    readFileSync(new URL('../../terminal/client.ts', import.meta.url), 'utf8'),
  ).replace(/^import .*\n/gm, '')
  runInNewContext(source, {
    window,
    startSocketHeartbeat,
    fontStack,
    nerdFontFamily,
    systemMonoFont,
    WebSocket: Socket,
    Terminal: class {
      options = options
      refresh() {}
      cols = 80
      rows = 24
      loadAddon() {}
      open() {}
      onData(listener: typeof input) {
        input = listener
      }
      reset() {
        resets++
      }
      write() {}
    },
    FitAddon: class {
      fit() {
        fits++
      }
    },
    ResizeObserver: class {
      observe() {}
    },
    document: {
      fonts: {
        load: (font: string) =>
          new Promise<void>((resolve, reject) => loads.push({ font, resolve, reject })),
      },
      body: {},
      getElementById: () => ({ appendChild() {} }),
      createElement: () => ({ setAttribute() {}, addEventListener() {} }),
    },
  })
  const opened = (socket: Socket) => {
    socket.readyState = Socket.OPEN
    socket.onopen?.()
  }
  return {
    window,
    options,
    loads,
    fits: () => fits,
    sockets,
    messages,
    opened,
    input: (text: string) => input(text),
    resets: () => resets,
  }
}

it('tags socket status with its attempt and ignores obsolete disconnect commands', () => {
  const f = fixture()
  expect(f.messages).toEqual([{ type: 'ready' }])
  f.window.connectTerminal('ws://fixture/first-ticket', 1)
  const first = f.sockets[0]
  f.opened(first)
  first.onclose?.({ reason: 'Network dropped' })
  expect(f.messages.at(-1)).toEqual({ error: 'Network dropped', attempt: 1 })
  f.window.connectTerminal('ws://fixture/fresh-ticket', 2)
  expect(first.closed).toBe(true)
  expect(first.onclose).toBeNull()
  f.opened(f.sockets[1])
  f.window.disconnectTerminal(1)
  expect(f.sockets[1].closed).toBe(false)
  expect(f.messages.at(-1)).toEqual({ type: 'connected', attempt: 2 })
  expect(f.resets()).toBe(2)
  f.window.disconnectTerminal(2)
  expect(f.sockets[1].closed).toBe(true)
})

it('never queues or replays terminal input across a reconnect', () => {
  const f = fixture()
  f.window.connectTerminal('ws://fixture/first', 1)
  f.opened(f.sockets[0])
  f.input('before')
  f.window.disconnectTerminal(1)
  f.input('offline')
  f.window.connectTerminal('ws://fixture/second', 2)
  f.opened(f.sockets[1])
  f.input('after')
  expect(
    f.sockets[1].sent.map((text) => JSON.parse(text)).filter((item) => item.type === 'input'),
  ).toEqual([{ type: 'input', data: 'after' }])
})

it('reports a silent connection loss and closes the stale socket', async () => {
  const f = fixture()
  f.window.connectTerminal('ws://fixture/silent', 9)
  f.opened(f.sockets[0])
  await vi.advanceTimersByTimeAsync(10000)
  expect(f.messages.at(-1)).toEqual({ error: 'Terminal stopped responding.', attempt: 9 })
  expect(f.sockets[0].closed).toBe(true)
  await vi.advanceTimersByTimeAsync(60000)
  expect(f.messages.filter((message) => message.error)).toHaveLength(1)
})

it('loads both font weights before resizing, keeping the connected terminal intact', async () => {
  const f = fixture()
  f.window.connectTerminal('ws://fixture/fonts', 1)
  f.opened(f.sockets[0])
  f.window.setTerminalFont(nerdFontFamily, 18)
  expect(f.options.fontSize).toBe(12)
  expect(f.loads.map((load) => load.font)).toEqual([
    `400 18px ${fontStack(nerdFontFamily, systemMonoFont)}`,
    `700 18px ${fontStack(nerdFontFamily, systemMonoFont)}`,
  ])
  f.loads[0].resolve()
  await Promise.resolve()
  expect(f.fits()).toBe(1)
  f.loads[1].resolve()
  await vi.waitFor(() => expect(f.options.fontSize).toBe(18))
  expect(f.fits()).toBe(2)
  expect(f.options.fontFamily).toContain(nerdFontFamily)
  expect(f.sockets).toHaveLength(1)
  expect(f.sockets[0].closed).toBe(false)
  expect(f.resets()).toBe(1)
  expect(JSON.parse(f.sockets[0].sent.at(-1) ?? '{}').type).toBe('resize')
})

it('ignores invalid font settings and obsolete font loads', async () => {
  const f = fixture()
  f.window.setTerminalFont('unavailable custom font', 12)
  f.window.setTerminalFont(nerdFontFamily, 999)
  f.window.setTerminalFont(nerdFontFamily, 12.5)
  expect(f.loads).toHaveLength(0)
  f.window.setTerminalFont(nerdFontFamily, 18)
  f.window.setTerminalFont('', 14)
  f.loads[2].resolve()
  f.loads[3].resolve()
  await vi.waitFor(() => expect(f.options.fontSize).toBe(14))
  f.loads[0].resolve()
  f.loads[1].resolve()
  await Promise.resolve()
  expect(f.options).toEqual({ fontFamily: systemMonoFont, fontSize: 14 })
  expect(f.fits()).toBe(1)
})
