import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, inputPreviewItemSchema, inputPreviewKey, type InputPreview } from '@dovo/protocol'
const f = vi.hoisted(() => ({
  handlers: new Map<string, (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown>(),
  windows: [] as Array<{
    options?: Electron.BrowserWindowConstructorOptions
    focused: boolean
    visible: boolean
    callbacks: Map<string, () => void>
    webContents: {
      send: ReturnType<typeof vi.fn<(channel: string, value: InputPreview | null) => void>>
    }
  }>,
}))
vi.mock('./renderer-trust', () => ({
  requireTrustedRenderer: () => {},
  trustedRendererUrl: () => true,
}))
vi.mock('electron', () => ({
  app: { on: () => {}, getPath: () => tmpdir() },
  nativeTheme: { shouldUseDarkColors: true },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
  },
  ipcMain: {
    handle: (name: string, fn: (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown) =>
      f.handlers.set(name, fn),
  },
  BrowserWindow: class {
    focused = false
    visible = false
    callbacks = new Map<string, () => void>()
    webContents = {
      send: vi.fn<(channel: string, value: InputPreview | null) => void>(),
      setWindowOpenHandler: () => {},
      on: () => {},
      once: () => {},
      setBackgroundThrottling: () => {},
      isLoadingMainFrame: () => false,
    }
    constructor(readonly options?: Electron.BrowserWindowConstructorOptions) {
      f.windows.push(this)
    }
    static fromWebContents(sender: unknown) {
      return f.windows.find((window) => window.webContents === sender)
    }
    isFocused() {
      return this.focused
    }
    isVisible() {
      return this.visible
    }
    getSize() {
      return [440, 480]
    }
    setPosition() {}
    isDestroyed() {
      return false
    }
    isMinimized() {
      return false
    }
    on(name: string, callback: () => void) {
      this.callbacks.set(name, callback)
    }
    hide() {
      this.visible = false
    }
    showInactive() {
      this.visible = true
    }
    show() {
      this.visible = true
    }
    focus() {
      this.focused = true
      this.callbacks.get('focus')?.()
    }
    destroy() {
      this.visible = false
    }
    setVisibleOnAllWorkspaces() {}
    loadFile() {
      return Promise.resolve()
    }
  },
}))
import { BrowserWindow } from 'electron'
import { registerInputPreview } from './input-preview'
afterEach(() => {
  f.handlers.clear()
  f.windows.splice(0)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const item = decode(inputPreviewItemSchema, {
  runtimeId: 'remote',
  runtimeName: 'Mac Studio',
  taskTitle: 'Build app',
  connected: true,
  connection: { address: 'http://remote.local', token: 'preview-fixture-token-123' },
  request: {
    kind: 'question',
    value: {
      id: 'q1',
      taskId: 'task',
      createdAt: '',
      prompt: {
        title: 'Pick one',
        questions: [{ id: 'choice', header: 'Choice', question: 'Which?' }],
      },
    },
  },
})
function event(index: number) {
  return { sender: f.windows[index].webContents } as unknown as Electron.IpcMainInvokeEvent
}
async function fixture() {
  new BrowserWindow()
  registerInputPreview('/app/index.html', '/app/preload.mjs')
  await f.handlers.get('input-preview:sync')?.(event(0), { enabled: true, items: [item] })
  const invoke = (name: string, value?: unknown) =>
    f.handlers.get(`input-preview:${name}`)?.(event(1), value)
  return {
    invoke,
    sync: (items: unknown[], enabled = true) =>
      f.handlers.get('input-preview:sync')?.(event(0), { enabled, items }),
  }
}
it('reconciles resolved requests and hides on app activation without exposing connection credentials', async () => {
  const { invoke, sync } = await fixture()
  expect(f.windows[1].visible).toBe(true)
  expect(await invoke('current')).not.toHaveProperty('connection')
  f.windows[0].callbacks.get('focus')?.()
  expect(f.windows[1].visible).toBe(false)
  await sync([])
  expect(await invoke('current')).toBeNull()
  await expect(
    invoke('answer', { key: inputPreviewKey(item), answer: { choice: ['yes'] } }),
  ).rejects.toThrow('no longer waiting')
})
it('submits to the originating remote runtime once and advances to the next request', async () => {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push(url)
      return Response.json({ ok: true })
    }),
  )
  const { invoke, sync } = await fixture()
  const second = {
    ...item,
    request: { ...item.request, value: { ...item.request.value, id: 'q2' } },
  }
  await sync([item, second])
  const value = { key: inputPreviewKey(item), answer: { choice: ['yes'] } }
  const response = invoke('answer', value)
  await expect(invoke('answer', value)).rejects.toThrow('already being submitted')
  await response
  expect(calls).toEqual(['http://remote.local/api/tasks/answer'])
  expect(await invoke('current')).toMatchObject({ request: { value: { id: 'q2' } } })
})
it('answers in a non-activating macOS panel without opening the main window', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ ok: true })),
  )
  const { invoke } = await fixture()
  expect(f.windows[1].options?.type).toBe(process.platform === 'darwin' ? 'panel' : undefined)
  await invoke('answer', { key: inputPreviewKey(item), answer: { choice: ['yes'] } })
  expect(f.windows[1].visible).toBe(false)
  expect(f.windows[0].visible).toBe(false)
  expect(f.windows[0].focused).toBe(false)
})
it('opens the full window only through Open thread', async () => {
  const { invoke } = await fixture()
  await invoke('open')
  expect(f.windows[1].visible).toBe(false)
  expect(f.windows[0].visible).toBe(true)
  expect(f.windows[0].focused).toBe(true)
})
it('dismisses stale requests rejected by the originating runtime without a snapshot preflight', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: 'This question was answered elsewhere' }, { status: 409 }),
  )
  vi.stubGlobal('fetch', fetcher)
  const { invoke } = await fixture()
  await expect(
    invoke('answer', { key: inputPreviewKey(item), answer: { choice: ['yes'] } }),
  ).rejects.toThrow('elsewhere')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(f.windows[1].visible).toBe(false)
})
it('disables disconnected answers and respects dismissal and the preference', async () => {
  const { invoke, sync } = await fixture()
  await sync([{ ...item, connected: false }])
  await expect(
    invoke('answer', { key: inputPreviewKey(item), answer: { choice: ['yes'] } }),
  ).rejects.toThrow('Reconnect')
  await invoke('dismiss')
  await sync([item])
  expect(f.windows[1].visible).toBe(false)
  await sync([])
  await sync([item], false)
  expect(f.windows[1].visible).toBe(false)
})

