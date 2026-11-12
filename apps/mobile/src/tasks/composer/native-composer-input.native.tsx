import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { composerReferences, type ComposerReference } from '@dovo/protocol'
import { Keyboard, type TextInputProps, type ViewProps } from 'react-native'
import { useMemo, useState, type ComponentType } from 'react'
import { useTheme } from '../../ui/theme'
import { harnessIconImages } from '../../agents/harness-icon-images'
import type { NativeComposerInputProps } from './native-composer-input.types'

type InputProps = ViewProps & {
  content: {
    text: string
    revision: string
    eventCount: number
    references: (ComposerReference & { icon?: string; iconTemplate?: boolean })[]
  }
  editable: boolean
  placeholder: string
  focusKey: string
  textColor: string
  mutedColor: string
  chipColor: string
  onTextChange: (event: { nativeEvent: { text: string; eventCount: number } }) => void
  onSourceSelection: (event: { nativeEvent: { start: number; end: number } }) => void
  onSize: (event: { nativeEvent: { height: number } }) => void
  onFocus?: TextInputProps['onFocus']
  onBlur?: TextInputProps['onBlur']
}
const nativeModule = requireOptionalNativeModule<{ blur: () => Promise<void> }>('DovoComposerInput')
const Input: ComponentType<InputProps> | null = nativeModule
  ? requireNativeView('DovoComposerInput')
  : null
export const nativeComposerAvailable = !!Input
export function dismissComposerKeyboard() {
  if (nativeModule)
    void nativeModule
      .blur()
      .catch((error) => console.error('Could not dismiss composer keyboard', error))
  Keyboard.dismiss()
}
export function NativeComposerInput({
  value,
  revision,
  resources,
  focusKey,
  expanded,
  onChangeText,
  onSelectionChange,
  ...props
}: NativeComposerInputProps) {
  const { colors } = useTheme()
  const [eventCount, setEventCount] = useState(0)
  const [height, setHeight] = useState(44)
  const references = useMemo(
    () =>
      composerReferences(value, resources).map((reference) => {
        const image = reference.provider && harnessIconImages[reference.provider]
        return image ? { ...reference, icon: image.png, iconTemplate: image.template } : reference
      }),
    [value, resources],
  )
  if (!Input) return null
  return (
    <Input
      {...props}
      accessibilityLabel="Message"
      testID="Message"
      content={{ text: value, revision, eventCount, references }}
      focusKey={focusKey ?? ''}
      editable={props.editable !== false}
      placeholder={props.placeholder ?? ''}
      textColor={colors.text}
      mutedColor={colors.muted}
      chipColor={colors.surface}
      onTextChange={({ nativeEvent }) => {
        setEventCount(nativeEvent.eventCount)
        onChangeText?.(nativeEvent.text)
      }}
      onSourceSelection={({ nativeEvent }) => onSelectionChange(nativeEvent)}
      onSize={({ nativeEvent }) => setHeight(nativeEvent.height)}
      style={{ height: Math.max(expanded ? 64 : 44, Math.min(144, height)) }}
    />
  )
}
