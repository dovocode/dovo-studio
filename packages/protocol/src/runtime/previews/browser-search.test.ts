import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { browserProfilesSchema } from './browser-profiles.js'
import { browserSearchEngineSchema, browserSearchUrl } from './browser-search.js'

it('encodes search terms for built-in providers and custom path/query templates', () => {
  expect(browserSearchUrl('react hooks')).toBe('https://www.google.com/search?q=react%20hooks')
  expect(browserSearchUrl('a&b #c', { engine: 'duckduckgo' })).toBe(
    'https://duckduckgo.com/?q=a%26b%20%23c',
  )
  expect(browserSearchUrl('café + tea', { engine: 'kagi' })).toBe(
    'https://kagi.com/search?q=caf%C3%A9%20%2B%20tea',
  )
  expect(
    browserSearchUrl('a/b?x=1', { engine: 'custom', url: 'http://search.lan/find/%s?q=%s' }),
  ).toBe('http://search.lan/find/a%2Fb%3Fx%3D1?q=a%2Fb%3Fx%3D1')
})

it('validates templates at the profile boundary and rejects unsafe or incomplete searches', () => {
  for (const url of [
    '',
    'https://example.com/search',
    'javascript:search(%s)',
    'file:///tmp/%s',
    '//example.com/?q=%s',
    'https://user:password@example.com/?q=%s',
    'https://%s.example.com/',
    'https://example.com/?q=%S',
  ]) {
    const search = { engine: 'custom', url }
    expect(decodeResult(browserSearchEngineSchema, search).success).toBe(false)
    expect(
      decodeResult(browserProfilesSchema, [{ id: 'default', name: 'Default', search }]).success,
    ).toBe(false)
    expect(() => browserSearchUrl('term', { engine: 'custom', url })).toThrow(
      'search URL containing %s',
    )
  }
  expect(decodeResult(browserProfilesSchema, [{ id: 'default', name: 'Default' }]).success).toBe(
    true,
  )
  const profiles = [
    {
      id: 'default',
      name: 'Default',
      search: { engine: 'custom', url: 'http://search.lan/?q=%s' },
    },
  ]
  expect(decodeResult(browserProfilesSchema, profiles)).toMatchObject({
    success: true,
    data: profiles,
  })
  expect(() => browserSearchUrl('é'.repeat(1000))).toThrow('4096')
})
