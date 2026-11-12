import { expect, test, vi } from 'vite-plus/test'
import { createQuestionRecovery, runtimeRecoveryScope } from './question-recovery'
import type { PendingQuestion } from './questions'
const request: PendingQuestion = {
  id: 'request',
  taskId: 'thread',
  createdAt: '',
  prompt: {
    title: 'Review',
    questions: [
      {
        id: 'ordinary',
        header: '',
        question: 'Choose',
        options: [],
        multiple: true,
        custom: true,
        secret: false,
        required: true,
        inputType: 'text',
      },
      {
        id: 'secret',
        header: '',
        question: 'Password',
        options: [],
        multiple: false,
        custom: true,
        secret: true,
        required: true,
        inputType: 'text',
      },
    ],
  },
}
const drafts = {
  ordinary: { selected: ['a', 'b'], text: 'Keep exact\norder' },
  secret: { selected: [], text: 'NEVER STORE THIS' },
}
function storage() {
  const data = new Map<string, string>()
  return {
    data,
    getAllKeys: () => [...data.keys()],
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}
test('restores choices, text and attachment metadata without plaintext secrets', async () => {
  const disk = storage()
  const store = createQuestionRecovery(disk)
  await store.load('runtime')
  const file = {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'review.txt',
    mime: 'text/plain',
    size: 3,
  }
  store.update('runtime', request, drafts, { ordinary: [file], secret: [file] })
  expect([...disk.data.values()].join()).not.toContain('NEVER STORE THIS')
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts).toEqual({ ordinary: drafts.ordinary })
  expect(reopened.entries('runtime')[0].files).toEqual({ ordinary: [file] })
  // Request disappearance does not delete the recovery record.
  expect(reopened.entries('runtime')[0].request.id).toBe('request')
  reopened.remove('runtime', 'thread', 'request')
  expect(reopened.entries('runtime')).toEqual([])
})
test('edits and confirmed answers during storage loading win over saved data', async () => {
  const disk = storage()
  const first = createQuestionRecovery(disk)
  await first.load('runtime')
  first.update('runtime', request, drafts)
  let resolve!: (value: string | null) => void
  const store = createQuestionRecovery({
    ...disk,
    getItem: (key) =>
      key.includes('.v2.')
        ? disk.getItem(key)
        : new Promise<string | null>((done) => {
            resolve = done
          }),
  })
  const loading = store.load('runtime')
  await Promise.resolve()
  store.remove('runtime', 'thread', 'request')
  resolve(JSON.stringify(first.entries('runtime')))
  await loading
  expect(store.entries('runtime')).toEqual([])
})
test('retains in-memory answers and reports failed storage without destroying saved data', async () => {
  const store = createQuestionRecovery({
    getAllKeys: () => [],
    getItem: () => null,
    setItem: () => {
      throw new Error('quota')
    },
  })
  await store.load('runtime')
  store.update('runtime', request, drafts)
  expect(store.entries('runtime')[0].drafts.ordinary).toEqual(drafts.ordinary)
  expect(store.error('runtime')).toContain('quota')
})
test('isolates runtimes, credentials and threads', async () => {
  const a = runtimeRecoveryScope({ address: 'http://lan:3000', token: 'a' })
  const b = runtimeRecoveryScope({ address: 'http://lan:3000', token: 'b' })
  expect(a).not.toBe(b)
  expect(a).not.toContain('http')
  const store = createQuestionRecovery(storage())
  await store.load(a)
  await store.load(b)
  store.update(a, request, drafts)
  store.update(a, { ...request, taskId: 'other' }, { ordinary: { selected: [], text: 'Other' } })
  expect(store.entries(b)).toEqual([])
  expect(store.entries(a)).toHaveLength(2)
})
test('does not overwrite malformed saved answers', async () => {
  const setItem = vi.fn<(key: string, value: string) => void>()
  const store = createQuestionRecovery({ getAllKeys: () => [], getItem: () => '{broken', setItem })
  await store.load('runtime')
  store.update('runtime', request, drafts)
  expect(store.error('runtime')).toContain('preserved')
  expect(setItem).not.toHaveBeenCalled()
})

test('orders asynchronous mobile writes and keeps edits made during restoration', async () => {
  const disk = storage()
  const first = createQuestionRecovery(disk)
  await first.load('runtime')
  first.update('runtime', request, drafts)
  const store = createQuestionRecovery({
    getAllKeys: disk.getAllKeys,
    getItem: async (key) => {
      await Promise.resolve()
      return disk.getItem(key)
    },
    setItem: async (key, value) => {
      await Promise.resolve()
      disk.setItem(key, value)
    },
  })
  const loading = store.load('runtime')
  store.update('runtime', request, { ordinary: { selected: [], text: 'Edited before restore' } })
  await loading
  expect(store.entries('runtime')[0].drafts.ordinary.text).toBe('Edited before restore')
  store.update('runtime', request, { ordinary: { selected: ['a'], text: 'Last edit' } })
  await vi.waitFor(() => expect([...disk.data.values()].join()).toContain('Last edit'))
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts.ordinary).toEqual({
    selected: ['a'],
    text: 'Last edit',
  })
})

