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
    expect(await publicHealth.json()).toEqual({ ok: true, service: 'dovo-runtime', version: 1 })
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
