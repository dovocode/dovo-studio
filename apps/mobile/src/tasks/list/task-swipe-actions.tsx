import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, PanResponder, Pressable, View } from 'react-native'
import { Icon, type IconName } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { colors } from '../../ui/theme'

type SwipeAction = { label: string; icon: IconName; disabled?: boolean; run: () => void }
const actionWidth = 80

/** Horizontal intent leaves vertical list scrolling and row long presses alone. */
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
  const translation = useRef(new Animated.Value(0)).current
  const offset = useRef(0)
  const width = useRef(320)
  const start = useRef(0)
  const revealedWidth = actionWidth * (secondary ? 2 : 1)
  const latest = useRef({ enabled, primary, revealedWidth })
  latest.current = { enabled, primary, revealedWidth }
  const [open, setOpen] = useState(false)
  const animate = (target: number) => {
    offset.current = target
    setOpen(target !== 0)
    Animated.spring(translation, {
      toValue: target,
      useNativeDriver: true,
      overshootClamping: true,
    }).start()
  }
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          latest.current.enabled &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
          (gesture.dx < 0 || offset.current < 0),
        onPanResponderGrant: () => {
          translation.stopAnimation()
          start.current = offset.current
        },
        onPanResponderMove: (_, gesture) =>
          translation.setValue(Math.max(-width.current, Math.min(0, start.current + gesture.dx))),
        onPanResponderRelease: (_, gesture) => {
          if (!latest.current.enabled) {
            animate(0)
            return
          }
          const position = start.current + gesture.dx
          if (
            position <= -Math.max(latest.current.revealedWidth + 32, width.current * 0.65) &&
            !latest.current.primary.disabled
          ) {
            animate(0)
            latest.current.primary.run()
          } else
            animate(
              position < -latest.current.revealedWidth / 2 || gesture.vx < -0.5
                ? -latest.current.revealedWidth
                : 0,
            )
        },
        onPanResponderTerminate: () => animate(0),
      }),
    [translation],
  )
  useEffect(() => {
    if (!enabled || offset.current !== 0) {
      translation.stopAnimation()
      translation.setValue(0)
      offset.current = 0
      setOpen(false)
    }
    return () => translation.stopAnimation()
  }, [enabled, revealedWidth, translation])
  return (
    <View
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width
      }}
      style={{ borderRadius: 12, overflow: 'hidden' }}
    >
      <View
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        style={{ position: 'absolute', right: 0, top: 3, bottom: 3, flexDirection: 'row' }}
      >
        {(secondary ? [secondary, primary] : [primary]).map((action, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.disabled }}
            disabled={action.disabled || !enabled}
            onPress={() => {
              animate(0)
              action.run()
            }}
            style={{
              width: actionWidth,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: index ? colors.elevated : colors.surface,
              opacity: action.disabled ? 0.4 : 1,
            }}
          >
            <Icon name={action.icon} size={22} color={colors.accent} />
            <Text style={{ color: colors.text, fontSize: 12 }}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View
        {...responder.panHandlers}
        style={{ transform: [{ translateX: translation }] }}
      >
        {children}
      </Animated.View>
    </View>
  )
}
