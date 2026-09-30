import { expect, it } from 'vite-plus/test'
import { decode, snapshotSchema } from '@dovo/protocol'
import { launcherAgents } from './task-launcher-choices'
it('offers only favorites available on the chosen server, excluding disabled and stale configurations', () => {
  const snapshot = decode(snapshotSchema, {
    revision: 0,
    owner: true,
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [
        {
          id: 'agent',
          name: 'My Codex',
          provider: 'codex',
          model: '',
          endpoint: '',
          instructions: '',
          permission: 'ask',
        },
      ],
      repositories: [],
      tasks: [],
      automations: [],
    },
    defaults: {
      modelPreferences: {
        'agent:agent': { favorite: true, disabled: false },
        'agent:removed': { favorite: true, disabled: false },
        'codex:gpt-5': { favorite: true, disabled: true },
        'claude:sonnet': { favorite: true, disabled: false },
        'codex:': { favorite: false, disabled: false },
        'acp:installed:model': { favorite: true, disabled: false },
        'acp:missing:model': { favorite: true, disabled: false },
      },
    },
    acpInstallations: [
      {
        id: 'installed',
        registryId: 'installed',
        name: 'ACP agent',
        version: '1',
        distribution: 'binary',
        installedAt: '2026-09-30T00:00:00Z',
      },
    ],
  })
  expect(launcherAgents(snapshot, ['codex:', 'opencode:legacy'])).toEqual([
    {
      key: 'opencode:legacy',
      name: 'opencode · legacy',
      provider: 'opencode',
      model: 'legacy',
      acpInstallationId: undefined,
    },
    { key: 'agent:agent', name: 'My Codex', agentId: 'agent', provider: 'codex' },
    {
      key: 'claude:sonnet',
      name: 'claude · sonnet',
      provider: 'claude',
      model: 'sonnet',
      acpInstallationId: undefined,
    },
    {
      key: 'acp:installed:model',
      name: 'ACP agent · model',
      provider: 'acp',
      model: 'model',
      acpInstallationId: 'installed',
    },
  ])
})
