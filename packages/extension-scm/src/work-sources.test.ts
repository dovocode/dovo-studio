import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { z } from 'zod'
import { snapshotSchema, runtimeProfile } from '@dovo/studio-core'
import type { useWorkspace, RepositorySource } from '@dovo/studio-core'
import { jiraSourceKey, useIssueSources } from './work-sources'

type Store = Pick<
  ReturnType<typeof useWorkspace>,
  'workspace' | 'activeRuntimeId' | 'connected' | 'runtimes' | 'readRuntime' | 'runtimeReadCache'
>
let store: Store
let repositories: RepositorySource[] = []
vi.mock('@dovo/studio-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dovo/studio-core')>()),
  useWorkspace: () => store,
  useRepositorySources: () => repositories,
}))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: (factory: () => unknown) => factory(),
}))
const snapshot = snapshotSchema.parse({
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    automations: [],
    tasks: [],
    repositories: [],
    jiraSources: [
      { id: 'tracker', site: 'https://team.atlassian.net', project: 'TEAM', name: 'Team backlog' },
    ],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
})
const mac = runtimeProfile(
  { address: 'http://mac.local:51464', token: 'fixture-credential-123456789' },
  'Mac',
)
const linux = runtimeProfile(
  { address: 'http://linux.local:51464', token: 'fixture-credential-123456789' },
  'Linux',
)
const cache = {
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  clear: async () => {},
  close: async () => {},
}
beforeEach(() => {
  repositories = []
  store = {
    activeRuntimeId: mac.id,
    workspace: snapshot.workspace,
    connected: true,
    runtimes: [mac, linux].map((profile) => ({
      profile,
      snapshot,
      connected: true,
      lastSeen: null,
      error: null,
      pulls: null,
      pullError: null,
    })),
    readRuntime: async (profile, _path, input, schema) =>
      schema.parse({ owner: profile.id, input }),
    runtimeReadCache: () => cache,
  }
})
it('lists standalone Jira with no code projects and keeps same IDs distinct across computers', () => {
  const sources = useIssueSources(true)
  expect(sources).toHaveLength(2)
  expect(sources[0]).toMatchObject({
    name: 'Team backlog',
    input: { jiraSourceId: 'tracker' },
  })
  expect(sources[0].key).toBe(jiraSourceKey(mac.id, 'tracker'))
  expect(sources[1].key).not.toBe(sources[0].key)
  expect(useIssueSources(false)).toEqual([])
})
it('keeps requests bound to the Jira owner and invalidates scope on credential changes', async () => {
  const source = useIssueSources(true)[1]
  expect(
    await source.request(
      '/api/scm/work/issues/list',
      source.input,
      z.object({ owner: z.string(), input: z.object({ jiraSourceId: z.string() }) }),
    ),
  ).toEqual({ owner: linux.id, input: { jiraSourceId: 'tracker' } })
  store.runtimes[1] = {
    ...store.runtimes[1],
    profile: {
      ...linux,
      connection: { ...linux.connection, token: 'replacement-credential-123456789' },
    },
  }
  expect(useIssueSources(true)[1].scope).not.toBe(source.scope)
})
it('adds optional per-issue project labels without changing the Jira identity', () => {
  const source = useIssueSources(true)[0]
  store.workspace = {
    ...store.workspace,
    repositories: [{ id: 'app', name: 'Mobile app', path: '/app', branch: 'main' }],
    jiraIssueLinks: [{ sourceId: 'tracker', issueId: 'TEAM-1', repositoryId: 'app' }],
  }
  const linked = useIssueSources(true)[0]
  expect(linked.scope).toBe(source.scope)
  expect(linked.projectLinks).toEqual({ 'TEAM-1': 'Mobile app' })
  expect(linked.input).toEqual({ jiraSourceId: 'tracker' })
})
