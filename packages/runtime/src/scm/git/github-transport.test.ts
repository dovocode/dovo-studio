import { expect, it, vi } from 'vite-plus/test'
import type { GithubResponseInfo } from './github-rate-limit'
import { ProcessError } from '../../process'
import {
  GithubApiError,
  GithubCredentials,
  GithubTransport,
  githubApiUrl,
  parseGithubApiArgs,
} from './github-transport'

const reply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

it.each([
  ['NOT_FOUND', 404],
  ['FORBIDDEN', 403],
  ['UNAUTHORIZED', 401],
] as const)(
  'classifies HTTP 200 GraphQL %s errors without exposing their messages',
  async (type, status) => {
    const transport = new GithubTransport(
      async () =>
        new Response(
          JSON.stringify({
            data: { repository: null },
            errors: [{ type, message: 'upstream-secret' }],
          }),
          { status: 200 },
        ),
    )
    const unauthorized = vi.fn<() => void>()
    await expect(
      transport.send(parseGithubApiArgs(['api', 'graphql']), 'private-token', {
        onUnauthorized: unauthorized,
      }),
    ).rejects.toMatchObject({ status, message: expect.not.stringContaining('upstream-secret') })
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
  },
)

it('translates gh api arguments: query fields on GET, JSON fields on writes, GraphQL variables', () => {
  const list = parseGithubApiArgs([
    'api',
    '--hostname',
    'github.com',
    '--method',
    'GET',
    'user/repos',
    '-f',
    'sort=full_name',
    '-f',
    'per_page=100',
  ])
  expect(list).toMatchObject({
    host: 'github.com',
    method: 'GET',
    path: 'user/repos',
    query: [
      ['sort', 'full_name'],
      ['per_page', '100'],
    ],
    fields: {},
  })
  const create = parseGithubApiArgs([
    'api',
    '--hostname',
    'git.example.com',
    'repos/team/app/pulls',
    '--method',
    'POST',
    '-f',
    'title=Fix a=b',
    '-F',
    'draft=true',
    '-f',
    'reviewers[]=one',
    '-f',
    'reviewers[]=two',
  ])
  expect(create).toMatchObject({
    host: 'git.example.com',
    method: 'POST',
    fields: { title: 'Fix a=b', draft: true, reviewers: ['one', 'two'] },
  })
  const graphql = parseGithubApiArgs([
    'api',
    '--hostname',
    'github.com',
    'graphql',
    '-f',
    'query=query($n:Int!){viewer{login}}',
    '-F',
    'n=7',
  ])
  expect(graphql).toMatchObject({
    graphql: true,
    method: 'POST',
    fields: { query: 'query($n:Int!){viewer{login}}', n: 7 },
  })
  expect(parseGithubApiArgs(['api', 'repos/a/b', '--input', '-'], '{"x":1}')).toMatchObject({
    method: 'POST',
    body: '{"x":1}',
  })
  expect(() => parseGithubApiArgs(['api', 'user', '--jq', '.login'])).toThrow('Unsupported')
  expect(githubApiUrl('github.com', 'graphql').href).toBe('https://api.github.com/graphql')
  expect(githubApiUrl('git.example.com', 'graphql').href).toBe(
    'https://git.example.com/api/graphql',
  )
  expect(githubApiUrl('git.example.com', 'user').href).toBe('https://git.example.com/api/v3/user')
  expect(githubApiUrl('acme.ghe.com', 'user').href).toBe('https://api.acme.ghe.com/user')
})

