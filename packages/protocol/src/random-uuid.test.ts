import { randomFillSync } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { configureSharingRandom } from './conversation/encrypted-sharing.js'
import { createQuestionRecovery } from './conversation/workflow/question-recovery.js'
import { randomUUID } from './random-uuid.js'
import { decode } from './shared/schema.js'
import { pendingQuestionSchema } from './conversation/workflow/questions.js'

afterEach(() => {
  vi.unstubAllGlobals()
  configureSharingRandom((bytes) => randomFillSync(bytes))
})

it('uses the configured platform random source without a browser crypto global', async () => {
  const fill = vi.fn<(bytes: Uint8Array) => Uint8Array>((bytes) => randomFillSync(bytes))
  configureSharingRandom(fill)
  vi.stubGlobal('crypto', undefined)
  const ids = Array.from({ length: 100 }, () => randomUUID())
  expect(new Set(ids).size).toBe(100)
  expect(
    ids.every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    ),
  ).toBe(true)
  expect(fill).toHaveBeenCalledTimes(100)
  expect(fill.mock.calls.every(([bytes]) => bytes.length === 16)).toBe(true)

  const entries = new Map<string, string>()
  const store = createQuestionRecovery({
    getAllKeys: () => [...entries.keys()],
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  })
  const request = decode(pendingQuestionSchema, {
    id: 'question',
    taskId: 'thread',
    createdAt: '',
    prompt: {
      title: 'Question',
      questions: [{ id: 'answer', header: 'Answer', question: 'Answer?', custom: true }],
    },
  })
  await store.load('native')
  store.update('native', request, { answer: { text: 'Retain my answer', selected: [] } })
  expect(store.entries('native')[0]?.drafts.answer?.text).toBe('Retain my answer')
  const reopened = createQuestionRecovery({
    getAllKeys: () => [...entries.keys()],
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  })
  await reopened.load('native')
  expect(reopened.entries('native')[0]?.drafts.answer?.text).toBe('Retain my answer')
})

it('fails if the platform random source fails', () => {
  configureSharingRandom(() => {
    throw new Error('Native random source unavailable')
  })
  vi.stubGlobal('crypto', undefined)
  expect(() => randomUUID()).toThrow('Native random source unavailable')
})
