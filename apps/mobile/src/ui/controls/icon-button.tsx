import { Button, Host } from '@expo/ui/swift-ui'
import {
  accessibilityAddTraits,
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  controlSize,
  disabled as disabledModifier,
  frame,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect'
import { Platform, Pressable, View } from 'react-native'
import { Icon, type IconName } from './icon'
import { NativeIcon } from './native-icon'
import { useEffect, useRef } from 'react'
import { useTheme } from '../theme'

type IconButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  onLongPress?: () => void
  disabled?: boolean
  prominent?: boolean
  selected?: boolean
  size?: 44 | 48
  variant?: 'glass' | 'plain' | 'filled'
  color?: string
}

/** Native buttons can share a Host when they form a toolbar. */
function NativeIconButton({
  label,
  icon,
  onPress,
  disabled = false,
  prominent = false,
  selected = false,
  size = 44,
  variant = 'plain',
  color,
}: IconButtonProps) {
  const { colors } = useTheme()

  const glass = isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
  return (
    <Button
      testID={label}
      onPress={onPress}
      modifiers={[
        buttonStyle(
          variant === 'plain' || variant === 'filled'
            ? 'plain'
            : glass
              ? prominent
                ? 'glassProminent'
                : 'glass'
              : prominent
                ? 'borderedProminent'
                : 'bordered',
        ),
        buttonBorderShape('circle'),
        controlSize('large'),
        tint(
          variant === 'filled'
            ? colors.action
            : (color ?? (prominent ? colors.action : selected ? colors.accent : colors.text)),
        ),
        frame({ width: size, height: size }),
        ...(selected && variant === 'plain' ? [background(colors.selection, shapes.circle())] : []),
        contentShape(shapes.circle(), ['interaction', 'accessibility']),
        disabledModifier(disabled),
        accessibilityLabel(label),
        accessibilityAddTraits(selected ? ['isSelected'] : []),
      ]}
    >
      {/* Equal label bounds keep every icon button the same size. */}
      <NativeIcon
        name={icon}
        size={icon === 'stop' ? 18 : 20}
        color={
          variant === 'filled'
            ? colors.onAccent
            : (color ?? (selected ? colors.accent : colors.text))
        }
        modifiers={[
          ...(variant === 'filled'
            ? [
                frame({ width: size - 12, height: size - 12 }),
                background(colors.action, shapes.circle()),
              ]
            : []),
          frame({
            width: variant === 'glass' ? size - 24 : size,
            height: variant === 'glass' ? size - 24 : size,
          }),
        ]}
      />
    </Button>
  )
}

export function IconButton(props: IconButtonProps) {
  const { colors, mode: appearanceMode } = useTheme()
  const held = useRef(false)
  const releaseFrame = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      if (releaseFrame.current !== undefined) cancelAnimationFrame(releaseFrame.current)
    },
    [],
  )

  const {
    label,
    icon,
    onPress,
    onLongPress,
    disabled,
    prominent,
    selected,
    size = 44,
    variant = 'plain',
    color,
  } = props
  // The filled Send/Stop control belongs to the TextInput's React Native responder tree.
  // A SwiftUI button can blur the input on touch-down, moving the composer before touch-up
  // and cancelling the press. Keep native SwiftUI controls for the other toolbar buttons.
  if (Platform.OS === 'ios' && variant !== 'filled' && !onLongPress)
    return (
      // React Native owns this control's frame and keyboard avoidance.
      <Host
        ignoreSafeArea="all"
        colorScheme={appearanceMode}
        style={{ width: size, height: size, flexShrink: 0 }}
      >
        <NativeIconButton {...props} />
      </Host>
    )
  return (
    <Pressable
      testID={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPressIn={() => {
        held.current = false
      }}
      onPress={() => {
        if (!held.current) onPress()
      }}
      onLongPress={
        onLongPress
          ? () => {
              held.current = true
            }
          : undefined
      }
      onPressOut={(event) => {
        if (!held.current || event.nativeEvent.touches.length) return
        // Finish the original responder's release before presenting a different native window.
        // Otherwise iOS can deliver its touch-up to the new menu/backdrop and dismiss it.
        releaseFrame.current = requestAnimationFrame(() => onLongPress?.())
      }}
      accessibilityHint={onLongPress ? 'Hold for message actions' : undefined}
      accessibilityActions={
        onLongPress ? [{ name: 'messageActions', label: 'Message actions' }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'messageActions') onLongPress?.()
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          selected && variant === 'plain'
            ? colors.selection
            : variant !== 'glass'
              ? 'transparent'
              : prominent && !disabled
                ? colors.action
                : colors.surface,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <View
        style={
          variant === 'filled'
            ? {
                width: size - 12,
                height: size - 12,
                borderRadius: size,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.action,
              }
            : undefined
        }
      >
        <Icon
          name={icon}
          size={icon === 'stop' ? 18 : 20}
          color={
            variant === 'filled'
              ? colors.onAccent
              : (color ?? (prominent ? colors.onAccent : selected ? colors.accent : colors.text))
          }
        />
      </View>
    </Pressable>
  )
}
