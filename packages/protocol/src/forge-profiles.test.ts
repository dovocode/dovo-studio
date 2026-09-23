import { decodeResult, decode } from './schema.js'
import { expect, it } from 'vitest'
import { forgeCliProfileQuerySchema, forgeConnectionInputSchema } from './forges.js'
it.each(['', 'h', 'https:', 'https://'])(
  'validates an unfinished server URL without throwing: %s',
  (baseUrl) => {
    expect(
      decodeResult(forgeCliProfileQuerySchema, {
        provider: 'forgejo',
        baseUrl,
      }).success,
    ).toBe(false)
    expect(
      decodeResult(forgeConnectionInputSchema, {
        provider: 'forgejo',
        baseUrl,
        name: 'Work',
        credential: 'cli',
        cliTool: 'tea',
        cliProfile: 'work',
      }).success,
    ).toBe(false)
  },
)
it('still rejects credentials and query strings in discovery server URLs', () => {
  for (const baseUrl of [
    'https://user:secret@git.example.com',
    'https://git.example.com?token=secret',
  ])
    expect(
      decodeResult(forgeCliProfileQuerySchema, {
        provider: 'forgejo',
        baseUrl,
      }).success,
    ).toBe(false)
  expect(
    decode(forgeCliProfileQuerySchema, {
      provider: 'forgejo',
      baseUrl: 'https://git.example.com/base',
    }).baseUrl,
  ).toBe('https://git.example.com/base')
})
