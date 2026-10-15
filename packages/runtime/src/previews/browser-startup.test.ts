import { afterEach, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn<() => Promise<string>>(),
  dispose: vi.fn<() => Promise<void>>(),
  launch: vi.fn<() => Promise<ReturnType<typeof browser>>>(),
}))
vi.mock('./chromium-installation.js', () => ({
  ChromiumInstallation: class {
    ensure = mocks.ensure
    dispose = mocks.dispose
  },
}))
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }))
import { RemoteBrowsers } from './browser.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function browser() {
  return {
    once: vi.fn<(event: string, listener: () => void) => void>(),
    close: vi.fn<() => Promise<void>>(async () => {}),
  }
}
afterEach(() => {
  vi.resetAllMocks()
})

it('shares startup before installation and Chromium launch finish', async () => {
  const executable = deferred<string>()
  const launched = deferred<ReturnType<typeof browser>>()
  mocks.ensure.mockReturnValue(executable.promise)
  mocks.launch.mockReturnValue(launched.promise)
  const browsers = new RemoteBrowsers()
  const first = browsers['launch']()
  const second = browsers['launch']()
  expect(first).toBe(second)
  await vi.waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1))
  executable.resolve('/managed/chromium')
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1))
  expect(browsers['launch']()).toBe(first)
  const instance = browser()
  launched.resolve(instance)
  expect(await first).toBe(instance)
  expect(await second).toBe(instance)
  expect(mocks.launch).toHaveBeenCalledWith({
    executablePath: '/managed/chromium',
    headless: true,
    chromiumSandbox: true,
  })
  await browsers.dispose()
  expect(instance.close).toHaveBeenCalledTimes(1)
})

it('retries explicit requests after installation and launch failures', async () => {
  mocks.ensure
    .mockRejectedValueOnce(new Error('Download failed'))
    .mockResolvedValue('/managed/chromium')
  mocks.launch.mockRejectedValueOnce(new Error('Launch failed')).mockResolvedValue(browser())
  const browsers = new RemoteBrowsers()
  const first = browsers['launch']()
  expect(browsers['launch']()).toBe(first)
  await expect(first).rejects.toThrow('Chromium installation failed: Download failed')
  expect(mocks.launch).not.toHaveBeenCalled()
  await expect(browsers['launch']()).rejects.toThrow('Launch failed')
  await expect(browsers['launch']()).resolves.toBeDefined()
  expect(mocks.ensure).toHaveBeenCalledTimes(3)
  expect(mocks.launch).toHaveBeenCalledTimes(2)
  await browsers.dispose()
})

it('does not launch Chromium after disposal during executable preparation', async () => {
  const executable = deferred<string>()
  mocks.ensure.mockReturnValue(executable.promise)
  const browsers = new RemoteBrowsers()
  const startup = browsers['launch']().catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1))
  const disposed = browsers.dispose()
  executable.resolve('/managed/chromium')
  expect(await startup).toMatchObject({ message: 'Runtime is shutting down' })
  await disposed
  expect(mocks.launch).not.toHaveBeenCalled()
  await expect(browsers['launch']()).rejects.toThrow('shutting down')
})

it('closes Chromium that finishes launching during disposal', async () => {
  mocks.ensure.mockResolvedValue('/managed/chromium')
  const launched = deferred<ReturnType<typeof browser>>()
  mocks.launch.mockReturnValue(launched.promise)
  const browsers = new RemoteBrowsers()
  const startup = browsers['launch']().catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1))
  const disposed = browsers.dispose()
  const instance = browser()
  launched.resolve(instance)
  expect(await startup).toMatchObject({ message: 'Runtime is shutting down' })
  await disposed
  expect(instance.close).toHaveBeenCalledTimes(1)
})

it('completes disposal when an in-flight launch fails', async () => {
  mocks.ensure.mockResolvedValue('/managed/chromium')
  let rejectLaunch!: (error: Error) => void
  mocks.launch.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectLaunch = reject
    }),
  )
  const browsers = new RemoteBrowsers()
  const startup = browsers['launch']().catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1))
  const disposed = browsers.dispose()
  rejectLaunch(new Error('Launch failed'))
  expect(await startup).toEqual(new Error('Launch failed'))
  await disposed
})

it('does not let an old disconnected callback clear a replacement browser', async () => {
  mocks.ensure.mockResolvedValue('/managed/chromium')
  const first = browser()
  const second = browser()
  mocks.launch.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const browsers = new RemoteBrowsers()
  await browsers['launch']()
  const disconnect = first.once.mock.calls[0]![1]
  disconnect()
  const replacement = browsers['launch']()
  await replacement
  disconnect()
  expect(browsers['launch']()).toBe(replacement)
  expect(mocks.launch).toHaveBeenCalledTimes(2)
  await browsers.dispose()
})