it('sends bearer requests, follows pagination into a slurped array and revalidates with ETags', async () => {
  const fetcher = vi.fn<typeof fetch>()
  fetcher
    .mockResolvedValueOnce(
      reply([{ id: 1 }], {
        headers: { link: '<https://api.github.com/repos/a/b/pulls?page=2>; rel="next"' },
      }),
    )
    .mockResolvedValueOnce(reply([{ id: 2 }]))
    .mockResolvedValueOnce(reply({ login: 'me' }, { headers: { etag: '"v1"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  const transport = new GithubTransport(fetcher)
  const pages = await transport.send(
    parseGithubApiArgs([
      'api',
      '--hostname',
      'github.com',
      'repos/a/b/pulls',
      '--paginate',
      '--slurp',
    ]),
    'secret-token',
  )
  expect(JSON.parse(pages)).toEqual([[{ id: 1 }], [{ id: 2 }]])
  const first = fetcher.mock.calls[0]!
  expect(first[0]).toBeInstanceOf(URL)
  expect((first[0] as URL).href).toBe('https://api.github.com/repos/a/b/pulls')
  expect(new Headers(first[1]?.headers).get('authorization')).toBe('Bearer secret-token')
  const user = parseGithubApiArgs(['api', '--hostname', 'github.com', 'user'])
  expect(JSON.parse(await transport.send(user, 'secret-token'))).toEqual({ login: 'me' })
  expect(JSON.parse(await transport.send(user, 'secret-token'))).toEqual({ login: 'me' })
  expect(new Headers(fetcher.mock.calls[3]![1]?.headers).get('if-none-match')).toBe('"v1"')
})

it.each([
  'http://api.github.com/items?page=2',
  'https://api.github.com:444/items?page=2',
  'https://other.example/items?page=2',
  'https://user:password@api.github.com/items?page=2',
  'https://user@api.github.com/items?page=2',
])('rejects unsafe pagination before forwarding credentials: %s', async (next) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply([], { headers: { link: `<${next}>; rel="next"` } }))
    .mockResolvedValueOnce(reply([]))
  await expect(
    new GithubTransport(fetcher).send(
      parseGithubApiArgs(['api', 'items', '--paginate', '--slurp']),
      'private-token',
    ),
  ).rejects.toThrow('GitHub pagination')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps Enterprise pagination on its API origin', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply([{ id: 1 }], {
        headers: {
          link: '<https://git.example.com/api/v3/items?page=2>; rel="next"',
        },
      }),
    )
    .mockResolvedValueOnce(reply([{ id: 2 }]))
  const result = await new GithubTransport(fetcher).send(
    parseGithubApiArgs(['api', '--hostname', 'git.example.com', 'items', '--paginate', '--slurp']),
    'private-token',
  )
  expect(JSON.parse(result)).toEqual([[{ id: 1 }], [{ id: 2 }]])
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('revalidates later cached pages when a 304 omits pagination headers and rejects oversized bodies', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply([{ id: 1 }], {
        headers: { etag: '"one"', link: '<https://api.github.com/items?page=2>; rel="next"' },
      }),
    )
    .mockResolvedValueOnce(reply([{ id: 2 }], { headers: { etag: '"two"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  const transport = new GithubTransport(fetcher)
  const request = parseGithubApiArgs(['api', 'items', '--paginate', '--slurp'])
  expect(JSON.parse(await transport.send(request, 'token'))).toEqual([[{ id: 1 }], [{ id: 2 }]])
  expect(JSON.parse(await transport.send(request, 'token'))).toEqual([[{ id: 1 }], [{ id: 2 }]])
  fetcher.mockResolvedValueOnce(new Response('too much data'))
  await expect(
    transport.send(parseGithubApiArgs(['api', 'large']), 'token', { maxBytes: 2 }),
  ).rejects.toThrow('byte limit')
})

it('reports rate limits in the budget wording and drops a rejected token', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const transport = new GithubTransport(fetcher)
  fetcher.mockResolvedValueOnce(
    reply(
      { message: 'API rate limit exceeded' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '42' } },
    ),
  )
  await expect(transport.send(parseGithubApiArgs(['api', 'user']), 'token')).rejects.toMatchObject({
    status: 403,
    retryAfter: 42,
    message: expect.stringMatching(/rate limit.*retry-after: 42/),
  })
  fetcher.mockResolvedValueOnce(reply({ message: 'Bad credentials' }, { status: 401 }))
  const onUnauthorized = vi.fn<() => void>()
  await expect(
    transport.send(parseGithubApiArgs(['api', 'user']), 'token', { onUnauthorized }),
  ).rejects.toBeInstanceOf(GithubApiError)
  expect(onUnauthorized).toHaveBeenCalledOnce()
})

it('mints one token per host and checkout through gh, prefers environment tokens and forgets failures', async () => {
  const runner = vi.fn<ConstructorParameters<typeof GithubCredentials>[1] & object>(
    async (_command, args, options) => ({
      stdout: `token-for-${args[3]}-${options.cwd}\n`,
    }),
  )
  const credentials = new GithubCredentials(() => 'gh', runner)
  expect(await credentials.token('github.com', '/repo', {})).toBe('token-for-github.com-/repo')
  expect(await credentials.token('github.com', '/repo', {})).toBe('token-for-github.com-/repo')
  expect(await credentials.token('github.com', '/other', {})).toBe('token-for-github.com-/other')
  expect(runner).toHaveBeenCalledTimes(2)
  expect(runner.mock.calls[0]![2].env).toMatchObject({ GH_PROMPT_DISABLED: '1', GH_DEBUG: '' })
  expect(await credentials.token('github.com', '/repo', { GH_TOKEN: 'ambient' })).toBe('ambient')
  expect(await credentials.token('ghe.example', '/repo', { GH_TOKEN: 'ambient' })).toBe(
    'token-for-ghe.example-/repo',
  )
  expect(
    await credentials.token('ghe.example', '/repo', { GH_ENTERPRISE_TOKEN: 'enterprise' }),
  ).toBe('enterprise')
  credentials.invalidate('github.com', '/repo', {})
  await credentials.token('github.com', '/repo', {})
  expect(runner).toHaveBeenCalledTimes(4)
  runner.mockResolvedValueOnce({ stdout: '' })
  await expect(credentials.token('github.com', '/new', {})).rejects.toThrow('No GitHub login')
  runner.mockResolvedValueOnce({ stdout: 'fresh' })
  expect(await credentials.token('github.com', '/new', {})).toBe('fresh')
})
it('reports pagination exhaustion instead of returning the first hundred pages as complete', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    reply([], { headers: { link: '<https://api.github.com/items?page=next>; rel="next"' } }),
  )
  await expect(
    new GithubTransport(fetcher).send(
      parseGithubApiArgs(['api', 'items', '--paginate', '--slurp']),
      'token',
    ),
  ).rejects.toThrow('incomplete')
  expect(fetcher).toHaveBeenCalledTimes(100)
})
it('evicts large conditional bodies by total bytes and discards validators when a 200 omits ETag', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    reply('x'.repeat(12 * 1024 * 1024), { headers: { etag: '"body"' } }),
  )
  const transport = new GithubTransport(fetcher)
  for (const name of ['one', 'two', 'three'])
    await transport.send(parseGithubApiArgs(['api', name]), 'token')
  fetcher.mockResolvedValueOnce(reply('new body'))
  await transport.send(parseGithubApiArgs(['api', 'one']), 'token')
  expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).has('if-none-match')).toBe(false)
  fetcher.mockResolvedValueOnce(reply('no validator'))
  await transport.send(parseGithubApiArgs(['api', 'three']), 'token')
  fetcher.mockResolvedValueOnce(reply('another body'))
  await transport.send(parseGithubApiArgs(['api', 'three']), 'token')
  expect(new Headers(fetcher.mock.calls[5]?.[1]?.headers).has('if-none-match')).toBe(false)
})
it('invalidates credentials on 401 before reading an interrupted body and does not disclose private error payloads', async () => {
  const unauthorized = vi.fn<() => void>()
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private interrupted payload'))
          },
        }),
        { status: 401 },
      ),
  )
  const transport = new GithubTransport(fetcher)
  await expect(
    transport.send(parseGithubApiArgs(['api', 'user']), 'private-token', {
      onUnauthorized: unauthorized,
    }),
  ).rejects.toMatchObject({ status: 401, message: 'GitHub API HTTP 401' })
  expect(unauthorized).toHaveBeenCalledTimes(1)
  fetcher.mockResolvedValueOnce(reply({ message: 'private email token account' }, { status: 403 }))
  await expect(
    transport.send(parseGithubApiArgs(['api', 'private/repository']), 'private-token'),
  ).rejects.toThrow('GitHub API HTTP 403')
})

