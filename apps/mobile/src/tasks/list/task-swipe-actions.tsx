import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { Icon, type IconName } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { colors } from '../../ui/theme'
import { fullSwipe, swipeTarget, swipeTranslation } from './task-swipe-motion'

type SwipeAction = { label: string; icon: IconName; disabled?: boolean; run: () => void }
const actionWidth = 80
const spring = { damping: 24, stiffness: 260, mass: 0.8, overshootClamping: true }
// Only one row should keep its actions revealed at a time.
let closeRevealedRow: (() => void) | undefined

export function TaskSwipeActions({
  children,
  enabled,
  primary,
  secondary,
}: {
  children: ReactNode
  enabled: boolean
  primary: SwipeAction
  secondary?: SwipeAction
}) {
  const translation = useSharedValue(0)
  const start = useSharedValue(0)
  const width = useSharedValue(320)
  const armed = useSharedValue(false)
  const revealedWidth = actionWidth * (secondary ? 2 : 1)
  const primaryDisabled = !!primary.disabled
  const [open, setOpen] = useState(false)
  const latest = useRef({ enabled, primary })
  latest.current = { enabled, primary }
  const close = useCallback(() => {
    translation.value = withSpring(0, spring)
    armed.value = false
    setOpen(false)
    if (closeRevealedRow === close) closeRevealedRow = undefined
  }, [translation, armed])
  const begin = useCallback(() => {
    if (closeRevealedRow !== close) closeRevealedRow?.()
    closeRevealedRow = close
  }, [close])
  const commit = useCallback(() => {
    close()
    if (latest.current.enabled && !latest.current.primary.disabled) latest.current.primary.run()
  }, [close])
  useEffect(() => {
    close()
    return () => {
      if (closeRevealedRow === close) closeRevealedRow = undefined
      cancelAnimation(translation)
    }
  }, [enabled, revealedWidth, close, translation])

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-12, 12])
        .failOffsetY([-8, 8])
        .onStart(() => {
          cancelAnimation(translation)
          start.value = translation.value
          scheduleOnRN(begin)
        })
        .onUpdate((event) => {
          const position = start.value + event.translationX
          translation.value = swipeTranslation(position, revealedWidth, width.value)
          armed.value =
            !primaryDisabled && fullSwipe(position, event.velocityX, width.value, revealedWidth)
        })
        .onEnd((event) => {
          const position = start.value + event.translationX
          if (
            !primaryDisabled &&
            fullSwipe(position, event.velocityX, width.value, revealedWidth)
          ) {
            translation.value = withSpring(0, spring)
            scheduleOnRN(commit)
          } else {
            const target = swipeTarget(position, event.velocityX, revealedWidth)
            translation.value = withSpring(target, { ...spring, velocity: event.velocityX })
            scheduleOnRN(setOpen, target !== 0)
          }
          armed.value = false
        })
        .onFinalize((_event, success) => {
          if (!success) {
            translation.value = withSpring(0, spring)
            armed.value = false
            scheduleOnRN(close)
          }
        }),
    [
      enabled,
      primaryDisabled,
      revealedWidth,
      translation,
      start,
      width,
      armed,
      begin,
      commit,
      close,
    ],
  )
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }))
  const actionsStyle = useAnimatedStyle(() => ({
    width: Math.max(revealedWidth, -translation.value),
  }))
  const primaryStyle = useAnimatedStyle(() => ({
    backgroundColor: armed.value ? colors.accent : colors.elevated,
  }))
  return (
    <View
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width
      }}
      style={{ borderRadius: 12, overflow: 'hidden' }}
    >
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        style={[
          { position: 'absolute', right: 0, top: 3, bottom: 3, flexDirection: 'row' },
          actionsStyle,
        ]}
      >
        {(secondary ? [secondary, primary] : [primary]).map((action) => (
          <Animated.View
            key={action.label}
            style={[
              action === primary ? { flex: 1 } : { width: actionWidth },
              action === primary ? primaryStyle : { backgroundColor: colors.surface },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: action.disabled || !enabled }}
              disabled={action.disabled || !enabled}
              onPress={() => {
                close()
                action.run()
              }}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <Icon name={action.icon} size={22} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 12 }}>{action.label}</Text>
            </Pressable>
          </Animated.View>
        ))}
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          {children}
          {open && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close thread actions"
              onPress={close}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
