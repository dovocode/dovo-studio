import { afterEach, expect, it } from 'vitest'
import { clearRuntimeRequestCache, snapshotResponseCache } from './snapshot-memory-cache'

afterEach(() => clearRuntimeRequestCache())

it('does not retain a snapshot larger than its total memory budget', () => {
  snapshotResponseCache('http://host', 'credential').save(
    'W/"large"',
    'x'.repeat(16 * 1024 * 1024 + 1),
  )
  expect(snapshotResponseCache('http://host', 'credential').tag).toBeUndefined()
})

it('evicts older bodies when their combined size exceeds the memory budget', () => {
  snapshotResponseCache('http://first', 'credential').save(
    'W/"first"',
    'x'.repeat(10 * 1024 * 1024),
  )
  snapshotResponseCache('http://second', 'credential').save(
    'W/"second"',
    'x'.repeat(10 * 1024 * 1024),
  )
  expect(snapshotResponseCache('http://first', 'credential').tag).toBeUndefined()
  expect(snapshotResponseCache('http://second', 'credential').tag).toBe('W/"second"')
})
