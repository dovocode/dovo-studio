import type { ReactNode } from 'react'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import { useTheme } from '../ui/theme'
/** Same navigation palette as App, without runtime/account/background providers. */
export function CatalogNavigationTheme({ children }: { children: ReactNode }) {
  const { colors, mode } = useTheme()
  const base = mode === 'dark' ? DarkTheme : DefaultTheme
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: colors.accent,
          background: colors.background,
          card: colors.background,
          text: colors.text,
          border: colors.border,
          notification: colors.accent,
        },
      }}
    >
      {children}
    </ThemeProvider>
  )
}
