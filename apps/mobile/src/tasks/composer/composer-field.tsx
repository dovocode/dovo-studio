import { type ComponentRef, memo, useCallback, useLayoutEffect, useRef, useEffect } from 'react'
import { Platform, type TextInput, type TextInputProps } from 'react-native'
import Animated, { Easing, LinearTransition, ReduceMotion } from 'react-native-reanimated'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
import type { DraftSelection } from './dictation-draft'

/** Streaming updates and caret notifications must not update the native text view's props. */
export const ComposerField = memo(function ComposerField({
  focusKey,
  showOptions,
  trailingControlCount,
  onSelectionChange,
  value = '',
  revision,
  onChangeText,
  ...props
}: Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'onFocus' | 'onBlur' | 'editable' | 'placeholder'
> & {
  focusKey?: string
  showOptions: boolean
  trailingControlCount: number
  revision: string
  onSelectionChange: (selection: DraftSelection) => void
}) {
  const { styles, reduceMotion } = useTheme()

  const input = useRef<ComponentRef<typeof TextInput>>(null)
  useEffect(() => {
    if (focusKey) input.current?.focus()
  }, [focusKey])
  const initial = useRef(value)
  const nativeText = useRef(value)
  const appliedRevision = useRef(revision)
  useLayoutEffect(() => {
    if (Platform.OS === 'web') return
    if (appliedRevision.current === revision) return
    appliedRevision.current = revision
    if (nativeText.current === value) return
    nativeText.current = value
    // A fresh uncontrolled input already has an empty text prop. Writing that prop again can
    // be ignored by Fabric even after native typing; clear() uses the native text command.
    if (!value) {
      input.current?.clear()
    } else input.current?.setNativeProps({ text: value })
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
    <Animated.View
      layout={LinearTransition.duration(280)
        .easing(Easing.bezier(0.22, 1, 0.36, 1))
        .reduceMotion(reduceMotion ? ReduceMotion.Always : ReduceMotion.System)}
      style={{
        marginLeft: showOptions ? 0 : 32,
        marginRight: showOptions ? 0 : trailingControlCount * 44 - 12,
      }}
    >
      <Field
        key={Platform.OS === 'web' ? revision : undefined}
        {...props}
        inputRef={input}
        defaultValue={Platform.OS === 'web' ? value : initial.current}
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
        submitBehavior="newline"
        // Fabric measures native text as it changes. A fixed height prevents that layout
        // from growing and can leave iOS content-size notifications stuck at one line.
        scrollEnabled
        textAlignVertical="top"
        autoCapitalize="sentences"
        onSelectionChange={select}
        style={[
          styles.chatText,
          {
            maxHeight: 144,
            minHeight: showOptions ? 64 : 44,
            borderWidth: 0,
            paddingLeft: 12,
            paddingRight: 12,
            lineHeight: 22,
            paddingTop: 11,
            paddingBottom: 11,
            backgroundColor: 'transparent',
          },
        ]}
      />
    </Animated.View>
  )
})
