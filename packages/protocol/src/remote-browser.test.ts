import { decodeResult } from './schema.js'
import { expect, it } from 'vitest'
import { remoteBrowserInputSchema, remoteBrowserViewportSchema } from './remote-browser'
import { previewUrl } from './previews'
it('keeps host-local URLs on the host and only allows HTTP navigation', () => {
  expect(previewUrl('localhost:3000/path')).toBe('http://localhost:3000/path')
  for (const value of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://user:pass@example.com',
  ]) {
    expect(() => previewUrl(value)).toThrow(/HTTP or HTTPS/)
  }
})
it('bounds frames, pointer coordinates, scroll bursts and typed text', () => {
  expect(
    decodeResult(remoteBrowserViewportSchema, {
      width: 390,
      height: 844,
    }).success,
  ).toBe(true)
  expect(
    decodeResult(remoteBrowserViewportSchema, {
      width: 9000,
      height: 844,
    }).success,
  ).toBe(false)
  expect(
    decodeResult(remoteBrowserInputSchema, {
      type: 'pointer',
      phase: 'down',
      x: -10,
      y: 10,
    }).success,
  ).toBe(false)
  expect(
    decodeResult(remoteBrowserInputSchema, {
      type: 'scroll',
      x: 1,
      y: 2,
      deltaX: 0,
      deltaY: Infinity,
    }).success,
  ).toBe(false)
  expect(
    decodeResult(remoteBrowserInputSchema, {
      type: 'text',
      text: 'x'.repeat(16001),
    }).success,
  ).toBe(false)
  expect(
    decodeResult(remoteBrowserInputSchema, {
      type: 'evaluate',
      expression: 'process.env',
    }).success,
  ).toBe(false)
})
it('accepts keyboard shortcuts without exposing arbitrary protocol commands', () => {
  for (const key of [
    'Backspace',
    'Enter',
    'Control+a',
    'Meta+Shift+z',
    'Shift+ArrowLeft',
    'Meta+/',
  ]) {
    expect(
      decodeResult(remoteBrowserInputSchema, {
        type: 'key',
        key,
      }).success,
    ).toBe(true)
  }
  for (const key of ['', '\n', 'Control+unknown', 'Runtime.evaluate']) {
    expect(
      decodeResult(remoteBrowserInputSchema, {
        type: 'key',
        key,
      }).success,
    ).toBe(false)
  }
})
it('round-trips binary frames and rejects malformed dimensions and headers', async () => {
  const { encodeBrowserFrame, decodeBrowserFrame } = await import('./browser-frames')
  const data = Uint8Array.from([255, 216, 255, 217])
  const packet = encodeBrowserFrame(
    {
      data,
      width: 390,
      height: 844,
    },
    7,
  )
  expect(decodeBrowserFrame(packet.buffer)).toEqual({
    sequence: 7,
    width: 390,
    height: 844,
    data,
  })
  expect(() => decodeBrowserFrame(new ArrayBuffer(12))).toThrow('size')
  new DataView(packet.buffer).setUint32(4, 9000)
  expect(() => decodeBrowserFrame(packet.buffer)).toThrow('dimensions')
})
