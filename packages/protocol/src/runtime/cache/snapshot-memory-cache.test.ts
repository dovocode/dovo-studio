import { afterEach, expect, it, vi } from 'vitest'
import { clearRuntimeRequestCache, snapshotResponseCache } from './snapshot-memory-cache'

afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
})

it('does not retain a snapshot larger than its total memory budget', () => {
  snapshotResponseCache('http://host', 'credential').save(
    'W/"large"',
    'x'.repeat(16 * 1024 * 1024 + 1),
  )
  expect(snapshotResponseCache('http://host', 'credential').tag).toBeUndefined()
})

it('falls back safely when a mobile JavaScript engine has no WeakRef', () => {
  vi.stubGlobal('WeakRef', undefined)
  snapshotResponseCache('http://host', 'credential').save(
    'W/"large"',
    'x'.repeat(16 * 1024 * 1024 + 1),
    { revision: 1 },
  )
  expect(snapshotResponseCache('http://host', 'credential').tag).toBeUndefined()
})
it('does not let an older response replace or evict a newer successful cache entry', () => {
  const first = snapshotResponseCache('http://host', 'credential')
  const second = snapshotResponseCache('http://host', 'credential')
  second.save('W/"new"', 'new body', { revision: 2 })
  first.save('W/"old"', 'old body', { revision: 1 })
  first.remove()
  const cached = snapshotResponseCache('http://host', 'credential')
  expect(cached.tag).toBe('W/"new"')
  expect(cached.body()).toBe('new body')
})
it('allows a newer response to replace an earlier result without suppressing completed reads', () => {
  const first = snapshotResponseCache('http://host', 'credential')
  const second = snapshotResponseCache('http://host', 'credential')
  first.save('W/"old"', 'old body')
  expect(snapshotResponseCache('http://host', 'credential').body()).toBe('old body')
  second.save('W/"new"', 'new body')
  expect(snapshotResponseCache('http://host', 'credential').body()).toBe('new body')
})
it('protects a freshly validated 304 baseline even without WeakRef support', () => {
  vi.stubGlobal('WeakRef', undefined)
  snapshotResponseCache('http://host', 'credential').save('W/"current"', 'current body')
  const old = snapshotResponseCache('http://host', 'credential')
  const validated = snapshotResponseCache('http://host', 'credential')
  validated.refresh({ revision: 2 })
  old.save('W/"old"', 'old body')
  expect(snapshotResponseCache('http://host', 'credential').tag).toBe('W/"current"')
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
