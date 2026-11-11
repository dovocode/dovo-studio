import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import { defaultTaskHarness, resolveTaskAgent, type TaskTurn } from '../../workspace.js'
import { runtimeDefaultsSchema } from './runtime-setup.js'
import {
  applySnapshotDelta,
  snapshotDelta,
  snapshotDeltaSchema,
  activityDelta,
  applyActivityDelta,
  activityDeltaSchema,
  syncFrameSchema,
  type SnapshotDelta,
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
const turn = (id: string): TaskTurn => ({
  id,
  assistantId: `${id}-reply`,
  agentId: '',
  provider: 'codex',
  model: 'fixture',
  startedAt: '2026-10-01',
  status: 'running',
})
it.each([false, true])(
  'reconciles incremental state and turn fields without repeating unchanged bodies (compact %s)',
  (compact) => {
    const previous = snapshot()
    previous.runtimeHost = 'Old name'
    previous.defaults = decode(runtimeDefaultsSchema, { setupCommand: 'setup\n'.repeat(3000) })
    const task = previous.workspace.tasks[0]!
    task.turns = [
      { ...turn('completed'), status: 'completed' },
      {
        ...turn('active'),
        error: 'Previous error',
        checkpoint: {
          before: 'commit',
          files: [
            { path: 'source.ts', before: '', after: 'source\n'.repeat(10000), viewed: false },
          ],
          omitted: [],
        },
      },
    ]
    const next = {
      ...previous,
      revision: 2,
      runtimeHost: undefined,
      detailTaskIds: ['one'],
      workspace: {
        ...previous.workspace,
        tasks: [
          {
            ...task,
            turns: [task.turns[0]!, { ...task.turns[1]!, tokens: 100, error: undefined }],
          },
          previous.workspace.tasks[1]!,
        ],
      },
    }
    const delta = decode(
      snapshotDeltaSchema,
      JSON.parse(JSON.stringify(snapshotDelta(previous, next, compact, true, true))),
    )
    expect(delta.state).toBeUndefined()
    expect(delta.stateDelta).toEqual({
      values: { detailTaskIds: ['one'] },
      removed: ['runtimeHost'],
    })
    expect(delta.workspace.tasks?.changes[0]?.fieldDelta).toBeUndefined()
    expect(delta.workspace.tasks?.changes[0]?.turns).toEqual({
      changes: [{ id: 'active', fieldDelta: { values: { tokens: 100 }, removed: ['error'] } }],
    })
    const restored = applySnapshotDelta(previous, delta)
    expect(restored).toEqual(next)
    expect(restored.defaults).toBe(previous.defaults)
    expect(restored.workspace.tasks[0]?.turns?.[0]).toBe(task.turns[0])
    expect(restored.workspace.tasks[0]?.turns?.[1]?.checkpoint).toBe(task.turns[1]?.checkpoint)
    expect(restored.workspace.tasks[1]).toBe(previous.workspace.tasks[1])
    const legacy = snapshotDelta(previous, next, compact, true)
    expect(legacy.state?.defaults).toEqual(previous.defaults)
    expect(legacy.workspace.tasks?.changes[0]?.fieldDelta?.values.turns).toEqual(
      next.workspace.tasks[0]?.turns,
    )
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(legacy).length / 100)
  },
)
it.each([false, true])(
  'patches review fields without repeating file bodies (compact %s)',
  (compact) => {
    const previous = snapshot()
    const task = previous.workspace.tasks[0]!
    task.files = ['a.ts', 'b.ts'].map((path) => ({
      path,
      before: 'before\n'.repeat(10000),
      after: 'after\n'.repeat(10000),
      diskContents: 'after\n'.repeat(10000),
      viewed: false,
    }))
    const next = {
      ...previous,
      revision: 2,
      workspace: {
        ...previous.workspace,
        tasks: [
          {
            ...task,
            files: task.files.map((file, index) =>
              index === 0 ? { ...file, viewed: true, diskContents: undefined } : file,
            ),
          },
          previous.workspace.tasks[1]!,
        ],
      },
    }
    const delta = decode(
      snapshotDeltaSchema,
      JSON.parse(JSON.stringify(snapshotDelta(previous, next, compact, true, true, true))),
    )
    const change = delta.workspace.tasks?.changes[0]
    expect(change?.fieldDelta).toBeUndefined()
    expect(change?.files).toEqual({
      changes: [
        { path: 'a.ts', fieldDelta: { values: { viewed: true }, removed: ['diskContents'] } },
      ],
    })
    const restored = applySnapshotDelta(previous, delta)
    expect(restored).toEqual(next)
    expect(restored.workspace.tasks[0]?.files[1]).toBe(task.files[1])
    const legacy = snapshotDelta(previous, next, compact, true, true)
    expect(legacy.workspace.tasks?.changes[0]?.files).toBeUndefined()
    expect(legacy.workspace.tasks?.changes[0]?.fieldDelta?.values.files).toEqual(
      next.workspace.tasks[0]?.files,
    )
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(legacy).length / 100)
  },
)
it('keeps file membership, rename, order and content replacement exact after JSON transport', () => {
  let previous = snapshot()
  const file = (path: string, after = path) => ({ path, before: '', after, viewed: false })
  for (const files of [
    [file('a'), file('b')],
    [file('b'), file('a', 'edited')],
    [file('renamed'), file('b')],
    [],
    [file('a')],
  ]) {
    const next = {
      ...previous,
      revision: previous.revision + 1,
      workspace: {
        ...previous.workspace,
        tasks: previous.workspace.tasks.map((task) =>
          task.id === 'one' ? { ...task, files } : task,
        ),
      },
    }
    const delta = decode(
      snapshotDeltaSchema,
      JSON.parse(JSON.stringify(snapshotDelta(previous, next, true, true, true, true))),
    )
    previous = applySnapshotDelta(previous, delta)
    expect(previous).toEqual(next)
  }
})
it('falls back to atomic files for duplicate paths and sends complete files for new tasks', () => {
  const previous = snapshot()
  const task = previous.workspace.tasks[0]!
  const file = { path: 'same', before: '', after: 'contents', viewed: false }
  const next = {
    ...previous,
    workspace: {
      ...previous.workspace,
      tasks: [
        { ...task, files: [file, file] },
        { ...task, id: 'new', files: [file] },
      ],
    },
  }
  const delta = snapshotDelta(previous, next, true, true, true, true)
  expect(delta.workspace.tasks?.changes[0]?.files).toBeUndefined()
  expect(delta.workspace.tasks?.changes[0]?.fieldDelta?.values.files).toEqual([file, file])
  expect(delta.workspace.tasks?.changes[1]?.fields?.files).toEqual([file])
  expect(applySnapshotDelta(previous, delta)).toEqual(next)
})
it('rejects invalid file baselines, identities and orders for full resync', () => {
  const previous = snapshot()
  const file = { path: 'a', before: '', after: 'body', viewed: false }
  previous.workspace.tasks[0]!.files = [file]
  const invalid: Array<
    NonNullable<NonNullable<SnapshotDelta['workspace']['tasks']>['changes'][number]['files']>
  > = [
    { changes: [{ path: 'missing', fieldDelta: { values: { viewed: true }, removed: [] } }] },
    { changes: [{ path: 'a', fields: { ...file, path: 'wrong' } }] },
    { changes: [{ path: 'a', fields: file, fieldDelta: { values: {}, removed: [] } }] },
    { changes: [{ path: 'new', fields: { ...file, path: 'new' } }] },
    { changes: [{ path: 'a', fieldDelta: { values: {}, removed: ['after'] } }] },
    {
      changes: [
        { path: 'a', fields: file },
        { path: 'a', fields: file },
      ],
    },
    { order: ['missing'], changes: [] },
    { order: ['a', 'a'], changes: [] },
    { order: [], changes: [{ path: 'a', fields: file }] },
  ]
  for (const files of invalid) {
    expect(() =>
      applySnapshotDelta(previous, { workspace: { tasks: { changes: [{ id: 'one', files }] } } }),
    ).toThrow(/Sync file|Schema validation failed/)
  }
  expect(() =>
    applySnapshotDelta(previous, {
      workspace: {
        tasks: {
          changes: [
            {
              id: 'one',
              files: { changes: [] },
              fieldDelta: { values: { files: [] }, removed: [] },
            },
          ],
        },
      },
    }),
  ).toThrow('ambiguous')
  expect(() =>
    applySnapshotDelta(previous, {
      workspace: { tasks: { changes: [{ id: 'missing', files: { changes: [] } }] } },
    }),
  ).toThrow('missing')
})
it('retains the whole workspace when only runtime metadata changes', () => {
  const previous = snapshot()
  const next = { ...previous, runtimeHost: 'Renamed computer' }
  const restored = applySnapshotDelta(previous, snapshotDelta(previous, next, true, true, true))
  expect(restored).toEqual(next)
  expect(restored.workspace).toBe(previous.workspace)
})
it('retains thread collections when only workspace metadata changes', () => {
  const previous = snapshot()
  const next = {
    ...previous,
    workspace: { ...previous.workspace, runtimeAddress: 'http://paired.lan:8787' },
  }
  const restored = applySnapshotDelta(previous, snapshotDelta(previous, next, true, true, true))
  expect(restored).toEqual(next)
  expect(restored.workspace.tasks).toBe(previous.workspace.tasks)
  expect(restored.workspace.agents).toBe(previous.workspace.agents)
  expect(restored.workspace.repositories).toBe(previous.workspace.repositories)
  expect(restored.workspace.automations).toBe(previous.workspace.automations)
})
it('keeps turn membership, order and optional removal exact across incremental updates', () => {
  let previous = snapshot()
  for (const turns of [[], [turn('a'), turn('b')], [turn('c'), turn('a')], [], undefined]) {
    const next = {
      ...previous,
      revision: previous.revision + 1,
      workspace: {
        ...previous.workspace,
        tasks: previous.workspace.tasks.map((task) =>
          task.id === 'one' ? { ...task, turns } : task,
        ),
      },
    }
    const delta = decode(
      snapshotDeltaSchema,
      JSON.parse(JSON.stringify(snapshotDelta(previous, next, true, true, true))),
    )
    previous = applySnapshotDelta(previous, delta)
    expect(previous).toEqual(next)
  }
})
it('rejects missing or ambiguous incremental baselines instead of silently losing updates', () => {
  const previous = snapshot()
  previous.workspace.tasks[0]!.turns = [turn('active')]
  expect(() =>
    applySnapshotDelta(previous, { workspace: {}, stateDelta: { values: {}, removed: ['owner'] } }),
  ).toThrow('Schema validation failed')
  expect(() =>
    applySnapshotDelta(previous, {
      workspace: {},
      state: previous,
      stateDelta: { values: {}, removed: [] },
    }),
  ).toThrow('ambiguous')
  for (const turns of [
    { changes: [{ id: 'missing', fieldDelta: { values: { tokens: 1 }, removed: [] } }] },
    { changes: [{ id: 'active', fields: turn('other') }] },
    {
      changes: [{ id: 'active', fields: turn('active'), fieldDelta: { values: {}, removed: [] } }],
    },
    { changes: [{ id: 'new', fields: turn('new') }] },
    { order: ['missing'], changes: [] },
    { order: ['active', 'active'], changes: [] },
  ]) {
    expect(() =>
      applySnapshotDelta(previous, { workspace: { tasks: { changes: [{ id: 'one', turns }] } } }),
    ).toThrow('Sync turn')
  }
  expect(() =>
    applySnapshotDelta(previous, {
      workspace: {
        tasks: {
          changes: [
            { id: 'one', turns: { changes: [] }, fieldDelta: { values: {}, removed: ['turns'] } },
          ],
        },
      },
    }),
  ).toThrow('ambiguous')
})
it('avoids serializing reused array items and still sends replacement file contents', () => {
  const previous = snapshot()
  const file = {
    path: 'file.txt',
    before: 'a'.repeat(8192),
    after: 'b'.repeat(8192),
    viewed: false,
  }
  previous.workspace.tasks[0]!.files = [file]
  const serialize = vi.fn<() => typeof file>(() => ({ ...file }))
  Object.defineProperty(file, 'toJSON', { value: serialize })
  const task = previous.workspace.tasks[0]!
  const next = {
    ...previous,
    revision: 2,
    workspace: {
      ...previous.workspace,
      tasks: [
        {
          ...task,
          files: [...task.files],
          messages: task.messages.map((message) => ({ ...message, text: message.text + 'stream' })),
        },
        previous.workspace.tasks[1]!,
      ],
    },
  }
  const delta = snapshotDelta(previous, next, true, true)
  expect(serialize).not.toHaveBeenCalled()
  expect(delta.workspace.tasks?.changes[0]?.fieldDelta).toBeUndefined()
  expect(applySnapshotDelta(previous, delta)).toEqual(next)
  const changed = {
    ...next,
    workspace: {
      ...next.workspace,
      tasks: [
        { ...next.workspace.tasks[0]!, files: [{ ...file, after: 'changed' }] },
        next.workspace.tasks[1]!,
      ],
    },
  }
  const changedDelta = snapshotDelta(next, changed, true, true)
  expect(changedDelta.workspace.tasks?.changes[0]?.fieldDelta?.values.files).toEqual(
    changed.workspace.tasks[0]!.files,
  )
  expect(applySnapshotDelta(next, changedDelta)).toEqual(changed)
})
it.each(['standalone', 'custom agent'] as const)(
  'preserves a manually selected model through send and streaming deltas for a %s',
  (selection) => {
    let previous = snapshot()
    const task = previous.workspace.tasks[0]!
    task.harnessCustomized = true
    task.harness = { ...defaultTaskHarness('codex'), model: 'configured-default' }
    if (selection === 'standalone') task.harness.model = 'manually-selected'
    else {
      task.agentId = 'custom'
      task.agentOverrides = { model: 'manually-selected', reasoning: 'high' }
    }
    for (const status of ['running', 'review'] as const) {
      const next = {
        ...previous,
        revision: previous.revision + 1,
        workspace: {
          ...previous.workspace,
          tasks: previous.workspace.tasks.map((task, index) =>
            index === 0
              ? {
                  ...task,
                  status,
                  draft: '',
                  messages: [...task.messages, { id: status, role: 'user' as const, text: 'Send' }],
                }
              : task,
          ),
        },
      }
      const frame = decode(
        syncFrameSchema,
        JSON.parse(
          JSON.stringify({
            type: 'delta',
            epoch: 'runtime',
            sequence: next.revision,
            base: previous.revision,
            tag: 'updated',
            delta: snapshotDelta(previous, next, true, true),
          }),
        ),
      )
      if (frame.type !== 'delta') throw new Error('Expected delta')
      previous = applySnapshotDelta(previous, frame.delta)
      expect(previous).toEqual(next)
      expect(resolveTaskAgent(previous.workspace.tasks[0]!, [])?.model).toBe('manually-selected')
    }
  },
)
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
  expect(restored.workspace.tasks[0]?.messages).toBe(task.messages)
  expect(task.error).toBe('Old error')
  expect(() =>
    applySnapshotDelta({ ...previous, workspace: { ...previous.workspace, tasks: [] } }, delta),
  ).toThrow('baseline')
})

