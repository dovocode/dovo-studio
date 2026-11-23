import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  dashboardListResultSchema,
  dashboardSaveResultSchema,
  decode,
  SCRATCH_PROJECT_ID,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'

vi.setConfig({ testTimeout: 60_000 })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'dashboard-agent-owner-token-at-least-32-chars'
const humanToken = 'dashboard-agent-paired-human-token-at-least-32'

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.devices.add('Paired computer', humanToken)
  const task = s.tasks.create({
    title: 'Author',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = 'dashboard-run'
  s.store.updateTask(task.id, (entry) => ({ ...entry, status: 'running', activeRunId: runId }))
  const controller = new AbortController()
  cleanups.push(async () => controller.abort())
  const issue = (readOnly: boolean) =>
    s.runCredentials.issue(
      {
        taskId: task.id,
        runId,
        permissions: { provider: 'codex', permission: readOnly ? 'read-only' : 'ask' },
        readOnly,
        artifacts: false,
        pipelineWatching: false,
        pullRequestWatching: false,
        deviceHub: false,
        memoryScopes: [],
      },
      controller.signal,
    )
  const request = (path: string, token: string, input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const agent = (token: string, command: unknown, extra: Record<string, unknown> = {}) =>
    request('agent/dashboards', token, { taskId: task.id, parentRunId: runId, command, ...extra })
  return { runtime, s, task, issue, request, agent }
}

it('lets an editable agent run author definitions that people see, with stable IDs and revisions', async () => {
  const { issue, agent, request } = await setup()
  const token = issue(false)
  const tile = {
    title: 'Tests',
    kind: 'command',
    span: 2,
    height: 1,
    repositoryId: 'repo',
    command: 'pnpm test',
  }
  const created = await agent(token, {
    action: 'create',
    dashboard: { title: 'Ops', tiles: [tile] },
  })
  expect(created.status).toBe(200)
  const { dashboard } = decode(dashboardSaveResultSchema, await created.json())
  expect(dashboard).toMatchObject({
    title: 'Ops',
    revision: 1,
    tiles: [{ ...tile, id: expect.any(String) }],
  })

  const human = decode(
    dashboardListResultSchema,
    await (await request('dashboards/list', humanToken, {})).json(),
  )
  expect(human.dashboards).toEqual([dashboard])
  expect(await (await agent(token, { action: 'list' })).json()).toEqual({
    dashboards: [{ id: dashboard.id, title: 'Ops', revision: 1, tiles: 1 }],
  })
  expect(await (await agent(token, { action: 'read', id: dashboard.id })).json()).toEqual({
    dashboard,
  })

  const existing = dashboard.tiles[0]
  const updated = await agent(token, {
    action: 'update',
    id: dashboard.id,
    expectedRevision: 1,
    dashboard: {
      title: 'Ops',
      tiles: [existing, { title: 'Threads', kind: 'threads', span: 1, height: 1 }],
    },
  })
  expect(updated.status).toBe(200)
  const next = decode(dashboardSaveResultSchema, await updated.json()).dashboard
  expect(next.revision).toBe(2)
  expect(next.tiles[0].id).toBe(existing.id)
  expect(next.tiles[1].id).not.toBe(existing.id)

  const stale = await agent(token, {
    action: 'update',
    id: dashboard.id,
    expectedRevision: 1,
    dashboard: { title: 'Stale', tiles: [] },
  })
  expect(stale.status).toBe(409)
  const nested = await agent(token, {
    action: 'update',
    id: dashboard.id,
    expectedRevision: 2,
    dashboard: { id: dashboard.id, title: 'Ops', tiles: [] },
  })
  expect(nested.status).toBe(400)
  const invalid = await agent(token, {
    action: 'create',
    dashboard: { title: 'Bad', tiles: [{ ...tile, kind: 'api', url: 'file:///etc/passwd' }] },
  })
  expect(invalid.status).toBe(400)

  expect(
    (await agent(token, { action: 'delete', id: dashboard.id, expectedRevision: 1 })).status,
  ).toBe(409)
  expect(
    await (await agent(token, { action: 'delete', id: dashboard.id, expectedRevision: 2 })).json(),
  ).toEqual({
    ok: true,
  })
  expect((await agent(token, { action: 'read', id: dashboard.id })).status).toBe(404)
})

it('saves definitions without running commands, opening terminals or connecting to URLs', async () => {
  const { s, issue, agent, request } = await setup()
  let connections = 0
  const http = createServer((_request, response) => response.end('{}'))
  http.on('connection', () => connections++)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  const url = `http://127.0.0.1:${address.port}/data`
  const token = issue(false)
  const created = await agent(token, {
    action: 'create',
    dashboard: {
      title: 'Ops',
      tiles: [
        {
          title: 'Run',
          kind: 'command',
          span: 1,
          height: 1,
          repositoryId: 'repo',
          command: 'touch ran',
        },
        {
          title: 'TUI',
          kind: 'tui',
          span: 1,
          height: 1,
          repositoryId: SCRATCH_PROJECT_ID,
          command: 'top',
        },
        { title: 'API', kind: 'api', span: 1, height: 1, url, pointer: '', chart: 'number' },
        { title: 'Page', kind: 'iframe', span: 1, height: 1, url },
      ],
    },
  })
  expect(created.status).toBe(200)
  const { dashboard } = decode(dashboardSaveResultSchema, await created.json())
  expect(s.terminals.list()).toEqual([])
  expect(connections).toBe(0)

  // The agent cannot use the human run or read endpoints.
  const commandTile = dashboard.tiles[0]
  const run = {
    id: dashboard.id,
    tileId: commandTile.id,
    expectedRevision: 1,
    requestId: crypto.randomUUID(),
  }
  expect((await request('dashboards/run', token, run)).status).toBe(403)
  expect(
    (await request('dashboards/run', token, { ...run, tileId: dashboard.tiles[1].id })).status,
  ).toBe(403)
  expect(
    (
      await request('dashboards/read', token, {
        id: dashboard.id,
        tileId: dashboard.tiles[2].id,
        expectedRevision: 1,
      })
    ).status,
  ).toBe(403)
  expect(s.terminals.list()).toEqual([])
  expect(connections).toBe(0)

  // The agent can change a definition, but a paired client must name the revision it saw.
  await agent(token, {
    action: 'update',
    id: dashboard.id,
    expectedRevision: 1,
    dashboard: { title: 'Ops', tiles: [{ ...commandTile, command: 'echo changed' }] },
  })
  expect((await request('dashboards/run', humanToken, run)).status).toBe(409)
  expect(s.terminals.list()).toEqual([])
})

it('keeps read-only runs to list and read, and scopes calls to the run that owns the token', async () => {
  const { issue, agent, request, task } = await setup()
  let writer = issue(false)
  const created = decode(
    dashboardSaveResultSchema,
    await (
      await agent(writer, { action: 'create', dashboard: { title: 'Ops', tiles: [] } })
    ).json(),
  ).dashboard
  const reader = issue(true)
  expect((await agent(reader, { action: 'list' })).status).toBe(200)
  expect((await agent(reader, { action: 'read', id: created.id })).status).toBe(200)
  for (const command of [
    { action: 'create', dashboard: { title: 'New', tiles: [] } },
    {
      action: 'update',
      id: created.id,
      expectedRevision: 1,
      dashboard: { title: 'New', tiles: [] },
    },
    { action: 'delete', id: created.id, expectedRevision: 1 },
  ])
    expect((await agent(reader, command)).status).toBe(403)

  // A newer grant for the same run replaces the earlier one.
  writer = issue(false)
  expect((await agent(writer, { action: 'list' }, { parentRunId: 'other-run' })).status).toBe(403)
  expect((await agent(writer, { action: 'list' }, { taskId: `${task.id}-other` })).status).toBe(403)
  expect((await agent(writer, { action: 'run', id: created.id })).status).toBe(400)
  // Human endpoints refuse run credentials, and the agent endpoint refuses paired devices.
  expect((await request('dashboards/list', writer, {})).status).toBe(403)
  expect(
    (
      await request('agent/dashboards', humanToken, {
        taskId: task.id,
        command: { action: 'list' },
      })
    ).status,
  ).toBe(403)
})
