import { expect, it } from 'vite-plus/test'
import { decode, runtimeDiagnosticsSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
import { runtimeDiagnostics } from './diagnostics'

it('keeps public health lightweight and readiness authenticated, showing stale schedulers and uncertain actions', async () => {
  const token = 'diagnostics-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const address = `http://127.0.0.1:${runtime.port}`
  try {
    const publicHealth = await fetch(address + '/health')
    expect(await publicHealth.json()).toEqual({
      ok: true,
      service: 'dovo-runtime',
      version: 1,
      runtimeId: runtime.services.runtimeId,
    })
    const request = (credential?: string) =>
      fetch(address + '/api/runtime/diagnostics', {
        method: 'POST',
        headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      })
    expect((await request()).status).toBe(401)
    runtime.services.devices.add('phone', 'paired-phone-token')
    expect((await request('paired-phone-token')).status).toBe(403)
    const now = Date.now()
    runtime.services.tasks.schedulerStatus.lastSuccess = new Date(now).toISOString()
    runtime.services.jobs.schedulerStatus.lastSuccess = new Date(now).toISOString()
    const healthy = decode(runtimeDiagnosticsSchema, await (await request(token)).json())
    expect(healthy.ready).toBe(true)
    expect(healthy.memory?.rssBytes).toBeGreaterThan(0)
    expect(healthy.memory?.heapUsedBytes).toBeLessThanOrEqual(healthy.memory?.heapLimitBytes ?? 0)
    runtime.services.store.providerActions.record({
      id: 'uncertain',
      taskId: 'task',
      attemptId: 'attempt',
      kind: 'start',
      state: 'uncertain',
    })
    const degraded = await runtimeDiagnostics(runtime.services, now + 30_000)
    expect(degraded.ready).toBe(false)
    expect(degraded.uncertain.count).toBe(1)
    expect(degraded.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('20 seconds'),
        expect.stringContaining('will not be replayed'),
      ]),
    )
    expect(runtime.services.store.providerActions.state('uncertain')).toBe('uncertain')
  } finally {
    await runtime.close()
  }
})
it('keeps historical uncertain actions visible without making healthy infrastructure unready', async () => {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'healthy-history-owner-token-with-thirty-two-characters',
    port: 0,
  })
  try {
    const s = runtime.services
    const now = Date.now()
    s.tasks.schedulerStatus.lastSuccess = new Date(now).toISOString()
    s.jobs.schedulerStatus.lastSuccess = new Date(now).toISOString()
    s.store.providerActions.record({
      id: 'old-uncertain',
      taskId: 'old-task',
      attemptId: 'old-attempt',
      kind: 'start',
      state: 'uncertain',
    })
    const task = s.tasks.create({
      title: 'Cancelled',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    s.store.updateTask(task.id, (value) => ({
      ...value,
      status: 'cancelled',
      error: 'Cancelled by user',
      queuePaused: true,
      queue: [{ id: 'queued', role: 'user', text: 'Next', createdAt: new Date(now).toISOString() }],
    }))
    const result = await runtimeDiagnostics(s, now)
    expect(result.ready).toBe(true)
    expect(result.uncertain.count).toBe(1)
    expect(result.warnings).toContain(
      '1 provider operations have uncertain outcomes; they will not be replayed automatically.',
    )
    expect(result.warnings.some((message) => message.includes('paused after an error'))).toBe(false)
    expect(s.store.providerActions.state('old-uncertain')).toBe('uncertain')
  } finally {
    await runtime.close()
  }
})

it('reports unavailable replication while keeping task execution readiness separate', async () => {
  const { ThreadReplication } = await import('../storage/thread-replication')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'replication-diagnostics-token-with-thirty-two-characters',
    port: 0,
  })
  const s = runtime.services
  await s.threadReplication.stop()
  s.db.prepare('INSERT INTO thread_state_log VALUES (?,?)').run(1, 'invalid json')
  const failed = new ThreadReplication(s.threadReplication.journal, s.store, s.retrievalPeers)
  s.threadReplication = failed
  try {
    await expect(failed.start()).rejects.toThrow(/invalid json|JSON/)
    const now = Date.now()
    s.tasks.schedulerStatus.lastSuccess = s.jobs.schedulerStatus.lastSuccess = new Date(
      now,
    ).toISOString()
    const status = decode(runtimeDiagnosticsSchema, await runtimeDiagnostics(s, now))
    expect(status.ready).toBe(true)
    expect(status.replication).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'shared-threads:v1',
          error: expect.stringContaining('preserved'),
        }),
      ]),
    )
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Thread replication is unavailable')]),
    )
  } finally {
    await failed.stop()
    await runtime.close()
  }
})
