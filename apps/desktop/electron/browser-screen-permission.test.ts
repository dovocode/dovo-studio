import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  access: vi.fn<() => string>(() => 'not-determined'),
  review: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(async () => ({
    response: 0,
  })),
  external: vi.fn<(url: string) => Promise<void>>(async () => {}),
  focus: vi.fn<(...args: unknown[]) => void>(),
  parent: { isDestroyed: () => false, show: vi.fn<() => void>(), focus: vi.fn<() => void>() },
}))
vi.mock('electron', () => ({
  app: { focus: f.focus },
  BrowserWindow: { fromId: () => f.parent },
  dialog: { showMessageBox: f.review },
  shell: { openExternal: f.external },
  systemPreferences: { getMediaAccessStatus: f.access },
}))
import { prepareScreenRecording } from './browser-screen-permission'
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  f.access.mockReturnValue('not-determined')
})
afterEach(() => Object.defineProperty(process, 'platform', platform))
it('puts the explanation and native macOS request in front of Studio only when needed', async () => {
  expect(await prepareScreenRecording(1, 'https://teams.microsoft.com')).toBe(true)
  expect(f.focus).toHaveBeenCalledWith({ steal: true })
  expect(f.parent.show).toHaveBeenCalledOnce()
  expect(f.review).toHaveBeenCalledWith(
    f.parent,
    expect.objectContaining({ detail: expect.stringContaining('https://teams.microsoft.com') }),
  )
  expect(f.external).not.toHaveBeenCalled()
})
it('offers the exact system settings pane after denial without pretending access was granted', async () => {
  f.access.mockReturnValue('denied')
  expect(await prepareScreenRecording(1, 'https://meet.google.com')).toBe(false)
  expect(f.external).toHaveBeenCalledWith(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
})
it('leaves tab and thread sharing available when the user declines system access', async () => {
  f.review.mockResolvedValueOnce({ response: 1 })
  expect(await prepareScreenRecording(1, 'https://meet.google.com')).toBe(false)
  expect(f.external).not.toHaveBeenCalled()
})
it('does not ask again when macOS has already approved Dovo', async () => {
  f.access.mockReturnValue('granted')
  expect(await prepareScreenRecording(1, 'https://meet.google.com')).toBe(true)
  expect(f.review).not.toHaveBeenCalled()
  expect(f.focus).not.toHaveBeenCalled()
})
