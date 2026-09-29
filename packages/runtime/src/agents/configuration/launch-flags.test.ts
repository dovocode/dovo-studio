import { expect, it } from 'vitest'
import { claudeLaunchFlags } from './launch-flags'
it('passes boolean flags and exact values without shell interpretation', () => {
  expect(claudeLaunchFlags(['--verbose', '--settings=/path with spaces', '--value=a=b'])).toEqual({
    verbose: null,
    settings: '/path with spaces',
    value: 'a=b',
  })
})
it('rejects positional arguments instead of silently dropping them', () => {
  expect(() => claudeLaunchFlags(['--settings', 'file.json'])).toThrow('Claude flags')
})
