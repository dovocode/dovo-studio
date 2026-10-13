import { afterEach, expect, it, vi } from 'vite-plus/test'
const mocks = vi.hoisted(() => ({
  exists: vi.fn<(path: string) => boolean>(),
  exec: vi.fn<
    (
      file: string,
      args: string[],
      options: { signal: AbortSignal },
    ) => Promise<{ stdout: string; stderr: string }>
  >(),
}))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))
vi.mock('../process.js', () => ({ exec: mocks.exec }))
vi.mock('playwright', () => ({
  chromium: { executablePath: () => '/cache/chromium-current/chrome' },
}))
import { ChromiumInstallation } from './chromium-installation.js'
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
it('skips installation when the required revision exists', async () => {
  mocks.exists.mockReturnValue(true)
  expect(await new ChromiumInstallation().ensure()).toBe('/cache/chromium-current/chrome')
  expect(mocks.exec).not.toHaveBeenCalled()
})
it('installs a missing required revision once for concurrent requests using bundled Node', async () => {
  mocks.exists.mockReturnValueOnce(false).mockReturnValue(true)
  mocks.exec.mockResolvedValue({ stdout: '', stderr: '' })
  const installation = new ChromiumInstallation()
  await Promise.all([installation.ensure(), installation.ensure()])
  expect(mocks.exec).toHaveBeenCalledTimes(1)
  expect(mocks.exec).toHaveBeenCalledWith(
    process.execPath,
    [expect.stringMatching(/cli\.js$/), 'install', 'chromium'],
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
})
it('surfaces download failures and permits a subsequent explicit request to retry', async () => {
  mocks.exists.mockReturnValue(false)
  mocks.exec.mockRejectedValueOnce(new Error('Download unavailable'))
  const installation = new ChromiumInstallation()
  await expect(installation.ensure()).rejects.toThrow('Download unavailable')
  mocks.exists.mockReturnValueOnce(false).mockReturnValue(true)
  mocks.exec.mockResolvedValue({ stdout: '', stderr: '' })
  await expect(installation.ensure()).resolves.toBe('/cache/chromium-current/chrome')
})
it('honors an explicitly configured browser and prevents work after shutdown', async () => {
  vi.stubEnv('DOVO_BROWSER_EXECUTABLE', '/custom/chrome')
  const installation = new ChromiumInstallation()
  expect(await installation.ensure()).toBe('/custom/chrome')
  expect(mocks.exec).not.toHaveBeenCalled()
  await installation.dispose()
  await expect(installation.ensure()).rejects.toThrow('shutting down')
})
it('cancels an active installer during runtime shutdown', async () => {
  mocks.exists.mockReturnValue(false)
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  mocks.exec.mockImplementation(
    (_file, _args, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
        started()
      }),
  )
  const installation = new ChromiumInstallation()
  const pending = installation.ensure()
  const rejected = pending.catch((error: unknown) => error)
  await ready
  await installation.dispose()
  expect(await rejected).toEqual(new Error('Aborted'))
})
