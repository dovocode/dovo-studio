import { expect, it } from 'vite-plus/test'
import { importCodeTheme } from '@dovo/studio-core/code-themes'
import { studioSyntaxTheme } from '@dovo/studio-core/themes'
import { createPierreCodePlugin } from './pierre-code-plugin'
import type { HighlightResult } from 'streamdown'

const run = (plugin: ReturnType<typeof createPierreCodePlugin>, code: string, language: string) =>
  new Promise<HighlightResult>((resolve) => {
    const result = plugin.highlight({ code, language, themes: plugin.getThemes() }, resolve)
    if (result) resolve(result)
  })

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
  const result = await run(plugin, source, 'typescript')
  expect(result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(
    source,
  )
  const keyword = result.tokens.flat().find((token) => token.content.includes('export'))
  expect(keyword?.htmlStyle?.['--shiki-dark']).toBe('#cc3366')
  expect(keyword?.htmlStyle?.['--shiki-dark-font-style']).toBe('italic')
  expect(keyword?.htmlStyle?.['--shiki-dark-font-weight']).toBe('700')
  const unknown = await run(plugin, source, 'dovo-unknown-language')
  expect(unknown.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(
    source,
  )
})

it('reuses tokens across message remounts, isolates languages and maps edited imports afresh', async () => {
  const light = studioSyntaxTheme('dovo', 'light')
  const dark = studioSyntaxTheme('dovo', 'dark')
  const plugin = createPierreCodePlugin([light, dark])
  const source = 'export const cached = true'
  const first = await run(plugin, source, 'typescript')
  const reopened = createPierreCodePlugin([light, dark])
  expect(await run(reopened, source, 'typescript')).toBe(first)
  expect(await run(plugin, source, 'text')).not.toBe(first)
  expect(await run(plugin, source + '\n', 'typescript')).not.toBe(first)
  const custom = (color: string) =>
    importCodeTheme(
      JSON.stringify({
        name: 'Edited theme',
        tokenColors: [{ scope: 'keyword', settings: { foreground: color } }],
      }),
      'edited.json',
    )
  const before = createPierreCodePlugin([light, custom('#112233')])
  const after = createPierreCodePlugin([light, custom('#445566')])
  const tokenColor = async (value: typeof plugin) =>
    (await run(value, source, 'typescript')).tokens
      .flat()
      .find((token) => token.content.includes('export'))?.htmlStyle?.['--shiki-dark']
  expect(await tokenColor(before)).toBe('#112233')
  expect(await tokenColor(after)).toBe('#445566')
})

it('bounds streaming prefixes by count, evicts least recently used results and skips oversized blocks', async () => {
  const plugin = createPierreCodePlugin([
    studioSyntaxTheme('nord', 'light'),
    studioSyntaxTheme('nord', 'dark'),
  ])
  const first = await run(plugin, 'first', 'text')
  const second = await run(plugin, 'second', 'text')
  for (let index = 0; index < 18; index++) await run(plugin, `prefix ${index}`, 'text')
  expect(await run(plugin, 'first', 'text')).toBe(first)
  await run(plugin, 'overflow', 'text')
  expect(await run(plugin, 'first', 'text')).toBe(first)
  expect(await run(plugin, 'second', 'text')).not.toBe(second)
  const oversized = 'x'.repeat(300_000)
  expect(await run(plugin, oversized, 'text')).not.toBe(await run(plugin, oversized, 'text'))
  // An oversized miss does not evict useful smaller entries.
  expect(await run(plugin, 'first', 'text')).toBe(first)
})

it('bounds retained bytes before the entry count is exhausted', async () => {
  const plugin = createPierreCodePlugin([
    studioSyntaxTheme('sand', 'light'),
    studioSyntaxTheme('sand', 'dark'),
  ])
  const source = 'x'.repeat(140_000)
  const first = await run(plugin, source, 'text')
  await run(plugin, source + 'second', 'text')
  expect(await run(plugin, source, 'text')).not.toBe(first)
})
