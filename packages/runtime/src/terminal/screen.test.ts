import { expect, it } from 'vite-plus/test'
import { TerminalScreenState } from './screen.js'

it('reads ordered viewport and bounded scrollback around resizes and alternate buffers', async () => {
  const state = new TerminalScreenState(20, 3)
  try {
    state.write('history\r\nfirst\r\nsecond\r\nlast')
    expect(await state.screen('pty')).toMatchObject({
      text: 'first\nsecond\nlast',
      buffer: 'normal',
    })
    expect(await state.screen('pty', 4)).toMatchObject({ text: 'history\nfirst\nsecond\nlast' })

    state.write('\x1b[?1049h\x1b[2J\x1b[Hstale text\r\x1b[2K')
    state.resize(23, 5)
    state.write('\x1b[Htop panel\x1b[3;3H')
    const first = state.screen('pty', 20)
    state.write('later')
    expect(await first).toEqual({
      id: 'pty',
      cols: 23,
      rows: 5,
      buffer: 'alternate',
      cursor: { row: 2, column: 2 },
      text: 'top panel\n\n\n\n',
      truncated: false,
    })
    expect(await state.screen('pty')).toMatchObject({ text: 'top panel\n\n  later\n\n' })

    state.write('\x1b[?1049l')
    expect((await state.screen('pty', 20))?.text).toContain('history\nfirst\nsecond\nlast')
  } finally {
    state.dispose()
  }
})

it('waits for complete UTF-16 and VT fragments before serializing', async () => {
  const state = new TerminalScreenState(20, 4)
  try {
    state.write('\x1b[?1049h\x1b[2J\x1b[')
    expect(await state.replay()).toBeUndefined()
    state.write('2;3H\ud83d')
    expect(await state.replay()).toBeUndefined()
    state.write('\ude42')
    expect(await state.replay()).toContain('🙂')
    expect(await state.screen('pty')).toMatchObject({ cursor: { row: 1, column: 3 } })
  } finally {
    state.dispose()
  }
})

it('keeps incomplete screen state from being returned after a parser backlog overflow', async () => {
  const state = new TerminalScreenState(20, 4)
  state.write('begin')
  const first = state.screen('pty')
  state.write('a'.repeat(2 * 1024 * 1024))
  expect(await first).toBeUndefined()
  expect(await state.screen('pty')).toBeUndefined()
  expect(await state.replay()).toBeUndefined()
})

it('releases PTY pressure when a queued output burst is parsed', async () => {
  const pressure: boolean[] = []
  const state = new TerminalScreenState(20, 4, (paused) => pressure.push(paused))
  try {
    state.write('\x1b[0m'.repeat(80_000))
    state.write('last output')
    expect(pressure).toEqual([true])
    expect((await state.screen('pty'))?.text).toContain('last output')
    expect(pressure).toEqual([true, false])
  } finally {
    state.dispose()
  }
})
