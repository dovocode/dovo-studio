import { expect, it, vi } from 'vite-plus/test'

const expose = vi.hoisted(() => vi.fn<(name: string, api: unknown) => void>())

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { sendSync: vi.fn<() => void>(), on: vi.fn<() => void>() },
}))

it.each([false, true])(
  'exposes the correct tooltip bridge with DOM mode set to %s',
  async (dom) => {
    const argv = process.argv
    process.argv = [...argv, '--dovo-browser-page', ...(dom ? ['--dovo-dom-tooltips'] : [])]
    vi.stubGlobal('window', new EventTarget())
    expose.mockClear()
    vi.resetModules()
    try {
      await import('./preload')
      const api = expose.mock.calls.find(([name]) => name === 'dovo')?.[1]
      expect(api).toMatchObject({
        browserPageOnly: true,
        onNativeTooltipDismiss: expect.any(Function),
      })
      const hasNativeTooltip = typeof api === 'object' && api !== null && 'nativeTooltip' in api
      expect(hasNativeTooltip).toBe(!dom)
    } finally {
      process.argv = argv
      vi.unstubAllGlobals()
    }
  },
)
