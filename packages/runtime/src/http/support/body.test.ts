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
