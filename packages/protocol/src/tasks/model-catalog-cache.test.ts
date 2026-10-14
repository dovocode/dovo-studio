import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { defaultTaskHarness, workspaceSchema, type Agent } from '../workspace.js'
import { snapshotSchema, type RuntimeSnapshot } from '../runtime/connection/runtime.js'
import { modelCatalogCacheScope, modelCatalogPresentation } from './model-catalog-cache.js'

const connection = {
  address: 'http://100.64.0.1:3000',
  token: 'device-private-token-value',
  runtimeId: 'logical-runtime',
}
const installation = {
  id: 'selected',
  registryId: 'selected',
  name: 'Selected',
  version: '1',
  installedAt: '2026-10-14',
  distribution: 'binary' as const,
}
const snapshot: RuntimeSnapshot = decode(snapshotSchema, {
  runtimeId: 'logical-runtime',
  runtimeInstanceId: 'instance-1',
  catalogGenerations: {
    codex: 'codex-1',
    claude: 'claude-1',
    acp: 'manual-acp-1',
    'acp:selected': 'acp-1',
  },
  acpInstallations: [installation, { ...installation, id: 'other', name: 'Other' }],
  revision: 0,
  workspace: decode(workspaceSchema, {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
  }),
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
  owner: true,
})

it('persists only model/reasoning/harness display fields, never ACP settings or live entitlements', () => {
  expect(
    modelCatalogPresentation({
      models: [{ id: 'm', name: 'Model' }],
      reasoning: [],
      harness: { name: 'Harness', generation: 'v2' },
      acp: {
        modes: [],
        commands: [],
        configOptions: [{ id: 'token', name: 'Token', currentValue: 'secret', options: [] }],
      },
      codex: { daybreakPrograms: ['daybreakBlue'], fastModeBlocked: true },
    }),
  ).toEqual({
    models: [{ id: 'm', name: 'Model' }],
    reasoning: [],
    harness: { name: 'Harness', generation: 'v2' },
  })
})

it('keeps durable runtime identity across address/token/profile aliases and separates live restarts', () => {
  const agent = defaultTaskHarness('codex')
  const first = modelCatalogCacheScope('profile-a', connection, snapshot, agent)
  expect(
    modelCatalogCacheScope(
      'profile-b',
      { ...connection, address: 'http://netbird:3000', token: 'new' },
      snapshot,
      agent,
    ),
  ).toEqual(first)
  const restart = modelCatalogCacheScope(
    'profile-a',
    connection,
    { ...snapshot, runtimeInstanceId: 'instance-2' },
    agent,
  )
  expect(restart.presentationKey).toBe(first.presentationKey)
  expect(restart.key).not.toBe(first.key)
  expect(
    modelCatalogCacheScope('profile-a', { ...connection, runtimeId: 'other' }, snapshot, agent),
  ).toEqual(first)
  expect(
    modelCatalogCacheScope('profile-a', connection, { ...snapshot, runtimeId: 'other' }, agent)
      .presentationKey,
  ).not.toBe(first.presentationKey)
})

it('retains legacy address/token isolation only when no durable runtime/profile ID exists', () => {
  const agent = defaultTaskHarness('codex')
  const legacy = { address: connection.address, token: connection.token }
  const first = modelCatalogCacheScope(null, legacy, null, agent)
  expect(modelCatalogCacheScope(null, { ...legacy, token: 'other' }, null, agent)).not.toEqual(
    first,
  )
  expect(
    modelCatalogCacheScope(null, { ...legacy, address: 'http://other:3000' }, null, agent),
  ).not.toEqual(first)
  expect(modelCatalogCacheScope('profile', legacy, null, agent)).toEqual(
    modelCatalogCacheScope('profile', { ...legacy, token: 'other' }, null, agent),
  )
})

