import { expect, it } from 'vite-plus/test'
import { snapshotTag } from './body.js'

it('invalidates snapshot tags for nested task contents, shell, order and device metadata', () => {
  const a = { id: 'a', messages: [{ text: 'hello' }], files: [{ after: 'one' }] }
  const b = { id: 'b', messages: [], files: [] }
  const before = { workspace: { tasks: [a, b], repositories: [] }, owner: true }
  const tag = snapshotTag(before)
  expect(snapshotTag(structuredClone(before))).toBe(tag)
  for (const tasks of [
    [b, a],
    [a],
    [a, b, { ...b, id: 'c' }],
    [{ ...a, messages: [{ text: 'changed' }] }, b],
    [{ ...a, files: [{ after: 'two' }] }, b],
    [{ ...a, queue: [{ text: 'next' }] }, b],
  ])
    expect(snapshotTag({ ...before, workspace: { ...before.workspace, tasks } })).not.toBe(tag)
  expect(snapshotTag({ ...before, owner: false })).not.toBe(tag)
  expect(snapshotTag({ ...before, workspace: { ...before.workspace, version: 2 } })).not.toBe(tag)
  expect(snapshotTag(undefined)).toBeUndefined()
})

it('does not reserialize an unchanged task while another thread streams', () => {
  let reads = 0
  const unchanged = {
    id: 'old',
    get messages() {
      reads++
      return [{ text: 'history' }]
    },
  }
  const first = { id: 'streaming', messages: [{ text: 'first' }] }
  const workspace = { tasks: [unchanged, first] }
  const tag = snapshotTag({ workspace })
  expect(reads).toBe(1)
  const next = { ...workspace, tasks: [unchanged, { ...first, messages: [{ text: 'next' }] }] }
  expect(snapshotTag({ workspace: next })).not.toBe(tag)
  expect(reads).toBe(1)
  expect(snapshotTag({ workspace: { ...workspace, tasks: [...workspace.tasks] } })).toBe(tag)
  expect(reads).toBe(1)
})

it('reuses unchanged nested files and workspace data when the active task streams', () => {
  let fileReads = 0
  let repositoryReads = 0
  const file = {
    path: 'source',
    get after() {
      fileReads++
      return 'large body'
    },
  }
  const files = [file]
  const repository = {
    id: 'repo',
    get icon() {
      repositoryReads++
      return 'large icon'
    },
  }
  const repositories = [repository]
  const task = { id: 'one', files, messages: [{ text: 'first' }] }
  const workspace = { tasks: [task], repositories }
  const first = snapshotTag({ workspace })
  const streamed = snapshotTag({
    workspace: { ...workspace, tasks: [{ ...task, messages: [{ text: 'second' }] }] },
  })
  expect(streamed).not.toBe(first)
  expect(fileReads).toBe(1)
  expect(repositoryReads).toBe(1)
  const reviewed = snapshotTag({
    workspace: {
      ...workspace,
      tasks: [{ ...task, files: [{ path: 'source', after: 'large body', viewed: true }] }],
    },
  })
  expect(reviewed).not.toBe(first)
  expect(fileReads).toBe(1)
})
it('keeps JSON absence semantics and separates nested data from digest-shaped values', () => {
  const tag = (value: object) => snapshotTag({ workspace: value })
  expect(tag({ tasks: [], extra: undefined })).toBe(tag({ tasks: [] }))
  expect(tag({ tasks: [], values: [undefined] })).toBe(tag({ tasks: [], values: [null] }))
  expect(tag({ tasks: [], values: [] })).not.toBe(tag({ tasks: [], values: {} }))
  expect(tag({ tasks: [], values: ['digest', 'x'] })).not.toBe(tag({ tasks: [], values: 'x' }))
  expect(tag({ tasks: [], values: { a: 1, b: 2 } })).not.toBe(
    tag({ tasks: [], values: { b: 2, a: 1 } }),
  )
})
it('reads changing runtime state even when service collections reuse their identity', () => {
  const workspace = { tasks: [] }
  const runs = [{ status: 'running' }]
  const before = snapshotTag({ workspace, runs })
  runs[0]!.status = 'completed'
  expect(snapshotTag({ workspace, runs })).not.toBe(before)
})
