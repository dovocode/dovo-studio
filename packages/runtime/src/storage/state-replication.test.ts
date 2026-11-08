import { expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startRuntime } from '../index.js'
import {
  DurableState,
  STATE_MAX_BATCH_BYTES,
  STATE_MAX_EXCHANGE_BYTES,
  type StateStorage,
} from '@dovo/durable-connections'
import {
  decode,
  scopedSettingsValueSchema,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
  SharedStateSynchronization,
  runtimeProfile,
  snapshotSchema,
} from '@dovo/protocol'
import { backupRuntimeDatabase } from './backup.js'
import { restoreRuntimeBackup } from './backups.js'

it('accepts a full batch plus its exchange envelope and still rejects an oversized request', async () => {
  const f = await fixture()
  const value = (length: number) => ({
    prompts: Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      text: 'x'.repeat(Math.floor(length / 10) + (i < length % 10 ? 1 : 0)),
    })),
  })
  const versions = Array.from({ length: 128 }, (_, i) => ({
    key: 'global',
    updatedAt: i + 1,
    changeId: `phone:${i}`,
    deleted: false as const,
    value: value(i < 127 ? 65000 : 10),
  }))
  const batch = {
    protocol: 1,
    channel: 'shared-settings:v1',
    source: 'phone',
    after: 0,
    through: 128,
    changes: versions.map((version, i) => ({ sequence: i + 1, version })),
    more: false,
  }
  versions[127].value = value(
    10 + STATE_MAX_BATCH_BYTES - 64 - Buffer.byteLength(JSON.stringify(batch)),
  )
  const peer = await DurableState.open({
    channel: 'shared-settings:v1',
    replicaId: 'phone',
    storage: { load: () => undefined, save: () => {} },
    decode: (input) => decode(scopedSettingsValueSchema, input),
  })
  try {
    await peer.importVersions(versions)
    const request = {
      ...peer.request(f.runtime.services.runtimeId),
      targetRuntimeId: f.runtime.services.runtimeId,
    }
    expect(request.batch.changes).toHaveLength(128)
    expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(STATE_MAX_BATCH_BYTES)
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(STATE_MAX_EXCHANGE_BYTES)
    const response = await f.call('/api/state/exchange', request)
    expect(response.status).toBe(200)
    await peer.accept(await response.json())
    expect(await f.runtime.services.stateReplication.history('global')).toHaveLength(128)
    expect(
      (await f.call('/api/state/exchange', { padding: 'x'.repeat(STATE_MAX_EXCHANGE_BYTES) }))
        .status,
    ).toBe(413)
  } finally {
    await peer.close()
    await f.close()
  }
})

