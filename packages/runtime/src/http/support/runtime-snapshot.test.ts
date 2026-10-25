import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import type { Task } from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { runtimeSnapshot } from './runtime-snapshot.js'
import { snapshotTag } from './body.js'
import * as projectIcons from '../../scm/repositories/project-icon.js'

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'snapshot-projection-test-owner-token-32-characters',
    port: 0,
  })
  cleanup.push(runtime.close)
  const available = vi.spyOn(runtime.services.scratch, 'available').mockResolvedValue({
    id: 'scratch',
    kind: 'scratch',
    name: 'No project',
    path: '/tmp/snapshot-projection-scratch',
    branch: '',
  })
  cleanup.push(() => available.mockRestore())
  return { runtime, available }
}

it.each(['full', 'overview', 'paged'] as const)(
  'reuses an unchanged %s workspace across authenticated snapshot projections',
  async (mode) => {
    const { runtime } = await setup()
    const read = (owner: boolean) =>
      Effect.runPromise(
        runtimeSnapshot(
          runtime.services,
          { id: 'phone', owner },
          mode === 'overview',
          mode === 'paged' ? [] : undefined,
          mode === 'paged',
        ),
      )
    runtime.services.devices.add('Phone', 'snapshot-phone-token-at-least-32-characters')
    const first = await read(true)
    const next = await read(true)
    const phone = await read(false)
    expect(first.permissionPolicySupported).toBe(true)
    expect(phone.permissionPolicySupported).toBe(true)
    expect(next.workspace).toBe(first.workspace)
    expect(phone.workspace).toBe(first.workspace)
    expect(snapshotTag(next)).toBe(snapshotTag(first))
    expect(snapshotTag(phone)).not.toBe(snapshotTag(first))
    expect(phone.devices.every((device) => device.id === 'phone')).toBe(true)
    expect(phone.pendingDevices).toEqual([])
  },
)

it('invalidates derived scratch metadata even without a stored workspace revision', async () => {
  const { runtime, available } = await setup()
  const read = () =>
    Effect.runPromise(runtimeSnapshot(runtime.services, { id: 'owner', owner: true }))
  const first = await read()
  available.mockResolvedValue({
    ...first.workspace.repositories[0]!,
    path: '/tmp/new-scratch-path',
  })
  const next = await read()
  expect(next.revision).toBe(first.revision)
  expect(next.workspace).not.toBe(first.workspace)
  expect(next.workspace.repositories[0]?.path).toBe('/tmp/new-scratch-path')
  expect(snapshotTag(next)).not.toBe(snapshotTag(first))
  expect((await read()).workspace).toBe(next.workspace)
  available.mockResolvedValue(undefined)
  expect((await read()).workspace.repositories).toEqual([])
})

it('refreshes a discovered project icon without relying on workspace revisions', async () => {
  const { runtime, available } = await setup()
  available.mockResolvedValue(undefined)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      { id: 'folder', kind: 'folder', name: 'Folder', path: '/tmp/icon-folder', branch: '' },
    ],
  }))
  const icon = vi
    .spyOn(projectIcons, 'discoverProjectIcon')
    .mockResolvedValue('data:image/png;base64,YQ==')
  cleanup.push(() => icon.mockRestore())
  const read = () =>
    Effect.runPromise(runtimeSnapshot(runtime.services, { id: 'owner', owner: true }))
  const first = await read()
  expect((await read()).workspace).toBe(first.workspace)
  icon.mockResolvedValue('data:image/png;base64,Yg==')
  const next = await read()
  expect(next.revision).toBe(first.revision)
  expect(next.workspace.repositories[0]?.discoveredIcon).toBe('data:image/png;base64,Yg==')
  expect(next.workspace).not.toBe(first.workspace)
  expect(snapshotTag(next)).not.toBe(snapshotTag(first))
})

function conversation(): Task {
  return {
    id: 'thread',
    title: 'Original',
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '2026-10-01T00:00:00Z',
    draft: '',
    example: false,
    files: [],
    messages: Array.from({ length: 200 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      text: `Message ${index}`,
    })),
  }
}

