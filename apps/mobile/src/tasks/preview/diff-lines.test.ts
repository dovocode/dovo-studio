import { expect, it } from 'vite-plus/test'
import { diffRows } from './diff-lines'
it('uses old/new hunk line numbers and distinguishes headers from added/removed contents', () => {
  const rows = diffRows('--- a/app.ts\n+++ b/app.ts\n@@ -5,2 +5,3 @@\n same\n-old\n+new\n+more\n')
  expect(rows).toEqual([
    { text: '@@ −5,2 +5,3 @@', kind: 'header' },
    { text: 'same', kind: 'context', before: 5, after: 5 },
    { text: 'old', kind: 'deletion', before: 6 },
    { text: 'new', kind: 'addition', after: 6 },
    { text: 'more', kind: 'addition', after: 7 },
  ])
})
it('keeps malformed or unavailable hunks readable without pretending metadata are additions', () => {
  expect(diffRows('+++ file.ts\nprovider omitted patch')).toEqual([
    { text: '+++ file.ts', kind: 'header' },
    { text: 'provider omitted patch', kind: 'header' },
  ])
})
