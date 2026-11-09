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
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
  tinted?: boolean
  testID?: string
}) {
  const { colors, mode: appearanceMode, highContrast, reduceTransparency } = useTheme()
  const nativeGlass =
    Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
  const opaque = reduceTransparency || highContrast || !nativeGlass
  const surfaceStyle = {
    borderWidth: 1,
    borderColor: opaque ? colors.border : appearanceMode === 'dark' ? '#ffffff2e' : '#ffffffb3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    shadowOpacity: opaque ? 0 : appearanceMode === 'dark' ? 0.18 : 0.08,
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
    <View testID={testID} style={[surfaceStyle, style, opaqueStyle]}>
      {children}
    </View>
  )
}
