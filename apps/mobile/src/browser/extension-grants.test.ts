import { expect, it } from 'vite-plus/test'
import {
  permissionChoices,
  restrictGrant,
  permissionPromptChoices,
  restrictPromptGrant,
} from './extension-grants'
const review = {
  requestedPermissions: ['tabs', 'storage', 'nativeMessaging'],
  optionalPermissions: ['tabs', 'clipboardWrite'],
  requestedMatchPatterns: ['http://localhost/*'],
  optionalMatchPatterns: ['https://example.com/*'],
  unsupportedPermissions: ['nativeMessaging'],
}
it('lists reviewed permissions once and never offers unsupported grants', () => {
  expect(permissionChoices(review)).toEqual({
    permissions: ['tabs', 'storage', 'clipboardWrite'],
    matchPatterns: ['http://localhost/*', 'https://example.com/*'],
  })
})
it('keeps only explicitly checked, supported manifest grants without granting required permissions implicitly', () => {
  expect(restrictGrant({ permissions: [], matchPatterns: [] }, review)).toEqual({
    permissions: [],
    matchPatterns: [],
  })
  expect(
    restrictGrant(
      {
        permissions: ['tabs', 'tabs', 'nativeMessaging', 'cookies'],
        matchPatterns: ['http://localhost/*', '<all_urls>'],
      },
      review,
    ),
  ).toEqual({ permissions: ['tabs'], matchPatterns: ['http://localhost/*'] })
})

it('offers exact URLs from WebKit URL prompts and sends only checked requested access', () => {
  const prompt = {
    requestId: 'request',
    profileId: 'work',
    extensionId: 'extension',
    tabId: null,
    permissions: [],
    matchPatterns: [],
    urls: ['http://localhost:3000/path', 'http://localhost:3000/path'],
  }
  expect(permissionPromptChoices(prompt)).toEqual({
    permissions: [],
    matchPatterns: ['http://localhost:3000/path'],
  })
  expect(
    restrictPromptGrant(
      { permissions: ['tabs'], matchPatterns: ['http://localhost:3000/path', '<all_urls>'] },
      prompt,
    ),
  ).toEqual({ permissions: [], matchPatterns: ['http://localhost:3000/path'] })
})
