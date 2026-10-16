import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GitService } from './git'
import { GithubTransport, GithubApiError } from './github-transport'
import { exec } from '../../process'

vi.mock('../../process', async (original) => ({
  ...(await original<typeof import('../../process')>()),
  exec: vi.fn<typeof exec>(),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const discovery = ['repo', 'view', '--json', 'nameWithOwner,url']
function setup() {
  vi.stubEnv('GH_TOKEN', 'fixture-secret')
  vi.stubEnv('GH_HOST', 'github.com')
  const audit = vi.fn<NonNullable<ConstructorParameters<typeof GitService>[1]>>()
  const git = new GitService(undefined, audit)
  vi.spyOn(git, 'inspect').mockImplementation(async (path) => ({ path, branch: 'main' }))
  const config = vi
    .spyOn(git, 'command')
    .mockResolvedValue('remote.origin.url\ngit@github.com:team/app.git\0')
  const cli = vi
    .mocked(exec)
    .mockReset()
    .mockResolvedValue({
      stdout: JSON.stringify({ nameWithOwner: 'team/app', url: 'https://github.com/team/app' }),
      stderr: '',
    })
  return { git, config, cli, audit }
}
it('shares repository discovery, invalidates on config/account changes and expiry, and never caches failures', async () => {
  const { git, config, cli } = setup()
  await Promise.all([git.github('/repo', discovery), git.github('/repo', discovery)])
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledTimes(1)
  config.mockResolvedValue('remote.origin.url\ngit@github.com:team/other.git\0')
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledTimes(2)
  vi.stubEnv('GH_TOKEN', 'different-credential')
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledTimes(3)
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 600_001)
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledTimes(4)
  config.mockResolvedValue('remote.origin.url\ngit@github.com:team/new.git\0')
  cli.mockRejectedValueOnce(new Error('Temporary discovery failure'))
  await expect(git.github('/repo', discovery)).rejects.toThrow('Temporary discovery failure')
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledTimes(6)
})
it('keeps cached discovery and REST pipelines working when the same credential exhausts GraphQL', async () => {
  const { git, cli, audit } = setup()
  await git.github('/repo', discovery)
  const transport = vi
    .spyOn(GithubTransport.prototype, 'send')
    .mockImplementation(async (request, _token, options) => {
      if (request.graphql)
        throw new GithubApiError(429, 'GitHub GraphQL rate limit reached', undefined, {
          resource: 'graphql',
          secondary: false,
          resetAt: Date.now() + 300_000,
        })
      options?.onResponse?.({
        resource: 'core',
        status: 200,
        cached: false,
        quota: { limit: 5000, remaining: 4900, resetAt: 2000000000000 },
      })
      return '{"workflow_runs":[]}'
    })
  await expect(git.github('/repo', ['api', 'graphql'])).rejects.toMatchObject({ status: 429 })
  await expect(git.github('/repo', discovery)).resolves.toContain('team/app')
  await expect(git.github('/repo', ['api', 'repos/team/app/actions/runs'])).resolves.toContain(
    'workflow_runs',
  )
  // A fresh CLI GraphQL command shares the API credential's cooldown.
  await expect(git.github('/repo', ['pr', 'view', '1', '--json', 'title'])).rejects.toMatchObject({
    status: 429,
  })
  expect(cli).toHaveBeenCalledTimes(1)
  expect(transport).toHaveBeenCalledTimes(2)
  expect(audit).toHaveBeenCalledWith('/repo', expect.any(Array), {
    github: {
      host: 'github.com',
      method: 'GET',
      endpoint: 'repos/team/app/actions/runs',
      background: false,
      responses: [
        {
          resource: 'core',
          status: 200,
          cached: false,
          quota: { limit: 5000, remaining: 4900, resetAt: 2000000000000 },
        },
      ],
    },
  })
  expect(JSON.stringify(audit.mock.calls)).not.toContain('fixture-secret')
})
it('does not cache malformed discovery responses', async () => {
  const { git, cli } = setup()
  cli.mockResolvedValueOnce({ stdout: '{}', stderr: '' })
  await expect(git.github('/repo', discovery)).rejects.toThrow(/nameWithOwner/)
  await expect(git.github('/repo', discovery)).resolves.toContain('team/app')
  expect(cli).toHaveBeenCalledTimes(2)
})
it('leaves authentication commands available during a shared secondary cooldown', async () => {
  const { git, cli } = setup()
  vi.spyOn(GithubTransport.prototype, 'send').mockRejectedValue(
    new GithubApiError(429, 'GitHub secondary rate limit', 60, { secondary: true, retryAfter: 60 }),
  )
  await expect(git.github('/repo', ['api', 'user'])).rejects.toMatchObject({ status: 429 })
  await git.github('/repo', ['auth', 'status'])
  expect(cli).toHaveBeenCalledTimes(1)
})

it('selects the enterprise credential for a non-origin remote', async () => {
  const { git, config, cli } = setup()
  vi.stubEnv('GH_HOST', undefined)
  vi.stubEnv('GH_ENTERPRISE_TOKEN', 'enterprise-secret')
  config.mockResolvedValue('remote.upstream.url\ngit@git.example.com:team/app.git\0')
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledWith(
    expect.any(String),
    discovery,
    expect.objectContaining({
      env: expect.objectContaining({
        GH_TOKEN: 'enterprise-secret',
        GH_ENTERPRISE_TOKEN: 'enterprise-secret',
      }),
    }),
  )
})
it('retains unchanged repository metadata when it expires during a GraphQL cooldown', async () => {
  const { git, cli } = setup()
  await git.github('/repo', discovery)
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 600_001)
  vi.spyOn(GithubTransport.prototype, 'send').mockRejectedValue(
    new GithubApiError(429, 'GitHub GraphQL rate limit reached', undefined, {
      resource: 'graphql',
      secondary: false,
      resetAt: Date.now() + 300_000,
    }),
  )
  await expect(git.github('/repo', ['api', 'graphql'])).rejects.toMatchObject({ status: 429 })
  await expect(git.github('/repo', discovery)).resolves.toContain('team/app')
  expect(cli).toHaveBeenCalledTimes(1)
})

it('uses Git URL rewrites when choosing the CLI credential host', async () => {
  const { git, config, cli } = setup()
  vi.stubEnv('GH_HOST', undefined)
  vi.stubEnv('GH_ENTERPRISE_TOKEN', 'enterprise-secret')
  config.mockImplementation(async (_cwd, args) =>
    args[0] === 'config'
      ? 'remote.origin.url\nhttps://git-alias/team/app\0url.https://git.example.com/.insteadof\nhttps://git-alias/\0'
      : 'https://git.example.com/team/app',
  )
  await git.github('/repo', discovery)
  expect(cli).toHaveBeenCalledWith(
    expect.any(String),
    discovery,
    expect.objectContaining({
      env: expect.objectContaining({ GH_TOKEN: 'enterprise-secret' }),
    }),
  )
})
