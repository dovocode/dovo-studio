import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { randomUUID } from 'node:crypto'
import { decode, linearConnectionsSchema, linearIssuesSchema } from '@dovo/protocol'
import { fixture } from '../testing/fixture.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('routes each Linear project to its saved connection and team and rejects stale reads', async () => {
  vi.stubEnv('DOVO_LINEAR_API_KEY', 'fixture-default-key')
  const project = await fixture()
  const token = 'linear-connections-owner-token-at-least-32-characters'
  const realFetch = globalThis.fetch
  const result = Response.json({
    data: {
      issues: {
        nodes: ['ENG-7', 'OPS-7'].map((identifier) => ({
          id: identifier,
          identifier,
          title: 'Fixture issue',
          description: null,
          url: `https://linear.app/fixture/issue/${identifier}`,
          state: { name: 'In progress' },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  })
  const calls: { key: string | null; filter: unknown }[] = []
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (input !== 'https://api.linear.app/graphql') return realFetch(input, init)
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request')
    calls.push({
      key: new Headers(init?.headers).get('Authorization'),
      filter: JSON.parse(init.body).variables.filter,
    })
    if (started) {
      await new Promise<void>((resolve) => {
        release = resolve
        started?.()
        started = undefined
      })
    }
    return result.clone()
  })
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: project.workspace.repositories,
    }))
    const send = (path: string, input?: unknown, extra: Record<string, string> = {}) =>
      realFetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
        body: input === undefined ? undefined : JSON.stringify(input),
      })
    const connections = '/api/scm/linear/key/connections'
    const issues = '/api/scm/linear/issues/read'
    const a = {
      action: 'save',
      id: randomUUID(),
      name: 'First workspace',
      key: 'fixture-first-key',
    }
    const b = {
      action: 'save',
      id: randomUUID(),
      name: 'Second workspace',
      key: 'fixture-second-key',
    }
    expect((await send(connections, a, { 'x-dovo-agent-access': '1' })).status).toBe(403)
    expect((await send(connections, a)).status).toBe(200)
    const state = decode(linearConnectionsSchema, await (await send(connections, b)).json())
    expect(state.connections.map(({ id }) => id)).toEqual([a.id, b.id])
    const reply = await send(connections, {
      action: 'bind',
      repositoryId: 'repo',
      connectionId: b.id,
      team: 'eng',
    })
    const binding = decode(linearConnectionsSchema, await reply.json()).bindings[0]
    expect(binding).toMatchObject({ repositoryId: 'repo', connectionId: b.id, team: 'ENG' })
    const snapshot = await (await send('/api/snapshot?scope=overview')).text()
    expect(snapshot).toContain('First workspace')
    expect(snapshot).toContain('ENG')
    for (const key of [a.key, b.key, 'fixture-default-key']) expect(snapshot).not.toContain(key)
    const scoped = await send(issues, { repositoryId: 'repo', search: 'ENG-7' })
    expect(
      decode(linearIssuesSchema, await scoped.json()).items.map(({ identifier }) => identifier),
    ).toEqual(['ENG-7'])
    expect(calls.at(-1)).toEqual({
      key: b.key,
      filter: { team: { key: { eq: 'ENG' } }, number: { eq: 7 } },
    })
    const requests = calls.length
    expect(await (await send(issues, { repositoryId: 'repo', search: 'OPS-7' })).json()).toEqual({
      items: [],
    })
    expect(calls).toHaveLength(requests)
    expect((await send(issues, { connectionId: a.id })).status).toBe(200)
    expect(calls.at(-1)?.key).toBe(a.key)
    expect((await send(issues, {})).status).toBe(200)
    expect(calls.at(-1)?.key).toBe('fixture-default-key')

    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    const inFlight = send(issues, { repositoryId: 'repo' })
    await reading
    try {
      expect(
        (
          await send(connections, {
            action: 'unbind',
            repositoryId: 'repo',
            expectedRevision: binding.revision,
          })
        ).status,
      ).toBe(200)
    } finally {
      release?.()
    }
    expect((await inFlight).status).toBe(409)
    expect((await send(issues, { repositoryId: 'repo' })).status).toBe(404)
  } finally {
    await runtime.close()
    await project.cleanup()
  }
})

it('configures and removes Linear access from a paired client without exposing the key', async () => {
  vi.stubEnv('DOVO_LINEAR_API_KEY', 'environment-key-for-test')
  const token = 'linear-test-device-token-at-least-32-characters'
  const realFetch = globalThis.fetch
  const used: string[] = []
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    if (input !== 'https://api.linear.app/graphql') return realFetch(input, init)
    const key = new Headers(init?.headers).get('Authorization') ?? ''
    used.push(key)
    return key === 'invalid-key'
      ? Promise.resolve(new Response('', { status: 401 }))
      : Promise.resolve(
          Response.json({
            data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
          }),
        )
  })
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: `${token}-owner`,
    port: 0,
  })
  try {
    runtime.services.devices.add('Linear test', token)
    const send = (path: string, input?: unknown, extra: Record<string, string> = {}) =>
      realFetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
        body: input === undefined ? undefined : JSON.stringify(input),
      })
    const snapshot = async (source: string) => {
      const reply = await send('/api/snapshot?scope=overview')
      expect(reply.status).toBe(200)
      const text = await reply.text()
      expect(JSON.parse(text)).toMatchObject({
        linearKeySource: source,
        linearIssuesSupported: true,
      })
      expect(text).not.toContain('settings-key-for-test')
      expect(text).not.toContain('environment-key-for-test')
    }
    await snapshot('environment')
    const save = '/api/scm/linear/key/save'
    expect(
      (await send(save, { key: 'settings-key-for-test' }, { 'x-dovo-agent-access': '1' })).status,
    ).toBe(403)
    expect(used).toEqual([])
    await expect((await send(save, { key: 'settings-key-for-test' })).json()).resolves.toEqual({
      source: 'saved',
    })
    await snapshot('saved')
    expect((await send(save, { key: 'invalid-key' })).status).toBe(403)
    expect((await send('/api/scm/linear/issues/read', {})).status).toBe(200)
    expect(used.slice(-2)).toEqual(['invalid-key', 'settings-key-for-test'])
    await expect((await send('/api/scm/linear/key/remove', {})).json()).resolves.toEqual({
      source: 'environment',
    })
    expect((await send('/api/scm/linear/issues/read', {})).status).toBe(200)
    expect(used.at(-1)).toBe('environment-key-for-test')
    await snapshot('environment')
  } finally {
    await runtime.close()
  }
})
