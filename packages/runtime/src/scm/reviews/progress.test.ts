import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../../storage/database'
import { ReviewMarks } from './progress'
it('shares persisted marks, invalidates only changed files, and rejects stale paired-client writes', () => {
  const db = openDatabase(':memory:')
  try {
    const desktop = new ReviewMarks(db),
      mobile = new ReviewMarks(db)
    const files = [
      { path: 'a.ts', fingerprint: 'a' },
      { path: 'b.ts', fingerprint: 'b' },
    ]
    const initial = desktop.reconcile('repo/PR1', files)
    desktop.set('repo/PR1', { ...initial[0], viewed: true })
    mobile.set('repo/PR1', { ...initial[1], viewed: true })
    expect(mobile.files('repo/PR1').every((file) => file.viewed)).toBe(true)
    expect(() => mobile.set('repo/PR1', { ...initial[0], viewed: false })).toThrow(
      'viewed flag changed',
    )
    expect(new ReviewMarks(db).files('repo/PR1').every((file) => file.viewed)).toBe(true)
    const updated = mobile.reconcile('repo/PR1', [{ path: 'a.ts', fingerprint: 'a2' }, files[1]])
    expect(updated.map((file) => file.viewed)).toEqual([false, true])
    expect(() => desktop.set('repo/PR1', { ...initial[0], viewed: true })).toThrow(
      'viewed flag changed',
    )
    expect(mobile.reconcile('repo/PR1', files).map((file) => file.viewed)).toEqual([false, true])
    expect(desktop.reconcile('otherRepo/PR1', files).every((file) => !file.viewed)).toBe(true)
    desktop.reconcile('repo/PR1', [files[1]])
    expect(desktop.files('repo/PR1').map((file) => file.path)).toEqual(['b.ts'])
    desktop.reconcile('repo/PR1', files)
    expect(desktop.files('repo/PR1')[0].viewed).toBe(false)
    expect(() => desktop.set('repo/PR1', { ...initial[0], viewed: true })).toThrow(
      'viewed flag changed',
    )
  } finally {
    db.close()
  }
})
