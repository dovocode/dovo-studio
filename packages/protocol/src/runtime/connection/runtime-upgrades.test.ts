import { afterEach, expect, it, vi } from 'vitest'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import {
  createRuntimeUpgradeManager,
  runtimeUpgradeBlocked,
  type RuntimeUpgradeEntry,
} from './runtime-upgrades.js'
const base = {
  revision: 0,
  owner: false,
  approvals: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
  releaseVersion: '1.0.0',
  releaseDistribution: 'archive',
  releaseCanUpdate: true,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
  },
}
function entry(id: string, desktop = false, owner = false): RuntimeUpgradeEntry {
  return {
    profile: { id, name: id, connection: { address: `http://${id}.local`, token: 'device-token' } },
    connected: true,
    snapshot: decode(snapshotSchema, {
      ...base,
      owner,
      releaseDistribution: desktop ? 'desktop' : 'archive',
    }),
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function fixture(entries: RuntimeUpgradeEntry[]) {
  const commands: { id: string; path: string }[] = []
  const states = new Map<string, { status: string; version?: string }>()
  const failures = new Set<string>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.hostname === 'api.github.com')
        return Response.json(
          url.pathname.endsWith('/latest')
            ? {
                tag_name: 'v1.0.1',
                html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v1.0.1',
                body: 'Changes',
              }
            : [],
        )
      const id = url.hostname.split('.')[0]
      if (url.pathname.startsWith('/api/snapshot'))
        return Response.json(entries.find((value) => value.profile.id === id)?.snapshot)
      if (url.pathname.endsWith('/status'))
        return Response.json(states.get(id) ?? { status: 'idle' })
      commands.push({ id, path: url.pathname })
      if (failures.has(id)) return Response.json({ error: 'Installer failed' }, { status: 409 })
      const next = {
        status: url.pathname.endsWith('/restart') ? 'installing' : 'queued',
        version: '1.0.1',
      }
      states.set(id, next)
      return Response.json(next)
    }),
  )
  const refreshed = vi.fn<() => Promise<void>>(async () => {})
  return {
    manager: createRuntimeUpgradeManager({ entries: () => entries, refreshed }),
    commands,
    states,
    failures,
    refreshed,
  }
}
it('updates selected supported hosts individually and in batches without auto-restarting desktops', async () => {
  const f = fixture([entry('desktop', true), entry('server'), entry('unselected')])
  await f.manager.check()
  f.manager.toggle('desktop')
  f.manager.toggle('server')
  await f.manager.start(f.manager.getSnapshot().selected)
  expect(f.commands).toEqual([
    { id: 'desktop', path: '/api/runtime/update/start' },
    { id: 'server', path: '/api/runtime/update/start' },
  ])
  f.states.set('desktop', { status: 'downloaded', version: '1.0.1' })
  f.states.set('server', { status: 'complete', version: '1.0.1' })
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.desktop.status).toBe('downloaded')
  expect(f.refreshed).toHaveBeenCalledOnce()
  await f.manager.restart(['desktop'])
  expect(f.commands.at(-1)).toEqual({ id: 'desktop', path: '/api/runtime/update/restart' })
})
it('continues a batch after one failure and skips offline and externally managed hosts', async () => {
  const offline = { ...entry('offline'), connected: false }
  const external = entry('external')
  if (external.snapshot) external.snapshot.releaseCanUpdate = false
  const f = fixture([entry('broken'), offline, external, entry('healthy')])
  await f.manager.check()
  f.failures.add('broken')
  await f.manager.start(['broken', 'offline', 'external', 'healthy'])
  expect(f.commands.map((command) => command.id)).toEqual(['broken', 'healthy'])
  expect(f.manager.getSnapshot().statuses.broken.error).toContain('Installer failed')
  expect(f.manager.getSnapshot().statuses.healthy.status).toBe('queued')
  expect(f.manager.getSnapshot().busy).toEqual([])
})
it('restarts the controlling desktop last and verifies the installed version after reconnecting', async () => {
  const entries = [entry('local', true, true), entry('remote', true)]
  const f = fixture(entries)
  await f.manager.check()
  for (const item of entries)
    f.states.set(item.profile.id, { status: 'downloaded', version: '1.0.1' })
  await f.manager.poll()
  await f.manager.restart(['local', 'remote'])
  expect(f.commands.map((command) => command.id)).toEqual(['remote', 'local'])
  f.states.set('remote', { status: 'idle' })
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.remote.status).toBe('installing')
  if (entries[1].snapshot) {
    entries[1].snapshot.releaseVersion = '1.0.1'
    entries[1].snapshot.releaseCanUpdate = false
  }
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.remote).toMatchObject({
    status: 'complete',
    version: '1.0.1',
  })
})
it('blocks hosts with running automation work', () => {
  const busy = entry('busy')
  if (busy.snapshot)
    busy.snapshot.runs = [
      {
        id: 'run',
        automationId: 'automation',
        status: 'running',
        completedNodes: [],
        taskIds: [],
        createdAt: '',
      },
    ]
  expect(runtimeUpgradeBlocked(busy)).toContain('Finish running')
})

it('keeps polling an offline updating server and completes after its new version answers', async () => {
  const server = entry('server')
  const f = fixture([server])
  await f.manager.check()
  await f.manager.start(['server'])
  f.states.set('server', { status: 'installing', version: '1.0.1' })
  await f.manager.poll()
  server.connected = false
  if (server.snapshot) server.snapshot.releaseVersion = '1.0.1'
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server).toMatchObject({
    status: 'complete',
    version: '1.0.1',
  })
  expect(f.refreshed).toHaveBeenCalledOnce()
})

it('expires restart progress even if the fleet stays offline', async () => {
  vi.useFakeTimers()
  try {
    const server = entry('server')
    const f = fixture([server])
    await f.manager.check()
    await f.manager.start(['server'])
    server.connected = false
    vi.advanceTimersByTime(16 * 60 * 1000)
    await f.manager.poll()
    expect(f.manager.getSnapshot().statuses.server.status).toBe('error')
  } finally {
    vi.useRealTimers()
  }
})

it('recognizes a newer installed version when a host was updated again during recovery', async () => {
  const server = entry('server')
  const f = fixture([server])
  await f.manager.check()
  await f.manager.start(['server'])
  f.states.set('server', { status: 'installing', version: '1.0.1' })
  await f.manager.poll()
  server.connected = false
  if (server.snapshot) server.snapshot.releaseVersion = '1.0.2'
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server).toMatchObject({
    status: 'complete',
    version: '1.0.2',
  })
})
