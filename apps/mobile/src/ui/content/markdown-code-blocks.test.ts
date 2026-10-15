import { expect, it } from 'vite-plus/test'
import { markdownCodeBlocks } from './markdown-code-blocks'

it('preserves surrounding Markdown and extracts literal code with its language', () => {
  const text = 'Before\n\n````tsx\nconst x = `\n```mermaid\nA-->B\n```\n`\n````\n\nAfter'
  const parts = markdownCodeBlocks(text)
  expect(parts.map((part) => part.kind)).toEqual(['markdown', 'code', 'markdown'])
  expect(parts[1]).toMatchObject({
    language: 'tsx',
    text: 'const x = `\n```mermaid\nA-->B\n```\n`',
    offset: 8,
  })
  expect(parts[0].text + text.slice(parts[1].offset, parts[2].offset) + parts[2].text).toBe(text)
})

it('preserves unfinished fences and nested Markdown structure', () => {
  for (const text of [
    '```ts\nconst n = 1;',
    '- List\n\n  ```ts\n  const n = 1;\n  ```',
    '    const n = 1;',
  ])
    expect(markdownCodeBlocks(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})

it('handles unlabelled, tilde and CRLF fences without interpreting source images', () => {
  expect(markdownCodeBlocks('~~~\r\n![literal](image.png)\r\n~~~')).toEqual([
    { kind: 'code', language: undefined, text: '![literal](image.png)', offset: 0 },
  ])
})
