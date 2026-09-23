import { decodeResult } from './schema.js'
import { describe, expect, it } from 'vitest'
import { previewUrl, browserCommandSchema } from './previews'
describe('preview addresses', () => {
  it('resolves loopback against the task runtime while retaining port, path and query', () => {
    expect(previewUrl('localhost:3000/demo?q=one', 'http://workstation.internal:8787')).toBe(
      'http://workstation.internal:3000/demo?q=one',
    )
    expect(previewUrl('http://[::1]:8081', 'http://[fd00::1]:8787')).toBe('http://[fd00::1]:8081/')
    expect(previewUrl('https://example.com/demo', 'http://remote:8787')).toBe(
      'https://example.com/demo',
    )
  })
  it.each([
    '',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hello',
    'https://user:secret@example.com',
  ])('rejects unsafe URL %s', (value) => {
    expect(() => previewUrl(value)).toThrow(/HTTP or HTTPS/)
  })
  it('requires bounded integer native view coordinates', () => {
    expect(
      decodeResult(browserCommandSchema, {
        action: 'show',
        key: 'task',
        url: 'https://example.com',
        bounds: {
          x: -1,
          y: 0,
          width: 100,
          height: 100,
        },
      }).success,
    ).toBe(false)
  })
})
