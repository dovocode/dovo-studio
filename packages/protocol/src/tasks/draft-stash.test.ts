import { describe, expect, it } from 'vite-plus/test'
import { createDraftStash, draftStashScope, restoreStashedText } from './draft-stash.js'

function fixture() {
  const data = new Map<string, string>()
  const storage = {
    getAllKeys: async () => [...data.keys()],
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: async (key: string) => {
      data.delete(key)
    },
  }
  return { data, storage, stash: createDraftStash(storage) }
}
describe('draft stash', () => {
  it('isolates computers and thread IDs, including prefix-like IDs', async () => {
    const { stash } = fixture()
    const a = draftStashScope('work', 'a.b')
    const b = draftStashScope('work.a', 'b')
    const c = draftStashScope('personal', 'a.b')
    await stash.save(a, { id: 'one', text: 'Work', createdAt: 1 })
    await stash.save(b, { id: 'two', text: 'Other thread', createdAt: 2 })
    await stash.save(c, { id: 'three', text: 'Personal', createdAt: 3 })
    expect((await stash.list(a)).map((entry) => entry.text)).toEqual(['Work'])
    expect((await stash.list(b)).map((entry) => entry.text)).toEqual(['Other thread'])
    expect((await stash.list(c)).map((entry) => entry.text)).toEqual(['Personal'])
  })
  it('retains independent concurrent saves and survives recreating the store', async () => {
    const { stash, storage } = fixture()
    const scope = draftStashScope('runtime', 'task')
    await Promise.all([
      stash.save(scope, { id: 'one', text: 'First', createdAt: 1 }),
      createDraftStash(storage).save(scope, { id: 'two', text: 'Second', createdAt: 2 }),
    ])
    expect((await createDraftStash(storage).list(scope)).map((entry) => entry.id)).toEqual([
      'two',
      'one',
    ])
    await stash.remove(scope, 'two')
    expect((await stash.list(scope)).map((entry) => entry.id)).toEqual(['one'])
  })
  it('reports corrupt data without deleting or replacing it', async () => {
    const { data, stash } = fixture()
    const scope = draftStashScope('runtime', 'task')
    data.set(scope + 'bad', '{broken')
    await expect(stash.list(scope)).rejects.toThrow(/JSON/)
    await expect(
      stash.save(scope, { id: 'bad', text: 'Replacement', createdAt: 1 }),
    ).rejects.toThrow('already exists')
    expect(data.get(scope + 'bad')).toBe('{broken')
  })
  it('propagates a failed durable write so the composer can retain its text', async () => {
    const { storage } = fixture()
    const stash = createDraftStash({
      ...storage,
      setItem: async () => {
        throw new Error('Storage full')
      },
    })
    await expect(
      stash.save(draftStashScope('runtime', 'task'), { id: 'one', text: 'Keep me', createdAt: 1 }),
    ).rejects.toThrow('Storage full')
  })
  it('never overwrites nonempty text when restoring and rejects empty or oversized saves', async () => {
    expect(restoreStashedText('My new draft', 'Previous draft')).toBe(
      'My new draft\n\nPrevious draft',
    )
    expect(restoreStashedText('', 'Previous draft')).toBe('Previous draft')
    const { stash } = fixture()
    await expect(stash.save('scope.', { id: 'empty', text: ' ', createdAt: 1 })).rejects.toThrow(
      'Write a prompt',
    )
    await expect(
      stash.save('scope.', { id: 'large', text: 'a'.repeat(100_001), createdAt: 1 }),
    ).rejects.toThrow('100,000 characters')
  })
})
