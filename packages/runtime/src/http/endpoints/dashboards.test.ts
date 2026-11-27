import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  dashboardListResultSchema,
  dashboardRunResultSchema,
  dashboardSaveResultSchema,
  dashboardSessionResultSchema,
  decode,
  SCRATCH_PROJECT_ID,
  snapshotSchema,
  type Dashboard,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { waitForRuntime } from '../../testing/integration'

vi.setConfig({ testTimeout: 60_000 })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'dashboard-route-owner-token-at-least-32-chars'
const token = 'dashboard-paired-computer-token-at-least-32'
const id = '10000000-0000-4000-8000-000000000001'
const commandTile = '10000000-0000-4000-8000-000000000002'
const tuiTile = '10000000-0000-4000-8000-000000000003'
const threadsTile = '10000000-0000-4000-8000-000000000004'

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME'])
    vi.stubEnv(key, join(f.directory, key))
  vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', '')
  cleanups.push(async () => {
    vi.unstubAllEnvs()
  })
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'runtime.sqlite'),
    ownerToken,
    port: 0,
  })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({ ...f.workspace, tasks: [] }))
  runtime.services.devices.add('Paired computer', token)
  const post = (path: string, input: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(input),
    })
  const marker = join(f.directory, 'marker')
  const definition = (command: string): Dashboard => ({
    id,
    title: 'Ops',
    revision: 0,
    tiles: [
      {
        id: commandTile,
        title: 'Tests',
        span: 2,
        height: 1,
        kind: 'command',
        repositoryId: 'repo',
        command,
      },
      {
        id: tuiTile,
        title: 'Top',
        span: 2,
        height: 2,
        kind: 'tui',
        repositoryId: 'repo',
        command: 'true',
      },
      { id: threadsTile, title: 'Threads', span: 1, height: 1, kind: 'threads' },
    ],
  })
  return { ...f, runtime, post, marker, definition }
}

