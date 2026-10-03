import type { AgentAdapter } from '../agents/execution/types'
import { expect, it, vi } from 'vitest'
import { Approvals } from '../agents/execution/approvals'
import { Activity, redact } from './activity'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
it.each(['preparing', 'finalizing', 'provider'] as const)(
  'does not resurrect pruned assistant history when restarting during %s',
  (runPhase) => {
    const db = openDatabase(':memory:')
    try {
      const activity = new Activity(db)
      const store = new WorkspaceStore(db, (before, after) => activity.workspace(before, after))
      store.update((workspace) => ({
        ...workspace,
        tasks: [
          {
            id: 'task',
            title: 'Task',
            repositoryId: '',
            agentId: '',
            status: 'review',
            createdAt: new Date().toISOString(),
            messages: [{ id: 'finished-answer', role: 'assistant', text: 'Pruned answer' }],
            turns: [
              {
                id: 'finished-turn',
                assistantId: 'finished-answer',
                status: 'completed',
                agentId: '',
                provider: 'codex',
                model: '',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              },
            ],
            files: [],
            draft: '',
            example: false,
          },
        ],
      }))
      activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
      store.updateTask('task', (task) => ({
        ...task,
        status: 'running',
        runPhase,
        // A running task without a saved turn gives no evidence that an older reply
        // was in flight. Recovery must not guess from the last message in its history.
        turns: runPhase === 'provider' ? undefined : task.turns,
      }))
      const reopenedActivity = new Activity(db)
      new WorkspaceStore(db, (before, after) => reopenedActivity.workspace(before, after))
      expect(reopenedActivity.list('', 'message', 0).events).toEqual([])
    } finally {
      db.close()
    }
  },
)
it('retains message history after tasks are removed and keeps the streamed message current', () => {
  const db = openDatabase(':memory:')
  try {
    const log = new Activity(db),
      store = new WorkspaceStore(db, (a, b) => log.workspace(a, b))
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Test',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'running',
          createdAt: new Date().toISOString(),
          messages: [{ id: 'm', role: 'assistant', text: 'Hi' }],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    store.updateTask('task', (t) => ({
      ...t,
      messages: [{ id: 'm', role: 'assistant', text: 'Hi there' }],
    }))
    store.update((w) => ({ ...w, tasks: [] }))
    const events = log.list('', 'message', 0).events
    expect(events).toHaveLength(1)
    expect(events[0].payload).toContain('Hi there')
  } finally {
    db.close()
  }
})
it('redacts credentials from structured integration records', () => {
  expect(redact({ token: 'secret', nested: { password: 'hidden' }, text: 'Bearer abc' })).toEqual({
    token: '[redacted]',
    nested: { password: '[redacted]' },
    text: 'Bearer [redacted]',
  })
})

it('retains approval requests and decisions, redacting CLI credentials without losing exit codes', async () => {
  const db = openDatabase(':memory:')
  try {
    const log = new Activity(db)
    const approvals = new Approvals(log)
    const result = approvals.request(
      'task',
      'Run tool',
      'Tool details',
      new AbortController().signal,
    )
    const id = approvals.list()[0].id
    approvals.respond(id, true)
    await expect(result).resolves.toBe(true)
    expect(log.list('', 'approval', 0).events).toHaveLength(2)
    expect(redact({ args: ['cli', '--token', 'private'], exitCode: 1 })).toEqual({
      args: ['cli', '--token', '[redacted]'],
      exitCode: 1,
    })
  } finally {
    db.close()
  }
})

it('remembers exact command approvals per project and allows them after restart', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Project', path: '/tmp/project', branch: 'main' }],
      tasks: [
        {
          id: 'task',
          title: 'Test',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'running',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const approvals = new Approvals(undefined, store)
    const first = approvals.request(
      'task',
      'Run command',
      JSON.stringify({ command: 'pnpm test' }),
      new AbortController().signal,
    )
    approvals.respond(approvals.list()[0].id, true, true)
    await expect(first).resolves.toBe(true)
    expect(store.get().repositories[0].approvedCommands).toEqual(['pnpm test'])
    const reopened = new Approvals(undefined, new WorkspaceStore(db))
    await expect(
      reopened.request(
        'task',
        'Run command',
        JSON.stringify({ command: 'pnpm test' }),
        new AbortController().signal,
      ),
    ).resolves.toBe(true)
    expect(reopened.list()).toHaveLength(0)
    const other = reopened.request(
      'task',
      'Run command',
      JSON.stringify({ command: 'pnpm build' }),
      new AbortController().signal,
    )
    expect(reopened.list()).toHaveLength(1)
    reopened.respond(reopened.list()[0].id, false)
    await expect(other).resolves.toBe(false)
  } finally {
    db.close()
  }
})

