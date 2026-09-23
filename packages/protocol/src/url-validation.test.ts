import { decodeResult } from './schema.js'
import { expect, it } from 'vitest'
import { connectionSchema } from './runtime.js'
import { runtimeRegistrySchema } from './runtime-fleet.js'
import { jiraBindingSchema } from './jira.js'
import { forgeWorkResultSchema } from './forge-work.js'
import { pullActionResultSchema } from './forges.js'
const credentialFreeURLs = [
  connectionSchema.fields.address,
  forgeWorkResultSchema.fields.url.from,
  pullActionResultSchema.fields.url,
]
it.each(['', 'h', 'https:', 'https://', 'https://[', '//example.com', 'not a url'])(
  'returns validation failures for malformed URLs without throwing: %s',
  (value) => {
    for (const schema of [...credentialFreeURLs, jiraBindingSchema.fields.site])
      expect(decodeResult(schema, value).success).toBe(false)
    expect(
      decodeResult(runtimeRegistrySchema, {
        version: 1,
        activeId: 'http://localhost:51464',
        profiles: [
          {
            id: 'http://localhost:51464',
            name: 'Desktop',
            connection: {
              address: value,
              token: 'fixture-token-at-least-twenty-characters',
            },
          },
        ],
      }).success,
    ).toBe(false)
  },
)
it('preserves credential and protocol restrictions while allowing valid paths and queries', () => {
  for (const schema of credentialFreeURLs) {
    for (const value of ['https://user:secret@example.com/path', 'ftp://example.com/path'])
      expect(decodeResult(schema, value).success).toBe(false)
    for (const value of ['https://example.com/path?query=1#section', 'http://localhost:51464'])
      expect(decodeResult(schema, value).success).toBe(true)
  }
})
it('preserves Jira Cloud host, HTTPS and root URL restrictions', () => {
  expect(decodeResult(jiraBindingSchema.fields.site, 'https://team.atlassian.net').success).toBe(
    true,
  )
  for (const site of [
    'http://team.atlassian.net',
    'https://team.example.com',
    'https://user:secret@team.atlassian.net',
    'https://team.atlassian.net/path',
    'https://team.atlassian.net?query=1',
    'https://team.atlassian.net#fragment',
    'https://team.atlassian.net:51464',
  ])
    expect(decodeResult(jiraBindingSchema.fields.site, site).success).toBe(false)
})
it('keeps a saved computer ID when its valid connection address changes', () => {
  const profile = {
    id: 'http://localhost:51464',
    name: 'Desktop',
    connection: {
      address: 'http://localhost:51464',
      token: 'fixture-token-at-least-twenty-characters',
    },
  }
  expect(
    decodeResult(runtimeRegistrySchema, {
      version: 1,
      activeId: profile.id,
      profiles: [profile],
    }).success,
  ).toBe(true)
  expect(
    decodeResult(runtimeRegistrySchema, {
      version: 1,
      activeId: null,
      profiles: [
        {
          ...profile,
          id: 'http://other:51464',
        },
      ],
    }).success,
  ).toBe(true)
})
