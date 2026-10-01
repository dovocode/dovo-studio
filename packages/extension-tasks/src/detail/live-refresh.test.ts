import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startLiveRefresh } from './live-refresh'

class Visibility extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
  set(state: DocumentVisibilityState) {
    this.visibilityState = state
    this.dispatchEvent(new Event('visibilitychange'))
  }
}
afterEach(() => vi.useRealTimers())
it('refreshes periodically, pauses in the background and resumes immediately', async () => {
  vi.useFakeTimers()
  const visibility = new Visibility()
  const action = vi.fn<() => Promise<void>>(async () => {})
  const stop = startLiveRefresh(action, visibility, vi.fn())
  await vi.advanceTimersByTimeAsync(15_000)
  expect(action).toHaveBeenCalledTimes(2)
  visibility.set('hidden')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(action).toHaveBeenCalledTimes(2)
  visibility.set('visible')
  await vi.advanceTimersByTimeAsync(0)
  expect(action).toHaveBeenCalledTimes(3)
  stop()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(action).toHaveBeenCalledTimes(3)
})
it('never overlaps a slow read and stops scheduling when disposed during it', async () => {
  vi.useFakeTimers()
  const visibility = new Visibility()
  let finish: () => void = () => {}
  const action = vi.fn<() => Promise<void>>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const stop = startLiveRefresh(action, visibility, vi.fn())
  visibility.set('hidden')
  visibility.set('visible')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(action).toHaveBeenCalledTimes(1)
  stop()
  finish()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(action).toHaveBeenCalledTimes(1)
})
it('reports errors and keeps future refreshes available', async () => {
  vi.useFakeTimers()
  const visibility = new Visibility()
  const error = new Error('offline')
  const action = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(error)
    .mockResolvedValue(undefined)
  const onError = vi.fn<(error: unknown) => void>()
  const stop = startLiveRefresh(action, visibility, onError)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(onError).toHaveBeenCalledWith(error)
  expect(action).toHaveBeenCalledTimes(2)
  stop()
})
