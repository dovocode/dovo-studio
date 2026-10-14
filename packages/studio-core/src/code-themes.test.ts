import { expect, it } from 'vite-plus/test'
import { decodeResult } from '@dovo/protocol'
import {
  importCodeTheme,
  importedCodeThemesSchema,
  nativeCodeColors,
  resolveCodeTheme,
} from './code-themes'

it('imports VS Code JSONC, TextMate scopes and font styles with stable immutable identities', () => {
  const source = `{// a VS Code theme
    "name":"Example", "type":"light", "colors":{"editor.background":"#fff", "editor.foreground":"#123456"},
    "tokenColors":[{"scope":["keyword", "storage"],"settings":{"foreground":"#abcdef","fontStyle":"bold italic"}},],
  }`
  const theme = importCodeTheme(source, 'example.jsonc')
  expect(theme.type).toBe('light')
  expect(theme.bg).toBe('#fff')
  expect(theme.tokenColors[0].settings.fontStyle).toBe('bold italic')
  expect(importCodeTheme(source, 'other.json').name).toBe(theme.name)
  expect(importCodeTheme(source.replace('#abcdef', '#fedcba'), 'example.json').name).not.toBe(
    theme.name,
  )
  expect(nativeCodeColors(theme).keyword).toBe('#abcdef')
  expect(decodeResult(importedCodeThemesSchema, JSON.parse(JSON.stringify([theme]))).success).toBe(
    true,
  )
})

it('keeps code and app palettes independent and falls back when an imported theme is missing', () => {
  const theme = importCodeTheme(
    '{"name":"Light","type":"light","colors":{"editor.background":"#ffffff"}}',
    'light.json',
  )
  expect(resolveCodeTheme(theme.name, [theme], 'dovo', 'dark')).toBe(theme)
  expect(resolveCodeTheme('dracula', [], 'dovo', 'dark').name).toBe('dovo-dracula-dark')
  expect(resolveCodeTheme('app', [], 'iris', 'light').name).toBe('dovo-iris-light')
  expect(resolveCodeTheme(theme.name, [], 'dovo', 'dark').name).toBe('dovo-dovo-dark')
})

it('rejects malformed, unbounded and unresolved themes without executing or fetching anything', () => {
  expect(() => importCodeTheme('{', 'bad.json')).toThrow('Invalid theme JSON')
  expect(() => importCodeTheme('{"include":"./base.json"}', 'include.json')).toThrow(
    'Generate Color Theme',
  )
  expect(() =>
    importCodeTheme('{"colors":{"editor.background":"url(https://example.com)"}}', 'bad.json'),
  ).toThrow('Invalid VS Code theme')
  expect(() => importCodeTheme('{"tokenColors":[{"scope":2,"settings":{}}]}', 'bad.json')).toThrow(
    'Invalid VS Code theme',
  )
  expect(() => importCodeTheme(' '.repeat(1024 * 1024 + 1), 'large.json')).toThrow(
    'smaller than 1 MB',
  )
  expect(() => importCodeTheme('{}', 'empty.json')).toThrow('no theme colors')
})

it('supports default token colors and native scope-category mapping', () => {
  const theme = importCodeTheme(
    JSON.stringify({
      tokenColors: [
        { settings: { foreground: '#111111', background: '#eeeeee' } },
        { scope: 'comment, punctuation.definition.comment', settings: { foreground: '#777777' } },
        { scope: 'entity.name', settings: { foreground: '#123456' } },
        { scope: 'entity.name.function', settings: { foreground: '#654321' } },
      ],
    }),
    'tokens.json',
  )
  expect(theme.fg).toBe('#111111')
  expect(theme.bg).toBe('#eeeeee')
  expect(nativeCodeColors(theme)).toMatchObject({
    comment: '#777777',
    function: '#654321',
    type: '#123456',
  })
})

it('infers exported theme mode and ignores explicit default/null colors', () => {
  const light = importCodeTheme(
    '{"colors":{"editor.background":"#fff","editor.foreground":null}}',
    'light.json',
  )
  expect(light.type).toBe('light')
  expect(light.fg).toMatch(/^#/)
  const dark = importCodeTheme('{"colors":{"editor.background":"#101010"}}', 'dark.json')
  expect(dark.type).toBe('dark')
})

it('normalizes real-world normal/regular TextMate font styles into the editor format', () => {
  const theme = importCodeTheme(
    JSON.stringify({
      colors: { 'editor.background': '#101010' },
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#abcdef', fontStyle: 'regular' } },
        { scope: 'comment', settings: { fontStyle: 'normal italic' } },
      ],
    }),
    'real.json',
  )
  expect(theme.tokenColors.map((token) => token.settings.fontStyle)).toEqual(['', 'italic'])
})
