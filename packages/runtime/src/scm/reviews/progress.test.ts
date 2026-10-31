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
