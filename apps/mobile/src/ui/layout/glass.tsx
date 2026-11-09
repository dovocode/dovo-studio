import { nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useEffect, type ReactNode } from 'react'
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native'
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
  const { colors, mode: appearanceMode, highContrast } = useTheme()

  const [reduced, setReduced] = useApplicationState(true)
  useEffect(() => {
    let active = true
    void runClientEffect(
      nativeEffect(() => AccessibilityInfo.isReduceTransparencyEnabled())
        .pipe(
          Effect.flatMap((value) =>
            nativeEffect(() => {
              if (active) setReduced(value)
            }),
          ),
        )
        .pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              console.warn('Could not read transparency preference; using opaque controls.', error)
            }),
          ),
        ),
    )
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  const opaqueStyle = {
    backgroundColor: tinted ? colors.selection : colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  }
  const opaque = reduced || highContrast
  // Keep the same native parent when the accessibility preference resolves or changes.
  // Swapping View for GlassView remounts its children, dropping an active input's focus.
  if (Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable())
    return (
      <GlassView
        testID={testID}
        colorScheme={appearanceMode}
        glassEffectStyle={opaque ? 'none' : 'regular'}
        isInteractive={interactive}
        tintColor={tinted ? `${colors.accent}55` : undefined}
        style={[opaque && opaqueStyle, style]}
      >
        {children}
      </GlassView>
    )
  return (
    <View testID={testID} style={[opaqueStyle, style]}>
      {children}
    </View>
  )
}
