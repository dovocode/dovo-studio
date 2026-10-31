import { expect, it } from 'vite-plus/test'
import { createReadingPositionCache, readingPositionOffset } from './reading-position'

it('isolates runtime credentials and threads and evicts old positions within a fixed bound', () => {
  const cache = createReadingPositionCache(2)
  const first = { anchorId: 'm1', anchorOffset: -24, scrollOffset: 800, atEnd: false }
  cache.remember('runtime/token1/thread1', first)
  cache.remember('runtime/token2/thread1', { ...first, anchorId: 'm2' })
  first.anchorId = 'mutated'
  expect(cache.read('runtime/token1/thread1')?.anchorId).toBe('m1')
  expect(cache.read('runtime/token2/thread1')?.anchorId).toBe('m2')
  expect(cache.read('runtime/token1/thread2')).toBeUndefined()
  cache.remember('runtime/token1/thread1', { ...first, anchorId: 'kept' })
  cache.remember('runtime2/token/thread', first)
  expect(cache.read('runtime/token2/thread1')).toBeUndefined()
  expect(cache.read('runtime/token1/thread1')?.anchorId).toBe('kept')
})

it('corrects variable-height anchors using physical offsets in normal and inverted lists', () => {
  expect(readingPositionOffset(500, 80, -20)).toBe(600)
  expect(readingPositionOffset(500, 80, -20, true)).toBe(400)
  expect(readingPositionOffset(50, 80, -20, true)).toBe(0)
})

it('does not retain invalid native measurements', () => {
  const cache = createReadingPositionCache()
  cache.remember('thread', { anchorOffset: NaN, scrollOffset: 0, atEnd: false })
  expect(cache.read('thread')).toBeUndefined()
})
