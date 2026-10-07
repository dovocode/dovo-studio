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
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  interactive?: boolean
  tinted?: boolean
}) {
  const { colors, mode: appearanceMode } = useTheme()

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
  // Keep the same native parent when the accessibility preference resolves or changes.
  // Swapping View for GlassView remounts its children, dropping an active input's focus.
  if (Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable())
    return (
      <GlassView
        colorScheme={appearanceMode}
        glassEffectStyle={reduced ? 'none' : 'regular'}
        isInteractive={interactive}
        tintColor={tinted ? `${colors.accent}55` : undefined}
        style={[reduced && opaqueStyle, style]}
      >
        {children}
      </GlassView>
    )
  return <View style={[opaqueStyle, style]}>{children}</View>
}
