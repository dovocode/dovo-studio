import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { automationSchema, decode } from '@dovo/protocol'
import type { McpEventBatch, McpEventType, McpOccurrence } from '../mcp-events/client.js'
import type { McpAutomationInput } from '../mcp-events/subscriptions.js'
import { HttpError } from '../errors.js'
import { McpEventTriggers } from './mcp-event-triggers.js'

const event: McpEventType = {
  name: 'incident.created',
  delivery: ['poll'],
  inputSchema: true,
  payloadSchema: true,
}
const incident: McpOccurrence = {
  eventId: 'incident-one',
  name: event.name,
  timestamp: '2026-11-23T12:00:00Z',
  data: { incident: 1 },
}
const item = {
  kind: 'trigger',
  label: 'MCP event',
  trigger: 'mcp-event',
  schedule: '',
  timezone: 'UTC',
  objective: '',
  agentId: '',
  repositoryId: '',
}
const flow = () =>
  decode(automationSchema, {
    id: 'flow',
    name: 'Triage',
    enabled: true,
    nodes: [
      {
        id: 'source',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: { ...item, mcpEvent: { server: 'incidents', name: event.name, argumentsJson: '{}' } },
      },
      {
        id: 'bot',
        type: 'automation',
        position: { x: 0, y: 1 },
        data: { ...item, kind: 'task', objective: 'Triage incident', botId: 'selected-bot' },
      },
    ],
    edges: [{ id: 'source-bot', source: 'source', target: 'bot' }],
  })
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})

function fixture() {
  const db = new Database(':memory:')
  cleanup.push(() => {
    db.close()
  })
  db.exec(
    'CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT); CREATE TABLE deliveries (key TEXT PRIMARY KEY)',
  )
  const flows = [flow()]
  const runs: McpAutomationInput[] = []
  let blocked = false
  let failCommit = false
  let identity = 'source-a'
  const poll = vi.fn(
    async (_event: McpEventType, _params: Record<string, unknown>): Promise<McpEventBatch> => ({
      events: [],
      cursor: 'initial',
      truncated: false,
      hasMore: false,
      nextPollMs: 1000,
    }),
  )
  const client = {
    list: vi.fn(async () => [event]),
    validateArguments: vi.fn(),
    poll,
  }
  const report = vi.fn()
  const create = () => {
    const triggers = new McpEventTriggers(
      db,
      () => flows,
      async (botId, server) => {
        expect([botId, server]).toEqual(['selected-bot', 'incidents'])
        return { identity, client }
      },
      (id, key, payload, commit) => {
        if (blocked) throw new HttpError(409, 'Automation is already awaiting review')
        db.transaction(() => {
          db.prepare('INSERT INTO deliveries VALUES (?)').run(id + ':' + key)
          commit()
          if (failCommit) throw new Error('Injected transaction failure')
        })()
        runs.push(payload)
      },
      report,
    )
    cleanup.push(() => triggers.dispose())
    return triggers
  }
  return {
    flows,
    runs,
    poll,
    report,
    create,
    setBlocked: (value: boolean) => {
      blocked = value
    },
    fail: (value: boolean) => {
      failCommit = value
    },
    rotate: () => {
      identity = 'source-b'
    },
  }
}

it('retains events behind review and across restart, then admits each delivery once', async () => {
  const f = fixture()
  const initial = f.create()
  await initial.tick(1000)
  expect(f.poll.mock.calls[0]?.[1]).toMatchObject({ cursor: null })
  f.poll.mockResolvedValue({
    events: [incident],
    cursor: 'next',
    truncated: true,
    hasMore: false,
    nextPollMs: 1000,
  })
  f.setBlocked(true)
  await initial.tick(2000)
  expect(initial.status('flow')).toMatchObject({
    pending: 1,
    gapObserved: true,
    replayAvailable: true,
  })
  expect(f.runs).toEqual([])
  initial.dispose()
  const restarted = f.create()
  expect(restarted.status('flow')).toMatchObject({ pending: 1, gapObserved: true })
  f.setBlocked(false)
  await restarted.tick(3000)
  expect(f.runs).toEqual([{ source: 'mcp-event', server: 'incidents', event: incident }])
  await restarted.tick(4000)
  expect(f.poll.mock.lastCall?.[1]).toMatchObject({ cursor: 'next' })
  expect(f.runs).toHaveLength(1)
  expect(restarted.status('flow').pending).toBe(0)
})

it('does not consume a batch when its run transaction fails', async () => {
  const f = fixture()
  const triggers = f.create()
  await triggers.tick(1000)
  f.poll.mockResolvedValue({
    events: [incident],
    cursor: 'next',
    truncated: false,
    hasMore: false,
    nextPollMs: 1000,
  })
  f.fail(true)
  await triggers.tick(2000)
  expect(triggers.status('flow')).toMatchObject({ pending: 1, retrying: true })
  expect(f.runs).toHaveLength(0)
  f.fail(false)
  await triggers.tick(32000)
  expect(f.runs).toHaveLength(1)
  expect(triggers.status('flow')).toMatchObject({ pending: 0, retrying: false })
})

it('ignores a reply received after disabling and re-enabling the trigger', async () => {
  const f = fixture()
  const triggers = f.create()
  await triggers.tick(1000)
  const reply = Promise.withResolvers<McpEventBatch>()
  f.poll.mockReturnValueOnce(reply.promise)
  const ticking = triggers.tick(2000)
  await vi.waitFor(() => expect(f.poll).toHaveBeenCalledTimes(2))
  f.flows[0].enabled = false
  triggers.reconcile()
  f.flows[0].enabled = true
  triggers.reconcile()
  reply.resolve({
    events: [incident],
    cursor: 'next',
    truncated: false,
    hasMore: false,
    nextPollMs: 1000,
  })
  await ticking
  expect(f.runs).toHaveLength(0)
  await triggers.tick(3000)
  expect(f.poll.mock.lastCall?.[1]).toMatchObject({ cursor: null })
})

it('discards input and cursor from an obsolete source after credential rotation', async () => {
  const f = fixture()
  const triggers = f.create()
  await triggers.tick(1000)
  f.setBlocked(true)
  f.poll.mockResolvedValueOnce({
    events: [incident],
    cursor: 'old-position',
    truncated: false,
    hasMore: false,
    nextPollMs: 1000,
  })
  await triggers.tick(2000)
  expect(triggers.status('flow').pending).toBe(1)
  f.rotate()
  f.setBlocked(false)
  await triggers.tick(3000)
  expect(f.poll.mock.lastCall?.[1]).toMatchObject({ cursor: null })
  expect(triggers.status('flow').pending).toBe(0)
  expect(f.runs).toHaveLength(0)
})
