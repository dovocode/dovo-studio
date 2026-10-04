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
import { useWindowDimensions, View } from 'react-native'
import { colors } from '../theme'
import type { ChoiceProps } from './choice'

/** Short choices stay anchored to their control instead of opening another sheet. */
export function ChoiceMenu(props: ChoiceProps) {
  const [width, setWidth] = useApplicationState<number | undefined>(undefined)
  const { fontScale } = useWindowDimensions()
  const height = Math.max(44, Math.ceil(22 * fontScale + 16))
  const selected =
    props.items.find((item) => item.id === props.value)?.name ?? props.selectedLabel ?? 'Choose…'
  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(Math.floor(nativeEvent.layout.width))}
      style={{
        minWidth: 0,
        height,
        borderRadius: 12,
        backgroundColor: props.compact ? 'transparent' : colors.surface,
        opacity: props.disabled ? 0.45 : 1,
      }}
    >
      <Host
        ignoreSafeArea="all"
        colorScheme="dark"
        style={{
          width: '100%',
          height,
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
                }),
                frame({
                  width,
                  height,
                  alignment: 'leading',
                }),
                contentShape(shapes.rectangle(), ['interaction', 'accessibility']),
              ]}
            >
              <Text
                modifiers={[
                  font({
                    textStyle: props.compact ? 'subheadline' : 'body',
                    weight: 'medium',
                  }),
                  foregroundStyle(props.compact ? colors.accent : colors.text),
                  lineLimit(1),
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
              label={item.id === props.value ? undefined : item.name}
              modifiers={[
                disabled((props.disabled ?? false) || (item.disabled ?? false)),
                accessibilityAddTraits(item.id === props.value ? ['isSelected'] : []),
              ]}
              onPress={() => props.onChange(item.id)}
            >
              {item.id === props.value ? (
                <NativeIconLabel title={item.name} icon="check" />
              ) : undefined}
            </Button>
          ))}
        </Menu>
      </Host>
    </View>
  )
}
