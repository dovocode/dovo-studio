import { expect, it, vi } from 'vitest'
import { WorkspaceSynchronization, type WorkspaceOutbox } from './synchronization'
import { workspaceSchema, type RuntimeConnection, type WorkspacePatch } from '@dovo/protocol'
const connection: RuntimeConnection = {
  address: 'http://localhost:8787',
  token: 'test-token-with-at-least-32-characters',
}
const patch: WorkspacePatch = {
  collection: 'agents',
  id: 'agent',
  changes: { name: { before: 'Before', after: 'After' } },
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
  sync.bind({ ...connection, address: 'http://localhost:8788' })
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

const editedWorkspace = workspaceSchema.parse({
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
  expect(persist).toHaveBeenCalledWith(connection, {
    version: 1,
    workspace: editedWorkspace,
    patches: [patch],
  })
  release()
  await flushing
  expect(send).toHaveBeenCalledOnce()
  expect(persist).toHaveBeenLastCalledWith(connection, null)
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
  expect(saved).toEqual({ version: 1, workspace: editedWorkspace, patches: [patch] })
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
  sync.bind(connection, { version: 1, workspace: editedWorkspace, patches: [patch] })
  await expect(sync.discard(sync.checkpoint())).rejects.toThrow('Disk unavailable')
  expect(sync.hasPending()).toBe(true)
  expect(sync.accepts(sync.checkpoint())).toBe(false)
})
