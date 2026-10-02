import { expect, it } from 'vite-plus/test'
import { mermaidBlocks } from './mermaid-blocks'
it('keeps surrounding Markdown and multiple completed diagrams in order', () => {
  const parts = mermaidBlocks(
    'Before\n\n```mermaid\ngraph TD\nA-->B\n```\n\nBetween\n\n~~~mermaid\nsequenceDiagram\nA->>B: Hi\n~~~\nAfter',
  )
  expect(parts.map((p) => p.kind)).toEqual([
    'markdown',
    'mermaid',
    'markdown',
    'mermaid',
    'markdown',
  ])
  expect(parts[1].text).toBe('graph TD\nA-->B')
  expect(parts[3].text).toBe('sequenceDiagram\nA->>B: Hi')
})
it('keeps unfinished fences as source and does not extract literal fences inside code', () => {
  for (const text of [
    '```mermaid\ngraph TD\nA-->B',
    '````text\n```mermaid\ngraph TD\nA-->B\n```\n````',
    '```js\nconst x = "mermaid"\n```',
    '    ```mermaid\n    A-->B\n    ```',
  ])
    expect(mermaidBlocks(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})
it('supports longer closing fences, uppercase labels and Windows line endings', () => {
  expect(mermaidBlocks('```MERMAID\r\ngraph LR\r\nA-->B\r\n````').map((p) => p.kind)).toEqual([
    'mermaid',
  ])
})