it('observes quota per page, conditional responses and GraphQL costs without exposing request secrets', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply(
        { ok: true },
        {
          headers: {
            etag: '"one"',
            'x-ratelimit-resource': 'core',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '2000000000',
            'x-ratelimit-used': '1',
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        status: 304,
        headers: {
          'x-ratelimit-resource': 'core',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '2000000000',
        },
      }),
    )
    .mockResolvedValueOnce(
      reply({
        data: {
          rateLimit: { limit: 5000, remaining: 4990, resetAt: '2033-05-18T03:33:20Z', cost: 10 },
        },
      }),
    )
  const transport = new GithubTransport(fetcher)
  const onResponse = vi.fn<(info: GithubResponseInfo) => void>()
  await transport.send(parseGithubApiArgs(['api', 'user']), 'secret-token', { onResponse })
  await transport.send(parseGithubApiArgs(['api', 'user']), 'secret-token', { onResponse })
  await transport.send(
    parseGithubApiArgs([
      'api',
      'graphql',
      '-f',
      'query=query{rateLimit{cost limit remaining resetAt}}',
    ]),
    'secret-token',
    { onResponse },
  )
  expect(onResponse.mock.calls.map(([info]) => info)).toEqual([
    {
      resource: 'core',
      status: 200,
      cached: false,
      used: 1,
      quota: { limit: 5000, remaining: 4999, resetAt: 2000000000000 },
    },
    {
      resource: 'core',
      status: 304,
      cached: true,
      used: undefined,
      quota: { limit: 5000, remaining: 4999, resetAt: 2000000000000 },
    },
    {
      resource: 'graphql',
      status: 200,
      cached: false,
      used: undefined,
      cost: 10,
      quota: { limit: 5000, remaining: 4990, resetAt: 2000000000000 },
    },
  ])
  expect(JSON.stringify(onResponse.mock.calls)).not.toContain('secret-token')
})
it('recognizes HTTP 200 GraphQL RATE_LIMIT errors with structured reset metadata', async () => {
  const onResponse = vi.fn<(info: GithubResponseInfo) => void>()
  const transport = new GithubTransport(
    vi.fn<typeof fetch>().mockResolvedValue(
      reply(
        { errors: [{ type: 'RATE_LIMIT', message: 'API rate limit exceeded' }] },
        {
          headers: {
            'x-ratelimit-resource': 'graphql',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '2000000000',
          },
        },
      ),
    ),
  )
  await expect(
    transport.send(parseGithubApiArgs(['api', 'graphql']), 'token', { onResponse }),
  ).rejects.toMatchObject({
    status: 429,
    rateLimit: { resource: 'graphql', secondary: false, resetAt: 2000000000000 },
  })
  expect(onResponse).toHaveBeenCalledOnce()
})
it('does not use the primary reset for a secondary limit', async () => {
  const transport = new GithubTransport(
    vi.fn<typeof fetch>().mockResolvedValue(
      reply(
        { message: 'secondary rate limit' },
        {
          status: 403,
          headers: {
            'x-ratelimit-resource': 'core',
            'x-ratelimit-remaining': '4000',
            'x-ratelimit-reset': '2000000000',
            'retry-after': '2',
          },
        },
      ),
    ),
  )
  await expect(transport.send(parseGithubApiArgs(['api', 'user']), 'token')).rejects.toMatchObject({
    retryAfter: 2,
    rateLimit: { secondary: true, retryAfter: 2, resetAt: undefined },
  })
})

