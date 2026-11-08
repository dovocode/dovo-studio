import { expect, it, vi } from 'vite-plus/test'
import {
  ingestSharedHandoffs,
  removeInboxEntry,
  restoreShortcutInbox,
  SHORTCUT_INBOX_STORAGE,
  type SharedDraft,
  type SharedHandoff,
} from './shared-inbox'

const handoff: SharedHandoff = {
  id: 'a74a35bf-a7de-49ad-a990-c039a2135d62',
  payloads: [
    { shareType: 'text', value: 'Review this screenshot' },
    {
      shareType: 'image',
      value: 'file:///native/screenshot.png',
      mimeType: 'image/png',
      name: 'Screenshot.png',
    },
  ],
}
const file = {
  id: '51d6c412-1b9a-4d6e-8d71-e027328c9106',
  uri: 'file:///documents/owned.png',
  name: 'Screenshot.png',
  mimeType: 'image/png',
}

it('owns files and persists editable text before acknowledging the native handoff', async () => {
  const order: string[] = []
  const result = await ingestSharedHandoffs([], [handoff], {
    ownFiles: async () => {
      order.push('copy')
      return [file]
    },
    save: async () => {
      order.push('save')
    },
    acknowledge: async () => {
      order.push('acknowledge')
    },
  })
  expect(order).toEqual(['copy', 'save', 'acknowledge'])
  expect(result).toEqual([
    expect.objectContaining({
      id: handoff.id,
      text: 'Review this screenshot',
      files: [file],
      source: 'share',
    }),
  ])
})

it('does not acknowledge native files when durable storage fails', async () => {
  const acknowledge = vi.fn<() => Promise<void>>()
  await expect(
    ingestSharedHandoffs([], [handoff], {
      ownFiles: async () => [file],
      save: async () => {
        throw new Error('disk full')
      },
      acknowledge,
    }),
  ).rejects.toThrow('disk full')
  expect(acknowledge).not.toHaveBeenCalled()
})

it('replays a crash between persistence and acknowledgment without duplicating a draft or its attachment IDs', async () => {
  let durable: SharedDraft[] = []
  const ownFiles = vi.fn<() => Promise<(typeof file)[]>>(async () => [file])
  const save = vi.fn<(items: SharedDraft[]) => Promise<void>>(async (items) => {
    durable = items
  })
  await expect(
    ingestSharedHandoffs<SharedDraft>([], [handoff], {
      ownFiles,
      save,
      acknowledge: async () => {
        throw new Error('process stopped')
      },
    }),
  ).rejects.toThrow('process stopped')
  const acknowledge = vi.fn<() => Promise<void>>(async () => undefined)
  expect(await ingestSharedHandoffs(durable, [handoff], { ownFiles, save, acknowledge })).toEqual(
    durable,
  )
  expect(ownFiles).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledTimes(1)
  expect(acknowledge).toHaveBeenCalledWith(handoff.id)
})

it('keeps two intentional shares of identical content separate and supports file-only drafts', async () => {
  const ownFiles = vi.fn<() => Promise<(typeof file)[]>>(async () => [file])
  const result = await ingestSharedHandoffs(
    [],
    [
      { ...handoff, payloads: handoff.payloads.slice(1) },
      {
        ...handoff,
        id: 'ec128114-58a4-4c7f-877e-8e59bbfcd24d',
        payloads: handoff.payloads.slice(1),
      },
    ],
    { ownFiles, save: async () => undefined, acknowledge: async () => undefined },
  )
  expect(result).toHaveLength(2)
  expect(result.map((entry) => entry.text)).toEqual(['', ''])
  expect(ownFiles).toHaveBeenCalledTimes(2)
})

it('persists a native rejection as a discardable inbox item without trying to read files', async () => {
  const ownFiles = vi.fn<() => Promise<(typeof file)[]>>(async () => [file])
  const result = await ingestSharedHandoffs(
    [],
    [{ ...handoff, payloads: [], error: 'Attach up to 5 files per message.' }],
    {
      ownFiles,
      save: async () => undefined,
      acknowledge: async () => undefined,
    },
  )
  expect(result[0]).toMatchObject({
    shareError: 'Attach up to 5 files per message.',
    files: [],
    text: '',
  })
  expect(ownFiles).not.toHaveBeenCalled()
})

