import { expect, it, vi } from 'vite-plus/test'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import {
  createSyntaxHighlighter,
  fileLanguage,
  syntaxLanguage,
  maxSyntaxSourceLength,
} from './syntax-highlighter'
import { syntaxTestTheme } from './syntax-test-fixture'

const engine = () => createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined'))

it('shares initialization across code/diff viewers and preserves independent themes', async () => {
  const factory = vi.fn<typeof engine>(engine)
  const prepare = createSyntaxHighlighter(factory)
  const lightTheme = {
    ...syntaxTestTheme,
    name: 'mobile-syntax-light-test',
    tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: '#123456' } }],
  }
  const [dark, light] = await Promise.all([
    prepare(['typescript'], syntaxTestTheme),
    prepare(['typescript'], lightTheme),
  ])
  expect(factory).toHaveBeenCalledTimes(1)
  expect(dark('const n = 1;', 'typescript')?.[0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#CC66FF' })]),
  )
  expect(light('const n = 1;', 'typescript')?.[0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: 'const', color: '#123456' })]),
  )
})

it('uses TextMate scopes and font styles without changing Unicode, tabs or blank lines', async () => {
  const tokenize = await createSyntaxHighlighter(engine)(['typescript'], syntaxTestTheme)
  const source = '// Héllo 👋\n\n\tclass Example {}\n'
  const lines = tokenize(source, 'typescript')
  expect(lines?.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(source)
  expect(lines?.[0]).toEqual([expect.objectContaining({ color: '#777777', fontStyle: 1 })])
  expect(lines?.[2]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: 'Example', color: '#66CCCC', fontStyle: 6 }),
    ]),
  )
})

it('resolves supported filename/language aliases and leaves unknown or oversized source plain', async () => {
  expect(fileLanguage('C:\\project\\App.TSX')).toBe('tsx')
  expect(fileLanguage('app.svg')).toBe('xml')
  expect(syntaxLanguage('sh')).toBe('bash')
  expect(syntaxLanguage('text')).toBeUndefined()
  expect(syntaxLanguage('__proto__')).toBeUndefined()
  const tokenize = await createSyntaxHighlighter(engine)(['typescript'], syntaxTestTheme)
  expect(tokenize('const n = 1;', 'unknown')).toBeUndefined()
  expect(tokenize('const n = 1;')).toBeUndefined()
  expect(tokenize('x'.repeat(maxSyntaxSourceLength + 1), 'typescript')).toBeUndefined()
  const long = 'x'.repeat(3000)
  expect(
    tokenize(long, 'typescript')?.[0]
      .map((token) => token.content)
      .join(''),
  ).toBe(long)
})

it('reports engine initialization failure and permits a later explicit attempt', async () => {
  let attempts = 0
  const prepare = createSyntaxHighlighter(() => {
    attempts++
    return attempts === 1 ? Promise.reject(new Error('Native module missing')) : engine()
  })
  await expect(prepare(['typescript'], syntaxTestTheme)).rejects.toThrow('Native module missing')
  const tokenize = await prepare(['typescript'], syntaxTestTheme)
  expect(tokenize('const n = 1;', 'typescript')).toBeDefined()
})
