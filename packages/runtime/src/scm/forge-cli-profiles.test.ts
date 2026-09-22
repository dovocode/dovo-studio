import { afterEach, expect, it, vi } from 'vitest'
import { commandsSchema } from '@dovo/protocol'
import { readForgeCliProfiles } from './forge-cli-profiles'
import { runForgeCli } from './forge-cli'
vi.mock('./forge-cli', () => ({ runForgeCli: vi.fn<typeof runForgeCli>() }))
afterEach(() => vi.resetAllMocks())
const settings = commandsSchema.parse({})
const cwd = '/fixture/cloned/project'

it('lists matching bb profiles from the checkout without returning private fields', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify([
      {
        name: 'work',
        user: 'me@example.com',
        default: true,
        password: 'private-password',
        accessToken: 'private-token',
        clientSecret: 'private-client',
      },
      { name: 'server', apiRoot: 'https://other.example', password: 'other-private' },
    ]),
  )
  const result = await readForgeCliProfiles(
    settings,
    { provider: 'bitbucket', baseUrl: 'https://api.bitbucket.org/2.0' },
    cwd,
  )
  expect(result.profiles).toEqual([
    {
      id: 'work',
      name: 'work',
      baseUrl: 'https://api.bitbucket.org/2.0',
      username: 'me@example.com',
      active: true,
    },
  ])
  expect(runForgeCli).toHaveBeenCalledExactlyOnceWith(
    'bb',
    ['profile', 'list', '--output', 'json'],
    undefined,
    cwd,
  )
  expect(JSON.stringify(result)).not.toContain('private')
})

it('keeps tea account discovery scoped to the complete server URL', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify([
      {
        name: 'work',
        url: 'https://forge.example/git/',
        user: 'me',
        default: 'true',
        token: 'private-token',
      },
      { name: 'other-path', url: 'https://forge.example/other', user: 'other' },
      { name: 'other-scheme', url: 'http://forge.example/git', user: 'other' },
    ]),
  )
  const result = await readForgeCliProfiles(
    settings,
    { provider: 'gitea', baseUrl: 'https://forge.example/git', cliTool: 'tea' },
    cwd,
  )
  expect(result.profiles).toEqual([
    {
      id: 'work',
      name: 'work',
      baseUrl: 'https://forge.example/git',
      username: 'me',
      active: true,
    },
  ])
  expect(runForgeCli).toHaveBeenCalledExactlyOnceWith(
    'tea',
    ['logins', 'list', '--output', 'json'],
    undefined,
    cwd,
  )
})

it('lists stored GitHub accounts for the chosen host without exposing tokens or selecting environment-only accounts', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify({
      hosts: {
        'github.example': [
          { login: 'work', active: false, tokenSource: 'keyring', token: 'private-token' },
          {
            login: 'environment-user',
            active: true,
            tokenSource: 'GH_ENTERPRISE_TOKEN',
            token: 'private-env',
          },
        ],
        'github.com': [{ login: 'personal', active: true, tokenSource: 'keyring' }],
      },
    }),
  )
  const result = await readForgeCliProfiles(
    settings,
    { provider: 'github', baseUrl: 'https://github.example' },
    cwd,
  )
  expect(result.profiles).toEqual([
    {
      id: 'work',
      name: 'work',
      baseUrl: 'https://github.example',
      username: 'work',
      active: false,
    },
  ])
  expect(JSON.stringify(result)).not.toContain('private')
  expect(runForgeCli).toHaveBeenCalledExactlyOnceWith(
    'gh',
    ['auth', 'status', '--hostname', 'github.example', '--json', 'hosts'],
    undefined,
    cwd,
  )
})

it('lists unique Azure tenants and limits fj accounts to the configured host', async () => {
  vi.mocked(runForgeCli).mockResolvedValue(
    JSON.stringify([
      { tenantId: 'tenant-1', tenantDisplayName: 'Work', user: { name: 'me@example.com' } },
      {
        tenantId: 'tenant-1',
        tenantDisplayName: 'Work',
        user: { name: 'me@example.com' },
        isDefault: true,
        token: 'private-token',
      },
      { tenantId: 'tenant-2', tenantDisplayName: 'Other', user: { name: 'other@example.com' } },
    ]),
  )
  const azure = await readForgeCliProfiles(
    settings,
    { provider: 'azure-devops', baseUrl: 'https://dev.azure.com/work' },
    cwd,
  )
  expect(azure.profiles).toHaveLength(2)
  expect(azure.profiles[0]).toMatchObject({ id: 'tenant-1', active: true })
  expect(JSON.stringify(azure)).not.toContain('private')
  expect(runForgeCli).toHaveBeenCalledExactlyOnceWith(
    'az',
    ['account', 'list', '--all', '--output', 'json'],
    undefined,
    cwd,
  )
  vi.mocked(runForgeCli).mockResolvedValue('other.example\nforge.example\nforge.example/subpath\n')
  const fj = await readForgeCliProfiles(
    settings,
    { provider: 'forgejo', baseUrl: 'https://forge.example', cliTool: 'fj' },
    cwd,
  )
  expect(fj.profiles).toEqual([
    { id: 'forge.example', name: 'forge.example', baseUrl: 'https://forge.example' },
  ])
  expect(runForgeCli).toHaveBeenLastCalledWith('fj', ['auth', 'list'], undefined, cwd)
})

it('does not expose malformed profile output', async () => {
  vi.mocked(runForgeCli).mockResolvedValue('private-token malformed')
  await expect(
    readForgeCliProfiles(
      settings,
      { provider: 'bitbucket', baseUrl: 'https://api.bitbucket.org/2.0' },
      cwd,
    ),
  ).rejects.toThrow('The CLI returned invalid profile data')
})
