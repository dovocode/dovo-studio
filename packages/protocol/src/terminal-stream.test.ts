import { expect, it } from 'vite-plus/test'
import { decodeTerminalStreamFrame, encodeTerminalStreamFrame } from './terminal-stream.js'

it('round trips binary terminal frames and rejects malformed controls', () => {
  for (const frame of [
    { type: 'data', data: new TextEncoder().encode('hello 🙂') },
    { type: 'replayStart' },
    { type: 'replayEnd' },
    { type: 'pong', nonce: 'test' },
  ] as const)
    expect(decodeTerminalStreamFrame(encodeTerminalStreamFrame(frame))).toEqual(frame)
  expect(() => decodeTerminalStreamFrame(new Uint8Array())).toThrow()
  expect(() => decodeTerminalStreamFrame(new Uint8Array([1, 0]))).toThrow()
  expect(() => decodeTerminalStreamFrame(new Uint8Array([3, 123]))).toThrow()
})
