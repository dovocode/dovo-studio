import { expect, it } from 'vite-plus/test'
import { dictationLanguages, interfaceLanguages, resolveInterfaceLanguage } from '@dovo/protocol'
import { interfaceDirection, interfaceText } from './interface-language'
import catalog from './interface-catalog.json'
it('has a complete interface catalog for every ASR language and keeps speech independent', () => {
  expect(interfaceLanguages.map((item) => item.id)).toEqual(dictationLanguages.map(([id]) => id))
  const catalogs: Record<string, Record<string, string>> = catalog
  for (const { id } of interfaceLanguages) {
    if (id === 'auto') continue
    const translations = catalogs[id.split('-')[0]]
    expect(translations).toBeDefined()
    expect(Object.keys(translations)).toEqual(Object.keys(catalog.en))
    expect(Object.values(translations).every((value) => !!value.trim())).toBe(true)
    expect(interfaceText('Settings', id)).toBe(translations.Settings)
  }
  expect(interfaceText('User content stays unchanged', 'nl-NL')).toBe(
    'User content stays unchanged',
  )
  expect(resolveInterfaceLanguage('auto', ['xx-ZZ', 'de-AT'])).toBe('de-DE')
  expect(resolveInterfaceLanguage('fr-CA', ['nl-NL'])).toBe('fr-CA')
  expect(resolveInterfaceLanguage('auto', ['xx-ZZ'])).toBe('en-US')
  expect(interfaceDirection('ar-AR')).toBe('rtl')
})

it('preserves all message placeholders in every language', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([key]) => key).sort()
  for (const translations of Object.values(catalog)) {
    for (const [source, translated] of Object.entries(translations)) {
      expect({ source, placeholders: placeholders(translated) }).toEqual({
        source,
        placeholders: placeholders(source),
      })
    }
  }
})

it('keeps command examples and layout separators unchanged', () => {
  const tokens = (text: string) =>
    text.match(
      /https?:\/\/[^\s<>]+|`[^`\n]+`|(?<!\w)[#@][A-Za-z][\w/-]*|\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g,
    ) ?? []
  for (const translations of Object.values(catalog)) {
    for (const [source, translated] of Object.entries(translations)) {
      expect.soft(translated.match(/^\s*/)?.[0], source).toBe(source.match(/^\s*/)?.[0])
      expect.soft(translated.match(/\s*$/)?.[0], source).toBe(source.match(/\s*$/)?.[0])
      for (const token of tokens(source)) expect.soft(translated, source).toContain(token)
    }
  }
})

it('inserts user values literally and leaves unspecified placeholders intact', () => {
  expect(interfaceText('Folder: {value0}', 'en-US', { value0: '$&{value1}<b>Settings</b>' })).toBe(
    'Folder: $&{value1}<b>Settings</b>',
  )
  expect(interfaceText('{value0} {value1}', 'en-US', { value0: 0 })).toBe('0 {value1}')
  expect(interfaceText('{value0}', 'en-US', { value0: null })).toBe('')
})
