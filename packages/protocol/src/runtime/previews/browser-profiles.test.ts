import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import {
  browserProfilesSchema,
  browserLanguageSchema,
  browserLanguages,
  isPrivateBrowserProfile,
} from './browser-profiles'
it('requires a default profile, unique safe IDs, and meaningful names', () => {
  const valid = (profiles: unknown) => decodeResult(browserProfilesSchema, profiles).success
  const base = { id: 'default', name: 'Default' }
  expect(valid([base, { id: 'work', name: 'Work' }])).toBe(true)
  for (const profiles of [
    [],
    [{ id: 'work', name: 'Work' }],
    [base, base],
    [base, { id: '../outside', name: 'Work' }],
    [base, { id: 'work', name: '   ' }],
  ])
    expect(valid(profiles)).toBe(false)
})

it('defaults to English, validates BCP47 and preserves locale/base preferences', () => {
  expect(browserLanguages()).toEqual(['en-US', 'en'])
  expect(browserLanguages('nl-nl')).toEqual(['nl-NL', 'nl'])
  expect(browserLanguages('de')).toEqual(['de'])
  for (const value of ['', 'en_US', '../../outside', 'english!'])
    expect(decodeResult(browserLanguageSchema, value).success).toBe(false)
  expect(
    decodeResult(browserProfilesSchema, [{ id: 'default', name: 'Default', language: 'nl-NL' }])
      .success,
  ).toBe(true)
  expect(isPrivateBrowserProfile('private-00000000-0000-4000-8000-000000000001')).toBe(true)
  expect(isPrivateBrowserProfile('private-work')).toBe(false)
})
