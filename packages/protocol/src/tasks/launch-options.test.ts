import { expect, it } from 'vite-plus/test'
import { parseAgentEnvironment, formatAgentEnvironment } from './launch-options'
it('preserves values containing equals, spaces and empty values', () => {
  const env = { HOME_DIR: '/path with spaces', FILTER: 'a=b', EMPTY: '' }
  expect(parseAgentEnvironment(formatAgentEnvironment(env))).toEqual(env)
})
it('rejects malformed names and runtime credentials', () => {
  for (const text of [
    'oops',
    '1NAME=value',
    '=value',
    'DOVO_OWNER_TOKEN=secret',
    'ELECTRON_RUN_AS_NODE=1',
  ])
    expect(() => parseAgentEnvironment(text)).toThrow(/Environment variables|cannot be passed/)
})