it('separates cached CLI credentials by executable and effective account environment', async () => {
  let executable = 'gh'
  const runner = vi.fn<ConstructorParameters<typeof GithubCredentials>[1] & object>(
    async (command, _args, options) => ({
      stdout: `token-${command}-${options.env.CUSTOM_ACCOUNT ?? 'default'}`,
    }),
  )
  const credentials = new GithubCredentials(() => executable, runner)
  expect(await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: 'first' })).toBe(
    'token-gh-first',
  )
  expect(await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: 'first' })).toBe(
    'token-gh-first',
  )
  expect(await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: 'second' })).toBe(
    'token-gh-second',
  )
  executable = '/custom/gh'
  expect(await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: 'second' })).toBe(
    'token-/custom/gh-second',
  )
  expect(runner).toHaveBeenCalledTimes(3)
})

it('redacts failed credential lookups for every coalesced caller', async () => {
  let reject: (error: unknown) => void = () => {}
  const runner = vi.fn<ConstructorParameters<typeof GithubCredentials>[1] & object>(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const credentials = new GithubCredentials(() => 'gh', runner)
  const first = credentials.token('github.com', '/repo', {})
  const second = credentials.token('github.com', '/repo', {})
  const results = Promise.allSettled([first, second])
  reject(
    new ProcessError({
      message: 'private-token in command output',
      cause: new Error('private-token'),
      stdout: 'private-token',
      stderr: 'private-secret',
    }),
  )
  for (const result of await results) {
    if (result.status !== 'rejected')
      throw new Error('The credential lookup unexpectedly succeeded')
    expect(result.reason).toBeInstanceOf(GithubApiError)
    expect(String(result.reason)).toContain('gh auth login')
    expect(JSON.stringify(result.reason)).not.toContain('private-')
  }
  expect(runner).toHaveBeenCalledOnce()
})

it('invalidates the captured credential source when the configured executable changes in flight', async () => {
  let executable = 'old-gh'
  const runner = vi.fn<ConstructorParameters<typeof GithubCredentials>[1] & object>(
    async (command) => ({ stdout: `${command}-token` }),
  )
  const credentials = new GithubCredentials(() => executable, runner)
  const old = await credentials.capture('github.com', '/repo', {})
  executable = 'new-gh'
  const current = await credentials.capture('github.com', '/repo', {})
  old.onUnauthorized()
  expect(await credentials.token('github.com', '/repo', {})).toBe(current.token)
  expect(runner).toHaveBeenCalledTimes(2)
  executable = 'old-gh'
  await credentials.token('github.com', '/repo', {})
  expect(runner).toHaveBeenCalledTimes(3)
})

it('does not let a delayed rejection invalidate a refreshed credential from the same source', async () => {
  const runner = vi
    .fn<ConstructorParameters<typeof GithubCredentials>[1] & object>()
    .mockResolvedValueOnce({ stdout: 'old-token' })
    .mockResolvedValueOnce({ stdout: 'new-token' })
  const credentials = new GithubCredentials(() => 'gh', runner)
  const old = await credentials.capture('github.com', '/repo', {})
  credentials.invalidate('github.com', '/repo', {})
  const fresh = await credentials.capture('github.com', '/repo', {})
  old.onUnauthorized()
  expect(await credentials.token('github.com', '/repo', {})).toBe(fresh.token)
  expect(runner).toHaveBeenCalledTimes(2)
  fresh.onUnauthorized()
  runner.mockResolvedValueOnce({ stdout: 'another-token' })
  expect(await credentials.token('github.com', '/repo', {})).toBe('another-token')
})

it('bounds live credential sources and retains recently used sources', async () => {
  const runner = vi.fn<ConstructorParameters<typeof GithubCredentials>[1] & object>(
    async (_command, _args, options) => ({ stdout: `token-${options.env.CUSTOM_ACCOUNT}` }),
  )
  const credentials = new GithubCredentials(() => 'gh', runner)
  for (let index = 0; index < 200; index++)
    await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: String(index) })
  await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: '0' })
  await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: '200' })
  await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: '0' })
  expect(runner).toHaveBeenCalledTimes(201)
  await credentials.token('github.com', '/repo', { CUSTOM_ACCOUNT: '1' })
  expect(runner).toHaveBeenCalledTimes(202)
})
