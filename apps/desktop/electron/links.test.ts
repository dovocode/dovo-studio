import { afterEach, expect, it, vi } from 'vite-plus/test'
import { BrowserWindow } from 'electron'

const fixture = vi.hoisted(() => ({
  answer: vi.fn<() => Promise<{ response: number }>>(async () => ({ response: 2 })),
  external: vi.fn<(url: string) => Promise<void>>(async () => {}),
  sent: vi.fn<(channel: string, url: string) => void>(),
  navigate: undefined as
    | ((event: unknown, url: string, inPlace: boolean, mainFrame: boolean) => void)
    | undefined,
  popup: undefined as ((event: { url: string }) => unknown) | undefined,
  loaded: vi.fn<(url: string) => Promise<void>>(async () => {}),
}))
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      send: fixture.sent,
      setWindowOpenHandler: (handler: typeof fixture.popup) => {
        fixture.popup = handler
      },
      on: (event: string, handler: typeof fixture.navigate) => {
        if (event === 'did-start-navigation') fixture.navigate = handler
      },
      session: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
      },
    }
    isDestroyed() {
      return false
    }
    show() {}
    focus() {}
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

it('returns the internal choice to the thread without creating a separate browser window', async () => {
  fixture.answer.mockResolvedValueOnce({ response: 0 })
  const internal = vi.fn<(url: string) => void>()
  const { offerLink } = await import('./links')
  expect(await offerLink(new BrowserWindow(), 'https://example.com/page', internal)).toBe(true)
  expect(internal).toHaveBeenCalledWith('https://example.com/page')
  expect(fixture.loaded).not.toHaveBeenCalled()
  expect(fixture.external).not.toHaveBeenCalled()
})

it('does not dispatch a new sidebar tab for cancellation or an external choice', async () => {
  fixture.answer.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 })
  const internal = vi.fn<(url: string) => void>()
  const { offerLink } = await import('./links')
  expect(await offerLink(new BrowserWindow(), 'https://example.com/', internal)).toBe(false)
  expect(await offerLink(new BrowserWindow(), 'https://example.com/', internal)).toBe(false)
  expect(internal).not.toHaveBeenCalled()
  expect(fixture.external).toHaveBeenCalledOnce()
})

it('opens an explicitly chosen external HTTP link without another chooser and rejects unsafe schemes', async () => {
  const { openExternalLink } = await import('./links')
  await openExternalLink('http://runtime.local/thread')
  expect(fixture.external).toHaveBeenCalledWith('http://runtime.local/thread')
  expect(fixture.answer).not.toHaveBeenCalled()
  await expect(openExternalLink('javascript:alert(1)')).rejects.toThrow(
    'Use an HTTP or HTTPS address.',
  )
  expect(fixture.external).toHaveBeenCalledOnce()
})

it('opens an explicitly chosen Dovo browser link without a second dialog', async () => {
  const { openBrowserLink } = await import('./links')
  await openBrowserLink(new BrowserWindow(), 'http://runtime.local/page')
  expect(fixture.loaded).toHaveBeenCalledWith('http://runtime.local/page')
  expect(fixture.answer).not.toHaveBeenCalled()
  expect(fixture.external).not.toHaveBeenCalled()
  await expect(openBrowserLink(new BrowserWindow(), 'javascript:alert(1)')).rejects.toThrow(
    'Use an HTTP or HTTPS address.',
  )
})

it('forwards native fallback requests to the owning app chooser without a native dialog', async () => {
  const { offerLink, setLinkReceiver } = await import('./links')
  const parent = new BrowserWindow()
  setLinkReceiver(parent.webContents, true)
  await offerLink(parent, 'http://runtime.lan/page#section')
  expect(fixture.sent).toHaveBeenCalledWith('links:open', 'http://runtime.lan/page#section')
  expect(fixture.answer).not.toHaveBeenCalled()
  expect(fixture.loaded).not.toHaveBeenCalled()
  setLinkReceiver(parent.webContents, false)
  await offerLink(parent, 'https://example.com/')
  expect(fixture.answer).toHaveBeenCalledOnce()
})

it('clears receiver readiness on document navigation but preserves fragment navigation', async () => {
  const { offerLink, setLinkReceiver } = await import('./links')
  const parent = new BrowserWindow()
  setLinkReceiver(parent.webContents, true)
  fixture.navigate?.({}, 'https://example.com/#section', true, true)
  await offerLink(parent, 'https://example.com/')
  expect(fixture.sent).toHaveBeenCalledOnce()
  fixture.navigate?.({}, 'https://example.com/', false, true)
  await offerLink(parent, 'https://example.com/')
  expect(fixture.answer).toHaveBeenCalledOnce()
})

it('routes isolated-browser popups through the trusted parent', async () => {
  const { openBrowserLink, setLinkReceiver } = await import('./links')
  const parent = new BrowserWindow()
  setLinkReceiver(parent.webContents, true)
  await openBrowserLink(parent, 'https://example.com/')
  expect(fixture.popup?.({ url: 'https://github.com/team/project/pull/7' })).toEqual({
    action: 'deny',
  })
  expect(fixture.sent).toHaveBeenCalledWith('links:open', 'https://github.com/team/project/pull/7')
  expect(fixture.answer).not.toHaveBeenCalled()
})

it('shows only one fallback dialog while the app chooser is unavailable', async () => {
  const { offerLink } = await import('./links')
  const parent = new BrowserWindow()
  let finish = (_answer: { response: number }) => {}
  fixture.answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = offerLink(parent, 'https://example.com/')
  await offerLink(parent, 'https://example.com/')
  expect(fixture.answer).toHaveBeenCalledOnce()
  finish({ response: 2 })
  await first
})

it('queues cold-start external links until Studio is ready and delivers once', async () => {
  const { queueExternalLinks, flushExternalLinks, setLinkReceiver } = await import('./links')
  const parent = new BrowserWindow()
  queueExternalLinks([
    '--flag',
    'javascript:alert(1)',
    'dovo-studio://open?url=javascript%3Aalert(1)',
    'http://runtime.lan/call',
    'dovo-studio://open?url=https%3A%2F%2Fteams.microsoft.com%2Fcall',
  ])
  await flushExternalLinks(parent)
  expect(fixture.sent).not.toHaveBeenCalled()
  setLinkReceiver(parent.webContents, true)
  await flushExternalLinks(parent)
  await flushExternalLinks(parent)
  expect(fixture.sent.mock.calls).toEqual([
    ['links:open', 'http://runtime.lan/call'],
    ['links:open', 'https://teams.microsoft.com/call'],
  ])
  expect(fixture.answer).not.toHaveBeenCalled()
})

it('routes each external link independently before falling back to the chooser', async () => {
  const { queueExternalLinks, flushExternalLinks, setLinkReceiver } = await import('./links')
  const parent = new BrowserWindow()
  setLinkReceiver(parent.webContents, true)
  const route = vi.fn<(url: string) => Promise<boolean>>(async (url) =>
    url.includes('teams.microsoft.com'),
  )
  queueExternalLinks([
    'https://teams.microsoft.com/first',
    'https://teams.microsoft.com/second',
    'http://runtime.lan/',
  ])
  await flushExternalLinks(parent, route)
  expect(route).toHaveBeenCalledTimes(3)
  expect(fixture.sent.mock.calls).toEqual([['links:open', 'http://runtime.lan/']])
})
