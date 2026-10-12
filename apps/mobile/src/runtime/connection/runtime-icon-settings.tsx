import { View, Pressable } from 'react-native'
import { runtimeIconChoices, runtimePreferencesSchema } from '@dovo/protocol'
import { useRuntime } from './provider'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import { RuntimeIcon } from '../../ui/content/runtime-icon'

export function RuntimeIconSettings() {
  const { snapshot, connected, callEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const { colors, styles } = useTheme()
  const supported = snapshot?.runtimeIcon !== undefined
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.text}>Computer icon</Text>
      <Text style={styles.muted}>Saved on this computer and shared with paired devices.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {runtimeIconChoices.map(({ id, name }) => {
          const selected = id === (snapshot?.runtimeIcon ?? 'desktop')
          const disabled = busy || !connected || !supported
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/runtime/preferences/save',
                    { runtimeIcon: id },
                    runtimePreferencesSchema,
                  ),
                )
              }
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 12,
                minHeight: 44,
                borderWidth: 1,
                borderRadius: 10,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: colors.surface,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <RuntimeIcon icon={id} size={18} color={selected ? colors.accent : colors.text} />
              <Text style={styles.text}>{name}</Text>
            </Pressable>
          )
        })}
      </View>
      {!supported && <Text style={styles.muted}>Update this runtime to customize its icon.</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
