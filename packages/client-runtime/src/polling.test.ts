import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { startPolling } from './polling.js'

afterEach(() => vi.useRealTimers())

it('coalesces foreground wakeups, prevents overlaps, and cancels the active worker', async () => {
  vi.useFakeTimers()
  let active = 0
  let peak = 0
  let calls = 0
  let released = 0
  const poller = startPolling(
    Effect.acquireUseRelease(
      Effect.sync(() => {
        calls++
        peak = Math.max(peak, ++active)
      }),
      () => Effect.sleep(100),
      () =>
        Effect.sync(() => {
          active--
          released++
        }),
    ),
    {
      interval: 10,
      onError: () => {
        throw new Error('Unexpected error')
      },
    },
  )
  await vi.advanceTimersByTimeAsync(50)
  poller.refresh()
  poller.refresh()
  expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(51)
  expect(calls).toBe(2)
  expect(peak).toBe(1)
  await poller.stop()
  expect(active).toBe(0)
  expect(released).toBe(2)
  poller.refresh()
  await vi.advanceTimersByTimeAsync(1000)
  expect(calls).toBe(2)
})

it('reports a failed read and continues the next scheduled read', async () => {
  vi.useFakeTimers()
  const errors: string[] = []
  let calls = 0
  const poller = startPolling(
    Effect.suspend(() => (++calls === 1 ? Effect.fail('offline') : Effect.void)),
    { interval: 10, onError: (error) => errors.push(error) },
  )
  await vi.advanceTimersByTimeAsync(21)
  expect(errors).toEqual(['offline'])
  expect(calls).toBe(3)
  await poller.stop()
})
