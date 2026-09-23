import { decode, decodeResult } from './schema.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aggregateRuntimeTasks,
  loadRuntimeOverview,
  removeRuntime,
  runtimeProfile,
  runtimeRegistrySchema,
  upsertRuntime,
} from './runtime-fleet'
import type { RuntimeOverview, RuntimeRegistry } from './runtime-fleet'
import { snapshotSchema } from './runtime'
import { taskSchema } from './workspace'
const profile = runtimeProfile(
  {
    address: 'http://one.local:51464',
    token: 'one-private-token-1234567',
  },
  'Mac',
)
const other = runtimeProfile(
  {
    address: 'http://two.local:51464',
    token: 'two-private-token-1234567',
  },
  'Linux',
)
const task = decode(taskSchema, {
  id: 'same-task',
  title: 'Build it',
  repositoryId: 'same-repo',
  agentId: '',
  status: 'running',
  createdAt: '2026-09-19T10:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
})
const snapshot = decode(snapshotSchema, {
  runtimeHost: 'reported-hostname',
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    automations: [],
    tasks: [task],
    repositories: [
      {
        id: 'same-repo',
        name: 'Project',
        path: '/project',
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
const overview: RuntimeOverview = {
  profile,
  snapshot,
  connected: true,
  lastSeen: '2026-09-19T10:00:00Z',
  error: null,
  pulls: {
    total: 4,
    needsAttention: 1,
    reviewRequested: 1,
    partial: false,
  },
  pullError: null,
}
const pull = {
  number: 1,
  title: 'Review me',
  url: 'https://github.com/org/repo/pull/1',
  state: 'open',
  draft: false,
  author: 'someone',
  updatedAt: '2026-09-19',
  head: 'feature',
  base: 'main',
  labels: [],
  viewerReviewRequested: true,
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
  })
afterEach(() => vi.unstubAllGlobals())
describe('Saved runtimes', () => {
  it('normalizes origins, replaces credentials without duplicate devices and removes active selection safely', () => {
    const empty: RuntimeRegistry = {
      version: 1,
      activeId: null,
      profiles: [],
    }
    const first = upsertRuntime(empty, profile)
    const saved = upsertRuntime(first, other, false)
    const updated = upsertRuntime(
      saved,
      runtimeProfile({
        ...profile.connection,
        address: 'http://ONE.local:51464/path/',
        token: 'replacement-token-1234567',
      }),
    )
    expect(updated.profiles).toHaveLength(2)
    expect(updated.profiles[0].connection.token).toBe('replacement-token-1234567')
    expect(decode(runtimeRegistrySchema, updated).activeId).toBe(profile.id)
    expect(removeRuntime(updated, other.id).activeId).toBe(profile.id)
    expect(removeRuntime(updated, profile.id)).toEqual({
      version: 1,
      activeId: null,
      profiles: [other],
    })
  })
  it('rejects credentials in URLs, wildcard connect targets and invalid registry identities', () => {
    expect(() =>
      runtimeProfile({
        ...profile.connection,
        address: 'http://secret@example.com',
      }),
    ).toThrow('Runtime address must not contain credentials')
    expect(() =>
      runtimeProfile({
        ...profile.connection,
        address: 'http://0.0.0.0:51464',
      }),
    ).toThrow('wildcard')
    expect(
      decodeResult(runtimeRegistrySchema, {
        version: 1,
        activeId: 'missing',
        profiles: [profile],
      }).success,
    ).toBe(false)
    expect(
      decodeResult(runtimeRegistrySchema, {
        version: 1,
        activeId: null,
        profiles: [profile, profile],
      }).success,
    ).toBe(false)
  })
})
describe('Runtime dashboard', () => {
  it('scopes identical IDs, approvals and repository names to their owning device', () => {
    const entries = aggregateRuntimeTasks([
      overview,
      {
        ...overview,
        profile: other,
        connected: false,
        snapshot: {
          ...snapshot,
          approvals: [
            {
              id: 'approval',
              taskId: task.id,
              title: 'Allow',
              detail: '',
              createdAt: '',
            },
          ],
          workspace: {
            ...snapshot.workspace,
            repositories: [
              {
                ...snapshot.workspace.repositories[0],
                name: 'Other project',
              },
            ],
          },
        },
      },
    ])
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2)
    expect(entries[0]).toMatchObject({
      runtimeId: other.id,
      runtimeName: 'Linux',
      needsInput: true,
      online: false,
      projectName: 'Other project',
    })
    expect(entries[1]).toMatchObject({
      runtimeId: profile.id,
      needsInput: false,
      online: true,
      projectName: 'Project',
    })
  })
  it('omits examples, settled and snoozed tasks, preserving pinned priority', () => {
    const entries = aggregateRuntimeTasks(
      [
        {
          ...overview,
          snapshot: {
            ...snapshot,
            workspace: {
              ...snapshot.workspace,
              tasks: [
                task,
                {
                  ...task,
                  id: 'example',
                  example: true,
                },
                {
                  ...task,
                  id: 'settled',
                  archived: true,
                },
                {
                  ...task,
                  id: 'snoozed',
                  snoozedUntil: '2026-09-20T00:00:00Z',
                },
                {
                  ...task,
                  id: 'pinned',
                  pinned: true,
                  status: 'draft',
                },
              ],
            },
          },
        },
      ],
      Date.parse('2026-09-19T00:00:00Z'),
    )
    expect(entries.map((entry) => entry.task.id)).toEqual(['pinned', task.id])
  })
  it('loads host-scoped requests, publishes tasks before PRs and flags partial counts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(snapshot))
      .mockResolvedValueOnce(
        json({
          pulls: [pull],
          page: 1,
          hasMore: true,
        }),
      )
    vi.stubGlobal('fetch', fetch)
    const received = vi.fn<(value: RuntimeOverview) => void>()
    const result = await loadRuntimeOverview(profile, undefined, received)
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot,
        connected: true,
        pulls: null,
      }),
    )
    expect(result.pulls).toEqual({
      total: 1,
      needsAttention: 1,
      reviewRequested: 1,
      partial: true,
    })
    expect(fetch.mock.calls[1][0]).toEqual(new URL('http://one.local:51464/api/scm/pulls/overview'))
    expect(fetch.mock.calls[1][1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${profile.connection.token}`,
      },
    })
    const body = fetch.mock.calls[1][1]?.body
    if (typeof body !== 'string') throw new Error('Expected a JSON request body')
    expect(JSON.parse(body)).toMatchObject({
      repositoryId: 'same-repo',
      refresh: false,
    })
  })
  it('retains last-known data offline without borrowing from other devices or replaced credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Device offline')))
    expect(await loadRuntimeOverview(profile, overview)).toMatchObject({
      connected: false,
      snapshot,
      lastSeen: overview.lastSeen,
      pulls: {
        total: 4,
        partial: true,
      },
    })
    expect(await loadRuntimeOverview(other, overview)).toMatchObject({
      connected: false,
      snapshot: null,
      pulls: null,
    })
    expect(
      await loadRuntimeOverview(
        {
          ...profile,
          connection: {
            ...profile.connection,
            token: 'new-private-token-1234567',
          },
        },
        overview,
      ),
    ).toMatchObject({
      connected: false,
      snapshot: null,
      pulls: null,
    })
  })
  it('does not mark a healthy device offline when PR loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(snapshot))
        .mockResolvedValueOnce(
          json(
            {
              error: 'GitHub unavailable',
            },
            502,
          ),
        ),
    )
    expect(await loadRuntimeOverview(profile, overview)).toMatchObject({
      connected: true,
      error: null,
      pulls: {
        total: 4,
        partial: true,
      },
      pullError: 'Project: GitHub unavailable',
    })
  })
  it('deduplicates PRs for repeated checkouts on the same host', async () => {
    const duplicate = {
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        repositories: [
          ...snapshot.workspace.repositories,
          {
            ...snapshot.workspace.repositories[0],
            id: 'another-checkout',
          },
        ],
      },
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(duplicate))
        .mockImplementation(() =>
          Promise.resolve(
            json({
              pulls: [pull],
              page: 1,
              hasMore: false,
            }),
          ),
        ),
    )
    expect((await loadRuntimeOverview(profile)).pulls).toMatchObject({
      total: 1,
      needsAttention: 1,
      partial: false,
    })
  })
})

it('preserves saved identity across a verified address change and rejects duplicate endpoints', () => {
  const registry: RuntimeRegistry = { version: 1, activeId: profile.id, profiles: [profile, other] }
  const changed = {
    ...profile,
    connection: { address: 'http://new-vpn:8787', token: 'freshly-paired-token-123456' },
  }
  const updated = upsertRuntime(registry, changed)
  expect(updated.profiles).toHaveLength(2)
  expect(updated.profiles[0].id).toBe(profile.id)
  expect(updated.activeId).toBe(profile.id)
  expect(decode(runtimeRegistrySchema, updated)).toEqual(updated)
  expect(() => upsertRuntime(registry, { ...changed, connection: other.connection })).toThrow(
    'already saved',
  )
})
