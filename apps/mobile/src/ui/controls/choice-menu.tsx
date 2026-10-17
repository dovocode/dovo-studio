import { NativeIcon, NativeIconLabel } from './native-icon'
import { useApplicationState } from '../../runtime/state/application-state'
import { Button, Host, HStack, Menu, Spacer, Text } from '@expo/ui/swift-ui'
import {
  accessibilityAddTraits,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers'
import { View } from 'react-native'
import { useTheme } from '../theme'
import type { ChoiceProps } from './choice'

/** Short choices stay anchored to their control instead of opening another sheet. */
export function ChoiceMenu(props: ChoiceProps) {
  const { colors, mode: appearanceMode } = useTheme()

  const [width, setWidth] = useApplicationState<number | undefined>(undefined)
  const selectedIcon = props.items.find((item) => item.id === props.value)?.icon
  const selected =
    props.items.find((item) => item.id === props.value)?.name ?? props.selectedLabel ?? 'Choose…'
  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(Math.floor(nativeEvent.layout.width))}
      style={{
        minWidth: 0,
        minHeight: 44,
        borderRadius: 12,
        backgroundColor: props.compact ? 'transparent' : colors.surface,
        opacity: props.disabled ? 0.45 : 1,
      }}
    >
      <Host
        ignoreSafeArea="all"
        matchContents={{ vertical: true }}
        colorScheme={appearanceMode}
        style={{
          width: '100%',
          minHeight: 44,
        }}
      >
        <Menu
          testID={props.label}
          modifiers={[
            buttonStyle('plain'),
            disabled(props.disabled ?? false),
            accessibilityLabel(props.label),
            accessibilityValue(selected),
          ]}
          label={
            <HStack
              spacing={6}
              modifiers={[
                padding({
                  horizontal: props.compact ? 4 : 12,
                  vertical: 8,
                }),
                frame({
                  width,
                  alignment: 'leading',
                }),
                frame({ minHeight: 44, alignment: 'leading' }),
                contentShape(shapes.rectangle(), ['interaction', 'accessibility']),
              ]}
            >
              {selectedIcon && (
                <NativeIcon
                  name={selectedIcon}
                  size={18}
                  color={props.compact ? colors.accent : colors.text}
                />
              )}
              <Text
                modifiers={[
                  font({
                    textStyle: props.compact ? 'subheadline' : 'body',
                    weight: 'medium',
                  }),
                  foregroundStyle(props.compact ? colors.accent : colors.text),
                  props.compact ? lineLimit(1) : lineLimit(),
                ]}
              >
                {selected}
              </Text>
              <Spacer minLength={0} />
              <NativeIcon name="down" size={11} color={colors.muted} />
            </HStack>
          }
        >
          {props.items.map((item) => (
            <Button
              key={item.id}
              testID={`Choose ${item.name}`}
              label={item.icon || item.id === props.value ? undefined : item.name}
              modifiers={[
                disabled((props.disabled ?? false) || (item.disabled ?? false)),
                accessibilityAddTraits(item.id === props.value ? ['isSelected'] : []),
              ]}
              onPress={() => props.onChange(item.id)}
            >
              {item.icon ? (
                <HStack spacing={8}>
                  <NativeIconLabel title={item.name} icon={item.icon} />
                  {item.id === props.value && <NativeIcon name="check" size={16} />}
                </HStack>
              ) : item.id === props.value ? (
                <NativeIconLabel title={item.name} icon="check" />
              ) : undefined}
            </Button>
          ))}
        </Menu>
      </Host>
    </View>
  )
}
