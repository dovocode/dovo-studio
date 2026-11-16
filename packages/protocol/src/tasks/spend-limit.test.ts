import { expect, it } from 'vite-plus/test'
import { formatSpendUsd, unattendedSpendLimitInput } from './spend-limit.js'

it('reads the limit from settings text', () => {
  expect(unattendedSpendLimitInput(' $5 ')).toBe(5)
  expect(unattendedSpendLimitInput('0.5')).toBe(0.5)
  for (const text of ['', '  ', '$', '0', '-1', 'five', '10001', 'Infinity'])
    expect(unattendedSpendLimitInput(text)).toBeUndefined()
  expect(formatSpendUsd(5.234)).toBe('$5.23')
})
