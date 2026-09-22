import { Button, Host, Image } from '@expo/ui/swift-ui'
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
import { Icon, symbols, type IconName } from './icon'
import { colors } from './theme'

type IconButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  prominent?: boolean
  selected?: boolean
  size?: 44 | 48
  variant?: 'glass' | 'plain' | 'filled'
  color?: string
}

/** Native buttons can share a Host when they form a toolbar. */
export function NativeIconButton({
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
            ? colors.text
            : (color ?? (prominent ? '#007aff' : selected ? colors.accent : colors.text)),
        ),
        frame({ width: size, height: size }),
        contentShape(shapes.circle(), ['interaction', 'accessibility']),
        disabledModifier(disabled),
        accessibilityLabel(label),
        accessibilityAddTraits(selected ? ['isSelected'] : []),
      ]}
    >
      {/* Equal label bounds keep narrow SF Symbols from producing smaller circles. */}
      <Image
        systemName={symbols[icon][0]}
        size={icon === 'stop' ? 18 : 20}
        color={
          variant === 'filled'
            ? colors.background
            : (color ?? (selected ? colors.accent : colors.text))
        }
        modifiers={[
          ...(variant === 'filled'
            ? [
                frame({ width: size - 12, height: size - 12 }),
                background(disabled ? '#48484a' : colors.text, shapes.circle()),
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
  const {
    label,
    icon,
    onPress,
    disabled,
    prominent,
    selected,
    size = 44,
    variant = 'plain',
    color,
  } = props
  if (Platform.OS === 'ios')
    return (
      // React Native owns this control's frame and keyboard avoidance.
      <Host
        ignoreSafeArea="all"
        colorScheme="dark"
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
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          variant !== 'glass' ? 'transparent' : prominent && !disabled ? '#007aff' : colors.surface,
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
                backgroundColor: disabled ? '#48484a' : colors.text,
              }
            : undefined
        }
      >
        <Icon
          name={icon}
          size={icon === 'stop' ? 18 : 20}
          color={
            variant === 'filled'
              ? colors.background
              : (color ?? (prominent ? '#ffffff' : selected ? colors.accent : colors.text))
          }
        />
      </View>
    </Pressable>
  )
}
