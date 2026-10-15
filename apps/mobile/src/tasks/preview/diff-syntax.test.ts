import { beforeAll, expect, it } from 'vite-plus/test'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import { createTwoFilesPatch } from 'diff'
import { highlightedDiffRows, diffLanguages } from './diff-syntax'
import { diffRows } from './diff-lines'
import { createSyntaxHighlighter, type SyntaxTokenize } from '../../ui/content/syntax-highlighter'
import { syntaxTestTheme } from '../../ui/content/syntax-test-fixture'

// Exercise the real Shiki token pipeline. Native JSI parity is a separate device check.
let tokenize: SyntaxTokenize
beforeAll(async () => {
  const prepare = createSyntaxHighlighter(() =>
    createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')),
  )
  tokenize = await prepare(['tsx', 'typescript', 'python'], syntaxTestTheme)
})

it('highlights both sides of TSX without changing source text or comment coordinates', () => {
  const patch =
    '--- a/Card.tsx\n+++ b/Card.tsx\n@@ -3 +3 @@\n-export const Card = () => <div title="old" />;\n+export const Card = () => <div title="new" />;\n'
  const rows = highlightedDiffRows(patch, undefined, undefined, tokenize)
  expect(rows).toMatchObject(diffRows(patch))
  for (const row of rows.slice(1)) {
    expect(row.spans?.map((span) => span.content).join('')).toBe(row.text)
    expect(row.spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'export', color: '#CC66FF' })]),
    )
    expect(row.spans?.some((span) => span.color === '#66CC66')).toBe(true)
  }
})

it('keeps multiline lexical state independent on each side', () => {
  const rows = highlightedDiffRows(
    '--- a/app.ts\n+++ b/app.ts\n@@ -1,3 +1,3 @@\n-/* old comment\n+const value = "new";\n shared\n-*/\n+const next = 2;\n',
    undefined,
    undefined,
    tokenize,
  )
  expect(rows.find((row) => row.kind === 'deletion' && row.before === 3)?.spans).toEqual([
    expect.objectContaining({ content: '*/', color: '#777777', fontStyle: 1 }),
  ])
  expect(rows.find((row) => row.kind === 'addition' && row.after === 3)?.spans).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#CC66FF' })]),
  )
  expect(
    rows
      .find((row) => row.kind === 'context')
      ?.spans?.map((span) => span.content)
      .join(''),
  ).toBe('shared')
  expect(
    rows.find((row) => row.kind === 'context')?.spans?.every((span) => span.color !== '#777777'),
  ).toBe(true)
})

it('resets state across omitted patch hunks and preserves no-newline markers', () => {
  const patch =
    '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-/* start\n+/* start\n\\ No newline at end of file\n@@ -30 +30 @@\n-const before = 1;\n+const after = 2;\n'
  const rows = highlightedDiffRows(patch, undefined, undefined, tokenize)
  expect(rows.find((row) => row.after === 30)?.spans).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#CC66FF' })]),
  )
  expect(rows.find((row) => row.text.startsWith('\\ No newline'))?.kind).toBe('header')
})

it('uses complete contents to recover state omitted before a visible hunk', () => {
  const before = '/*\ncomment one\ncomment two\nold content\n*/\nconst answer = 42;\n'
  const after = before.replace('old content', 'new content')
  const patch = createTwoFilesPatch('app.ts', 'app.ts', before, after, undefined, undefined, {
    context: 0,
  })
  const rows = highlightedDiffRows(patch, 'app.ts', undefined, tokenize, { before, after })
  expect(rows).toMatchObject(diffRows(patch))
  for (const row of rows.filter((row) => row.kind !== 'header')) {
    expect(row.spans?.every((span) => span.color === '#777777')).toBe(true)
    expect(row.spans?.map((span) => span.content).join('')).toBe(row.text)
  }
  const stale = highlightedDiffRows(patch, 'app.ts', undefined, tokenize, {
    before: 'different file',
    after: 'different file',
  })
  expect(stale.every((row) => !row.spans)).toBe(true)
})

it('uses explicit old/new filenames when a rename changes languages', () => {
  const patch = '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-def example(): pass\n+const example = 1;\n'
  const rows = highlightedDiffRows(patch, 'new.ts', 'old.py', tokenize)
  expect(diffLanguages(patch, 'new.ts', 'old.py')).toEqual(['python', 'typescript'])
  expect(rows[1].spans).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'def', color: '#CC66FF' })]),
  )
  expect(rows[2].spans).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#CC66FF' })]),
  )
})

it('highlights added/deleted files and keeps unsupported or malformed patches readable', () => {
  for (const [before, after, marker, hunk] of [
    ['/dev/null', 'b/app.ts', '+', '-0,0 +1'],
    ['a/app.ts', '/dev/null', '-', '-1 +0,0'],
  ]) {
    const rows = highlightedDiffRows(
      `--- ${before}\n+++ ${after}\n@@ ${hunk} @@\n${marker}const value = 1;\n`,
      undefined,
      undefined,
      tokenize,
    )
    expect(rows[1].spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#CC66FF' })]),
    )
  }
  for (const patch of [
    'provider omitted patch',
    '--- a/file.unknown\n+++ b/file.unknown\n@@ -1 +1 @@\n-old\n+new\n',
  ])
    expect(highlightedDiffRows(patch, undefined, undefined, tokenize)).toEqual(diffRows(patch))
})

it('keeps oversized hunks and complete files readable without tokenizing them', () => {
  const patch = `--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-${'x'.repeat(40_000)}\n+${'y'.repeat(40_000)}\n`
  const unexpected: SyntaxTokenize = () => {
    throw new Error('Oversized source must stay plain')
  }
  expect(highlightedDiffRows(patch, undefined, undefined, unexpected)).toEqual(diffRows(patch))
  const small = '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n'
  expect(
    highlightedDiffRows(small, undefined, undefined, unexpected, {
      before: 'x'.repeat(70_000),
      after: 'y'.repeat(70_000),
    }),
  ).toEqual(diffRows(small))
})

it('keeps CRLF file patches and Unicode contents aligned with complete-file tokens', () => {
  const before = 'const greeting = "Héllo 👋";\r\n'
  const after = 'const greeting = "Bye 👋";\r\n'
  const patch = createTwoFilesPatch('app.ts', 'app.ts', before, after)
  const rows = highlightedDiffRows(patch, 'app.ts', undefined, tokenize, { before, after })
  expect(rows).toMatchObject(diffRows(patch))
  for (const row of rows.filter((row) => row.kind !== 'header')) {
    expect(row.spans?.map((span) => span.content).join('')).toBe(row.text)
  }
})
