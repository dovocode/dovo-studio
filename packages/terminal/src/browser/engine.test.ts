import { readFile } from 'node:fs/promises'
import { expect, it } from 'vite-plus/test'
import { Ghostty } from 'ghostty-web'

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
