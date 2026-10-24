import { Effect } from 'effect'
import {
  decode,
  defaultTaskHarness,
  taskSchema,
  RuntimeMutations,
  workspacePatchResultSchema,
  type MutationOutbox,
} from '@dovo/protocol'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { activitySchema, responses, snapshotSchema } from '@dovo/protocol'
import type { AgentAdapter } from '../agents/execution/types'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
describe('authenticated runtime', () => {
  it('lets a paired phone save the computer-wide web flag and releases waiting web requests', async () => {
    const ownerToken = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
    cleanups.push(() => runtime.close())
    const token = randomBytes(32).toString('base64url')
    runtime.services.devices.add('iPhone', token)
    const signal = new AbortController().signal
    const pending = runtime.services.approvals.request(
      'projectless',
      'WebSearch',
      '{}',
      signal,
      'web',
    )
    const shell = runtime.services.approvals.request(
      'projectless',
      'Run command',
      '{"command":"pwd"}',
      signal,
    )
    const save = (changes: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/runtime/preferences/save`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    expect((await save({ allowWebRequests: true })).status).toBe(200)
    await expect(pending).resolves.toBe('approve')
    expect(runtime.services.approvals.list().map((item) => item.title)).toEqual(['Run command'])
    expect((await save({ autoArchiveDays: 7 })).status).toBe(200)
    expect(runtime.services.preferences.get().allowWebRequests).toBe(true)
    const state = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(decode(snapshotSchema, await state.json()).allowWebRequests).toBe(true)
    expect((await save({ allowWebRequests: false })).status).toBe(200)
    const next = runtime.services.approvals.request('projectless', 'WebFetch', '{}', signal, 'web')
    expect(runtime.services.approvals.list()).toHaveLength(2)
    runtime.services.approvals.dispose()
    await expect(shell).resolves.toBe('deny')
    await expect(next).resolves.toBe('deny')
  })
  it('saves and revokes project web approvals through the authenticated mobile request paths', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Project', path: '/tmp/project', branch: 'main' }],
      tasks: [
        decode(taskSchema, {
          id: 'task',
          title: 'Task',
          repositoryId: 'repo',
          agentId: '',
          status: 'running',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        }),
      ],
    }))
    const send = (path: string, input: unknown, method = 'POST') =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const controller = new AbortController()
    const first = runtime.services.approvals.request(
      'task',
      'WebSearch',
      '{"query":"docs"}',
      controller.signal,
      'web',
    )
    const state = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(state.status).toBe(200)
    const snapshot = decode(snapshotSchema, await state.json())
    expect(snapshot.approvals[0].rememberRule).toBe('web')
    expect(
      (await send('/api/approvals', { id: snapshot.approvals[0].id, allow: true, remember: true }))
        .status,
    ).toBe(200)
    await expect(first).resolves.toBe('approve')
    await expect(
      runtime.services.approvals.request(
        'task',
        'WebFetch',
        '{"url":"http://example.com"}',
        controller.signal,
        'web',
      ),
    ).resolves.toBe('approve')
    const revoked = await send(
      '/api/workspace',
      {
        collection: 'repositories',
        id: 'repo',
        changes: { approvedWebRequests: { before: true, after: false } },
      },
      'PATCH',
    )
    expect(revoked.status).toBe(200)
    decode(workspacePatchResultSchema, await revoked.json())
    expect(runtime.services.store.get().repositories[0].approvedWebRequests).toBe(false)
    const next = runtime.services.approvals.request(
      'task',
      'WebSearch',
      '{}',
      controller.signal,
      'web',
    )
    expect(runtime.services.approvals.list()).toHaveLength(1)
    expect(
      (
        await send(
          '/api/workspace',
          {
            collection: 'repositories',
            id: 'repo',
            changes: { approvedWebRequests: { before: false, after: true } },
          },
          'PATCH',
        )
      ).status,
    ).toBe(200)
    await expect(next).resolves.toBe('approve')
    controller.abort()
  })
  it('rejects a malformed request target without crashing the runtime', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: randomBytes(32).toString('base64url'),
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const response = await new Promise<{
      status: number | undefined
      body: string
    }>((resolve, reject) => {
      httpRequest(
        {
          hostname: '127.0.0.1',
          port: runtime.port,
          path: 'http://[',
        },
        (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            body += chunk
          })
          response.on('error', reject)
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              body,
            }),
          )
        },
      )
        .on('error', reject)
        .end()
    })
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toEqual({
      error: 'Invalid request URL',
    })
    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      ok: true,
      service: 'dovo-runtime',
    })
  })
  it('cleans dictation only after authentication and strict input validation', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: token,
      port: 0,
    })
    cleanups.push(() => runtime.close())
    runtime.services.titles.save({
      harness: { provider: 'codex', endpoint: '' },
      model: 'utility-model',
    })
    const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Fix usePulls.'))
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      run,
      probe: vi.fn<AgentAdapter['probe']>(),
    })
    const request = (body: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/dictation/cleanup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    expect(
      (
        await request(
          {
            text: 'fix usePulls',
          },
          'invalid',
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await request({
          text: 'fix usePulls',
          execute: true,
        })
      ).status,
    ).toBe(400)
    expect(run).not.toHaveBeenCalled()
    const response = await request({
      text: 'um fix usePulls',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      text: 'Fix usePulls.',
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(runtime.services.store.get().tasks).toEqual([])
  })
  it('returns authenticated snapshot validators across encodings and changes them for workspace, approval, and device updates', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: token,
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const url = `http://127.0.0.1:${runtime.port}/api/snapshot`
    const get = (tag?: string, credential = token, encoding = 'identity') =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${credential}`,
          'Accept-Encoding': encoding,
          ...(tag
            ? {
                'If-None-Match': tag,
              }
            : {}),
        },
      })
    const first = await get()
    const initial = decode(snapshotSchema, await first.json())
    const tag = first.headers.get('etag') ?? ''
    expect(tag).toMatch(/^W\/"snapshot-/)
    expect(first.headers.get('access-control-expose-headers')).toContain('ETag')
    const unchanged = await get(`"unrelated", ${tag.slice(2)}`, token, 'gzip')
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('etag')).toBe(tag)
    expect(unchanged.headers.get('content-encoding')).toBeNull()
    expect(await unchanged.text()).toBe('')
    const preflight = await fetch(url, {
      method: 'OPTIONS',
    })
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
    const afterWorkspace = decode(snapshotSchema, await updated.json())
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
    const approving = decode(snapshotSchema, await withApproval.json())
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
    expect(decode(snapshotSchema, await withDevice.json()).devices).toHaveLength(1)
    const phone = await get(deviceTag, deviceToken)
    expect(phone.status).toBe(200)
    const phoneTag = phone.headers.get('etag') ?? ''
    expect(decode(snapshotSchema, await phone.json()).owner).toBe(false)
    expect((await get(phoneTag, deviceToken)).status).toBe(304)
    runtime.services.devices.revoke(deviceId)
    expect((await get(phoneTag, deviceToken)).status).toBe(401)
    expect((await get(deviceTag)).status).toBe(200)
  })
  it('compresses large snapshots for phones while honoring identity and gzip opt-outs', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: token,
      port: 0,
    })
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
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Encoding': encoding,
        },
      })
      expect(response.headers.get('content-encoding')).toBeNull()
      const value = decode(snapshotSchema, await response.json())
      expect(value.workspace.agents[0].instructions).toHaveLength(30000)
      plainLength = Number(response.headers.get('content-length'))
    }
    for (const encoding of ['gzip', 'br, GZip;q=0.5', '*;q=0.5']) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Encoding': encoding,
        },
      })
      expect(response.headers.get('content-encoding')).toBe('gzip')
      expect(response.headers.get('vary')).toBe('Accept-Encoding')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(Number(response.headers.get('content-length'))).toBeLessThan(plainLength / 2)
      expect(
        decode(snapshotSchema, await response.json()).workspace.agents[0].instructions,
      ).toHaveLength(30000)
    }
    const denied = await fetch(url, {
      headers: {
        'Accept-Encoding': 'gzip',
      },
    })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('content-encoding')).toBeNull()
  })
  it('keeps fleet overviews small while retaining task status and a separate validator', async () => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    const project = await fixture()
    cleanups.push(project.cleanup)
    runtime.services.store.update(() => ({
      ...project.workspace,
      tasks: [
        {
          id: 'task',
          title: 'Long task',
          repositoryId: 'repo',
          execution: 'main',
          agentId: 'agent',
          status: 'review',
          createdAt: new Date().toISOString(),
          messages: [{ id: 'message', role: 'assistant', text: 'long conversation '.repeat(5000) }],
          files: [
            {
              path: 'hello.txt',
              before: 'before '.repeat(5000),
              after: 'after '.repeat(5000),
              viewed: false,
            },
          ],
          draft: '',
          example: false,
        },
      ],
    }))
    const base = `http://127.0.0.1:${runtime.port}/api/snapshot`
    const headers = { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' }
    const full = await fetch(base, { headers })
    const overview = await fetch(`${base}?scope=overview`, { headers })
    const fullSnapshot = decode(snapshotSchema, await full.json())
    const summary = decode(snapshotSchema, await overview.json())
    expect(fullSnapshot.workspace.tasks[0].messages).toHaveLength(1)
    expect(summary.workspace.tasks[0]).toMatchObject({
      id: 'task',
      status: 'review',
      title: 'Long task',
      messages: [],
      files: [{ path: 'hello.txt', viewed: false, before: '', after: '' }],
    })
    expect(Number(overview.headers.get('content-length'))).toBeLessThan(
      Number(full.headers.get('content-length')) / 10,
    )
    expect(overview.headers.get('etag')).not.toBe(full.headers.get('etag'))
    expect(
      (
        await fetch(`${base}?scope=overview`, {
          headers: { ...headers, 'If-None-Match': overview.headers.get('etag') ?? '' },
        })
      ).status,
    ).toBe(304)
  })
  it('requires host approval, consumes codes once and revokes device access', async () => {
    const token = randomBytes(32).toString('base64url'),
      runtime = await startRuntime({
        databasePath: ':memory:',
        ownerToken: token,
        port: 0,
      })
    cleanups.push(() => runtime.close())
    const base = `http://127.0.0.1:${runtime.port}`
    const call = (path: string, input: unknown, credential?: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credential
            ? {
                Authorization: `Bearer ${credential}`,
              }
            : {}),
        },
        body: JSON.stringify(input),
      })
    expect((await fetch(base + '/api/snapshot')).status).toBe(401)
    const code = decode(responses.pairCode, await (await call('/api/pair/code', {}, token)).json())
    const pending = decode(
      responses.pairRequest,
      await (
        await call('/api/pair/request', {
          protocolVersion: 2,
          code: code.code,
          name: 'Test phone',
        })
      ).json(),
    )
    expect(
      (
        await call('/api/pair/request', {
          protocolVersion: 2,
          code: code.code,
          name: 'Replay',
        })
      ).status,
    ).toBe(400)
    expect(
      decode(responses.pairClaim, await (await call('/api/pair/claim', pending)).json()).status,
    ).toBe('pending')
    expect(
      (
        await call('/api/pair/approve', {
          id: pending.id,
          allow: true,
        })
      ).status,
    ).toBe(401)
    await call(
      '/api/pair/approve',
      {
        id: pending.id,
        allow: true,
      },
      token,
    )
    const claimed = decode(
      responses.pairClaim,
      await (await call('/api/pair/claim', pending)).json(),
    )
    expect(claimed.status).toBe('approved')
    expect(claimed.token).toBeTruthy()
    expect(await (await call('/api/pair/claim', pending)).json()).toEqual(claimed)
    const result = await fetch(base + '/api/snapshot', {
      headers: {
        Authorization: `Bearer ${claimed.token}`,
      },
    })
    const snapshot = decode(snapshotSchema, await result.json())
    expect(snapshot.owner).toBe(false)
    expect((await call('/api/pair/code', {}, claimed.token)).status).toBe(403)
    await call(
      '/api/devices/revoke',
      {
        id: snapshot.devices[0].id,
      },
      token,
    )
    expect(
      (
        await fetch(base + '/api/snapshot', {
          headers: {
            Authorization: `Bearer ${claimed.token}`,
          },
        })
      ).status,
    ).toBe(401)
  })
  it('merges independent fields and preserves conflicting stale writes with runtime values winning', async () => {
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
      changes: {
        name: {
          before: 'Test',
          after: 'Renamed',
        },
      },
    })
    store.patch({
      collection: 'agents',
      id: 'agent',
      changes: {
        instructions: {
          before: '',
          after: 'New instructions',
        },
      },
    })
    expect(store.get().agents[0].name).toBe('Renamed')
    expect(
      store.patch({
        collection: 'agents',
        id: 'agent',
        changes: {
          name: {
            before: 'Test',
            after: 'Stale',
          },
        },
      }),
    ).toEqual({ reconciled: true })
    expect(store.recoveredEdits()).toEqual([
      expect.objectContaining({
        patch: expect.objectContaining({ changes: { name: { before: 'Test', after: 'Stale' } } }),
        host: { name: 'Renamed' },
      }),
    ])
    expect(store.get().agents[0].name).toBe('Renamed')
  })
})
it('journals Shortcut submissions once and never logs activity reads', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const call = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  const submission = {
    id: 'shortcut-test',
    text: 'Review the checkout',
    title: 'Phone task',
  }
  expect((await call('/api/shortcuts/received', submission, 'invalid')).status).toBe(401)
  expect((await call('/api/shortcuts/received', submission)).status).toBe(200)
  expect((await call('/api/shortcuts/received', submission)).status).toBe(200)
  const history = decode(
    activitySchema,
    await (
      await call('/api/activity', {
        kind: 'submission',
      })
    ).json(),
  )
  expect(history.events).toHaveLength(1)
  expect(history.events[0].payload).toContain(submission.text)
  const count = runtime.services.activity.list('', '', 0).events.length
  await call('/api/activity', {})
  expect(runtime.services.activity.list('', '', 0).events).toHaveLength(count)
})

