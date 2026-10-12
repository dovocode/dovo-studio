import { expect, it } from 'vite-plus/test'
import { startRuntime } from '../index'
import { decode, snapshotSchema } from '@dovo/protocol'

it('shares validated icons with paired devices and invalidates their cached snapshots', async () => {
  const owner = 'runtime-icon-owner-token-at-least-32-characters'
  const phone = 'runtime-icon-phone-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  try {
    runtime.services.devices.add('Phone', phone)
    const origin = `http://127.0.0.1:${runtime.port}`
    const snapshot = (token: string, tag?: string) =>
      fetch(origin + '/api/snapshot', {
        headers: { Authorization: `Bearer ${token}`, ...(tag ? { 'If-None-Match': tag } : {}) },
      })
    const save = (changes: unknown) =>
      fetch(origin + '/api/runtime/preferences/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${phone}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    const first = await snapshot(owner)
    const tag = first.headers.get('etag')!
    expect(decode(snapshotSchema, await first.json()).runtimeIcon).toBe('desktop')
    expect((await save({ runtimeIcon: 'server' })).status).toBe(200)
    const updated = await snapshot(owner, tag)
    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).not.toBe(tag)
    expect(decode(snapshotSchema, await updated.json()).runtimeIcon).toBe('server')
    expect(decode(snapshotSchema, await (await snapshot(phone)).json()).runtimeIcon).toBe('server')
    expect((await save({ autoArchiveDays: 7 })).status).toBe(200)
    for (const runtimeIcon of ['unknown', '', null, 1])
      expect((await save({ runtimeIcon })).status).toBe(400)
    expect(runtime.services.preferences.get().runtimeIcon).toBe('server')
    expect((await save({ runtimeIcon: 'desktop' })).status).toBe(200)
    expect(decode(snapshotSchema, await (await snapshot(phone)).json()).runtimeIcon).toBe('desktop')
    expect(
      (
        await fetch(origin + '/api/runtime/preferences/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runtimeIcon: 'cloud' }),
        })
      ).status,
    ).toBe(401)
  } finally {
    await runtime.close()
  }
})
