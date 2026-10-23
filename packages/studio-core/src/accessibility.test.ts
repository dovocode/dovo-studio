import { expect, it } from 'vite-plus/test'
import { accessibleThemeColors, statusColors } from './accessibility'
import { studioThemeIds, studioThemes } from './themes'

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

for (const mode of ['light', 'dark'] as const) {
  for (const id of studioThemeIds) {
    it(`${id} ${mode} has readable status colors and higher-contrast surfaces`, () => {
      const original = studioThemes[id][mode]
      expect(accessibleThemeColors(original, mode, false)).toBe(original)
      const high = accessibleThemeColors(original, mode, true)
      for (const surface of ['background', 'sidebar', 'card', 'popover', 'secondary'] as const) {
        expect(contrast(high.foreground, high[surface])).toBeGreaterThanOrEqual(7)
        expect(contrast(high['muted-foreground'], high[surface])).toBeGreaterThanOrEqual(7)
        expect(contrast(high.border, high[surface])).toBeGreaterThanOrEqual(3)
        for (const colorVision of ['default', 'blue-orange'] as const) {
          const status = statusColors(mode, colorVision)
          for (const color of [status.success, status.error, status.warning, status.done]) {
            expect(contrast(color, original[surface])).toBeGreaterThanOrEqual(4.5)
            expect(contrast(color, high[surface])).toBeGreaterThanOrEqual(4.5)
          }
          expect(contrast(status.error, status.onError)).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(contrast(high.action, high['action-foreground'])).toBeGreaterThanOrEqual(7)
      expect(contrast(high.primary, high.background)).toBeGreaterThanOrEqual(4.5)
      expect(studioThemes[id][mode]).toBe(original)
    })
  }
}
