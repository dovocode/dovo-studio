import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import {
  applySnapshotDelta,
  snapshotDelta,
  snapshotDeltaSchema,
  activityDelta,
  applyActivityDelta,
  activityDeltaSchema,
} from './sync.js'
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

it('omits unchanged metadata and ID lists from lean packets while preserving the legacy format', () => {
  const previous = snapshot(),
    next = snapshot()
  next.revision++
  next.workspace.tasks[0]!.messages[0]!.text += 'More'
  const lean = decode(
    snapshotDeltaSchema,
    JSON.parse(JSON.stringify(snapshotDelta(previous, next, true))),
  )
  expect(lean.state).toBeUndefined()
  expect(lean.workspace.metadata).toBeUndefined()
  expect(lean.workspace.tasks?.order).toBeUndefined()
  expect(lean.workspace.tasks?.changes[0]?.messages?.order).toBeUndefined()
  expect(applySnapshotDelta(previous, lean)).toEqual(next)
  const legacy = snapshotDelta(previous, next)
  expect(legacy.state?.revision).toBe(next.revision)
  expect(legacy.workspace.tasks?.order).toEqual(['one', 'two'])
  expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(legacy).length)
})
it('keeps lean reorders, removals and optional metadata deletion authoritative', () => {
  const previous = snapshot(),
    next = snapshot()
  previous.workspace.tasks[0]!.pinned = true
  previous.runtimeHost = 'Removed host'
  next.workspace.tasks.reverse()
  next.workspace.tasks[0]!.messages = []
  expect(
    applySnapshotDelta(previous, decode(snapshotDeltaSchema, snapshotDelta(previous, next, true))),
  ).toEqual(next)
})

it('does not retransmit turn history when only text and the task timestamp change', () => {
  const previous = snapshot(),
    next = snapshot()
  next.workspace.tasks[0]!.updatedAt = '2026-10-01T12:00:00Z'
  next.workspace.tasks[0]!.messages[0]!.text += 'Latest'
  const delta = snapshotDelta(previous, next, true)
  expect(delta.workspace.tasks?.changes[0]?.fields).toBeUndefined()
  expect(delta.workspace.tasks?.changes[0]?.updatedAt).toBe('2026-10-01T12:00:00Z')
  expect(applySnapshotDelta(previous, decode(snapshotDeltaSchema, delta))).toEqual(next)
})

it('patches task fields without repeating unchanged file history and removes optional values', () => {
  const previous = snapshot()
  const task = previous.workspace.tasks[0]!
  task.error = 'Old error'
  task.files = [
    {
      path: 'large.txt',
      before: 'Before '.repeat(10000),
      after: 'After '.repeat(10000),
      viewed: false,
    },
  ]
  const next = {
    ...previous,
    revision: 2,
    workspace: {
      ...previous.workspace,
      tasks: previous.workspace.tasks.map((task, index) =>
        index === 0 ? { ...task, draft: 'New draft', error: undefined } : task,
      ),
    },
  }
  const legacy = snapshotDelta(previous, next, true)
  const delta = decode(
    snapshotDeltaSchema,
    JSON.parse(JSON.stringify(snapshotDelta(previous, next, true, true))),
  )
  expect(delta.workspace.tasks?.changes[0]?.fields).toBeUndefined()
  expect(delta.workspace.tasks?.changes[0]?.fieldDelta).toEqual({
    values: { draft: 'New draft' },
    removed: ['error'],
  })
  expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(legacy).length / 100)
  const restored = applySnapshotDelta(previous, delta)
  expect(restored).toEqual(next)
  expect(restored.workspace.tasks[1]).toBe(previous.workspace.tasks[1])
  expect(restored.workspace.tasks[0]?.files).toBe(task.files)
  expect(task.error).toBe('Old error')
  expect(() =>
    applySnapshotDelta({ ...previous, workspace: { ...previous.workspace, tasks: [] } }, delta),
  ).toThrow('baseline')
})

it('sends a small splice for streamed tool or reasoning JSON instead of repeating its payload', () => {
  const before = [
    {
      id: 'tool',
      time: '2026-10-01',
      kind: 'reasoning',
      scope: 'thread',
      summary: 'Reasoning',
      payload: JSON.stringify({ text: 'Reasoning '.repeat(10000), status: 'running' }),
    },
  ]
  const next = [
    {
      ...before[0]!,
      payload: JSON.stringify({
        text: 'Reasoning '.repeat(10000) + 'Another thought',
        status: 'running',
      }),
    },
  ]
  const delta = decode(activityDeltaSchema, JSON.parse(JSON.stringify(activityDelta(before, next))))
  expect(delta.order).toBeUndefined()
  expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(next).length / 20)
  expect(applyActivityDelta(before, delta, 'thread')).toEqual(next)
  expect(() =>
    applyActivityDelta([{ ...before[0]!, payload: 'Wrong baseline' }], delta, 'thread'),
  ).toThrow('baseline')
  expect(applyActivityDelta(before, activityDelta(before, []), 'thread')).toEqual([])
})
