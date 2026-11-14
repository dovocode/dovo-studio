import { expect, it } from 'vite-plus/test'
import { dictationLanguages, interfaceLanguages, resolveInterfaceLanguage } from '@dovo/protocol'
import { interfaceDirection, interfaceText } from './interface-language'
import catalog from './interface-catalog.json'
it('has a complete common-control catalog for every ASR language and keeps speech independent', () => {
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