it('never returns or records submitted secrets inside validation diagnostics', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/agents/mcp/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'audit',
      enabled: true,
      transport: 'http',
      url: 'http://127.0.0.1:1',
      env: { CUSTOM_VALUE: 'sk-synthetic-audit-only' },
    }),
  })
  expect(response.status).toBe(400)
  const text = await response.text()
  expect(text).toContain('Invalid request data')
  expect(text).not.toContain('sk-synthetic-audit-only')
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(
    'sk-synthetic-audit-only',
  )
})

it('allows a device to revoke only its own credential and protects the owner', async () => {
  const owner = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanups.push(() => runtime.close())
  const token = randomBytes(32).toString('base64url')
  const other = randomBytes(32).toString('base64url')
  runtime.services.devices.add('Self', token)
  const otherId = runtime.services.devices.add('Other', other)
  const revoke = (credential: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/devices/revoke-self`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: otherId }),
    })
  expect((await revoke(owner)).status).toBe(403)
  expect((await revoke(token)).status).toBe(200)
  expect(() => runtime.services.devices.authenticate(token)).toThrow('authentication required')
  expect(runtime.services.devices.authenticate(other).id).toBe(otherId)
})

it.each(['draft', 'done'] as const)(
  'accepts model settings patches that clear optional fields with null on a %s thread',
  async (status) => {
    const token = randomBytes(32).toString('base64url')
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(() => runtime.close())
    const task = decode(taskSchema, {
      id: 'model-switch',
      title: 'Model switch',
      repositoryId: '',
      agentId: '',
      status,
      createdAt: '',
      messages: [],
      files: [],
      draft: '',
      example: false,
      harness: defaultTaskHarness('codex'),
      agentOverrides: { model: 'old-model' },
      harnessCustomized: true,
    })
    runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/workspace`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'tasks',
        id: task.id,
        changes: {
          harness: { before: task.harness, after: { ...task.harness, model: 'new-model' } },
          agentOverrides: { before: task.agentOverrides, after: null },
          harnessCustomized: { before: true, after: null },
        },
      }),
    })
    expect(await response.json()).toMatchObject({ revision: expect.any(Number) })
    expect(response.status).toBe(200)
    expect(runtime.services.store.task(task.id).harness?.model).toBe('new-model')
    expect(runtime.services.store.task(task.id).agentOverrides).toBeUndefined()
    expect(runtime.services.store.task(task.id).harnessCustomized).toBeUndefined()
  },
)

