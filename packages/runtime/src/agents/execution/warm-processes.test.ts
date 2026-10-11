import { afterEach, expect, it, vi } from 'vite-plus/test'
const memory = vi.hoisted(() => ({ free: 1024 ** 3, total: 64 * 1024 ** 3 }))
vi.mock('node:os', () => ({ freemem: () => memory.free, totalmem: () => memory.total }))
import { IdleProviders, releaseIdleProvider } from './warm-processes.js'
const pools: Array<IdleProviders<{ working: boolean }>> = []
function pool() {
  const close = vi.fn<(value: { working: boolean }) => Promise<void>>(async () => {})
  const idle = new IdleProviders(close, (value) => value.working)
  pools.push(idle)
  return { idle, close }
}
afterEach(() => {
  for (const idle of pools.splice(0)) idle.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  memory.free = 1024 ** 3
})
it('bounds idle providers across harnesses and releases all idle transports under pressure', async () => {
  const first = pool(),
    second = pool()
  for (let index = 0; index < 6; index++)
    (index < 3 ? first : second).idle.set(`task-${index}`, { working: false })
  await second.idle.prune(false)
  expect([...first.idle.values(), ...second.idle.values()]).toHaveLength(4)
  expect(first.close).toHaveBeenCalledTimes(2)
  await second.idle.prune(true)
  expect([...first.idle.values(), ...second.idle.values()]).toHaveLength(0)
  expect(first.close.mock.calls.length + second.close.mock.calls.length).toBe(6)
})
it('reports another harness cleanup failure without rejecting a successful turn', async () => {
  const failing = pool(),
    current = pool()
  const failure = new Error('old provider shutdown failed')
  failing.close.mockRejectedValue(failure)
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  failing.idle.set('old', { working: false })
  current.idle.set('successful', { working: false })
  await expect(current.idle.prune(true)).resolves.toBeUndefined()
  expect(current.close).toHaveBeenCalledOnce()
  expect(report).toHaveBeenCalledWith(
    'Could not clean up idle agent providers:',
    expect.any(AggregateError),
  )
  expect([...failing.idle.values(), ...current.idle.values()]).toEqual([])
})
it('expires idle providers without another turn and never expires a transport in use', async () => {
  vi.useFakeTimers()
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    ...process.memoryUsage(),
    rss: 100 * 1024 ** 2,
  })
  const { idle, close } = pool()
  idle.set('idle', { working: false })
  idle.set('in-use', { working: false })
  idle.delete('in-use')
  await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
  expect(close).toHaveBeenCalledOnce()
  expect([...idle.values()]).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})
it('defers child release until its native agents finish', async () => {
  const { idle, close } = pool()
  const session = { working: true }
  idle.set('child', session)
  await idle.release('child')
  await idle.prune(true)
  expect(close).not.toHaveBeenCalled()
  expect(idle.get('child')).toBe(session)
  session.working = false
  await idle.prune(false)
  expect(close).toHaveBeenCalledWith(session)
  expect(idle.get('child')).toBeUndefined()
})
it('retains idle providers while host and runtime memory remain available', () => {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    ...process.memoryUsage(),
    rss: 100 * 1024 ** 2,
  })
  expect(releaseIdleProvider()).toBe(false)
})
it('releases idle providers when the host has little free memory', () => {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    ...process.memoryUsage(),
    rss: 100 * 1024 ** 2,
  })
  memory.free = 256 * 1024 ** 2
  expect(releaseIdleProvider()).toBe(true)
})
it('releases idle providers when the runtime exceeds its memory budget', () => {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({ ...process.memoryUsage(), rss: 2 * 1024 ** 3 })
  expect(releaseIdleProvider()).toBe(true)
})
