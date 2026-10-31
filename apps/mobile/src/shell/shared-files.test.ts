import { beforeEach, expect, it, vi } from 'vite-plus/test'

const native = vi.hoisted(() => ({ payload: '[]' }))
const fs = vi.hoisted(() => {
  const files = new Map<string, number>()
  const control: { pause?: Promise<void> } = {}
  const directories = new Set<string>(['file:///documents'])
  const path = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/')
  class Directory {
    uri: string
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts)
    }
    get exists() {
      return directories.has(this.uri)
    }
    get name() {
      return this.uri.split('/').at(-1)!
    }
    create() {
      directories.add(this.uri)
      directories.add(this.uri.slice(0, this.uri.lastIndexOf('/')))
    }
    delete() {
      for (const uri of files.keys()) if (uri.startsWith(`${this.uri}/`)) files.delete(uri)
      for (const uri of directories)
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) directories.delete(uri)
    }
    list(): (Directory | File)[] {
      const direct = (uri: string) =>
        uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/')
      return [
        ...[...directories].filter(direct).map((uri) => new Directory(uri)),
        ...[...files.keys()].filter(direct).map((uri) => new File(uri)),
      ]
    }
  }
  class File {
    uri: string
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts)
    }
    get exists() {
      return files.has(this.uri)
    }
    get size() {
      return files.get(this.uri) ?? 0
    }
    get name() {
      return this.uri.split('/').at(-1)!
    }
    async copy(destination: File) {
      await control.pause
      files.set(destination.uri, this.size)
    }
  }
  return { files, directories, Directory, File, control }
})
vi.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    pending: async () => native.payload,
    acknowledge: async () => undefined,
  }),
}))
vi.mock('expo-file-system', () => ({
  Directory: fs.Directory,
  File: fs.File,
  Paths: { document: 'file:///documents' },
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => '969f3a71-6c7e-49dc-a208-f6e59c1dfb03' }))
import {
  ownSharedFiles,
  cleanupSharedFiles,
  releaseSharedFiles,
  pendingSharedHandoffs,
} from './shared-files'
import {
  SHARED_DRAFT_BUDGET,
  ingestSharedHandoffs,
  removeInboxEntry,
  type SharedDraft,
} from './shared-inbox'
const id = '3da85949-9bb7-44b1-b720-7f7ac5553d28'
const handoff = {
  id,
  payloads: [
    {
      shareType: 'image' as const,
      value: 'file:///native/image',
      name: 'Screenshot.png',
      mimeType: 'image/png',
    },
  ],
}

beforeEach(() => {
  native.payload = '[]'
  fs.control.pause = undefined
  fs.files.clear()
  fs.directories.clear()
  fs.directories.add('file:///documents')
})
it('copies native file URIs into document storage with independent attachment identity and preserves metadata', async () => {
  fs.files.set('file:///native/image', 20)
  const files = await ownSharedFiles(handoff)
  expect(files).toEqual([
    {
      id: '969f3a71-6c7e-49dc-a208-f6e59c1dfb03',
      uri: `file:///documents/shared-drafts/${id}/0.png`,
      name: 'Screenshot.png',
      mimeType: 'image/png',
    },
  ])
  expect(fs.files.get(files[0]!.uri)).toBe(20)
  expect(fs.files.get('file:///native/image')).toBe(20)
})
it('enforces the total 50 MiB budget across saved drafts and removes partial copies on failure', async () => {
  const previous = 'file:///documents/shared-drafts/previous'
  fs.directories.add('file:///documents/shared-drafts')
  fs.directories.add(previous)
  fs.files.set(`${previous}/file`, SHARED_DRAFT_BUDGET - 10)
  fs.files.set('file:///native/image', 11)
  await expect(ownSharedFiles(handoff)).rejects.toThrow('50 MB')
  expect(fs.directories.has(`file:///documents/shared-drafts/${id}`)).toBe(false)
  expect(fs.files.get(`${previous}/file`)).toBe(SHARED_DRAFT_BUDGET - 10)
})
it('replaces an interrupted copy before retrying and cleans only files whose inbox item was consumed', async () => {
  fs.directories.add('file:///documents/shared-drafts')
  fs.directories.add(`file:///documents/shared-drafts/${id}`)
  fs.files.set(`file:///documents/shared-drafts/${id}/partial`, SHARED_DRAFT_BUDGET)
  fs.files.set('file:///native/image', 20)
  const files = await ownSharedFiles(handoff)
  cleanupSharedFiles([id])
  expect(fs.files.has(files[0]!.uri)).toBe(true)
  releaseSharedFiles(id)
  expect(fs.files.has(files[0]!.uri)).toBe(false)
  expect(fs.files.has('file:///native/image')).toBe(true)
})
it('rejects provider/network addresses and missing sources without acknowledging them', async () => {
  await expect(
    ownSharedFiles({
      ...handoff,
      payloads: [{ ...handoff.payloads[0]!, value: 'http://example.test/a.png' }],
    }),
  ).rejects.toThrow('locally')
  await expect(ownSharedFiles(handoff)).rejects.toThrow('no longer available')
  expect(() => releaseSharedFiles('../outside')).toThrow('Expected a string matching')
})

