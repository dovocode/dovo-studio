import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vite-plus/test'
import { dismissExtensionPopupOnBlur } from './browser-extension-popup'

function window() {
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false }),
    isDestroyed: (): boolean => false,
    destroy: vi.fn<() => void>(),
  })
  win.destroy.mockImplementation(() => {
    win.isDestroyed = () => true
    win.emit('closed')
  })
  return win
}
it.each(['blur', 'focus', 'hide', 'minimize'])(
  'dismisses on %s even if focus moves outside the app, and removes parent listeners',
  (event) => {
    const popup = window(),
      parent = window()
    dismissExtensionPopupOnBlur(popup as never, parent as never)
    ;(event === 'blur' ? popup : parent).emit(event)
    expect(popup.destroy).toHaveBeenCalledOnce()
    expect(parent.listenerCount('focus')).toBe(0)
    expect(parent.webContents.listenerCount('before-input-event')).toBe(0)
  },
)
it('allows Escape from either the popup or Studio without leaving stale handlers', () => {
  const popup = window(),
    parent = window()
  dismissExtensionPopupOnBlur(popup as never, parent as never)
  const preventDefault = vi.fn<() => void>()
  parent.webContents.emit(
    'before-input-event',
    { preventDefault },
    { type: 'keyDown', key: 'Escape' },
  )
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(popup.destroy).toHaveBeenCalledOnce()
  expect(popup.webContents.listenerCount('before-input-event')).toBe(0)
})
