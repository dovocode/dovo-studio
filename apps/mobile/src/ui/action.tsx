import { Host, Button, Text as NativeText } from '@expo/ui/swift-ui'
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  tint,
  accessibilityLabel,
  fixedSize,
  lineLimit,
  multilineTextAlignment,
  padding,
  contentShape,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'
import { Platform, Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from './text'
import { IconButton } from './icon-button'
import type { IconName } from './icon'
import { colors } from './theme'

const actionIcons: Readonly<Partial<Record<string, IconName>>> = {
  'New terminal': 'add',
  'New task': 'add',
  'Create PR': 'add',
  'Close shell': 'close',
  'Reconnect terminal': 'refresh',
  Terminal: 'terminal',
  'Refresh details': 'refresh',
  'Retry connection': 'refresh',
  'PR filters': 'filters',
  'Back to PRs': 'back',
  'Attach files': 'add',
  'Task settings': 'settings',
  Send: 'send',
  Stop: 'stop',
  Close: 'close',
  Back: 'back',
  'Dismiss keyboard': 'keyboard',
}
type ActionProps = {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
}

export function Action(props: ActionProps) {
  const icon = props.label.startsWith('Changes (') ? 'changes' : actionIcons[props.label]
  if (icon)
    return (
      <IconButton
        label={props.label}
        onPress={props.onPress}
        disabled={props.disabled}
        icon={icon}
        variant={
          props.label === 'Back' || props.label === 'Back to PRs'
            ? 'glass'
            : props.secondary
              ? 'plain'
              : 'filled'
        }
        prominent={!props.secondary}
        size={props.label === 'Send' || props.label === 'Stop' ? 48 : 44}
      />
    )
  return <TextAction {...props} />
}

function TextAction({ label, onPress, disabled = false, secondary = false }: ActionProps) {
  const [availableWidth, setAvailableWidth] = useState<number>()
  const { fontScale } = useWindowDimensions()
  const [intrinsic, setIntrinsic] = useState<{
    label: string
    fontScale: number
    secondary: boolean
    width: number
  }>()
  const naturalWidth =
    intrinsic?.label === label &&
    intrinsic.fontScale === fontScale &&
    intrinsic.secondary === secondary
      ? intrinsic.width
      : undefined
  if (Platform.OS === 'ios') {
    return (
      <View
        // Reserve each button's intrinsic width. A wrapping row moves whole buttons
        // onto the next line instead of squeezing their labels beside siblings.
        style={{
          flexShrink: 0,
          width: naturalWidth,
          minWidth: 44,
          maxWidth: '100%',
          opacity: disabled ? 0.45 : 1,
        }}
        onLayout={({ nativeEvent }) => setAvailableWidth(Math.floor(nativeEvent.layout.width))}
      >
        <Host
          ignoreSafeArea="all"
          key={`${label}:${fontScale}:${secondary}`}
          matchContents
          colorScheme="dark"
          style={{ flexShrink: 0, maxWidth: '100%' }}
          onLayoutContent={({ nativeEvent }) => {
            if (naturalWidth === undefined && nativeEvent.width > 0)
              setIntrinsic({ label, fontScale, secondary, width: Math.ceil(nativeEvent.width) })
          }}
        >
          <Button
            testID={label}
            onPress={onPress}
            modifiers={[
              buttonStyle(secondary ? 'plain' : 'borderedProminent'),
              buttonBorderShape('roundedRectangle', 12),
              controlSize('large'),
              // The outer React Native layout owns the bounded width; SwiftUI owns
              // the label height, including Dynamic Type and narrow-screen wrapping.
              frame({
                minHeight: 44,
                width: naturalWidth === undefined || !availableWidth ? undefined : availableWidth,
              }),
              contentShape(shapes.rectangle(), ['interaction', 'accessibility']),
              font({ textStyle: 'body', weight: 'semibold' }),
              tint(secondary ? colors.accent : '#007aff'),
              disabledModifier(disabled),
              accessibilityLabel(label),
            ]}
          >
            <NativeText
              modifiers={[
                foregroundStyle(secondary ? colors.accent : '#ffffff'),
                lineLimit(),
                fixedSize({ horizontal: false, vertical: true }),
                multilineTextAlignment('center'),
                ...(secondary
                  ? [
                      padding({ horizontal: 8, vertical: 8 }),
                      frame({ minWidth: 44, minHeight: 44 }),
                      contentShape(shapes.rectangle(), ['interaction', 'accessibility']),
                    ]
                  : []),
              ]}
            >
              {label}
            </NativeText>
          </Button>
        </Host>
      </View>
    )
  }
  return (
    <Pressable
      testID={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        maxWidth: '100%',
        flexShrink: 0,
        paddingHorizontal: 16,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: secondary ? 'transparent' : '#007aff',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 17,
          fontWeight: '600',
          color: secondary ? colors.accent : '#ffffff',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
