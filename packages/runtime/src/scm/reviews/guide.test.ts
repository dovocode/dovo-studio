import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { type ReviewGuide, reviewRevision } from '@dovo/protocol'
import { guideSteps } from './guide'
import { ReviewMarks } from './progress'
import { openDatabase } from '../../storage/database'

const group = {
  label: 'Contract',
  summary: 'Changes the exported value',
  impact: 'Check its callers',
  paths: ['a file.ts'],
  questions: ['Does the caller handle the new value?'],
}
const patch =
  '--- a/a file.ts\n+++ b/a file.ts\n@@ -10,3 +20,3 @@\n context\n-old\n+new\n tail\n@@ -100 +110 @@\n-second old\n+second new\n'
it('verifies both sides against exact evidenced lines and rejects invented paths and gaps', () => {
  const steps = guideSteps(
    [
      {
        ...group,
        excerpts: [
          { path: 'a file.ts', side: 'after', start: 20, end: 22 },
          { path: 'a file.ts', side: 'before', start: 10, end: 12 },
          { path: 'invented.ts', side: 'after', start: 1, end: 2 },
          { path: 'a file.ts', side: 'after', start: 50, end: 110 },
          { path: 'a file.ts', side: 'after', start: 20, end: 20 },
        ],
      },
    ],
    [{ path: 'a file.ts', evidence: patch }],
  )
  expect(steps[0].excerpts).toEqual([
    { path: 'a file.ts', side: 'after', start: 20, end: 22, text: 'context\nnew\ntail' },
    { path: 'a file.ts', side: 'before', start: 10, end: 12, text: 'context\nold\ntail' },
  ])
  expect(steps[0].questions).toEqual(group.questions)
})
it('keeps paths without available evidence visible and bounds excerpts without inventing partial lines', () => {
  const steps = guideSteps(
    [{ ...group, excerpts: [{ path: 'a file.ts', side: 'after', start: 1, end: 10000 }] }],
    [
      {
        path: 'a file.ts',
        evidence:
          '@@ -1 +1,200 @@\n-old\n' + Array.from({ length: 200 }, (_, i) => '+' + i).join('\n'),
      },
    ],
  )
  expect(steps[0].excerpts[0].end).toBe(40)
  expect(steps[0].excerpts[0].text.split('\n')).toHaveLength(40)
  expect(guideSteps([group], [])[0]).toMatchObject({ paths: ['a file.ts'], excerpts: [] })
  expect(
    guideSteps(
      [{ ...group, excerpts: [{ path: 'a file.ts', side: 'after', start: 1, end: 1 }] }],
      [{ path: 'a file.ts', evidence: '@@ -1 +1 @@\n-old\n+' + 'x'.repeat(17000) }],
    )[0].excerpts,
  ).toEqual([])
})
it('persists revision-specific tour progress across database reopen, rejects concurrent clients and prunes deleted owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-review-guide-'))
  const path = join(root, 'review.db')
  let db = openDatabase(path)
  try {
    const guide: ReviewGuide = {
      id: 'guide',
      revision: 'revision',
      generatedAt: new Date().toISOString(),
      steps: guideSteps([group, { ...group, label: 'Caller' }], []),
      position: 0,
      seen: [],
      version: 0,
    }
    const marks = new ReviewMarks(db)
    marks.saveGuide('task-scope', 'task', guide)
    marks.saveGuide('pull-scope', null, guide)
    marks.moveGuide('task-scope', 'revision', {
      id: guide.id,
      version: 0,
      position: 1,
      reviewed: 0,
    })
    expect(() =>
      marks.moveGuide('task-scope', 'revision', { id: guide.id, version: 0, position: 0 }),
    ).toThrow('guide changed')
    expect(() =>
      marks.moveGuide('task-scope', 'revision', { id: guide.id, version: 1, position: 100 }),
    ).toThrow('Choose a step')
    db.close()
    db = openDatabase(path)
    const restored = new ReviewMarks(db)
    expect(restored.guide('task-scope', 'revision')).toMatchObject({
      position: 1,
      seen: [0],
      version: 1,
    })
    expect(restored.guide('task-scope', 'other-revision')).toBeUndefined()
    // Missing hydrated tasks are not proof of deletion.
    db.exec('CREATE TABLE workspace_tasks (task_id TEXT PRIMARY KEY)')
    restored.pruneGuides()
    expect(restored.guide('task-scope', 'revision')).toBeDefined()
    db.prepare('INSERT INTO documents VALUES (?,?)').run('workspace-deleted:tasks:task', '{}')
    restored.pruneGuides()
    expect(restored.guide('task-scope', 'revision')).toBeUndefined()
    expect(restored.guide('pull-scope', 'revision')).toEqual(guide)
  } finally {
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})
it('fences PR revision identity even when patches stay identical and ignores harmless file ordering', () => {
  const files = [
    { path: 'a', fingerprint: 'one' },
    { path: 'b', fingerprint: 'two' },
  ]
  expect(reviewRevision(files, 'head-a')).toBe(reviewRevision([...files].reverse(), 'head-a'))
  expect(reviewRevision(files, 'head-a')).not.toBe(reviewRevision(files, 'head-b'))
})

it('does not label lines beyond the declared hunk as verified code', () => {
  const evidence =
    '@@ -1 +1 @@\n-old\n+new\n+injected outside hunk\n--- next header\n+++ next header'
  const steps = guideSteps(
    [{ ...group, excerpts: [{ path: 'a file.ts', side: 'after', start: 1, end: 3 }] }],
    [{ path: 'a file.ts', evidence }],
  )
  expect(steps[0].excerpts).toEqual([
    { path: 'a file.ts', side: 'after', start: 1, end: 1, text: 'new' },
  ])
})
