import { View } from 'react-native'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function SettingSource({
  source,
  overridden,
  label,
  disabled = false,
  onReset,
}: {
  source: SettingsScope | 'built-in' | 'computer-default'
  overridden: boolean
  label: string
  disabled?: boolean
  onReset?: () => void
}) {
  const { colors, styles } = useTheme()

  const name =
    source === 'built-in'
      ? 'Dovo default'
      : source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[source]
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
      }}
    >
      <Text
        style={[
          styles.muted,
          { flex: 1, fontSize: 12, color: overridden ? colors.accent : colors.muted },
        ]}
      >
        {overridden ? `Set here · ${name}` : `Inherited · ${name}`}
      </Text>
      {overridden && onReset && (
        <Action
          secondary
          icon="reopen"
          label={`Use inherited ${label.toLowerCase()}`}
          disabled={disabled}
          onPress={onReset}
        />
      )}
    </View>
  )
}
