import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { SCRATCH_PROJECT_ID, type Dashboard, type DashboardTile } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { HttpError } from '../errors.js'
import { Dashboards } from './dashboards.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const id = '00000000-0000-4000-8000-000000000001'
const tileId = '00000000-0000-4000-8000-000000000002'
const base = { id: tileId, title: 'Builds', span: 2, height: 1 }
const apiTile = (url: string, pointer = ''): DashboardTile => ({
  ...base,
  kind: 'api',
  url,
  pointer,
  chart: 'number',
})
const dashboard = (tiles: DashboardTile[] = [], revision = 0): Dashboard => ({
  id,
  title: 'Ops',
  revision,
  tiles,
})
const revision = (dashboards: Dashboards) => dashboards.get(id)?.revision ?? 0
type FeedRead = ConstructorParameters<typeof Dashboards>[1]['feedRead']
function setup(
  feedRead: FeedRead = () => Promise.reject(new Error('unused')),
  path = ':memory:',
  task: { archived?: boolean } = {},
) {
  const db = openDatabase(path)
  const store = {
    taskSummary: (taskId: string) => {
      if (taskId !== 'thread') throw new HttpError(404, 'Task not found')
      return task
    },
  }
  const dashboards = new Dashboards(db, { feedRead }, store)
  cleanups.push(() => {
    db.close()
  })
  return dashboards
}
async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const http = createServer(handler)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections()
        http.close(() => resolve())
      }),
  )
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return `http://127.0.0.1:${address.port}`
}

it('creates, updates and deletes with revision checks, and keeps definitions after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-dashboards-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'runtime.sqlite')
  const first = setup(undefined, path)
  const created = first.save(dashboard([apiTile('https://example.com/a')], 7), 0)
  // The runtime owns the revision. A client value never decides it.
  expect(created.revision).toBe(1)
  expect(() => first.save(dashboard(), 0)).toThrow('changed on its computer')
  const updated = first.save({ ...created, title: 'Ops 2' }, 1)
  expect(updated).toMatchObject({ title: 'Ops 2', revision: 2 })
  expect(() => first.save({ ...created, title: 'Stale' }, 1)).toThrow('changed on its computer')
  const otherId = '00000000-0000-4000-8000-000000000003'
  first.save({ ...dashboard(), id: otherId, title: 'Second' }, 0)
  first.save({ ...updated, title: 'Ops 3' }, 2)
  // Updates keep creation order.
  expect(first.list().map((entry) => entry.title)).toEqual(['Ops 3', 'Second'])

  const reopened = setup(undefined, path)
  expect(reopened.get(id)).toMatchObject({ title: 'Ops 3', revision: 3 })
  expect(() => reopened.delete(id, 2)).toThrow('changed on its computer')
  reopened.delete(id, 3)
  // A repeated delete after a lost response succeeds.
  reopened.delete(id, 3)
  expect(reopened.list().map((entry) => entry.id)).toEqual([otherId])
  // A client that edited the deleted dashboard keeps its draft and gets a clear conflict.
  expect(() => reopened.save(updated, 3)).toThrow('was deleted on its computer')
})

it('rejects invalid JSON pointers and MCP arguments when the dashboard is saved', () => {
  const dashboards = setup()
  expect(() => dashboards.save(dashboard([apiTile('https://example.com', 'items/0')]), 0)).toThrow(
    'RFC 6901',
  )
  const mcp = (args: string): DashboardTile => ({
    ...base,
    kind: 'mcp',
    taskId: 'thread',
    server: 'ci',
    tool: 'status',
    arguments: args,
    pointer: '',
    chart: 'table',
  })
  expect(() => dashboards.save(dashboard([mcp('[1]')]), 0)).toThrow('JSON object')
  expect(() => dashboards.save(dashboard([mcp('{')]), 0)).toThrow('JSON object')
  expect(dashboards.save(dashboard([mcp('')]), 0).revision).toBe(1)
})

it('reads exactly the saved URL without credentials or redirects, and bounds the response', async () => {
  const seen: IncomingMessage[] = []
  const origin = await server((request, response) => {
    seen.push(request)
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/data' }).end()
      return
    }
    if (request.url === '/large') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ text: 'x'.repeat(1024 * 1024) }))
      return
    }
    if (request.url === '/broken') {
      response.writeHead(500).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ builds: [{ passed: 12 }] }))
  })
  const dashboards = setup()
  const authorize = vi.fn<() => void>()
  dashboards.save(dashboard([apiTile(`${origin}/data?x=1`, '/builds/0/passed')]), 0)
  const result = await dashboards.read(id, tileId, revision(dashboards), authorize)
  expect(result.data).toBe(12)
  expect(result.updatedAt).toBeGreaterThan(0)
  expect(authorize).toHaveBeenCalled()
  expect(seen.at(-1)?.url).toBe('/data?x=1')
  expect(seen.at(-1)?.method).toBe('GET')
  expect(seen.at(-1)?.headers.authorization).toBeUndefined()
  expect(seen.at(-1)?.headers.cookie).toBeUndefined()

  const replace = (path: string, revision: number, pointer = '') =>
    dashboards.save(dashboard([apiTile(`${origin}${path}`, pointer)]), revision)
  replace('/redirect', 1)
  await expect(dashboards.read(id, tileId, revision(dashboards), authorize)).rejects.toThrow(
    'Redirects are not followed',
  )
  expect(seen.at(-1)?.url).toBe('/redirect')
  replace('/large', 2)
  await expect(dashboards.read(id, tileId, revision(dashboards), authorize)).rejects.toThrow(
    'larger than 1 MB',
  )
  replace('/broken', 3)
  await expect(dashboards.read(id, tileId, revision(dashboards), authorize)).rejects.toThrow(
    'HTTP 500',
  )
  replace('/data', 4, '/missing')
  await expect(dashboards.read(id, tileId, revision(dashboards), authorize)).rejects.toMatchObject({
    status: 422,
  })
})

