import { expect, it } from 'vite-plus/test'
import { changedExtensionAccess, compareExtensionVersions } from './browser-extension-updates'

it('uses Chrome version components, including the optional fourth number', () => {
  expect(compareExtensionVersions('1.10', '1.9.65535.65535')).toBeGreaterThan(0)
  expect(compareExtensionVersions('1', '1.0.0.0')).toBe(0)
  expect(compareExtensionVersions('1.0.4.10', '1.0.4.11')).toBeLessThan(0)
  for (const version of ['01', '0', '1.65536', '1.2.3.4.5', '1-beta']) {
    expect(() => compareExtensionVersions(version, '1')).toThrow(/Invalid Chrome extension version/)
  }
})

it('detects permission promotions and changes to content script matches, exclusions and frames', () => {
  const previous = {
    permissions: ['storage'],
    optional_permissions: ['history'],
    content_scripts: [
      {
        matches: ['https://example.com/*'],
        exclude_matches: ['https://example.com/pay/*'],
        js: ['one.js'],
      },
    ],
  }
  expect(
    changedExtensionAccess(previous, {
      ...previous,
      content_scripts: [{ ...previous.content_scripts[0], js: ['two.js'] }],
    }),
  ).toEqual([])
  for (const scope of [
    { matches: ['https://example.com/*'] },
    { ...previous.content_scripts[0], all_frames: true },
    { ...previous.content_scripts[0], matches: ['<all_urls>'] },
  ]) {
    expect(
      changedExtensionAccess(previous, { ...previous, content_scripts: [scope] }),
    ).toHaveLength(1)
  }
  expect(
    changedExtensionAccess(previous, { ...previous, permissions: ['history', 'storage'] }),
  ).toEqual(['Permission: history'])
})

it('reviews changes in external messaging, exposed resources and account access', () => {
  for (const candidate of [
    { externally_connectable: { matches: ['https://example.com/*'] } },
    { web_accessible_resources: [{ resources: ['*'], matches: ['<all_urls>'] }] },
    { oauth2: { client_id: 'example', scopes: ['email'] } },
  ]) {
    expect(changedExtensionAccess({}, candidate)).toHaveLength(1)
    expect(changedExtensionAccess(candidate, candidate)).toEqual([])
  }
  expect(changedExtensionAccess({ externally_connectable: { ids: [] } }, {})).toHaveLength(1)
})
