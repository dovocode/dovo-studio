import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { summarizeTask, type JobRun } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { RemoteMcpEvents } from './remote-mcp-events.js'

it('keeps event IDs and replay positions across restarts and reports retention gaps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-mcp-events-'))
  const path = join(directory, 'runtime.sqlite')
  let db = openDatabase(path)
  try {
    const task = summarizeTask({
      id: 'thread',
      title: 'Thread',
      agentId: 'agent',
      repositoryId: 'project',
      status: 'running',
      createdAt: new Date().toISOString(),
      draft: '',
      files: [],
      messages: [],
      example: false,
    })
    let events = new RemoteMcpEvents(db)
    const filter = { name: 'thread.needs_input', maxEvents: 1 } as const
    const { cursor } = events.poll(filter)
    events.needsInput(task, 'question', 'question')
    events.needsInput(task, 'question', 'question')
    events.needsInput(task, 'approval', 'approval')
    const first = events.poll({ ...filter, cursor })
    expect(first).toMatchObject({
      truncated: false,
      hasMore: true,
      events: [{ data: { requestId: 'question', kind: 'question' } }],
    })

    db.close()
    db = openDatabase(path)
    events = new RemoteMcpEvents(db)
    expect(events.poll({ ...filter, cursor })).toEqual(first)
    const second = events.poll({ ...filter, cursor: first.cursor })
    expect(second).toMatchObject({
      truncated: false,
      hasMore: false,
      events: [{ data: { requestId: 'approval', kind: 'approval' } }],
    })
    expect(events.poll({ ...filter, cursor: second.cursor }).events).toEqual([])

    for (let index = 0; index < 1000; index++)
      events.needsInput(task, `request-${index}`, 'question')
    expect(events.poll({ ...filter, cursor })).toMatchObject({
      truncated: true,
      hasMore: true,
      events: [{ data: { requestId: 'request-0' } }],
    })
    expect(events.poll(filter).events).toEqual([])
  } finally {
    if (db.open) db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('deduplicates automation events and filters by run and automation', () => {
  const db = openDatabase(':memory:')
  try {
    const events = new RemoteMcpEvents(db)
    const run: JobRun = {
      id: 'selected',
      automationId: 'flow',
      status: 'waiting',
      waitingNodeId: 'review',
      completedNodes: [],
      taskIds: [],
      createdAt: '2026-11-24T08:00:00.000Z',
      attempt: 2,
      steps: [{ nodeId: 'review', label: 'Review', kind: 'review', status: 'waiting', attempt: 3 }],
    }
    const review = { name: 'automation.needs_review', arguments: { runIds: ['selected'] } } as const
    const finished = {
      name: 'automation.run_finished',
      arguments: { automationIds: ['flow'] },
    } as const
    const reviews = events.poll({ name: review.name }).cursor
    const completions = events.poll({ name: finished.name }).cursor
    events.automationChanged(run)
    events.automationChanged(run)
    events.automationChanged({ ...run, id: 'other' })
    expect(
      events.poll({
        name: review.name,
        arguments: { ...review.arguments, runIds: ['selected'] },
        cursor: reviews,
      }).events,
    ).toMatchObject([
      {
        data: {
          runId: run.id,
          automationId: run.automationId,
          stepId: 'review',
          stepAttempt: 3,
          attempt: 2,
        },
      },
    ])
    events.automationChanged({ ...run, status: 'failed' }, run)
    events.automationChanged({ ...run, status: 'completed', attempt: 3 }, run)
    events.automationChanged({
      ...run,
      status: 'completed',
      automationId: 'other-flow',
      id: 'third',
    })
    expect(
      events.poll({
        name: finished.name,
        arguments: { automationIds: ['flow'] },
        cursor: completions,
      }).events,
    ).toMatchObject([
      { data: { runId: run.id, attempt: 2, outcome: 'failed' } },
      { data: { runId: run.id, attempt: 3, outcome: 'completed' } },
    ])
  } finally {
    db.close()
  }
})