it('changes only the settings journal actor after restore and resumes with a newer paired replica', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-settings-restore-'))
  const path = join(directory, 'runtime.sqlite'),
    backup = join(directory, 'backup.sqlite')
  let a: Awaited<ReturnType<typeof fixture>> | undefined
  let saved: unknown
  const peer = await DurableState.open<ScopedSettingsValue>({
    channel: 'shared-settings:v1',
    replicaId: 'phone',
    storage: {
      load: () => saved,
      save: (value) => {
        saved = structuredClone(value)
      },
    },
    decode: (value) => decode(scopedSettingsValueSchema, value),
  })
  const sync = async (f: Awaited<ReturnType<typeof fixture>>, source: string) => {
    const response = await f.call('/api/state/exchange', {
      ...peer.request(source),
      targetRuntimeId: f.runtime.services.runtimeId,
    })
    expect(response.status).toBe(200)
    return peer.accept(await response.json())
  }
  try {
    a = await fixture(path)
    const identity = a.runtime.services.runtimeId
    await a.save('backup')
    await sync(a, identity)
    await backupRuntimeDatabase(path, backup)
    await a.save('newer shared preference')
    await sync(a, identity)
    const cursor = peer.checkpoint(identity)
    await a.close()
    a = undefined
    await restoreRuntimeBackup(path, backup)
    a = await fixture(path)
    const result = await sync(a, identity)
    expect(a.runtime.services.runtimeId).toBe(identity)
    expect(result.peer).not.toBe(identity)
    expect(peer.checkpoint(identity)).toBe(cursor)
    expect(global(a)).toBe('newer shared preference')
    expect(
      (await a.runtime.services.stateReplication.history('global')).map(
        (entry) => entry.value?.taskDefaults?.setupCommand,
      ),
    ).toContain('backup')
    const restoredSource = result.peer
    await a.close()
    a = await fixture(path)
    expect((await sync(a, restoredSource)).peer).toBe(restoredSource)
  } finally {
    await a?.close()
    await peer.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture(databasePath = ':memory:') {
  const token = randomBytes(32).toString('hex')
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  const call = (path: string, value?: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    })
  const save = async (setupCommand: string) => {
    const read = await call('/api/agents/settings/read', { scope: 'global' })
    const previous = await read.json()
    const saved = await call('/api/agents/settings/save', {
      scope: 'global',
      before: previous.value,
      after: { taskDefaults: { setupCommand } },
    })
    expect(saved.status).toBe(200)
  }
  return { runtime, token, call, save, close: runtime.close }
}
function global(f: Awaited<ReturnType<typeof fixture>>) {
  return f.runtime.services.defaults
    .get()
    .scopedSettings?.shared.find((entry) => entry.key === 'global')?.value.taskDefaults
    ?.setupCommand
}
function pair(
  a: Awaited<ReturnType<typeof fixture>>,
  b: Awaited<ReturnType<typeof fixture>>,
  studio = true,
) {
  const input = {
    sessionId: 'test-studio',
    peers: [
      {
        id: 'remote',
        name: 'Other computer',
        connection: {
          address: `http://127.0.0.1:${b.runtime.port}`,
          token: b.token,
          runtimeId: b.runtime.services.runtimeId,
        },
      },
    ],
  }
  if (studio) a.runtime.services.retrievalPeers.registerStudio('owner', input)
  else a.runtime.services.retrievalPeers.register('owner', input)
}

it('syncs directly in both directions over authenticated HTTP and removes revoked peer sessions', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    await a.save('local')
    await b.save('remote')
    const before = global(b)
    pair(a, b, false)
    await a.runtime.services.stateReplication.refresh()
    expect(a.runtime.services.stateReplication.status().peers).toEqual([])
    pair(a, b)
    await a.runtime.services.stateReplication.refresh()
    await expect.poll(() => global(a)).toBe(before)
    expect(
      (await b.runtime.services.stateReplication.history('global')).map(
        (entry) => entry.value?.taskDefaults?.setupCommand,
      ),
    ).toContain('local')
    await a.save('edited after convergence')
    await expect.poll(() => global(b), { timeout: 6000 }).toBe('edited after convergence')
    const status = await (await a.call('/api/state/status')).text()
    expect(status).toContain('Other computer')
    expect(status).not.toContain(b.token)
    a.runtime.services.retrievalPeers.register('owner', { sessionId: 'test-studio', peers: [] })
    await a.runtime.services.stateReplication.refresh()
    expect(a.runtime.services.stateReplication.status().peers).toEqual([])
    expect((await a.call('/api/state/status', undefined, 'invalid')).status).toBe(401)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('retains rapid offline edits through restart, then supports recovering an older value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-state-replication-'))
  let a: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    a = await fixture(join(directory, 'runtime.sqlite'))
    await a.save('first')
    await a.save('second')
    await a.close()
    a = await fixture(join(directory, 'runtime.sqlite'))
    expect(global(a)).toBe('second')
    const history = await a.runtime.services.stateReplication.history('global')
    const old = history.find((entry) => entry.value?.taskDefaults?.setupCommand === 'first')!
    expect(old).toBeDefined()
    const restored = await a.call('/api/state/restore', {
      key: old.key,
      updatedAt: old.updatedAt,
      changeId: old.changeId,
    })
    expect(restored.status).toBe(200)
    expect(global(a)).toBe('first')
    const b = await fixture()
    try {
      pair(a, b)
      await a.runtime.services.stateReplication.refresh()
      await expect.poll(() => global(b)).toBe('first')
      expect(await b.runtime.services.stateReplication.history('global')).toHaveLength(3)
    } finally {
      await b.close()
    }
  } finally {
    await a?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('validates before persistence, deduplicates lost replies, and leaves machine state private', async () => {
  const f = await fixture()
  let saved: unknown
  const storage: StateStorage = {
    load: () => saved,
    save: (snapshot) => {
      saved = structuredClone(snapshot)
    },
  }
  const peer = await DurableState.open<ScopedSettingsValue>({
    channel: 'shared-settings:v1',
    replicaId: 'test-client',
    storage,
    decode: (value) => decode(scopedSettingsValueSchema, value),
  })
  try {
    f.runtime.services.defaults.save(
      { ...f.runtime.services.defaults.get(), setupCommand: 'private-machine-setting' },
      false,
    )
    await peer.set('global', { taskDefaults: { setupCommand: 'shared' } })
    const request = peer.request()
    expect(
      (await f.call('/api/state/exchange', { ...request, targetRuntimeId: 'another-computer' }))
        .status,
    ).toBe(409)
    expect(global(f)).toBeUndefined()
    expect((await f.call('/api/state/exchange', request)).status).toBe(200)
    const replay = await f.call('/api/state/exchange', request)
    expect(replay.status).toBe(200)
    const response = await replay.json()
    expect(response.accepted.through).toBe(1)
    expect(JSON.stringify(response)).not.toContain('private-machine-setting')
    expect(await f.runtime.services.stateReplication.history('global')).toHaveLength(1)
    await peer.set('invalid-scope', {})
    const bad = await f.call('/api/state/exchange', peer.request())
    expect(bad.status).toBe(400)
    expect(global(f)).toBe('shared')
    expect((await f.call('/api/state/exchange', request, 'invalid')).status).toBe(401)
  } finally {
    await peer.close()
    await f.close()
  }
})

it('connects the app controller to two real runtimes over paired HTTP in both directions', async () => {
  const a = await fixture(),
    b = await fixture()
  let shared: SharedSettingsEntry[] = []
  let saved: unknown
  const errors: string[] = []
  const controller = new SharedStateSynchronization({
    storage: {
      load: () => saved,
      save: (snapshot) => {
        saved = structuredClone(snapshot)
      },
    },
    createReplicaId: () => 'app:http-test',
    readShared: () => shared,
    publish: (value) => {
      shared = value
    },
    error: (error) => errors.push(error),
    intervalMs: null,
    request: async (profile, path, input, signal) => {
      const response = await fetch(profile.connection.address + path, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${profile.connection.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })
      if (!response.ok)
        throw new Error(`State exchange failed (${response.status}): ${await response.text()}`)
      return response.json()
    },
  })
  try {
    await a.save('from first runtime')
    const targets = await Promise.all(
      [a, b].map(async (f) => {
        const token = randomBytes(32).toString('hex')
        f.runtime.services.devices.add('Shared state app', token)
        const snapshot = decode(
          snapshotSchema,
          await (await f.call('/api/snapshot', undefined, token)).json(),
        )
        expect(snapshot.stateReplicationVersion).toBe(1)
        return {
          profile: runtimeProfile({
            address: `http://127.0.0.1:${f.runtime.port}`,
            token,
            runtimeId: f.runtime.services.runtimeId,
          }),
          snapshot,
          connected: true,
        }
      }),
    )
    controller.update(targets, true)
    await expect.poll(() => global(b)).toBe('from first runtime')
    await b.save('from second runtime')
    controller.retry()
    await expect.poll(() => global(a)).toBe('from second runtime')
    await expect.poll(() => shared[0]?.value.taskDefaults?.setupCommand).toBe('from second runtime')
    expect(await a.runtime.services.stateReplication.history('global')).toHaveLength(2)
    expect(errors.filter(Boolean)).toEqual([])
    controller.update([], true)
  } finally {
    await controller.stop()
    await Promise.all([a.close(), b.close()])
  }
})
