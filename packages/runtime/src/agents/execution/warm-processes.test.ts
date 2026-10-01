import { afterEach, expect, it, vi } from 'vitest'
const memory = vi.hoisted(() => ({ free: 1024 ** 3, total: 64 * 1024 ** 3 }))
vi.mock('node:os', () => ({ freemem: () => memory.free, totalmem: () => memory.total }))
import { releaseIdleProvider } from './warm-processes.js'
afterEach(() => {
  vi.restoreAllMocks()
  memory.free = 1024 ** 3
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
