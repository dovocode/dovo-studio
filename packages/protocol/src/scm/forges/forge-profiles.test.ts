import { decodeResult, decode } from '../../shared/schema.js'
import { expect, it } from 'vite-plus/test'
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

it('validates wrapper selectors separately from named GitHub users and secrets', () => {
  const github = {
    name: 'Work',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh-wrapper',
    cliEnv: { GH_ACCOUNT: 'work' },
  }
  expect(decode(forgeConnectionInputSchema, github).cliEnv).toEqual({ GH_ACCOUNT: 'work' })
  for (const input of [
    { ...github, cliEnv: {} },
    { ...github, cliProfile: 'work' },
    { ...github, provider: 'forgejo' },
    { ...github, cliEnv: { GH_TOKEN: 'secret' } },
    { ...github, cliEnv: { GH_REPO: 'other/repo' } },
    { ...github, cliEnv: { 'bad-name': 'work' } },
  ])
    expect(decodeResult(forgeConnectionInputSchema, input).success).toBe(false)
})
