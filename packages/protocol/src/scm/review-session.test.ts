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

it('fences held guide moves after source invalidation and refreshes immediately once the mutation settles', async () => {
  vi.useFakeTimers()
  const updates: ReviewSessionState[] = []
  let finish!: (value: ReviewProgress) => void
  const newer = { ...progress, revision: 'new-revision' }
  const request = vi.fn<(path: string) => Promise<ReviewProgress>>(async (path) =>
    path.endsWith('/guide')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : newer,
  )
  const session = createReviewSession(
    { kind: 'task', taskId: 'task', source: 'working' },
    request,
    (state) => updates.push(state),
  )
  await session.refresh()
  const pending = session.moveGuide({ id: 'guide', version: 0, position: 1, reviewed: 0 })
  expect(updates.at(-1)?.busy).toBe(true)
  expect(await session.moveGuide({ id: 'guide', version: 0, position: 1 })).toBe(false)
  session.invalidate()
  finish(progress)
  expect(await pending).toBe(false)
  expect(updates.at(-1)?.progress).toBeNull()
  await vi.advanceTimersByTimeAsync(0)
  expect(updates.at(-1)?.progress?.revision).toBe('new-revision')
  expect(updates.at(-1)?.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(1)
  session.stop()
})
it('ignores an older read after adopting generated progress and releases all state on stop', async () => {
  vi.useFakeTimers()
  let finish!: (value: ReviewProgress) => void
  const updates: ReviewSessionState[] = []
  const session = createReviewSession(
    { kind: 'task', taskId: 'task', source: 'working' },
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    (state) => updates.push(state),
  )
  const pending = session.refresh()
  const generated = { ...progress, revision: 'generated' }
  session.adopt(generated)
  finish(progress)
  await pending
  expect(updates.at(-1)?.progress?.revision).toBe('generated')
  session.stop()
  const count = updates.length
  session.adopt(progress)
  expect(await session.moveGuide({ id: 'guide', version: 0, position: 0 })).toBe(false)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updates).toHaveLength(count)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['before', 'after'])(
  'keeps a newer viewed mark when guided generation arrives %s its response',
  async (order) => {
    vi.useFakeTimers()
    const updates: ReviewSessionState[] = []
    let finish!: (value: ReviewProgress) => void
    const initial = { ...progress, revision: 'same-revision' }
    const marked = { ...initial, files: [{ ...initial.files[0], viewed: true, version: 2 }] }
    let server = initial
    const session = createReviewSession(
      { kind: 'task', taskId: 'task', source: 'working' },
      async (path) =>
        path.endsWith('/set')
          ? new Promise((resolve) => {
              finish = resolve
            })
          : server,
      (state) => updates.push(state),
    )
    await session.refresh()
    const pending = session.set('a.ts', 'hash', true)
    if (order === 'before') session.adopt(initial)
    server = marked
    finish(marked)
    await pending
    if (order === 'after') session.adopt(initial)
    expect(updates.at(-1)?.progress?.files[0]).toMatchObject({ viewed: true, version: 2 })
    session.stop()
  },
)

const step = (title: string) => ({
  title,
  summary: `${title} summary`,
  impact: `${title} impact`,
  paths: ['a.ts'],
  excerpts: [],
  questions: [],
})
const guided = (id: string, version = 0): ReviewProgress => ({
  ...progress,
  revision: 'revision',
  guide: {
    id,
    revision: 'revision',
    generatedAt: '2026-10-30T00:00:00.000Z',
    steps: [step(`${id} first`), step(`${id} second`)],
    position: version,
    seen: [],
    version,
  },
})
const compact = (id: string, version: number): ReviewProgress => ({
  ...progress,
  revision: 'revision',
  guideState: { id, revision: 'revision', position: version, seen: [0], version },
})
it('names a held guide only after a runtime sent one and restores its steps and groups', async () => {
  const inputs: unknown[] = []
  const responses = [progress, guided('one'), compact('one', 1)]
  const updates: ReviewSessionState[] = []
  const context = { kind: 'task', taskId: 'task', source: 'working' } as const
  const session = createReviewSession(
    context,
    async (_path, input) => {
      inputs.push(input)
      return responses.shift()!
    },
    (state) => updates.push(state),
  )
  // A runtime without guides never receives the unknown field.
  await session.refresh()
  await session.refresh()
  expect(updates.at(-1)?.progress?.groups.map((group) => group.label)).toEqual([
    'one first',
    'one second',
  ])
  await session.refresh()
  expect(inputs).toEqual([{ context }, { context }, { context, knownGuide: 'one' }])
  expect(updates.at(-1)?.progress?.guide).toEqual({
    ...guided('one').guide,
    position: 1,
    seen: [0],
    version: 1,
  })
  expect(updates.at(-1)?.progress?.groups).toHaveLength(2)
  expect(updates.at(-1)?.progress?.guideState).toBeUndefined()
  session.stop()
})
it('keeps a newer adopted guide and the newest guide version when compact responses race', async () => {
  let finish!: (value: ReviewProgress) => void
  const updates: ReviewSessionState[] = []
  let server = guided('one')
  const session = createReviewSession(
    { kind: 'task', taskId: 'task', source: 'working' },
    async (path) =>
      path.endsWith('/set')
        ? new Promise((resolve) => {
            finish = resolve
          })
        : server,
    (state) => updates.push(state),
  )
  await session.refresh()
  // A mark sent while holding guide one returns compact state after a new guide was adopted.
  const pending = session.set('a.ts', 'hash', true)
  session.adopt(guided('two'))
  finish({ ...compact('one', 0), files: [{ ...progress.files[0], viewed: true, version: 2 }] })
  await pending
  expect(updates.at(-1)?.progress?.guide?.id).toBe('two')
  expect(updates.at(-1)?.progress?.groups.map((group) => group.label)).toEqual([
    'two first',
    'two second',
  ])
  expect(updates.at(-1)?.progress?.files[0]).toMatchObject({ viewed: true, version: 2 })
  // A poll answered before a move landed cannot roll the guide back.
  server = guided('two', 3)
  await session.refresh()
  server = compact('two', 2)
  await session.refresh()
  expect(updates.at(-1)?.progress?.guide).toMatchObject({ id: 'two', version: 3 })
  session.stop()
})
it('falls back to one complete read when compact state names a guide it does not hold', async () => {
  const inputs: unknown[] = []
  const responses = [compact('missing', 1), guided('missing', 1)]
  const updates: ReviewSessionState[] = []
  const context = { kind: 'pull', repositoryId: 'repo', number: 1 } as const
  const session = createReviewSession(
    context,
    async (_path, input) => {
      inputs.push(input)
      return responses.shift()!
    },
    (state) => updates.push(state),
  )
  await session.refresh()
  expect(inputs).toEqual([{ context }, { context }])
  expect(updates.at(-1)?.progress?.guide?.steps).toHaveLength(2)
  expect(updates.at(-1)?.error).toBe('')
  session.stop()
})
