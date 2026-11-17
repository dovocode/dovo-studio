import { expect, it } from 'vite-plus/test'
import { CodeResults } from './code-results.js'
import { z } from 'zod'
const retainedSchema = z.object({
  resultId: z.string(),
  length: z.number(),
  retained: z.literal(true),
  toolCompleted: z.literal(true),
})

it('keeps small results unchanged and pages large Unicode results without repeating actions', () => {
  const store = new CodeResults()
  const small = { ok: true }
  expect(store.retain('thread', small)).toBe(small)
  const value = { text: '😀'.repeat(1_100_000) }
  const retained = retainedSchema.parse(store.retain('thread', value, 0))
  let result = '',
    offset = 0
  while (offset < retained.length) {
    const page = store.read('thread', { resultId: retained.resultId, offset, limit: 262143 }, 1)
    result += page.text
    offset += page.text.length
  }
  expect(JSON.parse(result)).toEqual(value)
  expect(() => store.read('other', { resultId: retained.resultId }, 1)).toThrow('unavailable')
  expect(() => store.read('thread', { resultId: retained.resultId, offset: -1 }, 1)).toThrow('>=0')
  expect(() => store.read('thread', { resultId: retained.resultId, limit: 262145 }, 1)).toThrow(
    '<=262144',
  )
  expect(() =>
    store.read('thread', { resultId: retained.resultId, offset: retained.length + 1 }, 1),
  ).toThrow('Offset')
  expect(() => store.read('thread', { resultId: retained.resultId }, 3_600_000)).toThrow('expired')
})

it('bounds retention and reports a completed result that is too large to retain', () => {
  const store = new CodeResults()
  const value = 'a'.repeat(23 * 1024 * 1024)
  const first = retainedSchema.parse(store.retain('thread', value, 0))
  store.retain('thread', value, 1)
  store.retain('thread', value, 2)
  expect(() => store.read('thread', { resultId: first.resultId }, 3)).toThrow('unavailable')
  expect(store.retain('thread', 'a'.repeat(33 * 1024 * 1024), 4)).toMatchObject({
    toolCompleted: true,
    retained: false,
  })
})
