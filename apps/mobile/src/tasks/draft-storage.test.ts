import { describe, expect, it } from 'vite-plus/test'
import { createDraftStorage } from './draft-storage'

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function memoryStorage(values = new Map<string, string>()) {
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: async (key: string) => {
      values.delete(key)
    },
  }
}

describe('persistent draft ordering', () => {
  it('updates a reopened composer when the old screen acknowledges its send', async () => {
    const values = new Map([['runtime.task', 'Send this message']])
    const drafts = createDraftStorage(memoryStorage(values))
    let reopenedText = await drafts.read('runtime.task')
    const unsubscribe = drafts.subscribe('runtime.task', (value) => {
      reopenedText = value
    })
    const clearing = drafts.write('runtime.task', '')
    expect(reopenedText).toBe('')
    await clearing
    expect(await drafts.read('runtime.task')).toBe('')
    unsubscribe()
  })

  it('publishes draft changes only to the same computer/thread and releases unmounted listeners', async () => {
    const drafts = createDraftStorage(memoryStorage())
    const changes: string[] = []
    const unsubscribe = drafts.subscribe('runtime-a.task', (value) => changes.push(value))
    await drafts.write('runtime-b.task', 'Other computer')
    await drafts.write('runtime-a.other-task', 'Other task')
    expect(changes).toEqual([])
    await drafts.write('runtime-a.task', 'Current task')
    unsubscribe()
    await drafts.write('runtime-a.task', 'After unmount')
    expect(changes).toEqual(['Current task'])
  })

  it('reopens with the final transcript after the previous screen’s pending saves finish', async () => {
    const values = new Map<string, string>()
    const first = gate()
    const last = gate()
    const writes: string[] = []
    const drafts = createDraftStorage({
      ...memoryStorage(values),
      setItem: async (key, value) => {
        writes.push(value)
        await (value === 'partial' ? first.promise : last.promise)
        values.set(key, value)
      },
    })
    const partial = drafts.write('runtime-a.task', 'partial')
    const final = drafts.write('runtime-a.task', 'final transcript')
    const reopened = drafts.read('runtime-a.task')
    await Promise.resolve()
    expect(writes).toEqual(['partial'])
    first.resolve()
    await partial
    await Promise.resolve()
    expect(writes).toEqual(['partial', 'final transcript'])
    last.resolve()
    await final
    expect(await reopened).toBe('final transcript')
  })

  it('keeps devices independent while another device’s save is pending', async () => {
    const storage = memoryStorage()
    const slow = gate()
    const drafts = createDraftStorage({
      ...storage,
      setItem: async (key, value) => {
        if (key === 'runtime-a.task') await slow.promise
        await storage.setItem(key, value)
      },
    })
    const saving = drafts.write('runtime-a.task', 'First device')
    await drafts.write('runtime-b.task', 'Second device')
    expect(await drafts.read('runtime-b.task')).toBe('Second device')
    slow.resolve()
    await saving
    expect(await drafts.read('runtime-a.task')).toBe('First device')
  })

  it('reports a failed save and still accepts a later successful save', async () => {
    const storage = memoryStorage()
    const drafts = createDraftStorage({
      ...storage,
      setItem: async (key, value) => {
        if (value === 'failed') throw new Error('Disk unavailable')
        await storage.setItem(key, value)
      },
    })
    const failed = drafts.write('runtime.task', 'failed')
    const succeeded = drafts.write('runtime.task', 'Recovered text')
    await expect(failed).rejects.toThrow('Disk unavailable')
    await succeeded
    expect(await drafts.read('runtime.task')).toBe('Recovered text')
  })

  it('finishes legacy migration before later saves without resurrecting a cleared draft', async () => {
    const values = new Map([['legacy.task', 'Legacy text']])
    const drafts = createDraftStorage(memoryStorage(values))
    const loaded = drafts.read('runtime.task', 'legacy.task')
    const cleared = drafts.write('runtime.task', '')
    expect(await loaded).toBe('Legacy text')
    await cleared
    expect(values.has('legacy.task')).toBe(false)
    expect(await drafts.read('runtime.task', 'legacy.task')).toBe('')
  })

  it('preserves legacy text and reports migration errors when saving the new key fails', async () => {
    const values = new Map([['legacy.task', 'Legacy text']])
    const drafts = createDraftStorage({
      ...memoryStorage(values),
      setItem: async () => {
        throw new Error('Disk full')
      },
    })
    await expect(drafts.read('runtime.task', 'legacy.task')).rejects.toThrow('Disk full')
    expect(values.get('legacy.task')).toBe('Legacy text')
  })
})

it('keeps a native write serialized after its owning fiber is interrupted', async () => {
  const { Effect, Fiber } = await import('effect')
  const values = new Map<string, string>()
  const blocked = gate()
  const storage = memoryStorage(values)
  const writes: string[] = []
  const drafts = createDraftStorage({
    ...storage,
    setItem: async (key, value) => {
      writes.push(value)
      if (value === 'first') await blocked.promise
      await storage.setItem(key, value)
    },
  })
  const first = Effect.runFork(drafts.writeEffect('task', 'first'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const interrupted = Effect.runPromise(Fiber.interrupt(first))
  const second = drafts.write('task', 'second')
  expect(writes).toEqual(['first'])
  blocked.resolve()
  await interrupted
  await second
  expect(writes).toEqual(['first', 'second'])
  expect(await drafts.read('task')).toBe('second')
})
