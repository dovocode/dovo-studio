import { expect, it } from 'vite-plus/test'
import { highlightedDiffRows } from './diff-syntax'
import { diffRows } from './diff-lines'

it('highlights both sides of TSX without changing source text or comment coordinates', () => {
  const patch =
    '--- a/Card.tsx\n+++ b/Card.tsx\n@@ -3 +3 @@\n-export const Card = () => <div title="old" />;\n+export const Card = () => <div title="new" />;\n'
  const rows = highlightedDiffRows(patch)
  expect(rows).toMatchObject(diffRows(patch))
  for (const row of rows.slice(1)) {
    expect(row.spans?.map((span) => span.text).join('')).toBe(row.text)
    expect(row.spans).toContainEqual({ text: 'export', kind: 'keyword' })
    expect(row.spans?.some((span) => span.kind === 'attr-value')).toBe(true)
  }
})

it('keeps multiline lexical state independent on each side', () => {
  const rows = highlightedDiffRows(
    '--- a/app.ts\n+++ b/app.ts\n@@ -1,3 +1,3 @@\n-/* old comment\n+const value = "new";\n shared\n-*/\n+const next = 2;\n',
  )
  expect(rows.find((row) => row.kind === 'deletion' && row.before === 3)?.spans).toEqual([
    { text: '*/', kind: 'comment' },
  ])
  expect(rows.find((row) => row.kind === 'addition' && row.after === 3)?.spans).toContainEqual({
    text: 'const',
    kind: 'keyword',
  })
  expect(rows.find((row) => row.kind === 'context')?.spans).toEqual([
    { text: 'shared', kind: undefined },
  ])
})

it('resets lexical state at omitted hunks and preserves no-newline markers', () => {
  const patch =
    '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-/* start\n+/* start\n\\ No newline at end of file\n@@ -30 +30 @@\n-const before = 1;\n+const after = 2;\n'
  const rows = highlightedDiffRows(patch)
  expect(rows.find((row) => row.after === 30)?.spans).toContainEqual({
    text: 'const',
    kind: 'keyword',
  })
  expect(rows.find((row) => row.text.startsWith('\\ No newline'))?.kind).toBe('header')
})

it('uses explicit current and previous filenames when a rename changes languages', () => {
  const rows = highlightedDiffRows(
    '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-def example(): pass\n+const example = 1;\n',
    'new.ts',
    'old.py',
  )
  expect(rows[1].spans).toContainEqual({ text: 'def', kind: 'keyword' })
  expect(rows[2].spans).toContainEqual({ text: 'const', kind: 'keyword' })
})

it('highlights added and removed files and keeps unknown or malformed patches readable', () => {
  for (const [before, after, marker, hunk] of [
    ['/dev/null', 'b/app.ts', '+', '-0,0 +1'],
    ['a/app.ts', '/dev/null', '-', '-1 +0,0'],
  ]) {
    const rows = highlightedDiffRows(
      `--- ${before}\n+++ ${after}\n@@ ${hunk} @@\n${marker}const value = 1;\n`,
    )
    expect(rows[1].spans).toContainEqual({ text: 'const', kind: 'keyword' })
  }
  for (const patch of [
    'provider omitted patch',
    '--- a/file.unknown\n+++ b/file.unknown\n@@ -1 +1 @@\n-old\n+new\n',
  ])
    expect(highlightedDiffRows(patch)).toEqual(diffRows(patch))
})

it('leaves oversized hunks readable without running a tokenizer on them', () => {
  const patch = `--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-${'x'.repeat(40_000)}\n+${'y'.repeat(40_000)}\n`
  expect(highlightedDiffRows(patch)).toEqual(diffRows(patch))
})
