import { expect, it, vi } from 'vite-plus/test'
import { resolveCodeTheme } from '@dovo/studio-core/code-themes'
import { statusColors } from '@dovo/studio-core/accessibility'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}))

import { createMobileTheme } from './theme'

it('uses the selected status palette and strong borders in mobile settings and thread surfaces', () => {
  const regular = createMobileTheme('iris', 'dark')
  const accessible = createMobileTheme('iris', 'dark', undefined, {
    highContrast: true,
    colorVision: 'blue-orange',
  })
  expect(accessible.colors).toMatchObject({
    ...statusColors('dark', 'blue-orange'),
    border: '#888888',
    text: '#ffffff',
  })
  expect(accessible.highContrast).toBe(true)
  expect(regular.colors.border).not.toBe(accessible.colors.border)
})

it.each(['light', 'dark'] as const)(
  'uses the code theme mode for %s diff colors even when the app mode differs',
  (mode) => {
    const codeTheme = resolveCodeTheme('dovo', [], 'dovo', mode)
    const theme = createMobileTheme(
      'iris',
      mode === 'light' ? 'dark' : 'light',
      { theme: codeTheme, custom: true },
      { colorVision: 'blue-orange' },
    )
    expect(theme.code?.colors.addition).toBe(statusColors(mode, 'blue-orange').success)
    expect(theme.code?.colors.deletion).toBe(statusColors(mode, 'blue-orange').error)
    expect(theme.code?.custom).toBe(true)
    expect(theme.syntaxTheme).toBe(codeTheme)
  },
)

it.each(['default', 'blue-orange'] as const)(
  'keeps %s diff semantics independent of imported syntax colors',
  (colorVision) => {
    for (const mode of ['light', 'dark'] as const) {
      const codeTheme = {
        ...resolveCodeTheme('dovo', [], 'dovo', mode),
        label: 'Conflicting diff colors',
        colors: {
          'editorGutter.addedBackground': '#ff0000',
          'editorGutter.deletedBackground': '#00ff00',
        },
      }
      const theme = createMobileTheme(
        'sand',
        mode,
        { theme: codeTheme, custom: true },
        { colorVision },
      )
      expect(theme.code?.colors.addition).toBe(statusColors(mode, colorVision).success)
      expect(theme.code?.colors.deletion).toBe(statusColors(mode, colorVision).error)
      expect(theme.colors.done).toBe(statusColors(mode, colorVision).done)
    }
  },
)
