import type Database from 'better-sqlite3'
import { openDatabase } from '../storage/database.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultGithubTrigger, type Automation } from '@dovo/protocol'
import { GithubTriggers } from './github-triggers.js'
import { HttpError } from '../errors.js'
import type { GithubDelivery, GithubEvents } from './github-events.js'
const databases: Database.Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const epoch = Date.parse('2026-10-04T09:00:00Z')
function setup() {
  const db = openDatabase(':memory:')
  databases.push(db)
  const config = { ...defaultGithubTrigger, repository: 'team/project' }
  const flow: Automation = {
    id: 'flow',
    name: 'Flow',
    enabled: true,
    edges: [],
    nodes: [
      {
        id: 'trigger',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: {
          kind: 'trigger',
          label: 'Start',
          trigger: 'github',
          github: config,
          schedule: '',
          timezone: 'UTC',
          objective: '',
          agentId: '',
          repositoryId: '',
        },
      },
    ],
  }
  const collect = vi.fn<GithubEvents['collect']>().mockResolvedValue({ deliveries: [], heads: {} })
  const start = vi.fn<(id: string, key: string, payload: unknown) => void>(
    (id: string, key: string) => {
      db.prepare('INSERT INTO deliveries VALUES (?,?)').run(
        `${id}:${key}`,
        new Date(epoch).toISOString(),
      )
    },
  )
  const report = vi.fn<(id: string, message: string) => void>()
  const create = () => new GithubTriggers(db, { collect }, () => [flow], start, report)
  return { db, config, flow, collect, start, report, create }
}
function event(id = 'one', at = epoch + 30_000): GithubDelivery {
  return {
    id,
    event: 'issue.created',
    at: new Date(at).toISOString(),
    actor: 'octocat',
    context: { body: 'Event context' },
  }
}
it('starts with new events, overlaps polls without duplicate deliveries, and persists its cursor', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  expect(f.collect).toHaveBeenCalledWith(
    f.config,
    new Date(epoch).toISOString(),
    new Date(epoch).toISOString(),
    {},
  )
  f.collect.mockResolvedValue({ deliveries: [event()], heads: {} })
  await poller.tick(epoch + 60_000)
  expect(f.start).toHaveBeenCalledWith(
    'flow',
    'github:github.com:team/project:issue.created:one',
    event(),
  )
  poller.dispose()
  await f.create().tick(epoch + 120_000)
  expect(f.collect.mock.calls.at(-1)?.[1]).toBe(new Date(epoch).toISOString())
  expect(f.start).toHaveBeenCalledTimes(1)
})
it('retains events while a run is active, drains them even after polling fails, and recovers after restart', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  f.collect.mockResolvedValue({ deliveries: [event(), event('two')], heads: {} })
  f.start.mockImplementation(() => {
    throw new HttpError(409, 'Active run')
  })
  await poller.tick(epoch + 60_000)
  expect(f.start).toHaveBeenCalledTimes(1)
  poller.dispose()
  f.collect.mockRejectedValue(new Error('Offline'))
  f.start.mockImplementation((id, key) => {
    f.db.prepare('INSERT INTO deliveries VALUES (?,?)').run(`${id}:${key}`, 'now')
  })
  await f.create().tick(epoch + 120_000)
  expect(f.start.mock.calls.slice(1).map((call) => call[1])).toEqual([
    'github:github.com:team/project:issue.created:one',
    'github:github.com:team/project:issue.created:two',
  ])
  expect(f.report).toHaveBeenCalledWith('flow', 'GitHub trigger failed: Offline')
})
it('clears queued events on pause and resets progress when settings change', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  f.flow.enabled = false
  await poller.tick(epoch + 10_000)
  expect(f.db.prepare('SELECT * FROM documents').all()).toEqual([])
  f.flow.enabled = true
  await poller.tick(epoch + 20_000)
  expect(f.collect.mock.calls.at(-1)?.[1]).toBe(new Date(epoch + 20_000).toISOString())
  f.config.repository = 'team/other'
  await poller.tick(epoch + 30_000)
  expect(f.collect.mock.calls.at(-1)?.[1]).toBe(new Date(epoch + 30_000).toISOString())
})
it('does not deliver an in-flight poll after disabling, changing settings or shutdown', async () => {
  for (const mutation of ['pause', 'edit', 'stop']) {
    const f = setup(),
      poller = f.create()
    let resolve!: (result: { deliveries: GithubDelivery[]; heads: Record<string, string> }) => void
    f.collect.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = poller.tick(epoch)
    await poller.tick(epoch + 1)
    expect(f.collect).toHaveBeenCalledTimes(1)
    if (mutation === 'pause') f.flow.enabled = false
    else if (mutation === 'edit') f.config.repository = 'team/other'
    else poller.dispose()
    resolve({ deliveries: [event()], heads: {} })
    await pending
    expect(f.start).not.toHaveBeenCalled()
  }
})
it('reconciles a committed receipt with an unshifted queue after a crash', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  f.collect.mockResolvedValue({ deliveries: [event()], heads: {} })
  f.start.mockImplementation((id, key) => {
    f.db.prepare('INSERT INTO deliveries VALUES (?,?)').run(`${id}:${key}`, 'now')
    throw new Error('Crash after commit')
  })
  await poller.tick(epoch + 60_000)
  poller.dispose()
  f.collect.mockResolvedValue({ deliveries: [event()], heads: {} })
  await f.create().tick(epoch + 120_000)
  expect(f.start).toHaveBeenCalledTimes(1)
})
function statements(db: Database.Database) {
  const prepare = vi.spyOn(db, 'prepare')
  return () => prepare.mock.calls.map(([sql]) => sql)
}
it('keeps idle ticks free of SQL while polling every minute', async () => {
  const empty = setup()
  const idle = new GithubTriggers(
    empty.db,
    { collect: empty.collect },
    () => [],
    empty.start,
    empty.report,
  )
  const idleSql = statements(empty.db)
  for (let second = 0; second < 600; second++) await idle.tick(epoch + second * 1000)
  expect(idleSql()).toEqual(["SELECT id FROM documents WHERE id LIKE 'github-trigger:%'"])
  const f = setup(),
    poller = f.create(),
    sql = statements(f.db)
  for (let second = 0; second < 600; second++) await poller.tick(epoch + second * 1000)
  expect(f.collect).toHaveBeenCalledTimes(10)
  // One sweep, one load and initial save, then one cursor save per poll.
  expect(sql()).toHaveLength(13)
})
it('retries queued deliveries every second while idle polling is skipped', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  f.collect.mockResolvedValue({ deliveries: [event()], heads: {} })
  let busy = true
  f.start.mockImplementation((id, key) => {
    if (busy) throw new HttpError(409, 'Active run')
    f.db.prepare('INSERT INTO deliveries VALUES (?,?)').run(`${id}:${key}`, 'now')
  })
  await poller.tick(epoch + 60_000)
  await poller.tick(epoch + 61_000)
  expect(f.start).toHaveBeenCalledTimes(2)
  busy = false
  await poller.tick(epoch + 62_000)
  expect(f.start).toHaveBeenCalledTimes(3)
  expect(f.collect).toHaveBeenCalledTimes(2)
  const sql = statements(f.db)
  await poller.tick(epoch + 63_000)
  expect(sql()).toEqual([])
})
it('reloads committed state after a failed write and recovers on the next poll', async () => {
  const f = setup(),
    poller = f.create()
  await poller.tick(epoch)
  f.collect.mockResolvedValue({ deliveries: [event()], heads: {} })
  const prepare = f.db.prepare.bind(f.db)
  const write = vi.spyOn(f.db, 'prepare').mockImplementation((sql: string) => {
    if (sql.startsWith('INSERT INTO documents')) throw new Error('Disk full')
    return prepare(sql)
  })
  await poller.tick(epoch + 60_000)
  expect(f.report).toHaveBeenCalledWith('flow', 'GitHub trigger failed: Disk full')
  expect(f.start).toHaveBeenCalledTimes(1)
  write.mockRestore()
  // The unsaved cursor is discarded, so the next poll fetches the event again and its receipt
  // keeps it from starting twice.
  await poller.tick(epoch + 61_000)
  expect(f.collect).toHaveBeenCalledTimes(2)
  await poller.tick(epoch + 120_000)
  expect(f.collect.mock.calls.at(-1)?.[1]).toBe(new Date(epoch).toISOString())
  expect(f.start).toHaveBeenCalledTimes(1)
  expect(f.db.prepare('SELECT value FROM documents').get()).toMatchObject({
    value: expect.stringContaining('"pending":[]'),
  })
})
it('sweeps stale state on deletion, re-enable and restart without per-tick scans', async () => {
  const f = setup()
  let flows = [f.flow]
  const create = () =>
    new GithubTriggers(f.db, { collect: f.collect }, () => flows, f.start, f.report)
  const poller = create()
  await poller.tick(epoch)
  flows = []
  await poller.tick(epoch + 1000)
  expect(f.db.prepare('SELECT id FROM documents').all()).toEqual([])
  flows = [f.flow]
  await poller.tick(epoch + 2000)
  expect(f.collect.mock.calls.at(-1)?.[1]).toBe(new Date(epoch + 2000).toISOString())
  poller.dispose()
  // A stale document from before a restart, such as a restored backup, is swept once.
  f.db.prepare('INSERT INTO documents VALUES (?,?)').run('github-trigger:deleted', '{}')
  const restarted = create()
  await restarted.tick(epoch + 3000)
  expect(f.db.prepare('SELECT id FROM documents').all()).toEqual([{ id: 'github-trigger:flow' }])
  expect(f.collect).toHaveBeenCalledTimes(3)
  const sql = statements(f.db)
  await restarted.tick(epoch + 4000)
  expect(sql()).toEqual([])
})