it('serves paged snapshots without requesting complete task histories', async () => {
  const { runtime } = await setup()
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [conversation()] }))
  const full = vi.spyOn(runtime.services.store, 'publicTask').mockImplementation(() => {
    throw new Error('Paged snapshots must not load full histories')
  })
  cleanup.push(() => full.mockRestore())
  const snapshot = await Effect.runPromise(
    runtimeSnapshot(runtime.services, { id: 'owner', owner: true }, false, ['thread'], true),
  )
  expect(snapshot.workspace.tasks[0]?.messages).toHaveLength(20)
  expect(snapshot.workspace.tasks[0]?.historyBefore).toBe('m180')
  expect(full).not.toHaveBeenCalled()
})

it('captures task history at its revision before asynchronous repository enrichment', async () => {
  const { runtime, available } = await setup()
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [conversation()] }))
  const revision = runtime.services.store.version()
  const entered = deferredPromise<void>()
  const released = deferredPromise<undefined>()
  available.mockImplementation(() => {
    entered.resolve()
    return released.promise
  })
  const pending = Effect.runPromise(
    runtimeSnapshot(runtime.services, { id: 'owner', owner: true }, false, ['thread'], true),
  )
  await entered.promise
  runtime.services.store.updateTask('thread', (task) => ({ ...task, title: 'Changed' }))
  released.resolve(undefined)
  const snapshot = await pending
  expect(snapshot.revision).toBe(revision)
  expect(snapshot.workspace.tasks[0]?.title).toBe('Original')
  expect(runtime.services.store.taskSummary('thread').title).toBe('Changed')
})

it('publishes opaque provider generations without invalidating unrelated catalogs', async () => {
  const { runtime } = await setup()
  const read = () =>
    Effect.runPromise(runtimeSnapshot(runtime.services, { id: 'owner', owner: true }))
  const first = await read()
  expect(
    Object.values(first.catalogGenerations).every((value) => /^[a-f0-9]{64}$/.test(value)),
  ).toBe(true)
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: '/private/new-codex',
    shell: '/unrelated/shell',
  })
  const next = await read()
  expect(next.catalogGenerations.codex).not.toBe(first.catalogGenerations.codex)
  expect(next.catalogGenerations.claude).toBe(first.catalogGenerations.claude)
  expect(JSON.stringify(next.catalogGenerations)).not.toContain('/private')
  expect(snapshotTag(next)).not.toBe(snapshotTag(first))
  expect((await read()).catalogGenerations).toEqual(next.catalogGenerations)
})

it('opts into bounded settled summaries, keeps selected old threads and leaves legacy snapshots complete', async () => {
  const { runtime } = await setup()
  const tasks: Task[] = Array.from({ length: 40 }, (_, i) => ({
    id: `settled-${i}`,
    title: `Settled ${i}`,
    agentId: '',
    repositoryId: '',
    status: 'review',
    archived: true,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    draft: '',
    example: false,
    messages: [],
    files: [],
  }))
  runtime.services.store.update((workspace) => ({ ...workspace, tasks }))
  const read = (limit?: number, selected: string[] = []) =>
    Effect.runPromise(
      runtimeSnapshot(runtime.services, { id: 'owner', owner: true }, false, selected, true, limit),
    )
  const first = await read(25)
  expect(first.workspace.tasks).toHaveLength(25)
  expect(first.olderSettled).toEqual({ limit: 25, omitted: 15 })
  expect((await read(25)).workspace).toBe(first.workspace)
  const selected = await read(25, ['settled-0'])
  expect(selected.workspace.tasks.some((task) => task.id === 'settled-0')).toBe(true)
  expect(selected.detailTaskIds).toContain('settled-0')
  expect((await read(50)).workspace.tasks).toHaveLength(40)
  expect((await read()).workspace.tasks).toHaveLength(40)
})
