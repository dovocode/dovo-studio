import { expect, it, vi } from 'vite-plus/test'

const settings = vi.hoisted(() => ({ value: {} as unknown }))
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => settings.value,
}))
import { websiteSearchUrl, websiteLinkProfile } from './browser-language'

it('searches selected text using the clicked profile, including HTTP custom engines', () => {
  settings.value = {
    browserProfiles: [
      { id: 'default', name: 'Default', search: { engine: 'duckduckgo' } },
      {
        id: 'work',
        name: 'Work',
        search: { engine: 'custom', url: 'http://search.lan/find?q=%s' },
      },
    ],
  }
  expect(websiteSearchUrl('work', 'a&b #c')).toBe('http://search.lan/find?q=a%26b%20%23c')
  expect(websiteSearchUrl('default', 'react hooks')).toBe('https://duckduckgo.com/?q=react%20hooks')
  expect(websiteSearchUrl('missing', 'react hooks')).toBe(
    'https://www.google.com/search?q=react%20hooks',
  )
  expect(() => websiteSearchUrl('work', 'é'.repeat(1000))).toThrow('4096')
})

it('uses the default search safely when saved preferences are absent or invalid', () => {
  for (const value of [
    undefined,
    {},
    {
      browserProfiles: [
        { id: 'default', name: 'Default', search: { engine: 'custom', url: 'javascript:%s' } },
      ],
    },
  ]) {
    settings.value = value
    expect(websiteSearchUrl('default', 'a&b')).toBe('https://www.google.com/search?q=a%26b')
  }
})

it('applies website profile routing when only unified workspace is enabled', () => {
  settings.value = {
    browserWorkspaceEnabled: false,
    unifiedWorkspaceEnabled: true,
    browserProfiles: [
      { id: 'default', name: 'Default' },
      { id: 'work', name: 'Work', linkDomains: ['work.lan'] },
    ],
  }
  expect(websiteLinkProfile('default', 'http://work.lan/page')).toBe('work')
})
