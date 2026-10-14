import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  startRuntimeSync,
  applySnapshotDelta,
  type RuntimeSnapshot,
  type DesktopSyncEvent,
  type DesktopSyncSubscription,
} from '@dovo/protocol'
import { startRuntime } from '../../../packages/runtime/src/index.js'
import { runtimeIntegration } from '../../../packages/runtime/src/testing/integration.js'
import { RuntimeConnections } from './runtime-connections.js'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
it('shares a real HTTP runtime stream, unions thread histories, and keeps the popout live after main closes', async () => {
  const token = 'shared-desktop-runtime-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: ['author', 'reviewer'].map((id) => ({
      id,
      title: id,
      agentId: '',
      repositoryId: '',
      status: 'draft',
      createdAt: '2026-10-12',
      messages: [{ id: id + '-message', role: 'assistant', text: id + ' history' }],
      files: [],
      draft: '',
      example: false,
    })),
  }))
  const start = vi.fn<typeof startRuntimeSync>((...args) => startRuntimeSync(...args))
  const manager = new RuntimeConnections(start)
  cleanups.push(() => manager.dispose())
  const input = (id: string): DesktopSyncSubscription => ({
    id,
    connection: { address: `http://127.0.0.1:${runtime.port}`, token },
    tasks: [id],
    scopes: [id],
    detailScopes: [id],
  })
  const main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  manager.subscribe('main', input('author'), (event) => main.push(event))
  let popoutSnapshot: RuntimeSnapshot | undefined
  manager.subscribe('popout', input('reviewer'), (event) => {
    popout.push(event)
    if (event.type === 'snapshot') popoutSnapshot = event.snapshot
    else if (event.type === 'delta') {
      if (!popoutSnapshot) throw new Error('Delta arrived before baseline')
      popoutSnapshot = applySnapshotDelta(popoutSnapshot, event.delta)
    }
  })
  await vi.waitFor(() =>
    expect(main.some((event) => event.type === 'status' && event.online)).toBe(true),
  )
  await vi.waitFor(() =>
    expect(
      popout.some(
        (event) => event.type === 'snapshot' && event.snapshot.detailTaskIds?.includes('reviewer'),
      ),
    ).toBe(true),
  )
  const snapshot = popout.find((event) => event.type === 'snapshot')
  expect(snapshot?.type === 'snapshot' ? snapshot.snapshot.detailTaskIds?.sort() : []).toEqual([
    'author',
    'reviewer',
  ])
  expect(start).toHaveBeenCalledOnce()
  runtime.services.store.updateTask('reviewer', (task) => ({
    ...task,
    draft: 'Changed through runtime',
  }))
  await vi.waitFor(() =>
    expect(popoutSnapshot?.workspace.tasks.find((task) => task.id === 'reviewer')?.draft).toBe(
      'Changed through runtime',
    ),
  )
  expect(popout.some((event) => event.type === 'delta')).toBe(true)
  manager.unsubscribe('main')
  runtime.services.store.updateTask('reviewer', (task) => ({
    ...task,
    draft: 'Still connected after main closes',
  }))
  await vi.waitFor(() =>
    expect(popoutSnapshot?.workspace.tasks.find((task) => task.id === 'reviewer')?.draft).toBe(
      'Still connected after main closes',
    ),
  )
  runtime.services.activity.add('tool', 'reviewer', 'Shared activity', {
    toolId: 'shared',
    status: 'completed',
  })
  await vi.waitFor(() =>
    expect(
      popout.some(
        (event) =>
          event.type === 'activity' &&
          event.events.some((item) => item.summary === 'Shared activity'),
      ),
    ).toBe(true),
  )
  expect(start).toHaveBeenCalledOnce()
})
