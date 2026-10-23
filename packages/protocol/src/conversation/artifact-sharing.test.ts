import { afterEach, expect, it, vi } from 'vite-plus/test'
import { AccountClient } from '../auth/account-client.js'
import type { Artifact } from './artifacts.js'

afterEach(() => vi.unstubAllGlobals())
const account = 'a'.repeat(43),
  scoped = 'b'.repeat(43)
const artifact: Artifact = {
  id: '68d64fa8-46d3-4e85-bcc6-fd758aeebac9',
  taskId: 'private-thread',
  revision: 2,
  title: 'Report',
  format: 'markdown',
  content: '# Shared report',
  createdAt: '2026-10-21',
  updatedAt: '2026-10-21',
}
function fixture({ changed = false, revoke = false, override = '' } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = new AccountClient(
    { read: async () => account, write: async () => {} },
    async () => {},
    'https://connect.test',
    override,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push({ url, init })
      if (url.endsWith('/v1/servers'))
        return Response.json({ user: { id: 'owner', name: 'Owner' }, servers: [] })
      if (url.endsWith('/v1/artifacts/service'))
        return Response.json({ origin: 'https://artifacts.test' })
      if (url.endsWith('/v1/artifacts/session')) {
        if (revoke) await client.signOut()
        return Response.json({
          origin: changed ? 'https://different.test' : 'https://artifacts.test',
          token: scoped,
          expiresAt: Date.now() + 600_000,
        })
      }
      if (url.endsWith('/v1/publications'))
        return Response.json({
          publication: {
            id: artifact.id,
            title: artifact.title,
            format: artifact.format,
            revision: artifact.revision,
            createdAt: '2026-10-21',
          },
        })
      return Response.json({ ok: true })
    }),
  )
  return { client, calls }
}
it('uploads only selected artifact content with a sharing-only grant and removes private runtime metadata', async () => {
  const f = fixture()
  await f.client.load()
  const origin = await f.client.artifactService()
  const result = await f.client.publishArtifact(artifact, origin)
  const upload = f.calls.find((call) => call.url.startsWith('https://artifacts.test'))
  expect(upload?.init).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'POST' })
  expect(new Headers(upload?.init?.headers).get('Authorization')).toBe('Bearer ' + scoped)
  expect(
    new Headers(
      f.calls.find((call) => call.url.endsWith('/v1/artifacts/session'))?.init?.headers,
    ).get('Authorization'),
  ).toBe('Bearer ' + account)
  expect(upload?.init?.body).not.toContain('private-thread')
  expect(upload?.init?.body).not.toContain('createdAt')
  expect(result.manageUrl).toBe(origin + '/manage/' + artifact.id + '#session=' + scoped)
  expect(result.url).not.toContain(scoped)
})
it('requires renewed destination consent when the configured service changes', async () => {
  const f = fixture({ changed: true })
  await f.client.load()
  await expect(f.client.publishArtifact(artifact, 'https://artifacts.test')).rejects.toThrow(
    'service changed',
  )
  expect(f.calls.some((call) => !call.url.startsWith('https://connect.test'))).toBe(false)
})
it('cancels publication after account revocation before any artifact upload', async () => {
  const f = fixture({ revoke: true })
  await f.client.load()
  await expect(f.client.publishArtifact(artifact, 'https://artifacts.test')).rejects.toThrow(
    'cancelled',
  )
  expect(f.calls.some((call) => call.url.endsWith('/v1/publications'))).toBe(false)
})

it('pins a custom artifact store before sending sharing credentials or content', async () => {
  const f = fixture({ override: 'https://private-artifacts.test' })
  await f.client.load()
  await expect(f.client.artifactService()).rejects.toThrow('does not match Connect')
  await expect(f.client.publishArtifact(artifact, 'https://artifacts.test')).rejects.toThrow(
    'does not match Settings',
  )
  expect(f.calls.every((call) => call.url.startsWith('https://connect.test/'))).toBe(true)
})

it('restores hosted versions using a restricted grant, refreshes deletions and clears status on signout', async () => {
  const f = fixture()
  const indexCalls: RequestInit[] = []
  let publications = [
    {
      id: artifact.id,
      sourceId: artifact.id,
      title: artifact.title,
      format: artifact.format,
      revision: 1,
      createdAt: artifact.createdAt,
    },
  ]
  const original = fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (
        (url instanceof Request ? url.url : url.toString()).endsWith('/v1/publications/sources')
      ) {
        indexCalls.push(init ?? {})
        return Response.json({ publications })
      }
      return original(url, init)
    }),
  )
  await f.client.load()
  await f.client.refreshPublications()
  expect(f.client.snapshot()).toMatchObject({
    publications,
    publicationOrigin: 'https://artifacts.test',
    publicationError: '',
  })
  expect(new Headers(indexCalls[0].headers).get('Authorization')).toBe('Bearer ' + scoped)
  expect(indexCalls[0]).toMatchObject({ credentials: 'omit', redirect: 'error' })
  publications = []
  await f.client.refreshPublications()
  expect(f.client.snapshot().publications).toEqual([])
  await f.client.publishArtifact(artifact, 'https://artifacts.test')
  expect(f.client.snapshot().publications).toEqual([
    expect.objectContaining({ sourceId: artifact.id, revision: 2 }),
  ])
  await f.client.signOut()
  expect(f.client.snapshot()).toMatchObject({ publications: null, publicationOrigin: '' })
})

it('keeps a newly shared version when an older publication index finishes later', async () => {
  const f = fixture()
  const original = fetch
  let respond: ((response: Response) => void) | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if ((url instanceof Request ? url.url : url.toString()).endsWith('/v1/publications/sources'))
        return new Promise<Response>((resolve) => {
          respond = resolve
        })
      return original(url, init)
    }),
  )
  await f.client.load()
  const refresh = f.client.refreshPublications()
  expect(f.client.refreshPublications()).toBe(refresh)
  await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
  await f.client.publishArtifact(artifact, 'https://artifacts.test')
  respond!(Response.json({ publications: [] }))
  await refresh
  expect(f.client.snapshot().publications).toEqual([
    expect.objectContaining({ sourceId: artifact.id, revision: 2 }),
  ])
})
