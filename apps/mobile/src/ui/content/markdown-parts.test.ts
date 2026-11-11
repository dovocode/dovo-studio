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

const citation = ':codex-file-citation{path="src/app.ts" line_range_start="4"}'
// Each section stresses one boundary of incremental streaming; documents mix them so fences,
// rendered citations, cards and fallbacks interact.
const streamSections = [
  'Intro with **bold**, `code` and [docs](https://example.com).',
  '```mermaid\ngraph TD; A-->B\n```',
  `See ${citation} for details.`,
  '```ts\nconst n = 1\n```',
  '[Report](reports/q3.pdf)',
  '~~~MERMAID\r\ngraph LR; B-->C\r\n~~~~',
  '[![image](https://example.com/image.png)](https://example.com)',
  '````tsx\nconst x = `\n```mermaid\nA-->B\n```\n`\n````',
  '1. Step\n\n   ```bash\n   run\n   ```\n\n2. Next',
  '> ```ts\n> const quoted = 1\n> ```',
  `Again ${citation} and ${citation}.`,
  '::artifact-template{artifact_kind="document" display_name="Doc" skill_name="artifact-template-doc" skill_directory="/skills/doc"}',
  'visualize{"path":"charts/a.html","title":"Chart"}',
  '|a|b|\n|-|-|\n|c|d|\n```ts\ntable\n```',
  '<details>\n\n```ts\nhtml\n```\n\n</details>',
  '```md\n:codex-file-citation{path="inside.ts"}\n```',
  '    ```ts\n    indented\n    ```',
  '![Shot](shot.png) and text',
  'Line\r\n\r\n```ts\r\ncrlf\r\n```\r\n\r\nAfter',
  '```ts\nunclosed',
]
const fallbackSections = [
  '``` mermaid\ngraph TD\n```',
  '![image]\n\n```ts\nx\n```\n\n[image]: after.png',
  'Note[^1]\n\n```ts\nx\n```\n\n[^1]: Footnote',
  ':::note\n```ts\nx\n```\n:::',
  '<!--\n\n```ts\nx\n```\n\n-->',
]
function shuffled<T>(items: readonly T[], seed: number) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const other = seed % (index + 1)
    ;[copy[index], copy[other]] = [copy[other]!, copy[index]!]
  }
  return copy
}
const streamDocuments = [
  streamSections.join('\n\n'),
  shuffled(streamSections, 7).join('\n\n'),
  shuffled(streamSections, 11).join('\n'),
  ...fallbackSections.map(
    (section, index) => `${streamSections[index * 3]}\n\n${section}\n\n${streamSections[1]}\n\n`,
  ),
]

it('streams every prefix to the same parts as a full split', { timeout: 30_000 }, () => {
  for (const [index, document] of streamDocuments.entries())
    for (const localFiles of [true, false]) {
      // The first document streams one character at a time; the rest vary their chunk size.
      for (let end = 0; end <= document.length; end += index ? 1 + (end % 5) : 1) {
        const text = document.slice(0, end)
        expect(markdownParts(text, localFiles, true)).toEqual(splitMarkdownParts(text, localFiles))
      }
      expect(markdownParts(document, localFiles)).toEqual(splitMarkdownParts(document, localFiles))
    }
})

it('keeps streamed parts exact when updates jump, rewind or change text', () => {
  const document = streamDocuments[1]!
  let seed = 3
  for (let step = 0; step < 400; step++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const end = seed % (document.length + 1)
    // Occasionally edit earlier text so a stored prefix no longer applies.
    const text =
      step % 7 === 0 ? document.slice(0, end).replace('```', '~~~') : document.slice(0, end)
    expect(markdownParts(text, step % 2 === 0, true)).toEqual(
      splitMarkdownParts(text, step % 2 === 0),
    )
  }
})

it('reuses final streamed parts before the last completed fence', () => {
  const document = `${streamSections.slice(0, 4).join('\n\n')}\n\nTail`
  const first = markdownParts(document, true, true)
  const next = markdownParts(`${document} grows`, true, true)
  const fence = first.findLastIndex((part) => part.kind === 'code')
  expect(next.slice(0, fence + 1)).toEqual(first.slice(0, fence + 1))
  for (let index = 0; index <= fence; index++) expect(next[index]).toBe(first[index])
  expect(next).toEqual(splitMarkdownParts(`${document} grows`, true))
})
