import { contentColumn } from '../ui/layout/content-column'
import { ValidationFields } from '../ui/controls/validation-fields'
import { SettingsFooterContext } from './settings-save-bar'
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { MobileThemeContext, useTheme } from '../ui/theme'
import { Sheet } from '../ui/layout/sheet'
import { studioThemes } from '@dovo/studio-core/themes'

const SettingsContext = createContext(false)
export const useInsideSettings = () => useContext(SettingsContext)

/** Keep the grouped settings presentation local to settings pages and editors. */
export function useSettingsTheme() {
  const theme = useTheme()
  return useMemo(() => {
    const colors = {
      ...theme.colors,
      background: theme.highContrast
        ? theme.colors.background
        : studioThemes[theme.palette][theme.mode].sidebar,
    }
    return {
      ...theme,
      colors,
      styles: StyleSheet.create({
        ...theme.styles,
        screen: { ...theme.styles.screen, backgroundColor: colors.background },
        content: {
          ...theme.styles.content,
          ...contentColumn.form,
          padding: 16,
          paddingBottom: 32,
          gap: 20,
        },
        card: {
          ...theme.styles.card,
          backgroundColor: colors.surface,
          borderWidth: theme.highContrast ? 1 : StyleSheet.hairlineWidth,
          borderRadius: 12,
          padding: 12,
          gap: 10,
        },
        title: { ...theme.styles.title, fontSize: 16, letterSpacing: 0 },
        text: { ...theme.styles.text, fontSize: 14, lineHeight: 20 },
        muted: { ...theme.styles.muted, fontSize: 12, lineHeight: 17 },
        input: {
          ...theme.styles.input,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          minHeight: 44,
          fontSize: 15,
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
  const [footer, setFooter] = useState<ReactNode>(null)
  return (
    <SettingsTheme>
      <SettingsFooterContext.Provider value={setFooter}>
        <View style={styles.screen}>
          <ValidationFields>{children}</ValidationFields>
          {footer}
        </View>
      </SettingsFooterContext.Provider>
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
