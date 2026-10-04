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
  revision,
  onChangeText,
  ...props
}: Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'onFocus' | 'onBlur' | 'editable' | 'placeholder'
> & {
  showOptions: boolean
  revision: string
  onSelectionChange: (selection: DraftSelection) => void
}) {
  const input = useRef<TextInput>(null)
  const initial = useRef(value)
  const nativeText = useRef(value)
  const appliedRevision = useRef(revision)
  useLayoutEffect(() => {
    if (appliedRevision.current === revision) return
    appliedRevision.current = revision
    if (nativeText.current === value) return
    nativeText.current = value
    // A fresh uncontrolled input already has an empty text prop. Writing that prop again can
    // be ignored by Fabric even after native typing; clear() uses the native text command.
    if (!value) input.current?.clear()
    else input.current?.setNativeProps({ text: value })
  }, [value, revision])
  const type = useCallback(
    (text: string) => {
      nativeText.current = text
      onChangeText?.(text)
    },
    [onChangeText],
  )
  const select = useCallback<NonNullable<TextInputProps['onSelectionChange']>>(
    ({ nativeEvent }) => onSelectionChange(nativeEvent.selection),
    [onSelectionChange],
  )
  return (
    <Field
      {...props}
      inputRef={input}
      defaultValue={initial.current}
      onChangeText={type}
      label="Message"
      hideLabel
      // iOS can still revise text/selection through spellcheck and smart spacing
      // with autocorrect off. Keep this command composer free of keyboard rewrites.
      autoCorrect={false}
      spellCheck={false}
      smartInsertDelete={false}
      autoComplete="off"
      textContentType="none"
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
