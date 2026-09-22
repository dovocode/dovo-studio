import { describe, expect, it } from 'vite-plus/test'
import type { RuntimeReadCache } from '@dovo/protocol'
import { acknowledgePullList, invalidatePullList, pullListRevision } from './pull-list-invalidation'

const cache = (): RuntimeReadCache => ({
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  clear: async () => {},
  close: async () => {},
})

describe('PR list refresh after native detail navigation', () => {
  it('keeps identical repository IDs isolated across computers and credentials', () => {
    const first = cache(),
      second = cache()
    invalidatePullList(first, 'repo')
    expect(pullListRevision(first, 'repo')).toBeDefined()
    expect(pullListRevision(second, 'repo')).toBeUndefined()
    expect(pullListRevision(first, 'another-repo')).toBeUndefined()
  })

  it('keeps a mutation pending until its accepted refresh completes', () => {
    const host = cache()
    invalidatePullList(host, 'repo')
    const revision = pullListRevision(host, 'repo')
    expect(pullListRevision(host, 'repo')).toBe(revision)
    acknowledgePullList(host, 'another-repo', revision)
    expect(pullListRevision(host, 'repo')).toBe(revision)
    acknowledgePullList(host, 'repo', revision)
    expect(pullListRevision(host, 'repo')).toBeUndefined()
  })

  it('does not let an older in-flight request acknowledge a newer mutation', () => {
    const host = cache()
    invalidatePullList(host, 'repo')
    const older = pullListRevision(host, 'repo')
    invalidatePullList(host, 'repo')
    const newer = pullListRevision(host, 'repo')
    acknowledgePullList(host, 'repo', older)
    expect(pullListRevision(host, 'repo')).toBe(newer)
    acknowledgePullList(host, 'repo', newer)
    expect(pullListRevision(host, 'repo')).toBeUndefined()
  })
})
