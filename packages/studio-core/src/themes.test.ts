import { expect, it } from 'vitest'
import { studioThemeIds, studioThemes } from './themes'

function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

for (const id of studioThemeIds) {
  for (const mode of ['dark', 'light'] as const) {
    it(`${id} ${mode} keeps interface text and actions readable`, () => {
      const colors = studioThemes[id][mode]
      for (const surface of ['background', 'sidebar', 'card', 'popover', 'secondary'] as const) {
        expect(contrast(colors.foreground, colors[surface])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors['muted-foreground'], colors[surface])).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(colors.action, colors['action-foreground'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.primary, colors.background)).toBeGreaterThanOrEqual(4.5)
      for (const token of ['syntax-function', 'syntax-keyword', 'signal', 'pink'] as const)
        expect(contrast(colors[token], colors.card)).toBeGreaterThanOrEqual(4.5)
    })
  }
}
