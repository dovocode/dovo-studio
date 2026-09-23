import { expect, it } from 'vitest'
import { Approvals } from '../agents/approvals'
import { Activity, redact } from './activity'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
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
    const upgraded = new Activity(db)
    const encoded = JSON.stringify(upgraded.list('', '', 0))
    expect(encoded).not.toContain('historical-secret')
    expect(encoded).not.toContain('historical-key')
    expect(encoded).not.toContain('historical-error-secret')
  } finally {
    db.close()
  }
})
