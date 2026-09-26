import type { ComponentPropsWithRef } from 'react'
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
} from 'react-native'
import { carZoom, useCarMode } from '../runtime/app-preferences'

/** Car mode enlarges text that sets its own size. Nested text without a size inherits the
 * already enlarged size, so it is left alone rather than enlarged twice. */
function zoomed(style: StyleProp<TextStyle>) {
  const flat = StyleSheet.flatten(style)
  if (!flat?.fontSize) return style
  return {
    ...flat,
    fontSize: flat.fontSize * carZoom,
    ...(flat.lineHeight ? { lineHeight: flat.lineHeight * carZoom } : {}),
  }
}

export function Text(props: ComponentPropsWithRef<typeof NativeText>) {
  const { fontScale } = useWindowDimensions()
  const car = useCarMode()
  // RN 0.86 Fabric keeps stale paragraph measurements after a live Dynamic Type change.
  // Renew only the native paragraph, preserving the screen, input and draft state.
  // Remove when https://github.com/react/react-native/issues/57512 is fixed upstream.
  return (
    <NativeText
      {...props}
      style={car ? zoomed(props.style) : props.style}
      key={
        Platform.OS === 'ios' && props.allowFontScaling !== false
          ? `${fontScale}${car ? ':car' : ''}`
          : undefined
      }
    />
  )
}
