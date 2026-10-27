import { useRef, type ComponentProps, type ComponentRef } from 'react'
import { Platform, type TextInput } from 'react-native'
import { Field } from '../../ui/controls/field'

/** Like the composer, native pairing fields must not echo each keystroke through Fabric. */
export function PairingField({
  value,
  onChangeText,
  normalize,
  ...props
}: Omit<ComponentProps<typeof Field>, 'defaultValue' | 'value' | 'inputRef'> & {
  value: string
  normalize?: (value: string) => string
}) {
  // Remount this field when a QR code or connection-mode change replaces its contents.
  const initial = useRef(value)
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  return (
    <Field
      {...props}
      inputRef={input}
      value={Platform.OS === 'web' ? value : undefined}
      defaultValue={Platform.OS === 'web' ? undefined : initial.current}
      onChangeText={(text) => {
        const next = normalize ? normalize(text) : text
        // Only invalid pasted characters need a native write; normal typing stays native.
        if (next !== text && Platform.OS !== 'web') input.current?.setNativeProps({ text: next })
        onChangeText?.(next)
      }}
    />
  )
}
