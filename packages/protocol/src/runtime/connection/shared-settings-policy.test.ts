import { expect, it } from 'vite-plus/test'
import { defaultTaskHarness, type TaskHarness } from '../../workspace.js'
import { sharedHarnessIssue, sharedSettingsIssue } from './shared-settings-policy.js'
import { sharedSettingsVersions } from './shared-state-values.js'

const harness = defaultTaskHarness('codex')
it.each([
  { env: { TOKEN: 'private-value' } },
  { envSecrets: { TOKEN: { provider: 'onepassword', reference: 'op://vault/item/password' } } },
  { executablePath: '/home/user/codex' },
  { configDirectory: '/home/user/account' },
  { acpInstallationId: 'host-install' },
  { endpoint: '/usr/local/bin/agent' },
  { endpoint: '~/bin/agent' },
  { endpoint: './bin/agent' },
  { endpoint: '../agent' },
  { endpoint: 'bin/agent' },
  { endpoint: 'http://user:password@agent.local' },
  { endpoint: 'C:\\agent.exe' },
  { endpoint: '\\\\server\\agent.exe' },
] satisfies Partial<TaskHarness>[])(
  'rejects machine-owned launch settings before creating shared versions: %j',
  (local) => {
    const configured = { ...harness, ...local }
    expect(sharedHarnessIssue(configured)).toContain('one computer')
    for (const value of [
      { agents: [{ ...configured, id: 'agent', name: 'Agent' }] },
      { taskDefaults: { harness: configured } },
    ]) {
      expect(() =>
        sharedSettingsVersions([{ key: 'global', updatedAt: 1, changeId: 'edit', value }]),
      ).toThrow('one computer')
    }
  },
)
it('permits portable model choices, commands and host environment-variable names', () => {
  const portable = {
    ...harness,
    model: 'model',
    endpoint: 'codex',
    envSecrets: { TOKEN: { provider: 'environment' as const, reference: 'HOST_TOKEN' } },
  }
  expect(sharedHarnessIssue(portable)).toBeUndefined()
  expect(
    sharedSettingsIssue({
      taskDefaults: { harness: portable },
      taskBehavior: { settleMerged: true },
      prompts: [{ id: 'review', name: 'review', text: 'Review changes' }],
    }),
  ).toBeUndefined()
})

it('keeps LAN and VPN HTTP connections portable without embedded credentials', () => {
  for (const endpoint of [
    'http://agent.local:4096',
    'http://100.64.0.2:4096/path',
    'https://agent.example',
  ])
    expect(sharedHarnessIssue({ ...harness, provider: 'opencode', endpoint })).toBeUndefined()
  expect(sharedHarnessIssue({ ...harness, endpoint: 'http://' })).toBe(
    'Enter a valid HTTP(S) agent connection URL.',
  )
})
