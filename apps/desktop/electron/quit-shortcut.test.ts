import { afterEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
const f = vi.hoisted(() => ({ mode: 'hold', quit: vi.fn<() => void>() }))
vi.mock('electron', () => ({ app: { quit: f.quit } }))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => ({ quitShortcut: f.mode }),
}))
import { registerQuitShortcut } from './quit-shortcut'
import type { WebContents } from 'electron'
afterEach(() => {
  vi.useRealTimers()
  f.quit.mockClear()
  f.mode = 'hold'
})
function setup() {
  vi.useFakeTimers()
  const contents = new EventEmitter()
  // Only event registration is consumed by the adapter.
  registerQuitShortcut(contents as WebContents)
  const press = (type: string, key = 'q') => {
    const preventDefault = vi.fn<() => void>()
    contents.emit(
      'before-input-event',
      { preventDefault },
      { type, key, meta: true, control: true, alt: false, shift: false },
    )
    return preventDefault
  }
  return { contents, press }
}
it('holds the shortcut, cancels on release, and prevents the menu accelerator', () => {
  const { press } = setup()
  expect(press('keyDown')).toHaveBeenCalled()
  vi.advanceTimersByTime(300)
  press('keyUp')
  vi.advanceTimersByTime(400)
  expect(f.quit).not.toHaveBeenCalled()
  press('keyDown')
  vi.advanceTimersByTime(600)
  expect(f.quit).toHaveBeenCalledTimes(1)
})
it('supports double press, disabled shortcuts, and leaving immediate quit to Electron', () => {
  const { press } = setup()
  press('keyDown')
  vi.advanceTimersByTime(100)
  press('keyUp')
  press('keyDown')
  expect(f.quit).toHaveBeenCalledTimes(1)
  f.quit.mockClear()
  f.mode = 'disabled'
  expect(press('keyDown')).toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(f.quit).not.toHaveBeenCalled()
  f.mode = 'immediate'
  expect(press('keyDown')).not.toHaveBeenCalled()
})
