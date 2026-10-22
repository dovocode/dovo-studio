import { beforeEach, expect, it, vi } from 'vite-plus/test'
import type { MutationOutbox, WorkspaceRecovery } from '@dovo/protocol'
const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  writes: [] as string[],
  failMove: false,
  failWrite: false,
  writeGate: undefined as Promise<void> | undefined,
}))
vi.mock('expo-file-system', () => {
  const uri = (parts: unknown[]) =>
    parts.map((part) => (part instanceof Directory ? part.uri : String(part))).join('/')
  class Directory {
    uri: string
    constructor(...parts: unknown[]) {
      this.uri = uri(parts)
    }
    get exists() {
      return fs.directories.has(this.uri)
    }
    create() {
      fs.directories.add(this.uri)
    }
    list() {
      return [...fs.files.keys()]
        .filter((key) => key.startsWith(this.uri + '/'))
        .map((key) => new File(key))
    }
  }
  class File {
    uri: string
    constructor(...parts: unknown[]) {
      this.uri = uri(parts)
    }
    get name() {
      return this.uri.split('/').at(-1)!
    }
    get exists() {
      return fs.files.has(this.uri)
    }
    async text() {
      const value = fs.files.get(this.uri)
      if (value === undefined) throw new Error('Missing file')
      return value
    }
    async write(value: string) {
      fs.writes.push(this.uri)
      await fs.writeGate
      if (fs.failWrite) throw new Error('Write interrupted')
      fs.files.set(this.uri, value)
    }
    async move(target: File) {
      if (fs.failMove) throw new Error('Move interrupted')
      fs.files.set(target.uri, await this.text())
      fs.files.delete(this.uri)
    }
    delete() {
      fs.files.delete(this.uri)
    }
  }
  return { Directory, File, Paths: { document: '/documents' } }
})
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  randomUUID: () => 'id',
  digestStringAsync: async (_algorithm: string, value: string) => {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(value).digest('hex')
  },
}))
import { mobileMutationStorage } from './mutation-storage'
const connection = { address: 'http://host.lan:4310', token: 'device' }
const edit = (id: string): WorkspaceRecovery => ({
  id,
  createdAt: '2026-10-14',
  patch: { collection: 'agents', id: 'agent', changes: { name: { before: 'Before', after: id } } },
  host: null,
})
const legacyPath = async () => {
  const { createHash } = await import('node:crypto')
  const key = createHash('sha256')
    .update(JSON.stringify([new URL(connection.address).origin, connection.token]))
    .digest('hex')
  return `/documents/runtime-mutations/${key}.recoveries.json`
}
beforeEach(() => {
  fs.files.clear()
  fs.directories.clear()
  fs.writes = []
  fs.failMove = false
  fs.failWrite = false
  fs.writeGate = undefined
})
it('migrates legacy recoveries once and appends independent records without rewriting existing edits', async () => {
  const legacy = await legacyPath()
  fs.files.set(legacy, JSON.stringify({ edits: [edit('old-1'), edit('old-2')] }))
  await mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new-1'))
  expect(fs.files.has(legacy)).toBe(false)
  expect(fs.writes).toHaveLength(3)
  await mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new-2'))
  await mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new-2'))
  expect(fs.writes).toHaveLength(4)
  expect(
    (await mobileMutationStorage.workspaceRecoveries!(connection)).map((edit) => edit.id).sort(),
  ).toEqual(['new-1', 'new-2', 'old-1', 'old-2'])
})
it('keeps the legacy source after an interrupted migration and recovers without losing edits', async () => {
  const legacy = await legacyPath()
  fs.files.set(legacy, JSON.stringify({ edits: [edit('old')] }))
  fs.failMove = true
  await expect(
    mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new')),
  ).rejects.toThrow('Move interrupted')
  expect(fs.files.has(legacy)).toBe(true)
  fs.failMove = false
  await mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new'))
  expect(
    (await mobileMutationStorage.workspaceRecoveries!(connection)).map((edit) => edit.id).sort(),
  ).toEqual(['new', 'old'])
})
it('preserves a corrupt legacy document instead of replacing it with a new recovery', async () => {
  const legacy = await legacyPath()
  fs.files.set(legacy, 'corrupt')
  await expect(
    mobileMutationStorage.recoverWorkspaceEdit!(connection, edit('new')),
  ).rejects.toThrow(SyntaxError)
  expect(fs.files.get(legacy)).toBe('corrupt')
})

it('waits for asynchronous mutation writes before committing and allows clearing only after commit', async () => {
  let finish: () => void = () => {}
  fs.writeGate = new Promise((resolve) => {
    finish = resolve
  })
  const mutation = {
    id: 'queued-message',
    path: '/api/tasks/message',
    method: 'POST',
    input: { messageId: 'message' },
  } satisfies MutationOutbox[number]
  const pending = mobileMutationStorage.update(connection, () => [mutation])
  await vi.waitFor(() => expect(fs.writes).toHaveLength(1))
  expect(await mobileMutationStorage.read(connection)).toEqual([])
  const cleared = mobileMutationStorage.clear(connection)
  finish()
  expect(await pending).toEqual([mutation])
  await cleared
  expect(await mobileMutationStorage.read(connection)).toEqual([])
})

it('preserves the committed outbox on write failure and recovers on the next update', async () => {
  const mutation = {
    id: 'queued-message',
    path: '/api/tasks/message',
    method: 'POST',
    input: { messageId: 'message' },
  } satisfies MutationOutbox[number]
  await mobileMutationStorage.update(connection, () => [mutation])
  fs.failWrite = true
  await expect(
    mobileMutationStorage.update(connection, () => [{ ...mutation, id: 'new' }]),
  ).rejects.toThrow('Write interrupted')
  expect(await mobileMutationStorage.read(connection)).toEqual([mutation])
  fs.failWrite = false
  expect(
    await mobileMutationStorage.update(connection, (pending) => [
      ...pending,
      { ...mutation, id: 'new' },
    ]),
  ).toHaveLength(2)
})

it('retains legacy recoveries if an asynchronous migration write fails', async () => {
  const legacy = await legacyPath()
  fs.files.set(legacy, JSON.stringify({ edits: [edit('old')] }))
  fs.failWrite = true
  await expect(mobileMutationStorage.workspaceRecoveries!(connection)).rejects.toThrow(
    'Write interrupted',
  )
  expect(fs.files.has(legacy)).toBe(true)
  fs.failWrite = false
  expect(await mobileMutationStorage.workspaceRecoveries!(connection)).toEqual([edit('old')])
  expect(fs.files.has(legacy)).toBe(false)
})
