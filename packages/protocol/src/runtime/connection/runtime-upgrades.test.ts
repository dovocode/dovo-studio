import { runtimeUpdate } from './runtime-releases.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import {
  createRuntimeUpgradeManager,
  runtimeUpgradeTargets,
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
  const lostReplies = new Set<string>()
  const droppedRequests = new Set<string>()
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
      const id =
        url.hostname.split('.')[0] + (url.pathname.includes('/desktop-update/') ? ':desktop' : '')
      if (url.pathname.startsWith('/api/snapshot'))
        return Response.json(entries.find((value) => value.profile.id === id)?.snapshot)
      if (url.pathname.endsWith('/status'))
        return Response.json(states.get(id) ?? { status: 'idle' })
      commands.push({ id, path: url.pathname })
      if (failures.has(id)) return Response.json({ error: 'Installer failed' }, { status: 409 })
      if (droppedRequests.has(id)) throw new TypeError('Connection lost before dispatch')
      const next = {
        status: url.pathname.endsWith('/restart') ? 'installing' : 'queued',
        version: '1.0.1',
      }
      states.set(id, next)
      if (lostReplies.delete(id)) throw new TypeError('Connection lost after dispatch')
      return Response.json(next)
    }),
  )
  const refreshed = vi.fn<() => Promise<void>>(async () => {})
  return {
    manager: createRuntimeUpgradeManager({ entries: () => entries, refreshed }),
    commands,
    states,
    failures,
    lostReplies,
    droppedRequests,
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

it('reconciles a lost update reply without sending the command twice', async () => {
  const f = fixture([entry('server')])
  await f.manager.check()
  f.lostReplies.add('server')
  await f.manager.start(['server'])
  expect(f.manager.getSnapshot().statuses.server.status).toBe('queued')
  f.states.set('server', { status: 'downloading', version: '1.0.1' })
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server.status).toBe('downloading')
  expect(f.commands).toHaveLength(1)
})
it('verifies a restarted desktop when the restart reply is lost', async () => {
  const desktop = entry('desktop', true)
  const f = fixture([desktop])
  await f.manager.check()
  f.states.set('desktop', { status: 'downloaded', version: '1.0.1' })
  await f.manager.poll()
  f.lostReplies.add('desktop')
  await f.manager.restart(['desktop'])
  expect(f.manager.getSnapshot().statuses.desktop.status).toBe('installing')
  if (desktop.snapshot) desktop.snapshot.releaseVersion = '1.0.1'
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.desktop.status).toBe('complete')
  expect(f.commands).toHaveLength(1)
  expect(f.refreshed).toHaveBeenCalledOnce()
})
it('allows an explicit retry when a lost request never reached the host', async () => {
  const f = fixture([entry('server')])
  await f.manager.check()
  f.droppedRequests.add('server')
  await f.manager.start(['server'])
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server).toMatchObject({
    status: 'error',
    error: expect.stringContaining('did not accept'),
  })
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server.status).toBe('error')
  f.droppedRequests.clear()
  await f.manager.start(['server'])
  expect(f.manager.getSnapshot().statuses.server.status).toBe('queued')
  expect(f.commands).toHaveLength(2)
})

it('retains a rejected command error until retry or verified host recovery', async () => {
  const server = entry('server')
  const f = fixture([server])
  await f.manager.check()
  f.failures.add('server')
  await f.manager.start(['server'])
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server.error).toContain('Installer failed')
  if (server.snapshot) {
    server.snapshot.releaseVersion = '1.0.1'
    server.snapshot.releaseCanUpdate = false
  }
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses.server.status).toBe('complete')
})

it('offers independent server and desktop targets and confirms the desktop version rather than the server version', async () => {
  const server = entry('host')
  if (!server.snapshot) throw new Error('Missing snapshot')
  server.snapshot.runtimeHost = 'host'
  server.snapshot.releaseVersion = '1.0.1'
  server.snapshot.desktopApp = { version: '1.0.0', canUpdate: true }
  const duplicate = { ...server, profile: { ...server.profile, id: 'duplicate' } }
  expect(
    runtimeUpgradeTargets([server, duplicate]).filter((entry) => entry.target === 'desktop'),
  ).toHaveLength(1)
  const firstId = runtimeUpgradeTargets([server, duplicate]).find(
    (entry) => entry.target === 'desktop',
  )?.profile.id
  expect(
    runtimeUpgradeTargets([{ ...server, connected: false }, duplicate]).find(
      (entry) => entry.target === 'desktop',
    )?.profile.id,
  ).toBe(firstId)
  const targets = runtimeUpgradeTargets([server])
  const f = fixture(targets)
  await f.manager.check()
  await f.manager.start(['host:desktop'])
  expect(f.commands).toEqual([{ id: 'host:desktop', path: '/api/runtime/desktop-update/start' }])
  f.states.set('host:desktop', { status: 'downloaded', version: '1.0.1' })
  await f.manager.poll()
  await f.manager.restart(['host:desktop'])
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses['host:desktop']?.status).toBe('installing')
  server.snapshot.desktopApp.version = '1.0.1'
  await f.manager.poll()
  expect(f.manager.getSnapshot().statuses['host:desktop']?.status).toBe('complete')
  expect(f.refreshed).toHaveBeenCalledWith(
    expect.objectContaining({ sourceProfile: server.profile }),
  )
})

it('uses the desktop app release channel only when explicitly configured', () => {
  const desktop = entry('desktop', true)
  if (!desktop.snapshot) throw new Error('Missing snapshot')
  const nightly = { version: '1.0.0-nightly.1', notes: '', url: '' }
  const stable = { version: '1.0.1', notes: '', url: '' }
  expect(runtimeUpdate(desktop.snapshot, { stable, nightly }).latest).toBe(stable)
  desktop.snapshot.desktopApp = { version: '1.0.0', canUpdate: true, channel: 'nightly' }
  expect(runtimeUpdate(desktop.snapshot, { stable, nightly })).toMatchObject({
    latest: nightly,
    available: true,
  })
})
