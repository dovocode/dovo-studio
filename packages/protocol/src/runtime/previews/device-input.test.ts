import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema'
import { simulatorInputSchema } from './device-input'
import { deviceDeepLink, previewUrl } from './previews'

it('validates native gesture coordinates, durations and required endpoints', () => {
  const drag = {
    type: 'gesture',
    gesture: 'drag',
    x: 20,
    y: 30,
    endX: 100,
    endY: 200,
    durationMs: 300,
  }
  expect(decodeResult(simulatorInputSchema, drag).success).toBe(true)
  for (const input of [
    { ...drag, endX: undefined },
    { ...drag, x: -1 },
    { ...drag, endY: Infinity },
    { ...drag, durationMs: 5001 },
    { ...drag, durationMs: 0 },
    { ...drag, gesture: 'pinch', startRadius: 0, endRadius: 20 },
    { type: 'device-button', button: 'run-shell' },
  ])
    expect(decodeResult(simulatorInputSchema, input).success).toBe(false)
  expect(
    decodeResult(simulatorInputSchema, {
      ...drag,
      gesture: 'pinch',
      startRadius: 20,
      endRadius: 100,
    }).success,
  ).toBe(true)
  expect(
    decodeResult(simulatorInputSchema, { type: 'device-button', button: 'app-switcher' }).success,
  ).toBe(true)
})

it('allows explicit native deep links while preserving HTTP-only web previews', () => {
  expect(deviceDeepLink('dovo://thread/123')).toBe('dovo://thread/123')
  expect(
    deviceDeepLink('exp+dovo://expo-development-client/?url=http%3A%2F%2Fhost%3A8081'),
  ).toContain('exp+dovo:')
  expect(deviceDeepLink('http://host:8081')).toBe('http://host:8081/')
  expect(() => previewUrl('dovo://thread/123')).toThrow('HTTP or HTTPS')
  for (const value of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,hi',
    'intent://anything',
    'dovo://user:pass@host',
    'dovo://host\n/path',
    'relative/path',
  ]) {
    expect(() => deviceDeepLink(value)).toThrow(/deep link|HTTP|Invalid URL/)
  }
})
