import { DurableState } from '@dovo/durable-connections'
import { afterEach, expect, it, vi } from 'vite-plus/test'

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failRotation: false,
  failCommit: false,
}))
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string
    constructor(parent: string, name: string) {
      this.uri = `${parent}/${name}`
    }
    create() {}
  }
  class File {
    uri: string
    constructor(directory: Directory, name: string) {
      this.uri = `${directory.uri}/${name}`
    }
    get exists() {
      return disk.files.has(this.uri)
    }
    async text() {
      const value = disk.files.get(this.uri)
      if (value === undefined) throw new Error('File missing')
      return value
    }
    write(value: string) {
      disk.files.set(this.uri, value)
    }
    move(target: File, options: { overwrite?: boolean } = {}) {
      if (!options.overwrite && target.exists) throw new Error('Target exists')
      // Match Expo: overwrite deletes the old target before a potentially failing move.
      if (options.overwrite) disk.files.delete(target.uri)
      if (this.uri.endsWith('.tmp') ? disk.failCommit : disk.failRotation)
        throw new Error('Interrupted rename')
      const value = disk.files.get(this.uri)
      if (value === undefined) throw new Error('Temporary file missing')
      disk.files.set(target.uri, value)
      disk.files.delete(this.uri)
      this.uri = target.uri
    }
  }
  return { Directory, File, Paths: { document: 'app-private' } }
})
import { mobileSharedStateStorage } from './shared-state-storage'

afterEach(() => {
  disk.files.clear()
  disk.failRotation = false
  disk.failCommit = false
})
const open = () =>
  DurableState.openPersisted({
    storage: mobileSharedStateStorage,
    channel: 'native-test',
    createReplicaId: () => 'mobile',
    decode: (value) => {
      if (typeof value !== 'string') throw new Error('Expected string')
      return value
    },
    now: () => 100,
  })

it('serializes native owners and reloads their full committed journal with the same identity', async () => {
  const [a, b] = await Promise.all([open(), open()])
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      (index % 2 ? a : b).set(`key-${index}`, String(index)),
    ),
  )
  await a.refresh()
  await b.refresh()
  expect(a.latest()).toEqual(b.latest())
  expect(a.revision).toBe(10)
  expect(new Set(a.versions().map((entry) => entry.changeId)).size).toBe(10)
  const reopened = await open()
  expect(reopened.replicaId).toBe(a.replicaId)
  expect(reopened.latest()).toEqual(a.latest())
  expect([...disk.files.keys()].sort()).toEqual([
    'app-private/durable-state/shared-settings.v1.backup.json',
    'app-private/durable-state/shared-settings.v1.json',
  ])
})

it.each(['failRotation', 'failCommit'] as const)(
  'retains the committed native journal during %s and safely retries',
  async (stage) => {
    const state = await open()
    await state.set('draft', 'saved')
    disk[stage] = true
    await expect(state.set('draft', 'pending')).rejects.toThrow('Interrupted rename')
    expect(state.get('draft')).toBe('saved')
    expect(state.history('draft')).toHaveLength(1)
    expect(disk.files.has('app-private/durable-state/shared-settings.v1.json')).toBe(
      stage === 'failRotation',
    )
    // A leftover temporary file never becomes authoritative after restart.
    expect((await open()).get('draft')).toBe('saved')
    disk[stage] = false
    await state.set('draft', 'pending')
    const reopened = await open()
    expect(reopened.get('draft')).toBe('pending')
    expect(reopened.history('draft')).toHaveLength(2)
  },
)
