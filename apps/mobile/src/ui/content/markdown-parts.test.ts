import { expect, it } from 'vite-plus/test'
import { markdownParts, splitMarkdownParts } from './markdown-parts'

const text = [
  'Intro with [a link](https://example.com) and **bold** text.',
  '[Report](reports/q3.pdf)',
  '```mermaid\ngraph TD; A-->B\n```',
  '```ts\nconst answer = 42\n```',
  '![Screenshot](https://example.com/shot.png)',
  'Done 👋',
].join('\n\n')

it('reuses completed native parts without changing the split output', () => {
  for (const localFiles of [true, false]) {
    const first = markdownParts(text, localFiles)
    expect(first).toEqual(splitMarkdownParts(text, localFiles))
    expect(markdownParts(text, localFiles)).toBe(first)
  }
  const kinds = markdownParts(text, true).map((part) => part.kind)
  expect(kinds.filter((kind) => kind !== 'markdown')).toEqual(['file', 'mermaid', 'code', 'image'])
})

it('splits streaming prefixes fresh and never returns them for the completed text', () => {
  const prefix = text.slice(0, text.indexOf('```ts') + 8)
  const streamed = markdownParts(prefix, true, true)
  expect(streamed).toEqual(splitMarkdownParts(prefix, true))
  expect(markdownParts(prefix, true, true)).not.toBe(streamed)
})

it('preserves native part ordering and source offsets across diagrams, code and images', () => {
  const diagram = '~~~MERMAID\r\ngraph TD; A-->B\r\n~~~~'
  const code = '```ts\nconst n = 1\n```'
  const text = `${diagram}\n\n${code}\n\n![Shot](shot.png)`
  expect(splitMarkdownParts(text, true)).toEqual([
    { kind: 'mermaid', text: 'graph TD; A-->B', offset: 0 },
    { kind: 'markdown', text: '\n\n', offset: diagram.length },
    { kind: 'code', language: 'ts', text: 'const n = 1', offset: diagram.length + 2 },
    { kind: 'markdown', text: '\n\n', offset: diagram.length + code.length + 2 },
    { kind: 'image', url: 'shot.png', alt: 'Shot', offset: diagram.length + code.length + 4 },
  ])
})

it('keeps incomplete and nested fences literal after a completed diagram', () => {
  const diagram = '```mermaid\ngraph TD\n```'
  for (const suffix of [
    '\n\n```ts\n![literal](image.png)',
    '\n\n- list\n\n  ```ts\n  ![literal](image.png)\n  ```',
  ])
    expect(splitMarkdownParts(diagram + suffix, true)).toEqual([
      { kind: 'mermaid', text: 'graph TD', offset: 0 },
      { kind: 'markdown', text: suffix, offset: diagram.length },
    ])
})

it('preserves fragment-local image syntax when reference definitions cross a fence', () => {
  const inner = '![inner](inner.png)'
  const prefix = `![${inner}][outer]\n\n`
  const fence = '```ts\nx\n```'
  for (const suffix of ['\n\n[outer]: outer.png', '\n\n> [outer]: outer.png'])
    expect(splitMarkdownParts(prefix + fence + suffix, true)).toEqual([
      { kind: 'markdown', text: '![', offset: 0 },
      { kind: 'image', url: 'inner.png', alt: 'inner', offset: 2 },
      { kind: 'markdown', text: '][outer]\n\n', offset: 2 + inner.length },
      { kind: 'code', text: 'x', language: 'ts', offset: prefix.length },
      { kind: 'markdown', text: suffix, offset: prefix.length + fence.length },
    ])
})
