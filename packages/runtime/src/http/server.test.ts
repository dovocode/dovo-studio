import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { activitySchema, responses, snapshotSchema } from '@dovo/protocol'
import type { AgentAdapter } from '../agents/types'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
describe('authenticated runtime', () => {
  it('rejects a malformed request target without crashing the runtime', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: randomBytes(32).toString('base64url'),
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const response = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        httpRequest({ hostname: '127.0.0.1', port: runtime.port, path: 'http://[' }, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            body += chunk
          })
          response.on('error', reject)
          response.on('end', () => resolve({ status: response.statusCode, body }))
        })
          .on('error', reject)
          .end()
      },
    )
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toEqual({ error: 'Invalid request URL' })
    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, service: 'dovo-runtime' })
  })
  it('cleans dictation only after authentication and strict input validation', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Fix usePulls.'))
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      run,
      probe: vi.fn<AgentAdapter['probe']>(),
    })
    const request = (body: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/dictation/cleanup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await request({ text: 'fix usePulls' }, 'invalid')).status).toBe(401)
    expect((await request({ text: 'fix usePulls', execute: true })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    const response = await request({ text: 'um fix usePulls' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: 'Fix usePulls.' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(runtime.services.store.get().tasks).toEqual([])
  })
  it('returns authenticated snapshot validators across encodings and changes them for workspace, approval, and device updates', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    const url = `http://127.0.0.1:${runtime.port}/api/snapshot`
    const get = (tag?: string, credential = token, encoding = 'identity') =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${credential}`,
          'Accept-Encoding': encoding,
          ...(tag ? { 'If-None-Match': tag } : {}),
        },
      })
    const first = await get()
    const initial = snapshotSchema.parse(await first.json())
    const tag = first.headers.get('etag') ?? ''
    expect(tag).toMatch(/^W\/"snapshot-/)
    expect(first.headers.get('access-control-expose-headers')).toContain('ETag')
    const unchanged = await get(`"unrelated", ${tag.slice(2)}`, token, 'gzip')
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('etag')).toBe(tag)
    expect(unchanged.headers.get('content-encoding')).toBeNull()
    expect(await unchanged.text()).toBe('')
    const preflight = await fetch(url, { method: 'OPTIONS' })
    expect(preflight.headers.get('access-control-allow-headers')).toContain('If-None-Match')
    expect((await get(tag, 'invalid-token')).status).toBe(401)

    runtime.services.store.update((workspace) => ({
      ...workspace,
      runtimeAddress: 'http://new-host:51464',
    }))
    const updated = await get(tag)
    expect(updated.status).toBe(200)
    const workspaceTag = updated.headers.get('etag') ?? ''
    expect(workspaceTag).not.toBe(tag)
    const afterWorkspace = snapshotSchema.parse(await updated.json())
    expect(afterWorkspace.revision).toBeGreaterThan(initial.revision)

    const controller = new AbortController()
    const approval = runtime.services.approvals.request(
      'task',
      'Edit file',
      'Review the change',
      controller.signal,
    )
    const withApproval = await get(workspaceTag)
    expect(withApproval.status).toBe(200)
    const approvalTag = withApproval.headers.get('etag') ?? ''
    const approving = snapshotSchema.parse(await withApproval.json())
    expect(approving.revision).toBe(afterWorkspace.revision)
    expect(approving.approvals).toHaveLength(1)
    controller.abort()
    await approval
    expect((await get(approvalTag)).status).toBe(200)

    const deviceToken = randomBytes(32).toString('base64url')
    const deviceId = runtime.services.devices.add('Phone', deviceToken)
    const withDevice = await get(workspaceTag)
    expect(withDevice.status).toBe(200)
    const deviceTag = withDevice.headers.get('etag') ?? ''
    expect(snapshotSchema.parse(await withDevice.json()).devices).toHaveLength(1)
    const phone = await get(deviceTag, deviceToken)
    expect(phone.status).toBe(200)
    const phoneTag = phone.headers.get('etag') ?? ''
    expect(snapshotSchema.parse(await phone.json()).owner).toBe(false)
    expect((await get(phoneTag, deviceToken)).status).toBe(304)
    runtime.services.devices.revoke(deviceId)
    expect((await get(phoneTag, deviceToken)).status).toBe(401)
    expect((await get(deviceTag)).status).toBe(200)
  })
  it('compresses large snapshots for phones while honoring identity and gzip opt-outs', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: [
        {
          id: 'agent',
          name: 'Test',
          provider: 'codex',
          model: '',
          permission: 'ask',
          endpoint: '',
          instructions: 'A long history of agent work. '.repeat(1000),
        },
      ],
    }))
    const url = `http://127.0.0.1:${runtime.port}/api/snapshot`
    let plainLength = 0
    for (const encoding of ['identity', '*;q=1, gzip;q=0', 'gzip;q=0.0']) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': encoding },
      })
      expect(response.headers.get('content-encoding')).toBeNull()
      const value = snapshotSchema.parse(await response.json())
      expect(value.workspace.agents[0].instructions).toHaveLength(30000)
      plainLength = Number(response.headers.get('content-length'))
    }
    for (const encoding of ['gzip', 'br, GZip;q=0.5', '*;q=0.5']) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': encoding },
      })
      expect(response.headers.get('content-encoding')).toBe('gzip')
      expect(response.headers.get('vary')).toBe('Accept-Encoding')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(Number(response.headers.get('content-length'))).toBeLessThan(plainLength / 2)
      expect(
        snapshotSchema.parse(await response.json()).workspace.agents[0].instructions,
      ).toHaveLength(30000)
    }
    const denied = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('content-encoding')).toBeNull()
  })
  it('requires host approval, consumes codes once and revokes device access', async () => {
    const token = randomBytes(32).toString('base64url'),
      runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    const base = `http://127.0.0.1:${runtime.port}`
    const call = (path: string, input: unknown, credential?: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(input),
      })
    expect((await fetch(base + '/api/snapshot')).status).toBe(401)
    const code = responses.pairCode.parse(await (await call('/api/pair/code', {}, token)).json())
    const pending = responses.pairRequest.parse(
      await (await call('/api/pair/request', { code: code.code, name: 'Test phone' })).json(),
    )
    expect((await call('/api/pair/request', { code: code.code, name: 'Replay' })).status).toBe(400)
    expect(
      responses.pairClaim.parse(await (await call('/api/pair/claim', pending)).json()).status,
    ).toBe('pending')
    expect((await call('/api/pair/approve', { id: pending.id, allow: true })).status).toBe(401)
    await call('/api/pair/approve', { id: pending.id, allow: true }, token)
    const claimed = responses.pairClaim.parse(await (await call('/api/pair/claim', pending)).json())
    expect(claimed.status).toBe('approved')
    expect(claimed.token).toBeTruthy()
    expect(await (await call('/api/pair/claim', pending)).json()).toEqual(claimed)
    const result = await fetch(base + '/api/snapshot', {
      headers: { Authorization: `Bearer ${claimed.token}` },
    })
    const snapshot = snapshotSchema.parse(await result.json())
    expect(snapshot.owner).toBe(false)
    expect((await call('/api/pair/code', {}, claimed.token)).status).toBe(403)
    await call('/api/devices/revoke', { id: snapshot.devices[0].id }, token)
    expect(
      (
        await fetch(base + '/api/snapshot', {
          headers: { Authorization: `Bearer ${claimed.token}` },
        })
      ).status,
    ).toBe(401)
  })
  it('merges independent fields and rejects conflicting stale writes', async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'owner-token-at-least-thirty-two-characters',
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const store = runtime.services.store
    store.update(() => f.workspace)
    store.patch({
      collection: 'agents',
      id: 'agent',
      changes: { name: { before: 'Test', after: 'Renamed' } },
    })
    store.patch({
      collection: 'agents',
      id: 'agent',
      changes: { instructions: { before: '', after: 'New instructions' } },
    })
    expect(store.get().agents[0].name).toBe('Renamed')
    expect(() =>
      store.patch({
        collection: 'agents',
        id: 'agent',
        changes: { name: { before: 'Test', after: 'Stale' } },
      }),
    ).toThrow('Another client changed name')
    expect(store.get().agents[0].name).toBe('Renamed')
  })
})

it('journals Shortcut submissions once and never logs activity reads', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const call = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const submission = { id: 'shortcut-test', text: 'Review the checkout', title: 'Phone task' }
  expect((await call('/api/shortcuts/received', submission, 'invalid')).status).toBe(401)
  expect((await call('/api/shortcuts/received', submission)).status).toBe(200)
  expect((await call('/api/shortcuts/received', submission)).status).toBe(200)
  const history = activitySchema.parse(
    await (await call('/api/activity', { kind: 'submission' })).json(),
  )
  expect(history.events).toHaveLength(1)
  expect(history.events[0].payload).toContain(submission.text)
  const count = runtime.services.activity.list('', '', 0).events.length
  await call('/api/activity', {})
  expect(runtime.services.activity.list('', '', 0).events).toHaveLength(count)
})
