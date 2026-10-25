import { expect, it } from 'vite-plus/test'
import { importCodeTheme } from '@dovo/studio-core/code-themes'
import { studioSyntaxTheme } from '@dovo/studio-core/themes'
import { createPierreCodePlugin } from './pierre-code-plugin'
import type { HighlightResult } from 'streamdown'

it('highlights with mapped custom colors and preserves Unicode, tabs, blank lines and unknown languages', async () => {
  const source = 'export const value = "😀"\n\n\t// Comment\n'
  const custom = importCodeTheme(
    JSON.stringify({
      colors: { 'editor.background': '#111111', 'editor.foreground': '#eeeeee' },
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#cc3366', fontStyle: 'italic bold' } },
      ],
    }),
    'custom.json',
  )
  const plugin = createPierreCodePlugin([studioSyntaxTheme('vscode', 'light'), custom])
  const run = (code: string, language: string) =>
    new Promise<HighlightResult>((resolve) => {
      const result = plugin.highlight({ code, language, themes: plugin.getThemes() }, resolve)
      if (result) resolve(result)
    })
  const result = await run(source, 'typescript')
  expect(result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(
    source,
  )
  const keyword = result.tokens.flat().find((token) => token.content.includes('export'))
  expect(keyword?.htmlStyle?.['--shiki-dark']).toBe('#cc3366')
  expect(keyword?.htmlStyle?.['--shiki-dark-font-style']).toBe('italic')
  expect(keyword?.htmlStyle?.['--shiki-dark-font-weight']).toBe('700')
  const unknown = await run(source, 'dovo-unknown-language')
  expect(unknown.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(
    source,
  )
})
