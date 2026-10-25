import { expect, it, vi } from 'vite-plus/test'
import { cachedSyntax } from './syntax-cache'
import type { SyntaxTokenize } from './syntax-highlighter'

it('reuses identical source/language and preserves Unicode and blank lines', () => {
  const run = vi.fn<SyntaxTokenize>((source) =>
    source.split('\n').map((content) => [{ content, offset: 0 }]),
  )
  const tokenize = cachedSyntax(run)
  const source = 'const héllo = "👋";\r\n\n'
  const first = tokenize(source, 'typescript')
  expect(tokenize(source, 'typescript')).toBe(first)
  expect(run).toHaveBeenCalledTimes(1)
  expect(first?.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(source)
  tokenize(source, 'javascript')
  expect(run).toHaveBeenCalledTimes(2)
})

it('bounds retention, refreshes recent entries, and never caches failures', () => {
  const run = vi.fn<SyntaxTokenize>((content, language) =>
    language ? [[{ content, offset: 0 }]] : undefined,
  )
  const tokenize = cachedSyntax(run, 280)
  const first = tokenize('one', 'ts')
  tokenize('two', 'ts')
  expect(tokenize('one', 'ts')).toBe(first)
  tokenize('three', 'ts')
  tokenize('two', 'ts')
  expect(run).toHaveBeenCalledTimes(4)
  tokenize('x'.repeat(100), 'ts')
  tokenize('x'.repeat(100), 'ts')
  expect(run).toHaveBeenCalledTimes(6)
  tokenize('plain')
  tokenize('plain')
  expect(run).toHaveBeenCalledTimes(8)
})
