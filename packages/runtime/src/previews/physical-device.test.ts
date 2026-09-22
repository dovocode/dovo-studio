import { expect, it } from 'vitest'
import { physicalPoint, physicalKeys } from './physical-device'

it('maps portrait and landscape preview pixels into native touchscreen coordinates', () => {
  expect(physicalPoint(200, 400, 400, 800)).toEqual({ x: 32768, y: 32768 })
  expect(physicalPoint(800, 0, 800, 400)).toEqual({ x: 65535, y: 0 })
  expect(physicalPoint(-10, 900, 400, 800)).toEqual({ x: 0, y: 65535 })
})
it('rejects input before a frame or with invalid coordinates', () => {
  for (const values of [
    [1, 1, 0, 0],
    [NaN, 0, 400, 800],
    [0, 0, Infinity, 800],
  ])
    expect(() => physicalPoint(values[0], values[1], values[2], values[3])).toThrow(
      'Wait for the physical device screen before sending input',
    )
})
it('preserves case and modifiers without pressing duplicate keys', () => {
  expect(physicalKeys('A')).toEqual([225, 4])
  expect(physicalKeys('Meta+a')).toEqual([227, 4])
  expect(physicalKeys('Shift+A')).toEqual([225, 4])
  expect(physicalKeys('Enter')).toEqual([40])
  expect(() => physicalKeys('Unknown+a')).toThrow('This physical device key is not supported')
  expect(() => physicalKeys('Unrecognized')).toThrow('This physical device key is not supported')
})