it('rejects reads for tiles without data and for a device that loses access', async () => {
  const origin = await server((_request, response) => response.end('{}'))
  const dashboards = setup()
  dashboards.save(dashboard([{ ...base, kind: 'gui' }]), 0)
  await expect(dashboards.read(id, tileId, revision(dashboards), () => undefined)).rejects.toThrow(
    'Only API and MCP tiles',
  )
  await expect(
    dashboards.read(id, 'missing', revision(dashboards), () => undefined),
  ).rejects.toThrow('tile not found')
  dashboards.save(dashboard([apiTile(origin)]), 1)
  await expect(
    dashboards.read(id, tileId, revision(dashboards), () => {
      throw new HttpError(401, 'Device revoked')
    }),
  ).rejects.toThrow('Device revoked')
})

it('shares identical reads and does not return data from a definition changed during the read', async () => {
  let release = () => {}
  let requests = 0
  const origin = await server((_request, response) => {
    requests++
    release = () => response.end('{"value":1}')
  })
  const dashboards = setup()
  dashboards.save(dashboard([apiTile(origin)]), 0)
  const first = dashboards.read(id, tileId, revision(dashboards), () => undefined)
  const second = dashboards.read(id, tileId, revision(dashboards), () => undefined)
  await vi.waitFor(() => expect(requests).toBe(1))
  dashboards.save({ ...dashboard([apiTile(origin)]), title: 'Edited' }, 1)
  release()
  await expect(first).rejects.toThrow('changed during the read')
  await expect(second).rejects.toThrow('changed during the read')
  expect(requests).toBe(1)
})

it('reads a saved MCP tile through the read-only feed bridge and rechecks access', async () => {
  const feedRead = vi.fn<FeedRead>(async (_taskId, query, _expected, _signal, authorize) => {
    authorize()
    return { fingerprint: 'scope:tool', data: { ok: query.arguments.branch } }
  })
  const dashboards = setup(feedRead)
  dashboards.save(
    dashboard([
      {
        ...base,
        kind: 'mcp',
        taskId: 'thread',
        server: 'ci',
        tool: 'status',
        arguments: '{"branch":"main"}',
        pointer: '/ok',
        chart: 'table',
      },
    ]),
    0,
  )
  const authorize = vi.fn<() => void>()
  await expect(dashboards.read(id, tileId, revision(dashboards), authorize)).resolves.toMatchObject(
    {
      data: { ok: 'main' },
    },
  )
  expect(feedRead).toHaveBeenCalledWith(
    'thread',
    { server: 'ci', tool: 'status', arguments: { branch: 'main' }, pointer: '/ok', seconds: 60 },
    undefined,
    expect.any(AbortSignal),
    expect.any(Function),
  )
  // The bridge calls the check again before and after the tool call.
  expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(3)

  const archived = setup(feedRead, ':memory:', { archived: true })
  archived.save(dashboards.get(id) ?? dashboard(), 0)
  await expect(archived.read(id, tileId, revision(archived), () => undefined)).rejects.toThrow(
    'Restore the thread',
  )
})

it('cancels in-flight reads and refuses new reads when the runtime stops', async () => {
  let requests = 0
  const origin = await server(() => {
    requests++
  })
  const dashboards = setup()
  dashboards.save(dashboard([apiTile(origin)]), 0)
  const pending = dashboards.read(id, tileId, revision(dashboards), () => undefined)
  await vi.waitFor(() => expect(requests).toBe(1))
  await dashboards.dispose()
  await expect(pending).rejects.toThrow('stopping')
  await expect(dashboards.read(id, tileId, revision(dashboards), () => undefined)).rejects.toThrow(
    'stopping',
  )
})

it('refuses a read for a revision the client no longer shows', async () => {
  let requests = 0
  const origin = await server((_request, response) => {
    requests++
    response.end('{}')
  })
  const dashboards = setup()
  dashboards.save(dashboard([apiTile(origin)]), 0)
  dashboards.save({ ...dashboard([apiTile(`${origin}/edited`)]), title: 'Edited' }, 1)
  await expect(dashboards.read(id, tileId, 1, () => undefined)).rejects.toMatchObject({
    status: 409,
  })
  expect(requests).toBe(0)
  await expect(dashboards.read(id, tileId, 2, () => undefined)).resolves.toMatchObject({
    data: {},
  })
})