it('waits for the document copy to finish before transferring ownership to the durable draft', async () => {
  fs.files.set('file:///native/image', 20)
  let finish!: () => void
  fs.control.pause = new Promise<void>((resolve) => {
    finish = resolve
  })
  let completed = false
  const pending = ownSharedFiles(handoff).then((files) => {
    completed = true
    return files
  })
  await Promise.resolve()
  expect(completed).toBe(false)
  finish()
  const files = await pending
  expect(fs.files.get(files[0]!.uri)).toBe(20)
})

it('isolates corrupt manifest UUIDs, payload types, and JSON beside healthy handoffs using native directory identity', async () => {
  const healthyId = '240d0c31-bb0b-488d-be22-8da878cd9643'
  const healthy = { id: healthyId, payloads: [{ shareType: 'text', value: 'Valid next share' }] }
  for (const manifest of [
    JSON.stringify({ id: '../outside', payloads: [] }),
    JSON.stringify({ id, payloads: [{ shareType: 'unsupported', value: 'anything' }] }),
    '{broken JSON',
    JSON.stringify({ ...healthy, id: 'ce8764ec-cf88-45a9-9b8b-23c1d828a5fd' }),
  ]) {
    native.payload = JSON.stringify([
      { id, manifest },
      { id: healthyId, manifest: JSON.stringify(healthy) },
    ])
    const original = native.payload
    const pending = await pendingSharedHandoffs()
    expect(pending).toEqual([
      { id, payloads: [], error: expect.stringContaining('damaged') },
      healthy,
    ])
    expect(pending[0]!.error!.length).toBeLessThan(200)
    const acknowledged: string[] = []
    const drafts = await ingestSharedHandoffs<SharedDraft>([], pending, {
      ownFiles: ownSharedFiles,
      save: async () => undefined,
      acknowledge: async (shareId) => {
        acknowledged.push(shareId)
      },
    })
    expect(drafts).toHaveLength(2)
    expect(acknowledged).toEqual([healthyId])
    expect(native.payload).toBe(original)
    await removeInboxEntry(drafts, id, {
      acknowledge: async (shareId) => {
        acknowledged.push(shareId)
      },
      save: async () => undefined,
      release: releaseSharedFiles,
    })
    expect(acknowledged).toEqual([healthyId, id])
  }
})

it('exposes an unreadable native manifest as a discardable error without blocking the next handoff', async () => {
  const healthyId = '240d0c31-bb0b-488d-be22-8da878cd9643'
  const healthy = { id: healthyId, payloads: [{ shareType: 'text', value: 'Still readable' }] }
  native.payload = JSON.stringify([
    { id, error: 'Native manifest could not be read' },
    { id: healthyId, manifest: JSON.stringify(healthy) },
  ])
  expect(await pendingSharedHandoffs()).toEqual([
    { id, payloads: [], error: expect.stringContaining('damaged') },
    healthy,
  ])
})