it('saves, lists and deletes dashboards for paired human clients only', async () => {
  const { runtime, post, definition } = await setup()
  const snapshot = decode(
    snapshotSchema,
    await (
      await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json(),
  )
  expect(snapshot.dashboardsSupported).toBe(true)

  const saved = await post('dashboards/save', {
    dashboard: definition('true'),
    expectedRevision: 0,
  })
  expect(saved.status).toBe(200)
  const { dashboard } = decode(dashboardSaveResultSchema, await saved.json())
  expect(dashboard.revision).toBe(1)
  const stale = await post('dashboards/save', { dashboard, expectedRevision: 0 })
  expect(stale.status).toBe(409)
  const listed = decode(dashboardListResultSchema, await (await post('dashboards/list', {})).json())
  expect(listed.dashboards).toEqual([dashboard])

  const agent = await post('dashboards/list', {}, { 'x-dovo-agent-access': '1' })
  expect(agent.status).toBe(403)
  const unpaired = await fetch(`http://127.0.0.1:${runtime.port}/api/dashboards/list`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer not-a-paired-device-token-value-0000',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  expect(unpaired.status).toBe(401)
  const unknownField = await post('dashboards/delete', { id, expectedRevision: 1, extra: true })
  expect(unknownField.status).toBe(400)

  expect((await post('dashboards/delete', { id, expectedRevision: 0 })).status).toBe(409)
  expect(await (await post('dashboards/delete', { id, expectedRevision: 1 })).json()).toEqual({
    ok: true,
  })
  expect(
    decode(dashboardListResultSchema, await (await post('dashboards/list', {})).json()).dashboards,
  ).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'shares scheduled CLI results with another paired client',
  async () => {
    const { runtime, post, marker, definition } = await setup()
    const dashboard = {
      ...definition('true'),
      tiles: [
        {
          kind: 'cli' as const,
          id: commandTile,
          repositoryId: 'repo',
          title: 'Read count',
          command: `printf 'run\\n' >> '${marker}'; printf '42'`,
          pointer: '',
          chart: 'number' as const,
          span: 1,
          height: 1,
          refreshSeconds: 30,
        },
      ],
    }
    expect((await post('dashboards/save', { dashboard, expectedRevision: 0 })).status).toBe(200)
    const policy = { owner: 'dashboard', id, sourceId: commandTile, expectedRevision: 1 }
    expect(
      (
        await post('studio/source-policy', {
          ...policy,
          policy: { access: 'persistent', autoLoad: true },
        })
      ).status,
    ).toBe(200)
    const input = { id, tileId: commandTile, expectedRevision: 1, automatic: true }
    const read = async (headers?: Record<string, string>) => {
      const response = await post('dashboards/command-data', input, headers)
      expect(response.status).toBe(200)
      return response.json()
    }
    const first = await read()
    const secondToken = 'second-dashboard-paired-token-at-least-32'
    runtime.services.devices.add('Phone', secondToken)
    const second = await read({ Authorization: `Bearer ${secondToken}` })
    expect(second).toMatchObject({
      data: 42,
      updatedAt: first.updatedAt,
      refreshAfterMs: expect.any(Number),
    })
    expect(second.refreshAfterMs).toBeLessThanOrEqual(first.refreshAfterMs)
    expect(await readFile(marker, 'utf8')).toBe('run\n')
    const manual = await post('dashboards/command-data', { ...input, automatic: false })
    expect(manual.status).toBe(200)
    const manuallyUpdated = await manual.json()
    expect(await read({ Authorization: `Bearer ${secondToken}` })).toMatchObject({
      data: 42,
      updatedAt: manuallyUpdated.updatedAt,
    })
    expect(await readFile(marker, 'utf8')).toBe('run\nrun\n')
    expect(
      (
        await post('studio/source-policy', {
          ...policy,
          policy: { access: 'off', autoLoad: false },
        })
      ).status,
    ).toBe(200)
    expect((await post('dashboards/command-data', input)).status).toBe(403)
  },
)

it.skipIf(process.platform === 'win32')(
  'runs a saved command once per request, in the project checkout, and reports its exit code',
  async () => {
    const { runtime, post, marker, definition, directory } = await setup()
    await post('dashboards/save', {
      dashboard: definition(`pwd >> '${marker}'; exit 3`),
      expectedRevision: 0,
    })
    const input = {
      id,
      tileId: commandTile,
      expectedRevision: 1,
      requestId: '10000000-0000-4000-8000-0000000000a1',
    }
    // Saving the command leaves the terminal idle until a paired client runs it.
    expect(runtime.services.terminals.list()).toEqual([])
    const first = await post('dashboards/run', input)
    expect(first.status).toBe(200)
    const { terminalId } = decode(dashboardRunResultSchema, await first.json())
    const again = decode(
      dashboardRunResultSchema,
      await (await post('dashboards/run', input)).json(),
    )
    expect(again.terminalId).toBe(terminalId)
    await waitForRuntime(async () =>
      expect(
        await post('terminals/summary', { id: terminalId }).then((response) => response.json()),
      ).toMatchObject({ running: false, exitCode: 3 }),
    )
    const lines = (await readFile(marker, 'utf8')).split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(await realpath(lines[0])).toBe(await realpath(directory))
    expect(runtime.services.terminals.list()).toHaveLength(1)

    // A stale revision runs nothing.
    const stale = await post('dashboards/run', {
      ...input,
      expectedRevision: 0,
      requestId: '10000000-0000-4000-8000-0000000000a2',
    })
    expect(stale.status).toBe(409)
    const wrongKind = await post('dashboards/run', {
      ...input,
      tileId: threadsTile,
      requestId: '10000000-0000-4000-8000-0000000000a3',
    })
    expect(wrongKind.status).toBe(400)
    // A request ID belongs to one request.
    expect((await post('dashboards/run', { ...input, tileId: tuiTile })).status).toBe(409)
    expect(runtime.services.terminals.list()).toHaveLength(1)

    await post('dashboards/save', { dashboard: definition('echo changed'), expectedRevision: 1 })
    const changed = await post('dashboards/run', {
      ...input,
      requestId: '10000000-0000-4000-8000-0000000000a5',
    })
    expect(changed.status).toBe(409)
    expect(runtime.services.terminals.list()).toHaveLength(1)
    expect((await readFile(marker, 'utf8')).split('\n').filter(Boolean)).toHaveLength(1)
  },
)

it.skipIf(process.platform === 'win32')(
  'opens a TUI tile in an interactive shell that stays open',
  async () => {
    const { runtime, post, definition } = await setup()
    await post('dashboards/save', { dashboard: definition('true'), expectedRevision: 0 })
    const response = await post('dashboards/run', {
      id,
      tileId: tuiTile,
      expectedRevision: 1,
      requestId: '10000000-0000-4000-8000-0000000000b1',
    })
    expect(response.status).toBe(200)
    const { terminalId } = decode(dashboardRunResultSchema, await response.json())
    const terminal = runtime.services.terminals.get(terminalId).info
    expect(terminal).toMatchObject({ title: 'Top', repositoryId: 'repo', shellId: 'default' })
    expect(terminal.exited).toBeFalsy()
  },
)

it.skipIf(process.platform === 'win32')(
  'runs an interactive TUI in the computer home folder without a project binding',
  async () => {
    const { runtime, post, definition } = await setup()
    vi.stubEnv('SHELL', '/bin/sh')
    runtime.services.store.update((workspace) => ({ ...workspace, repositories: [] }))
    const dashboard = definition('true')
    dashboard.tiles = dashboard.tiles.map((tile) =>
      tile.kind === 'tui'
        ? {
            ...tile,
            repositoryId: SCRATCH_PROJECT_ID,
            command: `printf '\\033[?1049h\\033[HTUI ready\\n'; read line; printf '\\nTUI input: %s\\n' "$line"; printf '\\033[?1049l'`,
          }
        : tile,
    )
    expect((await post('dashboards/save', { dashboard, expectedRevision: 0 })).status).toBe(200)
    expect(runtime.services.terminals.list()).toEqual([])
    const input = {
      id,
      tileId: tuiTile,
      expectedRevision: 1,
      requestId: '10000000-0000-4000-8000-0000000000b2',
    }
    const started = await post('dashboards/run', input)
    expect(started.status).toBe(200)
    const { terminalId } = decode(dashboardRunResultSchema, await started.json())
    const session = runtime.services.terminals.get(terminalId)
    expect(session.info.repositoryId).toBeUndefined()
    expect(await realpath(session.directory)).toBe(await realpath(homedir()))
    await waitForRuntime(() => expect(session.buffer).toContain('\x1b[?1049h\x1b[HTUI ready'))
    runtime.services.terminals.input(terminalId, 'Studio keyboard\r')
    await waitForRuntime(() => expect(session.buffer).toContain('TUI input: Studio keyboard'))
    expect(session.info.exited).toBeFalsy()
    const { requestId: _requestId, ...lookup } = input
    const restored = await post('dashboards/session', lookup)
    expect(decode(dashboardSessionResultSchema, await restored.json()).terminalId).toBe(terminalId)
  },
)

it.skipIf(process.platform === 'win32')(
  'reattaches the latest session for the same command and refuses stale reads and sessions',
  async () => {
    const { runtime, post, definition } = await setup()
    await post('dashboards/save', { dashboard: definition('true'), expectedRevision: 0 })
    const session = async (tileId: string, expectedRevision: number) => {
      const response = await post('dashboards/session', { id, tileId, expectedRevision })
      return response.ok
        ? decode(dashboardSessionResultSchema, await response.json())
        : response.status
    }
    expect(await session(tuiTile, 1)).toEqual({ terminalId: null })
    const run = await post('dashboards/run', {
      id,
      tileId: tuiTile,
      expectedRevision: 1,
      requestId: '10000000-0000-4000-8000-0000000000c1',
    })
    const { terminalId } = decode(dashboardRunResultSchema, await run.json())
    expect(await session(tuiTile, 1)).toEqual({ terminalId })
    expect(await session(commandTile, 1)).toEqual({ terminalId: null })
    expect(await session(threadsTile, 1)).toBe(400)
    // Sessions start nothing.
    expect(runtime.services.terminals.list()).toHaveLength(1)

    // An edit elsewhere keeps the session. The old revision cannot read or reattach.
    const renamed = { ...definition('true'), title: 'Renamed' }
    await post('dashboards/save', { dashboard: renamed, expectedRevision: 1 })
    expect(await session(tuiTile, 1)).toBe(409)
    expect(await session(tuiTile, 2)).toEqual({ terminalId })
    const staleRead = await post('dashboards/read', {
      id,
      tileId: threadsTile,
      expectedRevision: 1,
    })
    expect(staleRead.status).toBe(409)

    // A new command for the tile does not reattach the old program.
    const edited = {
      ...renamed,
      tiles: renamed.tiles.map((tile) =>
        tile.id === tuiTile && tile.kind === 'tui' ? { ...tile, command: 'htop' } : tile,
      ),
    }
    await post('dashboards/save', { dashboard: edited, expectedRevision: 2 })
    expect(await session(tuiTile, 3)).toEqual({ terminalId: null })

    // A closed terminal is not offered again.
    await post('dashboards/save', { dashboard: renamed, expectedRevision: 3 })
    expect(await session(tuiTile, 4)).toEqual({ terminalId })
    await runtime.services.terminals.close(terminalId)
    expect(await session(tuiTile, 4)).toEqual({ terminalId: null })
    expect(
      (
        await post(
          'dashboards/session',
          { id, tileId: tuiTile, expectedRevision: 4 },
          {
            'x-dovo-agent-access': '1',
          },
        )
      ).status,
    ).toBe(403)
  },
)

async function realpath(path: string) {
  const { realpath: resolve } = await import('node:fs/promises')
  return resolve(path)
}

it('rejects a command without a project at save and at launch, and never starts it in the home folder', async () => {
  const { runtime, post, definition } = await setup()
  const unbound = definition('touch ran')
  unbound.tiles = unbound.tiles.map((tile) =>
    tile.kind === 'command' ? { ...tile, repositoryId: '' } : tile,
  )
  const saved = await post('dashboards/save', { dashboard: unbound, expectedRevision: 0 })
  expect(saved.status).toBe(400)
  expect(await saved.text()).toContain('choose a project or the home folder')

  // A row saved before this check still cannot launch.
  runtime.services.db
    .prepare('INSERT INTO dashboards(id,revision,definition) VALUES(?,?,?)')
    .run(id, 1, JSON.stringify({ ...unbound, revision: 1 }))
  const run = await post('dashboards/run', {
    id,
    tileId: commandTile,
    expectedRevision: 1,
    requestId: '10000000-0000-4000-8000-0000000000d1',
  })
  expect(run.status).toBe(400)
  expect(await run.text()).toContain('Nothing ran')
  expect(runtime.services.terminals.list()).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'checks the device and revision again right before the terminal process starts',
  async () => {
    const { runtime, post, definition } = await setup()
    const s = runtime.services
    await post('dashboards/save', { dashboard: definition('true'), expectedRevision: 0 })
    const create = s.terminals.createWorkspaceCommand.bind(s.terminals)
    const during = (change: () => void) =>
      vi.spyOn(s.terminals, 'createWorkspaceCommand').mockImplementationOnce(async (...args) => {
        // Every earlier check passed. Change state while the terminal is prepared.
        change()
        return create(...args)
      })
    const run = (requestId: string) =>
      post('dashboards/run', { id, tileId: tuiTile, expectedRevision: 1, requestId })

    during(() => s.dashboards.delete(id, 1))
    const deleted = await run('10000000-0000-4000-8000-0000000000e2')
    expect(deleted.status).toBe(409)
    expect(s.terminals.list()).toEqual([])
    expect(s.dashboards.get(id)).toBeUndefined()

    await post('dashboards/save', { dashboard: definition('true'), expectedRevision: 0 })
    const device = s.devices.list().find((entry) => entry.name === 'Paired computer')
    if (!device) throw new Error('Missing paired device')
    during(() => s.devices.revoke(device.id))
    const revoked = await run('10000000-0000-4000-8000-0000000000e3')
    expect(revoked.status).toBe(401)
    expect(s.terminals.list()).toEqual([])
  },
)

it('reads saved CLI stdout only through the paired command data endpoint', async () => {
  const { runtime, post, marker, definition, directory } = await setup()
  const command =
    process.platform === 'win32'
      ? `Set-Content -Path '${marker}' -Value (Get-Location).Path; '{"value":7}'`
      : `pwd > '${marker}'; printf '%s' '{"value":7}'`
  const dashboard = {
    ...definition('true'),
    tiles: [
      {
        id: commandTile,
        kind: 'cli',
        title: 'Build count',
        span: 2,
        height: 1,
        repositoryId: 'repo',
        command,
        pointer: '/value',
        chart: 'number',
        refreshSeconds: 60,
      },
    ],
  }
  expect((await post('dashboards/save', { dashboard, expectedRevision: 0 })).status).toBe(200)
  expect(await (await post('dashboards/list', {})).json()).toEqual({ dashboards: [] })
  expect(await (await post('dashboards/list', { dataSources: true })).json()).toMatchObject({
    dashboards: [{ tiles: [{ kind: 'cli', refreshSeconds: 60 }] }],
  })
  const input = { id, tileId: commandTile, expectedRevision: 1 }
  expect((await post('dashboards/read', input)).status).toBe(400)
  expect((await post('dashboards/command-data', { ...input, expectedRevision: 0 })).status).toBe(
    409,
  )
  expect(
    (await post('dashboards/command-data', input, { 'x-dovo-agent-access': '1' })).status,
  ).toBe(403)
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  const automatic = { ...input, automatic: true }
  expect((await post('dashboards/command-data', automatic)).status).toBe(403)
  const policy = {
    owner: 'dashboard',
    id,
    sourceId: commandTile,
    expectedRevision: 1,
    policy: { access: 'persistent', autoLoad: true },
  }
  expect((await post('studio/source-policy', policy, { 'x-dovo-agent-access': '1' })).status).toBe(
    403,
  )
  expect((await post('studio/source-policy', policy)).status).toBe(200)
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  const response = await post('dashboards/command-data', automatic)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: 7, updatedAt: expect.any(Number) })
  expect(await realpath((await readFile(marker, 'utf8')).trim())).toBe(await realpath(directory))
  expect(runtime.services.terminals.list()).toEqual([])
  expect(
    (await post('studio/source-policy', { ...policy, policy: { access: 'off', autoLoad: false } }))
      .status,
  ).toBe(200)
  expect((await post('dashboards/command-data', automatic)).status).toBe(403)
})

it('returns the acknowledged revision when a paired client repeats an uncertain save', async () => {
  const { post, definition } = await setup()
  const requestId = '20000000-0000-4000-8000-000000000001'
  const original = { dashboard: definition('true'), expectedRevision: 0, requestId }
  const first = await post('dashboards/save', original)
  expect(first.status).toBe(200)
  const { dashboard } = decode(dashboardSaveResultSchema, await first.json())
  const update = { dashboard: { ...dashboard, title: 'Updated' }, expectedRevision: 1 }
  expect((await post('dashboards/save', update)).status).toBe(200)
  const retry = await post('dashboards/save', original)
  expect(retry.status).toBe(200)
  expect(await retry.json()).toEqual({ dashboard })
  expect(
    (
      await post('dashboards/save', {
        ...original,
        dashboard: { ...dashboard, title: 'Different' },
      })
    ).status,
  ).toBe(409)
  expect((await post('dashboards/save', update)).status).toBe(409)
  const list = decode(dashboardListResultSchema, await (await post('dashboards/list', {})).json())
  expect(list.dashboards.map(({ id, title, revision }) => ({ id, title, revision }))).toEqual([
    { id, title: 'Updated', revision: 2 },
  ])
})
