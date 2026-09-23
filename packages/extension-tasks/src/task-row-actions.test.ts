import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { createTask, runtimeProfile, snapshotSchema } from '@dovo/studio-core'
import { taskActionClient, taskRowPatch, taskRowValues } from './task-row-actions'
import type { TaskSource } from './task-collection'
type Store = Parameters<typeof taskActionClient>[0]
const task = createTask({
  title: 'Original title',
  repositoryId: 'repo',
  agentId: '',
  objective: '',
})
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    tasks: [task],
    automations: [],
    repositories: [
      {
        id: 'repo',
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
const mac = runtimeProfile(
  {
    address: 'http://mac.local:51464',
    token: 'fixture-token-123456789',
  },
  'Mac',
)
const linux = runtimeProfile(
  {
    address: 'http://linux.local:51464',
    token: 'fixture-token-987654321',
  },
  'Linux',
)
const source: TaskSource = {
  runtimeId: linux.id,
  name: 'Linux',
  workspace: snapshot.workspace,
  snapshot,
  online: true,
}
function setup() {
  const requests: unknown[] = []
  const store: Store = {
    activeRuntimeId: mac.id,
    runtimeRegistry: {
      version: 1,
      activeId: mac.id,
      profiles: [mac, linux],
    },
    request: async (path, input, schema, method) => {
      requests.push({
        path,
        input,
        method,
        owner: mac.id,
      })
      return decode(schema, {
        ok: true,
      })
    },
    readRuntime: async (profile, path, input, schema, method) => {
      if (!store.runtimeRegistry.profiles.includes(profile))
        throw new Error('Runtime credentials changed')
      requests.push({
        path,
        input,
        method,
        owner: profile.id,
      })
      return decode(schema, {
        ok: true,
      })
    },
    refreshRuntime: vi.fn<Store['refreshRuntime']>(async () => {}),
    refreshRuntimes: vi.fn<Store['refreshRuntimes']>(async () => {}),
  }
  return {
    store,
    requests,
  }
}
it('patches only requested metadata with optimistic conflict guards', () => {
  expect(
    taskRowPatch(task, {
      title: 'Renamed',
      pinned: true,
    }),
  ).toEqual({
    collection: 'tasks',
    id: task.id,
    changes: {
      title: {
        before: 'Original title',
        after: 'Renamed',
      },
      pinned: {
        before: null,
        after: true,
      },
    },
  })
  expect(
    taskRowPatch(
      {
        ...task,
        pinned: true,
        snoozedUntil: '2026-09-24T12:00:00Z',
      },
      {
        pinned: false,
        snoozedUntil: null,
      },
    ).changes,
  ).toEqual({
    pinned: {
      before: true,
      after: false,
    },
    snoozedUntil: {
      before: '2026-09-24T12:00:00Z',
      after: null,
    },
  })
  expect(
    taskRowPatch(task, {
      title: task.title,
      harness: undefined,
    }).changes,
  ).toEqual({})
})
it('uses the task checkout branch and first user text, not a different project checkout or later prompt', () => {
  const messages = [
    {
      id: 'user-1',
      role: 'user' as const,
      text: '  Build the editor  ',
      createdAt: '2026-09-24T12:00:00Z',
    },
    {
      id: 'user-2',
      role: 'user' as const,
      text: 'Follow-up request',
      createdAt: '2026-09-24T12:01:00Z',
    },
  ]
  expect(
    taskRowValues(
      {
        ...task,
        messages,
      },
      source,
    ),
  ).toMatchObject({
    branch: 'main',
    titlePrompt: 'Build the editor',
  })
  expect(
    taskRowValues(
      {
        ...task,
        execution: 'worktree',
      },
      source,
    ).branch,
  ).toBe('')
  expect(
    taskRowValues(
      {
        ...task,
        execution: 'worktree',
        checkoutBranch: 'task/editor',
      },
      source,
    ).branch,
  ).toBe('task/editor')
  expect(taskRowValues(task, source).repository?.path).toBe('/project')
})
it('sends remote task mutations to their captured owner without switching the active device', async () => {
  const { store, requests } = setup()
  const client = taskActionClient(store, source)
  store.activeRuntimeId = linux.id
  await client.request(
    '/api/tasks/viewed',
    {
      id: task.id,
      turnId: 'turn',
      viewed: false,
      expectedRevision: 2,
    },
    mutableStruct({
      ok: Schema.Boolean,
    }),
  )
  await client.refresh()
  expect(requests).toEqual([
    {
      path: '/api/tasks/viewed',
      input: {
        id: task.id,
        turnId: 'turn',
        viewed: false,
        expectedRevision: 2,
      },
      method: undefined,
      owner: linux.id,
    },
  ])
  expect(store.refreshRuntime).toHaveBeenCalledWith(linux)
  expect(store.refreshRuntimes).not.toHaveBeenCalled()
})
it('retains the active request guard and refreshes only its own profile', async () => {
  const { store, requests } = setup()
  const client = taskActionClient(store, {
    ...source,
    runtimeId: mac.id,
  })
  await client.request(
    '/api/workspace',
    {
      id: task.id,
    },
    mutableStruct({
      ok: Schema.Boolean,
    }),
    'PATCH',
  )
  await client.refresh()
  expect(requests).toEqual([
    {
      path: '/api/workspace',
      input: {
        id: task.id,
      },
      method: 'PATCH',
      owner: mac.id,
    },
  ])
  expect(store.refreshRuntime).toHaveBeenCalledWith(mac)
})
it('rejects offline, forgotten or replaced remote owners instead of using the active runtime', async () => {
  const { store, requests } = setup()
  const response = mutableStruct({
    ok: Schema.Boolean,
  })
  await expect(
    taskActionClient(store, {
      ...source,
      online: false,
    }).request('/api/workspace', {}, response),
  ).rejects.toThrow('offline')
  const original = taskActionClient(store, source)
  store.runtimeRegistry = {
    ...store.runtimeRegistry,
    profiles: [mac],
  }
  await expect(
    taskActionClient(store, source).request('/api/workspace', {}, response),
  ).rejects.toThrow('no longer connected')
  await expect(original.request('/api/workspace', {}, response)).rejects.toThrow(
    'credentials changed',
  )
  expect(requests).toEqual([])
})
