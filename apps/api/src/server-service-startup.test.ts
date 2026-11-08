import { afterEach, expect, it, vi } from 'vite-plus/test'
import { serverStatus, runtimeStartupTimeoutMs } from './server-manager'
import { waitForRuntime } from './server-service'

vi.mock('./server-manager', async (original) => ({
  ...(await original<typeof import('./server-manager')>()),
  serverStatus: vi.fn<typeof serverStatus>(),
}))
vi.mock('node:timers/promises', () => ({
  setTimeout: async (milliseconds: number) => {
    vi.setSystemTime(Date.now() + milliseconds)
  },
}))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

const status = (running: boolean, pid?: number): Awaited<ReturnType<typeof serverStatus>> => ({
  running,
  pid,
  managed: false,
  startedAt: undefined,
  address: undefined,
  addresses: [],
  host: '127.0.0.1',
  port: 8787,
  configuredHost: '127.0.0.1',
  configuredPort: 8787,
  databasePath: '/fixture/runtime.sqlite',
  logPath: '/fixture/server.log',
  ...(!running ? { error: 'Runtime is stopped' } : {}),
})

it('allows a cold database startup beyond the former 30-second activation deadline', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.mocked(serverStatus).mockImplementation(async () => status(Date.now() >= 100_000, 123))
  expect(await waitForRuntime('/fixture', 122)).toMatchObject({ running: true, pid: 123 })
  expect(Date.now()).toBe(100_000)
})

it('never accepts the previous runtime and still fails within the startup budget', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.mocked(serverStatus).mockResolvedValue(status(true, 122))
  await expect(waitForRuntime('/fixture', 122)).rejects.toThrow(
    'runtime process 122 has not changed from 122',
  )
  expect(Date.now()).toBe(runtimeStartupTimeoutMs)
})

it('reports a failed startup after the bounded wait', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.mocked(serverStatus).mockResolvedValue(status(false))
  await expect(waitForRuntime('/fixture')).rejects.toThrow('Runtime is stopped')
  expect(Date.now()).toBe(runtimeStartupTimeoutMs)
})
