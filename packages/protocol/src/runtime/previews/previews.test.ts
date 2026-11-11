import { decodeResult } from '../../shared/schema.js'
import { describe, expect, it } from 'vite-plus/test'
import { previewUrl, browserCommandSchema, desktopBrowserHostSchema } from './previews'
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
  it('validates layout updates while an overlay covers a native page', () => {
    const input = {
      action: 'hide',
      key: 'tab',
      occluded: true,
      bounds: { x: 0, y: 44, width: 600, height: 400 },
    }
    expect(decodeResult(browserCommandSchema, input)).toMatchObject({ success: true, data: input })
    expect(
      decodeResult(browserCommandSchema, { ...input, bounds: { ...input.bounds, width: NaN } })
        .success,
    ).toBe(false)
    expect(
      decodeResult(browserCommandSchema, { ...input, bounds: { ...input.bounds, x: -1 } }).success,
    ).toBe(false)
  })
  it('validates a retained live opener with bounded coordinates', () => {
    const input = {
      action: 'show',
      key: 'child',
      url: 'https://example.com',
      bounds: { x: 20, y: 80, width: 500, height: 300 },
      background: { key: 'opener', bounds: { x: 0, y: 40, width: 600, height: 400 } },
    }
    expect(decodeResult(browserCommandSchema, input)).toMatchObject({ success: true, data: input })
    expect(
      decodeResult(browserCommandSchema, {
        ...input,
        background: { ...input.background, bounds: { ...input.background.bounds, width: NaN } },
      }).success,
    ).toBe(false)
  })
  it('preserves a typed passive-overlay focus request without changing ordinary hide commands', () => {
    const input = { action: 'hide', key: 'task', preserveFocus: true }
    expect(decodeResult(browserCommandSchema, input)).toMatchObject({ success: true, data: input })
    expect(decodeResult(browserCommandSchema, { action: 'hide', key: 'task' }).success).toBe(true)
    expect(decodeResult(browserCommandSchema, { ...input, preserveFocus: 'true' }).success).toBe(
      false,
    )
  })
})

describe('desktop browser CDP discovery', () => {
  const token = 'a1'.repeat(32)
  const endpoint = `ws://127.0.0.1:43210/${token}/devtools/page/7`
  const accepts = (value: string) =>
    decodeResult(desktopBrowserHostSchema, {
      pid: 123,
      targets: [{ taskId: 'studio:browser', tabId: 'tab-1', profileId: 'work', endpoint: value }],
    }).success

  it('accepts authenticated loopback page endpoints with numeric transport IDs', () => {
    expect(accepts(endpoint)).toBe(true)
  })

  it.each([
    endpoint.replace('127.0.0.1', '192.168.1.2'),
    endpoint.replace('127.0.0.1', 'localhost'),
    endpoint.replace('ws://', 'https://'),
    endpoint.replace('127.0.0.1', 'user:secret@127.0.0.1'),
    endpoint.replace(`${token}/`, ''),
    endpoint.replace(token, 'a1'.repeat(31)),
    endpoint.replace(token, 'z'.repeat(64)),
    endpoint.replace('/page/7', '/browser/7'),
    endpoint.replace('/page/7', '/page/[1,"studio:browser:tab-1"]'),
    `${endpoint}?token=extra`,
    `${endpoint}#fragment`,
    `${endpoint}/extra`,
  ])('rejects endpoints outside the loopback capability format: %s', (value) => {
    expect(accepts(value)).toBe(false)
  })
})