it('keeps failed answers visible and permits retry with the same request ID after a lost response', async () => {
  const calls: unknown[] = []
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON answer body')
    calls.push(JSON.parse(init.body))
    if (calls.length === 1) throw new Error('Response lost')
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', fetcher)
  const { invoke } = await fixture()
  const answer = { key: inputPreviewKey(item), answer: { choice: ['yes'] } }
  await expect(invoke('answer', answer)).rejects.toThrow('Cannot reach remote.local')
  expect(f.windows[1].visible).toBe(true)
  await invoke('answer', answer)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  expect(f.windows[1].visible).toBe(false)
})

it('sends approvals directly and preserves server-side expiry and policy checks', async () => {
  const { invoke, sync } = await fixture()
  const approval = {
    ...item,
    request: {
      kind: 'approval' as const,
      value: {
        id: 'a1',
        taskId: 'task',
        title: 'Allow tool',
        detail: 'Tool details',
        createdAt: '',
        rememberRule: null,
      },
    },
  }
  await sync([approval])
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: 'Approval expired' }, { status: 404 }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(invoke('answer', { key: inputPreviewKey(approval), answer: true })).rejects.toThrow(
    'Approval expired',
  )
  expect(fetcher).toHaveBeenCalledOnce()
  const [url] = fetcher.mock.calls[0]
  expect(url instanceof Request ? url.url : typeof url === 'string' ? url : url.href).toBe(
    'http://remote.local/api/approvals',
  )
  expect(f.windows[1].visible).toBe(false)
})
