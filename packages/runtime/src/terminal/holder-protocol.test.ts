import { expect, it, vi } from 'vite-plus/test'
import {
  HOLDER_DATA_CHUNK,
  HOLDER_LINE_LIMIT,
  HOLDER_REPLAY_LIMIT,
  HolderOutput,
  JSON_ESCAPE_FACTOR,
  lineReader,
  splitText,
} from './holder-protocol'

function reader(limit = 10) {
  const onLine = vi.fn<(line: string) => void>()
  const onOverflow = vi.fn<() => void>()
  return { read: lineReader(onLine, onOverflow, limit), onLine, onOverflow }
}

it('joins split frames and separates coalesced frames', () => {
  const { read, onLine, onOverflow } = reader()
  read('{"a"')
  read(':1}\n{"b":2}\n{')
  read('}\n\n')
  expect(onLine.mock.calls.map(([line]) => line)).toEqual(['{"a":1}', '{"b":2}', '{}'])
  expect(onOverflow).not.toHaveBeenCalled()
})

it('accepts a line at the limit and rejects a complete longer line before parsing it', () => {
  const { read, onLine, onOverflow } = reader()
  read('x'.repeat(10) + '\n')
  expect(onLine).toHaveBeenCalledWith('x'.repeat(10))
  // The long line, the valid line after it in the same chunk and later chunks are all ignored.
  read('y'.repeat(11) + '\nshort\n')
  read('later\n')
  expect(onLine).toHaveBeenCalledTimes(1)
  expect(onOverflow).toHaveBeenCalledTimes(1)
})

it('rejects a long line that arrives in pieces as soon as it passes the limit', () => {
  const { read, onLine, onOverflow } = reader()
  read('12345')
  read('67890')
  expect(onOverflow).not.toHaveBeenCalled()
  read('1')
  expect(onOverflow).toHaveBeenCalledTimes(1)
  read('\nok\n')
  expect(onLine).not.toHaveBeenCalled()
  expect(onOverflow).toHaveBeenCalledTimes(1)
  // A piece of a long line that ends in a newline is still too long.
  const split = reader()
  split.read('123456')
  split.read('78901\nok\n')
  expect(split.onLine).not.toHaveBeenCalled()
  expect(split.onOverflow).toHaveBeenCalledTimes(1)
})

it('fits the full replay with worst-case JSON escaping in one message', () => {
  // A replay of control characters, plus the reply fields, must fit one line.
  expect(HOLDER_LINE_LIMIT).toBeGreaterThanOrEqual(
    HOLDER_REPLAY_LIMIT * JSON_ESCAPE_FACTOR + 64 * 1024,
  )
  const replay = '\x07'.repeat(HOLDER_REPLAY_LIMIT)
  const line = JSON.stringify({
    t: 'reply',
    r: Number.MAX_SAFE_INTEGER,
    ok: true,
    terminal: { id: 'x'.repeat(36), pid: 1, end: 2 ** 40, process: 'p'.repeat(255), exited: false },
    screen: { kind: 'unavailable' },
    replay,
  })
  expect(line.length).toBeLessThanOrEqual(HOLDER_LINE_LIMIT)
  // Streamed pieces stay far below the limit too.
  expect(
    JSON.stringify({ t: 'data', id: 'x'.repeat(36), data: '\x07'.repeat(HOLDER_DATA_CHUNK) })
      .length,
  ).toBeLessThan(HOLDER_LINE_LIMIT / 16)
})

it('splits input and output without separating a surrogate pair', () => {
  const text = 'a' + '😀'.repeat(5)
  const pieces = splitText(text, 4)
  expect(pieces.join('')).toBe(text)
  for (const piece of pieces) {
    expect(piece.length).toBeLessThanOrEqual(4)
    expect(piece).toBe(piece.toWellFormed())
  }
  expect(splitText('short', 4096)).toEqual(['short'])
})

it('keeps the newest output and exact offsets under many tiny writes', () => {
  const output = new HolderOutput()
  let expected = ''
  for (let index = 0; index < HOLDER_REPLAY_LIMIT + 10_000; index++) {
    const character = String.fromCharCode(97 + (index % 26))
    output.append(character)
    if (index >= 10_000) expected += character
  }
  expect(output.end).toBe(HOLDER_REPLAY_LIMIT + 10_000)
  expect(output.start).toBe(10_000)
  expect(output.since()).toBe(expected)
  expect(output.since(output.end - 3)).toBe(expected.slice(-3))
  // Tiny writes still in the 4 KiB join buffer are part of the replay.
  output.append('!')
  expect(output.since(output.end - 1)).toBe('!')
})
