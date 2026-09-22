import type { ComponentPropsWithRef } from 'react'
import { Platform, Text as NativeText, useWindowDimensions } from 'react-native'

export function Text(props: ComponentPropsWithRef<typeof NativeText>) {
  const { fontScale } = useWindowDimensions()
  // RN 0.86 Fabric keeps stale paragraph measurements after a live Dynamic Type change.
  // Renew only the native paragraph, preserving the screen, input and draft state.
  // Remove when https://github.com/react/react-native/issues/57512 is fixed upstream.
  return (
    <NativeText
      {...props}
      key={Platform.OS === 'ios' && props.allowFontScaling !== false ? fontScale : undefined}
    />
  )
}
