import { expect, it } from 'vite-plus/test'
import { formatTurnDuration } from './turn-duration'
it('uses seconds only during the first minute and minutes thereafter', () => {
  for (const [seconds, label] of [
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [119, '1m'],
    [3599, '59m'],
    [3600, '1h 0m'],
    [3661, '1h 1m'],
  ] as const)
    expect(formatTurnDuration(seconds * 1000)).toBe(label)
  expect(formatTurnDuration(-1000)).toBe('0s')
  expect(formatTurnDuration(NaN)).toBe('')
})
