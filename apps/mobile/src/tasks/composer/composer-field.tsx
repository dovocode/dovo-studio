import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import type { TextInput, TextInputProps } from 'react-native'
import { Field } from '../../ui/controls/field'
import { styles } from '../../ui/theme'
import type { DraftSelection } from './dictation-draft'

/** Streaming updates and caret notifications must not update the native text view's props. */
export const ComposerField = memo(function ComposerField({
  showOptions,
  onSelectionChange,
  value = '',
  onChangeText,
  ...props
}: Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'onFocus' | 'onBlur' | 'editable' | 'placeholder'
> & {
  showOptions: boolean
  onSelectionChange: (selection: DraftSelection) => void
}) {
  // Native typing owns the text/caret. Echoing atom updates through `value` can
  // reconcile before TextInput records its native event and briefly move the caret.
  const input = useRef<TextInput>(null)
  const initial = useRef(value)
  const nativeText = useRef(value)
  const change = useCallback(
    (text: string) => {
      nativeText.current = text
      onChangeText?.(text)
    },
    [onChangeText],
  )
  useLayoutEffect(() => {
    if (value === nativeText.current) return
    // Hydration, dictation, commands and successful sends still update the field.
    input.current?.setNativeProps({ text: value })
    nativeText.current = value
  }, [value])
  const select = useCallback<NonNullable<TextInputProps['onSelectionChange']>>(
    ({ nativeEvent }) => onSelectionChange(nativeEvent.selection),
    [onSelectionChange],
  )
  return (
    <Field
      {...props}
      inputRef={input}
      defaultValue={initial.current}
      onChangeText={change}
      label="Message"
      hideLabel
      autoCorrect={false}
      multiline
      autoCapitalize="sentences"
      onSelectionChange={select}
      style={[
        styles.chatText,
        {
          maxHeight: 144,
          minHeight: 44,
          borderWidth: 0,
          paddingLeft: showOptions ? 12 : 44,
          paddingRight: showOptions ? 12 : 88,
          lineHeight: 22,
          paddingTop: 11,
          paddingBottom: 11,
          backgroundColor: 'transparent',
        },
      ]}
    />
  )
})
