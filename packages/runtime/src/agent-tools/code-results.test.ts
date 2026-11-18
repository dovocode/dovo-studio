import assert from 'node:assert/strict'
import { expect, it } from 'vite-plus/test'
import { CodeResults } from './code-results.js'

it('fits result pages with a large requested limit in a single Code mode response', () => {
  const store = new CodeResults()
  const value = '\u0000ž漢🙂'.repeat(300_000)
  const reference = store.retain('thread', value, 0)
  assert(reference && typeof reference === 'object' && 'resultId' in reference)
  let offset = 0
  const chunks = []
  do {
    const page = store.read('thread', { resultId: reference.resultId, offset, limit: 262_144 }, 0)
    expect(
      Buffer.byteLength(JSON.stringify({ result: page, output: [], calls: 1 })),
    ).toBeLessThanOrEqual(65_536)
    chunks.push(page.text)
    offset = page.nextOffset ?? 0
  } while (offset)
  expect(JSON.parse(chunks.join(''))).toBe(value)
})
