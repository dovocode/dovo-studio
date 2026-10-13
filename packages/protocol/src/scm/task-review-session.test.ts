import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createTaskReviewSession, type TaskReviewSessionState } from './task-review-session.js'
import type { TaskReviewReport } from './task-review.js'
afterEach(() => vi.useRealTimers())
const empty: TaskReviewReport = {
  reviews: [],
  commands: [],
  current: false,
  evidenceLimited: false,
  approved: false,
}
it('keeps newer action results when an older read finishes and stops publishing after unmount', async () => {
  let resolve!: (value: TaskReviewReport) => void
  const read = new Promise<TaskReviewReport>((done) => (resolve = done)),
    states: TaskReviewSessionState[] = []
  const updated = { ...empty, current: true }
  const request = vi.fn<(path: string) => Promise<TaskReviewReport>>(async (path) =>
    path.endsWith('/read') ? read : updated,
  )
  const session = createTaskReviewSession('task', request, (state) => states.push(state))
  session.visibility(true)
  await session.run('finding', { findingId: 'finding', status: 'resolved' })
  resolve(empty)
  await read
  await Promise.resolve()
  expect(states.at(-1)?.report?.current).toBe(true)
  session.stop()
  const count = states.length
  session.visibility(true)
  await session.refresh()
  expect(states).toHaveLength(count)
})
it('pauses reads while hidden and exposes failures without changing the last report', async () => {
  const publish = vi.fn<(state: TaskReviewSessionState) => void>(),
    request = vi.fn<() => Promise<TaskReviewReport>>(async () => empty)
  const session = createTaskReviewSession('task', request, publish)
  await session.refresh()
  expect(request).not.toHaveBeenCalled()
  session.visibility(true)
  await Promise.resolve()
  await Promise.resolve()
  request.mockRejectedValueOnce(new Error('Host unavailable'))
  await session.run('start', { requestId: 'request' })
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({
    report: empty,
    busy: false,
    error: 'Host unavailable',
  })
  session.stop()
})