it('checks a device that joined a shared read again before it receives the data', async () => {
  let release: (() => void) | undefined
  const origin = await server((_request, response) => {
    release = () => response.end('{"value":1}')
  })
  const dashboards = setup()
  dashboards.save(dashboard([apiTile(origin, '/value')]), 0)
  let revoked = false
  const first = dashboards.read(id, tileId, 1, () => undefined)
  const joined = dashboards.read(id, tileId, 1, () => {
    if (revoked) throw new HttpError(401, 'Device revoked')
  })
  await vi.waitFor(() => expect(release).toBeDefined())
  revoked = true
  release?.()
  await expect(first).resolves.toMatchObject({ data: 1 })
  await expect(joined).rejects.toThrow('Device revoked')
})

it('keeps the latest session only for the same command definition', () => {
  const dashboards = setup()
  const command: DashboardTile = {
    ...base,
    kind: 'command',
    repositoryId: 'repo',
    command: 'pnpm test',
  }
  dashboards.save(dashboard([command]), 0)
  if (command.kind !== 'command') throw new Error('Expected a command tile')
  dashboards.recordSession(id, command, 'terminal-1')
  dashboards.recordSession(id, command, 'terminal-2')
  expect(dashboards.session(id, command)).toBe('terminal-2')
  // A layout or title change keeps the session. A new command does not.
  expect(dashboards.session(id, { ...command, title: 'Renamed', span: 4 })).toBe('terminal-2')
  expect(dashboards.session(id, { ...command, command: 'pnpm lint' })).toBeUndefined()
  expect(dashboards.session(id, { ...command, kind: 'tui' })).toBeUndefined()
  dashboards.delete(id, 1)
  expect(dashboards.session(id, command)).toBeUndefined()
})

it('requires saved tiles to name their project, terminal, thread or app, and allows No Project', () => {
  const dashboards = setup()
  const cases: Array<[DashboardTile, string]> = [
    [{ ...base, kind: 'command', repositoryId: '', command: 'pnpm test' }, 'choose a project'],
    [{ ...base, kind: 'tui', repositoryId: '  ', command: 'top' }, 'choose a project'],
    [{ ...base, kind: 'pipelines', repositoryId: '' }, 'choose a project'],
    [{ ...base, kind: 'terminal', terminalId: '' }, 'choose a terminal'],
    [{ ...base, kind: 'app', taskId: 'thread', appId: '' }, 'choose a thread and its MCP App'],
    [{ ...base, kind: 'app', taskId: '', appId: 'app' }, 'choose a thread and its MCP App'],
  ]
  for (const [tile, message] of cases)
    expect(() => dashboards.save(dashboard([tile]), 0)).toThrow(message)
  expect(dashboards.list()).toEqual([])
  const scratch = dashboards.save(
    dashboard([{ ...base, kind: 'command', repositoryId: SCRATCH_PROJECT_ID, command: 'ls' }]),
    0,
  )
  expect(scratch.revision).toBe(1)
})

it('withholds a shared MCP result when its thread is archived during the read', async () => {
  let finish: ((value: { fingerprint: string; data: unknown }) => void) | undefined
  const task: { archived?: boolean } = {}
  const dashboards = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    ':memory:',
    task,
  )
  dashboards.save(
    dashboard([
      {
        ...base,
        kind: 'mcp',
        taskId: 'thread',
        server: 'ci',
        tool: 'status',
        arguments: '{}',
        pointer: '',
        chart: 'table',
      },
    ]),
    0,
  )
  const first = dashboards.read(id, tileId, 1, () => undefined)
  const joined = dashboards.read(id, tileId, 1, () => undefined)
  await vi.waitFor(() => expect(finish).toBeDefined())
  task.archived = true
  finish?.({ fingerprint: 'scope:tool', data: { secret: 1 } })
  await expect(first).rejects.toThrow('Restore the thread')
  await expect(joined).rejects.toThrow('Restore the thread')
})

it('keeps no session for a dashboard deleted while its terminal started', () => {
  const dashboards = setup()
  const command: DashboardTile = { ...base, kind: 'command', repositoryId: 'repo', command: 'ls' }
  if (command.kind !== 'command') throw new Error('Expected a command tile')
  dashboards.save(dashboard([command]), 0)
  dashboards.delete(id, 1)
  dashboards.recordSession(id, command, 'terminal-1')
  // The same IDs saved again do not inherit the orphaned terminal.
  dashboards.save(dashboard([command]), 0)
  expect(dashboards.session(id, command)).toBeUndefined()
  dashboards.save(dashboard([{ ...base, kind: 'threads' }]), 1)
  dashboards.recordSession(id, command, 'terminal-2')
  expect(dashboards.session(id, command)).toBeUndefined()
})
