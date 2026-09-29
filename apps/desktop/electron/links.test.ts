import { afterEach, expect, it, vi } from 'vite-plus/test'
import { BrowserWindow } from 'electron'

const fixture = vi.hoisted(() => ({
  answer: vi.fn<() => Promise<{ response: number }>>(async () => ({ response: 2 })),
  external: vi.fn<(url: string) => Promise<void>>(async () => {}),
  loaded: vi.fn<(url: string) => Promise<void>>(async () => {}),
}))
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      session: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
      },
    }
    loadURL = fixture.loaded
  },
  dialog: { showMessageBox: fixture.answer },
  shell: { openExternal: fixture.external },
}))
afterEach(() => {
  vi.clearAllMocks()
})

it('asks before opening a link in the internal browser', async () => {
  fixture.answer.mockResolvedValueOnce({ response: 0 })
  const { offerLink } = await import('./links')
  await offerLink(new BrowserWindow(), 'https://example.com/page')
  expect(fixture.loaded).toHaveBeenCalledWith('https://example.com/page')
  expect(fixture.external).not.toHaveBeenCalled()
})

it('opens externally only when chosen and ignores unsafe links', async () => {
  fixture.answer.mockResolvedValueOnce({ response: 1 })
  const { offerLink } = await import('./links')
  await offerLink(new BrowserWindow(), 'https://example.com/')
  await offerLink(new BrowserWindow(), 'javascript:alert(1)')
  expect(fixture.external).toHaveBeenCalledOnce()
  expect(fixture.loaded).not.toHaveBeenCalled()
  expect(fixture.answer).toHaveBeenCalledOnce()
})
