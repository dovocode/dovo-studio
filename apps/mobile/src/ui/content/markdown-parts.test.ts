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
