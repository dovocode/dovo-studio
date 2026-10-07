import { decode } from '@dovo/protocol'
import { expect, it, vi } from 'vite-plus/test'
import { WorkspaceSynchronization, type WorkspaceOutbox } from './synchronization'
import type { WorkspaceOutboxChange } from './synchronization'
import { workspaceSchema, type RuntimeConnection, type WorkspacePatch } from '@dovo/protocol'
const connection: RuntimeConnection = {
  address: 'http://localhost:8787',
  token: 'test-token-with-at-least-32-characters',
}
const patch: WorkspacePatch = {
  collection: 'agents',
  id: 'agent',
  changes: {
    name: {
      before: 'Before',
      after: 'After',
    },
  },
}
it('rejects a snapshot that began before an edit, even when the patch has finished', async () => {
  const sync = new WorkspaceSynchronization(
    () => {},
    async () => {},
  )
  sync.bind(connection)
  const old = sync.checkpoint()
  sync.enqueue([patch])
  await sync.flush()
  expect(sync.accepts(old)).toBe(false)
  expect(sync.accepts(sync.checkpoint())).toBe(true)
})
it('keeps an old connection response from consuming the new connection queue', async () => {
  let release: () => void = () => {}
  const first = new Promise<void>((resolve) => {
    release = resolve
  })
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockReturnValueOnce(first)
    .mockResolvedValue(undefined)
  const sync = new WorkspaceSynchronization(() => {}, send)
  sync.bind(connection)
  sync.enqueue([patch])
  const old = sync.flush()
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  sync.bind({
    ...connection,
    address: 'http://localhost:8788',
  })
  sync.enqueue([patch])
  release()
  await old
  await sync.flush()
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1][0].address).toBe('http://localhost:8788')
})
it('retains conflicts until explicitly reconnecting', async () => {
  const errors: Array<string | null> = []
  const sync = new WorkspaceSynchronization(
    (error) => errors.push(error),
    async () => {
      throw new Error('Conflict')
    },
  )
  sync.bind(connection)
  sync.enqueue([patch])
  await expect(sync.flush()).rejects.toThrow('Conflict')
  sync.clearNetworkError()
  expect(errors.at(-1)).toBe('Conflict')
  expect(sync.accepts(sync.checkpoint())).toBe(false)
  await expect(sync.flush()).rejects.toThrow('Retry sync')
})
it('retries the same queued patch after a connection failure before allowing a switch', async () => {
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue(undefined)
  const sync = new WorkspaceSynchronization(() => {}, send)
  sync.bind(connection)
  sync.enqueue([patch])
  await expect(sync.flush()).rejects.toThrow('Connection lost')
  expect(sync.hasPending()).toBe(true)
  await sync.retry()
  expect(send.mock.calls.map((call) => call[1])).toEqual([patch, patch])
  expect(sync.hasPending()).toBe(false)
  expect(sync.accepts(sync.checkpoint())).toBe(true)
})
it('retains conflicting edits after an explicit retry fails', async () => {
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockRejectedValue(new Error('Another client changed title'))
  const sync = new WorkspaceSynchronization(() => {}, send)
  sync.bind(connection)
  sync.enqueue([patch])
  await expect(sync.flush()).rejects.toThrow('Another client changed title')
  await expect(sync.retry()).rejects.toThrow('Another client changed title')
  expect(sync.hasPending()).toBe(true)
  expect(sync.accepts(sync.checkpoint())).toBe(false)
  await expect(sync.flush()).rejects.toThrow('Retry sync')
})
const editedWorkspace = decode(workspaceSchema, {
  version: 1,
  agents: [
    {
      id: 'agent',
      name: 'After',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    },
  ],
  repositories: [],
  tasks: [],
  automations: [],
  runtimeAddress: '',
})
it('commits the durable outbox before sending any edit to the host', async () => {
  let release: () => void = () => {}
  const committed = new Promise<void>((resolve) => {
    release = resolve
  })
  const persist = vi
    .fn<(connection: RuntimeConnection, value: WorkspaceOutbox | null) => Promise<void>>()
    .mockReturnValueOnce(committed)
    .mockResolvedValue(undefined)
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockResolvedValue(undefined)
  const sync = new WorkspaceSynchronization(() => {}, send, persist)
  sync.bind(connection)
  sync.enqueue([patch], editedWorkspace)
  const flushing = sync.flush()
  await Promise.resolve()
  expect(send).not.toHaveBeenCalled()
  expect(persist).toHaveBeenCalledWith(
    connection,
    {
      version: 1,
      workspace: editedWorkspace,
      patches: [patch],
      ids: expect.arrayContaining([expect.any(String)]),
    },
    { append: expect.arrayContaining([expect.any(String)]), remove: [] },
  )
  release()
  await flushing
  expect(send).toHaveBeenCalledOnce()
  expect(persist).toHaveBeenLastCalledWith(connection, null, {
    append: [],
    remove: persist.mock.calls[0][1]?.ids,
  })
})
it('restores failed edits after restart and requires explicit retry before replay', async () => {
  let saved: WorkspaceOutbox | null = null
  const persist = async (_connection: RuntimeConnection, value: WorkspaceOutbox | null) => {
    saved = value
  }
  const first = new WorkspaceSynchronization(
    () => {},
    async () => {
      throw new Error('Offline')
    },
    persist,
  )
  first.bind(connection)
  first.enqueue([patch], editedWorkspace)
  await expect(first.flush()).rejects.toThrow('Offline')
  expect(saved).toMatchObject({
    version: 1,
    workspace: editedWorkspace,
    patches: [patch],
  })
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockResolvedValue(undefined)
  const restored = new WorkspaceSynchronization(() => {}, send, persist)
  restored.bind(connection, saved)
  expect(restored.hasPending()).toBe(true)
  expect(restored.accepts(restored.checkpoint())).toBe(false)
  await expect(restored.flush()).rejects.toThrow('Retry sync')
  expect(send).not.toHaveBeenCalled()
  await restored.retry()
  expect(send).toHaveBeenCalledWith(connection, patch)
  expect(saved).toBeNull()
})
it('retains an uncertain acknowledgement when clearing the durable outbox fails', async () => {
  const persist = vi
    .fn<(connection: RuntimeConnection, value: WorkspaceOutbox | null) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Disk unavailable'))
    .mockResolvedValue(undefined)
  const send = vi
    .fn<(connection: RuntimeConnection, patch: WorkspacePatch) => Promise<unknown>>()
    .mockResolvedValue(undefined)
  const sync = new WorkspaceSynchronization(() => {}, send, persist)
  sync.bind(connection)
  sync.enqueue([patch], editedWorkspace)
  await expect(sync.flush()).rejects.toThrow('Disk unavailable')
  expect(sync.hasPending()).toBe(true)
  await sync.retry()
  expect(send.mock.calls.map((call) => call[1])).toEqual([patch, patch])
  expect(sync.hasPending()).toBe(false)
})
it('does not discard pending changes when the durable clear fails', async () => {
  const sync = new WorkspaceSynchronization(
    () => {},
    async () => {},
    async () => {
      throw new Error('Disk unavailable')
    },
  )
  sync.bind(connection, {
    version: 1,
    workspace: editedWorkspace,
    patches: [patch],
  })
  await expect(sync.discard(sync.checkpoint())).rejects.toThrow('Disk unavailable')
  expect(sync.hasPending()).toBe(true)
  expect(sync.accepts(sync.checkpoint())).toBe(false)
})

