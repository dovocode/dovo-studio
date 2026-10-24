import { FieldValidationContext } from './validation-fields'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { Text } from '../content/text'
import { useTheme } from '../theme'
import { Icon } from './icon'
import { useContext, useEffect, useId, useRef, type ComponentRef, type Ref } from 'react'

export function SearchField({
  label,
  style,
  value,
  onChangeText,
  editable,
  clearButtonMode,
  ...props
}: TextInputProps & { label: string }) {
  const { colors } = useTheme()
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const clearable = !!value && !!onChangeText && editable !== false && clearButtonMode !== 'never'

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingRight: 0,
        minHeight: 44,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Icon name="search" size={17} color={colors.muted} />
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        accessibilityLabel={label}
        testID={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        returnKeyType="search"
        style={[
          {
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            paddingVertical: 10,
            color: colors.text,
            fontSize: 17,
          },
          style,
        ]}
        {...props}
      />
      <View style={{ width: 44, minHeight: 44, flexShrink: 0 }}>
        {clearable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            onPress={() => {
              onChangeText?.('')
              input.current?.focus()
            }}
            style={({ pressed }) => ({
              width: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

export function Field({
  label,
  hideLabel = false,
  error,
  hint,
  style,
  inputRef,
  accessibilityHint,
  ...props
}: TextInputProps & {
  label: string
  hideLabel?: boolean
  error?: string
  hint?: string
  inputRef?: Ref<ComponentRef<typeof TextInput>>
}) {
  const { colors, styles } = useTheme()
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const register = useContext(FieldValidationContext)
  const id = useId()
  useEffect(() => {
    register?.(id, { input: input.current, invalid: !!error && props.editable !== false })
  }, [register, id, error, props.editable])
  useEffect(() => () => register?.(id, null), [register, id])

  return (
    <View style={{ gap: 6 }}>
      {!hideLabel && <Text style={styles.muted}>{label}</Text>}
      <TextInput
        ref={(node) => {
          input.current = node
          if (typeof inputRef === 'function') inputRef(node)
          else if (inputRef) inputRef.current = node
        }}
        accessibilityLabel={label}
        accessibilityHint={[error, hint, accessibilityHint].filter(Boolean).join('. ') || undefined}
        testID={label}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        selectionColor={colors.accent}
        style={[
          styles.input,
          props.multiline && { minHeight: 96, textAlignVertical: 'top' },
          style,
          !!error && { borderColor: colors.error, borderWidth: 1 },
        ]}
        {...props}
      />
      {!!hint && !error && <Text style={[styles.muted, { fontSize: 12 }]}>{hint}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