it('reads tools and reasoning together while excluding raw diagnostics and other task scopes', () => {
  const db = openDatabase(':memory:')
  try {
    const activity = new Activity(db)
    activity.add('tool', 'one', 'Read file', { toolId: 'tool' }, 'tool')
    activity.add('reasoning', 'one', 'Reasoning', { reasoning: { text: 'First' } }, 'summary')
    activity.add('reasoning', 'one', 'Reasoning', { reasoning: { text: 'Final' } }, 'summary')
    activity.add('agent-event', 'one', 'Raw provider event', {})
    activity.add('reasoning', 'two', 'Other task reasoning', {})
    const rows = activity.list('', 'task-activity', 0, 'one').events
    expect(rows.map((row) => row.kind).sort()).toEqual(['reasoning', 'tool'])
    expect(rows.find((row) => row.id === 'summary')?.payload).toContain('Final')
    expect(activity.list('Final', 'task-activity', 0, 'one').events).toHaveLength(1)
    expect(activity.list('', 'tool', 0, 'one').events).toHaveLength(1)
  } finally {
    db.close()
  }
})

it('redacts historical literal credentials when upgrading the activity database', () => {
  const db = openDatabase(':memory:')
  try {
    new Activity(db)
    db.prepare('DELETE FROM documents WHERE id=?').run('activity-redaction-v3')
    db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?)').run(
      'old',
      new Date().toISOString(),
      'request',
      'mcp',
      'Old request',
      JSON.stringify({
        envValues: { CUSTOM_VALUE: 'historical-secret' },
        'X-API-Key': 'historical-key',
        error: 'env.KEY: Expected string, actual "historical-error-secret"',
      }),
    )
    db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?)').run(
      'corrupt',
      new Date().toISOString(),
      'request',
      'mcp',
      'historical-unknown-secret',
      '{"envValues":{"KEY":"historical-unknown-secret"',
    )
    const upgraded = new Activity(db)
    const encoded = JSON.stringify(upgraded.list('', '', 0))
    expect(encoded).not.toContain('historical-secret')
    expect(encoded).not.toContain('historical-key')
    expect(encoded).not.toContain('historical-error-secret')
    expect(encoded).not.toContain('historical-unknown-secret')
  } finally {
    db.close()
  }
})

it('filters scoped activity without losing tool kinds, search matches, or pagination', () => {
  const db = openDatabase(':memory:')
  try {
    const log = new Activity(db)
    log.add('tool', 'thread', 'Command', { text: 'needle' }, 'a')
    log.add('reasoning', 'thread', 'Thinking', {}, 'b')
    log.add('task-activity', 'thread', 'State', {}, 'c')
    log.add('message', 'thread', 'Message', {}, 'd')
    log.add('tool', 'other', 'Command', { text: 'needle' }, 'e')
    db.prepare('UPDATE activity SET time=?').run('2026-10-01T12:00:00Z')
    expect(log.list('', 'task-activity', 0, 'thread').events.map((item) => item.id)).toEqual([
      'c',
      'b',
      'a',
    ])
    expect(log.list('needle', 'task-activity', 0, 'thread').events.map((item) => item.id)).toEqual([
      'a',
    ])
    expect(log.list('', 'task-activity', 1, 'thread').events.map((item) => item.id)).toEqual([
      'b',
      'a',
    ])
    expect(log.list('', 'tool', 0, 'thread').events.map((item) => item.id)).toEqual(['a'])
    expect(log.list('', '', 0, 'thread').events).toHaveLength(4)
    expect(log.list('', '', 0).events).toHaveLength(5)
  } finally {
    db.close()
  }
})

