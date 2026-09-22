import { useEffect, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native'
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect'
import { colors } from './theme'

export function Glass({
  children,
  style,
  interactive = false,
  tinted = false,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
  tinted?: boolean
}) {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (active) setReduced(value)
      })
      .catch((error) => {
        console.warn('Could not read transparency preference; using opaque controls.', error)
      })
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  const opaqueStyle = {
    backgroundColor: tinted ? '#344467' : colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  }
  // Keep the same native parent when the accessibility preference resolves or changes.
  // Swapping View for GlassView remounts its children, dropping an active input's focus.
  if (Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable())
    return (
      <GlassView
        colorScheme="dark"
        glassEffectStyle={reduced ? 'none' : 'regular'}
        isInteractive={interactive}
        tintColor={tinted ? '#6177b855' : undefined}
        style={[reduced && opaqueStyle, style]}
      >
        {children}
      </GlassView>
    )
  return <View style={[opaqueStyle, style]}>{children}</View>
}