it.each([false, true])(
  'does not serialize shared file contents for compact=%s updates',
  (compact) => {
    const previous = snapshot()
    const task = previous.workspace.tasks[0]!
    let reads = 0
    task.files = [{ path: 'large.txt', before: '', after: 'After', viewed: false }]
    Object.defineProperty(task.files[0], 'before', {
      enumerable: true,
      get() {
        reads++
        return 'Before '.repeat(10000)
      },
    })
    const next = {
      ...previous,
      revision: 2,
      workspace: {
        ...previous.workspace,
        tasks: previous.workspace.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                draft: 'New draft',
                messages: task.messages.map((message) => ({
                  ...message,
                  text: message.text + 'Next',
                })),
              }
            : task,
        ),
      },
    }
    const delta = snapshotDelta(previous, next, compact, true)
    expect(reads).toBe(0)
    expect(delta.workspace.tasks?.changes[0]?.fieldDelta?.values).toEqual({ draft: 'New draft' })
    expect(delta.workspace.tasks?.changes[0]?.messages?.changes[0]?.text).toEqual({
      length: task.messages[0]!.text.length,
      append: 'Next',
    })
  },
)

it('compares replacement nested fields and treats missing optional values as undefined', () => {
  const previous = snapshot()
  const task = previous.workspace.tasks[0]!
  task.error = undefined
  task.files = [{ path: 'file.txt', before: 'Before', after: 'After', viewed: false }]
  const { error: _error, ...withoutError } = task
  const next = {
    ...previous,
    workspace: {
      ...previous.workspace,
      tasks: [
        { ...withoutError, files: task.files.map((file) => ({ ...file })) },
        previous.workspace.tasks[1]!,
      ],
    },
  }
  expect(snapshotDelta(previous, next, true, true).workspace.tasks).toBeUndefined()
  next.workspace.tasks[0]!.files[0]!.after = 'Changed'
  const delta = snapshotDelta(previous, next, true, true)
  expect(delta.workspace.tasks?.changes[0]?.fieldDelta?.values.files?.[0]?.after).toBe('Changed')
  expect(applySnapshotDelta(previous, delta)).toEqual(next)
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

it('streams a computer icon change even when the workspace revision is unchanged', () => {
  const previous = snapshot(),
    next = snapshot()
  previous.runtimeIcon = 'desktop'
  next.runtimeIcon = 'server'
  const wire = JSON.stringify(snapshotDelta(previous, next, true))
  const updated = applySnapshotDelta(previous, decode(snapshotDeltaSchema, JSON.parse(wire)))
  expect(updated.runtimeIcon).toBe('server')
  expect(updated).toEqual(next)
})
