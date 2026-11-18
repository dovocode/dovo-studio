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
    expect(updated.map((file) => file.changedSinceViewed)).toEqual([true, undefined])
    expect(new ReviewMarks(db).files('repo/PR1')).toEqual(updated)
    const next = mobile.reconcile('repo/PR1', [{ path: 'a.ts', fingerprint: 'a3' }, files[1]])
    expect(next.map((file) => file.changedSinceViewed)).toEqual([true, undefined])
    expect(() => mobile.set('repo/PR1', { ...updated[0], viewed: true })).toThrow(
      'viewed flag changed',
    )
    expect(() => desktop.set('repo/PR1', { ...initial[0], viewed: true })).toThrow(
      'viewed flag changed',
    )
    expect(mobile.reconcile('repo/PR1', files).map((file) => file.viewed)).toEqual([false, true])
    expect(desktop.reconcile('otherRepo/PR1', files).every((file) => !file.viewed)).toBe(true)
    desktop.reconcile('repo/PR1', [files[1]])
    expect(desktop.files('repo/PR1').map((file) => file.path)).toEqual(['b.ts'])
    desktop.reconcile('repo/PR1', files)
    expect(desktop.files('repo/PR1')[0].viewed).toBe(false)
    expect(desktop.files('repo/PR1')[0].changedSinceViewed).toBeUndefined()
    expect(() => desktop.set('repo/PR1', { ...initial[0], viewed: true })).toThrow(
      'viewed flag changed',
    )
  } finally {
    db.close()
  }
})
it('migrates legacy marks and clears changed history only when the current file is viewed', () => {
  const db = openDatabase(':memory:')
  try {
    db.exec(`CREATE TABLE review_marks (scope TEXT NOT NULL, path TEXT NOT NULL,
      fingerprint TEXT NOT NULL, viewed INTEGER NOT NULL, version INTEGER NOT NULL,
      PRIMARY KEY(scope,path));
      INSERT INTO review_marks VALUES ('scope','viewed.ts','before',1,7), ('scope','unread.ts','before',0,3)`)
    const marks = new ReviewMarks(db)
    expect(marks.files('scope')).toEqual([
      { path: 'unread.ts', fingerprint: 'before', viewed: false, version: 3 },
      { path: 'viewed.ts', fingerprint: 'before', viewed: true, version: 7 },
    ])
    const changed = marks.reconcile('scope', [
      { path: 'unread.ts', fingerprint: 'after' },
      { path: 'viewed.ts', fingerprint: 'after' },
    ])
    expect(changed.map((file) => file.changedSinceViewed)).toEqual([undefined, true])
    marks.set('scope', { ...changed[1], viewed: false })
    const stillChanged = marks.files('scope')[1]
    expect(stillChanged.changedSinceViewed).toBe(true)
    marks.set('scope', { ...stillChanged, viewed: true })
    const reviewed = marks.files('scope')[1]
    expect(reviewed).toMatchObject({ viewed: true, version: 10 })
    expect(reviewed.changedSinceViewed).toBeUndefined()
    marks.set('scope', { ...reviewed, viewed: false })
    expect(marks.reconcile('scope', [{ path: 'viewed.ts', fingerprint: 'next' }])[0]).toEqual({
      path: 'viewed.ts',
      fingerprint: 'next',
      viewed: false,
      version: 12,
    })
  } finally {
    db.close()
  }
})
it('keeps the newest 500 PR guides and revisions, never limiting task guides, and migrates stored guides', () => {
  const db = openDatabase(':memory:')
  try {
    // Tables from before the retention columns, with a stored PR guide.
    db.exec(
      'CREATE TABLE review_revisions (scope TEXT PRIMARY KEY, revision TEXT NOT NULL); CREATE TABLE review_guides (scope TEXT PRIMARY KEY, task_id TEXT, id TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL)',
    )
    const guide = (id: string, at: number) => ({
      id,
      revision: 'revision',
      generatedAt: new Date(Date.UTC(2026, 0, 1) + at * 1000).toISOString(),
      steps: [
        { title: 'Step', summary: 's', impact: 'i', paths: ['a.ts'], excerpts: [], questions: [] },
      ],
      position: 0,
      seen: [],
      version: 0,
    })
    db.prepare('INSERT INTO review_guides VALUES (?,?,?,?,?)').run(
      'pull:legacy',
      null,
      'legacy',
      0,
      JSON.stringify(guide('legacy', 1000)),
    )
    const marks = new ReviewMarks(db)
    marks.saveGuide('task:oldest', 'task', guide('task', -1))
    for (let index = 0; index < 600; index++)
      marks.saveGuide(`pull:${index}`, null, guide(`pull-${index}`, index))
    const pulls = db
      .prepare('SELECT scope FROM review_guides WHERE task_id IS NULL')
      .all()
      .map((row) => (row as { scope: string }).scope)
    expect(pulls).toHaveLength(500)
    // The migrated guide is the newest by generation time; the 101 oldest saves are gone.
    expect(pulls).toContain('pull:legacy')
    expect(pulls).not.toContain('pull:100')
    expect(pulls).toContain('pull:101')
    expect(marks.guide('task:oldest', 'revision')?.id).toBe('task')
    for (let index = 0; index < 501; index++)
      marks.reconcile(`pull:${index}`, [{ path: 'a.ts', fingerprint: 'a' }], `revision-${index}`)
    expect(db.prepare('SELECT COUNT(*) AS count FROM review_revisions').get()).toEqual({
      count: 500,
    })
    expect(marks.revision('pull:500')).toBe('revision-500')
    // Marks themselves are not dropped with a revision row.
    expect(marks.hasScope('pull:0')).toBe(true)
  } finally {
    db.close()
  }
})