it('ignores cosmetic names, permissions, catalog-independent models and unrelated generations/installations', () => {
  for (const provider of ['codex', 'muse'] as const) {
    const agent = { ...defaultTaskHarness(provider), id: 'a', name: 'A' }
    const first = modelCatalogCacheScope('profile', connection, snapshot, agent)
    const changed = {
      ...snapshot,
      catalogGenerations: { ...snapshot.catalogGenerations, claude: 'changed' },
      acpInstallations: [{ ...installation, version: 'changed' }],
    }
    const configured: Agent = { ...agent, name: 'B', model: 'other', permission: 'read-only' }
    expect(modelCatalogCacheScope('profile', connection, changed, configured)).toEqual(first)
  }
  const agent = defaultTaskHarness('codex')
  expect(
    modelCatalogCacheScope(
      null,
      connection,
      { ...snapshot, catalogGenerations: { ...snapshot.catalogGenerations, codex: 'changed' } },
      agent,
    ),
  ).not.toEqual(modelCatalogCacheScope(null, connection, snapshot, agent))
})

it('separates Grok reasoning catalogs by their selected model', () => {
  const agent = defaultTaskHarness('grok')
  const first = modelCatalogCacheScope('profile', connection, snapshot, agent)
  const selected = modelCatalogCacheScope('profile', connection, snapshot, {
    ...agent,
    model: 'different-reasoning-capabilities',
  })
  expect(selected.key).not.toBe(first.key)
  expect(selected.presentationKey).not.toBe(first.presentationKey)
})

it('targets ACP config, launch generation and selected installation version/time/repair only', () => {
  const agent = {
    ...defaultTaskHarness('acp'),
    acpInstallationId: 'selected',
    acpConfig: { token: 'secret' },
  }
  const first = modelCatalogCacheScope('profile', connection, snapshot, agent)
  const unrelated = {
    ...snapshot,
    acpInstallations: [installation, { ...installation, id: 'other', version: '2' }],
  }
  expect(modelCatalogCacheScope('profile', connection, unrelated, agent)).toEqual(first)
  for (const update of [{ version: '2' }, { installedAt: 'later' }, { needsRepair: true }]) {
    expect(
      modelCatalogCacheScope(
        'profile',
        connection,
        { ...snapshot, acpInstallations: [{ ...installation, ...update }] },
        agent,
      ),
    ).not.toEqual(first)
  }
  for (const update of [
    { model: 'other' },
    { acpMode: 'other' },
    { acpConfig: { token: 'other' } },
    { env: { ACCOUNT: 'other' } },
  ]) {
    expect(
      modelCatalogCacheScope('profile', connection, snapshot, { ...agent, ...update }),
    ).not.toEqual(first)
  }
  expect(
    modelCatalogCacheScope(
      'profile',
      connection,
      {
        ...snapshot,
        catalogGenerations: { ...snapshot.catalogGenerations, 'acp:selected': 'new' },
      },
      agent,
    ),
  ).not.toEqual(first)
  expect(JSON.stringify(first)).not.toContain('secret')
  const manual = defaultTaskHarness('acp')
  const commandChange = {
    ...snapshot,
    catalogGenerations: { ...snapshot.catalogGenerations, acp: 'manual-acp-2' },
  }
  expect(modelCatalogCacheScope('profile', connection, commandChange, manual)).not.toEqual(
    modelCatalogCacheScope('profile', connection, snapshot, manual),
  )
  expect(modelCatalogCacheScope('profile', connection, commandChange, agent)).toEqual(first)
})

it('hashes deterministically on HTTP without WebCrypto, including reordered account config', () => {
  vi.stubGlobal('crypto', undefined)
  try {
    const first = modelCatalogCacheScope(null, connection, snapshot, {
      ...defaultTaskHarness('codex'),
      env: { Z: 'secret', A: 'account' },
    })
    expect(first.key).toMatch(/^[a-f0-9]{64}$/)
    expect(first.presentationKey).toMatch(/^[a-f0-9]{64}$/)
    expect(
      modelCatalogCacheScope(null, connection, snapshot, {
        ...defaultTaskHarness('codex'),
        env: { A: 'account', Z: 'secret' },
      }),
    ).toEqual(first)
  } finally {
    vi.unstubAllGlobals()
  }
})
