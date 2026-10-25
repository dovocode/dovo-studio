import { expect, it } from 'vite-plus/test'
import { importCodeTheme } from './code-themes'
import { pierreTheme } from './pierre-theme'
import { studioSyntaxTheme, studioThemeIds } from './themes'

it('maps imported scopes, specificity, rule order and style resets without changing the source', () => {
  const theme = importCodeTheme(
    JSON.stringify({
      type: 'dark',
      colors: {
        'editor.foreground': '#eeeeee',
        'editor.background': '#111111',
        'editor.selectionBackground': '#333333',
      },
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#999999', fontStyle: 'italic bold' } },
        { scope: 'comment.block', settings: { fontStyle: '' } },
        { scope: ['string', 'constant.numeric'], settings: { foreground: '#aabbcc' } },
        { scope: 'keyword', settings: { foreground: '#111aaa' } },
        { scope: 'keyword', settings: { foreground: '#222bbb' } },
        { scope: 'source.js keyword', settings: { foreground: '#ff0000' } },
        { scope: 'keyword - keyword.operator', settings: { foreground: '#ff0000' } },
        { scope: 'keyword.operator', settings: { foreground: '#123456' } },
        { settings: { foreground: '#eeeeee' } },
      ],
    }),
    'theme.json',
  )
  const before = structuredClone(theme)
  const result = pierreTheme(theme)
  expect(result.name).toBe(theme.name)
  expect(result.style['editor.selectionBackground']).toBe('#333333')
  expect(result.style.syntax?.comment).toEqual({
    color: '#999999',
    font_style: 'italic',
    font_weight: 700,
  })
  expect(result.style.syntax?.['comment.doc']).toEqual({
    color: '#999999',
    font_style: 'normal',
    font_weight: 400,
  })
  expect(result.style.syntax?.string).toEqual({ color: '#aabbcc' })
  expect(result.style.syntax?.number).toEqual({ color: '#aabbcc' })
  expect(result.style.syntax?.keyword).toEqual({ color: '#222bbb' })
  expect(result.style.syntax?.['keyword.operator']).toEqual({ color: '#123456' })
  expect(result.style.syntax?.property).toEqual({ color: '#eeeeee' })
  expect(pierreTheme(theme)).toBe(result)
  expect(theme).toEqual(before)
})

it('preserves foreground, background and syntax colors for every built-in palette', () => {
  for (const id of studioThemeIds)
    for (const mode of ['light', 'dark'] as const) {
      const source = studioSyntaxTheme(id, mode)
      const mapped = pierreTheme(source)
      expect(mapped.appearance).toBe(mode)
      expect(mapped.style['editor.foreground']).toBe(source.fg)
      expect(mapped.style['editor.background']).toBe(source.bg)
      expect(mapped.style.syntax?.keyword).toEqual({
        color: source.tokenColors[1]!.settings.foreground,
      })
      expect(mapped.style.syntax?.number).toEqual({
        color: source.tokenColors[3]!.settings.foreground,
      })
    }
})
