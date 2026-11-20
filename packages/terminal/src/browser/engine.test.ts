import { readFile } from 'node:fs/promises'
import { expect, it } from 'vite-plus/test'
import { Ghostty } from 'ghostty-web'
import { TerminalScreenState } from '../../../runtime/src/terminal/screen.js'

it('keeps text and blank cells intact when a replay recreates the engine and columns change', async () => {
  const bytes = await readFile(new URL('./assets/ghostty-vt.wasm', import.meta.url))
  const ghostty = await Ghostty.load(`data:application/wasm;base64,${bytes.toString('base64')}`)
  const keys = ghostty.createKeyEncoder()
  const options = { scrollbackLimit: 16 * 1024 * 1024 }
  try {
    for (let replay = 0; replay < 3; replay++) {
      const initial = ghostty.createTerminal(100, 18, options)
      try {
        initial.resize(97, 19)
        initial.update()
        initial.getViewport()
        initial.markClean()
      } finally {
        initial.free()
      }
      const terminal = ghostty.createTerminal(97, 19, options)
      try {
        terminal.write('pointer-select-me\r\nSESSION_PRESERVED\r\n')
        for (const cols of [97, 106, 104, 97]) {
          terminal.resize(cols, 19)
          terminal.update()
          const cells = terminal.getViewport()
          for (let row = 0; row < 19; row++) {
            const text = cells
              .slice(row * cols, (row + 1) * cols)
              .map((cell) => (cell.codepoint ? String.fromCodePoint(cell.codepoint) : ' '))
              .join('')
              .trimEnd()
            expect(text).toBe(['pointer-select-me', 'SESSION_PRESERVED'][row] ?? '')
          }
          terminal.markClean()
        }
      } finally {
        terminal.free()
      }
    }
  } finally {
    keys.dispose()
  }
})

it('renders a runtime screen checkpoint and continues live alternate-buffer output', async () => {
  const bytes = await readFile(new URL('./assets/ghostty-vt.wasm', import.meta.url))
  const ghostty = await Ghostty.load(`data:application/wasm;base64,${bytes.toString('base64')}`)
  const terminal = ghostty.createTerminal(40, 10)
  const screen = new TerminalScreenState(40, 10)
  const line = (row: number) =>
    terminal
      .getViewport()
      .slice(row * 40, (row + 1) * 40)
      .map((cell) => (cell.codepoint ? String.fromCodePoint(cell.codepoint) : ' '))
      .join('')
      .trimEnd()
  try {
    screen.write(
      'original prompt\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h\x1b[Hstyled \x1b[31mheading\x1b[0m\x1b[4;4H',
    )
    const checkpoint = await screen.replay()
    if (checkpoint === undefined) throw new Error('Missing runtime screen checkpoint')
    terminal.write(checkpoint)
    terminal.update()
    expect(terminal.isAlternateScreen()).toBe(true)
    expect(line(0)).toBe('styled heading')
    const cursor = terminal.getCursor()
    expect(cursor).toMatchObject({ x: 3, y: 3 })
    expect(Boolean(cursor.visible)).toBe(false)
    expect(terminal.getMode(1002)).toBe(true)
    expect(terminal.getMode(1006)).toBe(true)
    terminal.write('live bytes')
    terminal.update()
    expect(line(3)).toBe('   live bytes')
    terminal.write('\x1b[?1049l')
    terminal.update()
    expect(terminal.isAlternateScreen()).toBe(false)
    expect(line(0)).toBe('original prompt')
  } finally {
    screen.dispose()
    terminal.free()
  }
})
