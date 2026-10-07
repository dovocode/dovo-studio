import { expect, it, vi } from 'vite-plus/test'
import { ProgressBuffer } from './progress-buffer'
it('coalesces progress by item and flushes it before a terminal boundary', () => {
  const failed = vi.fn<(cause: unknown) => void>(),
    writes: string[] = []
  const buffer = new ProgressBuffer(failed)
  for (let index = 0; index < 100; index++)
    buffer.put('tool', 10, () => writes.push(`progress${index}`))
  buffer.put('other', 10, () => writes.push('other'))
  buffer.flush()
  writes.push('completed')
  expect(writes).toEqual(['progress99', 'other', 'completed'])
  expect(failed).not.toHaveBeenCalled()
})
it('flushes bounded buffers and reports timer storage errors to the owning run', () => {
  vi.useFakeTimers()
  try {
    const failed = vi.fn<(cause: unknown) => void>(),
      writes = vi.fn<() => void>()
    const buffer = new ProgressBuffer(failed)
    buffer.put('large', 1024 * 1024, writes)
    expect(writes).toHaveBeenCalledOnce()
    buffer.put('next', 1, () => {
      throw new Error('Disk full')
    })
    vi.advanceTimersByTime(50)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'Disk full' }))
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
