import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
