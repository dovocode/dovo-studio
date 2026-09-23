import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { commandsSchema, forgeConnectionSchema } from '@dovo/protocol'
import { ForgeCliAccounts } from './forge-cli-accounts'
import { runForgeCli, runForgeCliText } from './forge-cli'
import { ForgeConnections, connectionHttp } from './forge-connections'
import { openDatabase } from '../storage/database'
vi.mock('./forge-cli', () => ({
  runForgeCli: vi.fn<typeof runForgeCli>(),
  runForgeCliText: vi.fn<typeof runForgeCliText>(),
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const cli = new ForgeCliAccounts(() => decode(commandsSchema, {}))
const connection = decode(forgeConnectionSchema, {
  id: 'bb',
  name: 'Work',
  provider: 'bitbucket',
  baseUrl: 'https://api.bitbucket.org/2.0',
  credential: 'cli',
  cliProfile: 'work',
  revision: '1',
})
it('uses the explicitly named bb profile and keeps credentials out of metadata', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify({
      name: 'work',
      apiRoot: 'https://api.bitbucket.org/2.0/',
      user: 'me@example.com',
      password: 'secret',
    }),
  )
  expect(await cli.authorization(connection)).toBe(
    `Basic ${Buffer.from('me@example.com:secret').toString('base64')}`,
  )
  expect(runForgeCli).toHaveBeenCalledWith(
    'bb',
    ['profile', 'get', '--show-secrets', '--output', 'json', '--', 'work'],
    undefined,
    undefined,
  )
  expect(JSON.stringify(connection)).not.toContain('secret')
  expect(await cli.authorization(connection, true)).toBe(
    `Basic ${Buffer.from('x-bitbucket-api-token-auth:secret').toString('base64')}`,
  )
})
it('never uses a differently named profile or a non-Cloud endpoint', async () => {
  for (const profile of [
    {
      name: 'personal',
      accessToken: 'secret',
    },
    {
      name: 'work',
      apiRoot: 'https://other.example',
      accessToken: 'secret',
    },
  ]) {
    vi.mocked(runForgeCli).mockResolvedValue(JSON.stringify(profile))
    await expect(cli.authorization(connection)).rejects.toThrow('selected Bitbucket CLI profile')
  }
})
it('uses bearer tokens for the Bitbucket API and Git-compatible authentication for HTTPS clones', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify({
      name: 'work',
      accessToken: 'secret',
    }),
  )
  expect(await cli.authorization(connection)).toBe('Bearer secret')
  expect(await cli.authorization(connection, true)).toBe(
    `Basic ${Buffer.from('x-token-auth:secret').toString('base64')}`,
  )
})
it('requires credentials rather than falling back to another bb login', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify({
      name: 'work',
    }),
  )
  await expect(cli.authorization(connection)).rejects.toThrow(
    'Authenticate the selected bb profile',
  )
  expect(runForgeCli).toHaveBeenCalledTimes(1)
})
const tea = {
  ...connection,
  provider: 'gitea' as const,
  baseUrl: 'https://git.example/forge',
  cliTool: 'tea' as const,
  cliProfile: 'Work',
}
function teaAccount() {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify([
      {
        name: 'work',
        url: tea.baseUrl,
      },
    ]),
  )
  vi.mocked(runForgeCliText).mockResolvedValue(
    'protocol=https\nhost=git.example\nusername=me\npassword=private=token\n',
  )
}
it('reads the explicitly selected tea login through its refreshed credential helper', async () => {
  teaAccount()
  expect(await cli.authorization(tea)).toBe('token private=token')
  expect(runForgeCliText).toHaveBeenCalledExactlyOnceWith(
    'tea',
    ['login', 'helper', 'get', '--login', 'Work'],
    'protocol=https\nhost=git.example\npath=forge\n\n',
    undefined,
  )
})
it('does not read tea credentials for a differently configured server or profile', async () => {
  for (const login of [
    {
      name: 'other',
      url: tea.baseUrl,
    },
    {
      name: 'work',
      url: 'https://git.example/elsewhere',
    },
    {
      name: 'work',
      url: 'http://git.example/forge',
    },
  ]) {
    vi.mocked(runForgeCli).mockResolvedValue(JSON.stringify([login]))
    await expect(cli.authorization(tea)).rejects.toThrow('does not match this server URL')
  }
  expect(runForgeCliText).not.toHaveBeenCalled()
})
it('rejects a switched tea host or protocol without disclosing credentials', async () => {
  teaAccount()
  for (const account of [
    'protocol=https\nhost=other.example\npassword=private-token\n',
    'protocol=http\nhost=git.example\npassword=private-token\n',
  ]) {
    vi.mocked(runForgeCliText).mockResolvedValue(account)
    await expect(cli.authorization(tea)).rejects.toThrow('does not match this server URL')
  }
  vi.mocked(runForgeCliText).mockResolvedValue('private-token malformed')
  await expect(cli.authorization(tea)).rejects.toThrow('invalid account data')
  vi.mocked(runForgeCliText).mockResolvedValue('protocol=https\nhost=git.example\n')
  await expect(cli.authorization(tea)).rejects.toThrow('Authenticate the selected tea login')
})
it('enforces HTTP origin, redirect and response handling for tea accounts', async () => {
  teaAccount()
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const db = openDatabase(':memory:')
  try {
    const connections = new ForgeConnections(db, undefined, cli)
    const saved = connections.save({
      ...tea,
      id: undefined,
    })
    const http = connectionHttp(connections, saved)
    fetcher.mockResolvedValueOnce(
      Response.json(
        {
          accepted: true,
        },
        {
          status: 202,
          headers: {
            'x-total-count': '5',
          },
        },
      ),
    )
    const response = await http.jsonResponse('api/v1/repos/me/app/issues', {
      method: 'POST',
      body: {
        title: 'hello',
      },
    })
    expect(response.status).toBe(202)
    expect(response.headers.get('x-total-count')).toBe('5')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: 'token private=token',
      },
      body: '{"title":"hello"}',
    })
    fetcher.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://outside.example/file',
        },
      }),
    )
    await expect(http.json('api/v1/user')).rejects.toThrow('unsafe API URL')
    fetcher.mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: {
          location: '/forge/elsewhere',
        },
      }),
    )
    await expect(
      http.json('api/v1/issues', {
        method: 'POST',
        body: {},
      }),
    ).rejects.toThrow('redirected a write')
    fetcher.mockResolvedValueOnce(
      new Response('private-token server error', {
        status: 403,
      }),
    )
    await expect(http.json('api/v1/issues')).rejects.toThrow('permission')
    expect(fetcher).toHaveBeenCalledTimes(4)
  } finally {
    db.close()
  }
})
it('does not expose malformed private account output in errors', async () => {
  vi.mocked(runForgeCli).mockResolvedValue('private-token malformed')
  await expect(cli.authorization(connection)).rejects.toThrow('invalid account data')
})
it('uses the project checkout for selected account credentials without switching global logins', async () => {
  const cwd = '/fixture/project'
  vi.mocked(runForgeCli).mockResolvedValue('github-private-token\n')
  const github = {
    ...connection,
    provider: 'github' as const,
    baseUrl: 'https://github.example',
    credential: 'gh' as const,
    cliProfile: 'work-user',
  }
  const db = openDatabase(':memory:')
  try {
    const connections = new ForgeConnections(db, undefined, cli)
    const selected = connections.save({
      ...github,
      id: undefined,
    })
    expect(await connections.githubToken(selected.id, cwd)).toBe('github-private-token')
    expect(runForgeCli).toHaveBeenCalledExactlyOnceWith(
      'gh',
      ['auth', 'token', '--hostname', 'github.example', '--user', 'work-user'],
      undefined,
      cwd,
    )
    expect(
      await connections.gitAuthorization(selected.id, 'https://github.example/work/app.git', cwd),
    ).toBe(`Basic ${Buffer.from('x-access-token:github-private-token').toString('base64')}`)
    expect(() =>
      connections.gitAuthorization(selected.id, 'https://other.example/work/app.git', cwd),
    ).toThrow('outside this source control connection')
    const current = connections.save({
      ...selected,
      cliProfile: undefined,
    })
    expect(await connections.githubToken(current.id, cwd)).toBeUndefined()
    expect(
      await connections.gitAuthorization(current.id, 'https://github.example/work/app.git', cwd),
    ).toBe('')
    expect(runForgeCli).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(connections.list())).not.toContain('github-private-token')
  } finally {
    db.close()
  }
  teaAccount()
  expect(await cli.authorization(tea, false, cwd)).toBe('token private=token')
  expect(vi.mocked(runForgeCli).mock.lastCall?.[3]).toBe(cwd)
  expect(vi.mocked(runForgeCliText).mock.lastCall?.[3]).toBe(cwd)
})
