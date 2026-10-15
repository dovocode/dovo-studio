import { expect, it } from 'vite-plus/test'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { artifactSourceMarkdown, richMarkdown } from '@dovo/protocol'
import { markdownImages } from './markdown-images'
import { mermaidBlocks } from './mermaid-blocks'

it('keeps inline code preview contents literal through the Markdown rendering pipeline', () => {
  const content = [
    'const greeting: string = "Hello 👋"',
    '// ![example](/tmp/image.png)',
    '// [file](/tmp/example.ts)',
    'const example = `',
    '```mermaid',
    'graph TD; A-->B',
    '```',
    '`',
  ].join('\n')
  const text = artifactSourceMarkdown({ format: 'code', language: 'tsx', content })
  expect(richMarkdown(text, true)).toMatchObject([{ kind: 'markdown', text }])
  expect(mermaidBlocks(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
  expect(markdownImages(text)).toEqual([{ kind: 'text', text, offset: 0 }])
  const nodes = fromMarkdown(text).children
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ type: 'code', lang: 'tsx', value: content })
})

it('keeps HTML source fenced and unlabelled code readable without guessing a language', () => {
  for (const artifact of [
    { format: 'html' as const, content: '<script>const answer = 42</script>' },
    { format: 'code' as const, content: 'unknown syntax\n  with indentation' },
  ]) {
    expect(fromMarkdown(artifactSourceMarkdown(artifact)).children).toMatchObject([
      {
        type: 'code',
        lang: artifact.format === 'html' ? 'html' : 'text',
        value: artifact.content,
      },
    ])
  }
})
