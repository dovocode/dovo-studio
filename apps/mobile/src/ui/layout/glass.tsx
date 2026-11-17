import { type ReactNode } from 'react'
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native'
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect'
import { useTheme } from '../theme'
export function Glass({
  children,
  style,
  interactive = false,
  tinted = false,
  testID,
  accessibilityLabel,
  accessibilityViewIsModal,
  role,
  pointerEvents,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
  tinted?: boolean
  testID?: string
  accessibilityLabel?: string
  accessibilityViewIsModal?: boolean
  role?: 'dialog'
  pointerEvents?: 'none'
}) {
  const { colors, mode: appearanceMode, highContrast, reduceTransparency } = useTheme()
  const nativeGlass =
    Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
  const opaque = reduceTransparency || highContrast || !nativeGlass
  const surfaceStyle = {
    borderWidth: 1,
    borderColor: opaque ? colors.border : appearanceMode === 'dark' ? '#d7e8ff50' : '#ffffffb8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 16,
    shadowOpacity: opaque ? 0 : appearanceMode === 'dark' ? 0.25 : 0.12,
  }
  const opaqueStyle = {
    backgroundColor: tinted ? colors.selection : colors.surface,
    shadowOpacity: 0,
  }
  // Keep the same native parent when the accessibility preference resolves or changes.
  // Swapping View for GlassView remounts its children, dropping an active input's focus.
  if (nativeGlass)
    return (
      <GlassView
        testID={testID}
        pointerEvents={pointerEvents}
        accessibilityLabel={accessibilityLabel}
        accessibilityViewIsModal={accessibilityViewIsModal}
        role={role}
        colorScheme={appearanceMode}
        glassEffectStyle={opaque ? 'none' : 'regular'}
        isInteractive={interactive}
        tintColor={tinted ? `${colors.accent}55` : undefined}
        style={[surfaceStyle, style, opaque && opaqueStyle]}
      >
        {children}
      </GlassView>
    )
  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      accessibilityLabel={accessibilityLabel}
      accessibilityViewIsModal={accessibilityViewIsModal}
      role={role}
      style={[surfaceStyle, style, opaqueStyle]}
    >
      {children}
    </View>
  )
}
