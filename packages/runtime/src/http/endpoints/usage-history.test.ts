import { expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import protobuf from 'protobufjs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { builtInAgentPresets } from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'

it('scans resolved transcript directories without resolving unrelated secrets or falling back on failures', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    vi.stubEnv('DOVO_TEST_TRANSCRIPT_HOME', '/configured-transcripts')
    runtime.services.store.update(() => ({
      ...f.workspace,
      agents: f.workspace.agents.map((agent) => ({
        ...agent,
        envSecrets: {
          CODEX_HOME: { provider: 'environment' as const, reference: 'DOVO_TEST_TRANSCRIPT_HOME' },
          API_KEY: { provider: 'onepassword' as const, reference: 'op://vault/item/secret' },
        },
      })),
    }))
    vi.spyOn(runtime.services.store.usagePricing, 'refresh').mockResolvedValue(undefined)
    const read = vi
      .spyOn(runtime.services.store.usageTranscripts, 'read')
      .mockResolvedValue({ records: [], notices: [] })
    const call = () =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/history/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: new Date().toISOString() }),
      })
    expect((await call()).status).toBe(200)
    expect(read.mock.calls[0]?.[0].find((agent) => agent.id === 'agent')).toMatchObject({
      env: { CODEX_HOME: '/configured-transcripts' },
      envSecrets: undefined,
    })
    vi.stubEnv('DOVO_TEST_TRANSCRIPT_HOME', undefined)
    runtime.services.agents.secretReferences.refresh()
    expect(await (await call()).json()).toMatchObject({
      notices: [expect.stringContaining('Could not resolve transcript directories')],
    })
    expect(read.mock.calls[1]?.[0].find((agent) => agent.id === 'agent')).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    await runtime.close()
    await f.cleanup()
  }
})

it('exports stored records beyond the chart range without scanning transcripts and validates retention changes', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const usage = runtime.services.store.usage
  const scanning = vi.spyOn(runtime.services.store.usageTranscripts, 'read')
  const post = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  try {
    usage.recordExternal([
      {
        taskId: 'old',
        title: 'Old usage',
        origin: 'cli',
        turn: {
          id: 'old',
          assistantId: 'reply',
          agentId: 'agent',
          provider: 'codex',
          model: 'model',
          status: 'completed',
          startedAt: '2020-01-01T00:00:00.000Z',
          tokens: 50,
        },
      },
    ])
    expect((await post('/api/usage/storage/read', {}, 'wrong-token')).status).toBe(401)
    expect(await (await post('/api/usage/storage/read', {})).json()).toMatchObject({
      count: 1,
      days: null,
      oldest: '2020-01-01T00:00:00.000Z',
    })
    expect(await (await post('/api/usage/storage/export', {})).json()).toMatchObject({
      records: [{ taskId: 'old', turn: { tokens: 50 } }],
    })
    expect(scanning).not.toHaveBeenCalled()
    expect((await post('/api/usage/storage/write', { days: -1 })).status).toBe(400)
    expect(usage.storage().count).toBe(1)
    expect(await (await post('/api/usage/storage/write', { days: 90 })).json()).toMatchObject({
      count: 0,
      days: 90,
    })
    expect(await (await post('/api/usage/storage/write', { days: null })).json()).toMatchObject({
      count: 0,
      days: null,
    })
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
  }
})

it('imports external Antigravity usage once and retains it after removing the configured agent', async () => {
  const f = await fixture()
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    const root = join(f.workspace.repositories[0].path, 'agy-profile')
    for (const variable of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'OPENCODE_DATA_DIR'])
      vi.stubEnv(variable, join(root, 'unused', variable))
    vi.stubEnv('GEMINI_HOME', join(root, 'unused-default'))
    const preset = builtInAgentPresets().find((agent) => agent.id === 'dovo:antigravity')!
    const agent = { ...preset, id: 'custom-agy', env: { GEMINI_HOME: root } }
    s.store.update(() => ({ ...f.workspace, agents: [agent] }))
    vi.spyOn(s.store.usagePricing, 'refresh').mockResolvedValue(undefined)
    const directory = join(root, 'antigravity-acp', 'conversations')
    await mkdir(directory, { recursive: true })
    const timestamp = protobuf.Writer.create()
      .uint32(8)
      .uint64(Math.floor(Date.now() / 1000))
      .finish()
    const tally = protobuf.Writer.create()
      .uint32(16)
      .uint32(100)
      .uint32(24)
      .uint32(7)
      .uint32(90)
      .string('same-request')
      .finish()
    const generation = protobuf.Writer.create()
      .uint32(250)
      .bytes(Buffer.alloc(360000))
      .uint32(34)
      .bytes(tally)
      .uint32(154)
      .string('Gemini-4-Neon (High)')
      .finish()
    const step = protobuf.Writer.create()
      .uint32(66)
      .bytes(timestamp)
      .uint32(74)
      .bytes(tally)
      .finish()
    for (const session of ['cli-session', 'owned-session']) {
      const db = new Database(join(directory, `${session}.db`))
      try {
        db.exec(
          'CREATE TABLE steps (idx INTEGER, metadata BLOB); CREATE TABLE gen_metadata (id INTEGER PRIMARY KEY, idx INTEGER, data BLOB)',
        )
        db.prepare('INSERT INTO steps VALUES (?, ?)').run(9, Buffer.from(step))
        db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
          7,
          Buffer.from(protobuf.Writer.create().uint32(10).bytes(generation).finish()),
        )
      } finally {
        db.close()
      }
    }
    const now = new Date().toISOString()
    s.store.usage.recordExternal([
      {
        taskId: 'owned',
        title: 'Dovo turn',
        sessionId: 'owned-session',
        origin: 'dovo',
        turn: {
          id: 'owned',
          assistantId: 'owned',
          provider: 'acp',
          agentId: agent.id,
          model: 'gemini-4-neon',
          status: 'completed',
          startedAt: now,
          tokens: 8,
        },
      },
    ])
    const refresh = async () => {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/usage/history/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: new Date(Date.now() - 86400000).toISOString(), force: true }),
      })
      expect(response.status).toBe(200)
      const { records } = await response.json()
      return records.filter((record: { title: string }) => record.title === 'Antigravity CLI')
    }
    const history = await refresh()
    expect(history).toMatchObject([
      {
        sessionId: 'cli-session',
        origin: 'cli',
        turn: {
          model: 'gemini-4-neon',
          tokens: 107,
          tokenUsage: { input: 100, output: 7 },
        },
      },
    ])
    expect(await refresh()).toEqual(history)
    s.store.update((workspace) => ({ ...workspace, agents: [] }))
    expect(await refresh()).toEqual(history)
  } finally {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