test('keeps runtime identity across LAN and VPN address changes', () => {
  const connection = { address: 'http://lan:3000', token: 'credential', runtimeId: 'runtime' }
  expect(runtimeRecoveryScope(connection)).toBe(
    runtimeRecoveryScope({ ...connection, address: 'http://vpn:3000' }),
  )
  expect(runtimeRecoveryScope(connection)).not.toBe(
    runtimeRecoveryScope({ ...connection, token: 'replacement' }),
  )
})

test('retries a transient read failure without overwriting unread records or newer edits', async () => {
  const disk = storage()
  const original = createQuestionRecovery(disk)
  await original.load('runtime')
  original.update('runtime', request, drafts)
  original.update(
    'runtime',
    { ...request, id: 'untouched' },
    { ordinary: { selected: ['b'], text: 'Unread saved answer' } },
  )
  const before = [...disk.data.values()][0]
  let fail = true
  const setItem = vi.fn<(key: string, value: string) => void>(disk.setItem)
  const store = createQuestionRecovery({
    getAllKeys: disk.getAllKeys,
    getItem: async (key) => {
      if (fail) throw new Error('Temporary read failure')
      return disk.getItem(key)
    },
    setItem,
  })
  await store.load('runtime')
  store.update('runtime', request, { ordinary: { selected: ['a'], text: 'Newer offline edit' } })
  expect(store.error('runtime')).toContain('Temporary read failure')
  expect(setItem).not.toHaveBeenCalled()
  expect([...disk.data.values()][0]).toBe(before)
  fail = false
  await store.retry('runtime')
  expect(store.error('runtime')).toBe('')
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(
    reopened.entries('runtime').find((entry) => entry.request.id === 'request')?.drafts.ordinary
      .text,
  ).toBe('Newer offline edit')
  expect(
    reopened.entries('runtime').find((entry) => entry.request.id === 'untouched')?.drafts.ordinary
      .text,
  ).toBe('Unread saved answer')
  store.update('runtime', request, { ordinary: { selected: [], text: 'Edits now save' } })
  expect([...disk.data.values()].join()).toContain('Edits now save')
})

test.each(['answer', 'discard'])(
  '%s while a retry read is pending does not resurrect saved answers',
  async () => {
    const disk = storage()
    const original = createQuestionRecovery(disk)
    await original.load('runtime')
    original.update('runtime', request, drafts)
    original.update('runtime', { ...request, taskId: 'other-thread' }, drafts)
    let rejectRead = true
    let finish!: (raw: string | null) => void
    const store = createQuestionRecovery({
      ...disk,
      getItem: (key) =>
        key.includes('.v2.')
          ? disk.getItem(key)
          : rejectRead
            ? Promise.reject(new Error('Read interrupted'))
            : new Promise<string | null>((resolve) => {
                finish = resolve
              }),
    })
    await store.load('runtime')
    rejectRead = false
    const retry = store.retry('runtime')
    await Promise.resolve()
    store.remove('runtime', 'thread', 'request')
    finish(JSON.stringify(original.entries('runtime')))
    await retry
    expect(store.entries('runtime').map((entry) => entry.request.taskId)).toEqual(['other-thread'])
    const reopened = createQuestionRecovery(disk)
    await reopened.load('runtime')
    expect(reopened.entries('runtime').map((entry) => entry.request.taskId)).toEqual([
      'other-thread',
    ])
  },
)

test('explicit retry saves retained memory after a write failure', async () => {
  const disk = storage()
  let fail = false
  const store = createQuestionRecovery({
    ...disk,
    setItem: (key, value) => {
      if (fail) throw new Error('Quota')
      disk.setItem(key, value)
    },
  })
  await store.load('runtime')
  fail = true
  store.update('runtime', request, drafts)
  expect(store.error('runtime')).toContain('Quota')
  fail = false
  await store.retry('runtime')
  expect(store.error('runtime')).toBe('')
  expect([...disk.data.values()][0]).toContain('Keep exact')
})

