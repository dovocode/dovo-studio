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

it('keeps polling when the error reporter itself throws', async () => {
  vi.useFakeTimers()
  let calls = 0
  const poller = startPolling(
    Effect.suspend(() => (++calls === 1 ? Effect.fail('offline') : Effect.void)),
    {
      interval: 10,
      onError: () => {
        throw new Error('Reporter failed')
      },
    },
  )

  await vi.advanceTimersByTimeAsync(21)
  expect(calls).toBe(3)
  await poller.stop()
})

it('waits a full interval after slow work instead of polling back to back', async () => {
  vi.useFakeTimers()
  let calls = 0
  const poller = startPolling(
    Effect.suspend(() => {
      calls++
      return Effect.sleep(50)
    }),
    { interval: 10, onError: () => {} },
  )
  await vi.advanceTimersByTimeAsync(55)
  expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(5)
  expect(calls).toBe(2)
  await poller.stop()
})

it('backs off an unreachable read, wakes on refresh, and resets after success', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(1)
  let offline = true
  const times: number[] = []
  const poller = startPolling(
    Effect.suspend(() => {
      times.push(Date.now())
      return offline ? Effect.fail('offline') : Effect.void
    }),
    { interval: 10, backoff: 40, onError: () => {} },
  )
  const start = Date.now()
  await vi.advanceTimersByTimeAsync(150)
  // 0, then waits of 20, 40, 40, 40 (capped).
  expect(times.map((time) => time - start)).toEqual([0, 20, 60, 100, 140])
  offline = false
  poller.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(times).toHaveLength(6)
  await vi.advanceTimersByTimeAsync(10)
  expect(times).toHaveLength(7)
  await poller.stop()
  vi.restoreAllMocks()
})