it('reconciles HTTP model-switch conflicts, preserves the superseded edit, and permits the next edit', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const task = decode(taskSchema, {
    id: 'switch-http',
    title: 'Switch',
    repositoryId: '',
    agentId: '',
    status: 'done',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
    harness: defaultTaskHarness('codex'),
  })
  runtime.services.store.update((w) => ({ ...w, tasks: [task] }))
  const connection = { address: `http://127.0.0.1:${runtime.port}`, token }
  let pending: MutationOutbox = []
  let serial = 0
  const queue = new RuntimeMutations({
    id: () => `model-edit-${++serial}`,
    read: async () => pending,
    clear: async () => {
      pending = []
    },
    update: async (_, change) => {
      pending = change(pending)
      return pending
    },
  })
  const edit = (before: string, after: string) =>
    queue.requestEffect(
      connection,
      '/api/workspace',
      {
        collection: 'tasks',
        id: task.id,
        changes: {
          harness: {
            before: { ...task.harness, model: before },
            after: { ...task.harness, model: after },
          },
          agentOverrides: { before: null, after: null },
        },
      },
      workspacePatchResultSchema,
      'PATCH',
    )
  await Effect.runPromise(edit('', 'model-one'))
  const conflict = await Effect.runPromise(edit('', 'model-two'))
  expect(conflict).toMatchObject({ outcome: 'reconciled', reconciled: true })
  expect(queue.status(connection)).toEqual({ pending: 0, error: null, reviewRequired: false })
  expect(runtime.services.store.task(task.id).harness?.model).toBe('model-one')
  expect(runtime.services.store.recoveredEdits()).toEqual([
    expect.objectContaining({
      patch: expect.objectContaining({
        id: task.id,
        changes: expect.objectContaining({
          harness: expect.objectContaining({
            after: expect.objectContaining({ model: 'model-two' }),
          }),
        }),
      }),
    }),
  ])
  await Effect.runPromise(edit('model-one', 'model-two'))
  expect(queue.status(connection)).toEqual({ pending: 0, error: null, reviewRequired: false })
  expect(runtime.services.store.task(task.id).harness?.model).toBe('model-two')
})
