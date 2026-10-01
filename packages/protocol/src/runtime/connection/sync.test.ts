import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import { applySnapshotDelta, snapshotDelta, snapshotDeltaSchema } from './sync.js'
const snapshot = () =>
  decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      automations: [],
      tasks: ['one', 'two'].map((id) => ({
        id,
        title: id,
        repositoryId: '',
        agentId: '',
        status: 'draft',
        createdAt: '2026-10-01',
        messages: [{ id: `${id}-reply`, role: 'assistant', text: 'History '.repeat(10000) }],
        files: [],
        draft: '',
        example: false,
      })),
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
it('streams appends without repeating history and preserves untouched threads', () => {
  const previous = snapshot(),
    next = snapshot()
  next.revision++
  next.workspace.tasks[0]!.messages[0]!.text += 'Next word'
  const wire = JSON.stringify(snapshotDelta(previous, next))
  const result = applySnapshotDelta(previous, decode(snapshotDeltaSchema, JSON.parse(wire)))
  expect(result).toEqual(next)
  expect(result.workspace.tasks[1]).toBe(previous.workspace.tasks[1])
  expect(previous.workspace.tasks[0]!.messages[0]!.text).not.toContain('Next word')
  expect(wire.length).toBeLessThan(JSON.stringify(next).length / 20)
})
it('keeps removals, order, replacement text and optional fields authoritative', () => {
  const previous = snapshot(),
    next = snapshot()
  previous.workspace.tasks[0]!.pinned = true
  next.workspace.tasks[0]!.messages = [
    { id: 'new', role: 'user', text: 'New question' },
    { ...next.workspace.tasks[0]!.messages[0]!, text: 'Replaced' },
  ]
  next.workspace.tasks.reverse()
  expect(applySnapshotDelta(previous, snapshotDelta(previous, next))).toEqual(next)
  next.workspace.tasks.pop()
  next.workspace.tasks[0]!.messages = []
  expect(applySnapshotDelta(previous, snapshotDelta(previous, next))).toEqual(next)
})
it('adds threads and refuses to guess through a missing append baseline', () => {
  const previous = snapshot(),
    next = snapshot()
  previous.workspace.tasks = []
  expect(applySnapshotDelta(previous, snapshotDelta(previous, next))).toEqual(next)
  const before = snapshot()
  next.workspace.tasks[0]!.messages[0]!.text += ' appended'
  const delta = snapshotDelta(before, next)
  before.workspace.tasks[0]!.messages[0]!.text = 'Wrong baseline'
  expect(() => applySnapshotDelta(before, delta)).toThrow('baseline')
})
