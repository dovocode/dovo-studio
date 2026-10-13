import { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { OwnedProcessShutdownError, stopOwnedChild } from './stop-owned-child'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('confirms a late group exit without retrying signals or killing a reused PID', async () => {
  vi.useFakeTimers()
  let alive = true
  const kill = vi.fn<typeof process.kill>(() => {
    if (!alive) throw Object.assign(new Error('Process not found'), { code: 'ESRCH' })
    return true
  })
  vi.stubGlobal('process', { ...process, platform: 'linux', kill })
  const child = new ChildProcess()
  Object.assign(child, { pid: 123 })
  const stopping = stopOwnedChild(child)
  const failed = stopping.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(2000)
  const error = await failed
  if (!(error instanceof OwnedProcessShutdownError)) throw new Error('Expected shutdown error')
  let confirmed = false
  void error.confirmed?.then(() => {
    confirmed = true
  })
  expect(stopOwnedChild(child)).toBe(stopping)
  // The launcher can be gone while a descendant still holds the process group.
  Object.assign(child, { signalCode: 'SIGKILL' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(confirmed).toBe(false)
  expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([
    [-123, 'SIGTERM'],
    [-123, 'SIGKILL'],
  ])
  alive = false
  await vi.advanceTimersByTimeAsync(250)
  expect(confirmed).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  kill.mockClear()
  alive = true // Another process could now reuse that PID.
  await expect(stopOwnedChild(child)).resolves.toBeUndefined()
  expect(kill).not.toHaveBeenCalled()
})

it('keeps ownership when late probes cannot confirm that the group is gone', async () => {
  vi.useFakeTimers()
  let denied = false
  const kill = vi.fn<typeof process.kill>(() => {
    if (denied) throw Object.assign(new Error('Access denied'), { code: 'EPERM' })
    return true
  })
  vi.stubGlobal('process', { ...process, platform: 'linux', kill })
  const child = new ChildProcess()
  Object.assign(child, { pid: 124 })
  const failed = stopOwnedChild(child).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(2000)
  const error = await failed
  if (!(error instanceof OwnedProcessShutdownError)) throw new Error('Expected shutdown error')
  let confirmed = false
  void error.confirmed?.then(() => {
    confirmed = true
  })
  denied = true
  await vi.advanceTimersByTimeAsync(1000)
  expect(confirmed).toBe(false)
  expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toHaveLength(2)
})