it('keeps newer edits durable when they arrive during an explicit discard', async () => {
  const { Effect } = await import('effect')
  const pending = new Map<string, WorkspacePatch>([['old-edit', patch]])
  let release: () => void = () => {}
  const clearing = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  const persist = async (
    _connection: RuntimeConnection,
    value: WorkspaceOutbox | null,
    change: WorkspaceOutboxChange,
  ) => {
    if (change.remove.includes('old-edit')) {
      started = true
      await clearing
    }
    for (const id of change.remove) pending.delete(id)
    for (const id of change.append) {
      const index = value?.ids?.indexOf(id) ?? -1
      if (!value || index < 0) throw new Error('Missing durable edit')
      pending.set(id, value.patches[index])
    }
  }
  const send = vi.fn<(connection: RuntimeConnection, sent: WorkspacePatch) => Promise<void>>(
    async (_connection, sent) => {
      expect([...pending.values()]).toContainEqual(sent)
    },
  )
  const sync = new WorkspaceSynchronization(() => {}, send, persist)
  sync.bind(connection, {
    version: 1,
    workspace: editedWorkspace,
    patches: [patch],
    ids: ['old-edit'],
  })
  const discard = sync.discard(sync.checkpoint()).then(
    () => 'Unexpected success',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  await vi.waitFor(() => expect(started).toBe(true))
  const newer: WorkspacePatch = {
    collection: 'agents',
    id: 'agent',
    changes: { instructions: { before: '', after: 'Keep the new edit' } },
  }
  sync.enqueue([newer], {
    ...editedWorkspace,
    agents: editedWorkspace.agents.map((agent) => ({
      ...agent,
      instructions: 'Keep the new edit',
    })),
  })
  await expect(sync.flush()).rejects.toThrow('finish clearing')
  expect(send).not.toHaveBeenCalled()
  release()
  expect(await discard).toContain('New edits remain queued')
  const saved = await Effect.runPromise(sync.savedEffect())
  expect(saved.outbox?.patches).toEqual([newer])
  expect([...pending.values()]).toEqual([newer])
  await sync.retry()
  expect(send).toHaveBeenCalledExactlyOnceWith(connection, newer)
  expect(pending.size).toBe(0)
})

it.each(['acknowledgement', 'discard'] as const)(
  'retires committed edits when interrupted during %s persistence',
  async (operation) => {
    const { Effect, Fiber } = await import('effect')
    let release: () => void = () => {}
    const committed = new Promise<void>((resolve) => {
      release = resolve
    })
    let clearing = false
    let durable = true
    const send = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const sync = new WorkspaceSynchronization(
      () => {},
      send,
      async (_connection, _value, change) => {
        if (change.remove.length) {
          clearing = true
          await committed
          durable = false
        }
      },
    )
    sync.bind(connection, {
      version: 1,
      workspace: editedWorkspace,
      patches: [patch],
      ids: ['saved-edit'],
    })
    const fiber = Effect.runFork(
      operation === 'discard' ? sync.discardEffect(sync.checkpoint()) : sync.retryEffect(),
    )
    await vi.waitFor(() => expect(clearing).toBe(true))
    fiber.interruptUnsafe()
    release()
    await Effect.runPromise(Fiber.await(fiber))
    expect(durable).toBe(false)
    expect(sync.hasPending()).toBe(false)
    const sends = send.mock.calls.length
    await sync.retry()
    expect(send).toHaveBeenCalledTimes(sends)
  },
)

it('keeps interrupted patches pending and requires an explicit retry', async () => {
  const { Effect, Fiber } = await import('effect')
  const errors: Array<string | null> = []
  let sends = 0
  const sync = new WorkspaceSynchronization(
    (error) => errors.push(error),
    () =>
      Effect.suspend(() => {
        sends++
        return sends === 1 ? Effect.never : Effect.void
      }),
  )
  sync.bind(connection)
  sync.enqueue([patch])
  const fiber = Effect.runFork(sync.flushEffect())
  await vi.waitFor(() => expect(sends).toBe(1))
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(sync.hasPending()).toBe(true)
  expect(sync.isSending()).toBe(false)
  expect(errors.at(-1)).toContain('interrupted')
  await expect(sync.flush()).rejects.toThrow('Retry sync')
  await sync.retry()
  expect(sends).toBe(2)
  expect(sync.hasPending()).toBe(false)
})

it('preserves unsent edits for an address replacement without requiring the old runtime', async () => {
  const send = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Old address offline'))
  const writes = new Map<string, WorkspaceOutbox | null>()
  const sync = new WorkspaceSynchronization(
    () => {},
    send,
    async (target, value) => {
      writes.set(target.address, value)
    },
  )
  sync.bind(connection)
  sync.enqueue([patch], editedWorkspace)
  await expect(sync.flush()).rejects.toThrow('Old address offline')
  const { Effect } = await import('effect')
  const saved = await Effect.runPromise(sync.savedEffect())
  expect(saved.outbox?.patches).toEqual([patch])
  expect(sync.acceptsSaved(saved.checkpoint)).toBe(true)
  expect(send).toHaveBeenCalledTimes(1)
  const replacement = { ...connection, address: 'http://new-vpn:8787' }
  sync.bind(replacement, saved.outbox)
  expect(sync.hasPending()).toBe(true)
  send.mockResolvedValue(undefined)
  await sync.retry()
  expect(writes.get(replacement.address)).toBeNull()
})

it('does not release edits for replacement if local durability failed', async () => {
  const sync = new WorkspaceSynchronization(
    () => {},
    async () => {},
    async () => {
      throw new Error('Disk full')
    },
  )
  sync.bind(connection)
  sync.enqueue([patch], editedWorkspace)
  const { Effect } = await import('effect')
  await expect(Effect.runPromise(sync.savedEffect())).rejects.toThrow('Disk full')
  expect(sync.hasPending()).toBe(true)
})

it('rejects pre-acknowledgement stream revisions but accepts a restarted runtime', async () => {
  const sync = new WorkspaceSynchronization(
    () => {},
    async () => ({ revision: 12, runtimeInstanceId: 'first-runtime' }),
  )
  sync.bind(connection)
  sync.enqueue([patch])
  await sync.flush()
  expect(sync.acceptsRevision(11, 'first-runtime')).toBe(false)
  expect(sync.acceptsRevision(12, 'first-runtime')).toBe(true)
  expect(sync.acceptsRevision(1, 'restarted-runtime')).toBe(true)
  expect(sync.acceptsRevision(1)).toBe(true)
  sync.bind(connection)
  expect(sync.acceptsRevision(1, 'first-runtime')).toBe(true)
})
