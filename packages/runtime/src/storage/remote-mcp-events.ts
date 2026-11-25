import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  decode,
  remoteMcpEventSchema,
  type RemoteMcpEvent,
  type RemoteMcpEventPage,
  type RemoteMcpEventPoll,
  type TaskSummary,
  type JobRun,
} from '@dovo/protocol'

const retainedEvents = 1000

export class RemoteMcpEvents {
  private readonly epoch: string

  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_mcp_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    )`)
    db.prepare('INSERT OR IGNORE INTO documents VALUES (?, ?)').run(
      'remote-mcp-events-epoch',
      randomUUID(),
    )
    this.epoch = db
      .prepare<[string], string>('SELECT value FROM documents WHERE id=?')
      .pluck()
      .get('remote-mcp-events-epoch')!
  }

  turnFinished(previous: TaskSummary | undefined, task: TaskSummary) {
    if (task.example || task.replica || previous?.status !== 'running' || task.status === 'running')
      return
    const before = previous.history.latestTurn
    const turn = task.history.latestTurn
    if (
      !turn?.finishedAt ||
      turn.status === 'running' ||
      turn.id !== before?.id ||
      (previous.activeRunId
        ? previous.activeRunId !== turn.id
        : before.status !== 'running' && previous.runPhase !== 'finalizing')
    )
      return
    const name = 'thread.turn_finished'
    this.record({
      name,
      eventId: this.id(name, task.id, turn.id),
      timestamp: turn.finishedAt,
      data: {
        threadId: task.id,
        projectId: task.repositoryId || null,
        turnId: turn.id,
        outcome: turn.status,
      },
    })
  }

  needsInput(task: TaskSummary, requestId: string, kind: 'question' | 'approval') {
    if (task.example || task.replica) return
    const name = 'thread.needs_input'
    this.record({
      name,
      eventId: this.id(name, task.id, requestId, kind),
      timestamp: new Date().toISOString(),
      data: { threadId: task.id, projectId: task.repositoryId || null, requestId, kind },
    })
  }

  automationChanged(run: JobRun, previous?: JobRun) {
    const common = { runId: run.id, automationId: run.automationId, attempt: run.attempt ?? 1 }
    if (run.status === 'waiting' && run.waitingNodeId) {
      const review = run.steps?.find(
        (step) => step.nodeId === run.waitingNodeId && step.kind === 'review' && !step.waitsForCi,
      )
      if (!review) return
      const older = previous?.steps?.find((step) => step.nodeId === review.nodeId)
      if (
        previous?.status === 'waiting' &&
        previous.waitingNodeId === review.nodeId &&
        previous.attempt === run.attempt &&
        older?.attempt === review.attempt
      )
        return
      const name = 'automation.needs_review'
      this.record({
        name,
        eventId: this.id(
          name,
          run.id,
          String(common.attempt),
          review.nodeId,
          String(review.attempt),
        ),
        timestamp: run.updatedAt ?? run.createdAt,
        data: { ...common, stepId: review.nodeId, stepAttempt: review.attempt || 1 },
      })
    } else if (
      (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') &&
      (previous?.status !== run.status || previous.attempt !== run.attempt)
    ) {
      const name = 'automation.run_finished'
      this.record({
        name,
        eventId: this.id(name, run.id, String(common.attempt), run.status),
        timestamp: run.finishedAt ?? run.updatedAt ?? run.createdAt,
        data: { ...common, outcome: run.status },
      })
    }
  }

  poll(request: RemoteMcpEventPoll): RemoteMcpEventPage {
    const { first, last } = this.db
      .prepare<[], { first: number; last: number }>(
        'SELECT COALESCE(MIN(sequence), 1) AS first, COALESCE(MAX(sequence), 0) AS last FROM remote_mcp_events',
      )
      .get()!
    const cursorAt = (sequence: number) => `${this.epoch}.${sequence}`
    const [epoch, offset, extra] = request.cursor?.split('.') ?? []
    const position = offset && /^\d+$/.test(offset) ? Number(offset) : NaN
    const valid =
      epoch === this.epoch &&
      extra === undefined &&
      Number.isSafeInteger(position) &&
      position <= last
    let truncated = request.cursor != null && (!valid || position < first - 1)
    const from = request.cursor == null ? last : valid ? position : first - 1
    const limit = request.maxEvents ?? 50
    const earliest = request.maxAgeMs === undefined ? -Infinity : Date.now() - request.maxAgeMs
    const filter = request.arguments
    const events: RemoteMcpEvent[] = []
    let after = from
    let hasMore = false
    const rows = this.db
      .prepare<[number, string], { sequence: number; value: string }>(
        'SELECT sequence, value FROM remote_mcp_events WHERE sequence > ? AND name = ? ORDER BY sequence',
      )
      .all(from, request.name)
    for (const row of rows) {
      const event = decode(remoteMcpEventSchema, JSON.parse(row.value))
      const data = event.data
      if ('threadId' in data) {
        if (
          (filter?.threadIds && !filter.threadIds.includes(data.threadId)) ||
          (filter?.projectIds &&
            (data.projectId === null || !filter.projectIds.includes(data.projectId)))
        )
          continue
      } else if (
        (filter?.automationIds && !filter.automationIds.includes(data.automationId)) ||
        (filter?.runIds && !filter.runIds.includes(data.runId))
      )
        continue
      if (Date.parse(event.timestamp) < earliest) {
        truncated = true
        continue
      }
      if (events.length === limit) {
        hasMore = true
        break
      }
      events.push(event)
      after = row.sequence
    }
    return {
      resultType: 'complete',
      events,
      cursor: cursorAt(hasMore ? after : last),
      truncated,
      hasMore,
      nextPollMs: 30000,
    }
  }

  private id(...parts: string[]) {
    return 'evt_' + createHash('sha256').update(JSON.stringify(parts)).digest('base64url')
  }

  private record(event: RemoteMcpEvent) {
    this.db.transaction(() => {
      const inserted = this.db
        .prepare(
          'INSERT INTO remote_mcp_events (id, name, value) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM remote_mcp_events WHERE id = ?)',
        )
        .run(event.eventId, event.name, JSON.stringify(event), event.eventId)
      if (inserted.changes)
        this.db
          .prepare('DELETE FROM remote_mcp_events WHERE sequence <= ?')
          .run(Number(inserted.lastInsertRowid) - retainedEvents)
    })()
  }
}
