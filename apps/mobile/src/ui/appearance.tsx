import { resolveCodeTheme } from '@dovo/studio-core/code-themes'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Appearance, useColorScheme } from 'react-native'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { createMobileTheme, MobileThemeContext } from './theme'

export function MobileAppearance({ children }: { children: ReactNode }) {
  const { theme, themePalette, codeTheme, importedCodeThemes } = useMobilePreferences()
  const system = useColorScheme()
  const mode = theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : theme
  const value = useMemo(
    () =>
      createMobileTheme(themePalette, mode, {
        theme: resolveCodeTheme(codeTheme, importedCodeThemes, themePalette, mode),
        custom: codeTheme !== 'app',
      }),
    [themePalette, mode, codeTheme, importedCodeThemes],
  )
  useEffect(() => {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme)
  }, [theme])
  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>
}