it('never serializes unchanged historical messages during metadata and streaming updates', () => {
  const db = openDatabase(':memory:')
  try {
    const log = new Activity(db),
      store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Task',
          repositoryId: 'repo',
          agentId: 'agent',
          createdAt: '2026-10-01T00:00:00Z',
          status: 'draft',
          draft: '',
          files: [],
          messages: [
            { id: 'old', role: 'user', text: 'Large history' },
            { id: 'current', role: 'assistant', text: 'First' },
          ],
          example: false,
        },
      ],
    }))
    const before = store.get(),
      task = before.tasks[0]!
    const serialize = vi.fn<() => never>(() => {
      throw new Error('Unchanged history was serialized')
    })
    Object.defineProperty(task.messages[0], 'toJSON', { value: serialize })
    log.workspace(before, {
      ...before,
      tasks: [{ ...task, activity: 'Working', messages: [...task.messages] }],
    })
    log.workspace(before, {
      ...before,
      tasks: [
        { ...task, messages: [task.messages[0]!, { ...task.messages[1]!, text: 'Streamed' }] },
      ],
    })
    expect(serialize).not.toHaveBeenCalled()
    expect(log.list('', 'message', 0).events).toHaveLength(1)
  } finally {
    db.close()
  }
})

it('audits streaming content only at boundaries, completion and removal while history stays live', () => {
  const db = openDatabase(':memory:')
  try {
    const log = new Activity(db)
    const store = new WorkspaceStore(db, (a, b) => log.workspace(a, b))
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'stream',
          title: 'Stream',
          repositoryId: '',
          agentId: '',
          createdAt: new Date().toISOString(),
          status: 'running',
          messages: [{ id: 'answer', role: 'assistant', text: '' }],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const add = vi.spyOn(log, 'add')
    const begin = performance.now()
    for (let index = 1; index <= 100; index++) {
      store.updateTask('stream', (task) => ({
        ...task,
        messages: [{ id: 'answer', role: 'assistant', text: 'x'.repeat(index * 1000) }],
      }))
      expect(store.task('stream').messages[0].text.length).toBe(index * 1000)
    }
    expect(add.mock.calls.filter(([kind]) => kind === 'message')).toHaveLength(0)
    store.updateTask('stream', (task) => ({
      ...task,
      messages: task.messages.map((message) => ({ ...message, textBreaks: [message.text.length] })),
    }))
    store.updateTask('stream', (task) => ({ ...task, status: 'review' }))
    const calls = add.mock.calls.filter(([kind]) => kind === 'message')
    expect(calls).toHaveLength(1)
    const payloadCharacters = calls.reduce((sum, call) => sum + JSON.stringify(call[3]).length, 0)
    expect(payloadCharacters).toBeLessThan(101000)
    console.log(
      JSON.stringify({
        benchmark: 'stream-audit',
        updates: 100,
        messageWrites: calls.length,
        payloadCharacters,
        ms: performance.now() - begin,
      }),
    )
    expect(log.list('', 'message', 0).events[0].payload).toContain('x'.repeat(100000))
  } finally {
    db.close()
  }
})

it('keeps fake-provider streaming history live while auditing only meaningful boundaries', async () => {
  const { startRuntime } = await import('../index')
  const { fixture } = await import('../testing/fixture')
  const f = await fixture()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'stream-audit-test-owner-token-with-32-characters',
    port: 0,
  })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const add = vi.spyOn(s.activity, 'add')
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        for (let index = 0; index < 12; index++) {
          run.onText('x'.repeat(1000))
          await vi.waitFor(() =>
            expect(s.store.task(run.taskId!).messages.at(-1)?.text.length).toBe((index + 1) * 1000),
          )
          if (index === 5) run.onTextBoundary?.()
        }
      },
    })
    const task = s.tasks.create({
      title: 'Stream',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Write',
    })
    await (
      await s.tasks.start(task.id)
    ).done
    expect(s.store.task(task.id).messages.at(-1)?.text).toBe('x'.repeat(12000))
    const writes = add.mock.calls.filter(
      ([kind, , summary]) => kind === 'message' && summary.startsWith('assistant'),
    )
    expect(writes).toHaveLength(2)
    expect(
      s.activity.list('', 'message', 0).events.some((row) => row.summary.startsWith('user')),
    ).toBe(true)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
}, 15000)
