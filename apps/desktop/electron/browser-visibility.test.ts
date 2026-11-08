import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('electron', () => ({ app: {}, ipcMain: new EventEmitter() }))
import { ipcMain } from 'electron'
import { createBrowserVisibility } from './browser-visibility'

afterEach(() => {
  vi.useRealTimers()
  ipcMain.removeAllListeners()
})
it('parks with no pages, detects native occlusion, and releases its watchdog when the last page exits', () => {
  vi.useFakeTimers()
  const states = new Map([[1, true]])
  const lookup = vi.fn<(contents: Electron.WebContents) => boolean | undefined>((contents) =>
    states.get(contents.id),
  )
  const visibility = createBrowserVisibility(lookup)
  const page = {
    id: 1,
    isDestroyed: () => false,
    send: vi.fn(),
    mainFrame: { framesInSubtree: [] },
  }
  try {
    vi.advanceTimersByTime(1000)
    expect(lookup).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const initial = { sender: page, returnValue: undefined }
    ipcMain.emit('browser:visibility-state', initial)
    expect(initial.returnValue).toBe(true)
    states.set(1, false) // Native occlusion can happen without an Electron show/hide event.
    vi.advanceTimersByTime(250)
    expect(page.send).toHaveBeenCalledExactlyOnceWith('browser:visibility', false)
    page.isDestroyed = () => true
    vi.advanceTimersByTime(250)
    expect(vi.getTimerCount()).toBe(0)
    const stopped = lookup.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(lookup.mock.calls.length).toBe(stopped)
    // A later tracked page re-arms the watchdog; disposal always releases it.
    page.isDestroyed = () => false
    ipcMain.emit('browser:visibility-state', { sender: page })
    expect(vi.getTimerCount()).toBe(1)
  } finally {
    visibility.dispose()
  }
  expect(vi.getTimerCount()).toBe(0)
})
