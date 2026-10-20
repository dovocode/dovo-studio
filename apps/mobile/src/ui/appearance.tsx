import { useReducedMotion } from './use-reduced-motion'
import { resolveCodeTheme } from '@dovo/studio-core/code-themes'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Appearance, useColorScheme } from 'react-native'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { createMobileTheme, MobileThemeContext } from './theme'

export function MobileAppearance({ children }: { children: ReactNode }) {
  const { theme, themePalette, codeTheme, importedCodeThemes, highContrast, colorVision } =
    useMobilePreferences()
  const reduceMotion = useReducedMotion()
  const system = useColorScheme()
  const mode = theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : theme
  const value = useMemo(
    () => ({
      ...createMobileTheme(
        themePalette,
        mode,
        {
          theme: resolveCodeTheme(codeTheme, importedCodeThemes, themePalette, mode),
          custom: codeTheme !== 'app',
        },
        { highContrast, colorVision },
      ),
      reduceMotion,
    }),
    [themePalette, mode, codeTheme, importedCodeThemes, highContrast, colorVision, reduceMotion],
  )
  useEffect(() => {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme)
  }, [theme])
  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>
}
