import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import {
  browserProfilesSchema,
  browserLinkProfile,
  normalizeBrowserLinkDomain,
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

it('routes by exact host and most-specific wildcard without crossing private sessions', () => {
  const profiles = [
    { id: 'default', name: 'Default', linkDomains: ['*.example.com'] },
    { id: 'work', name: 'Work', linkDomains: ['teams.microsoft.com', '*.work.example.com'] },
    { id: 'personal', name: 'Personal', linkDomains: ['private.work.example.com'] },
  ]
  expect(browserLinkProfile('https://teams.microsoft.com/call', profiles)).toBe('work')
  expect(browserLinkProfile('http://TEAM.WORK.EXAMPLE.COM:3000/path', profiles)).toBe('work')
  expect(browserLinkProfile('http://private.work.example.com/', profiles)).toBe('personal')
  for (const url of [
    'https://example.com/',
    'https://teams.microsoft.com.evil.test/',
    'https://evil.test/?next=https://teams.microsoft.com/',
    'javascript:alert(1)',
  ])
    expect(browserLinkProfile(url, profiles)).toBeUndefined()
  expect(
    browserLinkProfile(
      'https://teams.microsoft.com/',
      profiles,
      'private-00000000-0000-4000-8000-000000000001',
    ),
  ).toBeUndefined()
  expect(normalizeBrowserLinkDomain('  *.EXAMPLE.com  ')).toBe('*.example.com')
  expect(normalizeBrowserLinkDomain('münich.example')).toBe('xn--mnich-kva.example')
  for (const value of [
    'example.com/path',
    'example.com:443',
    'user@example.com',
    'https://example.com',
    '*',
    '*.',
  ])
    expect(normalizeBrowserLinkDomain(value)).toBeUndefined()
  expect(
    decodeResult(browserProfilesSchema, [
      ...profiles,
      { id: 'duplicate', name: 'Duplicate', linkDomains: ['teams.microsoft.com'] },
    ]).success,
  ).toBe(false)
})
