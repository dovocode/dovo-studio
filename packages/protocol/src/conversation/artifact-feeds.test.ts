import { afterEach, expect, it, vi } from 'vite-plus/test'
import { AccountClient } from '../auth/account-client.js'
import { artifactFeedSelect } from './artifact-feeds.js'

const publicationId = '68d64fa8-46d3-4e85-bcc6-fd758aeebac9'
const generation = '68d64fa8-46d3-4e85-bcc6-fd758aeebaca'
const account = 'a'.repeat(43),
  writer = 'w'.repeat(43),
  sharing = 's'.repeat(43)
afterEach(() => vi.unstubAllGlobals())

it('selects only own JSON fields with RFC 6901 escaping, including arrays and empty keys', () => {
  const data = { 'a/b': { '~x': [4, { '': false }] } }
  expect(artifactFeedSelect(data, '/a~1b/~0x/1/')).toBe(false)
  expect(artifactFeedSelect(data, '')).toBe(data)
  for (const pointer of ['/toString', '/__proto__', '/missing', '/a~2b', 'a/b'])
    expect(() => artifactFeedSelect(data, pointer)).toThrow(
      /Invalid JSON pointer|Selected JSON field is unavailable/,
    )
  const getter = vi.fn<() => string>(() => 'secret')
  expect(
    artifactFeedSelect(Object.defineProperty({}, 'value', { get: getter }), '/value'),
  ).toBeUndefined()
  expect(getter).not.toHaveBeenCalled()
})

async function fixture(
  options: {
    changed?: boolean
    cleanupFails?: boolean
    malformed?: boolean
    accountChanges?: boolean
  } = {},
) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = new AccountClient(
    { read: async () => account, write: async () => {} },
    async () => {},
    'https://connect.test',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push({ url, init })
      if (url.endsWith('/v1/servers'))
        return Response.json({ user: { id: 'owner', name: 'Owner' }, servers: [] })
      if (url.endsWith('/v1/artifacts/feed-session'))
        return Response.json({
          origin: options.changed ? 'https://changed.test' : 'https://artifacts.test',
          token: writer,
          publicationId,
          expiresAt: Date.now() + 600_000,
        })
      if (url.endsWith('/v1/artifacts/session')) {
        if (options.accountChanges) await client.signOut()
        return Response.json({
          origin: 'https://artifacts.test',
          token: sharing,
          expiresAt: Date.now() + 600_000,
        })
      }
      if (init?.method === 'DELETE' && options.cleanupFails) throw new Error('Offline')
      return Response.json(options.malformed ? {} : { generation })
    }),
  )
  await client.load()
  return { client, calls }
}
it('registers the selected preview with a sharing scope and passes only a publication-bound writer to the runtime', async () => {
  const f = await fixture(),
    enable = vi.fn<() => Promise<void>>(async () => {})
  await f.client.enableArtifactFeed(
    publicationId,
    'https://artifacts.test',
    60,
    { count: 3 },
    enable,
  )
  expect(enable).toHaveBeenCalledWith(
    expect.objectContaining({ token: writer, publicationId, generation }),
  )
  const hosted = f.calls.filter((call) => call.url.startsWith('https://artifacts.test'))
  expect(hosted).toHaveLength(1)
  expect(new Headers(hosted[0]?.init?.headers).get('Authorization')).toBe('Bearer ' + sharing)
  expect(hosted[0]?.init?.body).toBe(JSON.stringify({ writer, seconds: 60, data: { count: 3 } }))
  expect(JSON.stringify(hosted)).not.toContain(account)
})
it.each([{ changed: true }, { accountChanges: true }])(
  'cancels before upload when account or destination changes: %j',
  async (options) => {
    const f = await fixture(options),
      enable = vi.fn<() => Promise<void>>(async () => {})
    await expect(
      f.client.enableArtifactFeed(publicationId, 'https://artifacts.test', 60, {}, enable),
    ).rejects.toThrow(/changed/)
    expect(enable).not.toHaveBeenCalled()
    expect(f.calls.some((call) => call.url.startsWith('https://artifacts.test'))).toBe(false)
  },
)
it.each([false, true])(
  'clears hosted preview after runtime rejection and reports uncertain cleanup: %s',
  async (cleanupFails) => {
    const f = await fixture({ cleanupFails })
    await expect(
      f.client.enableArtifactFeed(publicationId, 'https://artifacts.test', 60, {}, async () => {
        throw new Error('Runtime rejected')
      }),
    ).rejects.toThrow(cleanupFails ? 'could not be cleared' : 'Runtime rejected')
    expect(f.calls.at(-1)?.init?.method).toBe('DELETE')
    expect(f.calls.at(-1)?.init?.body).toBe(JSON.stringify({ generation }))
  },
)
it('reports an invalid registration response without enabling the runtime', async () => {
  const f = await fixture({ malformed: true }),
    enable = vi.fn<() => Promise<void>>(async () => {})
  await expect(
    f.client.enableArtifactFeed(publicationId, 'https://artifacts.test', 60, {}, enable),
  ).rejects.toThrow('clear the feed')
  expect(enable).not.toHaveBeenCalled()
})
