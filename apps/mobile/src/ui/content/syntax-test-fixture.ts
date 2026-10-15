import type { ThemeRegistration } from '@shikijs/types'

export const syntaxTestTheme = {
  name: 'mobile-syntax-test',
  type: 'dark',
  fg: '#eeeeee',
  bg: '#111111',
  tokenColors: [
    { scope: ['keyword', 'storage'], settings: { foreground: '#cc66ff' } },
    { scope: 'comment', settings: { foreground: '#777777', fontStyle: 'italic' } },
    { scope: 'string', settings: { foreground: '#66cc66' } },
    { scope: 'constant.numeric', settings: { foreground: '#ffcc66' } },
    { scope: 'entity.name.type', settings: { foreground: '#66cccc', fontStyle: 'bold underline' } },
  ],
} satisfies ThemeRegistration & { name: string }
