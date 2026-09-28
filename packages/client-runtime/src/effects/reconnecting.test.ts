import { afterEach, expect, it, vi } from 'vitest'
import { startReconnecting } from './reconnecting.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('retries dropped sessions with fresh attempts and stops all retries when disposed', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const errors: string[] = []
  const connect = vi.fn<() => Promise<void>>(async () => {
    throw new Error('offline')
  })
  const session = startReconnecting(connect, (error) => errors.push(error.message))
  await vi.advanceTimersByTimeAsync(0)
  expect(connect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(999)
  expect(connect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(connect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(2000)
  expect(connect).toHaveBeenCalledTimes(3)
  expect(errors).toEqual(['offline', 'offline', 'offline'])
  await session.stop()
  session.restart()
  await vi.advanceTimersByTimeAsync(60000)
  expect(connect).toHaveBeenCalledTimes(3)
})

it('replaces a stale session on foreground wakeup without overlapping or reporting cancellation', async () => {
  vi.useFakeTimers()
  let active = 0
  let peak = 0
  let attempts = 0
  const errors = vi.fn<(error: Error) => void>()
  const session = startReconnecting(
    (signal, connected) =>
      new Promise<void>((resolve) => {
        attempts++
        peak = Math.max(peak, ++active)
        connected()
        signal.addEventListener(
          'abort',
          () => {
            active--
            resolve()
          },
          { once: true },
        )
      }),
    errors,
  )
  await vi.advanceTimersByTimeAsync(0)
  session.restart()
  session.restart()
  await vi.advanceTimersByTimeAsync(0)
  expect(attempts).toBeGreaterThan(1)
  expect(peak).toBe(1)
  expect(active).toBe(1)
  await session.stop()
  expect(active).toBe(0)
  expect(errors).not.toHaveBeenCalled()
})

it('keeps reconnecting when the error reporter itself throws', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const connect = vi.fn<() => Promise<void>>(async () => {
    throw new Error('offline')
  })
  const session = startReconnecting(connect, () => {
    throw new Error('Reporter failed')
  })
  await vi.advanceTimersByTimeAsync(3000)
  expect(connect).toHaveBeenCalledTimes(3)
  await session.stop()
})
