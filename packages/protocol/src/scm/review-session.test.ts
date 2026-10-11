import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createReviewSession, type ReviewSessionState } from './review-session'
import type { ReviewProgress } from './review'
afterEach(() => vi.useRealTimers())
const progress: ReviewProgress = {
  files: [{ path: 'a.ts', fingerprint: 'hash', viewed: false, version: 1 }],
  groups: [],
}
it('serializes refresh demand, pauses in the background and releases timers after unmount', async () => {
  vi.useFakeTimers()
  const request = vi.fn<() => Promise<ReviewProgress>>(async () => progress),
    updates: ReviewSessionState[] = []
  const session = createReviewSession(
    { kind: 'task', taskId: 'task', source: 'working' },
    request,
    (state) => updates.push(state),
  )
  await session.refresh()
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(request).toHaveBeenCalledTimes(2)
  expect(updates).toHaveLength(1) // Identical polls do not rerender every diff.
  session.visibility(false)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(request).toHaveBeenCalledTimes(2)
  session.visibility(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledTimes(3)
  session.stop()
  expect(vi.getTimerCount()).toBe(0)
})
it('ignores old read replies after a mark, while leaving only one refresh timer', async () => {
  vi.useFakeTimers()
  let resolve!: (value: ReviewProgress) => void
  let calls = 0
  const request = vi.fn<(path: string) => Promise<ReviewProgress>>(async (path) => {
    if (path.endsWith('/set'))
      return { ...progress, files: [{ ...progress.files[0], viewed: true, version: 2 }] }
    if (++calls === 2)
      return new Promise<ReviewProgress>((done) => {
        resolve = done
      })
    return progress
  })
  const updates: ReviewSessionState[] = []
  const session = createReviewSession(
    { kind: 'pull', repositoryId: 'repo', number: 1 },
    request,
    (state) => updates.push(state),
  )
  await session.refresh()
  const pending = session.refresh()
  await session.set('a.ts', 'hash', true)
  resolve(progress)
  await pending
  expect(updates.at(-1)?.progress?.files[0].viewed).toBe(true)
  expect(vi.getTimerCount()).toBe(1)
  session.stop()
})
it('shows mutation failures and allows explicit reload without losing other marks', async () => {
  const updates: ReviewSessionState[] = []
  const session = createReviewSession(
    { kind: 'pull', repositoryId: 'repo', number: 1 },
    async (path) => {
      if (path.endsWith('/set')) throw new Error('File changed')
      return progress
    },
    (state) => updates.push(state),
  )
  await session.refresh()
  await session.set('a.ts', 'hash', true)
  expect(updates.at(-1)?.error).toBe('File changed')
  expect(updates.at(-1)?.progress).toBe(progress)
  await session.refresh()
  expect(updates.at(-1)?.error).toBe('')
  session.stop()
})
