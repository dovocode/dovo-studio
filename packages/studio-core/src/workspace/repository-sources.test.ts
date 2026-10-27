import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import {
  resolveRuntimeTarget,
  runtimeProfile,
  snapshotSchema,
  type RuntimeOverview,
  type RuntimeReadCache,
} from '@dovo/protocol'
import type { useWorkspace } from './provider'
import { repositorySourceKey, useRepositorySources } from './repository-sources'
type Store = Pick<
  ReturnType<typeof useWorkspace>,
  | 'workspace'
  | 'activeRuntimeId'
  | 'connection'
  | 'connected'
  | 'runtimes'
  | 'readRuntime'
  | 'readRuntimeEffect'
  | 'runtimeReadCache'
>
let store: Store
vi.mock('./provider', () => ({
  useWorkspace: () => store,
}))
// Exercise the source projection and explicit-owner request boundary, without a DOM renderer.
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
}))
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    automations: [],
    tasks: [],
    repositories: [
      {
        id: 'same-repo',
        name: 'Cached project',
        path: '/cached/project',
        branch: 'main',
      },
    ],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
})
const runtime = (address: string, name: string): RuntimeOverview => ({
  profile: runtimeProfile(
    {
      address,
      token: 'fixture-credential-123456789',
    },
    name,
  ),
  snapshot,
  connected: true,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
})
const mac = runtime('http://mac.local:51464', 'Mac')
const linux = runtime('http://linux.local:51464', 'Linux')
const cache: RuntimeReadCache = {
  closed: false,
  readEffect: () => Effect.succeed(null),
  writeEffect: () => Effect.void,
  removeEffect: () => Effect.void,
  clearEffect: () => Effect.void,
  closeEffect: () => Effect.void,
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  clear: async () => {},
  close: async () => {},
}
const caches = new Map([
  [mac.profile.id, cache],
  [
    linux.profile.id,
    {
      ...cache,
    },
  ],
])
beforeEach(() => {
  store = {
    activeRuntimeId: mac.profile.id,
    connection: mac.profile.connection,
    workspace: {
      ...snapshot.workspace,
      repositories: [
        {
          ...snapshot.workspace.repositories[0],
          name: 'Unsent rename',
        },
      ],
    },
    connected: true,
    runtimes: [mac, linux],
    readRuntimeEffect: (profile, _path, _input, schema) =>
      Effect.sync(() => decode(schema, { owner: profile.id })),
    readRuntime: async (profile, _path, _input, schema) =>
      decode(schema, {
        owner: profile.id,
      }),
    runtimeReadCache: (profile) => caches.get(profile.id) ?? cache,
  }
})
it('combines hosts without colliding repository IDs and keeps active optimistic edits', () => {
  const sources = useRepositorySources()
  expect(sources.map((source) => [source.repository.name, source.runtimeName])).toEqual([
    ['Unsent rename', 'Mac'],
    ['Cached project', 'Linux'],
  ])
  expect(new Set(sources.map((source) => source.key)).size).toBe(2)
  expect(sources[1].key).toBe(repositorySourceKey(linux.profile.id, 'same-repo'))
})
it('binds each request and read cache to its owner independently of the active host', async () => {
  const source = useRepositorySources()[1]
  expect(source.readCache).toBe(caches.get(linux.profile.id))
  expect(
    await source.request(
      '/api/read',
      {},
      mutableStruct({
        owner: Schema.String,
      }),
    ),
  ).toEqual({
    owner: linux.profile.id,
  })
  expect(
    await Effect.runPromise(
      source.requestEffect('/api/read', {}, mutableStruct({ owner: Schema.String })),
    ),
  ).toEqual({ owner: linux.profile.id })
  store = {
    ...store,
    activeRuntimeId: linux.profile.id,
    connection: linux.profile.connection,
    workspace: snapshot.workspace,
  }
  expect(useRepositorySources().find((entry) => entry.key === source.key)?.scope).toBe(source.scope)
})
it('changes the content scope when credentials, checkout path or Jira binding changes', () => {
  const initial = useRepositorySources()[1]
  const replacement = {
    ...linux,
    profile: {
      ...linux.profile,
      connection: {
        ...linux.profile.connection,
        token: 'replacement-credential-123456789',
      },
    },
  }
  store = {
    ...store,
    runtimes: [mac, replacement],
  }
  const changedCredential = useRepositorySources()[1]
  expect(changedCredential.key).toBe(initial.key)
  expect(changedCredential.scope).not.toBe(initial.scope)
  store = {
    ...store,
    runtimes: [
      mac,
      {
        ...replacement,
        snapshot: {
          ...snapshot,
          workspace: {
            ...snapshot.workspace,
            repositories: [
              {
                ...snapshot.workspace.repositories[0],
                path: '/other/project',
                jira: {
                  site: 'https://example.atlassian.net',
                  project: 'NEW',
                },
              },
            ],
          },
        },
      },
    ],
  }
  expect(useRepositorySources()[1].scope).not.toBe(changedCredential.scope)
})
it('retains cached offline projects and omits computers without a loaded snapshot', () => {
  store = {
    ...store,
    connected: false,
    runtimes: [
      mac,
      {
        ...linux,
        connected: false,
      },
      {
        ...runtime('http://new.local:51464', 'New'),
        snapshot: null,
      },
    ],
  }
  expect(useRepositorySources().map((source) => [source.runtimeName, source.connected])).toEqual([
    ['Mac', false],
    ['Linux', false],
  ])
})
it('retires captured requests after a same-pairing address change and keeps other hosts', async () => {
  // Mirrors the provider: explicit-owner reads dispatch only to a currently saved pairing.
  const read = mutableStruct({ owner: Schema.String, address: Schema.String })
  store = {
    ...store,
    readRuntime: async (profile, _path, _input, schema) => {
      if (
        !resolveRuntimeTarget(
          store.runtimes.map((entry) => entry.profile),
          profile,
        )
      )
        throw new Error('This device connection changed. Reopen the item to continue.')
      return decode(schema, { owner: profile.id, address: profile.connection.address })
    },
  }
  const [captured, other] = useRepositorySources()
  const replaced = {
    ...mac,
    profile: {
      ...mac.profile,
      connection: { ...mac.profile.connection, address: 'http://mac.vpn:51464' },
    },
  }
  // The registry already names the new address; the open connection is still the old one.
  store = { ...store, runtimes: [replaced, linux] }
  const [current, inactive] = useRepositorySources()
  expect(current.key).toBe(captured.key)
  expect(current.scope).not.toBe(captured.scope)
  expect(current.repository.name).toBe('Cached project')
  await expect(captured.request('/api/read', {}, read)).rejects.toThrow('connection changed')
  expect(await current.request('/api/read', {}, read)).toEqual({
    owner: mac.profile.id,
    address: 'http://mac.vpn:51464',
  })
  expect(await other.request('/api/read', {}, read)).toEqual({
    owner: linux.profile.id,
    address: 'http://linux.local:51464',
  })
  expect(inactive.scope).toBe(other.scope)
  store = { ...store, connection: replaced.profile.connection }
  expect(useRepositorySources()[0].repository.name).toBe('Unsent rename')
})
