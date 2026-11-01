import { useMemo, useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

export function ComposerHistoryGesture({
  enabled,
  browsing,
  begin,
  older,
  newer,
  children,
}: {
  enabled: boolean
  browsing: boolean
  begin: () => void
  older: () => void
  newer: () => void
  children: ReactNode
}) {
  const latest = useRef({ enabled, begin, older, newer })
  latest.current = { enabled, begin, older, newer }
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success || !latest.current.enabled) return
        if (!browsing) {
          if (event.translationY > 32) latest.current.begin()
        } else if (event.translationX > 32) latest.current.older()
        else if (event.translationX < -32) latest.current.newer()
      })
    // Recognize only the current axis. Taps, upward scrolling and diagonal movements pass through.
    return browsing
      ? pan.activeOffsetX([-32, 32]).failOffsetY([-20, 20])
      : pan.activeOffsetY(32).failOffsetX([-20, 20])
  }, [enabled, browsing])
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} testID="Composer history gestures">
        {children}
      </View>
    </GestureDetector>
  )
}