it('keeps a saved draft and its files until native acknowledgment succeeds when consuming it', async () => {
  const saved = await ingestSharedHandoffs<SharedDraft>([], [handoff], {
    ownFiles: async () => [file],
    save: async () => undefined,
    acknowledge: async () => undefined,
  })
  const save = vi.fn<() => Promise<void>>(async () => undefined)
  const release = vi.fn<() => void>()
  await expect(
    removeInboxEntry(saved, handoff.id, {
      acknowledge: async () => {
        throw new Error('native busy')
      },
      save,
      release,
    }),
  ).rejects.toThrow('native busy')
  expect(save).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  const ownFiles = vi.fn<() => Promise<(typeof file)[]>>(async () => [file])
  expect(
    await ingestSharedHandoffs(saved, [handoff], {
      ownFiles,
      save,
      acknowledge: async () => undefined,
    }),
  ).toEqual(saved)
  expect(ownFiles).not.toHaveBeenCalled()
  expect(
    await removeInboxEntry(saved, handoff.id, {
      acknowledge: async () => undefined,
      save,
      release,
    }),
  ).toEqual([])
  expect(save).toHaveBeenCalledWith([])
  expect(release).toHaveBeenCalledWith(handoff.id)
})

it('archives damaged persisted inbox bytes and preserves recoverable files on later clean reads', async () => {
  for (const corrupt of ['{broken', JSON.stringify([{ id: 'valid' }, { unexpected: true }])]) {
    const storage = new Map([[SHORTCUT_INBOX_STORAGE, corrupt]])
    const cleanup = vi.fn<() => void>()
    const ports = {
      read: async (key: string) => storage.get(key) ?? null,
      write: async (key: string, value: string) => {
        storage.set(key, value)
      },
      decode: (entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string'
          ? { id: entry.id }
          : undefined,
      cleanup,
    }
    const restored = await restoreShortcutInbox(ports)
    expect(storage.get(`${SHORTCUT_INBOX_STORAGE}.recovery`)).toBe(corrupt)
    expect(await restoreShortcutInbox(ports)).toEqual(restored)
    expect(cleanup).not.toHaveBeenCalled()
  }
})

it('does not rewrite damaged storage when its recovery archive cannot be saved', async () => {
  const cleanup = vi.fn<() => void>()
  const write = vi.fn<(key: string, value: string) => Promise<void>>(async () => {
    throw new Error('disk full')
  })
  await expect(
    restoreShortcutInbox({
      read: async (key) => (key === SHORTCUT_INBOX_STORAGE ? '{broken' : null),
      write,
      decode: () => undefined,
      cleanup,
    }),
  ).rejects.toThrow('disk full')
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith(`${SHORTCUT_INBOX_STORAGE}.recovery`, '{broken')
  expect(cleanup).not.toHaveBeenCalled()
})

it('makes oversized text and unreadable files discardable without blocking later valid shares', async () => {
  const oversized = {
    ...handoff,
    payloads: [{ shareType: 'text' as const, value: 'x'.repeat(12001) }],
  }
  const unreadable = { ...handoff, id: 'f5de9966-32b4-4399-946b-845f574c8238' }
  const valid = { ...handoff, id: '86f4f639-9389-42cf-b6a9-a089be93f012' }
  const acknowledged: string[] = []
  const result = await ingestSharedHandoffs<SharedDraft>([], [oversized, unreadable, valid], {
    ownFiles: async (item) => {
      if (item.id === unreadable.id) throw new Error('Shared file is unreadable')
      return [file]
    },
    save: async () => undefined,
    acknowledge: async (id) => {
      acknowledged.push(id)
    },
  })
  expect(result).toHaveLength(3)
  expect(result[0]).toMatchObject({ shareError: expect.stringContaining('too long'), files: [] })
  expect(result[1]).toMatchObject({
    shareError: 'Shared file is unreadable',
    text: 'Review this screenshot',
    files: [],
  })
  expect(result[2]).toMatchObject({ files: [file] })
  expect(acknowledged).toEqual([valid.id])
  const remaining = await removeInboxEntry(result, unreadable.id, {
    acknowledge: async (id) => {
      acknowledged.push(id)
    },
    save: async () => undefined,
    release: () => undefined,
  })
  expect(remaining).toHaveLength(2)
  expect(acknowledged).toEqual([valid.id, unreadable.id])
})
