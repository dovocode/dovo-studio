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
      background: theme.highContrast ? theme.colors.background : dark ? '#000000' : '#f2f2f7',
      surface: theme.highContrast ? theme.colors.surface : dark ? '#1c1c1e' : '#ffffff',
      elevated: theme.highContrast ? theme.colors.elevated : dark ? '#2c2c2e' : '#ffffff',
      border: theme.highContrast ? theme.colors.border : dark ? '#38383a' : '#d1d1d6',
    }
    return {
      ...theme,
      colors,
      styles: StyleSheet.create({
        ...theme.styles,
        screen: { ...theme.styles.screen, backgroundColor: colors.background },
        content: { ...theme.styles.content, padding: 12, paddingBottom: 24, gap: 20 },
        card: {
          ...theme.styles.card,
          backgroundColor: colors.surface,
          borderWidth: 0,
          borderRadius: 16,
          padding: 12,
          gap: 10,
        },
        title: { ...theme.styles.title, fontSize: 17, letterSpacing: 0 },
        text: { ...theme.styles.text, fontSize: 16, lineHeight: 22 },
        input: {
          ...theme.styles.input,
          backgroundColor: colors.surface,
          borderWidth: 0,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          minHeight: 44,
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
  // Dialogs size to their contents. A flex: 1 sheet body collapses in this intrinsic container.
  if (props.presentation === 'dialog')
    return (
      <SettingsTheme>
        <Sheet {...props} />
      </SettingsTheme>
    )
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
