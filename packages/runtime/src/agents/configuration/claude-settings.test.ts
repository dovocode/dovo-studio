import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { claudeEffectiveEnvironment, claudeSubscriptionEnvironment } from './claude-settings.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'claude-settings-'))
  roots.push(home)
  const config = join(home, 'custom'),
    cwd = join(home, 'project')
  mkdirSync(config)
  mkdirSync(join(cwd, '.claude'), { recursive: true })
  return { home, config, cwd }
}
it('applies user, project and local connection env over launch env without copying unrelated settings', () => {
  const { home, config, cwd } = fixture()
  writeFileSync(
    join(config, 'settings.json'),
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'http://gateway:8080',
        ANTHROPIC_AUTH_TOKEN: 'fixture-token',
        UNRELATED_SECRET: 'private',
      },
      hooks: { dangerous: true },
    }),
  )
  writeFileSync(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://project' } }),
  )
  writeFileSync(
    join(cwd, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://local' } }),
  )
  const env = claudeEffectiveEnvironment(
    { HOME: home, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: 'http://launch' },
    cwd,
  )
  expect(env.ANTHROPIC_BASE_URL).toBe('http://local')
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('fixture-token')
  expect(env.UNRELATED_SECRET).toBeUndefined()
  expect(claudeSubscriptionEnvironment(env)).toBe(false)
})
it('uses HOME for default user settings and tolerates absent settings', () => {
  const { home } = fixture()
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') }
  expect(claudeEffectiveEnvironment(env).HOME).toBe(home)
  mkdirSync(env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(env.CLAUDE_CONFIG_DIR, 'settings.json'),
    '{"env":{"ANTHROPIC_BASE_URL":"http://vpn"}}',
  )
  expect(claudeEffectiveEnvironment(env).ANTHROPIC_BASE_URL).toBe('http://vpn')
})
it('fails closed for malformed or oversized settings without exposing credentials', () => {
  const { home, config } = fixture()
  const path = join(config, 'settings.json')
  for (const content of ['{"secret":"fixture-secret",', ' '.repeat(1024 * 1024 + 1)]) {
    writeFileSync(path, content)
    expect(() => claudeEffectiveEnvironment({ HOME: home, CLAUDE_CONFIG_DIR: config })).toThrow(
      `Could not read Claude connection settings: ${path}`,
    )
  }
})
it('suppresses subscription metadata for endpoint-only gateways, tokens and backend flags', () => {
  expect(claudeSubscriptionEnvironment({})).toBe(true)
  expect(claudeSubscriptionEnvironment({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com/' })).toBe(
    true,
  )
  for (const env of [
    { ANTHROPIC_BASE_URL: 'http://tailscale:8080' },
    { ANTHROPIC_BASE_URL: 'https://api.anthropic.com.evil' },
    { ANTHROPIC_BASE_URL: 'invalid' },
    { ANTHROPIC_API_KEY: 'fixture' },
    { CLAUDE_CODE_USE_BEDROCK: '1' },
  ])
    expect(claudeSubscriptionEnvironment(env)).toBe(false)
})

it('honors inline settings connection precedence without forwarding unrelated values', () => {
  const { home, config } = fixture()
  const env = claudeEffectiveEnvironment({ HOME: home, CLAUDE_CONFIG_DIR: config }, home, [
    '--settings={"env":{"ANTHROPIC_BASE_URL":"http://inline","UNRELATED_SECRET":"private"},"hooks":{}}',
  ])
  expect(env.ANTHROPIC_BASE_URL).toBe('http://inline')
  expect(env.UNRELATED_SECRET).toBeUndefined()
})

it.each([
  { selection: '', endpoint: 'http://launch' },
  { selection: 'user', endpoint: 'http://user' },
  { selection: 'project', endpoint: 'http://project' },
  { selection: 'local', endpoint: 'http://local' },
  { selection: 'local,user,project', endpoint: 'http://local' },
  { selection: ' user , project , user ', endpoint: 'http://project' },
])(
  'honors source selection $selection while retaining fixed tier precedence',
  ({ selection, endpoint }) => {
    const { home, config, cwd } = fixture()
    for (const [path, source] of [
      [join(config, 'settings.json'), 'user'],
      [join(cwd, '.claude', 'settings.json'), 'project'],
      [join(cwd, '.claude', 'settings.local.json'), 'local'],
    ])
      writeFileSync(path, JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://${source}` } }))
    const env = claudeEffectiveEnvironment(
      { HOME: home, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: 'http://launch' },
      cwd,
      [`--setting-sources=${selection}`],
    )
    expect(env.ANTHROPIC_BASE_URL).toBe(endpoint)
  },
)

it('uses the last source flag, including an explicit empty selection, without reading excluded malformed files', () => {
  const { home, config, cwd } = fixture()
  writeFileSync(join(config, 'settings.json'), '{broken-user-settings')
  writeFileSync(join(cwd, '.claude', 'settings.json'), '{broken-project-settings')
  const env = claudeEffectiveEnvironment({ HOME: home, CLAUDE_CONFIG_DIR: config }, cwd, [
    '--setting-sources=user,project,local',
    '--setting-sources=',
    '--settings={"env":{"ANTHROPIC_BASE_URL":"http://explicit"}}',
  ])
  expect(env.ANTHROPIC_BASE_URL).toBe('http://explicit')
})

it.each([
  '--setting-sources',
  '--setting-sources=unknown',
  '--setting-sources=user,',
  '--settings',
  '--managed-settings',
])('rejects invalid settings flags %s', (flag) => {
  const { home, config } = fixture()
  expect(() =>
    claudeEffectiveEnvironment({ HOME: home, CLAUDE_CONFIG_DIR: config }, home, [flag]),
  ).toThrow(/Claude/)
})

it('does not promote parent-managed env that the installed SDK discards', async () => {
  const { resolveSettings } = await import('@anthropic-ai/claude-agent-sdk')
  const managed = {
    env: {
      ANTHROPIC_BASE_URL: 'http://ignored-managed',
      ANTHROPIC_AUTH_TOKEN: 'ignored-token',
      UNRELATED_SECRET: 'private',
    },
  }
  const resolved = await resolveSettings({ settingSources: [], managedSettings: managed })
  expect(resolved.effective.env?.ANTHROPIC_BASE_URL).not.toBe('http://ignored-managed')
  expect(resolved.effective.env?.ANTHROPIC_AUTH_TOKEN).not.toBe('ignored-token')
  const { home, config } = fixture()
  const env = claudeEffectiveEnvironment(
    {
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      ANTHROPIC_BASE_URL: 'http://launch',
      ANTHROPIC_AUTH_TOKEN: '',
    },
    home,
    ['--setting-sources=', `--managed-settings=${JSON.stringify(managed)}`],
  )
  expect(env.ANTHROPIC_BASE_URL).toBe('http://launch')
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
  expect(env.UNRELATED_SECRET).toBeUndefined()
})

it('rejects malformed, oversized and non-object managed JSON without quoting its contents', () => {
  const { home, config } = fixture()
  for (const value of ['{"token":"fixture-secret",', ' '.repeat(1024 * 1024 + 1), '[]', 'null']) {
    expect(() =>
      claudeEffectiveEnvironment({ HOME: home, CLAUDE_CONFIG_DIR: config }, home, [
        `--managed-settings=${value}`,
      ]),
    ).toThrow('Could not read inline Claude managed settings')
  }
})
