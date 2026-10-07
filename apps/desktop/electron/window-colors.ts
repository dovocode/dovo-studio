import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Native window chrome the renderer cannot paint: the Windows and Linux title bar overlay
 * (caption buttons) and the window background shown before the first frame. */
export type WindowColors = { background: string; symbol: string }
const hex = /^#[0-9a-f]{6}$/i
const file = 'window-colors.json'
export function parseWindowColors(value: unknown): WindowColors | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { background, symbol } = value as Record<string, unknown>
  if (typeof background !== 'string' || typeof symbol !== 'string') return undefined
  if (!hex.test(background) || !hex.test(symbol)) return undefined
  return { background: background.toLowerCase(), symbol: symbol.toLowerCase() }
}
/** Before the renderer reports its palette, follow the operating system's scheme. */
export function defaultWindowColors(dark: boolean): WindowColors {
  return dark
    ? { background: '#080808', symbol: '#a3a3a3' }
    : { background: '#ffffff', symbol: '#525252' }
}
export function readWindowColors(directory: string): WindowColors | undefined {
  try {
    return parseWindowColors(JSON.parse(readFileSync(join(directory, file), 'utf8')))
  } catch {
    return undefined
  }
}
export function writeWindowColors(directory: string, colors: WindowColors) {
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, file), JSON.stringify(colors), { mode: 0o600 })
  } catch {
    // Cosmetic; the next report tries again.
  }
}
/** Electron's overlay takes the caption background and glyph colour; height matches the app's
 * title bar so the buttons sit on the same strip as the drag region. */
export function titleBarOverlay(colors: WindowColors) {
  return { color: colors.background, symbolColor: colors.symbol, height: 44 }
}
