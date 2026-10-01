import { describe, expect, it, vi } from 'vite-plus/test'
import { createDraftStorage } from './storage'

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
    await vi.waitFor(() => expect(writes).toEqual(['partial']))
    first.resolve()
    await partial
    await vi.waitFor(() => expect(writes).toEqual(['partial', 'final transcript']))
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

const submission = {
  id: 'sent-message',
  text: 'Send this message',
  attachmentIds: ['attachment'],
  mode: 'queue' as const,
}

it('persists delivery identity with the draft before sending and restores it after a process restart', async () => {
  const { Effect } = await import('effect')
  const { createSendAttempts } = await import('../composer/send-attempts')
  const values = new Map<string, string>()
  const storage = memoryStorage(values)
  const first = createDraftStorage(storage)
  await first.write('runtime.task', submission.text)
  await Effect.runPromise(first.stageEffect('runtime.task', submission, submission.text))
  const restarted = createDraftStorage(storage)
  const recovered = await Effect.runPromise(restarted.readRecordEffect('runtime.task'))
  expect(recovered).toEqual({
    text: submission.text,
    submission: { attempt: submission, accepted: false },
  })
  const attempts = createSendAttempts(() => 'new-id')
  const scope = { runtimeId: 'runtime', taskId: 'task' }
  if (!recovered?.submission) throw new Error('Submission was not saved')
  attempts.restore(scope, recovered.submission.attempt)
  expect(attempts.begin(scope, submission).id).toBe(submission.id)
  expect(
    attempts.reconcile(scope, { text: submission.text, attachmentIds: [] }, [submission.id]),
  ).toBe(true)
  await Effect.runPromise(restarted.confirmEffect('runtime.task', submission, true))
  expect(await createDraftStorage(storage).read('runtime.task')).toBe('')
})

it('keeps accepted message metadata and clearing together, even without a cached server snapshot', async () => {
  const { Effect } = await import('effect')
  const { createSendAttempts } = await import('../composer/send-attempts')
  const storage = memoryStorage()
  const drafts = createDraftStorage(storage)
  await drafts.write('runtime.task', submission.text)
  await Effect.runPromise(drafts.stageEffect('runtime.task', submission, submission.text))
  await Effect.runPromise(drafts.confirmEffect('runtime.task', submission, true))
  const saved = await Effect.runPromise(
    createDraftStorage(storage).readRecordEffect('runtime.task'),
  )
  expect(saved?.text).toBe('')
  expect(saved?.submission?.accepted).toBe(true)
  const attempts = createSendAttempts(() => 'new-id')
  const scope = { runtimeId: 'runtime', taskId: 'task' }
  attempts.restore(scope, submission, true)
  expect(attempts.reconcile(scope, { text: submission.text, attachmentIds: [] }, [])).toBe(true)
  // Deliberately composing the same message again is still a new submission.
  expect(attempts.begin(scope, submission).id).toBe('new-id')
})

it('preserves newer composer text and a newer send when an older acknowledgement arrives', async () => {
  const { Effect } = await import('effect')
  const storage = memoryStorage()
  const drafts = createDraftStorage(storage)
  await drafts.write('runtime.task', submission.text)
  await Effect.runPromise(drafts.stageEffect('runtime.task', submission, submission.text))
  await drafts.write('runtime.task', 'My next message')
  await Effect.runPromise(drafts.confirmEffect('runtime.task', submission, true))
  expect(await createDraftStorage(storage).read('runtime.task')).toBe('My next message')
  const next = { ...submission, id: 'next', text: 'My next message' }
  await Effect.runPromise(drafts.stageEffect('runtime.task', next, next.text))
  await Effect.runPromise(drafts.confirmEffect('runtime.task', submission, true))
  const saved = await Effect.runPromise(
    createDraftStorage(storage).readRecordEffect('runtime.task'),
  )
  expect(saved?.submission).toEqual({ attempt: next, accepted: false })
})

it('retains an accepted clear in memory after a disk failure and flushes it on the next lifecycle save', async () => {
  const { Effect } = await import('effect')
  const values = new Map<string, string>()
  const base = memoryStorage(values)
  let fail = false
  const storage = {
    ...base,
    setItem: async (key: string, value: string) => {
      if (fail) throw new Error('Disk unavailable')
      await base.setItem(key, value)
    },
  }
  const drafts = createDraftStorage(storage)
  await drafts.write('runtime.task', submission.text)
  await Effect.runPromise(drafts.stageEffect('runtime.task', submission, submission.text))
  fail = true
  await expect(
    Effect.runPromise(drafts.confirmEffect('runtime.task', submission, true)),
  ).rejects.toThrow('Disk unavailable')
  expect(await drafts.read('runtime.task')).toBe('')
  // The durable pre-send record lets the next process reconcile a lost acknowledgement.
  expect(
    (await Effect.runPromise(createDraftStorage(storage).readRecordEffect('runtime.task')))
      ?.submission?.attempt.id,
  ).toBe(submission.id)
  fail = false
  await Effect.runPromise(drafts.flushEffect())
  expect(await createDraftStorage(storage).read('runtime.task')).toBe('')
})

it('reconciles a lost send acknowledgement before exposing its saved text', async () => {
  const { Effect } = await import('effect')
  const storage = memoryStorage()
  const first = createDraftStorage(storage)
  await first.write('runtime.task', submission.text)
  await Effect.runPromise(first.stageEffect('runtime.task', submission, submission.text))
  const reopened = createDraftStorage(storage)
  const record = await Effect.runPromise(
    reopened.readRecordEffect('runtime.task', undefined, [submission.id]),
  )
  expect(record?.text).toBe('')
  expect(record?.submission?.accepted).toBe(true)
  await Effect.runPromise(reopened.flushEffect())
  expect(await createDraftStorage(storage).read('runtime.task')).toBe('')
})
it('keeps an intentional identical follow-up after a previously accepted send', async () => {
  const { Effect } = await import('effect')
  const storage = memoryStorage()
  const drafts = createDraftStorage(storage)
  await drafts.write('runtime.task', submission.text)
  await Effect.runPromise(drafts.stageEffect('runtime.task', submission, submission.text))
  await Effect.runPromise(drafts.confirmEffect('runtime.task', submission, true))
  await drafts.write('runtime.task', submission.text)
  const record = await Effect.runPromise(
    createDraftStorage(storage).readRecordEffect('runtime.task', undefined, [submission.id]),
  )
  expect(record?.text).toBe(submission.text)
  expect(record?.submission).toBeUndefined()
})
