import { expect, it } from 'vite-plus/test'
import { completeForgeDiff } from './forge-diff'

const valid = 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n'

it('parses complete hunks including no-newline markers', () => {
  expect(completeForgeDiff(valid)[0]).toMatchObject({
    path: 'file',
    additions: 1,
    deletions: 1,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
  })
  expect(completeForgeDiff(valid + '\\ No newline at end of file\n')[0]?.patch).toContain(
    '\\ No newline at end of file',
  )
})

it.each([
  '',
  valid.slice(0, -1),
  valid.replace('diff --git', 'invalid header'),
  valid.replace('@@ -1 +1 @@', '@@ -1,2 +1 @@'),
  valid.replace('+new\n', ''),
  valid.replace('+new\n', 'invalid\n'),
])('rejects malformed or truncated raw diffs', (diff) => {
  expect(() => completeForgeDiff(diff)).toThrow(/raw diff|hunk/i)
})
