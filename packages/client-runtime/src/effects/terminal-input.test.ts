import { expect, it } from 'vite-plus/test'
import { terminalInputFrames } from './terminal-input.js'
it.each(['x', '\u0000', '界', '😀'])(
  'preserves large %s pastes within byte and character limits',
  (unit) => {
    const data = unit.repeat(100000)
    const frames = terminalInputFrames(data)
    expect(frames.map((frame) => frame.data).join('')).toBe(data)
    for (const frame of frames) {
      expect(frame.data.length).toBeLessThanOrEqual(65536)
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(128 * 1024)
      expect(frame.data.isWellFormed()).toBe(true)
    }
  },
)
