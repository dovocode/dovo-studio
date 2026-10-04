import type Database from 'better-sqlite3'
import { openDatabase } from '../storage/database.js'
import { afterEach, expect, it, vi } from 'vitest'
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
