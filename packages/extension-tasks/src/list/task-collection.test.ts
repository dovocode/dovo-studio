import { decode } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { createTask, runtimeProfile, snapshotSchema, type RuntimeOverview } from '@dovo/studio-core'
import { collectTasks, mainTaskEntries, taskCollectionKey, taskSources } from './task-collection'
const task = {
  ...createTask({
    title: 'Cached title',
    repositoryId: 'repo',
    agentId: '',
    objective: '',
  }),
  id: 'same-task',
}
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  runtimeHost: 'host',
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    automations: [],
    tasks: [task],
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
const runtime = (address: string, name: string): RuntimeOverview => ({
  profile: runtimeProfile(
    {
      address,
      token: 'test-private-token-1234567',
    },
    name,
  ),
  snapshot: { ...snapshot, runtimeHost: name === 'Mac' ? 'Mac computer' : 'Linux computer' },
  connected: true,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
})
const mac = runtime('http://mac.local:51464', 'Mac')
const linux = runtime('http://linux.local:51464', 'Linux')
it('uses unsent active edits once and preserves the identities of identical task and project IDs on another host', () => {
  const workspace = {
    ...snapshot.workspace,
    tasks: [
      {
        ...task,
        title: 'Unsent edit',
        pinned: true,
      },
    ],
  }
  const entries = collectTasks(
    taskSources({
      workspace,
      snapshot,
      activeRuntimeId: mac.profile.id,
      connected: true,
      runtimes: [mac, linux],
    }),
  )
  expect(entries.map((entry) => entry.task.title)).toEqual(['Unsent edit', 'Cached title'])
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(2)
  expect(new Set(entries.map((entry) => entry.projectKey)).size).toBe(2)
  expect(entries[0].source.address).toBe(mac.profile.connection.address)
  expect(entries[1].source.address).toBe(linux.profile.connection.address)
  expect(entries[0].source.workspace).toBe(workspace)
  expect(entries[0].task.pinned).toBe(true)
})
it('keeps approvals, cached state and device labels scoped to the owning computer', () => {
  const remote = {
    ...linux,
    connected: false,
    snapshot: {
      ...snapshot,
      runtimeHost: 'Linux computer',
      approvals: [
        {
          id: 'approval',
          taskId: task.id,
          title: 'Approve',
          detail: '',
          createdAt: '2026-09-20T12:00:00Z',
        },
      ],
    },
  }
  const entries = collectTasks(
    taskSources({
      workspace: snapshot.workspace,
      snapshot,
      activeRuntimeId: mac.profile.id,
      connected: true,
      runtimes: [mac, remote],
    }),
  )
  expect(
    entries.map((entry) => [entry.source.name, entry.needsInput, entry.source.online]),
  ).toEqual([
    ['Mac computer', false, true],
    ['Linux computer', true, false],
  ])
})
it('retains settled and snoozed threads for filters and omits samples and unhydrated runtimes', () => {
  const tasks = [
    {
      ...task,
      archived: true,
    },
    {
      ...task,
      id: 'snoozed',
      snoozedUntil: '2099-01-01T00:00:00Z',
    },
    {
      ...task,
      id: 'sample',
      example: true,
    },
  ]
  const entries = collectTasks(
    taskSources({
      workspace: {
        ...snapshot.workspace,
        tasks,
      },
      snapshot,
      activeRuntimeId: mac.profile.id,
      connected: true,
      runtimes: [
        mac,
        {
          ...linux,
          snapshot: null,
        },
      ],
    }),
  )
  expect(entries.map((entry) => entry.task.id)).toEqual(['same-task', 'snoozed'])
})
it('keeps row and filter keys stable when the selected computer changes', () => {
  const before = taskSources({
    workspace: snapshot.workspace,
    snapshot,
    activeRuntimeId: mac.profile.id,
    connected: true,
    runtimes: [mac, linux],
  })
  const after = taskSources({
    workspace: snapshot.workspace,
    snapshot,
    activeRuntimeId: linux.profile.id,
    connected: true,
    runtimes: [mac, linux],
  })
  expect(
    collectTasks(before)
      .map((entry) => entry.key)
      .sort(),
  ).toEqual(
    collectTasks(after)
      .map((entry) => entry.key)
      .sort(),
  )
  expect(taskCollectionKey(mac.profile.id, 'repo')).not.toBe(
    taskCollectionKey(linux.profile.id, 'repo'),
  )
})
it('groups every delegated generation under its parent without removing child navigation entries', () => {
  const child = {
    ...task,
    id: 'child',
    delegation: { parentTaskId: task.id, parentRunId: 'run', key: 'child' },
  }
  const nested = {
    ...child,
    id: 'nested',
    archivedAt: '2026-10-03T12:00:00Z',
    delegation: { ...child.delegation, parentTaskId: child.id, key: 'nested' },
  }
  const sources = taskSources({
    workspace: { ...snapshot.workspace, tasks: [task, child, nested] },
    snapshot,
    activeRuntimeId: mac.profile.id,
    connected: true,
    runtimes: [
      mac,
      {
        ...linux,
        snapshot: {
          ...snapshot,
          runtimeHost: 'Linux computer',
          workspace: { ...snapshot.workspace, tasks: [{ ...child, delegation: undefined }] },
        },
      },
    ],
  })
  const entries = collectTasks(sources)
  expect(entries.map((entry) => entry.task.id)).toEqual([task.id, 'child', 'nested', 'child'])
  expect(mainTaskEntries(entries).map((entry) => [entry.source.name, entry.task.id])).toEqual([
    ['Mac computer', task.id],
    ['Linux computer', 'child'],
  ])
})