test('retry preserves unread fields when an attachment or another answer changed', async () => {
  const disk = storage()
  const twoQuestions = {
    ...request,
    prompt: {
      ...request.prompt,
      questions: [request.prompt.questions[0], { ...request.prompt.questions[0], id: 'second' }],
    },
  }
  const original = createQuestionRecovery(disk)
  await original.load('runtime')
  original.update('runtime', twoQuestions, {
    ordinary: drafts.ordinary,
    second: { selected: [], text: 'Unread second answer' },
  })
  let fail = true
  const store = createQuestionRecovery({
    ...disk,
    getItem: (key) => {
      if (fail) throw Error('Read failed')
      return disk.getItem(key)
    },
  })
  await store.load('runtime')
  const file = {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'review.txt',
    mime: 'text/plain',
    size: 3,
  }
  store.update('runtime', twoQuestions, undefined, { ordinary: [file] })
  store.update('runtime', twoQuestions, {
    ordinary: { selected: [], text: 'New answer' },
    second: { selected: [], text: '' },
  })
  fail = false
  await store.retry('runtime')
  expect(store.entries('runtime')[0].drafts).toEqual({
    ordinary: { selected: [], text: 'New answer' },
    second: { selected: [], text: 'Unread second answer' },
  })
  expect(store.entries('runtime')[0].files).toEqual({ ordinary: [file] })
})

test('independent windows never overwrite another request or resurrect a discarded answer', async () => {
  const disk = storage()
  const a = createQuestionRecovery(disk)
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.update('runtime', request, { ordinary: { selected: [], text: 'Window A' } })
  b.update(
    'runtime',
    { ...request, id: 'request-b', taskId: 'thread-b' },
    { ordinary: { selected: [], text: 'Window B' } },
  )
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(
    reopened
      .entries('runtime')
      .map((entry) => entry.drafts.ordinary.text)
      .sort(),
  ).toEqual(['Window A', 'Window B'])
  a.remove('runtime', 'thread', 'request')
  b.update(
    'runtime',
    { ...request, id: 'request-b', taskId: 'thread-b' },
    { ordinary: { selected: [], text: 'B after A discard' } },
  )
  await a.retry('runtime')
  const afterDiscard = createQuestionRecovery(disk)
  await afterDiscard.load('runtime')
  expect(afterDiscard.entries('runtime').map((entry) => entry.drafts.ordinary.text)).toEqual([
    'B after A discard',
  ])
  b.remove('runtime', 'thread-b', 'request-b')
  a.update(
    'runtime',
    { ...request, id: 'request-c' },
    { ordinary: { selected: [], text: 'Pending C' } },
  )
  const afterAnswer = createQuestionRecovery(disk)
  await afterAnswer.load('runtime')
  expect(afterAnswer.entries('runtime').map((entry) => entry.drafts.ordinary.text)).toEqual([
    'Pending C',
  ])
})

test('stale loaded snapshots are read-only while another window edits or removes requests', async () => {
  const disk = storage()
  const seed = createQuestionRecovery(disk)
  await seed.load('runtime')
  seed.update('runtime', request, drafts)
  seed.update('runtime', { ...request, id: 'request-b' }, drafts)
  const a = createQuestionRecovery(disk)
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.remove('runtime', 'thread', 'request')
  b.update(
    'runtime',
    { ...request, id: 'request-b' },
    { ordinary: { selected: [], text: 'Only B' } },
  )
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime').map((entry) => entry.request.id)).toEqual(['request-b'])
})

test('concurrent asynchronous stores write independent request keys', async () => {
  const disk = storage()
  const adapter = {
    ...disk,
    setItem: async (key: string, value: string) => {
      await Promise.resolve()
      disk.setItem(key, value)
    },
  }
  const a = createQuestionRecovery(adapter)
  const b = createQuestionRecovery(adapter)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.update('runtime', request, drafts)
  b.update('runtime', { ...request, id: 'request-b' }, drafts)
  await vi.waitFor(() => expect(disk.data.size).toBe(2))
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')).toHaveLength(2)
})

test('legacy scope snapshots remain intact and request tombstones prevent migration resurrection', async () => {
  const disk = storage()
  const legacy = JSON.stringify([{ request, drafts: { ordinary: drafts.ordinary }, files: {} }])
  disk.setItem('dovo.question-recovery.v1.runtime', legacy)
  const a = createQuestionRecovery(disk)
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.remove('runtime', 'thread', 'request')
  b.update('runtime', { ...request, id: 'request-b' }, drafts)
  expect(disk.getItem('dovo.question-recovery.v1.runtime')).toBe(legacy)
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime').map((entry) => entry.request.id)).toEqual(['request-b'])
})

