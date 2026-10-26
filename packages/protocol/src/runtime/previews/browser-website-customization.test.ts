import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { browserProfilesSchema, browserWebsiteOriginSchema } from './browser-profiles.js'
import {
  websiteCustomizationProposal,
  websiteCustomizationPrompt,
  browserWebsiteScriptError,
} from './browser-website-customization.js'

const site = {
  origin: 'http://example.test',
  enabled: true,
  css: 'body { color: red }',
  script: '',
}
it('checks script syntax without running user code and rejects escaping the function body', () => {
  expect(browserWebsiteScriptError('throw new Error("must not execute")')).toBeUndefined()
  expect(browserWebsiteScriptError('}); globalThis.escaped = true; (() => {')).toBeTruthy()
  expect(browserWebsiteScriptError('if (')).toBeTruthy()
})
const proposal = (value: unknown) =>
  `A proposed change.\n\n\`\`\`dovo-website-customization\n${JSON.stringify(value)}\n\`\`\``
it('accepts exact HTTP LAN/VPN origins and rejects patterns, paths and credentials', () => {
  for (const origin of ['http://100.101.102.103:3000', 'http://[::1]:3000', 'https://example.test'])
    expect(decodeResult(browserWebsiteOriginSchema, origin).success).toBe(true)
  for (const origin of [
    '*',
    'https://*.test',
    'file:///',
    'http://example.test/path',
    'http://example.test/',
    'http://user:pass@example.test',
    'https://EXAMPLE.test',
  ])
    expect(decodeResult(browserWebsiteOriginSchema, origin).success).toBe(false)
})
it('preserves website rules per profile and disallows ambiguous or oversized rules', () => {
  const profiles = [
    { id: 'default', name: 'Default', websites: [site] },
    { id: 'work', name: 'Work', websites: [{ ...site, css: '' }] },
  ]
  expect(decodeResult(browserProfilesSchema, profiles)).toMatchObject({
    success: true,
    data: profiles,
  })
  for (const websites of [
    [site, site],
    [{ ...site, css: 'x'.repeat(64001) }],
    [{ ...site, script: 'x'.repeat(64001) }],
  ])
    expect(decodeResult(browserProfilesSchema, [{ ...profiles[0], websites }]).success).toBe(false)
})
it('reviews only complete assistant proposals for the current origin', () => {
  expect(
    websiteCustomizationProposal([{ role: 'user', text: proposal(site) }], site.origin),
  ).toBeUndefined()
  expect(
    websiteCustomizationProposal(
      [{ role: 'assistant', text: proposal({ ...site, origin: 'http://other.test' }) }],
      site.origin,
    ),
  ).toBeUndefined()
  expect(
    websiteCustomizationProposal(
      [{ role: 'assistant', text: '```dovo-website-customization\n{' }],
      site.origin,
    ),
  ).toBeUndefined()
  expect(
    websiteCustomizationProposal([{ role: 'assistant', text: proposal(site) }], site.origin),
  ).toEqual(site)
  expect(websiteCustomizationPrompt('work', site, site.origin + '/page')).toContain(
    'Browser profile: "work"',
  )
})
