import { StyleSheet } from 'react-native'
import { createContext, useContext } from 'react'
import { studioThemes, type StudioThemeId, type StudioThemeMode } from '@dovo/studio-core/themes'

function createMobileColors(palette: StudioThemeId, mode: StudioThemeMode) {
  const tokens = studioThemes[palette][mode]
  return {
    background: tokens.background,
    surface: tokens.card,
    elevated: tokens.popover,
    border: tokens.border,
    text: tokens.foreground,
    muted: tokens['muted-foreground'],
    accent: tokens.primary,
    selection: tokens.selection,
    action: tokens.action,
    onAccent: tokens['action-foreground'],
    error: mode === 'dark' ? '#ff7e97' : '#ba2549',
    onError: mode === 'dark' ? '#341520' : '#ffffff',
    success: mode === 'dark' ? '#8ad5b0' : '#087f5b',
    warning: mode === 'dark' ? '#e7c681' : '#946200',
    syntaxFunction: tokens['syntax-function'],
    syntaxKeyword: tokens['syntax-keyword'],
  }
}
export type MobileColors = ReturnType<typeof createMobileColors>
export function createMobileTheme(palette: StudioThemeId, mode: StudioThemeMode) {
  const colors = createMobileColors(palette, mode)
  return { palette, mode, colors, styles: createStyles(colors) }
}
export type MobileTheme = ReturnType<typeof createMobileTheme>
export const MobileThemeContext = createContext(createMobileTheme('dovo', 'dark'))
export const useTheme = () => useContext(MobileThemeContext)

function createStyles(colors: MobileColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 8,
    },
    title: { color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
    largeTitle: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    sheetFooter: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 12,
      gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    empty: { paddingHorizontal: 20, paddingVertical: 32, alignItems: 'center', gap: 8 },
    listItem: {
      paddingVertical: 8,
      gap: 3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    text: { color: colors.text, fontSize: 16, lineHeight: 22 },
    chatText: { color: colors.text, fontSize: 17, lineHeight: 25 },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    error: { color: colors.error, fontSize: 13, lineHeight: 18 },
    input: {
      color: colors.text,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 16,
      minHeight: 44,
      backgroundColor: colors.surface,
    },
  })
}
