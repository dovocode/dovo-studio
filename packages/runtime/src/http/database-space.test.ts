import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { startRuntime } from '../index.js'
import { databaseSpace } from '../storage/database-space.js'
import { decode, taskSchema } from '@dovo/protocol'

it('reports real free pages, backs up before compaction, and preserves credentials and history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-space-'))
  const token = 'space-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({
    databasePath: join(dir, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  const request = (path: string, body: unknown, credential = token, agent = false) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
        ...(agent ? { 'X-Dovo-Agent-Access': '1' } : {}),
      },
      body: JSON.stringify(body),
    })
  try {
    const db = runtime.services.db
    runtime.services.devices.add('Phone', 'paired-space-phone')
    db.prepare('INSERT INTO documents VALUES (?,?)').run('keep-space-test', 'history kept')
    db.prepare('INSERT INTO documents VALUES (?,?)').run(
      'removed-space-test',
      'x'.repeat(4 * 1024 * 1024),
    )
    db.prepare('DELETE FROM documents WHERE id=?').run('removed-space-test')
    const before = await databaseSpace(db)
    expect(before.reclaimableBytes).toBeGreaterThan(3 * 1024 * 1024)
    expect(
      (await request('/api/runtime/storage/recover', { confirm: true }, token, true)).status,
    ).toBe(403)
    expect((await request('/api/runtime/storage/recover', {}, token)).status).toBe(400)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [
        decode(taskSchema, {
          id: 'active-child',
          title: 'Native background work',
          agentId: '',
          repositoryId: '',
          status: 'running',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
          subagents: [
            {
              id: 'native',
              provider: 'opencode',
              name: 'Shell',
              status: 'working',
              sessionLive: true,
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ],
    }))
    expect((await request('/api/runtime/storage/recover', { confirm: true })).status).toBe(409)
    runtime.services.store.update((workspace) => ({ ...workspace, tasks: [] }))
    const backupFailure = vi
      .spyOn(runtime.services.backups, 'create')
      .mockRejectedValueOnce(new Error('Disk full'))
    expect(
      (await request('/api/runtime/storage/recover', { confirm: true }, 'paired-space-phone'))
        .status,
    ).toBe(500)
    expect((await databaseSpace(db)).reclaimableBytes).toBe(before.reclaimableBytes)
    expect(runtime.services.databaseSpace.active).toBe(false)
    backupFailure.mockRestore()
    const response = await request(
      '/api/runtime/storage/recover',
      { confirm: true },
      'paired-space-phone',
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.after.reclaimableBytes).toBe(0)
    expect(result.after.fileBytes).toBeLessThan(before.logicalBytes)
    const saved = new Database(result.backup.path, { readonly: true })
    try {
      expect(
        saved.prepare('SELECT value FROM documents WHERE id=?').pluck().get('keep-space-test'),
      ).toBe('history kept')
      expect(saved.pragma('quick_check', { simple: true })).toBe('ok')
    } finally {
      saved.close()
    }
    expect(
      db.prepare('SELECT value FROM documents WHERE id=?').pluck().get('keep-space-test'),
    ).toBe('history kept')
    expect((await request('/api/runtime/storage', {}, 'paired-space-phone')).status).toBe(200)
    console.log('Database space recovery measurement', {
      logicalBytes: before.logicalBytes,
      durationMs: result.durationMs,
      reclaimedBytes: before.logicalBytes - result.after.logicalBytes,
    })
  } finally {
    await runtime.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('rejects in-memory recovery and keeps a maintenance admission lease until release', async () => {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'space-failure-token-at-least-thirty-two-characters',
    port: 0,
  })
  try {
    const backup = vi
      .spyOn(runtime.services.backups, 'create')
      .mockRejectedValue(new Error('Disk full'))
    const lease = runtime.services.tasks.prepareMaintenance()
    expect(() => runtime.services.tasks.prepareRestart()).toThrow('already in progress')
    runtime.services.tasks.cancelRestart(lease.id)
    expect(() => runtime.services.tasks.prepareRestart()).not.toThrow()
    await expect(runtime.services.databaseSpace.recover()).rejects.toThrow('in-memory')
    expect(backup).not.toHaveBeenCalled()
    expect(runtime.services.databaseSpace.active).toBe(false)
    expect(runtime.services.db.pragma('quick_check', { simple: true })).toBe('ok')
    backup.mockRestore()
  } finally {
    await runtime.close()
  }
})

it('returns only a safe status for fresh secret checks and rejects agent access', async () => {
  const token = 'secret-check-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const original = process.env.APP_CHECK_REFERENCE
  const request = (agent = false) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/secrets/check`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(agent ? { 'X-Dovo-Agent-Access': '1' } : {}),
      },
      body: JSON.stringify({
        reference: { provider: 'environment', reference: 'APP_CHECK_REFERENCE' },
      }),
    })
  try {
    process.env.APP_CHECK_REFERENCE = 'sensitive-value-never-returned'
    expect(await (await request()).json()).toEqual({ ok: true })
    delete process.env.APP_CHECK_REFERENCE
    const missing = await request()
    expect(missing.status).toBe(400)
    const message = await missing.text()
    expect(message).toContain('secret manager login')
    expect(message).not.toContain('sensitive-value')
    expect((await request(true)).status).toBe(403)
  } finally {
    if (original === undefined) delete process.env.APP_CHECK_REFERENCE
    else process.env.APP_CHECK_REFERENCE = original
    await runtime.close()
  }
})
