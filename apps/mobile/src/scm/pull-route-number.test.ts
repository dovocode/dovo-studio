import { describe, expect, it } from 'vite-plus/test'
import { pullRouteNumber } from './pull-route-number'

describe('PR route number', () => {
  it('accepts positive safe-integer PR numbers', () => {
    expect(pullRouteNumber('7')).toBe(7)
    expect(pullRouteNumber(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects malformed route parameters before any provider request', () => {
    for (const value of [
      undefined,
      ['7'],
      '',
      '0',
      '-1',
      '1.5',
      '1e3',
      'Infinity',
      'NaN',
      '7junk',
      ' 7 ',
      '9007199254740992',
    ])
      expect(pullRouteNumber(value)).toBeUndefined()
  })
})
