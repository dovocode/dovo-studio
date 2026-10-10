import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { MobileThemeContext, useTheme } from '../ui/theme'
import { Sheet } from '../ui/layout/sheet'

const SettingsContext = createContext(false)
export const useInsideSettings = () => useContext(SettingsContext)

/** Keep the grouped settings presentation local to settings pages and editors. */
export function useSettingsTheme() {
  const theme = useTheme()
  return useMemo(() => {
    const dark = theme.mode === 'dark'
    const colors = {
      ...theme.colors,
      background: dark ? '#000000' : '#f2f2f7',
      surface: dark ? '#1c1c1e' : '#ffffff',
      elevated: dark ? '#2c2c2e' : '#ffffff',
      border: dark ? '#38383a' : '#d1d1d6',
    }
    return {
      ...theme,
      colors,
      styles: StyleSheet.create({
        ...theme.styles,
        screen: { ...theme.styles.screen, backgroundColor: colors.background },
        content: { ...theme.styles.content, padding: 16, paddingBottom: 32, gap: 28 },
        card: {
          ...theme.styles.card,
          backgroundColor: colors.surface,
          borderWidth: 0,
          borderRadius: 24,
          padding: 16,
          gap: 12,
        },
        title: { ...theme.styles.title, fontSize: 17, letterSpacing: 0 },
        text: { ...theme.styles.text, fontSize: 17, lineHeight: 23 },
        input: {
          ...theme.styles.input,
          backgroundColor: colors.surface,
          borderWidth: 0,
          borderRadius: 18,
          paddingHorizontal: 16,
          paddingVertical: 12,
          minHeight: 50,
          fontSize: 17,
        },
        sheetFooter: {
          ...theme.styles.sheetFooter,
          backgroundColor: colors.background,
          borderTopWidth: 0,
          padding: 16,
        },
      }),
    }
  }, [theme])
}

export function SettingsTheme({ children }: { children: ReactNode }) {
  const theme = useSettingsTheme()
  return (
    <SettingsContext.Provider value>
      <MobileThemeContext.Provider value={theme}>{children}</MobileThemeContext.Provider>
    </SettingsContext.Provider>
  )
}

export function SettingsPage({ children }: { children: ReactNode }) {
  const { styles } = useSettingsTheme()
  return (
    <SettingsTheme>
      <View style={styles.screen}>{children}</View>
    </SettingsTheme>
  )
}

export function SettingsSheet(props: ComponentProps<typeof Sheet>) {
  const { colors, styles } = useSettingsTheme()
  return (
    <SettingsTheme>
      <Sheet {...props} scrollable={false}>
        {props.scrollable === false ? (
          <View style={{ flex: 1, backgroundColor: colors.background }}>{props.children}</View>
        ) : (
          <ScrollView
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
          >
            {props.children}
          </ScrollView>
        )}
      </Sheet>
    </SettingsTheme>
  )
}
