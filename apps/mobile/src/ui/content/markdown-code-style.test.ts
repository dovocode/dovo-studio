import { expect, it } from 'vite-plus/test'
import { importCodeTheme, nativeCodeColors } from '@dovo/studio-core/code-themes'
import { markdownCodeStyle } from './markdown-code-style'
import type { MobileTheme } from '../theme'

const colors: MobileTheme['colors'] = {
  background: '#101010',
  surface: '#202020',
  elevated: '#303030',
  border: '#404040',
  text: '#eeeeee',
  muted: '#999999',
  accent: '#abcdef',
  selection: '#112233',
  action: '#123456',
  onAccent: '#ffffff',
  error: '#ff0000',
  onError: '#000000',
  success: '#00ff00',
  done: '#b7bdc8',
  warning: '#ffff00',
  syntaxFunction: '#ff00ff',
  syntaxKeyword: '#00ffff',
}

it('keeps the app palette when no editor theme is available', () => {
  expect(markdownCodeStyle({ colors, code: undefined })).toMatchObject({
    color: colors.text,
    backgroundColor: colors.surface,
    syntaxColors: {
      keyword: colors.syntaxKeyword,
      string: colors.success,
      number: colors.warning,
      comment: colors.muted,
      function: colors.syntaxFunction,
    },
  })
})

it('uses the selected editor background, text and token colors independently of the app palette', () => {
  const theme = importCodeTheme(
    JSON.stringify({
      type: 'light',
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#111111',
        'editorLineNumber.foreground': '#aaaaaa',
      },
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#222222' } },
        { scope: 'keyword', settings: { foreground: '#333333' } },
        { scope: 'string', settings: { foreground: '#444444' } },
        { scope: 'constant.numeric', settings: { foreground: '#555555' } },
        { scope: 'entity.name.function', settings: { foreground: '#666666' } },
        { scope: 'entity.name.type', settings: { foreground: '#777777' } },
      ],
    }),
    'editor.json',
  )
  const code = { colors: nativeCodeColors(theme), custom: true }
  expect(markdownCodeStyle({ colors, code })).toEqual({
    color: '#111111',
    backgroundColor: '#ffffff',
    syntaxColors: {
      keyword: '#333333',
      operator: '#111111',
      punctuation: '#111111',
      string: '#444444',
      number: '#555555',
      constant: '#555555',
      comment: '#222222',
      function: '#666666',
      type: '#777777',
      variable: '#111111',
      property: '#111111',
      tag: '#333333',
      attribute: '#777777',
      embedded: '#111111',
    },
  })
  // Follow-app themes also carry the resolved syntax palette.
  expect(markdownCodeStyle({ colors, code: { ...code, custom: false } })).toEqual(
    markdownCodeStyle({ colors, code }),
  )
})
