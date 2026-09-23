import { TextInput, View, type TextInputProps } from 'react-native'
import { Text } from './text'
import { colors, styles } from './theme'
import { Icon } from './icon'

export function SearchField({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        minHeight: 44,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Icon name="search" size={17} color={colors.muted} />
      <TextInput
        accessibilityLabel={label}
        testID={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
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
    </View>
  )
}

export function Field({
  label,
  hideLabel = false,
  error,
  style,
  ...props
}: TextInputProps & { label: string; hideLabel?: boolean; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {!hideLabel && <Text style={styles.muted}>{label}</Text>}
      <TextInput
        accessibilityLabel={label}
        testID={label}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        selectionColor={colors.accent}
        style={[styles.input, style]}
        {...props}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