test('retrying one window pending unsent work preserves another window record', async () => {
  const disk = storage()
  let fail = true
  const a = createQuestionRecovery({
    ...disk,
    setItem: (key, value) => {
      if (fail) throw Error('Storage unavailable')
      disk.setItem(key, value)
    },
  })
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.update('runtime', request, { ordinary: { selected: [], text: 'Pending A' } })
  expect(a.error('runtime')).toContain('Storage unavailable')
  b.update(
    'runtime',
    { ...request, id: 'request-b' },
    { ordinary: { selected: [], text: 'Durable B' } },
  )
  fail = false
  await a.retry('runtime')
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(
    reopened
      .entries('runtime')
      .map((entry) => entry.drafts.ordinary.text)
      .sort(),
  ).toEqual(['Durable B', 'Pending A'])
})

test('a removal follows its pending asynchronous write without affecting other windows', async () => {
  const disk = storage()
  const adapter = {
    ...disk,
    setItem: async (key: string, value: string) => {
      await Promise.resolve()
      disk.setItem(key, value)
    },
  }
  const a = createQuestionRecovery(adapter)
  const b = createQuestionRecovery(adapter)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  a.update('runtime', request, drafts)
  a.remove('runtime', 'thread', 'request')
  b.update('runtime', { ...request, id: 'request-b' }, drafts)
  await vi.waitFor(() =>
    expect(
      [...disk.data.values()].some((raw) => {
        const value = JSON.parse(raw)
        return value.requestId === 'request' && value.entry === null
      }),
    ).toBe(true),
  )
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime').map((entry) => entry.request.id)).toEqual(['request-b'])
})

test.each(['Newer answer', 'Submitted answer'])(
  'a stale confirmed answer preserves another window revision: %s',
  async (text) => {
    const disk = storage()
    const a = createQuestionRecovery(disk)
    await a.load('runtime')
    a.update('runtime', request, { ordinary: { selected: [], text: 'Submitted answer' } })
    const submitted = a.entries('runtime')[0]
    const b = createQuestionRecovery(disk)
    await b.load('runtime')
    b.update('runtime', request, { ordinary: { selected: [], text } })
    a.remove('runtime', 'thread', 'request', submitted)
    const reopened = createQuestionRecovery(disk)
    await reopened.load('runtime')
    expect(reopened.entries('runtime')[0].drafts.ordinary.text).toBe(text)
  },
)

test('a confirmed answer hides its submitted revision without hiding a subsequent edit', async () => {
  const disk = storage()
  const a = createQuestionRecovery(disk)
  await a.load('runtime')
  a.update('runtime', request, drafts)
  const submitted = a.entries('runtime')[0]
  a.remove('runtime', 'thread', 'request', submitted)
  const answered = createQuestionRecovery(disk)
  await answered.load('runtime')
  expect(answered.entries('runtime')).toEqual([])
  a.update('runtime', request, drafts)
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts.ordinary).toEqual(drafts.ordinary)
})

test('a confirmed answer with no submitted local record does not erase another window draft', async () => {
  const disk = storage()
  const a = createQuestionRecovery(disk)
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  b.update('runtime', request, drafts)
  a.remove('runtime', 'thread', 'request', null)
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts.ordinary).toEqual(drafts.ordinary)
})

test('legacy submitted revisions can be consumed without erasing a new identical revision', async () => {
  const disk = storage()
  disk.setItem(
    'dovo.question-recovery.v1.runtime',
    JSON.stringify([{ request, drafts: { ordinary: drafts.ordinary }, files: {} }]),
  )
  const a = createQuestionRecovery(disk)
  const b = createQuestionRecovery(disk)
  await Promise.all([a.load('runtime'), b.load('runtime')])
  const submitted = a.entries('runtime')[0]
  b.update('runtime', request, { ordinary: drafts.ordinary })
  a.remove('runtime', 'thread', 'request', submitted)
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts.ordinary).toEqual(drafts.ordinary)
})

test('a delayed asynchronous answer marker cannot overwrite newer persisted typing', async () => {
  const disk = storage()
  let finish!: () => void
  const a = createQuestionRecovery({
    ...disk,
    setItem: (key, value) => {
      if (key.includes('.answered.'))
        return new Promise<void>((resolve) => {
          finish = () => {
            disk.setItem(key, value)
            resolve()
          }
        })
      disk.setItem(key, value)
    },
  })
  await a.load('runtime')
  a.update('runtime', request, drafts)
  const submitted = a.entries('runtime')[0]
  const b = createQuestionRecovery(disk)
  await b.load('runtime')
  a.remove('runtime', 'thread', 'request', submitted)
  b.update('runtime', request, {
    ordinary: { selected: [], text: 'Typed while acknowledgement storage waited' },
  })
  finish()
  const reopened = createQuestionRecovery(disk)
  await reopened.load('runtime')
  expect(reopened.entries('runtime')[0].drafts.ordinary.text).toBe(
    'Typed while acknowledgement storage waited',
  )
})
