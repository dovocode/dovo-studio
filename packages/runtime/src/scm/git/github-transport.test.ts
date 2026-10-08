import { expect, it, vi } from 'vite-plus/test'
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
