import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, managedPolicySchema, defaultTaskHarness } from '@dovo/protocol'
import { ManagedPolicy } from './managed-policy.js'
import { openDatabase } from '../storage/database.js'
import { RuntimePreferences } from '../storage/runtime-preferences.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
const policy = (limits: unknown = {}, settings: unknown = {}) =>
  new ManagedPolicy(
    decode(managedPolicySchema, {
      schemaVersion: 1,
      organization: 'Example',
      limits,
      settings,
    }),
  )

it('rejects unreadable, malformed, unknown or unsupported policy restrictions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-policy-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'policy.json')
  expect(() => ManagedPolicy.load(file)).toThrow('Cannot load managed policy')
  await writeFile(
    file,
    JSON.stringify({ schemaVersion: 1, organization: 'Example', limits: { requireHttps: true } }),
  )
  expect(() => ManagedPolicy.load(file)).toThrow('invalid policy document')
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      organization: 'Example',
      limits: {
        providers: {
          instances: { codex: { locked: true, env: { PRIVATE: 'do-not-log', BAD: 42 } } },
        },
      },
    }),
  )
  let diagnostic = ''
  try {
    ManagedPolicy.load(file)
  } catch (error) {
    diagnostic = String(error)
  }
  expect(diagnostic).toContain('invalid policy document')
  expect(diagnostic).not.toContain('do-not-log')
  expect(() => policy({}, { imaginarySetting: { value: true, locked: true } })).toThrow(
    'Unknown managed',
  )
  expect(() => policy({}, { 'memory.imaginary': { value: true, locked: true } })).toThrow(
    'Unknown or invalid',
  )
  expect(() => policy({}, { 'memory.__proto__.polluted': { value: true, locked: true } })).toThrow(
    'Unknown managed',
  )
  expect(() => policy({ telemetry: true })).toThrow('false')
  expect(() =>
    policy(
      {},
      { memory: { value: {}, locked: true }, 'memory.imaginary': { value: true, locked: false } },
    ),
  ).toThrow('overlapping')
})

it('enforces provider and effective custom permission ceilings and owns launch configuration', () => {
  const managed = policy({
    maxPermission: 'workspace-write',
    providers: {
      allowed: ['codex'],
      instances: {
        codex: { locked: true, env: { GATEWAY: 'managed' } },
      },
    },
  })
  const agent = {
    ...defaultTaskHarness('codex'),
    id: 'agent',
    name: 'Agent',
    permission: 'workspace-write' as const,
    executablePath: '/user/wrapper',
    args: ['--unsafe'],
    env: { NODE_OPTIONS: '--require bypass' },
  }
  expect(managed.agent(agent)).toMatchObject({ args: undefined, env: { GATEWAY: 'managed' } })
  expect(managed.agent(agent).executablePath).not.toBe('/user/wrapper')
  expect(() => managed.agent({ ...agent, permission: 'full-access' })).toThrow('limits threads')
  expect(() => managed.agent({ ...agent, approvalPolicy: 'never' })).toThrow('limits threads')
  expect(() => managed.agent({ ...agent, provider: 'claude' })).toThrow('claude provider')
  expect(() =>
    policy({ maxPermission: 'ask' }).agent({ ...agent, provider: 'acp', permission: 'ask' }),
  ).toThrow('ACP providers')
})

it('pins only configured provider fields and never leaks their values in the public summary', () => {
  const managed = policy({
    providers: { instances: { codex: { locked: true, env: { GATEWAY: 'private-value' } } } },
    updates: { mode: 'auto', feedUrl: 'http://updates.internal/releases/?token=private-token' },
  })
  const agent = {
    ...defaultTaskHarness('codex'),
    executablePath: '/my/codex',
    env: { GATEWAY: 'user' },
    envSecrets: { GATEWAY: { provider: 'environment' as const, reference: 'USER_GATEWAY' } },
  }
  expect(managed.configure(agent)).toMatchObject({
    executablePath: '/my/codex',
    env: { GATEWAY: 'private-value' },
    envSecrets: {},
  })
  expect(JSON.stringify(managed.summary)).not.toContain('private-value')
  expect(JSON.stringify(managed.summary)).not.toContain('private-token')
})

it('overlays managed settings without persisting them and restores user values after policy removal', () => {
  const db = openDatabase(':memory:')
  cleanups.push(() => {
    db.close()
  })
  const original = new RuntimePreferences(db)
  original.save({ allowWebRequests: true })
  const managed = policy(
    {},
    {
      allowWebRequests: { value: false, locked: true },
      enableRemoteDesktop: { value: true, locked: false },
    },
  )
  const preferences = new RuntimePreferences(db, undefined, managed)
  expect(preferences.get()).toMatchObject({ allowWebRequests: false })
  expect(() => preferences.save({ allowWebRequests: true })).toThrow('manages allowWebRequests')
  preferences.save({ branchPrefix: 'managed-test/' })
  expect(new RuntimePreferences(db).get()).toMatchObject({
    allowWebRequests: true,
    branchPrefix: 'managed-test/',
  })
  expect(
    new RuntimePreferences(
      db,
      undefined,
      policy(
        {},
        {
          runtimeIcon: { value: 'cloud', locked: true },
        },
      ),
    ).get().runtimeIcon,
  ).toBe('cloud')
})

it('rejects disabled capabilities while unconfigured runtimes keep current behavior', () => {
  const managed = policy({
    sharing: false,
    clients: ['desktop'],
    updates: { mode: 'off', allowNightly: false },
  })
  for (const capability of ['sharing', 'remoteClients', 'connect', 'updates', 'nightlyUpdates'])
    expect(() => managed.require(capability)).toThrow('Example')
  expect(() => managed.require('webhookTasks')).not.toThrow()
  expect(() => managed.requireClient('local-browser')).toThrow('local-browser clients')
  expect(() => managed.requireClient('desktop')).not.toThrow()
  expect(() => new ManagedPolicy().require('sharing')).not.toThrow()
})
