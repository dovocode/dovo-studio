import { Button, Host, Menu } from '@expo/ui/swift-ui'
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
import { NativeIcon, NativeMenuButton } from './native-icon'
import type { MenuAction } from './action-menu'
import { useRef } from 'react'
import { useTheme } from '../theme'

type IconButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  onLongPress?: () => void
  menuActions?: MenuAction[]
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

/** Native menu used by composer controls; a primary action makes the menu open on hold. */
export function NativeActionMenu({
  label,
  icon,
  menuActions,
  onPrimaryAction,
  disabled,
  size = 44,
  variant = 'plain',
  color,
}: {
  label: string
  icon: IconName
  menuActions: MenuAction[]
  onPrimaryAction?: () => void
  disabled?: boolean
  size?: 44 | 48
  variant?: 'glass' | 'plain' | 'filled'
  color?: string
}) {
  const { colors, mode: appearanceMode } = useTheme()
  return (
    <Host
      ignoreSafeArea="all"
      colorScheme={appearanceMode}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <Menu
        testID={label}
        label={
          <NativeIcon
            name={icon}
            size={icon === 'stop' ? 18 : 20}
            color={variant === 'filled' ? colors.onAccent : (color ?? colors.text)}
            modifiers={[
              ...(variant === 'filled'
                ? [
                    frame({ width: size - 12, height: size - 12 }),
                    background(colors.action, shapes.circle()),
                  ]
                : []),
              frame({ width: size, height: size }),
            ]}
          />
        }
        onPrimaryAction={
          onPrimaryAction
            ? () => {
                if (!disabled) onPrimaryAction()
              }
            : undefined
        }
        modifiers={[
          buttonStyle('plain'),
          frame({ width: size, height: size }),
          contentShape(shapes.circle(), ['interaction', 'accessibility']),
          disabledModifier(
            !!disabled && (!onPrimaryAction || menuActions.every((action) => action.disabled)),
          ),
          accessibilityLabel(label),
        ]}
      >
        {menuActions.map((action) => (
          <NativeMenuButton
            key={action.label}
            testID={action.label}
            label={action.title}
            icon={action.icon}
            modifiers={[disabledModifier(action.disabled), accessibilityLabel(action.label)]}
            onPress={action.onPress}
          />
        ))}
      </Menu>
    </Host>
  )
}

export function IconButton(props: IconButtonProps) {
  const { colors, mode: appearanceMode } = useTheme()
  const held = useRef(false)

  const {
    label,
    icon,
    onPress,
    onLongPress,
    menuActions,
    disabled,
    prominent,
    selected,
    size = 44,
    variant = 'plain',
    color,
  } = props
  if (Platform.OS === 'ios' && menuActions) {
    return (
      <NativeActionMenu
        label={label}
        icon={icon}
        menuActions={menuActions}
        onPrimaryAction={onLongPress ? onPress : undefined}
        disabled={disabled}
        size={size}
        variant={variant}
        color={color}
      />
    )
  }
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
  const triggerDisabled =
    !!disabled && (!onLongPress || !menuActions?.some((action) => !action.disabled))
  return (
    <Pressable
      testID={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: triggerDisabled, selected }}
      disabled={triggerDisabled}
      onPressIn={() => {
        held.current = false
      }}
      onPress={() => {
        if (!held.current && !disabled) onPress()
      }}
      onLongPress={
        onLongPress
          ? () => {
              held.current = true
              onLongPress()
            }
          : undefined
      }
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
