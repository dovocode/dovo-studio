import { describe, expect, it } from 'vite-plus/test'
import {
  resolveMarkdownLink,
  localMarkdownPath,
  localMarkdownURL,
  markdownURLLocalPath,
} from './markdown-links.js'

describe('Markdown links', () => {
  const discussion = 'https://github.com/dovo/studio/pull/7#issuecomment-1'
  const files = 'https://github.com/dovo/studio/blob/abc123/'

  it('resolves files at the reviewed revision while retaining GitHub navigation links', () => {
    expect(resolveMarkdownLink('docs/setup.md', discussion, files)).toBe(`${files}docs/setup.md`)
    expect(resolveMarkdownLink('#testing', discussion, files)).toBe(
      'https://github.com/dovo/studio/pull/7#testing',
    )
    expect(resolveMarkdownLink('/dovo/studio/issues/8', discussion, files)).toBe(
      'https://github.com/dovo/studio/issues/8',
    )
    expect(resolveMarkdownLink('../blob/main/image.png?raw=true', discussion, files)).toBe(
      'https://github.com/dovo/studio/blob/main/image.png?raw=true',
    )
    expect(resolveMarkdownLink('../issues/8', discussion, files)).toBe(
      'https://github.com/dovo/studio/issues/8',
    )
  })

  it('preserves external links and email without requiring a base', () => {
    expect(resolveMarkdownLink('https://example.com/docs')).toBe('https://example.com/docs')
    expect(resolveMarkdownLink('mailto:dev@example.com')).toBe('mailto:dev@example.com')
  })
  it('resolves Azure repository files at the captured commit using its query-based browser URLs', () => {
    const base = 'https://dev.azure.com/org/project/_git/repo?path=/&version=GCabc123'
    const result = new URL(
      resolveMarkdownLink(
        'docs/getting%20started.md#setup',
        'https://dev.azure.com/org/project/_git/repo/pullrequest/12',
        base,
      )!,
    )
    expect(result.pathname).toBe('/org/project/_git/repo')
    expect(result.searchParams.get('path')).toBe('/docs/getting started.md')
    expect(result.searchParams.get('version')).toBe('GCabc123')
    expect(result.hash).toBe('#setup')
    expect(resolveMarkdownLink('javascript:alert(1)', undefined, base)).toBeUndefined()
  })

  it('rejects scripts, app links, files, and unresolved local paths', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/hosts',
      'vscode://file',
    ])
      expect(resolveMarkdownLink(url, discussion, files)).toBeUndefined()
    expect(resolveMarkdownLink('/Users/dominic/project/file.ts')).toBeUndefined()
    expect(resolveMarkdownLink('relative.md')).toBeUndefined()
  })
})

it('retains runtime paths, source line suffixes, and encoded names without accepting external schemes', () => {
  for (const [value, path] of [
    ['/tmp/shot.png', '/tmp/shot.png'],
    ['src/app.ts:12:3', 'src/app.ts'],
    ['file:///tmp/a%20b.pdf:12', 'file:///tmp/a%20b.pdf'],
    ['C:\\Users\\dominic\\report.txt:9', 'C:\\Users\\dominic\\report.txt'],
    ['docs/readme.md#L12', 'docs/readme.md'],
  ]) {
    expect(localMarkdownPath(value!)).toBe(path)
    expect(markdownURLLocalPath(localMarkdownURL(value!)!)).toBe(path)
  }
  for (const url of [
    'https://example.com',
    'mailto:a@example.com',
    '//example.com/file',
    '#section',
    'javascript:alert(1)',
    'data:text/html,test',
  ])
    expect(localMarkdownPath(url)).toBeUndefined()
  expect(markdownURLLocalPath('https://example.com/?path=/tmp/test')).toBeUndefined()
})
